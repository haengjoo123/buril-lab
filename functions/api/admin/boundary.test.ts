import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), from: vi.fn(), rpc: vi.fn(), storageFrom: vi.fn(), sign: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mocks.getUser }, from: mocks.from, rpc: mocks.rpc,
    storage: { from: mocks.storageFrom },
  })),
}))

import { onRequestPost as feedbackStatus } from './feedback/status'
import { onRequestPost as feedbackList } from './feedback/list'
import { onRequestPost as centerStatus } from './safety-centers/status'
import { onRequestPost as documentUrl } from './safety-centers/document-url'
import { onRequestPost as reviews } from './analytics/reviews'
import { onRequestPost as exportCsv } from './analytics/export'

const UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
function jwt(aal: 'aal1' | 'aal2' = 'aal2', sub = UUID) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode({ sub, aal })}.signature`
}
const env = {
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'fixture-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-server', OPS_AUTH_MODE: 'server_roles',
}

function context(body: unknown, path: string) {
  return { env, request: new Request(`https://burillab.com${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) }
}

function query(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(), lt: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    then(resolve: (value: typeof result) => unknown) { return Promise.resolve(result).then(resolve) },
  }
  return builder
}

describe('administrator API boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.getUser.mockResolvedValue({ data: { user: { id: UUID, email: 'operator@example.test' } }, error: null })
    mocks.from.mockReturnValue(query({ data: [], error: null }))
    mocks.storageFrom.mockReturnValue({ createSignedUrl: mocks.sign })
    mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === 'authorize_operator_action_v1') {
        return Promise.resolve({ data: {
          success: true,
          role: args.p_required_role,
          action: args.p_action,
          assurance_level: args.p_assurance_level,
        }, error: null })
      }
      if (name === 'operator_analytics_review_decide_v1') {
        return Promise.resolve({ data: { success: true, item: { id: UUID } }, error: null })
      }
      if (name === 'operator_feedback_status_v1' || name === 'operator_safety_center_status_v1') {
        return Promise.resolve({ data: { success: true, item: { id: UUID } }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it.each([null, [], { feedbackId: 42, status: 'resolved' }, { feedbackId: 'not-a-uuid', status: 'resolved' }]) (
    'rejects malformed feedback input before data access', async (body) => {
      expect((await feedbackStatus(context(body, '/api/admin/feedback/status'))).status).toBe(400)
      expect(mocks.from).not.toHaveBeenCalled()
    },
  )

  it.each([null, [], { centerId: 42 }, { centerId: 'id.eq.injected' }]) (
    'rejects malformed safety-center IDs before data or Storage access', async (body) => {
      expect((await documentUrl(context(body, '/api/admin/safety-centers/document-url'))).status).toBe(400)
      expect(mocks.from).not.toHaveBeenCalled()
      expect(mocks.storageFrom).not.toHaveBeenCalled()
    },
  )

  it('rejects a malformed approval ID before any lookup or update', async () => {
    expect((await centerStatus(context(
      { centerId: 'bad', status: 'approved' }, '/api/admin/safety-centers/status',
    ))).status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('uses the atomic feedback mutation and success-audit RPC', async () => {
    const response = await feedbackStatus(context(
      { feedbackId: UUID, status: 'resolved' }, '/api/admin/feedback/status',
    ))
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('operator_feedback_status_v1', expect.objectContaining({
      p_operator_user_id: UUID,
      p_feedback_id: UUID,
      p_status: 'resolved',
      p_assurance_level: 'aal2',
      p_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }))
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('uses the atomic safety-center mutation and success-audit RPC', async () => {
    const response = await centerStatus(context(
      { centerId: UUID, status: 'approved' }, '/api/admin/safety-centers/status',
    ))
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('operator_safety_center_status_v1', expect.objectContaining({
      p_operator_user_id: UUID,
      p_center_id: UUID,
      p_status: 'approved',
      p_assurance_level: 'aal2',
    }))
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('keeps review listing read-only and leaves refresh to the scheduled job', async () => {
    const builder = query({ data: [], error: null })
    mocks.from.mockReturnValue(builder)
    const response = await reviews(context({ operation: 'list' }, '/api/admin/analytics/reviews'))
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).not.toHaveBeenCalledWith('analytics_review_candidate_refresh', expect.anything())
    expect(builder.update).not.toHaveBeenCalled()
    expect(mocks.from).toHaveBeenCalledWith('analytics_review_candidates')
  })

  it('does not leak database details in a failed list response', async () => {
    mocks.from.mockReturnValue(query({ data: null, error: { code: '42501', message: 'secret-table never-expose' } }))
    const response = await feedbackList(context({}, '/api/admin/feedback/list'))
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('never-expose')
  })

  it('does not return a successful decision if the atomic review/audit RPC fails', async () => {
    mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === 'authorize_operator_action_v1'
      ? Promise.resolve({ data: {
        success: true, role: args.p_required_role, action: args.p_action,
        assurance_level: args.p_assurance_level,
      }, error: null })
      : Promise.resolve({ data: null, error: { code: '42501', message: 'audit never-expose' } }))
    const response = await reviews(context(
      { operation: 'decide', candidateId: UUID, status: 'approved' }, '/api/admin/analytics/reviews',
    ))
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ code: 'INTERNAL_ERROR' })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('does not release CSV when the export audit cannot be saved', async () => {
    const auditInsert = vi.fn().mockResolvedValue({ error: { code: '42501', message: 'audit never-expose' } })
    mocks.from.mockImplementation((table: string) => table === 'analytics_export_audits'
      ? { insert: auditInsert } : query({ data: [], error: null }))
    const response = await exportCsv(context(
      { from: '2026-08-01T00:00:00Z', to: '2026-08-02T00:00:00Z', reason: 'quality test' },
      '/api/admin/analytics/export',
    ))
    expect(auditInsert).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(500)
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect(response.headers.has('Content-Disposition')).toBe(false)
    expect(await response.text()).not.toContain('never-expose')
  })

  it('returns no document URL after a Storage signing failure', async () => {
    mocks.from.mockReturnValue(query({ data: { verification_document_path: 'fixture/document.pdf' }, error: null }))
    mocks.sign.mockResolvedValue({ data: null, error: { message: 'storage never-expose' } })
    const response = await documentUrl(context({ centerId: UUID }, '/api/admin/safety-centers/document-url'))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).not.toHaveProperty('url')
    expect(JSON.stringify(body)).not.toContain('never-expose')
  })

  it('does not read or sign a document when the authorization audit fails', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'audit never-expose' } })
    const response = await documentUrl(context({ centerId: UUID }, '/api/admin/safety-centers/document-url'))
    expect(response.status).toBe(503)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.storageFrom).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain('never-expose')
  })

  it('rejects an authenticated account without the required server role', async () => {
    mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => Promise.resolve({
      data: name === 'authorize_operator_action_v1' ? {
        success: false, code: 'operator_role_required', role: args.p_required_role,
        action: args.p_action, assurance_level: args.p_assurance_level,
      } : null,
      error: null,
    }))
    expect((await feedbackList(context({}, '/api/admin/feedback/list'))).status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
