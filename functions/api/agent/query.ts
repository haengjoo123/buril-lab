import { z } from 'zod'
import { json } from '../_shared/json'
import { readLimitedJson, RequestBodyError, requestBodyErrorResponse } from '../_shared/requestBody'
import type { RuntimeConfigEnv } from '../_runtimeConfig'
import {
  createSafetyIdentifier,
  getRequestUserId,
  isOpenAIResponsesConfigured,
  OpenAIResponseRefusal,
  parseOpenAIResponse,
  summarizeOpenAIError,
  type OpenAIResponsesEnv,
} from '../ai/_openai'
import {
  AGENT_MAX_TEXT_LENGTH,
  AGENT_SCHEMA_VERSION,
  type AgentPlan,
  type AgentQueryResponse,
} from '../../../src/features/agent/agentContract'
import { classifyAgentInput, hasDisposalWording } from '../../../src/features/agent/agentGuard'
import { resolveAgentModeConfig, type AgentModeConfig } from './_config'
import {
  AGENT_PLAN_MAX_OUTPUT_TOKENS,
  AGENT_PLAN_MAX_RETRIES,
  AGENT_PLAN_TIMEOUT_MS,
  allowedCapabilities,
  buildPlanInput,
  buildPlanSchema,
  sanitizePlan,
} from './_plan'
import { consumeAgentDailyQuota, type AgentQuotaEnv, type AgentQuotaResult } from './_quota'

export interface AgentQueryEnv extends OpenAIResponsesEnv, RuntimeConfigEnv, AgentQuotaEnv {
  /** Optional model override for the planner; the shared Responses model otherwise. */
  OPENAI_AGENT_MODEL?: string
}

interface AgentQueryContext {
  request: Request
  env: AgentQueryEnv
  data?: Record<string, unknown>
}

export interface AgentQueryDependencies {
  resolveConfig: (env: AgentQueryEnv) => Promise<AgentModeConfig>
  consumeDailyQuota: (env: AgentQueryEnv, userId: string, dailyQuota: number) => Promise<AgentQuotaResult>
}

const BODY_LIMIT_BYTES = 8 * 1024
const NO_STORE = { 'Cache-Control': 'no-store' }

const requestSchema = z.object({
  schemaVersion: z.literal(AGENT_SCHEMA_VERSION),
  text: z.string().trim().min(1).max(AGENT_MAX_TEXT_LENGTH),
  language: z.enum(['ko', 'en']),
  // A newer app may declare capabilities this deployment does not know yet; they are ignored.
  capabilities: z.array(z.string().max(40)).max(40),
})

function respond(plan: AgentPlan, mode: AgentQueryResponse['mode'], quotaRemaining: number | null): Response {
  const body: AgentQueryResponse = { schemaVersion: AGENT_SCHEMA_VERSION, mode, plan, quotaRemaining }
  return json(body, { headers: NO_STORE })
}

function refuse(status: number, code: string, error: string, headers?: Record<string, string>): Response {
  return json({ error, code }, { status, headers: { ...NO_STORE, ...headers } })
}

/**
 * Turns one typed sentence into a plan for the app to run.
 *
 * This handler reads no lab data and writes nothing. The request text never
 * appears in logs, and text about disposal never reaches the model.
 */
