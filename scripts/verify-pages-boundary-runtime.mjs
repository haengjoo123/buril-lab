import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { pathToFileURL } from 'node:url'
import { startPagesBoundaryLocal } from './pages-boundary-local.mjs'

const ORIGIN = 'https://burillab.com'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function expectApiHeaders(response, origin = ORIGIN) {
  assert.equal(response.headers.get('content-type')?.split(';')[0], 'application/json')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=86400')
  assert.match(response.headers.get('x-request-id') || '', UUID)
  assert.equal(response.headers.get('access-control-allow-origin'), origin)
  assert.match(response.headers.get('vary') || '', /(?:^|,\s*)Origin(?:,|$)/i)
}

async function postInChunks(url, chunks, {
  finish = true, finishAfterMs, headers = {}, timeoutMs = 15_000, label = 'chunked-body',
} = {}) {
  // Genuine chunked HTTP, not a Request mock: there is no Content-Length.
  return new Promise((resolve, reject) => {
    let finishTimer
    const request = httpRequest(url, { method: 'POST', headers: {
      Origin: ORIGIN, 'Content-Type': 'application/json', ...headers,
    } }, (response) => {
      const data = []
      response.on('data', (chunk) => data.push(chunk))
      response.on('error', reject)
      response.on('end', () => {
        clearTimeout(finishTimer)
        request.destroy()
        resolve(new Response(Buffer.concat(data), { status: response.statusCode, headers: response.headers }))
      })
    })
    request.on('error', (error) => { clearTimeout(finishTimer); reject(error) })
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`Local ${label} test timed out.`)))
    request.flushHeaders()
    for (const chunk of chunks) request.write(chunk)
    if (finish) request.end()
    else if (finishAfterMs !== undefined) finishTimer = setTimeout(() => request.end(), finishAfterMs)
  })
}

