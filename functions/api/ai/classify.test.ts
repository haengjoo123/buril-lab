import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  generateClassificationCacheKey,
  onRequestPost,
  parseClassificationResponse,
} from './classify'

const originalFetch = globalThis.fetch

function createRequest() {
  return new Request('https://example.com/api/ai/classify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chemical: {
        name: 'Unknown sample',
        molecularFormula: 'C3H6O',
        casNumber: '67-64-1',
      },
    }),
  })
}

function mockOpenAIText(text: string) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    id: 'resp_test',
    object: 'response',
    status: 'completed',
    model: 'gpt-5.6-luna',
    output: [{
      id: 'msg_test',
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text, annotations: [] }],
    }],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })))
}

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

const env = {
  OPENAI_API_KEY: 'test-key',
  OPENAI_SAFETY_HMAC_SECRET: 'test-safety-secret-at-least-32-bytes',
}
const data = { userId: 'user-123' }

describe('structured OpenAI chemical classification', () => {
  it('uses the OpenAI-isolated v3 cache namespace', () => {
    expect(generateClassificationCacheKey({ name: 'Acetone' })).toMatch(/^classify:v3:/)
  })

  it('accepts an exact category from the JSON field', () => {
    expect(parseClassificationResponse(JSON.stringify({
      category: 'ORGANIC_NON_HALOGEN',
      confidence: 0.92,
      reason: '비할로겐 유기용매로 확인됨',
    }))).toEqual({
      category: 'ORGANIC_NON_HALOGEN',
      confidence: 0.92,
      reason: '비할로겐 유기용매로 확인됨',
    })
  })

  it('does not select the first category mentioned in an explanation', async () => {
    mockOpenAIText('산성 물질처럼 보이지만, 실제로는 비할로겐 유기 폐액으로 처리하는 것이 적절합니다.')

    const response = await onRequestPost({
      request: createRequest(),
      env,
      data,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      category: 'UNKNOWN',
      responseSource: 'deterministic',
    })
  })

  it('does not accept an invalid category even when the JSON is otherwise valid', () => {
    expect(parseClassificationResponse(JSON.stringify({
      category: 'ACID_ORGANIC_NON_HALOGEN',
      confidence: 0.9,
      reason: 'ambiguous',
    }))).toBeNull()
  })

  it('returns the exact JSON category and metadata without scanning the explanation', async () => {
    mockOpenAIText(JSON.stringify({
      category: 'ORGANIC_NON_HALOGEN',
      confidence: 0.92,
      reason: '산성으로 보일 수 있지만 실제 결론은 비할로겐 유기 폐액임',
    }))

    const response = await onRequestPost({
      request: createRequest(),
      env,
      data,
    })

    expect(await response.json()).toEqual({
      category: 'ORGANIC_NON_HALOGEN',
      confidence: 0.92,
      reason: '산성으로 보일 수 있지만 실제 결론은 비할로겐 유기 폐액임',
      responseSource: 'ai',
    })
  })
})
