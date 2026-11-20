import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { buildRoutedClassificationTask, generateDecisionsClassificationCacheKey, onRequestPost } from './classify'
import { onRequestPost as mobile } from '../gemini/classify'
import { resetClassificationIdentityCache } from './_classificationEvidence'
const cache = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }))
vi.mock('./_cache', async (original) => ({
  ...(await original<object>()),
  readAICache: cache.read,
  writeAICache: cache.write,
}))
const ctx = (chemical: object, mode = 'active', jobs: Promise<unknown>[] = [], policy = 'identity-routed-v1') => ({
  env: {
    OPENAI_API_KEY: 'test',
    OPENAI_SAFETY_HMAC_SECRET: 'test',
    BURILLAB_RUNTIME_CONFIG: {
      get: async () => ({
        voiceCandidate: 'legacy',
        classification: mode,
        policies: { classification: policy },
        shadowSampleRate: 1,
        expiresAt: '2099-01-01T00:00:00Z',
      }),
    },
  },
  request: new Request('https://example.com/api/ai/classify', { method: 'POST', body: JSON.stringify({ chemical }) }),
  data: { userId: 'test' },
  waitUntil: (p: Promise<unknown>) => jobs.push(p),
})
const api = async (url: string, init: RequestInit) => {
  if (url.includes('/pubchem.') || url.includes('pubchem.ncbi'))
    return Response.json({
      PropertyTable: { Properties: [{ CID: 313, Title: 'Hydrochloric acid', MolecularFormula: 'ClH' }] },
    })
  const body = JSON.parse(init.body as string)
  if (url.endsWith('/decisions'))
    return Response.json({
      model: 'gpt-6-luna',
      answers: [
        {
          type: 'choice',
          name: 'classification',
          choice: 'ACID',
          confidence: 0.2,
          probabilities: body.questions[0].choices.map((c: { value: string }) => ({
            value: c.value,
            probability: c.value === 'ACID' ? 1 : 0,
          })),
        },
      ],
    })
  return Response.json({
    id: 'test',
    status: 'completed',
    model: 'gpt-6-luna',
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            annotations: [],
            text: JSON.stringify({ category: 'ORGANIC_NON_HALOGEN', confidence: 0.94, reason: 'reference' }),
          },
        ],
      },
    ],
  })
}
beforeEach(() => {
  cache.read.mockReset().mockResolvedValue(null)
  cache.write.mockReset()
  resetClassificationIdentityCache()
})
afterEach(() => vi.unstubAllGlobals())
it.each([
  ['solid inorganic acid', 'Boric acid', 'decisions', 'ACID'],
  ['ordinary material', 'Acetone', 'responses', 'ORGANIC_NON_HALOGEN'],
])(
  'selects one primary provider for %s and preserves mobile metadata on a cache hit',
  async (_title, name, provider, category) => {
    const remote = vi.fn(api)
    vi.stubGlobal('fetch', remote)
    const first = await (await onRequestPost(ctx({ name }))).json()
    expect(first).toMatchObject({
      category,
      confidence: expect.any(Number),
      reason: expect.any(String),
      responseSource: 'ai',
    })
    expect(remote.mock.calls.map(([url]) => String(url).split('/').at(-1))).toEqual([provider])
    if (provider === 'responses') expect(first.decision).toBeUndefined()
    else expect(first.decision.policyVersion).toBe('classification:identity-routed:v1')
    const stored = cache.write.mock.calls[0]
    expect(stored[2]).toMatch(/^classify:routed:v1:/)
    cache.read.mockResolvedValueOnce(stored[3])
    expect(await (await mobile(ctx({ name }))).json()).toEqual({ ...first, responseSource: 'cache' })
    expect(remote).toHaveBeenCalledTimes(1)
  },
)
it('revalidates identity, ignores stale caches, and never stores a blocked provider choice', async () => {
  const remote = vi.fn(api)
  vi.stubGlobal('fetch', remote)
  cache.read.mockResolvedValue({ category: 'ACID', confidence: 1, reason: 'old', policyVersion: 'other' })
  const result = await (
    await mobile(ctx({ name: 'Acetone', molecularFormula: 'C3H6O', casNumber: '7647-01-0' }))
  ).json()
  expect(result.category).toBe('UNKNOWN')
  expect(remote.mock.calls.filter(([u]) => String(u).includes('api.openai.com'))).toHaveLength(1)
  expect(cache.write).not.toHaveBeenCalled()
})
it.each(['Acetone', 'Boric acid'])('ends a routed technical failure with UNKNOWN for %s', async (name) => {
  const remote = vi.fn(async () => new Response('', { status: 503 }))
  vi.stubGlobal('fetch', remote)
  expect(await (await onRequestPost(ctx({ name }))).json()).toMatchObject({
    category: 'UNKNOWN',
    responseSource: 'deterministic',
  })
  expect(remote).toHaveBeenCalledTimes(1)
  expect(cache.write).not.toHaveBeenCalled()
})
it('leaves the legacy result and its cache in charge in shadow', async () => {
  const jobs: Promise<unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(api))
  expect(await (await onRequestPost(ctx({ name: 'Boric acid' }, 'shadow', jobs))).json()).toMatchObject({
    category: 'ORGANIC_NON_HALOGEN',
    reason: 'reference',
  })
  await Promise.all(jobs)
  expect(jobs).toHaveLength(1)
  expect(cache.write).toHaveBeenCalledTimes(1)
  expect(cache.write.mock.calls[0][2]).toMatch(/^classify:v3:/)
})
it('applies the new composed policy at the public alias, rejects stale organic cache entries and asks for review after a contradiction', async () => {
  const chemical = { name: '무수 아세트산아연' }
  expect(generateDecisionsClassificationCacheKey(chemical, 'v2')).not.toBe(
    generateDecisionsClassificationCacheKey(chemical, true),
  )
  const task = buildRoutedClassificationTask(chemical, 'test', { status: 'not_supplied', cacheHit: false }, 'v2')
  cache.read.mockResolvedValue({
    category: 'ORGANIC_NON_HALOGEN',
    confidence: 1,
    reason: 'old',
    provider: 'responses',
    policyVersion: task.policyVersion,
    identityReference: task.identityReference,
  })
  const remote = vi.fn(api)
  vi.stubGlobal('fetch', remote)
  const result = await (await mobile(ctx(chemical, 'active', [], 'identity-routed-v2'))).json()
  expect(result).toMatchObject({ category: 'UNKNOWN', responseSource: 'ai' })
  expect(remote).toHaveBeenCalledTimes(1)
  expect(cache.write).not.toHaveBeenCalled()
})
