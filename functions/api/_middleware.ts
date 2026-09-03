import { Redis } from '@upstash/redis/cloudflare'
import { Ratelimit } from '@upstash/ratelimit'
import * as jose from 'jose'
import { json } from './_shared/json'
import { readLimitedRequestBytes, RequestBodyError, requestBodyErrorResponse } from './_shared/requestBody'
import { getApiRequestBodyLimit, isAllowedApiMethod, resolveApiRoutePolicy, type ApiRoutePolicy } from './_routePolicy'

interface Env {
  UPSTASH_REDIS_REST_URL?: string
  UPSTASH_REDIS_REST_TOKEN?: string
  SUPABASE_JWT_SECRET?: string
  SUPABASE_URL?: string
  VITE_SUPABASE_URL?: string
  APP_ENVIRONMENT?: string
}

type PagesContext<E = Env> = {
  request: Request
  env: E
  next: (request?: Request) => Promise<Response>
  params: Record<string, string | string[]>
  data: Record<string, unknown>
}

type PagesFunction<E = Env> = (context: PagesContext<E>) => Response | Promise<Response>

// capacitor.config.ts fixes the hostname; Android uses https and iOS uses
// Capacitor's default scheme. Never allow arbitrary native or localhost origins.
const NATIVE_APP_ORIGINS = new Set([
  'https://app.buril-lab.local',
  'capacitor://app.buril-lab.local',
])
const LOCAL_ORIGIN_PATTERN = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/
const IMMUTABLE_STAGING_ORIGIN_PATTERN = /^https:\/\/[a-f0-9]{8}\.buril-lab-staging\.pages\.dev$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isProductionEnvironment(env: Env): boolean {
  return env.APP_ENVIRONMENT === 'production' || env.APP_ENVIRONMENT === 'production-preview-disabled'
}

export function isAllowedCorsOrigin(origin: string | null, env: Env): origin is string {
  if (!origin) return false
  if (isProductionEnvironment(env)) {
    return origin === 'https://burillab.com' || NATIVE_APP_ORIGINS.has(origin)
  }
  if (env.APP_ENVIRONMENT === 'staging') {
    return origin === 'https://staging.burillab.com'
      || origin === 'https://buril-lab-staging.pages.dev'
      || NATIVE_APP_ORIGINS.has(origin)
      || IMMUTABLE_STAGING_ORIGIN_PATTERN.test(origin)
  }
  if (env.APP_ENVIRONMENT === 'development' || env.APP_ENVIRONMENT === 'local') {
    return NATIVE_APP_ORIGINS.has(origin) || LOCAL_ORIGIN_PATTERN.test(origin)
  }
  // A missing or unrecognized environment cannot expand cross-origin access.
  return false
}

function mergeVary(current: string | null, value: string): string {
  const values = (current || '').split(',').map((entry) => entry.trim()).filter(Boolean)
  if (!values.some((entry) => entry.toLowerCase() === value.toLowerCase())) values.push(value)
  return values.join(', ')
}

const SENSITIVE_API_PATTERNS = [
  /^\/api\/account\//,
  /^\/api\/cabinets\//,
  /^\/api\/labs\//,
  /^\/api\/admin\//,
  /^\/api\/(?:ai|gemini)\//,
  /^\/api\/voice\//,
  /^\/api\/analytics\/(?:guest-delete|user-delete)\/?$/,
] as const

export function isSensitiveApiPath(path: string): boolean {
  return SENSITIVE_API_PATTERNS.some((pattern) => pattern.test(path))
}