export async function verifyPagesBoundaryRuntime(runtime) {
  let checks = 0
  const fetchApi = (pathname, init = {}) => fetch(`${runtime.origin}${pathname}`, {
    ...init, headers: { Origin: ORIGIN, ...init.headers }, redirect: 'error', signal: AbortSignal.timeout(15_000),
  })
  const assertError = async (response, status, code, corsOrigin = ORIGIN) => {
    assert.equal(response.status, status, `Unexpected status from ${response.url ? new URL(response.url).pathname : 'chunked local request'}`)
    expectApiHeaders(response, corsOrigin)
    const body = await response.json()
    assert.equal(typeof body.error, 'string')
    if (code) assert.equal(body.code, code)
    checks += 1
    return body
  }

  for (const pathname of ['/api/not-present', '/api/admin/not-present', '/api/voice/not-present', '/api']) {
    // Unknown API routes must not return the SPA document, including the API root.
    await assertError(await fetchApi(pathname), 404, 'API_NOT_FOUND')
  }
  for (const pathname of ['/api/ai/classify', '/api/gemini/classify', '/api/voice/query', '/api/admin/feedback/list']) {
    const response = await fetchApi(pathname)
    await assertError(response, 405, 'METHOD_NOT_ALLOWED')
    assert.equal(response.headers.get('allow'), 'POST, OPTIONS')
  }
  const protectedRoutes = [
    '/api/ai/scan-label', '/api/ai/classify', '/api/ai/disposal-guide',
    '/api/gemini/scan-label', '/api/gemini/classify', '/api/gemini/disposal-guide',
    '/api/voice/query', '/api/voice/transcribe', '/api/voice/speak',
    '/api/account/delete', '/api/admin/feedback/list',
  ]
  for (const pathname of protectedRoutes) {
    await assertError(await fetchApi(pathname, { method: 'POST', body: '{}' }), 401, 'AUTH_REQUIRED')
  }
  for (const origin of ['http://localhost:4173', 'https://other.pages.dev', 'https://www.burillab.com', 'null']) {
    await assertError(await fetchApi('/api/voice/query', {
      method: 'POST', headers: { Origin: origin }, body: '{}',
    }), 403, 'ORIGIN_NOT_ALLOWED', null)
  }
  for (const origin of [ORIGIN, 'https://app.buril-lab.local', 'capacitor://app.buril-lab.local']) {
    const response = await fetchApi('/api/voice/query', { method: 'OPTIONS', headers: { Origin: origin } })
    assert.equal(response.status, 204)
    assert.equal(await response.text(), '')
    assert.equal(response.headers.get('access-control-allow-origin'), origin)
    assert.equal(response.headers.get('access-control-allow-methods'), 'POST, OPTIONS')
    assert.match(response.headers.get('x-request-id') || '', UUID)
    checks += 1
  }
  await assertError(await fetchApi('/api/voice/query', {
    method: 'POST', headers: { Origin: 'capacitor://app.buril-lab.local' }, body: '{}',
  }), 401, 'AUTH_REQUIRED', 'capacitor://app.buril-lab.local')

  const authorization = await runtime.syntheticAuthorization()
  for (const pathname of ['/api/ai/classify', '/api/voice/query', '/api/admin/feedback/list']) {
    const response = await fetchApi(pathname, { method: 'POST', headers: authorization, body: '{}' })
    await assertError(response, 503, 'RATE_LIMIT_UNAVAILABLE')
    assert.equal(response.headers.get('retry-after'), '60')
  }
  await assertError(await fetchApi('/api/voice/query', {
    method: 'POST', headers: await runtime.syntheticAuthorization({ subject: 'not-a-uuid' }), body: '{}',
  }), 401, 'INVALID_AUTH_TOKEN')
  await assertError(await fetchApi('/api/voice/query', {
    method: 'POST', headers: { Authorization: 'Bearer not-a-token' }, body: '{}',
  }), 401, 'INVALID_AUTH_TOKEN')

  const analyticsPath = '/api/analytics/search-event'
  const malformed = await fetchApi(analyticsPath, { method: 'POST', body: '{"private-fixture-marker"' })
  const malformedBody = await assertError(malformed, 400)
  assert.equal(malformedBody.error, 'A valid JSON body is required.')
  assert.ok(!JSON.stringify(malformedBody).includes('private-fixture-marker'))
  const chunked = await postInChunks(`${runtime.origin}${analyticsPath}`, ['{', '"eventId"', ':"invalid"', '}'])
  const chunkedBody = await assertError(chunked, 400)
  assert.equal(chunkedBody.error, 'eventId and sessionId must be UUIDs.')
  // Correct downstream field validation proves next(new Request(...)) received
  // the original JSON body rather than a consumed, replaced, or missing stream.
  const oversized = await postInChunks(`${runtime.origin}${analyticsPath}`, ['x'.repeat(16_384), 'y'.repeat(16_385)])
  await assertError(oversized, 413, 'REQUEST_TOO_LARGE')

  // The local Node -> workerd HTTP bridge may hold a response until the upload
  // ends. End the one-byte stream after the application deadline, then require
  // 408 rather than a late JSON parse/400. Unit tests separately prove rejection
  // before reader acquisition and cleanup that cannot extend the deadline.
  const slowBody = await postInChunks(`${runtime.origin}${analyticsPath}`, ['{'], {
    finish: false, finishAfterMs: 11_000, label: 'slow-body',
  })
  await assertError(slowBody, 408, 'REQUEST_BODY_TIMEOUT')

  const login = await fetch(`${runtime.origin}/login`, { redirect: 'error', signal: AbortSignal.timeout(5_000) })
  assert.equal(login.status, 200)
  assert.match(login.headers.get('content-type') || '', /text\/html/)
  assert.match(login.headers.get('content-security-policy') || '', /object-src 'none'/)
  assert.equal(login.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(login.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(login.headers.get('permissions-policy'), 'camera=(self), microphone=(self), geolocation=()')
  assert.equal(login.headers.get('strict-transport-security'), null)
  await login.body?.cancel()
  checks += 1
  return { checks, result: 'local-pages-boundary-ok', remoteBindings: 0, providerCredentials: 0 }
}

async function main() {
  const runtime = await startPagesBoundaryLocal()
  try {
    console.log(JSON.stringify(await verifyPagesBoundaryRuntime(runtime)))
  } finally {
    await runtime.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Pages runtime boundary verification failed.')
    process.exitCode = 1
  })
}
