import { json } from '../_shared/json'
import type { RuntimeConfigEnv } from '../_runtimeConfig'
import { getRequestUserId } from '../ai/_openai'
import { AGENT_SCHEMA_VERSION, type AgentModeResponse } from '../../../src/features/agent/agentContract'
import { resolveAgentModeConfig, type AgentModeConfig } from './_config'

interface AgentModeContext {
  request: Request
  env: RuntimeConfigEnv
  data?: Record<string, unknown>
}

export interface AgentModeDependencies {
  resolveConfig: (env: RuntimeConfigEnv) => Promise<AgentModeConfig>
}

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * Says whether proposals to record something are switched on.
 *
 * Requests about waste never reach the planner, so the app decides them by
 * fixed rules without sending their text anywhere. It still has to know the
 * runtime switch before it offers a waste container pickup request, and this
 * is how it asks: no request text comes in, and nothing is read or written.
 */
export function createAgentModeHandler(overrides: Partial<AgentModeDependencies> = {}) {
  const dependencies: AgentModeDependencies = { resolveConfig: resolveAgentModeConfig, ...overrides }

  return async (context: AgentModeContext): Promise<Response> => {
    if (!getRequestUserId(context.data)) {
      return json({ error: 'Authentication is required.', code: 'AUTH_REQUIRED' }, { status: 401, headers: NO_STORE })
    }
    const { mode } = await dependencies.resolveConfig(context.env)
    const body: AgentModeResponse = { schemaVersion: AGENT_SCHEMA_VERSION, mode }
    return json(body, { headers: NO_STORE })
  }
}

export const onRequestPost = createAgentModeHandler()
