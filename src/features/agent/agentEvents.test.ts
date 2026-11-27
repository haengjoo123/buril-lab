import { describe, expect, it } from 'vitest'
import {
  buildAgentQueryEvent,
  isUnhandledOutcome,
  maskFailedAgentText,
  outcomeOfError,
  outcomeOfResult,
  outcomeOfUiAction,
} from './agentEvents'
import type { AgentResult } from './agentResults'

// What the database accepts; see agent_query_events_reason_check and _kind_check.
const CODE = /^[a-z][a-z0-9_]{0,39}$/

const base = {
  requestId: '33333333-3333-4333-8333-333333333333',
  labId: null,
  route: 'planner' as const,
  kind: 'item_lookup',
  language: 'ko' as const,
  latencyMs: 812.4,
  text: '아세톤 어디 있어?',
  reason: null,
}

describe('agent usage records', () => {
  it.each<[AgentResult, string, string | null]>([
    [{ type: 'item_matches', query: 'a', facet: 'location', items: [], hiddenCount: 0, aliasOnly: false }, 'answered', null],
    [{ type: 'item_matches', query: 'a', facet: 'location', items: [], hiddenCount: 0, aliasOnly: true }, 'answered', 'alias_only'],
    [{ type: 'item_no_match', query: 'a', inventoryIsEmpty: false }, 'no_match', null],
    [{ type: 'item_no_match', query: 'a', inventoryIsEmpty: true }, 'no_match', 'inventory_empty'],
    [{ type: 'expiry_list', window: 'expired', rows: [], total: 3, undatedCount: 0, inventoryCount: 9 }, 'answered', null],
    [{ type: 'expiry_list', window: 'expired', rows: [], total: 0, undatedCount: 4, inventoryCount: 9 }, 'empty', null],
    [{ type: 'expiry_list', window: 'expired', rows: [], total: 0, undatedCount: 0, inventoryCount: 0 }, 'empty', 'inventory_empty'],
    [{ type: 'low_stock', forecasts: [], total: 0, inventoryCount: 5, hasUsageHistory: false }, 'empty', null],
    [{ type: 'regulated_list', substances: [], total: 2, obligations: [], withoutCasCount: 0, unresolvedCount: 0, inventoryCount: 5 }, 'answered', null],
    [{ type: 'cabinet_locks', unlocked: [], unset: [] }, 'empty', null],
    [{ type: 'cabinet_locks', unlocked: [], unset: [{ cabinetId: 'c', cabinetName: 'A', count: 1 }] }, 'answered', null],
    [{ type: 'inspection_gaps', missingDates: [], lookbackDays: 14, recordedToday: true }, 'answered', null],
    [{ type: 'purchase_status', requested: 0, approved: 0, ordered: 0, waiting: [] }, 'empty', null],
    [{ type: 'purchase_status', requested: 0, approved: 1, ordered: 0, waiting: [] }, 'answered', null],
    [{ type: 'admin_tasks', tasks: [], total: 2, snoozedCount: 0, failedSourceCount: 1 }, 'answered', 'partial'],
    [{ type: 'container_status', containers: [] }, 'empty', null],
    [{ type: 'waste_summary', period: 'last_month', streams: [], logCount: 4, totalVolumeMl: 10, truncated: true }, 'answered', 'partial'],
    [{ type: 'waste_summary', period: 'last_month', streams: [], logCount: 0, totalVolumeMl: 0, truncated: false }, 'empty', null],
    [{ type: 'usage_proposal', query: 'a', change: { kind: 'used_up' }, items: [], hiddenCount: 0, aliasOnly: false, labId: null }, 'proposed', null],
    [{ type: 'register_proposal', draft: { name: 'a', casNumber: null, quantity: null, capacity: null }, labId: null }, 'proposed', null],
    [{ type: 'purchase_proposal', itemName: 'a', quantity: 2, matches: [], labId: 'lab' }, 'proposed', null],
    [{ type: 'pickup_proposal', containers: [], requestedCount: 1, labId: null }, 'empty', null],
    [{ type: 'waste_batch_proposal', labId: null, components: [
      { key: 'a', typedName: 'a', amount: { value: 1, unit: 'mL', kind: 'volume' }, lookup: { status: 'not_found' } },
    ] }, 'empty', 'partial'],
    [{ type: 'waste_batch_proposal', labId: null, components: [
      { key: 'a', typedName: 'a', amount: { value: 1, unit: 'mL', kind: 'volume' }, lookup: { status: 'choose_form', choices: [] } },
    ] }, 'proposed', 'needs_choice'],
    [{ type: 'disposal_redirect' }, 'disposal_card', null],
    [{ type: 'screen_unavailable', screen: 'admin', reason: 'admin_only' }, 'unavailable', 'admin_only'],
    [{ type: 'unsupported', reason: 'out_of_scope' }, 'unsupported', 'out_of_scope'],
  ])('describes %j as %s', (result, outcome, reason) => {
    expect(outcomeOfResult(result)).toEqual({ outcome, reason })
    if (reason) expect(reason).toMatch(CODE)
  })

  it('tells a hand-off to the normal search from opening a screen', () => {
    expect(outcomeOfUiAction({ type: 'search_chemical', query: 'Acetone' })).toEqual({ outcome: 'handoff_search', reason: null })
    expect(outcomeOfUiAction({ type: 'open_screen', screen: 'inventory' })).toEqual({ outcome: 'navigated', reason: null })
    expect(outcomeOfUiAction({ type: 'open_inventory', filter: null })).toEqual({ outcome: 'navigated', reason: null })
    expect(outcomeOfUiAction({ type: 'open_cabinet', cabinetId: 'c', itemId: null, shelfId: null }))
      .toEqual({ outcome: 'navigated', reason: null })
  })

  it('records an error by its kind', () => {
    for (const kind of ['login_required', 'disabled', 'quota_exceeded', 'rate_limited', 'update_required', 'failed'] as const) {
      expect(outcomeOfError(kind)).toEqual({ outcome: 'error', reason: kind })
      expect(kind).toMatch(CODE)
    }
  })

  it('keeps the sentence only when the agent could not handle the request', () => {
    expect(isUnhandledOutcome('unsupported')).toBe(true)
    expect(isUnhandledOutcome('no_match')).toBe(true)
    for (const outcome of ['answered', 'empty', 'navigated', 'handoff_search', 'disposal_card', 'proposed', 'confirmed', 'unavailable', 'error'] as const) {
      expect(isUnhandledOutcome(outcome)).toBe(false)
      expect(buildAgentQueryEvent({ ...base, outcome }).failedText).toBeNull()
    }
    expect(buildAgentQueryEvent({ ...base, outcome: 'no_match' }).failedText).toBe('아세톤 어디 있어?')
    expect(buildAgentQueryEvent({ ...base, outcome: 'unsupported', reason: 'out_of_scope' })).toEqual({
      requestId: base.requestId,
      labId: null,
      route: 'planner',
      kind: 'item_lookup',
      outcome: 'unsupported',
      reason: 'out_of_scope',
      latencyMs: 812,
      language: 'ko',
      failedText: '아세톤 어디 있어?',
    })
  })

  it('keeps the latency inside what the database accepts', () => {
    expect(buildAgentQueryEvent({ ...base, outcome: 'answered', latencyMs: -40 }).latencyMs).toBe(0)
    expect(buildAgentQueryEvent({ ...base, outcome: 'answered', latencyMs: 9_000_000 }).latencyMs).toBe(600_000)
  })

  it('stores nothing rather than an empty sentence', () => {
    expect(buildAgentQueryEvent({ ...base, outcome: 'unsupported', text: ' \u0007 ' }).failedText).toBeNull()
  })

  it('hides contact details and secrets, and keeps CAS numbers', () => {
    expect(maskFailedAgentText('hong@example.com 으로 67-64-1 재고 보내줘'))
      .toBe('[EMAIL] 으로 67-64-1 재고 보내줘')
    expect(maskFailedAgentText('010-1234-5678 로 연락해줘')).toBe('[PHONE] 로 연락해줘')
    expect(maskFailedAgentText('https://example.com/a?b=c 에 올려줘')).toBe('[URL] 에 올려줘')
    expect(maskFailedAgentText('토큰 abcdefghijklmnop1234567890ABCDEFGHIJ 등록')).toBe('토큰 [TOKEN] 등록')
    expect(maskFailedAgentText('aaaaaaaaaaaa1.bbbbbbbbbbbb2.cccccccccccc3 확인')).toBe('[TOKEN] 확인')
    // A CAS-shaped number that fails its checksum is left as typed.
    expect(maskFailedAgentText('67-64-2 는 뭐야')).toBe('67-64-2 는 뭐야')
  })

  it('collapses spacing and control characters, and limits the length', () => {
    expect(maskFailedAgentText('  오늘\n\t점심   뭐야  ')).toBe('오늘 점심 뭐야')
    expect(Array.from(maskFailedAgentText('가'.repeat(400)))).toHaveLength(300)
  })
})
