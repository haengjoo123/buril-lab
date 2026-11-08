import { importJWK, jwtVerify } from 'jose'
import { z } from 'zod'
import { json } from '../../_shared/json'
import { createSafetyIdentifier, parseOpenAIResponse } from '../../ai/_openai'
import { evaluateDecision, type DecisionsEnv } from '../../ai/_decisions'
import { buildClassificationDecisionTask, buildClassificationPrompt, classificationSchema, CLASSIFICATION_MAX_OUTPUT_TOKENS } from '../../ai/classify'
import { buildVoiceDecisionTask, buildVoiceLegacyPrompt, candidateResolutionSchema, VOICE_CANDIDATE_MAX_OUTPUT_TOKENS } from '../../voice/_reagentAliases'
import type { VoiceMatch } from '../../../../src/utils/voiceAgent'
// Fixed synthetic fixtures only. No caller-provided prompt, inventory or credential is accepted.
// @ts-expect-error Shared CLI fixtures are JavaScript.
import { decisionFixtures } from '../../../../scripts/decisions-fixtures.mjs'

export const EVALUATION_PATH = '/api/internal/decisions/evaluate'
export const EVALUATION_GRANT_KEY = 'ai_decisions_evaluation'
export const EVALUATION_AUDIENCE = 'burillab:staging:decisions-evaluation:v1'
const bodySchema = z.object({ caseId: z.string().max(80), backend: z.enum(['legacy', 'decisions', 'probe']) }).strict()
const grantSchema = z.object({
  id: z.uuid(), expiresAt: z.iso.datetime({ offset: true }),
  publicKey: z.object({ kty: z.literal('OKP'), crv: z.literal('Ed25519'), x: z.string() }).strict(),
  caseIds: z.array(z.string().max(80)).min(1).max(400),
}).strict()
interface Fixture { id: string; feature: 'classification' | 'voiceCandidate'; expected: string | null;
  input: { name?: string; molecularFormula?: string; casNumber?: string; text: string; language: 'ko' | 'en'; matches: VoiceMatch[] } }
type Env = DecisionsEnv & { APP_ENVIRONMENT?: string }
const fixtures = new Map((decisionFixtures() as Fixture[]).map(item => [item.id, item]))

export async function onRequestPost(context: { request: Request; env: Env }) {
  const headers = { 'Cache-Control': 'no-store' }
  const respond = (data: unknown, status = 200) => json(data, { status, headers })
  if (context.env.APP_ENVIRONMENT !== 'staging') return respond({ code: 'NOT_FOUND' }, 404)
  const token = context.request.headers.get('Authorization')?.replace(/^Bearer /, '')
  if (!token || token.length > 4096) return respond({ code: 'AUTH_REQUIRED' }, 401)
  let body: z.infer<typeof bodySchema>
  try {
    const text = await context.request.text()
    if (new TextEncoder().encode(text).length > 1024) return respond({ code: 'BODY_TOO_LARGE' }, 413)
    body = bodySchema.parse(JSON.parse(text))
  } catch { return respond({ code: 'INVALID_CASE' }, 400) }
  try {
    const raw = await context.env.BURILLAB_RUNTIME_CONFIG?.get(EVALUATION_GRANT_KEY, 'json')
    const grant = grantSchema.parse(raw)
    const remaining = Date.parse(grant.expiresAt) - Date.now()
    if (remaining <= 0 || remaining > 3_600_000 || !grant.caseIds.includes(body.caseId)) return respond({ code: 'GRANT_DENIED' }, 403)
    const key = await importJWK(grant.publicKey, 'EdDSA')
    const { payload } = await jwtVerify(token, key, { algorithms: ['EdDSA'], issuer: grant.id, audience: EVALUATION_AUDIENCE, maxTokenAge: '15s' })
    if (payload.sub !== `${body.caseId}:${body.backend}` || typeof payload.exp !== 'number' || typeof payload.iat !== 'number' || payload.exp - payload.iat > 15) return respond({ code: 'GRANT_DENIED' }, 403)
  } catch { return respond({ code: 'GRANT_DENIED' }, 403) }
  const fixture = fixtures.get(body.caseId)
  if (!fixture) return respond({ code: 'INVALID_CASE' }, 400)
  if (!context.env.OPENAI_API_KEY || !context.env.OPENAI_SAFETY_HMAC_SECRET) return respond({ code: 'AI_NOT_CONFIGURED' }, 503)
  if (body.backend === 'probe') return respond({ id: fixture.id, feature: fixture.feature, backend: 'probe', error: false, configured: true })
  const started = Date.now()
  try {
    const safety = await createSafetyIdentifier(context.env, 'decisions-evaluation-synthetic')
    const task = fixture.feature === 'classification' ? buildClassificationDecisionTask(fixture.input, safety)
      : buildVoiceDecisionTask(fixture.input.text, fixture.input.language, fixture.input.matches, safety)
    if (body.backend === 'decisions') {
      const result = await evaluateDecision(context.env, task)
      return respond({ id: fixture.id, feature: fixture.feature, backend: body.backend, expected: fixture.expected,
        choice: result.choice, model: 'gpt-6-luna', policyVersion: result.decision?.policyVersion ?? null,
        elapsedMs: Date.now() - started, usage: result.usage ?? null, error: false, cacheHit: false })
    }
    const candidates = fixture.input.matches?.slice(0, 120).map(match => ({ candidateId: `${match.source}:${match.id}`, name: match.name,
      brand: match.brand || '', productNumber: match.productNumber || '', casNumber: match.casNumber || '', storageType: match.storageType || '' }))
    // Same production prompts/schemas, no DB/cache, retries, alias learning or cross-provider fallback.
    const common = { safetyIdentifier: safety, timeoutMs: 5_000, maxRetries: 0 }
    let choice: string | null, model: string, usage: unknown
    if (fixture.feature === 'classification') {
      const result = await parseOpenAIResponse(context.env, { ...common, input: buildClassificationPrompt(fixture.input),
        schema: classificationSchema, schemaName: 'chemical_classification', maxOutputTokens: CLASSIFICATION_MAX_OUTPUT_TOKENS })
      choice = result.data.category === 'UNKNOWN' ? null : result.data.category; model = result.model; usage = result.usage
    } else {
      const result = await parseOpenAIResponse(context.env, { ...common, input: buildVoiceLegacyPrompt(fixture.input.text, fixture.input.language, candidates),
        schema: candidateResolutionSchema, schemaName: 'voice_candidate_resolution', maxOutputTokens: VOICE_CANDIDATE_MAX_OUTPUT_TOKENS })
      choice = result.data.confidence >= 0.72 && candidates.some(item => item.candidateId === result.data.candidateId) ? result.data.candidateId : null
      model = result.model; usage = result.usage
    }
    return respond({ id: fixture.id, feature: fixture.feature, backend: body.backend, expected: fixture.expected,
      choice, model, elapsedMs: Date.now() - started, usage: usage ?? null, error: false, cacheHit: false })
  } catch {
    return respond({ id: fixture.id, feature: fixture.feature, backend: body.backend, expected: fixture.expected,
      choice: null, elapsedMs: Date.now() - started, error: true, code: 'EVALUATION_PROVIDER_FAILED', cacheHit: false }, 502)
  }
}
