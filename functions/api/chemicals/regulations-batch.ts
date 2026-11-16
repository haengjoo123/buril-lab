import { json } from '../_shared/json'
import { normalizeCasNumber } from '../../../src/utils/casNumber'
import type { ChemicalRegulationBatchResponse, ChemicalRegulationBatchResult } from '../../../src/utils/chemicalRegulations'
import {
  asStoredRegulationLookup,
  edgeCachedRegulationResponse,
  fetchKecoRegulations,
  readStoredRegulations,
  regulationEdgeCacheKey,
  regulationServiceKey,
  storeRegulations,
  type RegulationEnv,
  type StoredRegulationLookup,
} from './_regulationLookup'

interface FunctionContext {
  request: Request
  env: RegulationEnv
  data: Record<string, unknown>
}

export const MAX_BATCH_CAS = 100
/** Upstream calls per request; the rest come back `pending` and the client asks again. */
export const MAX_UPSTREAM_PER_REQUEST = 12
const UPSTREAM_CONCURRENCY = 4
/** Stop starting upstream calls after this long so the request stays short. */
const UPSTREAM_BUDGET_MS = 8_000

const respond = (body: ChemicalRegulationBatchResponse | { error: string }, status = 200) =>
  json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

async function readBody(request: Request): Promise<unknown[] | null> {
  try {
    const body = await request.json() as { cas?: unknown }
    return Array.isArray(body?.cas) ? body.cas : null
  } catch {
    return null
  }
}

/**
 * 화학물질관리법 classification for up to 100 CAS numbers, for lab-wide views
 * (inventory filter, exports, admin counts). Signed-in users only. Answers come
 * from the database cache, then the edge cache of the single lookup, then KECO
 * for a bounded number of misses per request.
 */
export const onRequestPost = async (context: FunctionContext): Promise<Response> => {
  if (typeof context.data.userId !== 'string') return respond({ error: 'Authentication is required.' }, 401)

  const raw = await readBody(context.request)
  if (!raw) return respond({ error: 'A list of CAS numbers is required.' }, 400)
  if (raw.length > MAX_BATCH_CAS) return respond({ error: `At most ${MAX_BATCH_CAS} CAS numbers per request.` }, 400)

  const casNumbers = Array.from(new Set(raw
    .map((value) => (typeof value === 'string' ? normalizeCasNumber(value) : null))
    .filter((value): value is string => Boolean(value))))
  const results: Record<string, ChemicalRegulationBatchResult> = {}
  if (casNumbers.length === 0) return respond({ results })

  const serviceKey = regulationServiceKey(context.env)
  if (!serviceKey) {
    for (const cas of casNumbers) results[cas] = { status: 'unavailable' }
    return respond({ results })
  }

  const stored = await readStoredRegulations(context.env, casNumbers)
  for (const [cas, lookup] of stored) results[cas] = lookup

  // Answers the single lookup already kept at the edge are moved into the database cache.
  const origin = new URL(context.request.url).origin
  const cache = (caches as CacheStorage & { default: Cache }).default
  const backfill: Array<readonly [string, StoredRegulationLookup]> = []
  const misses: string[] = []
  for (const cas of casNumbers.filter((value) => !stored.has(value))) {
    const cached = await cache.match(regulationEdgeCacheKey(origin, cas))
    const lookup = cached ? asStoredRegulationLookup(await cached.json().catch(() => null)) : null
    if (lookup) {
      results[cas] = lookup
      backfill.push([cas, lookup])
    } else {
      misses.push(cas)
    }
  }

  const upstream = misses.slice(0, MAX_UPSTREAM_PER_REQUEST)
  for (const cas of misses.slice(MAX_UPSTREAM_PER_REQUEST)) results[cas] = { status: 'pending' }

  const fetched: Array<readonly [string, StoredRegulationLookup]> = []
  const startedAt = Date.now()
  let next = 0
  const worker = async () => {
    while (next < upstream.length) {
      const cas = upstream[next]
      next += 1
      if (Date.now() - startedAt > UPSTREAM_BUDGET_MS) {
        results[cas] = { status: 'pending' }
        continue
      }
      const outcome = await fetchKecoRegulations(cas, serviceKey, { retries: false })
      if (outcome.kind === 'ok') {
        results[cas] = outcome.lookup
        fetched.push([cas, outcome.lookup])
      } else {
        console.warn(JSON.stringify({ message: 'KECO regulation lookup failed', casNumber: cas, reason: outcome.reason }))
        results[cas] = { status: 'unavailable' }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(UPSTREAM_CONCURRENCY, upstream.length) }, worker))

  await Promise.all([
    storeRegulations(context.env, [...backfill, ...fetched]),
    ...fetched.map(([cas, lookup]) => cache.put(regulationEdgeCacheKey(origin, cas), edgeCachedRegulationResponse(lookup))),
  ])
  return respond({ results })
}
