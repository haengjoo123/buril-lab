import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))

import { onRequestPost } from './delete'

const userId = '11111111-1111-4111-8111-111111111111'
const requestId = '22222222-2222-4222-8222-222222222222'
const jobId = '33333333-3333-4333-8333-333333333333'

function request(body: unknown = { requestId }) {
  return new Request('https://example.test/api/account/delete', {
    method: 'POST',
    headers: { Authorization: 'Bearer one.two.three', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function runtime(accountDeletionEnabled: boolean) {
  return { get: vi.fn().mockResolvedValue({
    voice_disposal_mode: 'redirect', kosha_content_mode: 'full',
    account_deletion_enabled: accountDeletionEnabled,
    maintenance_worker_enabled: false, storage_backup_enabled: true,
  }) }
}

function env(enabled = true) {
  return {
    BURILLAB_RUNTIME_CONFIG: runtime(enabled),
    SUPABASE_URL: 'https://fixture.supabase.co',
    SUPABASE_ANON_KEY: 'fixture-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  }
}

function clients(result: unknown = { success: true, job_id: jobId, status: 'pending' }) {
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: userId, is_anonymous: false } }, error: null })
  const rpc = vi.fn().mockResolvedValue({ data: result, error: null })
  createClientMock
    .mockReturnValueOnce({ auth: { getUser } })
    .mockReturnValueOnce({ auth: {}, rpc })
  return { getUser, rpc }
}

describe('account deletion intake foundation', () => {
  beforeEach(() => createClientMock.mockReset())

  it.each([
    ['missing binding', undefined],
    ['disabled value', runtime(false)],
    ['partial value', { get: vi.fn().mockResolvedValue({ account_deletion_enabled: true }) }],
    ['KV failure', { get: vi.fn().mockRejectedValue(new Error('KV unavailable')) }],
  ])('stays closed before creating a DB client when %s', async (_label, namespace) => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await onRequestPost({ request: request(), env: { BURILLAB_RUNTIME_CONFIG: namespace } })
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(createClientMock).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('returns 202 only after the authenticated user is queued by the service RPC', async () => {
    const { getUser, rpc } = clients()
    const response = await onRequestPost({ request: request(), env: env(), data: { userId } })
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ success: true, jobId, status: 'pending' })
    expect(getUser).toHaveBeenCalledWith('one.two.three')
    expect(rpc).toHaveBeenCalledExactlyOnceWith('enqueue_account_deletion_v1', {
      p_user_id: userId, p_request_id: requestId,
    })
  })

  it('rejects invalid or extra fields before reading provider credentials', async () => {
    for (const body of [{ requestId: 'bad' }, { requestId, extra: true }]) {
      const response = await onRequestPost({ request: request(body), env: env() })
      expect(response.status).toBe(400)
    }
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('does not enqueue when middleware identity disagrees with Auth', async () => {
    const { rpc } = clients()
    const response = await onRequestPost({
      request: request(), env: env(), data: { userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    })
    expect(response.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('maps the administered-lab guard without exposing database details', async () => {
    clients({ success: false, code: 'account_transfer_required' })
    const response = await onRequestPost({ request: request(), env: env() })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Transfer or delete administered labs first.', code: 'account_transfer_required',
    })
  })

  it('fails closed on a malformed RPC result', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    clients({ success: true, job_id: jobId, status: 'completed', secret: 'do-not-expose' })
    const response = await onRequestPost({ request: request(), env: env() })
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('do-not-expose')
    consoleSpy.mockRestore()
  })
})
