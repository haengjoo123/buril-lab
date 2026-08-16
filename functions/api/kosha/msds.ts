interface Env {
  KOSHA_API_KEY?: string
}

interface SectionResponse {
  sectionNumber: number
  status: number
  body: string
}

const KOSHA_BASE_URL = 'https://msds.kosha.or.kr/openapi/service/msdschem'
const SECTION_NUMBERS = Array.from({ length: 16 }, (_, index) => index + 1)
const MAX_CONCURRENCY = 3
const RETRY_DELAYS_MS = [500, 1_500]

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(init?.headers || {}),
    },
  })
}

function wait(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

function shouldRetry(status: number) {
  return status === 429 || status >= 500
}

function hasSectionItems(body: string) {
  return /<items\b[^>]*>[\s\S]*?<item\b/i.test(body)
}

async function fetchSection(env: Env, chemId: string, sectionNumber: number): Promise<SectionResponse> {
  const params = new URLSearchParams({
    serviceKey: env.KOSHA_API_KEY || '',
    chemId,
  })
  const endpoint = `chemdetail${String(sectionNumber).padStart(2, '0')}`
  const upstreamUrl = `${KOSHA_BASE_URL}/${endpoint}?${params.toString()}`

  let lastResponse: SectionResponse | null = null

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(upstreamUrl, {
        headers: { Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8' },
      })
      const body = await response.text()
      lastResponse = { sectionNumber, status: response.status, body }

      if (response.ok || !shouldRetry(response.status) || attempt === RETRY_DELAYS_MS.length) {
        return lastResponse
      }
    } catch {
      lastResponse = { sectionNumber, status: 503, body: '' }
      if (attempt === RETRY_DELAYS_MS.length) {
        return lastResponse
      }
    }

    await wait(RETRY_DELAYS_MS[attempt])
  }

  return lastResponse || { sectionNumber, status: 503, body: '' }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(values[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker))
  return results
}

/**
 * Returns a complete KOSHA MSDS as one cached request. The previous client
 * implementation made 16 simultaneous browser requests, exhausting the
 * public KOSHA route limit before every section could be returned.
 */
export const onRequestGet = async (context: {
  request: Request
  env: Env
}) => {
  if (!context.env.KOSHA_API_KEY?.trim()) {
    return jsonResponse({ error: 'KOSHA API key is not configured.' }, { status: 500 })
  }

  const requestUrl = new URL(context.request.url)
  const rawChemId = requestUrl.searchParams.get('chemId') || ''
  if (!/^\d{1,12}$/.test(rawChemId)) {
    return jsonResponse({ error: 'A valid chemId is required.' }, { status: 400 })
  }

  const chemId = rawChemId.padStart(6, '0')
  // `default` is the Cloudflare Cache API extension; intersecting the type
  // keeps this file type-checkable with the standard DOM CacheStorage type too.
  const cache = (caches as CacheStorage & { default: Cache }).default
  const cacheKey = new Request(requestUrl.toString(), { method: 'GET' })
  const cached = await cache.match(cacheKey)
  if (cached) {
    return cached
  }

  const sections = await mapWithConcurrency(
    SECTION_NUMBERS,
    MAX_CONCURRENCY,
    (sectionNumber) => fetchSection(context.env, chemId, sectionNumber),
  )
  const missingSections = sections
    .filter((section) => (
      section.status < 200 ||
      section.status >= 300 ||
      !hasSectionItems(section.body)
    ))
    .map((section) => section.sectionNumber)
  const complete = missingSections.length === 0

  const response = jsonResponse(
    { sections, missingSections, complete },
    {
      headers: {
        // Browsers reuse a recent result, while the edge retains a complete
        // document longer so reopening a modal does not repeat 16 upstream calls.
        'Cache-Control': complete
          ? 'public, max-age=300, s-maxage=86400'
          : 'no-store',
      },
    },
  )

  // Never cache a partial document: a retry must be able to recover sections
  // that were temporarily unavailable upstream.
  if (complete) {
    await cache.put(cacheKey, response.clone())
  }

  return response
}
