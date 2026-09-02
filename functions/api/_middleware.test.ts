import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createApiMiddleware,
  isAllowedCorsOrigin,
  isProtectedApiPath,
  resolveRateLimitCategory,
} from './_middleware'
import { getApiRequestBodyLimit, resolveApiRoutePolicy } from './_routePolicy'

describe('AI route middleware contract', () => {
  it('protects both new and Android 1.0.4 compatibility routes', () => {
    expect(isProtectedApiPath('/api/ai/classify')).toBe(true)
    expect(isProtectedApiPath('/api/gemini/classify')).toBe(true)
    expect(isProtectedApiPath('/api/voice/query')).toBe(true)
  })

  it('shares the same 10-per-minute AI bucket across new and legacy routes', () => {
    expect(resolveRateLimitCategory('/api/ai/scan-label')).toBe('AI')
    expect(resolveRateLimitCategory('/api/gemini/scan-label')).toBe('AI')
    expect(resolveRateLimitCategory('/api/ai/disposal-guide')).toBe(
      resolveRateLimitCategory('/api/gemini/disposal-guide'),
    )
  })

  it('does not retain a deleted Google Vision route category', () => {
    expect(resolveRateLimitCategory('/api/vision/ocr')).toBeNull()
    expect(isProtectedApiPath('/api/vision/ocr')).toBe(false)
  })
})

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const production = { APP_ENVIRONMENT: 'production' }

function setup(path = '/api/chemicals/suggest', method = 'GET', headers: HeadersInit = {}) {
  const next = vi.fn().mockResolvedValue(Response.json({ ok: true }))
  const applyRateLimit = vi.fn().mockResolvedValue({
    success: true, limit: 10, remaining: 9, reset: Date.now() + 60_000,
  })
  const verifyToken = vi.fn().mockResolvedValue({ sub: USER_ID })
  const context = {
    request: new Request(`https://burillab.com${path}`, { method, headers }),
    env: production,
    next,
    params: {},
    data: {} as Record<string, unknown>,
  }
  return { context, next, applyRateLimit, verifyToken, handler: createApiMiddleware({ applyRateLimit, verifyToken }) }
}

describe('environment-specific API CORS', () => {
  it.each(['https://burillab.com', 'https://app.buril-lab.local', 'capacitor://app.buril-lab.local'])('allows the production origin %s', (origin) => {
    expect(isAllowedCorsOrigin(origin, production)).toBe(true)
  })

  it.each([
    'https://localhost', 'http://localhost:5173', 'http://127.0.0.1:8788',
    'https://buril-lab.pages.dev', 'https://d2898282.buril-lab.pages.dev',
    'https://staging.burillab.com', 'https://buril-lab-staging.pages.dev',
    'https://attacker.pages.dev', 'https://burillab.com.evil.test',
    'https://burillab.com:8443', 'https://burillab.com/', 'null', null,
    'capacitor://localhost', 'capacitor://app.buril-lab.local.evil.test',
    'capacitor://app.buril-lab.local/', 'http://app.buril-lab.local',
  ])('rejects %s in production', (origin) => {
    expect(isAllowedCorsOrigin(origin, production)).toBe(false)
  })

  it('isolates Staging and makes local origins opt-in to local development', () => {
    const staging = { APP_ENVIRONMENT: 'staging' }
    expect(isAllowedCorsOrigin('https://staging.burillab.com', staging)).toBe(true)
    expect(isAllowedCorsOrigin('https://123e4567.buril-lab-staging.pages.dev', staging)).toBe(true)
    expect(isAllowedCorsOrigin('capacitor://app.buril-lab.local', staging)).toBe(true)
    expect(isAllowedCorsOrigin('https://feature.buril-lab-staging.pages.dev', staging)).toBe(false)
    expect(isAllowedCorsOrigin('https://burillab.com', staging)).toBe(false)
    expect(isAllowedCorsOrigin('http://localhost:5173', staging)).toBe(false)
    expect(isAllowedCorsOrigin('http://localhost:5173', { APP_ENVIRONMENT: 'development' })).toBe(true)
    expect(isAllowedCorsOrigin('http://localhost:5173', {})).toBe(false)
    expect(isAllowedCorsOrigin('capacitor://app.buril-lab.local', {})).toBe(false)
  })
})

