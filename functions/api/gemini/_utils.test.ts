import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateGeminiText } from './_utils'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('generateGeminiText timeout', () => {
  it('aborts a stalled upstream request instead of hanging the deterministic fallback', async () => {
    globalThis.fetch = vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    })) as typeof fetch

    await expect(generateGeminiText('test-key', {}, {
      maxRetries: 0,
      timeoutMs: 5,
    })).rejects.toThrow('timed out after 5ms')
  })

  it('rejects an invalid timeout before contacting the upstream service', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as typeof fetch

    await expect(generateGeminiText('test-key', {}, { timeoutMs: 0 }))
      .rejects.toThrow('positive finite number')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
