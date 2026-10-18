import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestGet } from './regulations'

const kecoPayload = {
  header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' },
  body: {
    items: [{
      casNo: '7647-01-0',
      korexst: 'KE-20189',
      sbstnNmKor: '염화 수소',
      sbstnNmEng: 'Hydrogen chloride',
      typeList: [
        { sbstnClsfTypeNm: '기존화학물질', unqNo: 'KE-20189' },
        { sbstnClsfTypeNm: '사고대비물질', unqNo: '44', contInfo: '염화 수소 및 이를 10% 이상 함유한 혼합물' },
      ],
    }],
    totalCount: '1',
  },
}

function stubCache() {
  const match = vi.fn().mockResolvedValue(undefined)
  const put = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('caches', { default: { match, put } })
  return { match, put }
}

const request = (cas: string) => new Request(`https://example.test/api/chemicals/regulations?cas=${encodeURIComponent(cas)}`)

describe('GET /api/chemicals/regulations', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('rejects an invalid CAS number without calling upstream', async () => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)

    const response = await onRequestGet({ request: request('67-64-2'), env: { KECO_API_KEY: 'key' } })

    expect(response.status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('reports unavailable when no data.go.kr key is configured', async () => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)

    const response = await onRequestGet({ request: request('7647-01-0'), env: {} })

    await expect(response.json()).resolves.toEqual({ status: 'unavailable' })
    expect(upstream).not.toHaveBeenCalled()
  })

  it('queries KECO by CAS, returns the classification, and caches it at the edge', async () => {
    const { put } = stubCache()
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify(kecoPayload), { status: 200 }))
    vi.stubGlobal('fetch', upstream)

    const response = await onRequestGet({ request: request(' 7647-01-0 '), env: { KOSHA_API_KEY: 'shared-key' } })

    const upstreamUrl = new URL(upstream.mock.calls[0][0] as string)
    expect(upstreamUrl.origin + upstreamUrl.pathname).toBe('https://apis.data.go.kr/B552584/kecoapi/ncissbstn/chemSbstnList')
    expect(Object.fromEntries(upstreamUrl.searchParams)).toMatchObject({
      serviceKey: 'shared-key', searchGubun: '2', searchNm: '7647-01-0', returnType: 'JSON',
    })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({
      status: 'found',
      record: {
        casNumber: '7647-01-0',
        keNumber: 'KE-20189',
        entries: [
          { category: 'accident_preparedness', typeName: '사고대비물질', contentThreshold: '염화 수소 및 이를 10% 이상 함유한 혼합물' },
          { category: 'existing', typeName: '기존화학물질' },
        ],
      },
    })
    expect(put).toHaveBeenCalledTimes(1)
    expect((put.mock.calls[0][1] as Response).headers.get('Cache-Control')).toBe('public, s-maxage=604800')
  })

  it('prefers KECO_API_KEY over the shared KOSHA key', async () => {
    stubCache()
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify(kecoPayload), { status: 200 }))
    vi.stubGlobal('fetch', upstream)

    await onRequestGet({ request: request('7647-01-0'), env: { KECO_API_KEY: 'keco', KOSHA_API_KEY: 'kosha' } })

    expect(new URL(upstream.mock.calls[0][0] as string).searchParams.get('serviceKey')).toBe('keco')
  })

  it('caches a definitive not-found for a shorter time', async () => {
    const { put } = stubCache()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ header: { resultCode: '03', resultMsg: 'NODATA_ERROR' }, body: { items: '' } }),
      { status: 200 },
    )))

    const response = await onRequestGet({ request: request('7647-01-0'), env: { KECO_API_KEY: 'key' } })

    await expect(response.json()).resolves.toEqual({ status: 'not_found' })
    expect((put.mock.calls[0][1] as Response).headers.get('Cache-Control')).toBe('public, s-maxage=86400')
  })

  it('does not cache an XML key error from data.go.kr', async () => {
    const { put } = stubCache()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      '<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>',
      { status: 200 },
    )))

    const response = await onRequestGet({ request: request('7647-01-0'), env: { KECO_API_KEY: 'key' } })

    await expect(response.json()).resolves.toEqual({ status: 'unavailable' })
    expect(put).not.toHaveBeenCalled()
  })

  it('does not cache the 403 data.go.kr returns before a key is approved for the service', async () => {
    const { put } = stubCache()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      OpenAPI_ServiceResponse: { cmmMsgHeader: {
        errMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', returnAuthMsg: '등록되지 않은 서비스키', returnReasonCode: '30',
      } },
    }), { status: 403 }))
    vi.stubGlobal('fetch', upstream)

    const response = await onRequestGet({ request: request('7647-01-0'), env: { KOSHA_API_KEY: 'key' } })

    await expect(response.json()).resolves.toEqual({ status: 'unavailable' })
    expect(upstream).toHaveBeenCalledTimes(1)
    expect(put).not.toHaveBeenCalled()
  })

  it('does not cache an upstream error result code', async () => {
    const { put } = stubCache()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ header: { resultCode: '22', resultMsg: 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR' } }),
      { status: 200 },
    )))

    const response = await onRequestGet({ request: request('7647-01-0'), env: { KECO_API_KEY: 'key' } })

    await expect(response.json()).resolves.toEqual({ status: 'unavailable' })
    expect(put).not.toHaveBeenCalled()
  })

  it('returns the edge-cached answer without calling upstream', async () => {
    const cachedBody = JSON.stringify({ status: 'not_found' })
    vi.stubGlobal('caches', { default: {
      match: vi.fn().mockResolvedValue(new Response(cachedBody, { headers: { 'Cache-Control': 'public, s-maxage=86400' } })),
      put: vi.fn(),
    } })
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)

    const response = await onRequestGet({ request: request('7647-01-0'), env: { KECO_API_KEY: 'key' } })

    expect(upstream).not.toHaveBeenCalled()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ status: 'not_found' })
  })
})
