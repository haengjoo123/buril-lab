import { type ChoiceTask, type DecisionsEnv, DECISIONS_MODEL, DECISIONS_TIMEOUT_MS } from '../../ai/_decisions'
import { parseOpenAIResponse } from '../../ai/_openai'
import { classificationSchema, CLASSIFICATION_MAX_OUTPUT_TOKENS } from '../../ai/classify'
import { candidateResolutionSchema, VOICE_CANDIDATE_MAX_OUTPUT_TOKENS } from '../../voice/_reagentAliases'
import type { ClassificationIdentityEvidence } from '../../ai/_classificationEvidence'
import publicIdentities from '../../../../scripts/fixtures/decisions-paired-pubchem.json'

export function fixedIdentityEvidence(cas?: string): ClassificationIdentityEvidence {
  const number = cas?.trim()
  if (!number) return { status: 'not_supplied', cacheHit: false }
  if (!Object.hasOwn(publicIdentities, number)) return { status: 'unavailable', cacheHit: false }
  return publicIdentities[number as keyof typeof publicIdentities] as ClassificationIdentityEvidence
}

export async function pairedInputDigest(task: ChoiceTask): Promise<string> {
  const shared = JSON.stringify([task.input, task.instructions, task.choices, task.abstain, task.blockedChoices ?? []])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(shared))
  return Array.from(new Uint8Array(digest), octet => octet.toString(16).padStart(2, '0')).join('')
}

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
    safetyIdentifier: task.safetyIdentifier, model: DECISIONS_MODEL, timeoutMs: DECISIONS_TIMEOUT_MS, maxRetries: 0,
  }
  // Keep the existing Responses return contract and confidence treatment. The
  // evidence, offered choices and deterministic identity guards match the trial.
  const result = voice
    ? await parseOpenAIResponse(env, { ...common, schema: candidateResolutionSchema, schemaName: 'voice_candidate_resolution', maxOutputTokens: VOICE_CANDIDATE_MAX_OUTPUT_TOKENS })
    : await parseOpenAIResponse(env, { ...common, schema: classificationSchema, schemaName: 'chemical_classification', maxOutputTokens: CLASSIFICATION_MAX_OUTPUT_TOKENS })
  const proposed = 'candidateId' in result.data ? result.data.candidateId : result.data.category
  const allowed = proposed !== task.abstain && task.choices.some(item => item.value === proposed) && !task.blockedChoices?.includes(proposed)
  return { choice: allowed && (!voice || result.data.confidence >= 0.72) ? proposed : null,
    proposedChoice: proposed, model: result.model, usage: result.usage ?? null, policyVersion: task.policyVersion }
}
