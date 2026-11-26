import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestAgentPlan = vi.hoisted(() => vi.fn())
const getItems = vi.hoisted(() => vi.fn())
const loadContainers = vi.hoisted(() => vi.fn())
const loadWasteLogs = vi.hoisted(() => vi.fn())

vi.mock('../services/agentService', () => ({ agentService: { requestPlan: requestAgentPlan } }))
// The real sources reach Supabase-backed services; only the reads these tests expect exist here.
vi.mock('../features/agent/agentDataSources', () => ({
  agentDataSources: { loadItems: getItems, loadContainers, loadWasteLogs },
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
    getItems.mockReset().mockResolvedValue([acetone])
    loadContainers.mockReset().mockResolvedValue({ containers: [], totals: {} })
    loadWasteLogs.mockReset().mockResolvedValue({ logs: [], truncated: false })
    useAgentStore.getState().reset()
  })

  it('ignores empty text', async () => {
    const run = options()
    await useAgentStore.getState().submit(run, '   ')
    expect(useAgentStore.getState().turn).toBeNull()
    expect(requestAgentPlan).not.toHaveBeenCalled()
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
    expect(requestAgentPlan.mock.calls[0][0].capabilities).toEqual(['item_lookup', 'expiry_list', 'open_screen'])
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
      capabilities: ['item_lookup', 'expiry_list', 'open_screen', 'low_stock', 'inspection_gaps', 'purchase_status', 'admin_tasks'],
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
})