describe('API response boundary', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined) })
  afterEach(() => { vi.restoreAllMocks() })

  it('returns JSON 404 before auth, Redis, or the SPA fallback', async () => {
    const { handler, context, next, applyRateLimit } = setup('/api/missing')
    const response = await handler(context)
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'API_NOT_FOUND' })
    expect(next).not.toHaveBeenCalled()
    expect(applyRateLimit).not.toHaveBeenCalled()
    expect(response.headers.get('X-Request-ID')).toBe(context.data.requestId)
  })

  it('returns JSON 405 with Allow before invoking a method-specific route', async () => {
    const { handler, context, next, applyRateLimit } = setup('/api/voice/query', 'GET')
    const response = await handler(context)
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST, OPTIONS')
    expect(await response.json()).toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
    expect(next).not.toHaveBeenCalled()
    expect(applyRateLimit).not.toHaveBeenCalled()
  })

  it.each(['https://app.buril-lab.local', 'capacitor://app.buril-lab.local'])(
    'answers native preflight for %s without passing it to Redis', async (origin) => {
      const allowed = setup('/api/voice/query', 'OPTIONS', { Origin: origin })
      const response = await allowed.handler(allowed.context)
      expect(response.status).toBe(204)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
      expect(allowed.applyRateLimit).not.toHaveBeenCalled()
      const denied = setup('/api/voice/query', 'OPTIONS', { Origin: 'http://localhost:5173' })
      const rejection = await denied.handler(denied.context)
      expect(rejection.status).toBe(403)
      expect(rejection.headers.has('Access-Control-Allow-Origin')).toBe(false)
      expect(denied.next).not.toHaveBeenCalled()
    },
  )

  it('keeps API security headers on unauthenticated responses', async () => {
    const { handler, context, next } = setup('/api/admin/feedback/list', 'POST')
    const response = await handler(context)
    expect(response.status).toBe(401)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=86400')
    expect(response.headers.get('X-Request-ID')).toMatch(/^[0-9a-f-]{36}$/)
    expect(next).not.toHaveBeenCalled()
  })

  it('does not trust a submitted request ID or a downstream wildcard CORS header', async () => {
    const run = setup('/api/chemicals/suggest', 'GET', { 'X-Request-ID': 'client-controlled' })
    run.next.mockResolvedValue(new Response('{}', { headers: { 'Access-Control-Allow-Origin': '*', Vary: 'Accept-Encoding' } }))
    const response = await run.handler(run.context)
    expect(response.headers.get('X-Request-ID')).not.toBe('client-controlled')
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
    expect(response.headers.get('Vary')).toBe('Accept-Encoding, Origin')
  })

  it('clones immutable response headers before adding rate-limit headers', async () => {
    const run = setup()
    run.next.mockResolvedValue(Response.redirect('https://burillab.com/help'))
    const response = await run.handler(run.context)
    expect(response.status).toBe(302)
    expect(response.headers.get('X-RateLimit-Limit')).toBe('10')
  })

  it.each([
    '/api/admin/feedback/list', '/api/ai/classify', '/api/gemini/scan-label',
    '/api/voice/query', '/api/account/delete', '/api/analytics/guest-delete',
  ])('fails closed on Redis failure for %s', async (path) => {
    const run = setup(path, 'POST', { Authorization: 'Bearer fixture-token' })
    run.applyRateLimit.mockRejectedValue(new Error('redis internal detail token=never-expose'))
    const response = await run.handler(run.context)
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(await response.text()).not.toContain('never-expose')
    expect(run.next).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('never-expose')
  })

  it('treats Upstash success:true timeout as an unavailable limiter', async () => {
    const run = setup('/api/voice/query', 'POST', { Authorization: 'Bearer fixture-token' })
    run.applyRateLimit.mockResolvedValue({ success: true, reason: 'timeout', limit: 0, remaining: 0, reset: 0 })
    const response = await run.handler(run.context)
    expect(response.status).toBe(503)
    expect(run.next).not.toHaveBeenCalled()
  })

  it('retains best-effort non-sensitive search telemetry during a limiter outage', async () => {
    const run = setup('/api/analytics/search-event', 'POST')
    run.applyRateLimit.mockRejectedValue(new Error('offline'))
    expect((await run.handler(run.context)).status).toBe(200)
    expect(run.next).toHaveBeenCalledTimes(1)
  })

  it('uses a separate authenticated admin bucket', async () => {
    const run = setup('/api/admin/feedback/list', 'POST', { Authorization: 'Bearer fixture-token' })
    await run.handler(run.context)
    expect(run.applyRateLimit).toHaveBeenCalledWith(production, 'ADMIN', USER_ID, { count: 20, window: '1 m' })
  })

  it('returns 429 with retry seconds and never runs the handler', async () => {
    const run = setup()
    run.applyRateLimit.mockResolvedValue({ success: false, limit: 10, remaining: 0, reset: Date.now() + 30_000 })
    const response = await run.handler(run.context)
    expect(response.status).toBe(429)
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(await response.json()).toMatchObject({ code: 'RATE_LIMITED' })
    expect(run.next).not.toHaveBeenCalled()
  })

  it('does not retry a failing handler or expose its internal exception', async () => {
    const run = setup()
    run.next.mockRejectedValue(new Error('database password=never-expose'))
    const response = await run.handler(run.context)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'The service is temporarily unavailable.', code: 'INTERNAL_ERROR' })
    expect(run.next).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('never-expose')
  })

  it('rejects a verified token whose subject is not a user UUID', async () => {
    const run = setup('/api/admin/feedback/list', 'POST', { Authorization: 'Bearer fixture-token' })
    run.verifyToken.mockResolvedValue({ sub: 'not-a-user-uuid' })
    expect((await run.handler(run.context)).status).toBe(401)
    expect(run.next).not.toHaveBeenCalled()
  })

  it.each([
    '/api/ai/scan-label', '/api/gemini/scan-label', '/api/voice/transcribe',
    '/api/voice/query', '/api/voice/speak', '/api/admin/analytics/export',
    '/api/analytics/search-event', '/api/chemicals/enrich',
  ])('rejects a declared oversized body for %s before its parser runs', async (path) => {
    const limit = getApiRequestBodyLimit(resolveApiRoutePolicy(path)!)
    const run = setup(path, 'POST', { Authorization: 'Bearer fixture-token' })
    run.context.request = new Request(`https://burillab.com${path}`, {
      method: 'POST', body: '{}',
      headers: { Authorization: 'Bearer fixture-token', 'Content-Length': String(limit + 1) },
    })
    const readerSpy = vi.spyOn(run.context.request.body!, 'getReader')
    const response = await run.handler(run.context)
    expect(response.status).toBe(413)
    expect(response.headers.get('X-Request-ID')).toBe(run.context.data.requestId)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(readerSpy).not.toHaveBeenCalled()
    expect(run.next).not.toHaveBeenCalled()
  })

  it('enforces the actual body byte limit when the size header is missing', async () => {
    const run = setup('/api/analytics/search-event', 'POST')
    run.context.request = new Request('https://burillab.com/api/analytics/search-event', {
      method: 'POST', body: 'x'.repeat(32 * 1024 + 1),
    })
    expect((await run.handler(run.context)).status).toBe(413)
    expect(run.next).not.toHaveBeenCalled()
  })

  it('forwards a size-checked body and preserves its JSON and authorization', async () => {
    const run = setup('/api/voice/speak', 'POST', { Authorization: 'Bearer fixture-token' })
    run.context.request = new Request('https://burillab.com/api/voice/speak', {
      method: 'POST', body: JSON.stringify({ text: '한글' }),
      headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' },
    })
    run.next.mockImplementation(async (forwarded: Request) => {
      expect(forwarded.headers.get('Authorization')).toBe('Bearer fixture-token')
      expect(forwarded.headers.get('Content-Type')).toBe('application/json')
      expect(Number(forwarded.headers.get('Content-Length'))).toBe(new TextEncoder().encode('{"text":"한글"}').length)
      return Response.json(await forwarded.json())
    })
    const response = await run.handler(run.context)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ text: '한글' })
    expect(run.next).toHaveBeenCalledOnce()
  })

  it('does not read an unauthenticated paid request body', async () => {
    const run = setup('/api/voice/speak', 'POST')
    run.context.request = new Request('https://burillab.com/api/voice/speak', { method: 'POST', body: '{}' })
    const readerSpy = vi.spyOn(run.context.request.body!, 'getReader')
    expect((await run.handler(run.context)).status).toBe(401)
    expect(readerSpy).not.toHaveBeenCalled()
    expect(run.next).not.toHaveBeenCalled()
  })
})
