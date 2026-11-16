import { createChemicalCacheAdminClient, type ChemicalCacheEnv } from './_cache'
import {
  parseKecoChemicalResponse,
  readKecoResultCode,
  type ChemicalRegulationLookup,
} from '../../../src/utils/chemicalRegulations'

/**
 * Shared pieces of the 화학물질관리법 classification lookups: the KECO
 * upstream call, the edge cache key and the database cache.
 *
 * The classification of a CAS number is public data that changes only with a
 * notice, so definitive answers are kept in chemical_source_cache
 * (source 'keco', record_type 'regulation') for every user and lab. Upstream
 * failures are never stored, so a later request can recover.
 */

export interface RegulationEnv extends ChemicalCacheEnv {
  /** data.go.kr service key with 한국환경공단_화학물질 정보 조회 서비스 (15149420) approved. */
  KECO_API_KEY?: string
  /** data.go.kr keys are per account, so the KOSHA key works once the KECO service is approved for it. */
  KOSHA_API_KEY?: string
}

export type StoredRegulationLookup = Extract<ChemicalRegulationLookup, { status: 'found' | 'not_found' }>

export type UpstreamOutcome =
  | { kind: 'ok'; lookup: StoredRegulationLookup }
  | { kind: 'error'; reason: string }

const KECO_CHEMICAL_LIST_URL = 'https://apis.data.go.kr/B552584/kecoapi/ncissbstn/chemSbstnList'
const FETCH_TIMEOUT_MS = 6_000
const RETRY_DELAYS_MS = [500, 1_500]
export const FOUND_EDGE_TTL_SECONDS = 7 * 24 * 60 * 60
export const NOT_FOUND_EDGE_TTL_SECONDS = 24 * 60 * 60
const FOUND_DB_TTL_MS = 30 * 24 * 60 * 60 * 1000
const NOT_FOUND_DB_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Bump when the stored lookup shape changes; older rows are then ignored. */
export const REGULATION_CACHE_VERSION = 1
// data.go.kr "NODATA_ERROR".
const NO_DATA_RESULT_CODES = new Set(['03'])
const SUCCESS_RESULT_CODES = new Set(['00', '0', '000', '200'])

const SOURCE = 'keco'
const RECORD_TYPE = 'regulation'

export function regulationServiceKey(env: RegulationEnv): string {
  return (env.KECO_API_KEY || env.KOSHA_API_KEY || '').trim()
}

function wait(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

/** One KECO lookup. `retries: false` makes a single attempt, for batch requests that must stay short. */
export async function fetchKecoRegulations(
  casNumber: string,
  serviceKey: string,
  { retries = true }: { retries?: boolean } = {},
): Promise<UpstreamOutcome> {
  const params = new URLSearchParams({
    serviceKey,
    pageNo: '1',
    numOfRows: '20',
    searchGubun: '2',
    searchNm: casNumber,
    returnType: 'JSON',
  })
  const delays = retries ? RETRY_DELAYS_MS : []
  let reason = 'Upstream request failed'

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(`${KECO_CHEMICAL_LIST_URL}?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
      const body = await response.text()
      if (response.ok) {
        let payload: unknown
        try {
          payload = JSON.parse(body)
        } catch {
          // data.go.kr reports key and quota errors as XML even when JSON is requested.
          return { kind: 'error', reason: 'Upstream returned a non-JSON response' }
        }
        const record = parseKecoChemicalResponse(payload, casNumber)
        if (record) return { kind: 'ok', lookup: { status: 'found', record } }

        const resultCode = readKecoResultCode(payload)
        if (resultCode === undefined || SUCCESS_RESULT_CODES.has(resultCode) || NO_DATA_RESULT_CODES.has(resultCode)) {
          return { kind: 'ok', lookup: { status: 'not_found' } }
        }
        return { kind: 'error', reason: `Upstream result code ${resultCode}` }
      }
      reason = `Upstream HTTP ${response.status}`
      if (response.status !== 429 && response.status < 500) return { kind: 'error', reason }
    } catch (error) {
      reason = error instanceof Error ? error.message : 'Upstream network error'
    } finally {
      clearTimeout(timeoutId)
    }
    if (attempt < delays.length) await wait(delays[attempt])
  }
  return { kind: 'error', reason }
}

/** The edge cache key shared by the single and batch lookups. */
export function regulationEdgeCacheKey(origin: string, casNumber: string): Request {
  return new Request(`${origin}/api/chemicals/regulations?cas=${casNumber}`, { method: 'GET' })
}

export function edgeCachedRegulationResponse(lookup: StoredRegulationLookup): Response {
  const ttl = lookup.status === 'found' ? FOUND_EDGE_TTL_SECONDS : NOT_FOUND_EDGE_TTL_SECONDS
  return new Response(JSON.stringify(lookup), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, s-maxage=${ttl}` },
  })
}

