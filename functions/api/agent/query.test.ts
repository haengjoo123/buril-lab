import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentQueryHandler, type AgentQueryDependencies } from './query'
import type { AgentModeConfig } from './_config'

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const openAIEnv = {
  OPENAI_API_KEY: 'openai-key',
  OPENAI_SAFETY_HMAC_SECRET: 'test-safety-secret-at-least-32-bytes',
}
const STATUS_CAPABILITIES = ['low_stock', 'regulated_list', 'cabinet_locks', 'inspection_gaps', 'purchase_status', 'admin_tasks']
const ACTION_CAPABILITIES = ['log_usage', 'register_item', 'request_purchase']
const ALL_CAPABILITIES = ['item_lookup', 'expiry_list', 'open_screen', ...STATUS_CAPABILITIES, ...ACTION_CAPABILITIES]

function openAIResponse(data: Record<string, unknown>) {
  return new Response(JSON.stringify({
    id: 'resp_agent',
    object: 'response',
    status: 'completed',
    model: 'gpt-6-luna',
    output: [{
      id: 'msg_agent',
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: JSON.stringify(data), annotations: [] }],
    }],
    usage: { input_tokens: 400, output_tokens: 40, total_tokens: 440 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function rawPlan(overrides: Record<string, unknown>) {
  return {
    capability: 'out_of_scope',
    itemText: '',
    itemAliases: [],
    casNumber: '',
    facet: 'none',
    expiryWindow: 'none',
    screen: 'none',
    usageKind: 'none',
    remainingPercent: -1,
    quantity: 0,
    capacityText: '',
    confidence: 0.9,
    ...overrides,
  }
}

function setup(config: AgentModeConfig = { mode: 'read_only', dailyQuota: 100 }) {
  const consumeDailyQuota = vi.fn<AgentQueryDependencies['consumeDailyQuota']>()
    .mockResolvedValue({ allowed: true, remaining: 99, retryAfterSeconds: 3_600 })
  const resolveConfig = vi.fn<AgentQueryDependencies['resolveConfig']>().mockResolvedValue(config)
  const handler = createAgentQueryHandler({ consumeDailyQuota, resolveConfig })
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)

  const call = (body: unknown, options: { userId?: string | null; env?: Record<string, string> } = {}) => handler({
    request: new Request('https://burillab.com/api/agent/query', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token', 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env: options.env ?? openAIEnv,
    data: options.userId === null ? {} : { userId: options.userId ?? USER_ID },
  })
  const ask = (text: string, capabilities: string[] = ALL_CAPABILITIES) => call({
    schemaVersion: 1, text, language: 'ko', capabilities,
  })

  return { ask, call, consumeDailyQuota, fetchMock, resolveConfig }
}

/** The text sent to the model: everything in the OpenAI request body. */
function sentToModel(fetchMock: ReturnType<typeof vi.fn>): string {
  return fetchMock.mock.calls.map(([, init]) => String((init as RequestInit | undefined)?.body ?? '')).join('\n')
}

describe('agent query endpoint', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('requires the user identity that the API middleware verified', async () => {
    const run = setup()
    const response = await run.call({ schemaVersion: 1, text: '만료된 시약 알려줘', language: 'ko', capabilities: [] }, { userId: null })
    expect(response.status).toBe(401)
    expect(run.resolveConfig).not.toHaveBeenCalled()
    expect(run.fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['not json', '{'],
    ['missing text', { schemaVersion: 1, language: 'ko', capabilities: [] }],
    ['blank text', { schemaVersion: 1, text: '   ', language: 'ko', capabilities: [] }],
    ['text over the limit', { schemaVersion: 1, text: '가'.repeat(301), language: 'ko', capabilities: [] }],
    ['unknown language', { schemaVersion: 1, text: '만료된 시약', language: 'ja', capabilities: [] }],
  ])('rejects a malformed request before any model or limiter call: %s', async (_label, body) => {
    const run = setup()
    const response = await run.call(body)
    expect(response.status).toBe(400)
    expect(run.consumeDailyQuota).not.toHaveBeenCalled()
    expect(run.fetchMock).not.toHaveBeenCalled()
  })

  it('tells an app built for another contract version to update', async () => {
    const run = setup()
    const response = await run.call({ schemaVersion: 2, text: '만료된 시약 알려줘', language: 'ko', capabilities: [] })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 'AGENT_UPDATE_REQUIRED' })
  })

  it('stays off until the runtime switch turns it on', async () => {
    const run = setup({ mode: 'off', dailyQuota: 0 })
    const response = await run.ask('만료된 시약 알려줘')
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ code: 'AGENT_DISABLED' })
    expect(run.consumeDailyQuota).not.toHaveBeenCalled()
    expect(run.fetchMock).not.toHaveBeenCalled()
  })

  // The same sentences the voice endpoint must never forward (functions/api/voice/query.test.ts),
  // plus requests about waste records and containers, which this endpoint also keeps from the model.
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
    '폐액통 수거 요청해줘',
    '지난달 폐기 기록 요약해줘',
    '아세톤 200mL랑 메탄올 100mL 섞은 폐액',
  ])('answers waste wording with a fixed redirect and no model call: %s', async (text) => {
    const run = setup()
    const response = await run.ask(text)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ plan: { kind: 'redirect_disposal' }, quotaRemaining: null })
    expect(run.consumeDailyQuota).not.toHaveBeenCalled()
    expect(run.fetchMock).not.toHaveBeenCalled()
  })

  it.each(['67-64-1', 'Acetone', '아세톤', 'A1234-500ML'])(
    'hands a plain identifier to the normal search without a model call: %s',
    async (text) => {
      const run = setup()
      const response = await run.ask(text)
      await expect(response.json()).resolves.toMatchObject({ plan: { kind: 'handoff_search', query: text } })
      expect(run.consumeDailyQuota).not.toHaveBeenCalled()
      expect(run.fetchMock).not.toHaveBeenCalled()
    },
  )

  it('refuses rather than calling the model when the limiter is unavailable', async () => {
    const run = setup()
    run.consumeDailyQuota.mockRejectedValue(new Error('redis token=never-expose'))
    const response = await run.ask('아세톤 어디 있어?')
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(await response.text()).not.toContain('never-expose')
    expect(run.fetchMock).not.toHaveBeenCalled()
  })

  it('stops at the daily allowance without calling the model', async () => {
    const run = setup()
    run.consumeDailyQuota.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 1_800 })
    const response = await run.ask('아세톤 어디 있어?')
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('1800')
    await expect(response.json()).resolves.toMatchObject({ code: 'AGENT_QUOTA_EXCEEDED', retryAfterSeconds: 1_800 })
    expect(run.fetchMock).not.toHaveBeenCalled()
  })

  it('reports itself as not configured when the OpenAI secrets are absent', async () => {
    const run = setup()
    const response = await run.call(
      { schemaVersion: 1, text: '아세톤 어디 있어?', language: 'ko', capabilities: ALL_CAPABILITIES },
      { env: {} },
    )
    expect(response.status).toBe(503)
    expect(run.consumeDailyQuota).not.toHaveBeenCalled()
    expect(run.fetchMock).not.toHaveBeenCalled()
  })

  it('plans an item lookup from the person\'s own words and meters it per user', async () => {
    const run = setup()
    run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({
      capability: 'item_lookup', itemText: '아세톤', itemAliases: ['acetone', '아세톤', '67-64-1'], facet: 'location',
    })))

    const response = await run.ask('아세톤 어디 있어?')

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 1,
      mode: 'read_only',
      plan: {
        kind: 'item_lookup',
        item: { text: '아세톤', aliases: ['acetone'], casNumber: null },
        facet: 'location',
      },
      quotaRemaining: 99,
    })
    expect(run.consumeDailyQuota).toHaveBeenCalledWith(openAIEnv, USER_ID, 100)
    expect(run.fetchMock).toHaveBeenCalledTimes(1)
    // The raw user id never leaves the server; only its keyed hash does.
    expect(sentToModel(run.fetchMock)).not.toContain(USER_ID)
  })

  it('keeps a CAS number only when the person typed it', async () => {
    const run = setup()
    run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({
      capability: 'item_lookup', itemText: '아세톤', casNumber: '67-64-1', facet: 'remaining',
    })))
    const invented = await (await run.ask('아세톤 얼마나 남았어?')).json() as { plan: { item: { casNumber: string | null } } }
    expect(invented.plan.item.casNumber).toBeNull()

    run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({
      capability: 'item_lookup', itemText: '아세톤', casNumber: '67-64-1', facet: 'remaining',
    })))
    const typed = await (await run.ask('아세톤 67-64-1 얼마나 남았어?')).json() as { plan: { item: { casNumber: string | null } } }
    expect(typed.plan.item.casNumber).toBe('67-64-1')
  })

  it('drops a reagent name the person did not type', async () => {
    const run = setup()
    run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({
      capability: 'item_lookup', itemText: 'Hydrofluoric acid', facet: 'location',
    })))
    await expect((await run.ask('그 시약 어디 있어?')).json()).resolves.toMatchObject({
      plan: { kind: 'unsupported', reason: 'low_confidence' },
    })
  })

  it('drops a plan the model was not confident about', async () => {
    const run = setup()
    run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({
      capability: 'expiry_list', expiryWindow: 'expired', confidence: 0.3,
    })))
    await expect((await run.ask('뭔가 좀 알려줘')).json()).resolves.toMatchObject({
      plan: { kind: 'unsupported', reason: 'low_confidence' },
    })
  })

  it('plans expiry lists, screens and substance hand-offs', async () => {
    const run = setup()

    run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({ capability: 'expiry_list' })))
    await expect((await run.ask('유효기한 문제 있는 시약 보여줘')).json()).resolves.toMatchObject({
      plan: { kind: 'expiry_list', window: 'attention' },
    })

    run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({ capability: 'open_screen', screen: 'inspection' })))
    await expect((await run.ask('일상점검 화면 열어줘')).json()).resolves.toMatchObject({
      plan: { kind: 'open_screen', screen: 'inspection' },
    })

    run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({ capability: 'substance_info', itemText: 'sodium chloride' })))
    await expect((await run.ask('sodium chloride 유해성 알려줘')).json()).resolves.toMatchObject({
      plan: { kind: 'handoff_search', query: 'sodium chloride' },
    })
  })

  it.each(STATUS_CAPABILITIES)('plans the status question %s as its name alone', async (capability) => {
    const run = setup()
    // Whatever else the model fills in is dropped: the app answers from its own records.
    run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({
      capability, itemText: '질산', itemAliases: ['nitric acid'], casNumber: '7697-37-2', facet: 'location', screen: 'admin',
    })))
    const body = await (await run.ask('우리 연구실 현황 좀 알려줘')).json() as { plan: unknown }
    expect(body.plan).toEqual({ kind: capability })
  })

  it('does not offer a status capability the app left out, such as admin tasks for a non-admin', async () => {
    const run = setup()
    run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({ capability: 'out_of_scope' })))
    await run.ask('관리자 할 일 알려줘', ['item_lookup', 'expiry_list', 'open_screen'])
    expect(sentToModel(run.fetchMock)).not.toContain('admin_tasks')
  })

  it('offers the model only the capabilities the app declared', async () => {
    const run = setup()
    run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({ capability: 'out_of_scope' })))
    await run.ask('재고 화면 열어줘', ['expiry_list', 'made_up_capability'])

    const sent = sentToModel(run.fetchMock)
    expect(sent).toContain('expiry_list')
    expect(sent).not.toContain('item_lookup')
    expect(sent).not.toContain('open_screen')
    expect(sent).not.toContain('made_up_capability')
  })

  it('treats a capability outside the declared set as unusable even if the model returns it', async () => {
    const run = setup()
    run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({ capability: 'open_screen', screen: 'inventory' })))
    const response = await run.ask('재고 화면 열어줘', ['expiry_list'])
    // The per-request schema rejects the value, so the plan fails instead of running.
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ code: 'AGENT_PLAN_FAILED' })
  })

  describe('proposals to record something', () => {
    const actions = { mode: 'actions', dailyQuota: 100 } as const

    it('offers them to the model only while the runtime switch allows actions', async () => {
      const readOnly = setup()
      readOnly.fetchMock.mockResolvedValue(openAIResponse(rawPlan({ capability: 'out_of_scope' })))
      await readOnly.ask('아세톤 30% 남았다고 기록해줘')
      const sentReadOnly = sentToModel(readOnly.fetchMock)
      for (const capability of ACTION_CAPABILITIES) expect(sentReadOnly).not.toContain(capability)
      expect(sentReadOnly).toContain('including requests to change data,')

      const withActions = setup(actions)
      withActions.fetchMock.mockResolvedValue(openAIResponse(rawPlan({ capability: 'out_of_scope' })))
      const response = await withActions.ask('아세톤 30% 남았다고 기록해줘')
      const sentWithActions = sentToModel(withActions.fetchMock)
      for (const capability of ACTION_CAPABILITIES) expect(sentWithActions).toContain(capability)
      await expect(response.json()).resolves.toMatchObject({ mode: 'actions' })
    })

    it('rejects a write plan in read-only mode even if the model returns one', async () => {
      const run = setup()
      run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({
        capability: 'log_usage', itemText: '아세톤', usageKind: 'remaining', remainingPercent: 30,
      })))
      const response = await run.ask('아세톤 30% 남았다고 기록해줘')
      expect(response.status).toBe(502)
    })

    it('does not offer one the app left out, such as a purchase request in the personal space', async () => {
      const run = setup(actions)
      run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({ capability: 'out_of_scope' })))
      await run.ask('에탄올 2병 구매 요청해줘', ['item_lookup', 'log_usage', 'register_item'])
      expect(sentToModel(run.fetchMock)).not.toContain('request_purchase')
    })

    it('plans a remaining level with the percentage the person typed', async () => {
      const run = setup(actions)
      run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({
        capability: 'log_usage', itemText: '아세톤', itemAliases: ['acetone'], usageKind: 'remaining', remainingPercent: 30,
      })))
      await expect((await run.ask('아세톤 30% 남았다고 기록해줘')).json()).resolves.toMatchObject({
        mode: 'actions',
        plan: {
          kind: 'log_usage',
          item: { text: '아세톤', aliases: ['acetone'], casNumber: null },
          change: { kind: 'remaining', percent: 30 },
        },
      })
    })

    it('leaves the percentage for the person to set when they did not type that number', async () => {
      const run = setup(actions)
      run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({
        capability: 'log_usage', itemText: '아세톤', usageKind: 'remaining', remainingPercent: 50,
      })))
      await expect((await run.ask('아세톤 절반 남았다고 기록해줘')).json()).resolves.toMatchObject({
        plan: { kind: 'log_usage', change: { kind: 'remaining', percent: null } },
      })

      // 130 contains "30", but the person did not type 30.
      run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({
        capability: 'log_usage', itemText: '시약 130', usageKind: 'remaining', remainingPercent: 30,
      })))
      await expect((await run.ask('시약 130 조금 남았다고 기록해줘')).json()).resolves.toMatchObject({
        plan: { kind: 'log_usage', change: { kind: 'remaining', percent: null } },
      })
    })

    it('plans a used-up bottle, and drops a usage plan that says neither', async () => {
      const run = setup(actions)
      run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({
        capability: 'log_usage', itemText: '에탄올', usageKind: 'used_up', remainingPercent: 0,
      })))
      const usedUp = await (await run.ask('에탄올 다 썼다고 기록해줘')).json() as { plan: unknown }
      expect(usedUp.plan).toEqual({
        kind: 'log_usage', item: { text: '에탄올', aliases: [], casNumber: null }, change: { kind: 'used_up' },
      })

      run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({ capability: 'log_usage', itemText: '에탄올' })))
      await expect((await run.ask('에탄올 기록해줘')).json()).resolves.toMatchObject({
        plan: { kind: 'unsupported', reason: 'low_confidence' },
      })
    })

    it('plans a registration with only what the person typed', async () => {
      const run = setup(actions)
      run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({
        capability: 'register_item', itemText: '아세톤', casNumber: '67-64-1', quantity: 2, capacityText: '500 mL',
      })))
      const typed = await (await run.ask('아세톤 500mL 2병 들어왔어 등록해줘')).json() as { plan: unknown }
      // The CAS number was not typed, so it is not carried into the form.
      expect(typed.plan).toEqual({ kind: 'register_item', name: '아세톤', casNumber: null, quantity: 2, capacity: '500 mL' })

      run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({
        capability: 'register_item', itemText: '아세톤', quantity: 4, capacityText: '1 L',
      })))
      const invented = await (await run.ask('아세톤 들어왔어 등록해줘')).json() as { plan: unknown }
      expect(invented.plan).toEqual({ kind: 'register_item', name: '아세톤', casNumber: null, quantity: null, capacity: null })
    })

    it('plans a purchase request for the named reagent', async () => {
      const run = setup(actions)
      run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({
        capability: 'request_purchase', itemText: '에탄올', itemAliases: ['ethanol'], quantity: 2,
      })))
      const body = await (await run.ask('에탄올 2병 구매 요청해줘')).json() as { plan: unknown }
      expect(body.plan).toEqual({
        kind: 'request_purchase', item: { text: '에탄올', aliases: ['ethanol'], casNumber: null }, quantity: 2,
      })
    })

    it('drops a write plan that names a reagent the person did not type', async () => {
      const run = setup(actions)
      for (const capability of ACTION_CAPABILITIES) {
        run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({
          capability, itemText: 'Hydrofluoric acid', usageKind: 'used_up', quantity: 1,
        })))
        await expect((await run.ask('그 시약 어떻게 됐는지 알려줘')).json()).resolves.toMatchObject({
          plan: { kind: 'unsupported', reason: 'low_confidence' },
        })
      }
    })
  })

  it('treats a model refusal as out of scope', async () => {
    const run = setup()
    run.fetchMock.mockResolvedValue(new Response(JSON.stringify({
      id: 'resp_agent', object: 'response', status: 'completed', model: 'gpt-6-luna',
      output: [{ id: 'msg_agent', type: 'message', status: 'completed', role: 'assistant',
        content: [{ type: 'refusal', refusal: 'no' }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await expect((await run.ask('이상한 요청을 해줘 알려줘')).json()).resolves.toMatchObject({
      plan: { kind: 'unsupported', reason: 'out_of_scope' },
    })
  })

  it('never writes the request text, the item name or the user id to the logs', async () => {
    const run = setup()
    run.fetchMock.mockResolvedValue(openAIResponse(rawPlan({
      capability: 'item_lookup', itemText: '비밀시약', facet: 'location',
    })))
    await run.ask('비밀시약 어디 있어?')
    await run.ask('비밀시약 폐기 방법')

    const logged = JSON.stringify([
      ...vi.mocked(console.info).mock.calls,
      ...vi.mocked(console.error).mock.calls,
    ])
    expect(logged).toContain('agent_plan')
    expect(logged).not.toContain('비밀시약')
    expect(logged).not.toContain(USER_ID)
  })

  it('does not expose a provider failure', async () => {
    const run = setup()
    run.fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'key sk-never-expose is invalid' } }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    }))
    const response = await run.ask('아세톤 어디 있어?')
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('never-expose')
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('never-expose')
  })
})
