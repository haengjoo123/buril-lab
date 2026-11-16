import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredRegulationLookup } from './_regulationLookup'

const readStoredRegulations = vi.fn<(env: unknown, cas: readonly string[]) => Promise<Map<string, StoredRegulationLookup>>>()
const storeRegulations = vi.fn<(env: unknown, lookups: ReadonlyArray<readonly [string, StoredRegulationLookup]>) => Promise<void>>()
vi.mock('./_regulationLookup', async (importOriginal) => ({
  ...await importOriginal<typeof import('./_regulationLookup')>(),
  readStoredRegulations: (env: unknown, cas: readonly string[]) => readStoredRegulations(env, cas),
  storeRegulations: (env: unknown, lookups: ReadonlyArray<readonly [string, StoredRegulationLookup]>) => storeRegulations(env, lookups),
}))

import { MAX_UPSTREAM_PER_REQUEST, onRequestPost } from './regulations-batch'

const HCL = '7647-01-0'
const FORMALDEHYDE = '50-00-0'
const ACETONE = '67-64-1'
const ETHANOL = '64-17-5'

const found = (casNumber: string): StoredRegulationLookup => ({
  status: 'found',
  record: { casNumber, entries: [{ category: 'accident_preparedness', typeName: '사고대비물질' }] },
})

const kecoPayload = (casNo: string) => ({
  header: { resultCode: '00' },
  body: { items: [{ casNo, typeList: [{ sbstnClsfTypeNm: '인체등유해성물질', unqNo: '1' }] }], totalCount: '1' },
})

function stubCache(entries: Record<string, unknown> = {}) {
  const match = vi.fn(async (request: Request) => {
    const cas = new URL(request.url).searchParams.get('cas') ?? ''
    return cas in entries ? new Response(JSON.stringify(entries[cas])) : undefined
  })
  const put = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('caches', { default: { match, put } })
  return { match, put }
}

const post = (body: unknown, userId: string | null = 'user-1') => onRequestPost({
  request: new Request('https://example.test/api/chemicals/regulations-batch', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }),
  env: { KECO_API_KEY: 'key' },
  data: userId ? { userId } : {},
})

describe('POST /api/chemicals/regulations-batch', () => {
  beforeEach(() => {
    readStoredRegulations.mockResolvedValue(new Map())
    storeRegulations.mockResolvedValue()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('requires a signed-in user and a CAS list of at most 100', async () => {
    expect((await post({ cas: [HCL] }, null)).status).toBe(401)
    expect((await post('not json')).status).toBe(400)
    expect((await post({ cas: HCL })).status).toBe(400)
    expect((await post({ cas: Array.from({ length: 101 }, () => HCL) })).status).toBe(400)
  })

  it('reports every CAS as unavailable without a data.go.kr key', async () => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    const response = await onRequestPost({
      request: new Request('https://example.test/api/chemicals/regulations-batch', { method: 'POST', body: JSON.stringify({ cas: [HCL] }) }),
      env: {},
      data: { userId: 'user-1' },
    })
    await expect(response.json()).resolves.toEqual({ results: { [HCL]: { status: 'unavailable' } } })
    expect(upstream).not.toHaveBeenCalled()
  })

  it('answers from the database, then the edge cache, then KECO, and stores what it learned', async () => {
    readStoredRegulations.mockResolvedValue(new Map([[HCL, found(HCL)]]))
    const { put } = stubCache({ [FORMALDEHYDE]: found(FORMALDEHYDE) })
    const upstream = vi.fn(async (url: string) => {
      const cas = new URL(url).searchParams.get('searchNm')!
      return cas === ACETONE
        ? new Response(JSON.stringify({ header: { resultCode: '03' }, body: { items: [] } }))
        : new Response(JSON.stringify(kecoPayload(cas)))
    })
    vi.stubGlobal('fetch', upstream)

    const response = await post({ cas: [` ${HCL} `, FORMALDEHYDE, ACETONE, ETHANOL, '67-64-2', 42, HCL] })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const { results } = await response.json() as { results: Record<string, { status: string }> }

    expect(Object.keys(results).sort()).toEqual([ETHANOL, FORMALDEHYDE, ACETONE, HCL].sort())
    expect(results[HCL]).toEqual(found(HCL))
    expect(results[FORMALDEHYDE]).toEqual(found(FORMALDEHYDE))
    expect(results[ACETONE]).toEqual({ status: 'not_found' })
    expect(results[ETHANOL]).toMatchObject({ status: 'found', record: { casNumber: ETHANOL } })

    expect(readStoredRegulations).toHaveBeenCalledWith(expect.anything(), [HCL, FORMALDEHYDE, ACETONE, ETHANOL])
    expect(upstream).toHaveBeenCalledTimes(2)
    const stored = storeRegulations.mock.calls[0][1].map(([cas]) => cas).sort()
    expect(stored).toEqual([ETHANOL, FORMALDEHYDE, ACETONE].sort())
    expect(put).toHaveBeenCalledTimes(2)
  })

  it('looks up a bounded number upstream and leaves the rest pending', async () => {
    stubCache()
    const upstream = vi.fn(async (url: string) => new Response(JSON.stringify(kecoPayload(new URL(url).searchParams.get('searchNm')!))))
    vi.stubGlobal('fetch', upstream)
    // Valid CAS numbers 100-00-5 … built with the check digit rule.
    const cas = Array.from({ length: MAX_UPSTREAM_PER_REQUEST + 3 }, (_, index) => {
      const body = String(1000 + index)
      const digits = body.split('').reverse()
      const check = digits.reduce((sum, digit, position) => sum + Number(digit) * (position + 1), 0) % 10
      return `${body.slice(0, -2)}-${body.slice(-2)}-${check}`
    })

    const { results } = await (await post({ cas })).json() as { results: Record<string, { status: string }> }

    expect(upstream).toHaveBeenCalledTimes(MAX_UPSTREAM_PER_REQUEST)
    expect(Object.values(results).filter((result) => result.status === 'found')).toHaveLength(MAX_UPSTREAM_PER_REQUEST)
    expect(Object.values(results).filter((result) => result.status === 'pending')).toHaveLength(3)
  })

  it('reports an upstream failure as unavailable and does not store it', async () => {
    stubCache()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<xml>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</xml>')))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { results } = await (await post({ cas: [HCL] })).json() as { results: Record<string, { status: string }> }

    expect(results[HCL]).toEqual({ status: 'unavailable' })
    expect(storeRegulations.mock.calls[0][1]).toEqual([])
  })
})
