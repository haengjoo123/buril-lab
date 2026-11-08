import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const cache = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }))
vi.mock('./_cache', async importOriginal => ({ ...await importOriginal<typeof import('./_cache')>(), readAICache: cache.read, writeAICache: cache.write }))
import { onRequestPost } from './classify'

const config = (mode: string) => ({ voiceCandidate: mode, classification: mode, shadowSampleRate: 1, expiresAt: '2099-01-01T00:00:00Z' })
const context = (mode: string, jobs: Promise<unknown>[] = []) => ({
  request: new Request('https://example.com/api/gemini/classify', { method: 'POST', body: JSON.stringify({ chemical: { name: 'Acetone' } }) }),
  data: { userId: 'user', requestId: 'req' }, waitUntil: (job: Promise<unknown>) => jobs.push(job),
  env: { OPENAI_API_KEY: 'test', OPENAI_SAFETY_HMAC_SECRET: 'test-secret', BURILLAB_RUNTIME_CONFIG: { get: async () => config(mode) } },
})
const aiResponse = () => ({ id: 'resp_test', status: 'completed', model: 'gpt-6-luna', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ category: 'ORGANIC_NON_HALOGEN', confidence: 0.9, reason: 'legacy' }), annotations: [] }] }] })
beforeEach(() => { cache.read.mockReset().mockResolvedValue(null); cache.write.mockReset().mockResolvedValue(undefined) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('classification Decisions cache and shadow isolation', () => {
  it('preserves full metadata on active cache hits without a model call', async () => {
    const cached = { category: 'ORGANIC_NON_HALOGEN', confidence: 0.1, reason: 'fixed', decision: { model: 'gpt-6-luna', policyVersion: 'classification:v1', choiceProbability: 0.99, confidence: 0.1, probabilities: ['ACID', 'ALKALI', 'NEUTRAL', 'ORGANIC_HALOGEN', 'ORGANIC_NON_HALOGEN', 'HEAVY_METAL', 'CYANIDE', 'REACTIVE', 'SOLID_WASTE', 'UNKNOWN'].map(value => ({ value, probability: value === 'ORGANIC_NON_HALOGEN' ? 0.99 : 0.01 / 9 })) } }
    cache.read.mockResolvedValue(cached)
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    expect(await (await onRequestPost(context('active'))).json()).toEqual({ ...cached, responseSource: 'cache' })
    expect(cache.read.mock.calls[0][2]).toMatch(/^classify:decisions:v1:/)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('skips shadow on legacy cache hit', async () => {
    cache.read.mockResolvedValue({ category: 'ACID' })
    const jobs: Promise<unknown>[] = []
    await onRequestPost(context('shadow', jobs))
    expect(jobs).toHaveLength(0)
    expect(cache.write).not.toHaveBeenCalled()
  })
  it('writes only the primary legacy cache in shadow, never the Decisions answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (String(url).includes('/responses')) return Response.json(aiResponse())
      const body = JSON.parse(init!.body as string)
      return Response.json({ model: 'gpt-6-luna', answers: [{ type: 'choice', name: 'classification', choice: 'ACID', confidence: 1,
        probabilities: body.questions[0].choices.map((item: { value: string }) => ({ value: item.value, probability: item.value === 'ACID' ? 1 : 0 })) }] })
    }))
    const jobs: Promise<unknown>[] = []
    expect(await (await onRequestPost(context('shadow', jobs))).json()).toMatchObject({ category: 'ORGANIC_NON_HALOGEN', reason: 'legacy' })
    await Promise.all(jobs)
    expect(cache.write).toHaveBeenCalledTimes(1)
    expect(cache.write.mock.calls[0][2]).toMatch(/^classify:v3:/)
    expect(cache.write.mock.calls[0][3]).toEqual({ category: 'ORGANIC_NON_HALOGEN' })
  })
  it('falls back to Responses with a five-second deadline and no retry, retaining the legacy cache namespace', async () => {
    const fetch = vi.fn(async (url, init) => {
      if (String(url).includes('/decisions')) return new Response('', { status: 503 })
      expect(JSON.parse(init!.body as string)).toMatchObject({ store: false, model: 'gpt-6-luna' })
      return Response.json(aiResponse())
    })
    vi.stubGlobal('fetch', fetch)
    expect(await (await onRequestPost(context('active'))).json()).toMatchObject({ category: 'ORGANIC_NON_HALOGEN', responseSource: 'ai' })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(cache.write.mock.calls[0][2]).toMatch(/^classify:v3:/)
  })
  it('returns UNKNOWN without caching if both providers fail', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 503 }))
    vi.stubGlobal('fetch', fetch)
    expect(await (await onRequestPost(context('active'))).json()).toEqual({ category: 'UNKNOWN', responseSource: 'deterministic' })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(cache.write).not.toHaveBeenCalled()
  })
})
