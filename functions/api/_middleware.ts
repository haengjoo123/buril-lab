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

const supabaseJwksCache = new Map<string, ReturnType<typeof jose.createRemoteJWKSet>>()

/**
 * Rate limit categories and their configurations
 */
const LIMIT_CONFIGS = {
  VISION: {
    user: { count: 5, window: "1 m" },
    ip: { count: 1, window: "1 m" },
    pattern: /^\/api\/vision\//,
  },
  VOICE: {
    user: { count: 30, window: "1 m" },
    ip: { count: 1, window: "1 m" },
    pattern: /^\/api\/voice\//,
  },
  AI: {
    user: { count: 10, window: "1 m" },
    ip: { count: 5, window: "1 m" },
    pattern: /^\/api\/gemini\//,
  },
  KOSHA: {
    user: { count: 30, window: "1 m" },
    ip: { count: 5, window: "1 m" },
    pattern: /^\/api\/kosha/,
  },
} as const

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

  // 1. Identify User or IP
  let identifier: string = request.headers.get('cf-connecting-ip') || 'anonymous'
  let isUser = false
  let userId = ''

  const authHeader = request.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7)
    try {
      const payload = await verifySupabaseToken(token, env)
      
      if (payload.sub) {
        userId = payload.sub
        identifier = userId
        isUser = true
      }
    } catch (err) {
      console.error('JWT Verification failed:', err)
      // Invalid token - fall back to IP-based limiting but maybe stricter?
      // For now, we allow the request to proceed with IP-based ID
    }
  }

  // 2. Resolve Rate Limit Category
  let category: keyof typeof LIMIT_CONFIGS | null = null
  if (LIMIT_CONFIGS.VISION.pattern.test(path)) category = 'VISION'
  else if (LIMIT_CONFIGS.VOICE.pattern.test(path)) category = 'VOICE'
  else if (LIMIT_CONFIGS.AI.pattern.test(path)) category = 'AI'
  else if (LIMIT_CONFIGS.KOSHA.pattern.test(path)) category = 'KOSHA'

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
      return new Response(JSON.stringify({ 
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
      })
    }

    // 4. Proceed to the actual function
    const response = await next()

    // Add rate limit headers to the success response as well
    response.headers.set('X-RateLimit-Limit', limit.toString())
    response.headers.set('X-RateLimit-Remaining', remaining.toString())
    response.headers.set('X-RateLimit-Reset', reset.toString())

    return response
  } catch (err) {
    console.error('Rate Limiting Error:', err)
    // If Redis is down, we allow the request to pass (fail open)
    return next()
  }
}
