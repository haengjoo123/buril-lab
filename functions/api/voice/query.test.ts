import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}))

import { filterVoiceMatchesToLab, isDisposalSafetyQuery, onRequestPost } from './query'
import type { VoiceMatch } from '../../../src/utils/voiceAgent'

const LAB_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_LAB_ID = '22222222-2222-4222-8222-222222222222'

class QueryBuilder {
  readonly eqCalls: Array<[string, string]> = []
  selectValue = ''

  constructor(
    private readonly result: { data: unknown; error: { message: string } | null },
  ) {}

  select(value: string) {
    this.selectValue = value
    return this
  }

  eq(column: string, value: string) {
    this.eqCalls.push([column, value])
    return this
  }

  limit() {
    return Promise.resolve(this.result)
  }

  maybeSingle() {
    return Promise.resolve(this.result)
  }

  insert() {
    return Promise.resolve(this.result)
  }
}

function createRequest(body: unknown) {
  return new Request('https://example.com/api/voice/query', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer valid-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

describe('voice query lab scope', () => {
  beforeEach(() => {
    createClientMock.mockReset()
    vi.restoreAllMocks()
  })

  it('removes matches outside the selected lab as a server-side safeguard', () => {
    const matches = [
      { source: 'inventory', id: 'a', name: 'Acetone', labId: LAB_ID, matchedBy: 'name_exact' },
      { source: 'inventory', id: 'b', name: 'Acetone', labId: OTHER_LAB_ID, matchedBy: 'name_exact' },
    ] satisfies VoiceMatch[]

    expect(filterVoiceMatchesToLab(matches, LAB_ID)).toEqual([matches[0]])
  })

  it.each([
    '아세톤 폐기 방법 알려줘',
    '이거 버리려면 어떻게 해',
    '산과 염기를 혼합해도 돼?',
    '물을 넣어서 희석할까?',
    '중화한 뒤 처리해도 되나요',
    '배수구로 흘려보내도 돼?',
    '싱크대에 버려 줘',
    '폐액통에 부어도 될까',
    '이 용기에 넣어 줘',
    'How should I dispose of acetone?',
    'Can I throw this away?',
    'Mix these two reagents',
    'Should I dilute this with water?',
    'Can I neutralize the acid?',
    'Pour it down the drain',
    'Put this into the waste bottle',
  ])('recognizes unsafe disposal wording without AI: %s', (text) => {
    expect(isDisposalSafetyQuery(text)).toBe(true)
  })

  it('redirects disposal wording before AI, Supabase, or inventory calls', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await onRequestPost({
      request: createRequest({
        text: '폐액통에 부어서 처리해도 돼?',
        source: 'typed',
        context: { labId: LAB_ID, language: 'ko' },
      }),
      env: {},
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      intent: 'disposal',
      match: null,
      uiAction: { type: 'open_waste_batch_review' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('requires a current lab before querying any inventory', async () => {
    const response = await onRequestPost({
      request: createRequest({ text: 'Where is acetone?', source: 'typed' }),
      env: { GEMINI_API_KEY: 'gemini-key' },
    })

    expect(response.status).toBe(400)
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('checks membership and filters every candidate source to the current lab', async () => {
    const builders = new Map<string, QueryBuilder>()
    const from = vi.fn((table: string) => {
      const result = table === 'lab_members'
        ? { data: { lab_id: LAB_ID }, error: null }
        : { data: [], error: null }
      const builder = new QueryBuilder(result)
      builders.set(table, builder)
      return builder
    })

    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
      from,
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                intent: 'location',
                reagentQuery: 'acetone',
                queryAliases: [],
                language: 'en',
                confidence: 0.95,
              }),
            }],
          },
        }],
      }),
    }))

    const response = await onRequestPost({
      request: createRequest({
        text: 'Where is acetone?',
        source: 'typed',
        context: { labId: LAB_ID, language: 'en' },
      }),
      env: {
        GEMINI_API_KEY: 'gemini-key',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_ANON_KEY: 'anon-key',
      },
    })

    expect(response.status).toBe(200)
    expect(builders.get('lab_members')?.eqCalls).toEqual([
      ['lab_id', LAB_ID],
      ['user_id', 'user-1'],
    ])
    expect(builders.get('cabinet_items')?.selectValue).toContain('cabinets!inner')
    expect(builders.get('cabinet_items')?.eqCalls).toContainEqual(['cabinets.lab_id', LAB_ID])
    expect(builders.get('inventory')?.eqCalls).toContainEqual(['lab_id', LAB_ID])
    expect(builders.get('reagent_aliases')?.eqCalls).toContainEqual(['lab_id', LAB_ID])
  })

  it('redirects an AI-classified indirect disposal request before inventory queries', async () => {
    const from = vi.fn((table: string) => {
      const result = table === 'lab_members'
        ? { data: { lab_id: LAB_ID }, error: null }
        : { data: [], error: null }
      return new QueryBuilder(result)
    })
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from,
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          intent: 'disposal',
          reagentQuery: 'acetone',
          queryAliases: [],
          language: 'en',
          confidence: 0.9,
        }) }] } }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await onRequestPost({
      request: createRequest({
        text: 'What should happen to acetone when I am finished?',
        source: 'typed',
        context: { labId: LAB_ID, language: 'en' },
      }),
      env: {
        GEMINI_API_KEY: 'gemini-key',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_ANON_KEY: 'anon-key',
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      intent: 'disposal',
      uiAction: { type: 'open_waste_batch_review' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith('lab_members')
  })
})
