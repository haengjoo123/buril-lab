import { json } from '../_shared/json'
import { normalizeCasNumber } from '../../../src/utils/casNumber'
import type { ChemicalRegulationLookup } from '../../../src/utils/chemicalRegulations'
import {
  edgeCachedRegulationResponse,
  fetchKecoRegulations,
  readStoredRegulations,
  regulationEdgeCacheKey,
  regulationServiceKey,
  storeRegulations,
  type RegulationEnv,
} from './_regulationLookup'

const noStore = (body: unknown, status = 200) =>
  json(body, { status, headers: { 'Cache-Control': 'no-store' } })

/**
 * Korean Chemicals Control Act classification for one CAS number.
 * Definitive answers are kept at the edge and in the database cache; upstream
 * failures are not cached so a later request can recover.
 */
export const onRequestGet = async (context: { request: Request; env: RegulationEnv }) => {
  const requestUrl = new URL(context.request.url)
  const casNumber = normalizeCasNumber(requestUrl.searchParams.get('cas'))
  if (!casNumber) {
    return noStore({ error: 'A valid CAS number is required.' }, 400)
  }

  const serviceKey = regulationServiceKey(context.env)
  if (!serviceKey) {
    return noStore({ status: 'unavailable' } satisfies ChemicalRegulationLookup)
  }

  // `default` is the Cloudflare Cache API extension.
  const cache = (caches as CacheStorage & { default: Cache }).default
  const cacheKey = regulationEdgeCacheKey(requestUrl.origin, casNumber)
  const cached = await cache.match(cacheKey)
  if (cached) {
    const browserResponse = new Response(cached.body, cached)
    browserResponse.headers.set('Cache-Control', 'no-store')
    return browserResponse
  }

  const stored = (await readStoredRegulations(context.env, [casNumber])).get(casNumber)
  if (stored) {
    await cache.put(cacheKey, edgeCachedRegulationResponse(stored))
    return noStore(stored)
  }

  const outcome = await fetchKecoRegulations(casNumber, serviceKey)
  if (outcome.kind === 'error') {
    console.warn(JSON.stringify({ message: 'KECO regulation lookup failed', casNumber, reason: outcome.reason }))
    return noStore({ status: 'unavailable' } satisfies ChemicalRegulationLookup)
  }

  await Promise.all([
    storeRegulations(context.env, [[casNumber, outcome.lookup]]),
    cache.put(cacheKey, edgeCachedRegulationResponse(outcome.lookup)),
  ])
  return noStore(outcome.lookup)
}
