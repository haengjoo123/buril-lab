import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { onRequestPost, EVALUATION_AUDIENCE, EVALUATION_PATH } from './evaluate'
import { createApiMiddleware } from '../../_middleware'
// @ts-expect-error The CLI is intentionally authored as JavaScript.
import { requestCase } from '../../../../scripts/decisions-remote.mjs'

let state: { grant: { id: string; expiresAt: string; publicKey: { kty: string; crv: string; x: string }; caseIds: string[] }; privateKey: Record<string, unknown> }
beforeEach(async () => {
  const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true })
  const pub = await exportJWK(pair.publicKey)
  state = { grant: { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + 600_000).toISOString(),
    publicKey: { kty: pub.kty!, crv: pub.crv!, x: pub.x! }, caseIds: ['classification-3-0', 'voice-3-0'] }, privateKey: await exportJWK(pair.privateKey) }
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const credentials = { clientId: 'access-id', clientSecret: 'test-access-only' }
function env(environment = 'staging') {
  return { APP_ENVIRONMENT: environment, OPENAI_API_KEY: 'test-server-only-key', OPENAI_SAFETY_HMAC_SECRET: 'test-server-hmac',
    BURILLAB_RUNTIME_CONFIG: { get: async () => state.grant } }
}
function transport(environment = 'staging') {
  return async (url: string, init: RequestInit) => {
    expect(url).toBe(`https://staging.burillab.com${EVALUATION_PATH}`)
    expect(JSON.stringify(init)).not.toContain('test-server-only-key')
    const request = new Request(url, init)
    const next = vi.fn((forwarded?: Request) => onRequestPost({ request: forwarded ?? request, env: env(environment) }))
    return createApiMiddleware()({ request, env: env(environment), next, data: {}, params: {} })
  }
}
describe('signed remote evaluation through the real middleware and handler', () => {
  it('runs a configured probe without provider calls or database access', async () => {
    const provider = vi.fn(); vi.stubGlobal('fetch', provider)
    const result = await requestCase(state, 'classification-3-0', 'probe', credentials, transport())
    expect(result).toMatchObject({ configured: true, error: false })
    expect(provider).not.toHaveBeenCalled()
  })
  it('evaluates Decisions with server-only credentials, returns usage, never falls back', async () => {
    const provider = vi.fn(async (url, init) => {
      expect(url).toBe('https://api.openai.com/v1/decisions')
      expect(init.headers.Authorization).toBe('Bearer test-server-only-key')
      const body = JSON.parse(init.body)
      return Response.json({ model: 'gpt-6-luna', usage: { input_tokens: 10, output_tokens: 0 }, answers: [{ name: 'classification', type: 'choice', choice: 'ORGANIC_NON_HALOGEN', confidence: 0.1,
        probabilities: body.questions[0].choices.map((item: { value: string }) => ({ value: item.value, probability: item.value === 'ORGANIC_NON_HALOGEN' ? 1 : 0 })) }] })
    })
    vi.stubGlobal('fetch', provider)
    const result = await requestCase(state, 'classification-3-0', 'decisions', credentials, transport())
    expect(result).toMatchObject({ choice: 'ORGANIC_NON_HALOGEN', usage: { input_tokens: 10 }, error: false })
    expect(JSON.stringify(result)).not.toContain('test-server')
    expect(provider).toHaveBeenCalledTimes(1)
  })
  it('records HTTP 503 as an evaluation error without calling Responses', async () => {
    const provider = vi.fn().mockResolvedValue(new Response('', { status: 503 })); vi.stubGlobal('fetch', provider)
    const result = await requestCase(state, 'voice-3-0', 'decisions', credentials, transport())
    expect(result).toMatchObject({ error: true, code: 'EVALUATION_PROVIDER_FAILED' })
    expect(provider).toHaveBeenCalledTimes(1)
  })
  it('blocks production, expired grants and non-granted fixture ids before provider calls', async () => {
    const provider = vi.fn(); vi.stubGlobal('fetch', provider)
    await expect(requestCase(state, 'classification-3-0', 'decisions', credentials, transport('production'))).rejects.toThrow()
    await expect(requestCase(state, 'classification-1-0', 'decisions', credentials, transport())).rejects.toThrow()
    state.grant.expiresAt = '2020-01-01T00:00:00Z'
    await expect(requestCase(state, 'classification-3-0', 'decisions', credentials, transport())).rejects.toThrow()
    expect(provider).not.toHaveBeenCalled()
  })
  it('rejects absent auth and arbitrary prompts without billing', async () => {
    vi.stubGlobal('fetch', vi.fn())
    for (const body of [{ caseId: 'classification-3-0', backend: 'decisions' }, { prompt: 'anything' }]) {
      const response = await onRequestPost({ env: env(), request: new Request(`https://staging.burillab.com${EVALUATION_PATH}`, { method: 'POST', body: JSON.stringify(body) }) })
      expect(response.status).toBe(401)
    }
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects a signed token scoped to a different backend', async () => {
    const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true })
    const pub = await exportJWK(pair.publicKey)
    state.grant.publicKey = { kty: pub.kty!, crv: pub.crv!, x: pub.x! }
    const token = await new SignJWT({}).setProtectedHeader({ alg: 'EdDSA' }).setIssuer(state.grant.id).setAudience(EVALUATION_AUDIENCE).setSubject('classification-3-0:probe').setIssuedAt().setExpirationTime('15s').sign(pair.privateKey)
    const response = await onRequestPost({ env: env(), request: new Request(`https://staging.burillab.com${EVALUATION_PATH}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ caseId: 'classification-3-0', backend: 'decisions' }) }) })
    expect(response.status).toBe(403)
  })
})