function withResponseHeaders(
  response: Response,
  request: Request,
  env: Env,
  policy: ApiRoutePolicy,
  requestId: string,
): Response {
  const headers = new Headers(response.headers)
  const origin = request.headers.get('Origin')
  // A downstream handler must not override this environment's CORS boundary.
  for (const name of [
    'Access-Control-Allow-Origin', 'Access-Control-Allow-Credentials',
    'Access-Control-Allow-Methods', 'Access-Control-Allow-Headers',
    'Access-Control-Expose-Headers', 'Access-Control-Max-Age',
  ]) headers.delete(name)
  headers.set('Vary', mergeVary(headers.get('Vary'), 'Origin'))
  if (isAllowedCorsOrigin(origin, env)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Methods', [...policy.methods, 'OPTIONS'].join(', '))
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Buril-Guest-Subject')
    headers.set('Access-Control-Expose-Headers', 'X-Request-ID, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset')
    headers.set('Access-Control-Max-Age', '86400')
  }
  headers.set('X-Request-ID', requestId)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('X-Frame-Options', 'DENY')
  if (isProductionEnvironment(env)) headers.set('Strict-Transport-Security', 'max-age=86400')
  if (request.method !== 'GET' || isSensitiveApiPath(new URL(request.url).pathname) || response.status >= 400) {
    headers.set('Cache-Control', 'no-store')
  }
  // Clone headers so upstream Responses with immutable headers are also safe.
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

const supabaseJwksCache = new Map<string, ReturnType<typeof jose.createRemoteJWKSet>>()

const LIMIT_CONFIGS = {
  LABS: {
    user: { count: 30, window: '1 m' },
    ip: { count: 2, window: '1 m' },
    pattern: /^\/api\/labs\//,
  },
  CABINETS: {
    user: { count: 60, window: '1 m' },
    ip: { count: 2, window: '1 m' },
    pattern: /^\/api\/cabinets\//,
  },
  ADMIN: {
    user: { count: 20, window: '1 m' },
    ip: { count: 2, window: '1 m' },
    pattern: /^\/api\/admin\//,
  },
  VOICE: {
    user: { count: 30, window: '1 m' },
    ip: { count: 1, window: '1 m' },
    pattern: /^\/api\/voice\//,
  },
  AI: {
    user: { count: 10, window: '1 m' },
    ip: { count: 5, window: '1 m' },
    pattern: /^\/api\/(?:ai|gemini)\//,
  },
  KOSHA: {
    user: { count: 30, window: '1 m' },
    ip: { count: 5, window: '1 m' },
    pattern: /^\/api\/kosha/,
  },
  CHEMICALS: {
    user: { count: 30, window: '1 m' },
    ip: { count: 8, window: '1 m' },
    pattern: /^\/api\/chemicals\//,
  },
  CHEMICAL_SUGGEST: {
    user: { count: 60, window: '1 m' },
    ip: { count: 20, window: '1 m' },
    pattern: /^\/api\/chemicals\/suggest(?:\/|$)/,
  },
  REAGENTS: {
    user: { count: 20, window: '1 m' },
    ip: { count: 5, window: '1 m' },
    pattern: /^\/api\/reagents\//,
  },
  WASTE: {
    user: { count: 30, window: '1 m' },
    ip: { count: 2, window: '1 m' },
    pattern: /^\/api\/waste\//,
  },
  ANALYTICS: {
    user: { count: 120, window: '1 m' },
    ip: { count: 120, window: '1 m' },
    pattern: /^\/api\/analytics\//,
  },
} as const

type RateLimitCategory = keyof typeof LIMIT_CONFIGS
type RateLimitConfig = { count: number; window: '1 m' }
type RateLimitResult = {
  success: boolean
  limit: number
  remaining: number
  reset: number
  reason?: string
}

const PROTECTED_API_PATTERNS = [
  /^\/api\/account\//,
  /^\/api\/cabinets\//,
  /^\/api\/labs\//,
  /^\/api\/admin\//,
  /^\/api\/ai\//,
  /^\/api\/gemini\//,
  /^\/api\/voice\//,
  /^\/api\/reagents\//,
  /^\/api\/waste\//,
] as const

export function isProtectedApiPath(path: string): boolean {
  return PROTECTED_API_PATTERNS.some((pattern) => pattern.test(path))
}

export function resolveRateLimitCategory(path: string): RateLimitCategory | null {
  if (LIMIT_CONFIGS.CABINETS.pattern.test(path)) return 'CABINETS'
  if (LIMIT_CONFIGS.LABS.pattern.test(path)) return 'LABS'
  if (LIMIT_CONFIGS.ADMIN.pattern.test(path)) return 'ADMIN'
  if (LIMIT_CONFIGS.VOICE.pattern.test(path)) return 'VOICE'
  if (LIMIT_CONFIGS.AI.pattern.test(path)) return 'AI'
  if (LIMIT_CONFIGS.KOSHA.pattern.test(path)) return 'KOSHA'
  if (LIMIT_CONFIGS.CHEMICAL_SUGGEST.pattern.test(path)) return 'CHEMICAL_SUGGEST'
  if (LIMIT_CONFIGS.CHEMICALS.pattern.test(path)) return 'CHEMICALS'
  if (LIMIT_CONFIGS.REAGENTS.pattern.test(path)) return 'REAGENTS'
  if (LIMIT_CONFIGS.WASTE.pattern.test(path)) return 'WASTE'
  if (LIMIT_CONFIGS.ANALYTICS.pattern.test(path)) return 'ANALYTICS'
  return null
}

export function shouldFailClosedOnRateLimitError(path: string, category: RateLimitCategory | null): boolean {
  return isProtectedApiPath(path) || isSensitiveApiPath(path)
    || (category !== null && category !== 'ANALYTICS')
}

function getSupabaseJwks(env: Env) {
  const supabaseUrl = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim()
  if (!supabaseUrl) return null
  if (!supabaseJwksCache.has(supabaseUrl)) {
    supabaseJwksCache.set(supabaseUrl, jose.createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)))
  }
  return supabaseJwksCache.get(supabaseUrl) || null
}

