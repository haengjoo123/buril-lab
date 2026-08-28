import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  createOpenAIResponsesClient,
  createSafetyIdentifier,
  OPENAI_RESPONSES_MAX_RETRIES,
  OPENAI_RESPONSES_TIMEOUT_MS,
  parseOpenAIResponse,
} from './_openai'

const originalFetch = globalThis.fetch
const env = {
  OPENAI_API_KEY: 'test-key',
  OPENAI_RESPONSES_MODEL: 'gpt-5.6-luna',
  OPENAI_SAFETY_HMAC_SECRET: 'test-safety-secret-at-least-32-bytes',
}

function responsePayload(
  text: string,
  options: { status?: 'completed' | 'incomplete'; refusal?: boolean } = {},
) {
  const content = options.refusal
    ? [{ type: 'refusal', refusal: 'Unable to comply.' }]
    : [{ type: 'output_text', text, annotations: [] }]

  return {
    id: 'resp_test',
    object: 'response',
    status: options.status || 'completed',
    model: 'gpt-5.6-luna',
    output: [{
      id: 'msg_test',
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content,
    }],
  }
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'retry-after-ms': '0',
    },
  })
}

async function readRequestBody(call: unknown[]): Promise<Record<string, unknown>> {
  const [input, init] = call as [RequestInfo | URL, RequestInit | undefined]
  if (typeof init?.body === 'string') {
    return JSON.parse(init.body) as Record<string, unknown>
  }
  if (input instanceof Request) {
    return await input.clone().json() as Record<string, unknown>
  }
  throw new Error('OpenAI request body was not available.')
}

afterEach(() => {
  vi.useRealTimers()
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('OpenAI Responses privacy and reliability policy', () => {
  it('creates a stable, non-reversible 64-character safety identifier', async () => {
    const first = await createSafetyIdentifier(env, 'user-123')
    const same = await createSafetyIdentifier(env, 'user-123')
    const other = await createSafetyIdentifier(env, 'user-456')

    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(first).toBe(same)
    expect(first).not.toBe(other)
    expect(first).not.toContain('user-123')
  })

  it('configures the SDK with the fixed timeout and retry limits', () => {
    const client = createOpenAIResponsesClient(env)

    expect(client.timeout).toBe(OPENAI_RESPONSES_TIMEOUT_MS)
    expect(client.maxRetries).toBe(OPENAI_RESPONSES_MAX_RETRIES)
    expect(OPENAI_RESPONSES_TIMEOUT_MS).toBe(20_000)
    expect(OPENAI_RESPONSES_MAX_RETRIES).toBe(2)
  })

  it('forces the model, no reasoning, no storage, HMAC identifier, and Structured Outputs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(responsePayload('{"value":"ok"}')))
    vi.stubGlobal('fetch', fetchMock)
    const safetyIdentifier = await createSafetyIdentifier(env, 'user-123')

    const result = await parseOpenAIResponse(env, {
      input: 'Return a structured value.',
      maxOutputTokens: 400,
      safetyIdentifier,
      schema: z.object({ value: z.string() }),
      schemaName: 'test_value',
    })

    expect(result.data).toEqual({ value: 'ok' })
    const body = await readRequestBody(fetchMock.mock.calls[0])
    expect(body).toMatchObject({
      model: 'gpt-5.6-luna',
      max_output_tokens: 400,
      reasoning: { effort: 'none' },
      safety_identifier: safetyIdentifier,
      store: false,
      text: { format: { type: 'json_schema', name: 'test_value', strict: true } },
    })
  })

  it('retries retryable failures twice without changing models', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'busy' } }, 503))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'busy' } }, 429))
      .mockResolvedValueOnce(jsonResponse(responsePayload('{"value":"ok"}')))
    vi.stubGlobal('fetch', fetchMock)

    await expect(parseOpenAIResponse(env, {
      input: 'Return a structured value.',
      maxOutputTokens: 400,
      safetyIdentifier: await createSafetyIdentifier(env, 'user-123'),
      schema: z.object({ value: z.string() }),
      schemaName: 'test_retry',
    })).resolves.toMatchObject({ data: { value: 'ok' } })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const bodies = await Promise.all(fetchMock.mock.calls.map(readRequestBody))
    expect(bodies.map((body) => body.model)).toEqual([
      'gpt-5.6-luna',
      'gpt-5.6-luna',
      'gpt-5.6-luna',
    ])
  })

  it('aborts timed-out requests and stops after the configured retries', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      })
    ))
    vi.stubGlobal('fetch', fetchMock)

    const pending = parseOpenAIResponse(env, {
      input: 'Return a structured value.',
      maxOutputTokens: 400,
      safetyIdentifier: await createSafetyIdentifier(env, 'user-123'),
      schema: z.object({ value: z.string() }),
      schemaName: 'test_timeout',
    })
    const rejection = expect(pending).rejects.toThrow(/timed out|connection/i)

    await vi.advanceTimersByTimeAsync(90_000)
    await rejection
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('rejects incomplete and refused responses instead of guessing', async () => {
    const incompleteFetch = vi.fn().mockResolvedValue(jsonResponse(responsePayload(
      '{"value":"partial"}',
      { status: 'incomplete' },
    )))
    vi.stubGlobal('fetch', incompleteFetch)

    await expect(parseOpenAIResponse(env, {
      input: 'Return a structured value.',
      maxOutputTokens: 400,
      safetyIdentifier: await createSafetyIdentifier(env, 'user-123'),
      schema: z.object({ value: z.string() }),
      schemaName: 'test_incomplete',
    })).rejects.toThrow(/incomplete/)

    const refusalFetch = vi.fn().mockResolvedValue(jsonResponse(responsePayload(
      '',
      { refusal: true },
    )))
    vi.stubGlobal('fetch', refusalFetch)

    await expect(parseOpenAIResponse(env, {
      input: 'Return a structured value.',
      maxOutputTokens: 400,
      safetyIdentifier: await createSafetyIdentifier(env, 'user-123'),
      schema: z.object({ value: z.string() }),
      schemaName: 'test_refusal',
    })).rejects.toThrow(/refused/)
  })
})
