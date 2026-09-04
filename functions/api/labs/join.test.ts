// @vitest-environment node
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LAB_JOIN_BODY_BYTES, LAB_JOIN_UPSTREAM_TIMEOUT_MS, labJoinClientIp, onRequestPost } from './join'

const mocked = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), rpc: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocked.createClient }))

const userId = '11111111-1111-4111-8111-111111111111'
const labId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const env = {
  APP_ENVIRONMENT: 'staging', SUPABASE_URL: 'https://synthetic.supabase.invalid',
  SUPABASE_ANON_KEY: 'synthetic-anon-key', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
  LAB_JOIN_RATE_LIMIT_SECRET: 'synthetic-join-hmac-secret-not-a-real-credential',
}
const token = 'synthetic.jwt.token'

function request(value: unknown = { labId, password: 'synthetic-password' }, headers: HeadersInit = {}): Request {
  const merged = new Headers({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })
  new Headers(headers).forEach((value, key) => merged.set(key, value))
  return new Request('https://staging.burillab.com/api/labs/join', { method: 'POST', headers: merged,
    body: typeof value === 'string' ? value : JSON.stringify(value) })
}

function edgeRequest(ip: string, value?: unknown): Request {
  const result = request(value, { 'CF-Connecting-IP': ip })
  Object.defineProperty(result, 'cf', { value: { colo: 'TEST' } })
  return result
}

