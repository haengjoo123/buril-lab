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
import { allDecisionFixtures } from '../../../../scripts/decisions-fixtures.mjs'
// @ts-expect-error Shared fixed synthetic corpus is JavaScript.
import { expandedDecisionFixtures } from '../../../../scripts/decisions-expanded-fixtures.mjs'

export const EVALUATION_PATH = '/api/internal/decisions/evaluate'
export const EVALUATION_GRANT_KEY = 'ai_decisions_evaluation'
export const EVALUATION_AUDIENCE = 'burillab:staging:decisions-evaluation:v1'
export const PRODUCTION_EVALUATION_AUDIENCE = 'burillab:production:decisions-evaluation:v1'
const bodySchema = z.object({ caseId: z.string().max(80), backend: z.enum(['legacy', 'decisionsV1', 'decisionsV2', 'decisions', 'probe']) }).strict()
const grantSchema = z.object({
  environment: z.enum(['staging', 'production']).default('staging'),
  id: z.uuid(), expiresAt: z.iso.datetime({ offset: true }),
  publicKey: z.object({ kty: z.literal('OKP'), crv: z.literal('Ed25519'), x: z.string() }).strict(),
  caseIds: z.array(z.string().max(80)).min(1).max(2480),
}).strict()
interface Fixture { id: string; feature: 'classification' | 'voiceCandidate'; expected: string | null;
  input: { name?: string; molecularFormula?: string; casNumber?: string; text: string; language: 'ko' | 'en'; matches: VoiceMatch[] } }
type Env = DecisionsEnv & { APP_ENVIRONMENT?: string }
const fixtures = new Map(([...allDecisionFixtures(), ...expandedDecisionFixtures()] as Fixture[]).map(item => [item.id, item]))

export async function onRequestPost(context: { request: Request; env: Env }) {
  const headers = { 'Cache-Control': 'no-store' }
  const respond = (data: unknown, status = 200) => json(data, { status, headers })
  const production = context.env.APP_ENVIRONMENT === 'production'
  if (context.env.APP_ENVIRONMENT !== 'staging' && !production) return respond({ code: 'NOT_FOUND' }, 404)
  if (production && new URL(context.request.url).origin !== 'https://burillab.com') return respond({ code: 'NOT_FOUND' }, 404)
  // Production is closed unless an operator installs an environment-bound,
  // short-lived public grant in its own KV. Never export the server secrets.
  let grant: z.infer<typeof grantSchema>
  try {
    grant = grantSchema.parse(await context.env.BURILLAB_RUNTIME_CONFIG?.get(EVALUATION_GRANT_KEY, 'json'))
    const remaining = Date.parse(grant.expiresAt) - Date.now()
    if (grant.environment !== context.env.APP_ENVIRONMENT || remaining <= 0 || remaining > 3_600_000) throw new Error('inactive_grant')
  } catch { return respond({ code: production ? 'NOT_FOUND' : 'GRANT_DENIED' }, production ? 404 : 403) }
  const authorization = context.request.headers.get('Authorization')
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null
  if (!token || token.length > 4096) return respond({ code: 'AUTH_REQUIRED' }, 401)
  let body: z.infer<typeof bodySchema>
  try {
    const text = await context.request.text()
    if (new TextEncoder().encode(text).length > 1024) return respond({ code: 'BODY_TOO_LARGE' }, 413)
    body = bodySchema.parse(JSON.parse(text))
  } catch { return respond({ code: 'INVALID_CASE' }, 400) }
  try {
    if (!grant.caseIds.includes(body.caseId)) return respond({ code: 'GRANT_DENIED' }, 403)
    const key = await importJWK(grant.publicKey, 'EdDSA')
    const { payload } = await jwtVerify(token, key, { algorithms: ['EdDSA'], issuer: grant.id,
      audience: production ? PRODUCTION_EVALUATION_AUDIENCE : EVALUATION_AUDIENCE, maxTokenAge: '15s' })
    if (payload.sub !== `${body.caseId}:${body.backend}` || typeof payload.exp !== 'number' || typeof payload.iat !== 'number' || payload.exp - payload.iat > 15) return respond({ code: 'GRANT_DENIED' }, 403)
  } catch { return respond({ code: 'GRANT_DENIED' }, 403) }
  const fixture = fixtures.get(body.caseId)
  if (!fixture) return respond({ code: 'INVALID_CASE' }, 400)
  if (!context.env.OPENAI_API_KEY || !context.env.OPENAI_SAFETY_HMAC_SECRET) return respond({ code: 'AI_NOT_CONFIGURED' }, 503)
  if (body.backend === 'probe') return respond({ id: fixture.id, feature: fixture.feature, backend: 'probe', error: false, configured: true })
  const started = Date.now()
  try {
    const safety = await createSafetyIdentifier(context.env, 'decisions-evaluation-synthetic')
    const revision = body.backend === 'decisionsV1' ? 'v1' : body.backend === 'decisionsV2' ? 'v2' : 'v3'
    const task = fixture.feature === 'classification' ? buildClassificationDecisionTask(fixture.input, safety, revision)
      : buildVoiceDecisionTask(fixture.input.text, fixture.input.language, fixture.input.matches, safety, revision)
    if (body.backend === 'decisions' || body.backend === 'decisionsV1' || body.backend === 'decisionsV2') {
      const result = await evaluateDecision(context.env, task)
      return respond({ id: fixture.id, feature: fixture.feature, backend: body.backend, expected: fixture.expected,
        choice: result.choice, model: 'gpt-6-luna', policyVersion: task.policyVersion,
        proposedChoice: result.proposedChoice, outcome: result.outcome, abstentionReason: result.abstentionReason,
        decision: result.decision ?? null,
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
  } catch (error) {
    const reportedStatus = error && typeof error === 'object' && 'status' in error ? error.status : null
    const decisionStatus = error instanceof Error ? /^http_([45]\d\d)$/.exec(error.message)?.[1] : null
    const providerStatus = typeof reportedStatus === 'number' && reportedStatus >= 400 && reportedStatus <= 599
      ? reportedStatus : decisionStatus ? Number(decisionStatus) : null
    const rawCode = error && typeof error === 'object' && 'code' in error ? error.code : null
    const providerCode = typeof rawCode === 'string' && /^[a-zA-Z0-9_]{1,64}$/.test(rawCode) ? rawCode : null
    const errorKind = error instanceof Error && ['TypeError', 'ZodError', 'AbortError', 'TimeoutError'].includes(error.name) ? error.name : 'provider_error'
    return respond({ id: fixture.id, feature: fixture.feature, backend: body.backend, expected: fixture.expected,
      // The evaluation itself completed. Keep provider failures in its typed
      // result so an edge-generated 5xx page cannot erase diagnostic evidence.
      choice: null, elapsedMs: Date.now() - started, error: true, code: 'EVALUATION_PROVIDER_FAILED', providerStatus, providerCode, errorKind, cacheHit: false })
  }
}
