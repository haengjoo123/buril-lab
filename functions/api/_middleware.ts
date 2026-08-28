import { Redis } from '@upstash/redis/cloudflare'
import { Ratelimit } from '@upstash/ratelimit'
import * as jose from 'jose'

interface Env {
  UPSTASH_REDIS_REST_URL: string
  UPSTASH_REDIS_REST_TOKEN: string
  SUPABASE_JWT_SECRET?: string
  SUPABASE_URL?: string
  VITE_SUPABASE_URL?: string
}

type PagesFunction<E = Env> = (context: {
  request: Request
  env: E
  next: () => Promise<Response>
  params: Record<string, string | string[]>
  data: Record<string, unknown>
}) => Response | Promise<Response>

const ALLOWED_CORS_ORIGINS = [
  'https://app.buril-lab.local',
  'https://localhost',
  'http://localhost',
  'http://127.0.0.1',
] as const

function isAllowedCorsOrigin(origin: string | null): origin is string {
  if (!origin) return false

  if (ALLOWED_CORS_ORIGINS.includes(origin as typeof ALLOWED_CORS_ORIGINS[number])) {
    return true
  }

  return (
    /^https:\/\/(?:[a-z0-9-]+\.)?buril-lab\.pages\.dev$/i.test(origin) ||
    /^https?:\/\/localhost:\d+$/i.test(origin) ||
    /^https?:\/\/127\.0\.0\.1:\d+$/i.test(origin)
  )
}

function getCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('Origin')

  if (!isAllowedCorsOrigin(origin)) {
    return { Vary: 'Origin' }
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Buril-Guest-Subject',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function withCors(response: Response, request: Request): Response {
  const headers = getCorsHeaders(request)

  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value)
  }

  return response
}

const supabaseJwksCache = new Map<string, ReturnType<typeof jose.createRemoteJWKSet>>()

/**
 * Rate limit categories and their configurations
 */
const LIMIT_CONFIGS = {
  VOICE: {
    user: { count: 30, window: "1 m" },
    ip: { count: 1, window: "1 m" },
    pattern: /^\/api\/voice\//,
  },
  AI: {
    user: { count: 10, window: "1 m" },
    ip: { count: 5, window: "1 m" },
    pattern: /^\/api\/(?:ai|gemini)\//,
  },
  KOSHA: {
    user: { count: 30, window: "1 m" },
    ip: { count: 5, window: "1 m" },
    pattern: /^\/api\/kosha/,
  },
  CHEMICALS: {
    user: { count: 30, window: "1 m" },
    ip: { count: 8, window: "1 m" },
    pattern: /^\/api\/chemicals\//,
  },
  CHEMICAL_SUGGEST: {
    user: { count: 60, window: "1 m" },
    ip: { count: 20, window: "1 m" },
    pattern: /^\/api\/chemicals\/suggest(?:\/|$)/,
  },
  REAGENTS: {
    user: { count: 20, window: "1 m" },
    ip: { count: 5, window: "1 m" },
    pattern: /^\/api\/reagents\//,
  },
  WASTE: {
    user: { count: 30, window: "1 m" },
    ip: { count: 2, window: "1 m" },
    pattern: /^\/api\/waste\//,
  },
  ANALYTICS: {
    user: { count: 120, window: "1 m" },
    ip: { count: 120, window: "1 m" },
    pattern: /^\/api\/analytics\//,
  },
} as const

const PROTECTED_API_PATTERNS = [
  /^\/api\/account\//,
  /^\/api\/ai\//,
  /^\/api\/gemini\//,
  /^\/api\/voice\//,
  /^\/api\/reagents\//,
  /^\/api\/waste\//,
] as const

export function isProtectedApiPath(path: string): boolean {
  return PROTECTED_API_PATTERNS.some((pattern) => pattern.test(path))
}