beforeEach(() => {
  vi.resetAllMocks()
  mocked.createClient.mockImplementation((_url, key) => key === env.SUPABASE_SERVICE_ROLE_KEY
    ? { rpc: mocked.rpc } : { auth: { getUser: mocked.getUser } })
  mocked.getUser.mockResolvedValue({ data: { user: { id: userId, is_anonymous: false } }, error: null })
  mocked.rpc.mockResolvedValue({ data: { success: true, lab_id: labId }, error: null })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('server lab join API', () => {
  it('binds the actor to getUser, sends only HMAC subjects, and accepts only the exact success contract', async () => {
    const result = await onRequestPost({ env, request: edgeRequest('192.0.2.8', {
      labId: labId.toUpperCase(), password: 'synthetic-password', nickname: '  Synthetic member  ',
    }), data: { userId } })
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ success: true, labId })
    expect(result.headers.get('Cache-Control')).toBe('no-store')
    expect(mocked.getUser).toHaveBeenCalledWith(token)
    const hmac = (type: string, value: string) => createHmac('sha256', env.LAB_JOIN_RATE_LIMIT_SECRET)
      .update(`burillab:lab-join:v1:${type}:${labId}:${value}`).digest('hex')
    expect(mocked.rpc).toHaveBeenCalledExactlyOnceWith('join_lab_server_v1', {
      p_user_id: userId, p_lab_id: labId, p_password: 'synthetic-password', p_nickname: 'Synthetic member',
      p_user_hash: hmac('user', userId), p_ip_hash: hmac('ip', '192.0.2.8'),
    })
    expect(JSON.stringify(mocked.rpc.mock.calls)).not.toContain('192.0.2.8')
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('synthetic-password')
  })

  it('preserves empty and short existing passwords during Expand', async () => {
    for (const password of ['', 'short']) {
      const result = await onRequestPost({ env, request: request({ labId, password }) })
      expect(result.status).toBe(200)
      expect(mocked.rpc.mock.calls.at(-1)?.[1].p_password).toBe(password)
    }
  })

  it.each([
    null, [], 7, { labId }, { labId, password: 7 }, { labId: 'not-a-uuid', password: '' },
    { labId, password: '', role: 'admin' }, { labId, password: '', userId },
    { labId, password: '', nickname: null }, { labId, password: '', nickname: 123 },
    { labId, password: 'x'.repeat(129) }, { labId, password: '\0' },
    { labId, password: '', nickname: 'x'.repeat(101) }, { labId, password: '', nickname: 'bad\nname' },
    '{"broken":',
  ])('rejects invalid input before contacting Auth or DB: %j', async (value) => {
    const result = await onRequestPost({ env, request: request(value) })
    expect(result.status).toBe(400)
    expect(mocked.createClient).not.toHaveBeenCalled()
  })

  it('checks Unicode length as characters instead of bytes', async () => {
    expect((await onRequestPost({ env, request: request({ labId, password: '🧪'.repeat(128), nickname: '이'.repeat(100) }) })).status).toBe(200)
    expect((await onRequestPost({ env, request: request({ labId, password: '🧪'.repeat(129) }) })).status).toBe(400)
  })

  it('checks declared and chunked body size before any upstream call', async () => {
    const declared = request({}, { 'Content-Length': String(LAB_JOIN_BODY_BYTES + 1) })
    expect((await onRequestPost({ env, request: declared })).status).toBe(413)
    expect(declared.bodyUsed).toBe(false)
    expect((await onRequestPost({ env, request: request({ labId, password: 'x'.repeat(LAB_JOIN_BODY_BYTES) }) })).status).toBe(413)
    expect(mocked.createClient).not.toHaveBeenCalled()
  })

  it('rejects unsupported content types and invalid bearer tokens', async () => {
    expect((await onRequestPost({ env, request: request({}, { 'Content-Type': 'text/plain' }) })).status).toBe(415)
    for (const auth of ['', 'Basic synthetic', 'Bearer only-one-part']) {
      expect((await onRequestPost({ env, request: request({}, { Authorization: auth }) })).status).toBe(401)
    }
    expect(mocked.createClient).not.toHaveBeenCalled()
  })

  it.each(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'LAB_JOIN_RATE_LIMIT_SECRET']) (
    'fails closed if %s is missing', async (field) => {
      const result = await onRequestPost({ env: { ...env, [field]: '' }, request: request() })
      expect(result.status).toBe(503)
      expect(mocked.createClient).not.toHaveBeenCalled()
    },
  )

  it('never sends a DB request for invalid, deleted, anonymous or mismatched users', async () => {
    for (const user of [null, { id: 'invalid' }, { id: userId, is_anonymous: true }]) {
      mocked.getUser.mockResolvedValueOnce({ data: { user }, error: null })
      expect((await onRequestPost({ env, request: request() })).status).toBe(401)
    }
    expect((await onRequestPost({ env, request: request(), data: { userId: labId } })).status).toBe(401)
    expect(mocked.rpc).not.toHaveBeenCalled()
  })

  it('distinguishes an Auth outage from invalid authentication without leaking errors', async () => {
    mocked.getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 503, message: 'sensitive-auth-detail' } })
    const unavailable = await onRequestPost({ env, request: request() })
    expect(unavailable.status).toBe(503)
    expect(await unavailable.text()).not.toContain('sensitive-auth-detail')
    mocked.getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 401, message: 'sensitive-auth-detail' } })
    expect((await onRequestPost({ env, request: request() })).status).toBe(401)
    expect(mocked.rpc).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('sensitive-auth-detail')
  })

  it('treats the Auth SDK network-error status zero as an outage, not a logged-out user', async () => {
    mocked.getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 0, message: 'network unavailable' } })
    expect((await onRequestPost({ env, request: request() })).status).toBe(503)
    expect(mocked.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['incorrect_password', 403], ['already_member', 409], ['lab_not_found', 404],
  ])('maps %s to HTTP %i', async (code, status) => {
    mocked.rpc.mockResolvedValueOnce({ data: { success: false, code }, error: null })
    const result = await onRequestPost({ env, request: request() })
    expect(result.status).toBe(status)
    expect(await result.json()).toMatchObject({ code })
  })

  it('returns the actual lock duration in the body and Retry-After', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: { success: false, code: 'join_locked', retry_after_seconds: 1800 }, error: null })
    const result = await onRequestPost({ env, request: request() })
    expect(result.status).toBe(429)
    expect(result.headers.get('Retry-After')).toBe('1800')
    expect(await result.json()).toMatchObject({ code: 'join_locked', retryAfterSeconds: 1800 })
  })

  it.each([
    null, [], { success: 'true' }, { success: true, lab_id: userId },
    { success: true, lab_id: labId, sensitive_sql: 'must-not-escape' },
    { success: false, code: 'unknown', error: 'must-not-escape' },
    { success: false, code: 'join_locked' }, { success: false, code: 'join_locked', retry_after_seconds: '60' },
    { success: false, code: 'join_locked', retry_after_seconds: 0 },
    { success: false, code: 'join_locked', retry_after_seconds: 3601 },
  ])('fails closed on an unexpected RPC contract: %j', async (data) => {
    mocked.rpc.mockResolvedValueOnce({ data, error: null })
    const result = await onRequestPost({ env, request: request() })
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain('must-not-escape')
  })

  it('does not expose DB error details or fall back to the old RPC', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'sensitive-sql-secret' } })
    const result = await onRequestPost({ env, request: request() })
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain('sensitive-sql-secret')
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('sensitive-sql-secret')
    expect(mocked.rpc).toHaveBeenCalledTimes(1)
    expect(mocked.rpc.mock.calls[0][0]).toBe('join_lab_server_v1')
  })

  it('maps the existing membership cap without returning the DB message', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001',
      message: 'max_lab_memberships_exceeded: sensitive-internal-detail' } })
    const result = await onRequestPost({ env, request: request() })
    expect(result.status).toBe(409)
    expect(await result.json()).toEqual({ error: 'The account has reached its lab membership limit.', code: 'max_lab_memberships_exceeded' })
  })

  it('bounds a stalled auth call and refuses a late continuation into the DB', async () => {
    vi.useFakeTimers()
    let resolveAuth: ((value: unknown) => void) | undefined
    mocked.getUser.mockImplementation(() => new Promise((resolve) => { resolveAuth = resolve }))
    const pending = onRequestPost({ env, request: request() })
    await vi.waitFor(() => expect(mocked.getUser).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(LAB_JOIN_UPSTREAM_TIMEOUT_MS + 1)
    expect((await pending).status).toBe(503)
    resolveAuth!({ data: { user: { id: userId } }, error: null })
    await vi.advanceTimersByTimeAsync(1)
    expect(mocked.rpc).not.toHaveBeenCalled()
  })

  it('bounds a stalled RPC without automatically resending it', async () => {
    vi.useFakeTimers()
    mocked.rpc.mockImplementation(() => new Promise(() => {}))
    const pending = onRequestPost({ env, request: request() })
    await vi.waitFor(() => expect(mocked.rpc).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(LAB_JOIN_UPSTREAM_TIMEOUT_MS + 1)
    expect((await pending).status).toBe(503)
    expect(mocked.rpc).toHaveBeenCalledTimes(1)
  })
})

