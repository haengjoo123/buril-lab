import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, fetchMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  fetchMock: vi.fn(),
}))

vi.mock('../services/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
    },
  },
}))

vi.mock('../services/apiUrl', () => ({
  getInternalApiUrl: (path: string) => `https://example.test${path}`,
}))

import { speakText, transcribeAudio } from '../services/openaiVoiceService'

describe('openaiVoiceService', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    getSessionMock.mockReset()
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          access_token: 'test-token',
        },
      },
    })

    vi.stubGlobal('fetch', fetchMock)
  })

  it('uploads audio as multipart form-data with auth for transcription', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          text: 'Sodium nitrate location',
          language: 'en',
          durationMs: 1250,
          model: 'whisper-1',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    )

    const file = new File(['audio'], 'question.m4a', { type: 'audio/mp4' })
    const result = await transcribeAudio(file, {
      language: 'en',
      prompt: 'laboratory reagent names',
    })

    expect(result).toEqual({
      text: 'Sodium nitrate location',
      language: 'en',
      durationMs: 1250,
      model: 'whisper-1',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit]

    expect(url).toBe('https://example.test/api/voice/transcribe')
    expect(requestInit.method).toBe('POST')
    expect(requestInit.headers).toEqual({
      Authorization: 'Bearer test-token',
    })

    const body = requestInit.body as FormData
    expect(body.get('file')).toBe(file)
    expect(body.get('language')).toBe('en')
    expect(body.get('prompt')).toBe('laboratory reagent names')
  })

  it('returns binary speech content and forwards JSON body', async () => {
    fetchMock.mockResolvedValue(
      new Response('voice-bytes', {
        status: 200,
        headers: {
          'Content-Type': 'audio/mpeg',
        },
      }),
    )

    const result = await speakText('Hello lab', { voice: 'alloy', format: 'mp3' })

    expect(result.contentType).toBe('audio/mpeg')
    expect(await result.blob.text()).toBe('voice-bytes')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://example.test/api/voice/speak')
    expect(requestInit.method).toBe('POST')
    expect(requestInit.headers).toEqual({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    })
    expect(requestInit.body).toBe(JSON.stringify({
      text: 'Hello lab',
      voice: 'alloy',
      format: 'mp3',
    }))
  })

  it('surfaces JSON API errors from the speech endpoint', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'OpenAI audio feature is disabled.' }),
        {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    )

    await expect(speakText('Hello lab')).rejects.toThrow('OpenAI audio feature is disabled.')
  })
})
