import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VoiceMatch } from '../../../src/utils/voiceAgent'
import { verifiedVoiceBlocks } from './_candidateConstraints'
import { buildVerifiedVoiceTask, resolveCandidateWithOpenAI } from './_reagentAliases'
import { evaluateSelectionPolicy } from '../ai/_choiceResponses'

const bottle = (id: string, name: string, casNumber: string, shelfLevel = 0): VoiceMatch => ({
  id,
  name,
  casNumber,
  shelfLevel,
  source: 'inventory',
  matchedBy: 'contains',
})
const a = bottle('a', 'Sodium acetate anhydrous', '127-09-3', 2)
const b = bottle('b', 'Sodium acetate trihydrate', '6131-90-4', 3)
const cfg = (mode = 'active') => ({
  OPENAI_API_KEY: 'test',
  BURILLAB_RUNTIME_CONFIG: {
    get: async () => ({
      voiceCandidate: mode,
      classification: 'legacy',
      policies: { voiceCandidate: 'verified-responses-v1' },
      shadowSampleRate: 1,
      expiresAt: '2099-01-01T00:00:00Z',
    }),
  },
})
const response = (id: string, confidence = 1) =>
  Response.json({
    id: 'r',
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
            text: JSON.stringify({ candidateId: id, confidence, queryAliases: ['must not learn'] }),
          },
        ],
      },
    ],
  })
afterEach(() => vi.unstubAllGlobals())
describe('verified bottle selection', () => {
  it.each(['3번째 선반', '세 번째 선반', 'shelf #3', 'third shelf', '3rd shelf', '선반 3번'])(
    'checks the displayed shelf for %s',
    (text) => {
      expect(verifiedVoiceBlocks(text, [a, b])).toEqual(['inventory:b'])
    },
  )
  it('checks checksum, both sides of a name/CAS conflict, full label boundaries and explicit hydration', () => {
    expect(verifiedVoiceBlocks('Sodium acetate anhydrous with CAS 6131-90-4', [a, b])).toEqual([
      'inventory:a',
      'inventory:b',
    ])
    expect(verifiedVoiceBlocks('CAS 127–09–3', [a, b])).toEqual(['inventory:b'])
    expect(verifiedVoiceBlocks('CAS 127-09-8', [a, b])).toHaveLength(2)
    expect(verifiedVoiceBlocks('무수 시약 중 찾아줘', [a, b])).toEqual(['inventory:b'])
    expect(verifiedVoiceBlocks('trihydrate', [a, b])).toEqual(['inventory:a'])
    expect(verifiedVoiceBlocks('이수화물 시약', [a, b])).toEqual(['inventory:a', 'inventory:b'])
    expect(verifiedVoiceBlocks('3수화물', [a, b])).toEqual(['inventory:a'])
    expect(verifiedVoiceBlocks('hydrated reagent', [a, b])).toEqual(['inventory:a'])
    expect(verifiedVoiceBlocks('except shelf 3', [a, b])).toHaveLength(2)
    expect(verifiedVoiceBlocks('shelf 2 or shelf 3', [a, b])).toHaveLength(2)
    expect(verifiedVoiceBlocks('CAS 127-09-3', [a, { ...a, name: 'Acetate' }])).toEqual([])
  })
  it('uses the normal resolver, sends grouped evidence once, discards query aliases and validates provider output', async () => {
    const api = vi.fn(async () => response('inventory:b'))
    vi.stubGlobal('fetch', api)
    expect(await resolveCandidateWithOpenAI(cfg(), '3번째 선반', 'ko', [a, b], 'hash')).toBeNull()
    const [url, init] = api.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/responses')
    const body = JSON.parse(init.body as string)
    expect(JSON.parse(body.input[1].content).evidence.groups).toHaveLength(2)
    expect(body).toMatchObject({ store: false, safety_identifier: 'hash' })
    api.mockImplementationOnce(async () => response('inventory:a'))
    expect(await resolveCandidateWithOpenAI(cfg(), '3번째 선반', 'ko', [a, b], 'hash')).toMatchObject({
      candidateId: 'inventory:a',
      queryAliases: [],
    })
    expect(api).toHaveBeenCalledTimes(2)
  })
  it('keeps both arms on the same 120 bottles and preserves duplicate blocks and the Decisions 0.85 threshold', async () => {
    const entries = [a, b, ...Array.from({ length: 120 }, (_, i) => bottle('extra' + i, 'other ' + i, '', 1))]
    const r = buildVerifiedVoiceTask('find Sodium acetate anhydrous', 'en', entries, 'hash', 'responses')
    const d = buildVerifiedVoiceTask('find Sodium acetate anhydrous', 'en', entries, 'hash', 'decisions')
    expect(r.input).toBe(d.input)
    expect(r.choices).toHaveLength(121)
    expect(r.blockedChoices).toEqual(d.blockedChoices)
    expect(r.choices.some((x) => x.value === 'inventory:extra119')).toBe(false)
    const dupe = buildVerifiedVoiceTask('acetate', 'en', [a, { ...a, id: 'copy' }], 'hash', 'responses')
    expect(dupe.blockedChoices).toEqual(['inventory:a', 'inventory:copy'])
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          model: 'gpt-6-luna',
          answers: [
            {
              type: 'choice',
              name: 'voiceCandidate',
              choice: 'inventory:a',
              confidence: 0.1,
              probabilities: d.choices.map((c) => ({
                value: c.value,
                probability: c.value === 'inventory:a' ? 0.85 : c.value === d.abstain ? 0.15 : 0,
              })),
            },
          ],
        }),
      ),
    )
    expect(await evaluateSelectionPolicy(cfg(), d)).toMatchObject({ choice: 'inventory:a' })
  })
  it('does not call a second model on errors, refusal, unknown IDs, or low confidence', async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          id: 'r',
          status: 'completed',
          model: 'gpt-6-luna',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'Declined' }] }],
        }),
      )
      .mockResolvedValueOnce(response('inventory:elsewhere'))
      .mockResolvedValueOnce(response('inventory:a', 0.2))
    vi.stubGlobal('fetch', api)
    for (let i = 0; i < 4; i++)
      expect(await resolveCandidateWithOpenAI(cfg(), 'acetate', 'en', [a, b], 'hash')).toBeNull()
    expect(api).toHaveBeenCalledTimes(4)
  })
  it('returns only the primary selection and its aliases in verified shadow', async () => {
    const jobs: Promise<unknown>[] = []
    const api = vi.fn().mockResolvedValueOnce(response('inventory:b')).mockResolvedValueOnce(response('inventory:a'))
    vi.stubGlobal('fetch', api)
    const selected = await resolveCandidateWithOpenAI(cfg('shadow'), 'acetate', 'en', [a, b], 'hash', {
      waitUntil: (p) => jobs.push(p),
    })
    await Promise.all(jobs)
    expect(jobs).toHaveLength(1)
    expect(selected).toMatchObject({ candidateId: 'inventory:b', queryAliases: ['must not learn'] })
    expect(api).toHaveBeenCalledTimes(2)
  })
})
