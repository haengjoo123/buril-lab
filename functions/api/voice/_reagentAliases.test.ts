import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VoiceMatch } from '../../../src/utils/voiceAgent'
import { resolveCandidateWithOpenAI } from './_reagentAliases'

const originalFetch = globalThis.fetch
const matches: VoiceMatch[] = [
  { source: 'inventory', id: 'one', name: 'Acetone', matchedBy: 'contains' },
  { source: 'inventory', id: 'two', name: 'Acetonitrile', matchedBy: 'contains' },
]

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

function modelResponse(candidateId: string, confidence: number) {
  return new Response(JSON.stringify({
    id: 'resp_candidate',
    object: 'response',
    status: 'completed',
    model: 'gpt-5.6-luna',
    output: [{
      id: 'msg_candidate',
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{
        type: 'output_text',
        text: JSON.stringify({ candidateId, confidence, queryAliases: ['acetone'] }),
        annotations: [],
      }],
    }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('ambiguous voice candidate resolution', () => {
  it('keeps an ambiguous candidate unresolved when the model is uncertain', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(modelResponse('', 0.2)))

    await expect(resolveCandidateWithOpenAI(
      { OPENAI_API_KEY: 'test-key' },
      'acetone 계열 시약 어디 있어',
      'ko',
      matches,
      '0'.repeat(64),
    )).resolves.toBeNull()
  })

  it('rejects a candidate id that was not supplied by the inventory query', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(modelResponse('inventory:other', 0.99)))

    await expect(resolveCandidateWithOpenAI(
      { OPENAI_API_KEY: 'test-key' },
      'acetone',
      'en',
      matches,
      '0'.repeat(64),
    )).resolves.toBeNull()
  })
})