export function resolveRateLimitCategory(path: string): keyof typeof LIMIT_CONFIGS | null {
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

function resolveSupabaseUrl(env: Env): string | null {
  return env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim() || null
}

function getSupabaseJwks(env: Env) {
  const supabaseUrl = resolveSupabaseUrl(env)
  if (!supabaseUrl) return null

  if (!supabaseJwksCache.has(supabaseUrl)) {
    supabaseJwksCache.set(
      supabaseUrl,
      jose.createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)),
    )
  }

  return supabaseJwksCache.get(supabaseUrl) || null
}

async function verifySupabaseToken(token: string, env: Env) {
  const { alg } = jose.decodeProtectedHeader(token)

  if (alg?.startsWith('HS') && env.SUPABASE_JWT_SECRET) {
    const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET)
    const { payload } = await jose.jwtVerify(token, secret)
    return payload
  }

  const jwks = getSupabaseJwks(env)
  if (jwks) {
    const { payload } = await jose.jwtVerify(token, jwks)
    return payload
  }

  if (env.SUPABASE_JWT_SECRET) {
    const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET)
    const { payload } = await jose.jwtVerify(token, secret)
    return payload
  }

  throw new Error('Supabase JWT verification is not configured.')
}

/**
 * Middleware for all /api/* routes
 */
export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, next } = context
  const url = new URL(request.url)
  const path = url.pathname

  // Rate Limiting ONLY for /api routes
  if (!path.startsWith('/api/')) {
    return next()
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request),
    })
  }

  // 1. Identify User or IP
  let identifier: string = request.headers.get('cf-connecting-ip') || 'anonymous'
  let isUser = false
  let userId = ''
  let authVerificationFailed = false

  const authHeader = request.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7)
    try {
      const payload = await verifySupabaseToken(token, env)
      
      if (payload.sub) {
        userId = payload.sub
        identifier = userId
        isUser = true
        context.data.userId = userId
      }
    } catch (err) {
      console.error('JWT Verification failed:', err)
      authVerificationFailed = true
    }
  }

  // Submitted-search analytics never uses an IP address as its durable or
  // rate-limit identifier. Signed-out clients send the random guest subject
  // kept on that device; malformed/missing values share a low-trust bucket.
  if (!isUser && LIMIT_CONFIGS.ANALYTICS.pattern.test(path)) {
    const guestSubject = request.headers.get('X-Buril-Guest-Subject')
    identifier = guestSubject && /^[0-9a-f-]{36}$/i.test(guestSubject)
      ? `guest:${guestSubject}`
      : 'analytics-guest-unidentified'
  }

  if (isProtectedApiPath(path) && !isUser) {
    return withCors(
      new Response(JSON.stringify({
        error: authVerificationFailed ? 'Invalid authentication token.' : 'Authentication is required.',
      }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
      }),
      request,
    )
  }

  // 2. Resolve Rate Limit Category
  const category = resolveRateLimitCategory(path)

  // If no category matches, we still apply a global safety limit
  const limitConfig = category 
    ? (isUser ? LIMIT_CONFIGS[category].user : LIMIT_CONFIGS[category].ip)
    : { count: 50, window: "1 m" as const }

  // 3. Apply Rate Limit using Upstash
  try {
    const redis = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    })

    const ratelimit = new Ratelimit({
      redis: redis,
      limiter: Ratelimit.slidingWindow(limitConfig.count, limitConfig.window),
      prefix: `@upstash/ratelimit/${category || 'GLOBAL'}`,
      analytics: true,
    })

    const { success, limit, remaining, reset } = await ratelimit.limit(identifier)

    if (!success) {
      return withCors(
        new Response(JSON.stringify({ 
          error: 'Too many requests. Please try again later.',
          retryAt: new Date(reset).toISOString()
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': reset.toString(),
          }
        }),
        request,
      )
    }

    // 4. Proceed to the actual function
    const response = await next()

    // Add rate limit headers to the success response as well
    response.headers.set('X-RateLimit-Limit', limit.toString())
    response.headers.set('X-RateLimit-Remaining', remaining.toString())
    response.headers.set('X-RateLimit-Reset', reset.toString())

    return withCors(response, request)
  } catch (err) {
    console.error('Rate Limiting Error:', err)
    // If Redis is down, we allow the request to pass (fail open)
    const response = await next()
    return withCors(response, request)
  }
}
