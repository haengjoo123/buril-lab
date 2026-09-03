import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))

import { onRequestPost } from './delete'

const userId = '11111111-1111-4111-8111-111111111111'
const requestId = '22222222-2222-4222-8222-222222222222'
const labId = '33333333-3333-4333-8333-333333333333'
const jobId = '44444444-4444-4444-8444-444444444444'

function request(body: unknown = { requestId, labId }) {
  return new Request('https://example.test/api/labs/delete', {
    method: 'POST',
    headers: { Authorization: 'Bearer one.two.three', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function env() {
  return {
    BURILLAB_RUNTIME_CONFIG: { get: vi.fn().mockResolvedValue({
      voice_disposal_mode: 'redirect', kosha_content_mode: 'full',
      account_deletion_enabled: true, maintenance_worker_enabled: false,
      storage_backup_enabled: true,
    }) },
    SUPABASE_URL: 'https://fixture.supabase.co',
    SUPABASE_ANON_KEY: 'fixture-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  }
}

describe('lab deletion intake foundation', () => {
  beforeEach(() => createClientMock.mockReset())

  it('queues only the authenticated admin identity and exact lab target', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { success: true, job_id: jobId, status: 'pending' }, error: null })
    createClientMock
      .mockReturnValueOnce({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) } })
      .mockReturnValueOnce({ auth: {}, rpc })
    const response = await onRequestPost({ request: request(), env: env() })
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ success: true, jobId, status: 'pending' })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('enqueue_lab_deletion_v1', {
      p_user_id: userId, p_lab_id: labId, p_request_id: requestId,
    })
  })

  it('rejects a non-UUID target before creating a Supabase client', async () => {
    const response = await onRequestPost({ request: request({ requestId, labId: 'bad' }), env: env() })
    expect(response.status).toBe(400)
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('maps an admin authorization refusal to a stable public error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { success: false, code: 'lab_admin_required' }, error: null })
    createClientMock
      .mockReturnValueOnce({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) } })
      .mockReturnValueOnce({ auth: {}, rpc })
    const response = await onRequestPost({ request: request(), env: env() })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'Lab administrator access is required.', code: 'lab_admin_required',
    })
  })
})
