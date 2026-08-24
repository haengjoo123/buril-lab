import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestGet } from './[endpoint]'

function runtimeConfig(koshaContentMode: 'full' | 'link_only') {
  return {
    get: vi.fn().mockResolvedValue({
      voice_disposal_mode: 'redirect',
      kosha_content_mode: koshaContentMode,
      account_deletion_enabled: false,
      maintenance_worker_enabled: false,
    }),
  }
}

describe('KOSHA endpoint content mode', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('blocks link-only content before an upstream call', async () => {
    const upstreamFetch = vi.fn()
    vi.stubGlobal('fetch', upstreamFetch)

    const response = await onRequestGet({
      request: new Request('https://example.test/api/kosha/chemdetail01?chemId=000123'),
      env: {
        KOSHA_API_KEY: 'fixture',
        BURILLAB_RUNTIME_CONFIG: runtimeConfig('link_only'),
      },
      params: { endpoint: 'chemdetail01' },
    })

    expect(response.status).toBe(403)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it('does not allow browser caching in full mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<response />', { status: 200 })))
    const response = await onRequestGet({
      request: new Request('https://example.test/api/kosha/chemlist?searchWrd=acetone'),
      env: { KOSHA_API_KEY: 'fixture', BURILLAB_RUNTIME_CONFIG: runtimeConfig('full') },
      params: { endpoint: 'chemlist' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
