import { z } from 'zod'
import type { RuntimeConfigEnv } from '../_runtimeConfig'
import type { OpenAIResponsesEnv } from './_openai'

export const DECISIONS_MODEL = 'gpt-6-luna'
export const DECISIONS_TIMEOUT_MS = 5_000
export const DECISIONS_CONFIG_KEY = 'ai_decisions_config'
export const MIN_CHOICE_PROBABILITY = 0.90
export const MIN_CHOICE_MARGIN = 0.20
export type DecisionFeature = 'voiceCandidate' | 'classification'
export const DECISION_POLICIES = { voiceCandidate: 'voice-candidate:v1', classification: 'classification:v1' } as const
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
}
export interface ChoiceTask {
  feature: DecisionFeature
  input: string
  instructions: string
  choices: Array<{ value: string; description?: string }>
  abstain: string
  blockedChoices?: string[]
  safetyIdentifier: string
}
export function parseDecision(payload: unknown, task: ChoiceTask) {
  const parsed = resultSchema.parse(payload)
  const answer = parsed.answers[0]
  if (answer.name !== task.feature) throw new Error('invalid_answer_name')
  if (answer.type === 'refusal') return { choice: null, decision: undefined, usage: parsed.usage, outcome: 'refusal' }
  const values = new Set(task.choices.map(item => item.value))
  const supplied = new Set(answer.probabilities.map(item => item.value))
  if (!values.has(answer.choice) || supplied.size !== answer.probabilities.length || supplied.size !== values.size
    || answer.probabilities.some(item => !values.has(item.value))
    || Math.abs(answer.probabilities.reduce((sum, item) => sum + item.probability, 0) - 1) > 0.001) throw new Error('invalid_distribution')
  const selected = answer.probabilities.find(item => item.value === answer.choice)!.probability
  const runnerUp = Math.max(0, ...answer.probabilities.filter(item => item.value !== answer.choice).map(item => item.probability))
  const accepted = answer.choice !== task.abstain && !task.blockedChoices?.includes(answer.choice) && selected >= MIN_CHOICE_PROBABILITY && selected - runnerUp + 1e-12 >= MIN_CHOICE_MARGIN
  const decision: DecisionMetadata = { model: parsed.model, policyVersion: DECISION_POLICIES[task.feature],
    confidence: answer.confidence, choiceProbability: selected, probabilities: answer.probabilities }
  return { choice: accepted ? answer.choice : null, decision, usage: parsed.usage, outcome: accepted ? 'accepted' : 'abstained' }
}
export async function evaluateDecision(env: DecisionsEnv, task: ChoiceTask) {
  // One deadline covers response headers AND body; never retry this POST.
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch('https://api.openai.com/v1/decisions', {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: DECISIONS_MODEL, safety_identifier: task.safetyIdentifier, input: task.input,
            questions: [{ type: 'choice', name: task.feature, instructions: task.instructions, choices: task.choices }] }),
        })
        if (!response.ok) { await response.body?.cancel(); throw new Error(`http_${response.status}`) }
        return parseDecision(await response.json(), task)
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')) }, DECISIONS_TIMEOUT_MS) }),
    ])
  } finally { clearTimeout(timer) }
}
export function logDecision(context: DecisionContext, task: ChoiceTask, fields: Record<string, unknown>) {
  console.info(JSON.stringify({ event: 'ai_decision', requestId: context.data?.requestId ?? null,
    feature: task.feature, model: DECISIONS_MODEL, policyVersion: DECISION_POLICIES[task.feature], cacheHit: false, ...fields }))
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