async function verifySupabaseToken(token: string, env: Env) {
  const { alg } = jose.decodeProtectedHeader(token)
  if (alg?.startsWith('HS') && env.SUPABASE_JWT_SECRET) {
    const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(env.SUPABASE_JWT_SECRET))
    return payload
  }
  const jwks = getSupabaseJwks(env)
  if (jwks) {
    const { payload } = await jose.jwtVerify(token, jwks)
    return payload
  }
  if (env.SUPABASE_JWT_SECRET) {
    const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(env.SUPABASE_JWT_SECRET))
    return payload
  }
  throw new Error('Supabase JWT verification is not configured.')
}

async function applyUpstashRateLimit(
  env: Env,
  category: RateLimitCategory | null,
  identifier: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const url = env.UPSTASH_REDIS_REST_URL?.trim()
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) throw new Error('Rate limiting is not configured.')
  const ratelimit = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(config.count, config.window),
    prefix: `@upstash/ratelimit/${category || 'GLOBAL'}`,
    timeout: 3_000,
    analytics: false,
  })
  return ratelimit.limit(identifier)
}

interface MiddlewareDependencies {
  verifyToken?: typeof verifySupabaseToken
  applyRateLimit?: typeof applyUpstashRateLimit
}

function safeLog(event: string, fields: Record<string, string | null>): void {
  // Do not log JWTs, IP addresses, user identifiers, or raw provider errors.
  console.error(JSON.stringify({ event, ...fields }))
}