export function createAgentQueryHandler(overrides: Partial<AgentQueryDependencies> = {}) {
  const dependencies: AgentQueryDependencies = {
    resolveConfig: resolveAgentModeConfig,
    consumeDailyQuota: consumeAgentDailyQuota,
    ...overrides,
  }

  return async (context: AgentQueryContext): Promise<Response> => {
    const userId = getRequestUserId(context.data)
    if (!userId) return refuse(401, 'AUTH_REQUIRED', 'Authentication is required.')

    let parsed: z.infer<typeof requestSchema>
    try {
      const body = requestSchema.safeParse(await readLimitedJson(context.request, BODY_LIMIT_BYTES))
      if (!body.success) {
        const versionMismatch = body.error.issues.some((issue) => issue.path[0] === 'schemaVersion')
        return versionMismatch
          ? refuse(400, 'AGENT_UPDATE_REQUIRED', 'This app version cannot use agent mode.')
          : refuse(400, 'INVALID_AGENT_REQUEST', 'Agent request fields are invalid.')
      }
      parsed = body.data
    } catch (error) {
      if (error instanceof RequestBodyError) return requestBodyErrorResponse(error)
      throw error
    }

    const config = await dependencies.resolveConfig(context.env)
    if (config.mode === 'off') return refuse(503, 'AGENT_DISABLED', 'Agent mode is not enabled.')
    const mode = config.mode

    // Fixed rules first: neither of these outcomes needs, or may use, a model.
    // hasDisposalWording is a copy of the voice endpoint's disposal rule;
    // agentGuard.test.ts fails if the two ever drift apart.
    if (hasDisposalWording(parsed.text)) {
      console.info(JSON.stringify({ event: 'agent_plan', route: 'guard', kind: 'redirect_disposal' }))
      return respond({ kind: 'redirect_disposal' }, mode, null)
    }
    if (classifyAgentInput(parsed.text) === 'identifier') {
      console.info(JSON.stringify({ event: 'agent_plan', route: 'guard', kind: 'handoff_search' }))
      return respond({ kind: 'handoff_search', query: parsed.text }, mode, null)
    }

    if (!isOpenAIResponsesConfigured(context.env)) {
      return refuse(503, 'AGENT_DISABLED', 'Agent mode is not configured.')
    }

    let quota: AgentQuotaResult
    try {
      quota = await dependencies.consumeDailyQuota(context.env, userId, config.dailyQuota)
    } catch {
      console.error(JSON.stringify({ event: 'agent_quota_unavailable' }))
      return refuse(503, 'RATE_LIMIT_UNAVAILABLE', 'Request limiting is temporarily unavailable.', { 'Retry-After': '60' })
    }
    if (!quota.allowed) {
      return json({
        error: 'The daily agent limit was reached.',
        code: 'AGENT_QUOTA_EXCEEDED',
        retryAfterSeconds: quota.retryAfterSeconds,
      }, { status: 429, headers: { ...NO_STORE, 'Retry-After': String(quota.retryAfterSeconds) } })
    }

    const allowed = allowedCapabilities(parsed.capabilities, mode)
    const started = Date.now()
    try {
      const result = await parseOpenAIResponse(context.env, {
        input: buildPlanInput(parsed.text, allowed),
        schema: buildPlanSchema(allowed),
        schemaName: 'agent_plan',
        maxOutputTokens: AGENT_PLAN_MAX_OUTPUT_TOKENS,
        safetyIdentifier: await createSafetyIdentifier(context.env, userId),
        model: context.env.OPENAI_AGENT_MODEL?.trim() || undefined,
        timeoutMs: AGENT_PLAN_TIMEOUT_MS,
        maxRetries: AGENT_PLAN_MAX_RETRIES,
      })
      const plan = sanitizePlan(result.data, { text: parsed.text, allowed })
      console.info(JSON.stringify({
        event: 'agent_plan',
        route: 'llm',
        kind: plan.kind,
        ...(plan.kind === 'unsupported' ? { reason: plan.reason } : {}),
        elapsedMs: Date.now() - started,
        model: result.model,
        usage: result.usage,
      }))
      return respond(plan, mode, quota.remaining)
    } catch (error) {
      if (error instanceof OpenAIResponseRefusal) {
        return respond({ kind: 'unsupported', reason: 'out_of_scope' }, mode, quota.remaining)
      }
      console.error(JSON.stringify({
        event: 'agent_plan_failed',
        elapsedMs: Date.now() - started,
        ...summarizeOpenAIError(error),
      }))
      return refuse(502, 'AGENT_PLAN_FAILED', 'The request could not be understood right now.')
    }
  }
}

export const onRequestPost = createAgentQueryHandler()