describe('trusted and canonical lab join IP buckets', () => {
  it('does not trust forwarded headers without Cloudflare metadata or outside a deployed environment', () => {
    expect(labJoinClientIp(request(undefined, { 'CF-Connecting-IP': '192.0.2.8' }), 'production')).toBe('unknown')
    expect(labJoinClientIp(edgeRequest('192.0.2.8'), 'development')).toBe('unknown')
    expect(labJoinClientIp(edgeRequest('192.0.2.8'), undefined)).toBe('unknown')
    expect(labJoinClientIp(edgeRequest('192.0.2.8'), 'production')).toBe('192.0.2.8')
  })

  it('normalizes equivalent IPv6 and IPv4 values', () => {
    expect(labJoinClientIp(edgeRequest('2001:0DB8:0000:0000:0000:0000:0000:0001'), 'staging')).toBe('2001:db8::1')
    expect(labJoinClientIp(edgeRequest('192.000.002.008'), 'staging')).toBe('192.0.2.8')
  })

  it.each(['', '999.0.0.1', '192.0.2.8, 198.51.100.1', 'example.invalid', 'fe80::1%scope', ':::']) (
    'uses the conservative bucket for malformed IP %s', (ip) => {
      expect(labJoinClientIp(edgeRequest(ip), 'staging')).toBe('unknown')
    },
  )
})
