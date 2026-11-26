import { z } from 'zod'
import type { RuntimeConfigEnv } from '../_runtimeConfig'
import type { AgentMode } from '../../../src/features/agent/agentContract'

/**
 * Runtime switch for the search-bar agent mode.
 *
 * It lives under its own KV key. The shared `runtime_config` envelope needs an
 * exact field set and falls back to its safe profile when one is missing, so
 * it must not be extended for this.
 *
 * A missing, malformed or expired value means off.
 */
export const AGENT_MODE_CONFIG_KEY = 'agent_mode_config'
export const AGENT_MAX_DAILY_QUOTA = 1_000

export interface AgentModeConfig {
  mode: 'off' | AgentMode
  /** Planner calls one person may make per day. */
  dailyQuota: number
}

export const AGENT_MODE_OFF: Readonly<AgentModeConfig> = Object.freeze({ mode: 'off', dailyQuota: 0 })

const configSchema = z.object({
  mode: z.enum(['off', 'read_only', 'actions']),
  dailyQuota: z.number().int().min(1).max(AGENT_MAX_DAILY_QUOTA),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
}).strict()

export async function resolveAgentModeConfig(env: RuntimeConfigEnv): Promise<AgentModeConfig> {
  try {
    const parsed = configSchema.safeParse(await env.BURILLAB_RUNTIME_CONFIG?.get(AGENT_MODE_CONFIG_KEY, 'json'))
    if (!parsed.success) return { ...AGENT_MODE_OFF }
    const { mode, dailyQuota, expiresAt } = parsed.data
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) return { ...AGENT_MODE_OFF }
    return { mode, dailyQuota }
  } catch {
    console.error(JSON.stringify({ event: 'agent_mode_config_unavailable' }))
    return { ...AGENT_MODE_OFF }
  }
}
