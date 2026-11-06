import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), getUserById: vi.fn(), from: vi.fn(), rpc: vi.fn(), storageFrom: vi.fn(), sign: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mocks.getUser, admin: { getUserById: mocks.getUserById } }, from: mocks.from, rpc: mocks.rpc,
    storage: { from: mocks.storageFrom },
  })),
}))

import { onRequestPost as feedbackStatus } from './feedback/status'
import { onRequestPost as feedbackList } from './feedback/list'
import { onRequestPost as centerStatus } from './safety-centers/status'
import { onRequestPost as centerList } from './safety-centers/list'
import { REQUESTER_DOMAIN_LOOKUP_TIMEOUT_MS } from './safety-centers/_requesterDomain'
import { onRequestPost as documentUrl } from './safety-centers/document-url'
import { onRequestPost as reviews } from './analytics/reviews'
import { onRequestPost as exportCsv } from './analytics/export'
import { onRequestPost as summary } from './analytics/summary'

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

function centerRow(index: number, overrides: Record<string, unknown> = {}) {
  const createdAt = new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString()
  return {
    id: `center-${index}`, institution_name: '버릴대학교', institution_domain: 'buril.ac.kr',
    center_name: `센터 ${index}`, status: 'pending', created_by: `requester-${index}`,
    approved_by: null, approved_at: null, verification_document_path: null, verification_document_name: null,
    verification_document_mime_type: null, verification_document_size: null,
    verification_document_uploaded_at: null, created_at: createdAt, updated_at: createdAt,
    ...overrides,
  }
}

function userWithEmail(email: string) {
  return Promise.resolve({ data: { user: { id: 'requester', email } }, error: null })
}

