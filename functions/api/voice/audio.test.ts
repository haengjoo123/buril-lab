import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpenAIClient, openAIErrorResponse, resolveSttModel, resolveTtsModel, resolveTtsVoice } from './_shared'
import { MAX_SPEECH_REQUEST_BYTES, onRequestPost as speak } from './speak'
import { MAX_AUDIO_FILE_BYTES, MAX_AUDIO_REQUEST_BYTES, onRequestPost as transcribe } from './transcribe'

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
  it('bounds provider wait time and never retries a paid audio request automatically', () => {
    const client = createOpenAIClient(env)
    expect(client.timeout).toBe(30_000)
    expect(client.maxRetries).toBe(0)
  })
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
    await expect(transcriptionResponse.json()).resolves.toEqual({
      error: 'Failed to transcribe audio.', code: 'openai_error',
    })
    await expect(speechResponse.json()).resolves.toEqual({
      error: 'Failed to synthesize speech.', code: 'openai_error',
    })
  })
})

describe('audio input boundary', () => {
  it.each([null, [], 'text', 1, { text: 1 }, { text: 'ok', voice: {} }, { text: 'ok', format: null }, { text: 'ok', format: 'zip' }])(
    'rejects malformed speech input without calling OpenAI: %#', async (body) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const response = await speak({
        request: new Request('https://example.com/api/voice/speak', { method: 'POST', body: JSON.stringify(body) }), env,
      })
      expect(response.status).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('rejects oversized speech JSON before reading the body', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const request = new Request('https://example.com/api/voice/speak', {
      method: 'POST', body: '{"text":"ok"}',
      headers: { 'Content-Length': String(MAX_SPEECH_REQUEST_BYTES + 1) },
    })
    const readerSpy = vi.spyOn(request.body!, 'getReader')
    const response = await speak({ request, env })
    expect(response.status).toBe(413)
    expect(readerSpy).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects oversized multipart input before reading the body', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const request = new Request('https://example.com/api/voice/transcribe', {
      method: 'POST', body: 'unused', headers: {
        'Content-Type': 'multipart/form-data; boundary=test', 'Content-Length': String(MAX_AUDIO_REQUEST_BYTES + 1),
      },
    })
    const readerSpy = vi.spyOn(request.body!, 'getReader')
    const response = await transcribe({ request, env })
    expect(response.status).toBe(413)
    expect(readerSpy).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('checks the actual audio file limit when Content-Length is absent', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const form = new FormData()
    form.set('file', new File([new Uint8Array(MAX_AUDIO_FILE_BYTES + 1)], 'oversized.webm', { type: 'audio/webm' }))
    const response = await transcribe({
      request: new Request('https://example.com/api/voice/transcribe', { method: 'POST', body: form }), env,
    })
    expect(response.status).toBe(413)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects malformed multipart input without an upstream request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await transcribe({
      request: new Request('https://example.com/api/voice/transcribe', {
        method: 'POST', body: 'broken', headers: { 'Content-Type': 'multipart/form-data; boundary=missing' },
      }), env,
    })
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('OpenAI audio error boundary', () => {
  it.each([
    new Error('SENSITIVE_PROVIDER_DETAIL'),
    { message: 'SENSITIVE_PROVIDER_DETAIL', status: 401 },
    { error: { message: 'SENSITIVE_PROVIDER_DETAIL' }, status: 403 },
    { message: 'SENSITIVE_PROVIDER_DETAIL', status: 400.5 },
    { message: 'SENSITIVE_PROVIDER_DETAIL', status: 399 },
    { message: 'SENSITIVE_PROVIDER_DETAIL', status: 600 },
    { message: 'SENSITIVE_PROVIDER_DETAIL', status: Number.NaN },
    { message: 'SENSITIVE_PROVIDER_DETAIL', status: '429' },
    null,
  ])('does not expose upstream details or accept invalid status values: %#', async (error) => {
    const response = openAIErrorResponse(error, 'Audio is temporarily unavailable.')
    expect(response.status).toBe(502)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      error: 'Audio is temporarily unavailable.', code: 'openai_error',
    })
  })

  it.each([400, 408, 413, 422, 429, 500, 502, 503, 504])('keeps HTTP %i without exposing the provider message', async (status) => {
    const response = openAIErrorResponse({ status, message: 'SENSITIVE_PROVIDER_DETAIL' }, 'Audio request failed.')
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual({
      error: 'Audio request failed.', code: 'openai_error',
    })
  })
})
