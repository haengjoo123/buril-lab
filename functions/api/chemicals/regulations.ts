import { json } from '../_shared/json'
import { normalizeCasNumber } from '../../../src/utils/casNumber'
import {
  parseKecoChemicalResponse,
  readKecoResultCode,
  type ChemicalRegulationLookup,
} from '../../../src/utils/chemicalRegulations'

interface Env {
  /** data.go.kr service key with 한국환경공단_화학물질 정보 조회 서비스 (15149420) approved. */
  KECO_API_KEY?: string
  /** data.go.kr keys are per account, so the KOSHA key works once the KECO service is approved for it. */
  KOSHA_API_KEY?: string
}

const KECO_CHEMICAL_LIST_URL = 'https://apis.data.go.kr/B552584/kecoapi/ncissbstn/chemSbstnList'
const FETCH_TIMEOUT_MS = 6_000
const RETRY_DELAYS_MS = [500, 1_500]
const FOUND_EDGE_TTL_SECONDS = 7 * 24 * 60 * 60
const NOT_FOUND_EDGE_TTL_SECONDS = 24 * 60 * 60
// data.go.kr "NODATA_ERROR".
const NO_DATA_RESULT_CODES = new Set(['03'])
const SUCCESS_RESULT_CODES = new Set(['00', '0', '000', '200'])

type UpstreamOutcome =
  | { kind: 'ok'; lookup: ChemicalRegulationLookup }
  | { kind: 'error'; reason: string }

const noStore = (body: unknown, status = 200) =>
  json(body, { status, headers: { 'Cache-Control': 'no-store' } })

function wait(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

async function fetchRegulations(casNumber: string, serviceKey: string): Promise<UpstreamOutcome> {
  const params = new URLSearchParams({
    serviceKey,
    pageNo: '1',
    numOfRows: '20',
    searchGubun: '2',
    searchNm: casNumber,
    returnType: 'JSON',
  })
  let reason = 'Upstream request failed'

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
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
    if (attempt < RETRY_DELAYS_MS.length) await wait(RETRY_DELAYS_MS[attempt])
  }
  return { kind: 'error', reason }
}

/**
 * Korean Chemicals Control Act classification for one CAS number.
 * Definitive answers are kept at the edge; upstream failures are not cached
 * so a later request can recover.
 */
export const onRequestGet = async (context: { request: Request; env: Env }) => {
  const requestUrl = new URL(context.request.url)
  const casNumber = normalizeCasNumber(requestUrl.searchParams.get('cas'))
  if (!casNumber) {
    return noStore({ error: 'A valid CAS number is required.' }, 400)
  }

  const serviceKey = (context.env.KECO_API_KEY || context.env.KOSHA_API_KEY || '').trim()
  if (!serviceKey) {
    return noStore({ status: 'unavailable' } satisfies ChemicalRegulationLookup)
  }

  // `default` is the Cloudflare Cache API extension.
  const cache = (caches as CacheStorage & { default: Cache }).default
  const cacheKey = new Request(`${requestUrl.origin}${requestUrl.pathname}?cas=${casNumber}`, { method: 'GET' })
  const cached = await cache.match(cacheKey)
  if (cached) {
    const browserResponse = new Response(cached.body, cached)
    browserResponse.headers.set('Cache-Control', 'no-store')
    return browserResponse
  }

  const outcome = await fetchRegulations(casNumber, serviceKey)
  if (outcome.kind === 'error') {
    console.warn(JSON.stringify({ message: 'KECO regulation lookup failed', casNumber, reason: outcome.reason }))
    return noStore({ status: 'unavailable' } satisfies ChemicalRegulationLookup)
  }

  const response = noStore(outcome.lookup)
  const edgeCachedResponse = response.clone()
  const ttl = outcome.lookup.status === 'found' ? FOUND_EDGE_TTL_SECONDS : NOT_FOUND_EDGE_TTL_SECONDS
  edgeCachedResponse.headers.set('Cache-Control', `public, s-maxage=${ttl}`)
  await cache.put(cacheKey, edgeCachedResponse)
  return response
}