async function listCenters(rows: unknown[]) {
  mocks.from.mockReturnValue(query({ data: rows, error: null }))
  const response = await centerList(context({}, '/api/admin/safety-centers/list'))
  const text = await response.text()
  return { response, text, items: (JSON.parse(text) as { items: Array<Record<string, unknown>> }).items }
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
      if (name === 'operator_feedback_status_v1' || name === 'operator_safety_center_status_v2') {
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
    expect(mocks.rpc).toHaveBeenCalledWith('operator_safety_center_status_v2', expect.objectContaining({
      p_operator_user_id: UUID,
      p_center_id: UUID,
      p_status: 'approved',
      p_assurance_level: 'aal2',
      p_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      p_review_reason: null,
      p_review_note: null,
    }))
    expect(mocks.rpc).not.toHaveBeenCalledWith('operator_safety_center_status_v1', expect.anything())
    expect(mocks.from).not.toHaveBeenCalled()
  })

  describe('safety-center rejection reason', () => {
    const statusCalls = () => mocks.rpc.mock.calls.filter(([name]) => name === 'operator_safety_center_status_v2')
    const changeStatus = (body: Record<string, unknown>) => centerStatus(context(
      { centerId: UUID, ...body }, '/api/admin/safety-centers/status',
    ))

    it.each([
      ['a reason on approve', { status: 'approved', reasonPreset: 'domain_mismatch' }, 'only accepted when rejecting'],
      ['a note on pending', { status: 'pending', note: 'later' }, 'only accepted when rejecting'],
      ['an unknown preset', { status: 'rejected', reasonPreset: 'bogus' }, 'reasonPreset must be one of'],
      ['a non-string preset', { status: 'rejected', reasonPreset: 3 }, 'reasonPreset must be one of'],
      ['a note over 500 code points', { status: 'rejected', reasonPreset: 'other', note: '😀'.repeat(501) }, '500 characters or fewer'],
      ['other without a note', { status: 'rejected', reasonPreset: 'other' }, 'required when reasonPreset is other'],
      ['other with a blank note', { status: 'rejected', reasonPreset: 'other', note: '   ' }, 'required when reasonPreset is other'],
      ['a note without a preset', { status: 'rejected', note: 'why' }, 'note requires reasonPreset'],
      ['a non-string note', { status: 'rejected', reasonPreset: 'other', note: ['x'] }, 'note must be a string'],
      ['a control character in the note', { status: 'rejected', reasonPreset: 'other', note: 'a\u0007b' }, 'control characters'],
    ])('refuses %s with 400 before the status RPC', async (_label, body, message) => {
      const response = await changeStatus(body)
      expect(response.status).toBe(400)
      expect((await response.json() as { error: string }).error).toContain(message)
      expect(statusCalls()).toHaveLength(0)
      expect(mocks.from).not.toHaveBeenCalled()
    })

    it('sends a valid rejection with the trimmed note', async () => {
      const response = await changeStatus({ status: 'rejected', reasonPreset: 'domain_mismatch', note: '  x  ' })
      expect(response.status).toBe(200)
      expect(statusCalls()).toEqual([['operator_safety_center_status_v2', expect.objectContaining({
        p_status: 'rejected', p_review_reason: 'domain_mismatch', p_review_note: 'x',
        p_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      })]])
    })

    it('counts the note in code points and keeps line breaks inside it', async () => {
      const note = `${'😀'.repeat(498)}\n가`
      const response = await changeStatus({ status: 'rejected', reasonPreset: 'other', note })
      expect(response.status).toBe(200)
      expect(statusCalls()[0][1]).toMatchObject({ p_review_reason: 'other', p_review_note: note })
    })

    it('sends no reason for a rejection without one and treats a blank note as none', async () => {
      const response = await changeStatus({ status: 'rejected', reasonPreset: null, note: '  ' })
      expect(response.status).toBe(200)
      expect(statusCalls()[0][1]).toMatchObject({ p_review_reason: null, p_review_note: null })
    })
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

  it('lists every candidate when no status filter is sent', async () => {
    const builder = query({ data: [], error: null })
    mocks.from.mockReturnValue(builder)
    const response = await reviews(context({ operation: 'list' }, '/api/admin/analytics/reviews'))
    expect(response.status).toBe(200)
    expect(builder.eq).not.toHaveBeenCalled()
    expect(await response.json()).toEqual({ items: [], nextCursor: null })
  })

  it('treats a null status filter like an absent one', async () => {
    const builder = query({ data: [], error: null })
    mocks.from.mockReturnValue(builder)
    const response = await reviews(context({ operation: 'list', status: null }, '/api/admin/analytics/reviews'))
    expect(response.status).toBe(200)
    expect(builder.eq).not.toHaveBeenCalled()
  })

  it.each(['pending', 'approved', 'rejected'])('filters the review list by %s status', async (status) => {
    const builder = query({ data: [], error: null })
    mocks.from.mockReturnValue(builder)
    const response = await reviews(context({ operation: 'list', status }, '/api/admin/analytics/reviews'))
    expect(response.status).toBe(200)
    expect(builder.eq).toHaveBeenCalledTimes(1)
    expect(builder.eq).toHaveBeenCalledWith('status', status)
  })

  it('keeps the status filter when paging with a cursor', async () => {
    const builder = query({ data: [], error: null })
    mocks.from.mockReturnValue(builder)
    const response = await reviews(context({
      operation: 'list', status: 'pending', cursor: { createdAt: '2026-11-01T00:00:00.000Z', id: UUID },
    }, '/api/admin/analytics/reviews'))
    expect(response.status).toBe(200)
    expect(builder.eq).toHaveBeenCalledWith('status', 'pending')
    expect(builder.or).toHaveBeenCalledTimes(1)
  })

  it.each(['decided', 'PENDING', '', 42, ['pending'], { eq: 'pending' }])(
    'rejects an unknown review status filter %j before data access', async (status) => {
      const response = await reviews(context({ operation: 'list', status }, '/api/admin/analytics/reviews'))
      expect(response.status).toBe(400)
      expect(mocks.from).not.toHaveBeenCalled()
    },
  )

  it('returns 409 only when the review candidate was already decided', async () => {
    mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === 'authorize_operator_action_v1'
      ? Promise.resolve({ data: {
        success: true, role: args.p_required_role, action: args.p_action,
        assurance_level: args.p_assurance_level,
      }, error: null })
      : Promise.resolve({ data: null, error: { code: '22023', message: 'Review candidate has already been decided' } }))
    const response = await reviews(context(
      { operation: 'decide', candidateId: UUID, status: 'approved' }, '/api/admin/analytics/reviews',
    ))
    expect(response.status).toBe(409)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ code: 'REVIEW_ALREADY_DECIDED' })
  })

  it('keeps a missing review candidate as 404', async () => {
    mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === 'authorize_operator_action_v1'
      ? Promise.resolve({ data: {
        success: true, role: args.p_required_role, action: args.p_action,
        assurance_level: args.p_assurance_level,
      }, error: null })
      : Promise.resolve({ data: null, error: { code: 'P0002', message: 'Review candidate not found' } }))
    const response = await reviews(context(
      { operation: 'decide', candidateId: UUID, status: 'rejected' }, '/api/admin/analytics/reviews',
    ))
    expect(response.status).toBe(404)
  })

  it.each([
    'Canonical CAS number is invalid',
    'status must be approved or rejected',
    'evidence must be an object',
  ])('returns 400 for other invalid decision input: %s', async (message) => {
    mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => name === 'authorize_operator_action_v1'
      ? Promise.resolve({ data: {
        success: true, role: args.p_required_role, action: args.p_action,
        assurance_level: args.p_assurance_level,
      }, error: null })
      : Promise.resolve({ data: null, error: { code: '22023', message } }))
    const response = await reviews(context(
      { operation: 'decide', candidateId: UUID, status: 'approved' }, '/api/admin/analytics/reviews',
    ))
    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain(message)
  })

  it('lists feedback with its lab context and a flattened lab name', async () => {
    const base = {
      type: 'bug', message: 'm', contact: null, user_email: null, user_id: null, user_agent: null,
      created_at: '2026-11-06T00:00:00.000Z', status: 'new', resolved_at: null, resolved_by: null,
    }
    const builder = query({ data: [
      { ...base, id: 'with-lab', lab_id: UUID, source_screen: 'inventory', lab: { name: '유기합성 연구실' } },
      { ...base, id: 'deleted-lab', lab_id: null, source_screen: 'logs', lab: null },
      { ...base, id: 'no-context', lab_id: null, source_screen: null },
    ], error: null })
    mocks.from.mockReturnValue(builder)

    const response = await feedbackList(context({}, '/api/admin/feedback/list'))
    expect(response.status).toBe(200)
    expect(mocks.from).toHaveBeenCalledWith('feedback')
    expect(builder.select).toHaveBeenCalledWith(expect.stringContaining('lab:labs(name)'))
    expect(builder.select).toHaveBeenCalledWith(expect.stringContaining('source_screen'))
    const { items } = await response.json() as { items: Array<Record<string, unknown>> }
    expect(items.map((item) => [item.id, item.lab_id, item.source_screen, item.lab_name])).toEqual([
      ['with-lab', UUID, 'inventory', '유기합성 연구실'],
      ['deleted-lab', null, 'logs', null],
      ['no-context', null, null, null],
    ])
    expect(items.every((item) => !('lab' in item))).toBe(true)
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

  it('looks up requester domains only for pending safety centers', async () => {
    mocks.getUserById.mockImplementation(() => userWithEmail('kim@buril.ac.kr'))
    const { response, items } = await listCenters([
      centerRow(3, { status: 'approved' }),
      centerRow(2, { status: 'rejected' }),
      centerRow(1),
    ])
    expect(response.status).toBe(200)
    expect(mocks.getUserById).toHaveBeenCalledTimes(1)
    expect(mocks.getUserById).toHaveBeenCalledWith('requester-1')
    expect(items.map((item) => [item.id, item.requester_email_domain, item.domain_matches])).toEqual([
      ['center-3', null, null],
      ['center-2', null, null],
      ['center-1', 'buril.ac.kr', true],
    ])
  })

  it('checks at most the 20 oldest pending requests and asks once per requester', async () => {
    mocks.getUserById.mockImplementation(() => userWithEmail('kim@buril.ac.kr'))
    // The list arrives newest first, like the database query.
    const rows = Array.from({ length: 25 }, (_, index) => centerRow(24 - index))
    rows.push(centerRow(30, { created_by: 'requester-0', created_at: '2026-09-01T00:00:00.000Z' }))
    const { items } = await listCenters(rows)
    expect(mocks.getUserById).toHaveBeenCalledTimes(19)
    const checked = items.filter((item) => item.domain_matches !== null).map((item) => item.id)
    expect(checked).toHaveLength(20)
    expect(checked).toContain('center-30')
    expect(checked).toContain('center-0')
    expect(checked).toContain('center-18')
    expect(checked).not.toContain('center-19')
    expect(items.find((item) => item.id === 'center-24')).toMatchObject({ requester_email_domain: null, domain_matches: null })
  })

  it('accepts a subdomain of the normalized institution domain', async () => {
    mocks.getUserById.mockImplementation(() => userWithEmail(' Kim.Lee@Chem.Buril.AC.KR '))
    const { items } = await listCenters([centerRow(1, { institution_domain: ' @www.Buril.ac.kr ' })])
    expect(items[0]).toMatchObject({ requester_email_domain: 'chem.buril.ac.kr', domain_matches: true })
  })

  it.each([
    ['someone@gmail.com', 'gmail.com'],
    ['someone@evilburil.ac.kr', 'evilburil.ac.kr'],
    ['someone@buril.ac.kr.example.com', 'buril.ac.kr.example.com'],
  ])('flags a requester domain that is not the institution domain: %s', async (email, domain) => {
    mocks.getUserById.mockImplementation(() => userWithEmail(email))
    const { items } = await listCenters([centerRow(1)])
    expect(items[0]).toMatchObject({ requester_email_domain: domain, domain_matches: false })
  })

  it.each([
    ['a trailing dot', 'kim@buril.ac.kr', 'buril.ac.kr.', 'buril.ac.kr'],
    ['a port', 'kim@chem.buril.ac.kr', 'buril.ac.kr:443', 'chem.buril.ac.kr'],
    ['a scheme and a path', 'kim@buril.ac.kr', 'https://www.buril.ac.kr/about', 'buril.ac.kr'],
    ['a Korean domain against its punycode email', 'kim@xn--vk1b30kypc.kr', '버릴대.kr', 'xn--vk1b30kypc.kr'],
    ['a Korean email domain against its punycode form', 'kim@버릴대.kr.', 'XN--VK1B30KYPC.KR', 'xn--vk1b30kypc.kr'],
  ])('normalizes both domains before comparing: %s', async (_case, email, institutionDomain, requesterDomain) => {
    mocks.getUserById.mockImplementation(() => userWithEmail(email))
    const { items } = await listCenters([centerRow(1, { institution_domain: institutionDomain })])
    expect(items[0]).toMatchObject({ requester_email_domain: requesterDomain, domain_matches: true })
  })

  it.each([
    ['a trailing dot', 'buril.ac.kr.'],
    ['a port', 'buril.ac.kr:443'],
    ['a Korean domain', '버릴대.kr'],
  ])('still flags another requester domain after normalizing %s', async (_case, institutionDomain) => {
    mocks.getUserById.mockImplementation(() => userWithEmail('kim@gmail.com'))
    const { items } = await listCenters([centerRow(1, { institution_domain: institutionDomain })])
    expect(items[0]).toMatchObject({ requester_email_domain: 'gmail.com', domain_matches: false })
  })

  it.each([
    ['spaces', 'buril ac kr'],
    ['a bad port', 'buril.ac.kr:abc'],
    ['an address', 'kim@buril.ac.kr/x'],
    ['nothing', null],
  ])('shows the requester domain as a mismatch when the institution domain has %s', async (_case, institutionDomain) => {
    mocks.getUserById.mockImplementation(() => userWithEmail('kim@gmail.com'))
    const { items } = await listCenters([centerRow(1, { institution_domain: institutionDomain })])
    expect(items[0]).toMatchObject({ requester_email_domain: 'gmail.com', domain_matches: false })
  })

  it('leaves the check out when the requester domain is unknown, whatever the institution domain', async () => {
    mocks.getUserById.mockImplementation(() => userWithEmail('not-an-address'))
    const { items } = await listCenters([centerRow(1, { institution_domain: 'buril ac kr' })])
    expect(items[0]).toMatchObject({ requester_email_domain: null, domain_matches: null })
  })

  it('keeps the list when a requester lookup fails', async () => {
    mocks.getUserById.mockImplementation((userId: string) => {
      if (userId === 'requester-1') return Promise.reject(new Error('auth never-expose'))
      if (userId === 'requester-2') return Promise.resolve({ data: { user: null }, error: { message: 'not found never-expose' } })
      if (userId === 'requester-3') return Promise.resolve({ data: { user: { id: 'requester-3', email: null } }, error: null })
      return userWithEmail('kim@buril.ac.kr')
    })
    const { response, text, items } = await listCenters([centerRow(4), centerRow(3), centerRow(2), centerRow(1)])
    expect(response.status).toBe(200)
    expect(text).not.toContain('never-expose')
    expect(items.map((item) => [item.id, item.requester_email_domain, item.domain_matches])).toEqual([
      ['center-4', 'buril.ac.kr', true],
      ['center-3', null, null],
      ['center-2', null, null],
      ['center-1', null, null],
    ])
  })

  it('does not wait on a requester lookup that never answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      mocks.getUserById.mockImplementation((userId: string) => (
        userId === 'requester-1' ? new Promise(() => undefined) : userWithEmail('kim@buril.ac.kr')
      ))
      mocks.from.mockReturnValue(query({ data: [centerRow(2), centerRow(1)], error: null }))
      const pending = centerList(context({}, '/api/admin/safety-centers/list'))
      await vi.advanceTimersByTimeAsync(REQUESTER_DOMAIN_LOOKUP_TIMEOUT_MS + 1)
      const response = await pending
      expect(response.status).toBe(200)
      const { items } = await response.json() as { items: Array<Record<string, unknown>> }
      expect(items.map((item) => [item.id, item.requester_email_domain, item.domain_matches])).toEqual([
        ['center-2', 'buril.ac.kr', true],
        ['center-1', null, null],
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns only the requester domain, never the email address', async () => {
    mocks.getUserById.mockImplementation(() => userWithEmail('secret.person@buril.ac.kr'))
    const { text, items } = await listCenters([centerRow(1)])
    expect(items[0].requester_email_domain).toBe('buril.ac.kr')
    expect(text).not.toContain('secret.person')
    expect(text).not.toContain('@')
    expect(Object.keys(items[0])).not.toContain('requester_email')
  })

  describe('analytics summary with KPIs', () => {
    const summaryRow = { periodDays: 7, submittedSearches: 3 }
    const governanceRow = { reviews: { pending: 1, approved: 0, rejected: 0 } }
    const kpisRow = { schemaVersion: 1, inbox: { reviews: { count: 2 } } }

    /** The data RPCs the handler made, without the operator authorization call. */
    function dataCalls() {
      return mocks.rpc.mock.calls.filter(([name]) => name !== 'authorize_operator_action_v1')
    }

    function answerRpc(answers: Record<string, { data: unknown; error: unknown }>) {
      mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
        if (name === 'authorize_operator_action_v1') {
          return Promise.resolve({ data: {
            success: true, role: args.p_required_role, action: args.p_action, assurance_level: args.p_assurance_level,
          }, error: null })
        }
        return Promise.resolve(answers[name] ?? { data: null, error: null })
      })
    }

    beforeEach(() => answerRpc({
      analytics_admin_summary: { data: summaryRow, error: null },
      analytics_admin_governance: { data: governanceRow, error: null },
      // PostgREST returns a jsonb scalar function as a one-element array in some clients.
      analytics_admin_kpis_v1: { data: [kpisRow], error: null },
    }))

    it('makes exactly the two summary calls without includeKpis', async () => {
      const response = await summary(context({ days: 7 }, '/api/admin/analytics/summary'))
      expect(response.status).toBe(200)
      expect(dataCalls()).toEqual([
        ['analytics_admin_summary', { p_days: 7 }],
        ['analytics_admin_governance'],
      ])
      const body = await response.json() as Record<string, unknown>
      expect(body).toEqual({ summary: summaryRow, governance: governanceRow })
      expect(Object.keys(body)).not.toContain('kpis')
    })

    it('adds the KPI call and its unwrapped result with includeKpis', async () => {
      const response = await summary(context({ days: 7, includeKpis: true }, '/api/admin/analytics/summary'))
      expect(response.status).toBe(200)
      expect(dataCalls()).toEqual([
        ['analytics_admin_summary', { p_days: 7 }],
        ['analytics_admin_governance'],
        ['analytics_admin_kpis_v1', { p_days: 7 }],
      ])
      expect(await response.json()).toEqual({ summary: summaryRow, governance: governanceRow, kpis: kpisRow })
    })

    it.each([{ includeKpis: 'true' }, { includeKpis: 1 }, { includeKpis: false }, null])(
      'asks for the KPIs only with includeKpis: true (%j)', async (body) => {
        const response = await summary(context(body, '/api/admin/analytics/summary'))
        expect(response.status).toBe(200)
        expect(dataCalls().map(([name]) => name)).toEqual(['analytics_admin_summary', 'analytics_admin_governance'])
        expect(dataCalls()[0]).toEqual(['analytics_admin_summary', { p_days: 30 }])
      },
    )

    it('bounds the period for the KPIs like the summary', async () => {
      await summary(context({ days: 999, includeKpis: true }, '/api/admin/analytics/summary'))
      expect(dataCalls()).toContainEqual(['analytics_admin_summary', { p_days: 365 }])
      expect(dataCalls()).toContainEqual(['analytics_admin_kpis_v1', { p_days: 365 }])
    })

    it('keeps the summary when the KPI function is not deployed, and never echoes its message', async () => {
      answerRpc({
        analytics_admin_summary: { data: summaryRow, error: null },
        analytics_admin_governance: { data: governanceRow, error: null },
        analytics_admin_kpis_v1: { data: null, error: { code: 'PGRST202', message: 'secret detail' } },
      })
      const response = await summary(context({ days: 7, includeKpis: true }, '/api/admin/analytics/summary'))
      expect(response.status).toBe(200)
      const text = await response.text()
      expect(JSON.parse(text)).toEqual({ summary: summaryRow, governance: governanceRow, kpis: null, kpisError: 'KPIS_UNAVAILABLE' })
      expect(text).not.toContain('secret detail')
      expect(console.error).toHaveBeenCalledWith(
        JSON.stringify({ event: 'api_internal_error', scope: 'admin.analytics.kpis', providerCode: 'PGRST202' }),
      )
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('secret detail')
    })

    it.each([
      [{ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }],
      [{ data: null, error: { message: 'no code' } }],
      [{ data: [], error: null }],
      [{ data: 'not an object', error: null }],
    ])('reports any other KPI failure as KPIS_FAILED with the summary intact (%j)', async (answer) => {
      answerRpc({
        analytics_admin_summary: { data: summaryRow, error: null },
        analytics_admin_governance: { data: governanceRow, error: null },
        analytics_admin_kpis_v1: answer,
      })
      const response = await summary(context({ days: 7, includeKpis: true }, '/api/admin/analytics/summary'))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ summary: summaryRow, governance: governanceRow, kpis: null, kpisError: 'KPIS_FAILED' })
    })

    it('still fails the whole response when the summary itself fails', async () => {
      answerRpc({
        analytics_admin_summary: { data: null, error: { code: '42501', message: 'summary never-expose' } },
        analytics_admin_governance: { data: governanceRow, error: null },
        analytics_admin_kpis_v1: { data: kpisRow, error: null },
      })
      const response = await summary(context({ days: 7, includeKpis: true }, '/api/admin/analytics/summary'))
      expect(response.status).toBe(500)
      const text = await response.text()
      expect(JSON.parse(text)).toMatchObject({ code: 'INTERNAL_ERROR' })
      expect(text).not.toContain('never-expose')
    })
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
