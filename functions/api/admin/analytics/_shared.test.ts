import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc })),
}))

import { requireAnalyticsAdmin, requireAnalyticsExportAdmin } from './_shared'

const UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  OPS_AUTH_MODE: 'server_roles',
}

function jwt(aal: 'aal1' | 'aal2' = 'aal2', sub = UUID) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode({ sub, aal })}.signature`
}

function request(path: string, aal: 'aal1' | 'aal2' = 'aal2') {
  return new Request(`https://burillab.com${path}`, {
    headers: { Authorization: `Bearer ${jwt(aal)}` },
  })
}

function decision(args: Record<string, unknown>, success = true, code?: string) {
  return {
    success,
    ...(code ? { code } : {}),
    role: args.p_required_role,
    action: args.p_action,
    assurance_level: args.p_assurance_level,
  }
}

describe('analytics operator authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.getUser.mockResolvedValue({
      data: { user: { id: UUID, email: 'operator@example.com' } }, error: null,
    })
    mocks.rpc.mockImplementation((_name: string, args: Record<string, unknown>) => Promise.resolve({
      data: decision(args), error: null,
    }))
  })

  it('returns 401 without a bearer token', async () => {
    const result = await requireAnalyticsAdmin(
      new Request('https://burillab.com/api/admin/analytics/summary'), env,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(401)
  })

  it('rejects an assigned role at AAL1 and records the MFA denial through the RPC', async () => {
    mocks.rpc.mockImplementation((_name: string, args: Record<string, unknown>) => Promise.resolve({
      data: decision(args, false, 'mfa_required'), error: null,
    }))
    const result = await requireAnalyticsAdmin(request('/api/admin/analytics/summary', 'aal1'), env)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(403)
      expect(await result.response.json()).toMatchObject({ code: 'MFA_REQUIRED' })
    }
    expect(mocks.rpc).toHaveBeenCalledWith('authorize_operator_action_v1', expect.objectContaining({
      p_required_role: 'reader', p_assurance_level: 'aal1',
    }))
  })

  it('requires the raw_exporter role for row-level exports', async () => {
    const result = await requireAnalyticsExportAdmin(request('/api/admin/analytics/export'), env)
    expect(result.ok).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith('authorize_operator_action_v1', expect.objectContaining({
      p_required_role: 'raw_exporter', p_action: 'analytics.export',
    }))
  })

  it('fails closed when the role authorization or its audit cannot be stored', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'private detail' } })
    const result = await requireAnalyticsAdmin(request('/api/admin/analytics/summary'), env)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(503)
      expect(await result.response.text()).not.toContain('private detail')
    }
  })

  it('rejects missing and unknown authorization modes', async () => {
    for (const mode of [undefined, 'legacy']) {
      const result = await requireAnalyticsAdmin(request('/api/admin/analytics/summary'), {
        ...env, OPS_AUTH_MODE: mode,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.response.status).toBe(503)
    }
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('allows only an explicitly expiring, audited AAL2 fallback', async () => {
    const fallbackEnv = {
      ...env,
      OPS_AUTH_MODE: 'email_allowlist',
      OPS_ADMIN_EMAILS: 'operator@example.com',
      OPS_ANALYTICS_EXPORT_EMAILS: 'operator@example.com',
      OPS_EMAIL_ALLOWLIST_EXPIRES_AT: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      OPS_EMAIL_ALLOWLIST_REASON: 'temporary emergency rollback',
    }
    const result = await requireAnalyticsExportAdmin(request('/api/admin/analytics/export'), fallbackEnv)
    expect(result.ok).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith('authorize_operator_fallback_v1', expect.objectContaining({
      p_required_role: 'raw_exporter', p_assurance_level: 'aal2',
    }))
  })

  it('rejects expired, overlong, or unaudited email fallback windows', async () => {
    const base = {
      ...env,
      OPS_AUTH_MODE: 'email_allowlist',
      OPS_ADMIN_EMAILS: 'operator@example.com',
      OPS_EMAIL_ALLOWLIST_REASON: 'temporary emergency rollback',
    }
    for (const expiry of [
      new Date(Date.now() - 1_000).toISOString(),
      new Date(Date.now() + 25 * 60 * 60 * 1_000).toISOString(),
    ]) {
      const result = await requireAnalyticsAdmin(request('/api/admin/analytics/summary'), {
        ...base, OPS_EMAIL_ALLOWLIST_EXPIRES_AT: expiry,
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.response.status).toBe(403)
    }
    const noReason = await requireAnalyticsAdmin(request('/api/admin/analytics/summary'), {
      ...base,
      OPS_EMAIL_ALLOWLIST_EXPIRES_AT: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      OPS_EMAIL_ALLOWLIST_REASON: '',
    })
    expect(noReason.ok).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
