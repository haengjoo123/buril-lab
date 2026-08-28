import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveSttModel, resolveTtsModel, resolveTtsVoice } from './_shared'
import { onRequestPost as speak } from './speak'
import { onRequestPost as transcribe } from './transcribe'

const originalFetch = globalThis.fetch
const env = {
  OPENAI_API_KEY: 'test-key',
  OPENAI_AUDIO_ENABLED: 'true',
}

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('OpenAI audio configuration and fallbacks', () => {
  it('defaults to GPT Transcribe and keeps the configured TTS model and voice', () => {
    expect(resolveSttModel({})).toBe('gpt-transcribe')
    expect(resolveTtsModel({})).toBe('gpt-4o-mini-tts')
    expect(resolveTtsVoice({})).toBe('alloy')
  })

  it('returns the GPT Transcribe model in the existing STT response contract', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      text: 'acetone',
      usage: { type: 'duration', seconds: 1.25 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const form = new FormData()
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'sample.webm', { type: 'audio/webm' }))

    const response = await transcribe({
      request: new Request('https://example.com/api/voice/transcribe', {
        method: 'POST',
        body: form,
      }),
      env,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      text: 'acetone',
      durationMs: 1_250,
      model: 'gpt-transcribe',
    })
  })

  it('keeps TTS on gpt-4o-mini-tts/alloy and returns audio bytes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await speak({
      request: new Request('https://example.com/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '안녕하세요' }),
      }),
      env,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
    })
  })

  it('returns existing safe error responses when STT or TTS upstream fails', async () => {
    const upstreamFailure = () => new Response(JSON.stringify({
      error: { message: 'upstream unavailable' },
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'retry-after-ms': '0' },
    })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(upstreamFailure))
    const form = new FormData()
    form.set('file', new File([new Uint8Array([1])], 'sample.webm', { type: 'audio/webm' }))

    const transcriptionResponse = await transcribe({
      request: new Request('https://example.com/api/voice/transcribe', { method: 'POST', body: form }),
      env,
    })
    const speechResponse = await speak({
      request: new Request('https://example.com/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'test' }),
      }),
      env,
    })

    expect(transcriptionResponse.status).toBe(503)
    expect(speechResponse.status).toBe(503)
    await expect(transcriptionResponse.json()).resolves.toMatchObject({ code: 'openai_error' })
    await expect(speechResponse.json()).resolves.toMatchObject({ code: 'openai_error' })
  })
})
