import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestAgentPlan = vi.hoisted(() => vi.fn())
const requestAgentMode = vi.hoisted(() => vi.fn())
const getItems = vi.hoisted(() => vi.fn())
const loadContainers = vi.hoisted(() => vi.fn())
const loadWasteLogs = vi.hoisted(() => vi.fn())
const lookupChemical = vi.hoisted(() => vi.fn())
const recordAgentEvent = vi.hoisted(() => vi.fn())

vi.mock('../services/agentService', () => ({ agentService: { requestPlan: requestAgentPlan, requestMode: requestAgentMode } }))
vi.mock('../services/agentEventService', () => ({ agentEventService: { record: recordAgentEvent } }))
// The real sources reach Supabase-backed services; only the reads these tests expect exist here.
vi.mock('../features/agent/agentDataSources', () => ({
  agentDataSources: { loadItems: getItems, loadContainers, loadWasteLogs, lookupChemical, loadFormChoices: async () => [] },
}))
vi.mock('../services/internalApi', () => ({
  InternalApiError: class InternalApiError extends Error {
    readonly status: number
    readonly code?: string
    constructor(message: string, status: number, code?: string) {
      super(message)
      this.status = status
      this.code = code
    }
  },
}))

import { InternalApiError } from '../services/internalApi'
import type { AgentPlan, AgentQueryResponse } from '../features/agent/agentContract'
import { useAgentStore, type AgentSubmitOptions } from './useAgentStore'

const context = {
  labId: '11111111-1111-4111-8111-111111111111',
  isAdmin: true,
  joinPasswordNeedsChange: false,
  dailyInspectionEnabled: true,
  purchaseRequestsEnabled: true,
  regulationBatchEnabled: false,
  cabinetLockRulesEnabled: false,
  wasteContainersEnabled: true,
}

function options() {
  const onUiAction = vi.fn<AgentSubmitOptions['onUiAction']>()
  return { language: 'ko', context, onUiAction } satisfies AgentSubmitOptions
}

function planned(plan: AgentPlan): AgentQueryResponse {
  return { schemaVersion: 1, mode: 'read_only', plan, quotaRemaining: 10 }
}

const acetone = { id: 'a', name: 'Acetone', created_at: '2026-01-01T00:00:00Z', storage_type: 'other' }

