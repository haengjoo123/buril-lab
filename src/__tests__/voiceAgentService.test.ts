import { beforeEach, describe, expect, it, vi } from 'vitest'

const { postJsonMock, insertMock } = vi.hoisted(() => ({
  postJsonMock: vi.fn(),
  insertMock: vi.fn(),
}))

vi.mock('../services/internalApi', () => ({
  postJson: postJsonMock,
}))

vi.mock('../services/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: insertMock,
    })),
  },
}))

vi.mock('../store/useLabStore', () => ({
  useLabStore: {
    getState: () => ({
      currentLabId: 'lab-123',
    }),
  },
}))

import { queryVoiceAgent, submitVoiceQueryFeedback } from '../services/voiceAgentService'

describe('voiceAgentService', () => {
  beforeEach(() => {
    postJsonMock.mockReset()
    insertMock.mockReset()
  })

  it('posts the voice query payload to the internal route', async () => {
    postJsonMock.mockResolvedValue({
      resolvedText: 'sodium nitrate',
      intent: 'location',
      answerText: 'found it',
      speech: { mode: 'remote_audio', text: 'found it' },
      match: null,
      uiAction: { type: 'none' },
      clarification: null,
    })

    const result = await queryVoiceAgent({
      text: 'sodium nitrate location',
      source: 'voice',
      context: {
        screen: 'search',
        language: 'en',
      },
    })

    expect(postJsonMock).toHaveBeenCalledWith('/api/voice/query', {
      text: 'sodium nitrate location',
      source: 'voice',
      context: {
        screen: 'search',
        language: 'en',
      },
    })
    expect(result.answerText).toBe('found it')
  })

  it('inserts feedback with the active lab id', async () => {
    insertMock.mockResolvedValue({ error: null })

    await submitVoiceQueryFeedback({
      rawInput: '나오쓰 위치',
      normalizedQuery: 'sodium nitrate',
      intent: 'location',
      failureReason: 'user_corrected',
      correctionText: 'sodium nitrate',
    })

    expect(insertMock).toHaveBeenCalledWith({
      raw_input: '나오쓰 위치',
      normalized_query: 'sodium nitrate',
      intent: 'location',
      failure_reason: 'user_corrected',
      correction_text: 'sodium nitrate',
      selected_match_source: null,
      selected_match_id: null,
      metadata: {},
      lab_id: 'lab-123',
    })
  })
})