export function createApiMiddleware(dependencies: MiddlewareDependencies = {}): PagesFunction<Env> {
  const verifyToken = dependencies.verifyToken || verifySupabaseToken
  const applyRateLimit = dependencies.applyRateLimit || applyUpstashRateLimit
  return async (context) => {
    const { request, env, next } = context
    const path = new URL(request.url).pathname
    if (path !== '/api' && !path.startsWith('/api/')) return next()

    const requestId = crypto.randomUUID()
    context.data.requestId = requestId
    const policy = resolveApiRoutePolicy(path)
    const respond = (response: Response) => withResponseHeaders(
      response, request, env, policy || { id: 'unknown', methods: [] }, requestId,
    )
    if (!policy) {
      return respond(json({ error: 'API route was not found.', code: 'API_NOT_FOUND' }, { status: 404 }))
    }
    const origin = request.headers.get('Origin')
    if (origin && !isAllowedCorsOrigin(origin, env)) {
      return respond(json({ error: 'This request origin is not allowed.', code: 'ORIGIN_NOT_ALLOWED' }, { status: 403 }))
    }
    if (request.method === 'OPTIONS') return respond(new Response(null, { status: 204 }))
    if (!isAllowedApiMethod(policy, request.method)) {
      return respond(json({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }, {
        status: 405, headers: { Allow: [...policy.methods, 'OPTIONS'].join(', ') },
      }))
    }

    let identifier = request.headers.get('cf-connecting-ip') || 'anonymous'
    let isUser = false
    let authVerificationFailed = false
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = await verifyToken(authHeader.substring(7), env)
        if (payload.sub && UUID_PATTERN.test(payload.sub)) {
          identifier = payload.sub
          isUser = true
          context.data.userId = payload.sub
        } else {
          authVerificationFailed = true
        }
      } catch {
        safeLog('api_auth_verification_failed', { requestId, route: policy.id })
        authVerificationFailed = true
      }
    }
    if (!isUser && LIMIT_CONFIGS.ANALYTICS.pattern.test(path)) {
      const guestSubject = request.headers.get('X-Buril-Guest-Subject')
      identifier = guestSubject && UUID_PATTERN.test(guestSubject)
        ? `guest:${guestSubject.toLowerCase()}` : 'analytics-guest-unidentified'
    }
    if (isProtectedApiPath(path) && !isUser) {
      return respond(json({
        error: authVerificationFailed ? 'Invalid authentication token.' : 'Authentication is required.',
        code: authVerificationFailed ? 'INVALID_AUTH_TOKEN' : 'AUTH_REQUIRED',
      }, { status: 401 }))
    }

    const category = resolveRateLimitCategory(path)
    const config: RateLimitConfig = category
      ? (isUser ? LIMIT_CONFIGS[category].user : LIMIT_CONFIGS[category].ip)
      : { count: 50, window: '1 m' }
    let rateLimit: RateLimitResult | null = null
    try {
      rateLimit = await applyRateLimit(env, category, identifier, config)
      // Upstash reports its timeout as success:true, not as a rejected promise.
      // Treat that outcome as an unavailable limiter before any paid/sensitive work.
      if (rateLimit.reason === 'timeout') throw new Error('Rate limiter timed out.')
    } catch {
      rateLimit = null
      safeLog('api_rate_limit_unavailable', { requestId, route: policy.id, category })
      if (shouldFailClosedOnRateLimitError(path, category)) {
        return respond(json({
          error: 'Request limiting is temporarily unavailable.', code: 'RATE_LIMIT_UNAVAILABLE',
        }, { status: 503, headers: { 'Retry-After': '60' } }))
      }
    }
    if (rateLimit && !rateLimit.success) {
      const retryAfterSeconds = Math.max(1, Math.ceil((rateLimit.reset - Date.now()) / 1_000))
      return respond(json({
        error: 'Too many requests. Please try again later.', code: 'RATE_LIMITED', retryAfterSeconds,
      }, { status: 429, headers: {
        'Retry-After': retryAfterSeconds.toString(),
        'X-RateLimit-Limit': rateLimit.limit.toString(),
        'X-RateLimit-Remaining': rateLimit.remaining.toString(),
        'X-RateLimit-Reset': rateLimit.reset.toString(),
      } }))
    }

    let response: Response
    try {
      if (request.method === 'POST') {
        // Auth and rate limiting run first. Downstream JSON/multipart parsers only
        // receive a size-checked body, including when Content-Length was absent.
        const bytes = await readLimitedRequestBytes(request, getApiRequestBodyLimit(policy))
        const headers = new Headers(request.headers)
        headers.delete('Transfer-Encoding')
        headers.set('Content-Length', String(bytes.byteLength))
        response = respond(await next(new Request(request, {
          body: bytes.byteLength ? bytes : null, headers,
        })))
      } else {
        response = respond(await next())
      }
    } catch (error) {
      if (error instanceof RequestBodyError) return respond(requestBodyErrorResponse(error))
      safeLog('api_handler_failed', { requestId, route: policy.id, category })
      return respond(json({ error: 'The service is temporarily unavailable.', code: 'INTERNAL_ERROR' }, { status: 500 }))
    }
    if (rateLimit) {
      response.headers.set('X-RateLimit-Limit', rateLimit.limit.toString())
      response.headers.set('X-RateLimit-Remaining', rateLimit.remaining.toString())
      response.headers.set('X-RateLimit-Reset', rateLimit.reset.toString())
    }
    return response
  }
}

export const onRequest = createApiMiddleware()