describe('agent store', () => {
  beforeEach(() => {
    requestAgentPlan.mockReset()
    requestAgentMode.mockReset().mockResolvedValue({ schemaVersion: 1, mode: 'read_only' })
    getItems.mockReset().mockResolvedValue([acetone])
    loadContainers.mockReset().mockResolvedValue({ containers: [], totals: {} })
    loadWasteLogs.mockReset().mockResolvedValue({ logs: [], truncated: false })
    recordAgentEvent.mockReset().mockResolvedValue(undefined)
    useAgentStore.getState().reset()
  })

  it('ignores empty text', async () => {
    const run = options()
    await useAgentStore.getState().submit(run, '   ')
    expect(useAgentStore.getState().turn).toBeNull()
    expect(requestAgentPlan).not.toHaveBeenCalled()
    expect(recordAgentEvent).not.toHaveBeenCalled()
  })

  it('sends a plain name to the normal search without asking the server', async () => {
    const run = options()
    await useAgentStore.getState().submit(run, 'Acetone')
    expect(run.onUiAction).toHaveBeenCalledWith({ type: 'search_chemical', query: 'Acetone' })
    expect(requestAgentPlan).not.toHaveBeenCalled()
    expect(useAgentStore.getState()).toMatchObject({ status: 'idle', turn: null, text: '' })
  })

  it('answers waste wording locally, without the server or any records', async () => {
    const run = options()
    await useAgentStore.getState().submit(run, '아세톤 어떻게 버려?')
    expect(requestAgentPlan).not.toHaveBeenCalled()
    expect(getItems).not.toHaveBeenCalled()
    expect(useAgentStore.getState()).toMatchObject({
      status: 'idle',
      text: '아세톤 어떻게 버려?',
      turn: { plan: { kind: 'redirect_disposal' }, result: { type: 'disposal_redirect' }, error: null },
    })
  })

  it('answers questions about waste records from the lab\'s data without the server', async () => {
    await useAgentStore.getState().submit(options(), '폐액통 현황 알려줘')
    expect(loadContainers).toHaveBeenCalledTimes(1)
    expect(useAgentStore.getState().turn).toMatchObject({
      plan: { kind: 'container_status' }, result: { type: 'container_status', containers: [] }, error: null,
    })

    await useAgentStore.getState().submit(options(), '지난달 폐기 기록 요약')
    expect(loadWasteLogs).toHaveBeenCalledTimes(1)
    expect(useAgentStore.getState().turn).toMatchObject({
      plan: { kind: 'waste_summary', period: 'last_month' }, result: { type: 'waste_summary', logCount: 0 },
    })
    expect(requestAgentPlan).not.toHaveBeenCalled()
  })

  it('declares only the capabilities open to this person', async () => {
    requestAgentPlan.mockResolvedValue(planned({ kind: 'unsupported', reason: 'out_of_scope' }))
    const personal = { ...options(), context: { ...context, labId: null, isAdmin: false, purchaseRequestsEnabled: false } }
    await useAgentStore.getState().submit(personal, '오늘 뭐 해야 해?')
    // Proposals to record something are always declared; the server offers them only in actions mode.
    expect(requestAgentPlan.mock.calls[0][0].capabilities).toEqual(['item_lookup', 'expiry_list', 'open_screen', 'log_usage', 'register_item'])
  })

  it('asks the server for a plan and runs it against the lab\'s records', async () => {
    requestAgentPlan.mockResolvedValue(planned({
      kind: 'item_lookup', item: { text: '아세톤', aliases: ['acetone'], casNumber: null }, facet: 'location',
    }))
    const run = options()
    await useAgentStore.getState().submit(run, '  아세톤 어디 있어?  ')

    expect(requestAgentPlan).toHaveBeenCalledWith({
      schemaVersion: 1,
      text: '아세톤 어디 있어?',
      language: 'ko',
      // An admin in a lab, with the flags this fixture turns on.
      capabilities: [
        'item_lookup', 'expiry_list', 'open_screen', 'low_stock', 'inspection_gaps', 'purchase_status', 'admin_tasks',
        'log_usage', 'register_item', 'request_purchase',
      ],
    }, expect.any(AbortSignal))
    expect(getItems).toHaveBeenCalledTimes(1)
    expect(useAgentStore.getState()).toMatchObject({
      status: 'idle',
      turn: { text: '아세톤 어디 있어?', result: { type: 'item_matches', aliasOnly: true }, error: null },
    })
    expect(run.onUiAction).not.toHaveBeenCalled()
  })

  it('uses the typed text when no override is given', async () => {
    requestAgentPlan.mockResolvedValue(planned({ kind: 'expiry_list', window: 'expired' }))
    useAgentStore.getState().setText('유효기한 지난 시약 보여줘')
    await useAgentStore.getState().submit(options())
    expect(requestAgentPlan.mock.calls[0][0]).toMatchObject({ text: '유효기한 지난 시약 보여줘' })
    expect(useAgentStore.getState().turn?.result).toMatchObject({ type: 'expiry_list' })
  })

  it('leaves the result area when the plan opens another screen', async () => {
    requestAgentPlan.mockResolvedValue(planned({ kind: 'open_screen', screen: 'inventory' }))
    const run = options()
    await useAgentStore.getState().submit(run, '재고 화면 열어줘')
    expect(run.onUiAction).toHaveBeenCalledWith({ type: 'open_screen', screen: 'inventory' })
    expect(useAgentStore.getState()).toMatchObject({ status: 'idle', turn: null, text: '' })
  })

  it.each([
    [new InternalApiError('quota', 429, 'AGENT_QUOTA_EXCEEDED'), 'quota_exceeded'],
    [new InternalApiError('limited', 429, 'RATE_LIMITED'), 'rate_limited'],
    [new InternalApiError('off', 503, 'AGENT_DISABLED'), 'disabled'],
    [new InternalApiError('missing', 404, 'API_NOT_FOUND'), 'disabled'],
    [new InternalApiError('auth', 401, 'AUTH_REQUIRED'), 'login_required'],
    [new InternalApiError('old app', 400, 'AGENT_UPDATE_REQUIRED'), 'update_required'],
    [new InternalApiError('provider', 502, 'AGENT_PLAN_FAILED'), 'failed'],
    [new Error('network down'), 'failed'],
  ])('reports %s as %s', async (error, kind) => {
    requestAgentPlan.mockRejectedValue(error)
    await useAgentStore.getState().submit(options(), '아세톤 어디 있어?')
    expect(useAgentStore.getState()).toMatchObject({ status: 'idle', turn: { result: null, error: kind } })
  })

  it('asks for an update when the server speaks another contract version', async () => {
    requestAgentPlan.mockResolvedValue({ ...planned({ kind: 'expiry_list', window: 'expired' }), schemaVersion: 2 })
    await useAgentStore.getState().submit(options(), '만료된 시약 보여줘')
    expect(useAgentStore.getState().turn).toMatchObject({ error: 'update_required', result: null })
    expect(getItems).not.toHaveBeenCalled()
  })

  it('reports a failure to read the records', async () => {
    requestAgentPlan.mockResolvedValue(planned({ kind: 'expiry_list', window: 'expired' }))
    getItems.mockRejectedValue(new Error('offline'))
    await useAgentStore.getState().submit(options(), '만료된 시약 보여줘')
    expect(useAgentStore.getState().turn).toMatchObject({ error: 'failed', result: null })
  })

  it('keeps only the latest request when an earlier one answers late', async () => {
    let resolveFirst: (value: AgentQueryResponse) => void = () => undefined
    requestAgentPlan
      .mockImplementationOnce(() => new Promise<AgentQueryResponse>((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce(planned({ kind: 'unsupported', reason: 'out_of_scope' }))

    const first = useAgentStore.getState().submit(options(), '아세톤 어디 있어?')
    await useAgentStore.getState().submit(options(), '오늘 날씨 알려줘')
    resolveFirst(planned({ kind: 'expiry_list', window: 'expired' }))
    await first

    expect(useAgentStore.getState().turn).toMatchObject({
      text: '오늘 날씨 알려줘',
      result: { type: 'unsupported', reason: 'out_of_scope' },
    })
    expect(getItems).not.toHaveBeenCalled()
  })

  it('drops an answer that arrives after a reset', async () => {
    let resolvePlan: (value: AgentQueryResponse) => void = () => undefined
    requestAgentPlan.mockImplementationOnce(() => new Promise<AgentQueryResponse>((resolve) => { resolvePlan = resolve }))
    const run = options()
    const pending = useAgentStore.getState().submit(run, '재고 화면 열어줘')
    expect(useAgentStore.getState().status).toBe('planning')

    useAgentStore.getState().reset()
    resolvePlan(planned({ kind: 'open_screen', screen: 'inventory' }))
    await pending

    expect(useAgentStore.getState()).toMatchObject({ status: 'idle', turn: null, text: '' })
    expect(run.onUiAction).not.toHaveBeenCalled()
  })

  it('limits the text to the contract length', () => {
    useAgentStore.getState().setText('가'.repeat(500))
    expect(useAgentStore.getState().text).toHaveLength(300)
  })

  describe('proposals to record something', () => {
    const usagePlan: AgentPlan = {
      kind: 'log_usage', item: { text: 'Acetone', aliases: [], casNumber: null }, change: { kind: 'remaining', percent: 30 },
    }

    it('shows a proposal only when the server says actions are switched on', async () => {
      requestAgentPlan.mockResolvedValue({ ...planned(usagePlan), mode: 'actions' })
      await useAgentStore.getState().submit(options(), 'Acetone 30% 남았다고 기록해줘')
      expect(useAgentStore.getState().turn?.result).toMatchObject({
        type: 'usage_proposal', query: 'Acetone', change: { kind: 'remaining', percent: 30 }, items: [acetone], labId: context.labId,
      })

      requestAgentPlan.mockResolvedValue(planned(usagePlan))
      await useAgentStore.getState().submit(options(), 'Acetone 30% 남았다고 기록해줘')
      expect(useAgentStore.getState().turn?.result).toEqual({ type: 'unsupported', reason: 'capability_disabled' })
    })

    it('asks only for the switch, never sending the sentence, before proposing a pickup', async () => {
      requestAgentMode.mockResolvedValue({ schemaVersion: 1, mode: 'actions' })
      loadContainers.mockResolvedValue({
        containers: [{ id: 'c1', labId: context.labId, streamCode: 'ACID_AQUEOUS', label: '산 폐액-1', location: null, capacityMl: null, status: 'active', startedAt: '2026-11-01T00:00:00Z', pickupRequestedAt: null }],
        totals: {},
      })
      await useAgentStore.getState().submit(options(), '폐액통 수거 요청해줘')

      expect(requestAgentPlan).not.toHaveBeenCalled()
      expect(requestAgentMode).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(requestAgentMode.mock.calls)).not.toContain('폐액통')
      expect(useAgentStore.getState().turn).toMatchObject({
        plan: { kind: 'pickup_request' },
        result: { type: 'pickup_proposal', containers: [{ id: 'c1', label: '산 폐액-1' }], requestedCount: 0 },
      })
      expect(recordAgentEvent).toHaveBeenLastCalledWith(expect.objectContaining({
        route: 'rule', kind: 'pickup_request', outcome: 'proposed', failedText: null,
      }))
    })

    it.each([
      ['the switch is read-only', () => requestAgentMode.mockResolvedValue({ schemaVersion: 1, mode: 'read_only' })],
      ['the switch is off', () => requestAgentMode.mockResolvedValue({ schemaVersion: 1, mode: 'off' })],
      ['the switch cannot be read', () => requestAgentMode.mockRejectedValue(new Error('offline'))],
      ['the server speaks another contract version', () => requestAgentMode.mockResolvedValue({ schemaVersion: 2, mode: 'actions' })],
    ])('answers a pickup request with the fixed card when %s', async (_label, arrange) => {
      arrange()
      await useAgentStore.getState().submit(options(), '폐액통 수거 요청해줘')
      expect(loadContainers).not.toHaveBeenCalled()
      expect(useAgentStore.getState().turn?.result).toEqual({ type: 'disposal_redirect' })
    })

    it('reads waste components on the device and looks up only their names', async () => {
      lookupChemical.mockReset().mockResolvedValue(null)
      await useAgentStore.getState().submit(options(), '아세톤 200mL랑 메탄올 100mL 섞은 폐액')

      expect(requestAgentPlan).not.toHaveBeenCalled()
      expect(requestAgentMode).not.toHaveBeenCalled()
      // Only the two names go to the substance lookup, never the sentence.
      expect(lookupChemical.mock.calls.map(([query]) => query)).toEqual(['아세톤', '메탄올'])
      expect(useAgentStore.getState().turn).toMatchObject({
        plan: { kind: 'waste_batch' },
        result: { type: 'waste_batch_proposal', components: [{ typedName: '아세톤' }, { typedName: '메탄올' }] },
      })
      // Nothing was found, and waste wording is never kept either way.
      expect(recordAgentEvent).toHaveBeenLastCalledWith(expect.objectContaining({
        route: 'rule', kind: 'waste_batch', outcome: 'empty', failedText: null,
      }))
    })

    it('does not ask for the switch for other waste requests', async () => {
      await useAgentStore.getState().submit(options(), '폐액통 현황 알려줘')
      await useAgentStore.getState().submit(options(), '아세톤 어떻게 버려?')
      expect(requestAgentMode).not.toHaveBeenCalled()
    })

    it('records a confirmed proposal as its own event', async () => {
      requestAgentPlan.mockResolvedValue({ ...planned(usagePlan), mode: 'actions' })
      await useAgentStore.getState().submit(options(), 'Acetone 30% 남았다고 기록해줘')
      useAgentStore.getState().confirmProposal()

      const events = recordAgentEvent.mock.calls.map(([event]) => event)
      expect(events).toMatchObject([
        { route: 'planner', kind: 'log_usage', outcome: 'proposed', failedText: null },
        { route: 'planner', kind: 'log_usage', outcome: 'confirmed', failedText: null, labId: context.labId },
      ])
      expect(events[1].requestId).not.toBe(events[0].requestId)
    })

    it('records no confirmation once the proposal is gone', async () => {
      requestAgentPlan.mockResolvedValue({ ...planned(usagePlan), mode: 'actions' })
      await useAgentStore.getState().submit(options(), 'Acetone 30% 남았다고 기록해줘')
      useAgentStore.getState().reset()
      useAgentStore.getState().confirmProposal()
      expect(recordAgentEvent).toHaveBeenCalledTimes(1)
    })
  })

  describe('usage records', () => {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

    it('records a planned request that was answered, without its sentence', async () => {
      requestAgentPlan.mockResolvedValue(planned({
        kind: 'item_lookup', item: { text: '아세톤', aliases: ['acetone'], casNumber: null }, facet: 'location',
      }))
      await useAgentStore.getState().submit(options(), '아세톤 어디 있어?')

      expect(recordAgentEvent).toHaveBeenCalledTimes(1)
      expect(recordAgentEvent).toHaveBeenCalledWith({
        requestId: expect.stringMatching(UUID),
        labId: context.labId,
        route: 'planner',
        kind: 'item_lookup',
        outcome: 'answered',
        reason: 'alias_only',
        latencyMs: expect.any(Number),
        language: 'ko',
        failedText: null,
      })
    })

    it('records what was decided by fixed rules, and never keeps waste wording', async () => {
      await useAgentStore.getState().submit(options(), 'Acetone')
      await useAgentStore.getState().submit(options(), '아세톤 어떻게 버려?')
      await useAgentStore.getState().submit(options(), '폐액통 현황 알려줘')

      expect(recordAgentEvent.mock.calls.map(([event]) => event)).toMatchObject([
        { route: 'rule', kind: 'identifier', outcome: 'handoff_search', failedText: null },
        { route: 'rule', kind: 'redirect_disposal', outcome: 'disposal_card', failedText: null },
        { route: 'rule', kind: 'container_status', outcome: 'empty', failedText: null },
      ])
      const requestIds = recordAgentEvent.mock.calls.map(([event]) => event.requestId)
      expect(new Set(requestIds).size).toBe(3)
    })

    it('records a screen the plan opened', async () => {
      requestAgentPlan.mockResolvedValue(planned({ kind: 'open_screen', screen: 'inventory' }))
      await useAgentStore.getState().submit(options(), '재고 화면 열어줘')
      expect(recordAgentEvent).toHaveBeenCalledWith(expect.objectContaining({
        route: 'planner', kind: 'open_screen', outcome: 'navigated', failedText: null,
      }))
    })

    it('keeps the sentence, with contact details hidden, when the agent could not handle it', async () => {
      requestAgentPlan.mockResolvedValue(planned({ kind: 'unsupported', reason: 'out_of_scope' }))
      await useAgentStore.getState().submit(options(), '결과를 hong@example.com 으로 보내줘')
      expect(recordAgentEvent).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'unsupported', outcome: 'unsupported', reason: 'out_of_scope', failedText: '결과를 [EMAIL] 으로 보내줘',
      }))

      requestAgentPlan.mockResolvedValue(planned({
        kind: 'item_lookup', item: { text: '톨루엔', aliases: [], casNumber: null }, facet: 'location',
      }))
      await useAgentStore.getState().submit(options(), '톨루엔 어디 있어?')
      expect(recordAgentEvent).toHaveBeenLastCalledWith(expect.objectContaining({
        kind: 'item_lookup', outcome: 'no_match', failedText: '톨루엔 어디 있어?',
      }))
    })

    it('records the personal space without a lab', async () => {
      requestAgentPlan.mockResolvedValue(planned({ kind: 'expiry_list', window: 'expired' }))
      await useAgentStore.getState().submit({ ...options(), language: 'en', context: { ...context, labId: null } }, 'show expired reagents')
      expect(recordAgentEvent).toHaveBeenCalledWith(expect.objectContaining({ labId: null, language: 'en', kind: 'expiry_list' }))
    })

    it('records a failed plan request and a failed read by where they failed', async () => {
      requestAgentPlan.mockRejectedValue(new InternalApiError('quota', 429, 'AGENT_QUOTA_EXCEEDED'))
      await useAgentStore.getState().submit(options(), '아세톤 어디 있어?')
      expect(recordAgentEvent).toHaveBeenLastCalledWith(expect.objectContaining({
        route: 'planner', kind: 'planner', outcome: 'error', reason: 'quota_exceeded', failedText: null,
      }))

      requestAgentPlan.mockResolvedValue(planned({ kind: 'expiry_list', window: 'expired' }))
      getItems.mockRejectedValue(new Error('offline'))
      await useAgentStore.getState().submit(options(), '만료된 시약 보여줘')
      expect(recordAgentEvent).toHaveBeenLastCalledWith(expect.objectContaining({
        route: 'planner', kind: 'expiry_list', outcome: 'error', reason: 'failed', failedText: null,
      }))
    })

    it('records only the request whose answer was shown', async () => {
      let resolveFirst: (value: AgentQueryResponse) => void = () => undefined
      requestAgentPlan
        .mockImplementationOnce(() => new Promise<AgentQueryResponse>((resolve) => { resolveFirst = resolve }))
        .mockResolvedValueOnce(planned({ kind: 'expiry_list', window: 'expired' }))

      const first = useAgentStore.getState().submit(options(), '아세톤 어디 있어?')
      await useAgentStore.getState().submit(options(), '만료된 시약 보여줘')
      resolveFirst(planned({ kind: 'unsupported', reason: 'out_of_scope' }))
      await first

      expect(recordAgentEvent).toHaveBeenCalledTimes(1)
      expect(recordAgentEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'expiry_list' }))
    })

    it('records nothing for a request that was cleared before it answered', async () => {
      let resolvePlan: (value: AgentQueryResponse) => void = () => undefined
      requestAgentPlan.mockImplementationOnce(() => new Promise<AgentQueryResponse>((resolve) => { resolvePlan = resolve }))
      const pending = useAgentStore.getState().submit(options(), '오늘 날씨 알려줘')
      useAgentStore.getState().reset()
      resolvePlan(planned({ kind: 'unsupported', reason: 'out_of_scope' }))
      await pending
      expect(recordAgentEvent).not.toHaveBeenCalled()
    })

    it('shows the answer even when recording fails', async () => {
      recordAgentEvent.mockRejectedValue(new Error('offline'))
      requestAgentPlan.mockResolvedValue(planned({ kind: 'expiry_list', window: 'expired' }))
      await useAgentStore.getState().submit(options(), '만료된 시약 보여줘')
      expect(useAgentStore.getState().turn).toMatchObject({ result: { type: 'expiry_list' }, error: null })
    })
  })
})
