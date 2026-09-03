// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getJson, InternalApiError, postJson } from './internalApi'

const mocked = vi.hoisted(() => ({ getSession: vi.fn(), fetch: vi.fn() }))
vi.mock('./supabaseClient', () => ({ supabase: { auth: { getSession: mocked.getSession } } }))
vi.mock('./apiUrl', () => ({ getInternalApiUrl: (path: string) => path }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', mocked.fetch)
  mocked.getSession.mockResolvedValue({ data: { session: { access_token: 'synthetic-token' } } })
})
afterEach(() => vi.unstubAllGlobals())

describe('internal API response contract', () => {
  it('keeps successful authenticated POST and GET contracts', async () => {
    mocked.fetch.mockResolvedValueOnce(Response.json({ success: true }))
    const controller = new AbortController()
    expect(await postJson('/api/labs/join', { labId: 'synthetic' }, { signal: controller.signal })).toEqual({ success: true })
    expect(mocked.fetch).toHaveBeenLastCalledWith('/api/labs/join', {
      method: 'POST', headers: { Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json' },
      body: '{"labId":"synthetic"}', signal: controller.signal,
    })
    mocked.fetch.mockResolvedValueOnce(Response.json(['synthetic']))
    expect(await getJson('/api/example', { cache: 'no-store' })).toEqual(['synthetic'])
    expect(mocked.fetch.mock.calls[1][1]).toMatchObject({ method: 'GET', cache: 'no-store' })
  })

  it('preserves lock code, HTTP status, and Retry-After seconds as a typed error', async () => {
    mocked.fetch.mockResolvedValueOnce(Response.json({ error: 'Locked', code: 'join_locked', retryAfterSeconds: 1800 },
      { status: 429, headers: { 'Retry-After': '1800' } }))
    await expect(postJson('/api/labs/join', {})).rejects.toMatchObject({
      name: 'InternalApiError', message: 'Locked', status: 429, code: 'join_locked', retryAfterSeconds: 1800,
    })
    expect(mocked.fetch).toHaveBeenCalledTimes(1)
  })

  it('does not discard the status or retry header when a proxy returns invalid JSON', async () => {
    mocked.fetch.mockResolvedValueOnce(new Response('{bad', {
      status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
    }))
    await expect(getJson('/api/example')).rejects.toMatchObject({ status: 503, retryAfterSeconds: 60 })
  })

  it.each([0, -1, 1.5, 86401, '1800', {}, null])('rejects an invalid body retry delay: %j', async (delay) => {
    mocked.fetch.mockResolvedValueOnce(Response.json({ error: {}, code: 'invalid\ncode', retryAfterSeconds: delay }, { status: 429 }))
    const error = await postJson('/api/labs/join', {}).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(InternalApiError)
    expect(error).toMatchObject({ message: 'Request failed with status 429', status: 429, code: undefined, retryAfterSeconds: undefined })
  })

  it('does not turn empty or non-JSON success into a successful payload', async () => {
    mocked.fetch.mockResolvedValueOnce(new Response('<html>wrong origin</html>', { status: 200 }))
    await expect(postJson('/api/labs/join', {})).rejects.toThrow('empty response')
  })

  it('does not fabricate authentication or retry a network failure', async () => {
    mocked.getSession.mockResolvedValueOnce({ data: { session: null } })
    mocked.fetch.mockRejectedValueOnce(new TypeError('Network unavailable'))
    await expect(postJson('/api/labs/join', {})).rejects.toThrow('Network unavailable')
    expect(mocked.fetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization')
    expect(mocked.fetch).toHaveBeenCalledTimes(1)
  })
})
