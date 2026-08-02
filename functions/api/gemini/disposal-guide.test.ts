import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildStructuredDisposalGuide,
  generateDisposalGuideCacheKey,
  onRequestPost,
  parseDisposalGuideJson,
  type DisposalGuideRequestInput,
} from './disposal-guide'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

const readyInput: DisposalGuideRequestInput = {
  chemicals: [{
    name: 'Acetone',
    casNumber: '67-64-1',
    category: 'ORGANIC_NON_HALOGEN',
    hazardFlags: ['FLAMMABLE'],
    ghs: { signalWord: 'Danger', hCodes: ['H225'] },
  }],
  batch: {
    matrix: 'organic_non_halogenated',
    amount: { value: 500, unit: 'mL' },
  },
  decision: {
    decisionStatus: 'ready',
    streamCode: 'ORGANIC_NON_HALOGENATED',
    allowedActions: ['container_deposit'],
    policyVersion: 'policy-2026-01',
    ruleVersion: 'rules-2.0.0',
  },
  policy: {
    version: 'policy-2026-01',
    streams: [{
      streamCode: 'ORGANIC_NON_HALOGENATED',
      name: '비할로겐 유기 폐액통',
      location: '폐기물 보관실 A열',
      labelInstructions: ['Acetone과 총량을 기록'],
      evidence: [{ id: 'policy-stream', sourceType: 'policy', title: '기관 유기폐액 지침' }],
    }],
  },
}

function createRequest(body: unknown) {
  return new Request('https://example.com/api/gemini/disposal-guide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('disposal guide V3 parser and safety boundary', () => {
  it('extracts structured JSON from a fenced model response', () => {
    const parsed = parseDisposalGuideJson(`\n\`\`\`json\n{
      "summary": "안내",
      "steps": ["용기를 밀폐하세요."]
    }\n\`\`\`\n`)

    expect(parsed).toEqual({
      summary: '안내',
      steps: ['용기를 밀폐하세요.'],
    })
  })

  it('keeps the deterministic stream and removes unsafe generated procedures', () => {
    const result = buildStructuredDisposalGuide(readyInput, {
      summary: '빨간 폐액통에 넣고 배수구로 남은 액을 버리세요.',
      destination: {
        streamCode: 'ACID_AQUEOUS',
        name: '빨간 폐액통',
        location: '임의 위치',
      },
      steps: [
        '물로 희석한 뒤 중화하세요.',
        '비할로겐 유기 폐액통에 입고하고 라벨을 확인하세요.',
        '빨간 폐액통에 넣으세요.',
      ],
      prohibitions: [
        '남은 액은 배수구에 버리세요.',
        '임의로 중화하지 마세요.',
        '빨간 폐액통을 사용하세요.',
      ],
      missingInputs: ['모델이 만든 질문'],
      evidence: [{ id: 'invented-sop' }],
    })

    expect(result.decisionStatus).toBe('ready')
    expect(result.destination).toMatchObject({
      streamCode: 'ORGANIC_NON_HALOGENATED',
      name: '비할로겐 유기 폐액통',
      location: '폐기물 보관실 A열',
      depositAllowed: true,
    })
    expect(result.summary).not.toContain('배수구')
    expect(result.steps).toContain('비할로겐 유기 폐액통에 입고하고 라벨을 확인하세요.')
    expect(result.steps.some((step) => step.includes('보안경'))).toBe(true)
    expect(result.steps.some((step) => step.includes('2차 운반 용기'))).toBe(true)
    expect(result.steps.some((step) => step.includes('폐기물 보관실 A열'))).toBe(true)
    expect(result.prohibitions).toContain('임의로 중화하지 마세요.')
    expect(result.prohibitions).not.toContain('남은 액은 배수구에 버리세요.')
    expect(result.prohibitions).not.toContain('빨간 폐액통을 사용하세요.')
    expect(result.missingInputs).toEqual([])
    expect(result.evidence.some((item) => item.id === 'invented-sop')).toBe(false)
    expect(result.evidence.some((item) => item.id === 'policy-stream')).toBe(true)
  })

  it('forces acid and cyanide mixtures to blocked even if input or AI says ready', () => {
    const result = buildStructuredDisposalGuide({
      chemicals: [
        { name: 'Hydrochloric acid', category: 'ACID', hazardFlags: ['ACID'] },
        { name: 'Sodium cyanide', category: 'CYANIDE', hazardFlags: ['CYANIDE'] },
      ],
      batch: { matrix: 'aqueous' },
      decision: {
        decisionStatus: 'ready',
        streamCode: 'CYANIDE_SULFIDE',
        allowedActions: ['container_deposit', 'isolated', 'handover'],
      },
    }, {
      summary: '시안 폐액통에 바로 넣으세요.',
      steps: ['시안 폐액통에 입고하세요.'],
      prohibitions: [],
    })

    expect(result.decisionStatus).toBe('blocked')
    expect(result.destination).toEqual({
      streamCode: null,
      name: '일반 폐액통 입고 불가',
      location: null,
      labelInstructions: [],
      depositAllowed: false,
    })
    expect(result.steps.join(' ')).not.toContain('입고하세요')
    expect(result.steps.join(' ')).toContain('분리 보관')
    expect(result.guide).toContain('일반 폐액통에 바로 입고할 수 없습니다')
  })

  it('returns a useful non-error fallback when Gemini is not configured', async () => {
    const response = await onRequestPost({
      request: createRequest(readyInput),
      env: {},
    })
    const payload = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(payload.availability).toBe('unavailable')
    expect(payload.availabilityReason).toBe('not_configured')
    expect(payload.responseSource).toBe('deterministic')
    expect(payload.summary).toContain('비할로겐 유기 폐액통')
    expect(payload.guide).toContain('처리 순서')
    expect(payload).not.toHaveProperty('error')
  })

  it('returns the deterministic guide when Gemini returns invalid JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'not-json' }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch

    const response = await onRequestPost({
      request: createRequest(readyInput),
      env: { GEMINI_API_KEY: 'test-key' },
    })
    const payload = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(payload.availability).toBe('unavailable')
    expect(payload.availabilityReason).toBe('upstream_error')
    expect(payload.responseSource).toBe('deterministic')
    expect(payload).not.toHaveProperty('error')
  })

  it('returns the deterministic guide when the Gemini request fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network timeout')) as typeof fetch

    const response = await onRequestPost({
      request: createRequest(readyInput),
      env: { GEMINI_API_KEY: 'test-key' },
    })
    const payload = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(payload.availability).toBe('unavailable')
    expect(payload.availabilityReason).toBe('upstream_error')
    expect(payload.responseSource).toBe('deterministic')
  })

  it('includes batch, policy and rule context in the cache key', () => {
    const baseKey = generateDisposalGuideCacheKey(readyInput)
    const reorderedKey = generateDisposalGuideCacheKey({
      ...readyInput,
      chemicals: [...(readyInput.chemicals || [])].reverse(),
    })
    const amountKey = generateDisposalGuideCacheKey({
      ...readyInput,
      batch: { ...readyInput.batch, amount: { value: 1, unit: 'L' } },
    })
    const policyKey = generateDisposalGuideCacheKey({
      ...readyInput,
      policy: { ...readyInput.policy, version: 'policy-2026-02' },
    })
    const ruleKey = generateDisposalGuideCacheKey({
      ...readyInput,
      ruleVersion: 'rules-2.1.0',
    })

    expect(reorderedKey).toBe(baseKey)
    expect(amountKey).not.toBe(baseKey)
    expect(policyKey).not.toBe(baseKey)
    expect(ruleKey).not.toBe(baseKey)
  })
})
