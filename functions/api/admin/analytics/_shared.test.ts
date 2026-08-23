import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { getUser } })),
}))

import { requireAnalyticsAdmin, requireAnalyticsExportAdmin } from './_shared'

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  OPS_ADMIN_EMAILS: 'operator@example.com',
  OPS_ANALYTICS_EXPORT_EMAILS: 'exporter@example.com',
}

describe('analytics operator authorization', () => {
  beforeEach(() => {
    getUser.mockResolvedValue({
      data: { user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'viewer@example.com' } },
      error: null,
    })
  })

  it('returns 401 without a bearer token', async () => {
    const result = await requireAnalyticsAdmin(new Request('https://example.com'), env)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(401)
  })

  it('returns 403 for an authenticated email outside the operator allowlist', async () => {
    const result = await requireAnalyticsAdmin(new Request('https://example.com', {
      headers: { Authorization: 'Bearer token' },
    }), env)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(403)
  })

  it('requires the separate export allowlist after general operator access', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'operator@example.com' } },
      error: null,
    })
    const result = await requireAnalyticsExportAdmin(new Request('https://example.com', {
      headers: { Authorization: 'Bearer token' },
    }), env)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(403)
  })
})
