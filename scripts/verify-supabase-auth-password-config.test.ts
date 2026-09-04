import { describe, expect, it, vi } from 'vitest'
import {
  assertOps8AuthConfigEnvironment,
  verifySupabaseAuthPasswordConfig,
} from './verify-supabase-auth-password-config.mjs'

const environment = {
  SUPABASE_ACCESS_TOKEN: 'sbp_fixture_material_that_is_never_a_real_secret',
  SUPABASE_PROJECT_REF: 'qpgnomuqdcucjmxrunnw',
}

describe('Ops8 hosted Supabase account-password protection verifier', () => {
  it('reads only the exact Staging auth config and reports no credential material', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      password_hibp_enabled: true,
      smtp_pass: 'provider-response-secret-that-must-not-be-returned',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await expect(verifySupabaseAuthPasswordConfig('staging', environment, fetchMock))
      .resolves.toEqual({
        result: 'supabase-auth-password-config-ok',
        environment: 'staging',
        projectRef: environment.SUPABASE_PROJECT_REF,
        passwordHibpEnabled: true,
        checkedEndpoint: '/v1/projects/{ref}/config/auth',
      })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`https://api.supabase.com/v1/projects/${environment.SUPABASE_PROJECT_REF}/config/auth`)
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' })
  })

  it('fails closed when leaked-password protection is disabled', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ password_hibp_enabled: false }), { status: 200 }))
    await expect(verifySupabaseAuthPasswordConfig('staging', environment, fetchMock))
      .rejects.toThrow('leaked account-password protection is not enabled')
  })

  it('rejects a project ref from the other environment before the request', () => {
    expect(() => assertOps8AuthConfigEnvironment('production', environment))
      .toThrow('does not match the selected environment')
  })

  it('does not echo a credential when Supabase rejects it', async () => {
    const fetchMock = vi.fn(async () => new Response('denied', { status: 401 }))
    const error = await verifySupabaseAuthPasswordConfig('staging', environment, fetchMock).catch((value) => value)
    expect(String(error)).toContain('HTTP 401')
    expect(String(error)).not.toContain(environment.SUPABASE_ACCESS_TOKEN)
  })
})
