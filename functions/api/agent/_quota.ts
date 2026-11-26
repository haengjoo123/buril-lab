import { Redis } from '@upstash/redis/cloudflare'
import { Ratelimit } from '@upstash/ratelimit'

export interface AgentQuotaEnv {
  UPSTASH_REDIS_REST_URL?: string
  UPSTASH_REDIS_REST_TOKEN?: string
}

export interface AgentQuotaResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

/**
 * Counts one planner call against the person's daily allowance.
 *
 * Throws when the limiter is not configured or does not answer. The caller
 * must then refuse the request: an unmetered model call is never acceptable.
 */
export async function consumeAgentDailyQuota(
  env: AgentQuotaEnv,
  userId: string,
  dailyQuota: number,
): Promise<AgentQuotaResult> {
  const url = env.UPSTASH_REDIS_REST_URL?.trim()
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) throw new Error('Agent quota limiting is not configured.')

  const ratelimit = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.fixedWindow(dailyQuota, '1 d'),
    prefix: '@upstash/ratelimit/AGENT_DAILY',
    timeout: 3_000,
    analytics: false,
  })
  const result = await ratelimit.limit(userId)
  // Upstash reports its own timeout as success, not as a rejected promise.
  if (result.reason === 'timeout') throw new Error('Agent quota limiter timed out.')

  return {
    allowed: result.success,
    remaining: Math.max(0, result.remaining),
    retryAfterSeconds: Math.max(1, Math.ceil((result.reset - Date.now()) / 1_000)),
  }
}
