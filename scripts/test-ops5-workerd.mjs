import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { convertV4MiniflareOptions, Miniflare, Response as TestResponse } from 'miniflare'

// Local Cloudflare-runtime/real Supabase-SDK contract checks. Every outgoing
// request is intercepted here, including unexpected destinations. There are no
// remote bindings, real provider tokens, or real Auth/DB calls.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const userId = '11111111-1111-4111-8111-111111111111'
const labId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const hmacSecret = 'ops5-runtime-synthetic-hmac-never-a-real-credential'
const configuration = JSON.parse(readFileSync(path.join(root, 'wrangler.staging.jsonc'), 'utf8'))
const bundle = await build({
  stdin: { contents: `
    import { createApiMiddleware } from './functions/api/_middleware';
    import { onRequestPost } from './functions/api/labs/join';
    const boundary = createApiMiddleware({
      verifyToken: async () => ({ sub: '${userId}' }),
      applyRateLimit: async () => ({ success: true, limit: 30, remaining: 29, reset: Date.now()+60000 }),
    });
    export default { async fetch(request, env) {
      const data = {};
      return boundary({ request, env, data, params: {},
        next: (bounded = request) => onRequestPost({ request: bounded, env, data }) });
    } };
  `, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
  conditions: ['workerd', 'worker', 'browser'], external: ['node:*'], logLevel: 'silent',
})
let mode = 'success'
let authCalls = 0, rpcCalls = 0, unexpectedCalls = 0
let lastRpc
const syntheticAnonCredential = ['ops5', 'synthetic', 'anon'].join('-')
const syntheticServiceCredential = ['ops5', 'synthetic', 'service'].join('-')
const options = convertV4MiniflareOptions({
  name: 'ops5-local-join-contract', modules: true, script: bundle.outputFiles[0].text,
  host: '127.0.0.1', port: 0, cf: { colo: 'SYNTHETIC' },
  compatibilityDate: configuration.compatibility_date, compatibilityFlags: configuration.compatibility_flags,
  bindings: { APP_ENVIRONMENT: 'staging', SUPABASE_URL: 'https://ops5-supabase.invalid',
    SUPABASE_ANON_KEY: syntheticAnonCredential, SUPABASE_SERVICE_ROLE_KEY: syntheticServiceCredential,
    LAB_JOIN_RATE_LIMIT_SECRET: hmacSecret },
  outboundService: async (request) => {
    const url = new URL(request.url)
    if (url.origin !== 'https://ops5-supabase.invalid') {
      unexpectedCalls++
      return new TestResponse('Unexpected destination refused', { status: 502 })
    }
    if (url.pathname === '/auth/v1/user' && request.method === 'GET') {
      authCalls++
      assert.equal(request.headers.get('Authorization'), 'Bearer synthetic.jwt.token')
      if (mode === 'auth-invalid') return TestResponse.json({ msg: 'Invalid JWT' }, { status: 401 })
      if (mode === 'auth-redirect') return new TestResponse(null, { status: 302, headers: { Location: 'https://refused.invalid/' } })
      if (mode === 'auth-unavailable') return TestResponse.json({ msg: 'synthetic-sensitive-detail' }, { status: 503 })
      return TestResponse.json({ id: userId, aud: 'authenticated', role: 'authenticated',
        is_anonymous: false, email: 'ops5-runtime@example.invalid', created_at: '2026-01-01T00:00:00Z',
        app_metadata: {}, user_metadata: mode === 'auth-oversize' ? { oversized: 'x'.repeat(300_000) } : {} })
    }
    if (url.pathname === '/rest/v1/rpc/join_lab_server_v1' && request.method === 'POST') {
      rpcCalls++
      assert.equal(request.headers.get('apikey'), 'ops5-synthetic-service')
      lastRpc = await request.json()
      if (mode === 'locked') return TestResponse.json({ success: false, code: 'join_locked', retry_after_seconds: 1800 })
      if (mode === 'incorrect') return TestResponse.json({ success: false, code: 'incorrect_password' })
      if (mode === 'rpc-oversize') return TestResponse.json({ success: true, lab_id: labId, oversized: 'x'.repeat(9000) })
      if (mode === 'rpc-malformed') return new TestResponse('broken JSON', { headers: { 'Content-Type': 'application/json' } })
      if (mode === 'rpc-error') return TestResponse.json({ code: 'P0001', message: 'synthetic-sensitive-detail' }, { status: 400 })
      return TestResponse.json({ success: true, lab_id: labId })
    }
    unexpectedCalls++
    return new TestResponse('Unexpected route refused', { status: 502 })
  },
})
const runtime = new Miniflare({ ...options, telemetry: { enabled: false } })
try {
  await runtime.ready
  const invoke = () => runtime.dispatchFetch('https://staging.burillab.com/api/labs/join', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic.jwt.token',
      'CF-Connecting-IP': '192.0.2.16', Origin: 'https://staging.burillab.com' },
    body: JSON.stringify({ labId, password: 'synthetic-password' }), cf: { colo: 'SYNTHETIC' },
  })
  let response = await invoke()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { success: true, labId })
  assert.equal(authCalls, 1)
  assert.equal(rpcCalls, 1)
  assert.equal(lastRpc.p_user_id, userId)
  assert.equal(lastRpc.p_ip_hash, createHmac('sha256', hmacSecret)
    .update(`burillab:lab-join:v1:ip:${labId}:192.0.2.16`).digest('hex'))
  assert.equal(lastRpc.p_user_hash, createHmac('sha256', hmacSecret)
    .update(`burillab:lab-join:v1:user:${labId}:${userId}`).digest('hex'))
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.match(response.headers.get('X-Request-ID'), /^[a-f0-9-]{36}$/)

  for (const [scenario, expectedStatus, expectedRpc] of [
    ['locked', 429, 1], ['incorrect', 403, 1], ['auth-invalid', 401, 0],
    ['auth-unavailable', 503, 0], ['auth-redirect', 503, 0], ['auth-oversize', 503, 0],
    ['rpc-oversize', 503, 1], ['rpc-malformed', 503, 1], ['rpc-error', 503, 1],
  ]) {
    mode = scenario
    const beforeAuth = authCalls, beforeRpc = rpcCalls
    response = await invoke()
    assert.equal(response.status, expectedStatus, scenario)
    assert.equal(authCalls - beforeAuth, 1, `${scenario}: Auth is never resent`)
    assert.equal(rpcCalls - beforeRpc, expectedRpc, `${scenario}: RPC is never resent`)
    if (scenario === 'locked') assert.equal(response.headers.get('Retry-After'), '1800')
    assert.ok(!(await response.text()).includes('synthetic-sensitive-detail'))
  }
  assert.equal(unexpectedCalls, 0)
  console.log(JSON.stringify({ localCloudflareRuntime: true, realSupabaseSdk: true, syntheticScenarios: 10,
    edgeMetadataPreserved: true, authRequests: authCalls, rpcRequests: rpcCalls, unexpectedCalls,
    remoteProviderCalls: 0, hostedAcceptance: false }))
} finally {
  await runtime.dispose()
}
