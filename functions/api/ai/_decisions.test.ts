import { afterEach, describe, expect, it, vi } from 'vitest'
import { decisionMode, evaluateDecision, parseDecision, runDecisionTask, type ChoiceTask } from './_decisions'
import { onRequestPost } from './classify'
import { resolveCandidateWithOpenAI } from '../voice/_reagentAliases'

const task: ChoiceTask = { feature: 'classification', input: 'sample', instructions: 'classify',
  choices: [{ value: 'ACID' }, { value: 'UNKNOWN' }], abstain: 'UNKNOWN', safetyIdentifier: 'hashed' }
const config = (mode: string) => ({ voiceCandidate: mode, classification: mode, shadowSampleRate: 1, expiresAt: '2099-01-01T00:00:00Z' })
const env = (mode: string) => ({ OPENAI_API_KEY: 'test-only', OPENAI_SAFETY_HMAC_SECRET: 'test-only-hmac-secret',
  BURILLAB_RUNTIME_CONFIG: { get: vi.fn().mockResolvedValue(config(mode)) } })
const payload = (choice = 'ACID', p = 0.96) => ({ model: 'gpt-6-luna', answers: [{ name: task.feature, type: 'choice', choice, confidence: 0.1,
  probabilities: task.choices.map(item => ({ value: item.value, probability: item.value === choice ? p : 1 - p })) }] })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('Decisions request, validation and rollout', () => {
  it('gates on choice probability independently of confidence', () => {
    expect(parseDecision(payload(), task)).toMatchObject({ choice: 'ACID', decision: { confidence: 0.1, choiceProbability: 0.96 } })
    expect(parseDecision(payload('ACID', 0.89), task).choice).toBeNull()
    expect(parseDecision(payload('UNKNOWN'), task).choice).toBeNull()
    expect(parseDecision({ model: 'gpt-6-luna', answers: [{ type: 'refusal', name: task.feature }] }, task).outcome).toBe('refusal')
  })
  it.each(['wrong_name', 'foreign_choice', 'duplicate', 'missing', 'nan', 'sum'])('rejects malformed answers: %s', kind => {
    const data = payload()
    const answer = data.answers[0]
    if (kind === 'wrong_name') answer.name = 'voiceCandidate'
    if (kind === 'foreign_choice') answer.choice = 'invented'
    if (kind === 'duplicate') answer.probabilities[1].value = 'ACID'
    if (kind === 'missing') answer.probabilities.pop()
    if (kind === 'nan') answer.confidence = NaN
    if (kind === 'sum') answer.probabilities[0].probability = 0.5
    expect(() => parseDecision(data, task)).toThrow()
  })
  it('defaults to legacy for absent, invalid, expired or unavailable KV', async () => {
    for (const value of [null, {}, { ...config('active'), expiresAt: '2020-01-01T00:00:00Z' }, config('invalid')]) {
      await expect(decisionMode({ BURILLAB_RUNTIME_CONFIG: { get: async () => value } }, 'classification')).resolves.toMatchObject({ mode: 'legacy' })
    }
    await expect(decisionMode({ BURILLAB_RUNTIME_CONFIG: { get: async () => { throw Error() } } }, 'classification')).resolves.toMatchObject({ mode: 'legacy' })
  })
  it('sends only supported fields with fixed model, HMAC and no retries', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(payload()))
    vi.stubGlobal('fetch', fetch)
    await evaluateDecision(env('active'), task)
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(fetch.mock.calls[0][1].redirect).toBe('manual')
    expect(body).toMatchObject({ model: 'gpt-6-luna', safety_identifier: 'hashed', questions: [{ name: 'classification', type: 'choice' }] })
    expect(body).not.toHaveProperty('store')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('normalizes whitespace in server keys before constructing HTTP headers', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(payload()))
    vi.stubGlobal('fetch', fetch)
    await evaluateDecision({ ...env('active'), OPENAI_API_KEY: ' test-only\r\n' }, task)
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test-only')
  })
  it.each([429, 500, 503])('falls back once for HTTP %i', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })))
    const legacy = vi.fn().mockResolvedValue('legacy-result')
    await expect(runDecisionTask({ env: env('active') }, task, legacy, value => value)).resolves.toEqual({ backend: 'legacy', value: 'legacy-result' })
    expect(legacy).toHaveBeenCalledExactlyOnceWith(true)
  })
  it('times out even if the response body never completes', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) }))
    const legacy = vi.fn().mockResolvedValue(null)
    const pending = runDecisionTask({ env: env('active') }, task, legacy, () => null)
    await vi.advanceTimersByTimeAsync(5000)
    await expect(pending).resolves.toEqual({ backend: 'legacy', value: null })
    expect(legacy).toHaveBeenCalledExactlyOnceWith(true)
  })
  it('never falls back for uncertainty or refusal', async () => {
    const legacy = vi.fn()
    for (const data of [payload('ACID', 0.7), { model: 'gpt-6-luna', answers: [{ type: 'refusal', name: task.feature }] }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(data)))
      const result = await runDecisionTask({ env: env('active') }, task, legacy, () => null)
      expect(result).toMatchObject({ backend: 'decisions', value: { choice: null } })
    }
    expect(legacy).not.toHaveBeenCalled()
  })
  it('returns legacy immediately in shadow and schedules a read-only comparison', async () => {
    const jobs: Promise<unknown>[] = []
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload())))
    const value = { category: 'UNKNOWN' }
    const legacy = vi.fn().mockResolvedValue(value)
    const result = await runDecisionTask({ env: env('shadow'), waitUntil: job => { jobs.push(job) } }, task, legacy, () => null)
    expect(result).toEqual({ backend: 'legacy', value })
    await Promise.all(jobs)
    expect(value).toEqual({ category: 'UNKNOWN' })
    expect(legacy).toHaveBeenCalledExactlyOnceWith(false)
  })
})

