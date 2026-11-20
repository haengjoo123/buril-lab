import { z } from 'zod'
import {
  DECISIONS_MODEL,
  DECISIONS_TIMEOUT_MS,
  evaluateDecision,
  type ChoiceResult,
  type ChoiceTask,
  type DecisionsEnv,
} from './_decisions'
import { OpenAIResponseRefusal, parseOpenAIResponse } from './_openai'

export const VALID_CATEGORIES = [
  'ACID',
  'ALKALI',
  'NEUTRAL',
  'ORGANIC_HALOGEN',
  'ORGANIC_NON_HALOGEN',
  'HEAVY_METAL',
  'CYANIDE',
  'REACTIVE',
  'SOLID_WASTE',
  'UNKNOWN',
] as const
export const CLASSIFICATION_MAX_OUTPUT_TOKENS = 400
export const VOICE_CANDIDATE_MAX_OUTPUT_TOKENS = 500
export const classificationSchema = z.object({
  category: z.enum(VALID_CATEGORIES),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(500),
})
export const candidateResolutionSchema = z.object({
  candidateId: z.string().max(200),
  confidence: z.number().min(0).max(1),
  queryAliases: z.array(z.string().min(1).max(120)).max(10),
})

// The same adapter serves the signed evaluator and the opt-in application paths.
export async function matchedResponses(env: DecisionsEnv, task: ChoiceTask) {
  const voice = task.feature === 'voiceCandidate'
  const contract = voice
    ? 'Return candidateId, confidence and an empty queryAliases array. For review use __review__.'
    : 'Return category, confidence and a short Korean reason. For review use UNKNOWN.'
  const common = {
    input: [
      { role: 'developer' as const, content: task.instructions + '\n' + contract },
      { role: 'user' as const, content: JSON.stringify({ evidence: JSON.parse(task.input), choices: task.choices }) },
    ],
    safetyIdentifier: task.safetyIdentifier,
    model: DECISIONS_MODEL,
    timeoutMs: DECISIONS_TIMEOUT_MS,
    maxRetries: 0,
  }
  const result = voice
    ? await parseOpenAIResponse(env, {
        ...common,
        schema: candidateResolutionSchema,
        schemaName: 'voice_candidate_resolution',
        maxOutputTokens: VOICE_CANDIDATE_MAX_OUTPUT_TOKENS,
      })
    : await parseOpenAIResponse(env, {
        ...common,
        schema: classificationSchema,
        schemaName: 'chemical_classification',
        maxOutputTokens: CLASSIFICATION_MAX_OUTPUT_TOKENS,
      })
  const proposed = 'candidateId' in result.data ? result.data.candidateId : result.data.category
  const reason =
    proposed === task.abstain || !proposed
      ? 'explicit_review'
      : !task.choices.some((item) => item.value === proposed)
        ? 'unoffered_choice'
        : task.blockedChoices?.includes(proposed)
          ? (task.blockedReason ?? 'duplicate_identity')
          : voice && result.data.confidence < 0.72
            ? 'confidence'
            : null
  return {
    choice: reason ? null : proposed,
    proposedChoice: proposed,
    confidence: result.data.confidence,
    outcome: reason ? 'abstained' : 'accepted',
    abstentionReason: reason,
    model: result.model,
    usage: result.usage ?? null,
    policyVersion: task.policyVersion,
  }
}

export async function evaluateSelectionPolicy(env: DecisionsEnv, task: ChoiceTask): Promise<ChoiceResult> {
  if (task.provider === 'decisions') return evaluateDecision(env, task)
  if (task.provider !== 'responses') throw new Error('missing_policy_provider')
  try {
    return await matchedResponses(env, task)
  } catch (error) {
    if (!(error instanceof OpenAIResponseRefusal)) throw error
    return { choice: null, proposedChoice: null, outcome: 'refusal', abstentionReason: 'refusal' }
  }
}
