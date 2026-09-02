import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestGet } from './msds'

function runtimeConfig(koshaContentMode: 'full' | 'link_only') {
  return {
    get: vi.fn().mockResolvedValue({
      voice_disposal_mode: 'redirect',
      kosha_content_mode: koshaContentMode,
      account_deletion_enabled: false,
      maintenance_worker_enabled: false,
      storage_backup_enabled: false,
    }),
  }
}

describe('KOSHA MSDS content mode', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['missing KV', {}],
    ['explicit link-only', { BURILLAB_RUNTIME_CONFIG: runtimeConfig('link_only') }],
    ['partial KV', { BURILLAB_RUNTIME_CONFIG: { get: vi.fn().mockResolvedValue({ kosha_content_mode: 'full' }) } }],
    ['missing backup field', { BURILLAB_RUNTIME_CONFIG: { get: vi.fn().mockResolvedValue({
      voice_disposal_mode: 'redirect', kosha_content_mode: 'full',
      account_deletion_enabled: false, maintenance_worker_enabled: false,
    }) } }],
    ['malformed backup field', { BURILLAB_RUNTIME_CONFIG: { get: vi.fn().mockResolvedValue({
      voice_disposal_mode: 'redirect', kosha_content_mode: 'full',
      account_deletion_enabled: false, maintenance_worker_enabled: false, storage_backup_enabled: 'true',
    }) } }],
  ])('returns an official link with zero upstream calls for %s', async (_label, env) => {
    const upstreamFetch = vi.fn()
    vi.stubGlobal('fetch', upstreamFetch)

    const response = await onRequestGet({
      request: new Request('https://example.test/api/kosha/msds?chemId=000123'),
      env: { KOSHA_API_KEY: 'unused', ...env },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({
      mode: 'link_only',
      officialUrl: 'https://msds.kosha.or.kr/MSDSInfo/kcic/msdssearchMsds.do',
      sections: [],
      complete: false,
    })
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('keeps complete full content at the edge while returning no-store', async () => {
    const match = vi.fn().mockResolvedValue(undefined)
    const put = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('caches', { default: { match, put } })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(
      '<response><body><items><item><msdsItemNameKor>항목</msdsItemNameKor><itemDetail>값</itemDetail></item></items></body></response>',
      { status: 200 },
    )))

    const response = await onRequestGet({
      request: new Request('https://example.test/api/kosha/msds?chemId=000123'),
      env: {
        KOSHA_API_KEY: 'fixture',
        BURILLAB_RUNTIME_CONFIG: runtimeConfig('full'),
      },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(put).toHaveBeenCalledTimes(1)
    expect((put.mock.calls[0][1] as Response).headers.get('Cache-Control')).toBe('public, s-maxage=86400')
  })
})