describe('feature integration', () => {
  it('accepts a Korean query candidate by choice probability even with low confidence and limits input to 120', async () => {
    const fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(init!.body as string)
      expect(body.questions[0].choices).toHaveLength(121)
      expect(JSON.parse(body.input).candidates).toHaveLength(120)
      expect(body.input).toContain('글루코즈')
      return Response.json({ model: 'gpt-6-luna', answers: [{ type: 'choice', name: 'voiceCandidate', choice: 'inventory:0', confidence: 0.1,
        probabilities: body.questions[0].choices.map((item: { value: string }) => ({ value: item.value, probability: item.value === 'inventory:0' ? 1 : 0 })) }] })
    })
    vi.stubGlobal('fetch', fetch)
    const matches = Array.from({ length: 130 }, (_, i) => ({ id: String(i), source: 'inventory' as const, name: `Glucose ${i}`, matchedBy: 'contains' as const }))
    await expect(resolveCandidateWithOpenAI(env('active'), '글루코즈 어디 있어', 'ko', matches, 'hashed')).resolves.toMatchObject({ candidateId: 'inventory:0', confidence: 0.1, decisionAccepted: true, queryAliases: [] })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('keeps mobile classification fields and only caches accepted Decisions metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(init!.body as string)
      return Response.json({ model: 'gpt-6-luna', answers: [{ type: 'choice', name: 'classification', choice: 'ACID', confidence: 0.4,
        probabilities: body.questions[0].choices.map((item: { value: string }) => ({ value: item.value, probability: item.value === 'ACID' ? 0.99 : 0.01 / 9 })) }] })
    }))
    const response = await onRequestPost({ env: env('active'), data: { userId: 'user' },
      request: new Request('https://example.com/api/ai/classify', { method: 'POST', body: JSON.stringify({ chemical: { name: 'Hydrochloric acid' } }) }) })
    expect(await response.json()).toMatchObject({ category: 'ACID', confidence: 0.4, reason: expect.any(String), responseSource: 'ai', decision: { choiceProbability: 0.99, policyVersion: 'classification:v1' } })
  })
  it('does not resolve indistinguishable bottles even at high model probability', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(init!.body as string)
      return Response.json({ model: 'gpt-6-luna', answers: [{ type: 'choice', name: 'voiceCandidate', choice: 'inventory:a', confidence: 1,
        probabilities: body.questions[0].choices.map((item: { value: string }) => ({ value: item.value, probability: item.value === 'inventory:a' ? 1 : 0 })) }] })
    }))
    const matches = ['a', 'b'].map(id => ({ id, source: 'inventory' as const, name: 'Acetone', matchedBy: 'name_exact' as const }))
    await expect(resolveCandidateWithOpenAI(env('active'), '아세톤', 'ko', matches, 'hashed')).resolves.toBeNull()
  })
})