/** Only shapes this code wrote are trusted back from the cache. */
export function asStoredRegulationLookup(value: unknown): StoredRegulationLookup | null {
  if (!value || typeof value !== 'object') return null
  const lookup = value as { status?: unknown; record?: { casNumber?: unknown; entries?: unknown } }
  if (lookup.status === 'not_found') return { status: 'not_found' }
  if (
    lookup.status === 'found'
    && lookup.record
    && typeof lookup.record.casNumber === 'string'
    && Array.isArray(lookup.record.entries)
  ) {
    return value as StoredRegulationLookup
  }
  return null
}

/** Stored answers for the given normalized CAS numbers; unknown or expired ones are absent. */
export async function readStoredRegulations(
  env: RegulationEnv,
  casNumbers: readonly string[],
): Promise<Map<string, StoredRegulationLookup>> {
  const stored = new Map<string, StoredRegulationLookup>()
  const keys = Array.from(new Set(casNumbers))
  const supabase = createChemicalCacheAdminClient(env)
  if (!supabase || keys.length === 0) return stored

  try {
    const { data, error } = await supabase
      .from('chemical_source_cache')
      .select('lookup_key,result')
      .eq('source', SOURCE)
      .eq('record_type', RECORD_TYPE)
      .eq('result_version', REGULATION_CACHE_VERSION)
      .in('lookup_key', keys)
      .gt('expires_at', new Date().toISOString())
    if (error) {
      console.warn(JSON.stringify({ message: 'regulation cache read failed', error: error.message }))
      return stored
    }
    for (const row of (data ?? []) as Array<{ lookup_key: string; result: unknown }>) {
      const lookup = asStoredRegulationLookup(row.result)
      if (lookup) stored.set(row.lookup_key, lookup)
    }
  } catch (error) {
    console.warn(JSON.stringify({
      message: 'regulation cache read failed',
      error: error instanceof Error ? error.message : String(error),
    }))
  }
  return stored
}

/** Keeps definitive answers; a failed write only costs a later upstream call. */
export async function storeRegulations(
  env: RegulationEnv,
  lookups: ReadonlyArray<readonly [string, StoredRegulationLookup]>,
): Promise<void> {
  const supabase = createChemicalCacheAdminClient(env)
  if (!supabase || lookups.length === 0) return
  const fetchedAt = new Date()

  try {
    const { error } = await supabase.from('chemical_source_cache').upsert(
      lookups.map(([casNumber, lookup]) => ({
        source: SOURCE,
        record_type: RECORD_TYPE,
        lookup_key: casNumber,
        result_version: REGULATION_CACHE_VERSION,
        cache_status: lookup.status === 'found' ? 'complete' : 'source_absent',
        result: lookup,
        fetched_at: fetchedAt.toISOString(),
        expires_at: new Date(fetchedAt.getTime() + (lookup.status === 'found' ? FOUND_DB_TTL_MS : NOT_FOUND_DB_TTL_MS)).toISOString(),
        updated_at: fetchedAt.toISOString(),
      })),
      { onConflict: 'source,record_type,lookup_key,result_version' },
    )
    if (error) console.warn(JSON.stringify({ message: 'regulation cache write failed', error: error.message }))
  } catch (error) {
    console.warn(JSON.stringify({
      message: 'regulation cache write failed',
      error: error instanceof Error ? error.message : String(error),
    }))
  }
}
