import { z } from 'zod'
import type { RuntimeConfigEnv } from '../_runtimeConfig'
import type { OpenAIResponsesEnv } from './_openai'

export const DECISIONS_MODEL = 'gpt-6-luna'
export const DECISIONS_TIMEOUT_MS = 5_000
export const DECISIONS_CONFIG_KEY = 'ai_decisions_config'
export const MIN_CHOICE_PROBABILITY = 0.90
export const MIN_CHOICE_MARGIN = 0.20
export type DecisionFeature = 'voiceCandidate' | 'classification'
export const DECISION_POLICIES = { voiceCandidate: 'voice-candidate:v4', classification: 'classification:v4' } as const
export type DecisionPolicyRevision = 'v1' | 'v2' | 'v3' | 'v4'
export type DecisionsEnv = OpenAIResponsesEnv & RuntimeConfigEnv
export interface DecisionContext {
  env: DecisionsEnv
  data?: Record<string, unknown>
  waitUntil?: (task: Promise<unknown>) => void
}
const modeSchema = z.enum(['legacy', 'shadow', 'active'])
const configSchema = z.object({
  voiceCandidate: modeSchema,
  classification: modeSchema,
  shadowSampleRate: z.number().min(0).max(1),
  expiresAt: z.iso.datetime({ offset: true }),
})
export async function decisionMode(env: DecisionsEnv, feature: DecisionFeature) {
  try {
    const parsed = configSchema.safeParse(await env.BURILLAB_RUNTIME_CONFIG?.get(DECISIONS_CONFIG_KEY, 'json'))
    if (!parsed.success || Date.parse(parsed.data.expiresAt) <= Date.now()) return { mode: 'legacy' as const, sampleRate: 0 }
    return { mode: parsed.data[feature], sampleRate: parsed.data.shadowSampleRate }
  } catch { return { mode: 'legacy' as const, sampleRate: 0 } }
}
const probability = z.number().finite().min(0).max(1)
const answerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('refusal'), name: z.string() }),
  z.object({ type: z.literal('choice'), name: z.string(), choice: z.string(), confidence: probability,
    probabilities: z.array(z.object({ value: z.string(), probability })) }),
])
const resultSchema = z.object({ model: z.literal(DECISIONS_MODEL), answers: z.array(answerSchema).length(1),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative(),
    input_tokens_details: z.object({ cached_tokens: z.number().int().nonnegative(), cache_write_tokens: z.number().int().nonnegative() }).optional(),
  }).optional(),
})
export interface DecisionMetadata {
  model: string
  policyVersion: string
  confidence: number
  choiceProbability: number
  probabilities: Array<{ value: string; probability: number }>
  identityCheck?: { choice: string | null; confidence: number; choiceProbability: number;
    probabilities: Array<{ value: string; probability: number }> }
}
export interface ChoiceTask {
  policyVersion?: string
  feature: DecisionFeature
  input: string
  instructions: string
  choices: Array<{ value: string; description?: string }>
  abstain: string
  blockedChoices?: string[]
  safetyIdentifier: string
  identityCheckInstructions?: string
}
export const IDENTITY_CHECK_NAME = 'classification_identity'
export const IDENTITY_CHECK_CHOICES = [
  { value: 'matching_identity', description: 'The recognized declared identity is coherent across all supplied identifiers; no unidentified mixture or contradictory field.' },
  { value: 'review', description: 'Identifiers conflict, identity is unresolved, or the substance is an unidentified or contaminated mixture.' },
]
function parseSingleDecision(payload: unknown, task: ChoiceTask) {
  const parsed = resultSchema.parse(payload)
  const answer = parsed.answers[0]
  if (answer.name !== task.feature) throw new Error('invalid_answer_name')
  if (answer.type === 'refusal') return { choice: null, proposedChoice: null, abstentionReason: 'refusal', decision: undefined, usage: parsed.usage, outcome: 'refusal' }
  const values = new Set(task.choices.map(item => item.value))
  const supplied = new Set(answer.probabilities.map(item => item.value))
  if (!values.has(answer.choice) || supplied.size !== answer.probabilities.length || supplied.size !== values.size
    || answer.probabilities.some(item => !values.has(item.value))
    || Math.abs(answer.probabilities.reduce((sum, item) => sum + item.probability, 0) - 1) > 0.001) throw new Error('invalid_distribution')
  const selected = answer.probabilities.find(item => item.value === answer.choice)!.probability
  const runnerUp = Math.max(0, ...answer.probabilities.filter(item => item.value !== answer.choice).map(item => item.probability))
  const accepted = answer.choice !== task.abstain && !task.blockedChoices?.includes(answer.choice) && selected >= MIN_CHOICE_PROBABILITY && selected - runnerUp + 1e-12 >= MIN_CHOICE_MARGIN
  const abstentionReason = accepted ? null : answer.choice === task.abstain ? 'explicit_review'
    : task.blockedChoices?.includes(answer.choice) ? 'duplicate_identity' : selected < MIN_CHOICE_PROBABILITY ? 'probability' : 'margin'
  const decision: DecisionMetadata = { model: parsed.model, policyVersion: task.policyVersion ?? DECISION_POLICIES[task.feature],
    confidence: answer.confidence, choiceProbability: selected, probabilities: answer.probabilities }
  return { choice: accepted ? answer.choice : null, proposedChoice: answer.choice, abstentionReason, decision, usage: parsed.usage, outcome: accepted ? 'accepted' : 'abstained' }
}
export function parseDecision(payload: unknown, task: ChoiceTask) {
  if (!task.identityCheckInstructions) return parseSingleDecision(payload, task)
  const parsed = resultSchema.extend({ answers: z.array(answerSchema).length(2) }).parse(payload)
  const primary = parsed.answers.find(answer => answer.name === task.feature)
  const identity = parsed.answers.find(answer => answer.name === IDENTITY_CHECK_NAME)
  if (!primary || !identity) throw new Error('invalid_answer_name')
  const result = parseSingleDecision({ ...parsed, answers: [primary] }, task)
  const check = parseSingleDecision({ ...parsed, answers: [{ ...identity, name: task.feature }] }, {
    ...task, choices: IDENTITY_CHECK_CHOICES, abstain: 'review', blockedChoices: undefined,
  })
  if (result.decision) result.decision.identityCheck = { choice: check.choice,
    confidence: check.decision?.confidence ?? 0, choiceProbability: check.decision?.choiceProbability ?? 0,
    probabilities: check.decision?.probabilities ?? [] }
  if (!check.choice && result.choice) return { ...result, choice: null,
    abstentionReason: check.outcome === 'refusal' ? 'identity_refusal' : 'identity_evidence', outcome: 'abstained' }
  return result
}
export async function evaluateDecision(env: DecisionsEnv, task: ChoiceTask) {
  const apiKey = env.OPENAI_API_KEY?.trim()
  if (!apiKey) throw new Error('api_key_missing')
  // One deadline covers response headers AND body; never retry this POST.
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch('https://api.openai.com/v1/decisions', {
          // workerd rejects redirect:"error" before sending any request.
          // manual plus the !ok check rejects 3xx without forwarding secrets.
          method: 'POST', redirect: 'manual', signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: DECISIONS_MODEL, safety_identifier: task.safetyIdentifier, input: task.input,
            questions: [{ type: 'choice', name: task.feature, instructions: task.instructions, choices: task.choices },
              ...(task.identityCheckInstructions ? [{ type: 'choice', name: IDENTITY_CHECK_NAME,
                instructions: task.identityCheckInstructions, choices: IDENTITY_CHECK_CHOICES }] : [])] }),
        })
        if (!response.ok) {
          let code: unknown
          try { code = (await response.json() as { error?: { code?: unknown } }).error?.code } catch { /* Non-JSON errors have status only. */ }
          throw Object.assign(new Error(`http_${response.status}`), { status: response.status,
            code: typeof code === 'string' && /^[a-zA-Z0-9_]{1,64}$/.test(code) ? code : null })
        }
        return parseDecision(await response.json(), task)
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')) }, DECISIONS_TIMEOUT_MS) }),
    ])
  } finally { clearTimeout(timer) }
}
export function logDecision(context: DecisionContext, task: ChoiceTask, fields: Record<string, unknown>) {
  console.info(JSON.stringify({ event: 'ai_decision', requestId: context.data?.requestId ?? null,
    feature: task.feature, model: DECISIONS_MODEL, policyVersion: task.policyVersion ?? DECISION_POLICIES[task.feature], cacheHit: false, ...fields }))
}
export async function runDecisionTask<T>(context: DecisionContext, task: ChoiceTask,
  legacy: (bounded: boolean) => Promise<T>, selection: (value: T) => string | null) {
  const config = await decisionMode(context.env, task.feature)
  const evaluate = async () => {
    const started = Date.now()
    try {
      const result = await evaluateDecision(context.env, task)
      logDecision(context, task, { mode: config.mode, outcome: result.outcome, choice: result.choice,
        elapsedMs: Date.now() - started, usage: result.usage, fallbackReason: null })
      return result
    } catch (error) {
      const reason = error instanceof Error && /^http_\d+$|^timeout$|^invalid_/.test(error.message) ? error.message : 'technical_error'
      logDecision(context, task, { mode: config.mode, outcome: 'error', elapsedMs: Date.now() - started, fallbackReason: reason })
      throw new Error(reason)
    }
  }
  if (config.mode !== 'active') {
    const primaryStarted = Date.now()
    const value = await legacy(false)
    const primaryElapsedMs = Date.now() - primaryStarted
    if (config.mode === 'shadow' && context.waitUntil && Math.random() < config.sampleRate) {
      context.waitUntil(evaluate().then(result => {
        logDecision(context, task, { mode: 'shadow', outcome: 'comparison', agrees: result.choice === selection(value), primaryElapsedMs })
      }).catch(() => undefined))
    }
    return { backend: 'legacy' as const, value }
  }
  try { return { backend: 'decisions' as const, value: await evaluate() } }
  catch { return { backend: 'legacy' as const, value: await legacy(true) } }
}
