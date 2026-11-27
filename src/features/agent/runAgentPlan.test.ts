import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InventoryItem } from '../../services/inventoryService'
import type { LabAdminOverviewResults } from '../../services/labAdminOverviewService'
import type { PurchaseRequest } from '../../services/purchaseRequestService'
import type { WasteContainer } from '../../services/wasteContainerService'
import type { WasteLogRecord } from '../../services/wasteLogService'
import type { ChemicalRegulationLookup } from '../../utils/chemicalRegulations'
import type { AgentDataSources } from './agentDataSources'
import type { AgentResult, AgentRunnablePlan } from './agentResults'
import type { AgentRuntimeContext } from './capabilityRegistry'
import { AGENT_EXPIRY_LIST_LIMIT, inventoryFilterForWindow } from './executors/expiryList'
import { wastePeriodRange } from './executors/wasteRecords'
import { AgentUpdateRequiredError, runAgentPlan } from './runAgentPlan'

const LAB_ID = '11111111-1111-4111-8111-111111111111'

let nextId = 0
function item(overrides: Partial<InventoryItem>): InventoryItem {
  nextId += 1
  return {
    id: `item-${nextId}`,
    lab_id: LAB_ID,
    user_id: 'user',
    name: `Reagent ${nextId}`,
    brand: null,
    product_number: null,
    cas_number: null,
    quantity: 1,
    capacity: null,
    storage_type: 'other',
    cabinet_id: null,
    storage_location_id: null,
    product_id: null,
    expiry_date: null,
    manufacturer_date_type: 'unlabeled',
    received_date: null,
    opened_date: null,
    memo: null,
    remaining_percent: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const adminInLab: AgentRuntimeContext = {
  labId: LAB_ID,
  isAdmin: true,
  joinPasswordNeedsChange: false,
  dailyInspectionEnabled: true,
  purchaseRequestsEnabled: true,
  regulationBatchEnabled: true,
  cabinetLockRulesEnabled: true,
  wasteContainersEnabled: true,
}
const personalSpace: AgentRuntimeContext = { ...adminInLab, labId: null, isAdmin: false }

/** Every read fails unless the test supplies it, so a plan cannot quietly read more than it needs. */
function sources(overrides: Partial<AgentDataSources> = {}): AgentDataSources {
  const unexpected = (name: string) => () => { throw new Error(`unexpected read: ${name}`) }
  return {
    loadItems: unexpected('loadItems'),
    loadUsageCounts: unexpected('loadUsageCounts'),
    loadRegulations: unexpected('loadRegulations'),
    loadCabinetLocks: unexpected('loadCabinetLocks'),
    loadInspectionDates: unexpected('loadInspectionDates'),
    loadPurchaseRequests: unexpected('loadPurchaseRequests'),
    loadAdminOverview: unexpected('loadAdminOverview'),
    readAdminSnoozes: unexpected('readAdminSnoozes'),
    loadContainers: unexpected('loadContainers'),
    loadWasteLogs: unexpected('loadWasteLogs'),
    lookupChemical: unexpected('lookupChemical'),
    loadFormChoices: unexpected('loadFormChoices'),
    ...overrides,
  }
}

async function resultOf(
  plan: AgentRunnablePlan,
  reads: Partial<AgentDataSources> = {},
  context: AgentRuntimeContext = adminInLab,
  now?: number,
  allowActions = false,
): Promise<AgentResult> {
  const outcome = await runAgentPlan(plan, { sources: sources(reads), context, now, allowActions })
  if (!('result' in outcome)) throw new Error('expected a result')
  return outcome.result
}

const CLOSED = { type: 'unsupported', reason: 'capability_disabled' }

describe('running an agent plan: one reagent and expiry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 27, 12, 0, 0))
  })
  afterEach(() => vi.useRealTimers())

  const dated = [
    item({ name: 'Past', expiry_date: '2026-11-01' }),
    item({ name: 'Today', expiry_date: '2026-11-27' }),
    item({ name: 'Five days', expiry_date: '2026-12-02' }),
    item({ name: 'Twenty days', expiry_date: '2026-12-17' }),
    item({ name: 'Sixty days', expiry_date: '2027-01-26' }),
    item({ name: 'No date A' }),
    item({ name: 'No date B', expiry_date: 'not a date' }),
  ]

  it.each([
    ['expired', ['Past', 'Today']],
    ['within_7d', ['Five days']],
    ['within_30d', ['Five days', 'Twenty days']],
    ['attention', ['Past', 'Today', 'Five days', 'Twenty days']],
  ] as const)('lists %s reagents soonest first and counts the undated ones', async (window, expected) => {
    const result = await resultOf({ kind: 'expiry_list', window }, { loadItems: async () => dated })
    expect(result).toMatchObject({ type: 'expiry_list', window, total: expected.length, undatedCount: 2, inventoryCount: 7 })
    expect(result.type === 'expiry_list' && result.rows.map((row) => row.item.name)).toEqual(expected)
  })

  it('caps a long list and still reports the full count', async () => {
    const many = Array.from({ length: AGENT_EXPIRY_LIST_LIMIT + 5 }, () => item({ expiry_date: '2026-10-01' }))
    const result = await resultOf({ kind: 'expiry_list', window: 'expired' }, { loadItems: async () => many })
    expect(result).toMatchObject({ total: AGENT_EXPIRY_LIST_LIMIT + 5 })
    expect(result.type === 'expiry_list' && result.rows).toHaveLength(AGENT_EXPIRY_LIST_LIMIT)
  })

  it('maps each window to the inventory screen\'s own filter', () => {
    expect(inventoryFilterForWindow('expired')).toBe('expired')
    expect(inventoryFilterForWindow('within_7d')).toBe('expiring')
    expect(inventoryFilterForWindow('within_30d')).toBe('expiring')
    expect(inventoryFilterForWindow('attention')).toBe('attention')
  })

  it('answers an item lookup with every matching record', async () => {
    const items = [item({ name: 'Acetone' }), item({ name: 'Acetone' }), item({ name: 'Methanol' })]
    await expect(resultOf(
      { kind: 'item_lookup', item: { text: 'acetone', aliases: [], casNumber: null }, facet: 'remaining' },
      { loadItems: async () => items },
    )).resolves.toMatchObject({ type: 'item_matches', query: 'acetone', facet: 'remaining', hiddenCount: 0, aliasOnly: false })
  })

  it('tells an unknown name apart from an empty inventory', async () => {
    const lookup: AgentRunnablePlan = { kind: 'item_lookup', item: { text: 'acetone', aliases: [], casNumber: null }, facet: 'location' }
    await expect(resultOf(lookup, { loadItems: async () => [item({ name: 'Methanol' })] }))
      .resolves.toEqual({ type: 'item_no_match', query: 'acetone', inventoryIsEmpty: false })
    await expect(resultOf(lookup, { loadItems: async () => [] }))
      .resolves.toEqual({ type: 'item_no_match', query: 'acetone', inventoryIsEmpty: true })
  })
})

describe('running an agent plan: screens and exits', () => {
  it('opens a screen the person can reach without reading any records', async () => {
    await expect(runAgentPlan({ kind: 'open_screen', screen: 'inventory' }, { sources: sources(), context: adminInLab }))
      .resolves.toEqual({ uiAction: { type: 'open_screen', screen: 'inventory' } })
  })

  it.each([
    ['admin', { ...adminInLab, isAdmin: false }, 'admin_only'],
    ['admin', personalSpace, 'lab_only'],
    ['inspection', { ...adminInLab, dailyInspectionEnabled: false }, 'not_enabled'],
    ['inspection', personalSpace, 'lab_only'],
    ['purchases', { ...adminInLab, purchaseRequestsEnabled: false }, 'not_enabled'],
    ['purchases', personalSpace, 'lab_only'],
  ] as const)('explains why the %s screen cannot be opened', async (screen, context, reason) => {
    await expect(resultOf({ kind: 'open_screen', screen }, {}, context))
      .resolves.toEqual({ type: 'screen_unavailable', screen, reason })
  })

  it('passes hand-offs, redirects and refusals through unchanged', async () => {
    await expect(runAgentPlan({ kind: 'handoff_search', query: 'sodium chloride' }, { sources: sources(), context: adminInLab }))
      .resolves.toEqual({ uiAction: { type: 'search_chemical', query: 'sodium chloride' } })
    await expect(resultOf({ kind: 'redirect_disposal' })).resolves.toEqual({ type: 'disposal_redirect' })
    await expect(resultOf({ kind: 'unsupported', reason: 'out_of_scope' }))
      .resolves.toEqual({ type: 'unsupported', reason: 'out_of_scope' })
  })

  it('refuses a plan kind this build does not know', async () => {
    const future = { kind: 'bulk_delete_everything' } as unknown as AgentRunnablePlan
    await expect(runAgentPlan(future, { sources: sources(), context: adminInLab })).rejects.toBeInstanceOf(AgentUpdateRequiredError)
  })
})

describe('running an agent plan: lab status', () => {
  it('forecasts low stock from the amount left when no bottle was recorded as used up', async () => {
    const items = [
      item({ name: 'Nearly empty', remaining_percent: 10 }),
      item({ name: 'Half', remaining_percent: 35 }),
      item({ name: 'Full', remaining_percent: 90 }),
    ]
    const result = await resultOf({ kind: 'low_stock' }, { loadItems: async () => items, loadUsageCounts: async () => new Map() })
    expect(result).toMatchObject({ type: 'low_stock', total: 2, inventoryCount: 3, hasUsageHistory: false })
    expect(result.type === 'low_stock' && result.forecasts.map((forecast) => [forecast.name, forecast.level, forecast.reason]))
      .toEqual([['Nearly empty', 'low', 'last_bottle'], ['Half', 'soon', 'last_bottle']])
  })

  it('reads usage for the personal space as well', async () => {
    const loadUsageCounts = vi.fn(async () => new Map([['x', { usedCount: 2, lastUsedAt: null }]]))
    const result = await resultOf({ kind: 'low_stock' }, { loadItems: async () => [], loadUsageCounts }, personalSpace)
    expect(loadUsageCounts).toHaveBeenCalledWith(null)
    expect(result).toMatchObject({ type: 'low_stock', total: 0, hasUsageHistory: true })
  })

  it('lists regulated substances with their duties and says what it could not check', async () => {
    const items = [
      item({ name: 'Nitric acid 70%', cas_number: '7697-37-2' }),
      item({ name: '질산', cas_number: '7697-37-2' }),
      item({ name: 'Acetone', cas_number: '67-64-1' }),
      item({ name: 'Ethanol', cas_number: '64-17-5' }),
      item({ name: 'Homemade buffer' }),
    ]
    const lookups = new Map<string, ChemicalRegulationLookup>([
      ['7697-37-2', {
        status: 'found',
        record: {
          casNumber: '7697-37-2',
          nameKo: '질산',
          entries: [
            { category: 'accident_preparedness', typeName: '사고대비물질' },
            { category: 'toxic', typeName: '유독물질' },
          ],
        },
      }],
      ['67-64-1', { status: 'not_found' }],
    ])
    const loadRegulations = vi.fn<AgentDataSources['loadRegulations']>(async () => lookups)

    const result = await resultOf({ kind: 'regulated_list' }, { loadItems: async () => items, loadRegulations })

    expect([...loadRegulations.mock.calls[0][0]].sort()).toEqual(['64-17-5', '67-64-1', '7697-37-2'])
    expect(result).toMatchObject({
      type: 'regulated_list',
      total: 1,
      substances: [{ casNumber: '7697-37-2', name: '질산', classes: ['사고대비물질', '유독물질'], itemCount: 2 }],
      withoutCasCount: 1,
      // Ethanol was asked about and got no answer: that is not the same as "not regulated".
      unresolvedCount: 1,
      inventoryCount: 5,
    })
    expect(result.type === 'regulated_list' && result.obligations.map((obligation) => obligation.id))
      .toEqual(['store_locked', 'separate_storage', 'label_container'])
  })

  it('does not call the regulation lookup when no record has a CAS number', async () => {
    await expect(resultOf({ kind: 'regulated_list' }, { loadItems: async () => [item({ name: 'Buffer' })] }))
      .resolves.toMatchObject({ type: 'regulated_list', total: 0, withoutCasCount: 1, unresolvedCount: 0 })
  })

  it('reports cabinets whose lock needs checking', async () => {
    const summary = { unlocked: [{ cabinetId: 'c1', cabinetName: 'Acid cabinet', count: 3 }], unset: [] }
    const loadCabinetLocks = vi.fn(async () => summary)
    await expect(resultOf({ kind: 'cabinet_locks' }, { loadCabinetLocks }))
      .resolves.toEqual({ type: 'cabinet_locks', ...summary })
    expect(loadCabinetLocks).toHaveBeenCalledWith(LAB_ID)
  })

  it('lists weekdays without a daily inspection and never today or a weekend', async () => {
    // Friday 2026-11-27, noon in Korea.
    const now = Date.UTC(2026, 10, 27, 3, 0, 0)
    const records = ['2026-11-27', '2026-11-26', '2026-11-25'].map((inspectionDate) => ({ inspectionDate }))
    await expect(resultOf({ kind: 'inspection_gaps' }, { loadInspectionDates: async () => records }, adminInLab, now))
      .resolves.toEqual({
        type: 'inspection_gaps',
        missingDates: ['2026-11-24', '2026-11-23', '2026-11-20'],
        lookbackDays: 7,
        recordedToday: true,
      })
  })

  it('summarises open purchase requests, oldest waiting first', async () => {
    const request = (id: string, status: PurchaseRequest['status'], createdAt: string) => ({
      id, status, createdAt, itemName: `Item ${id}`, quantity: 2,
    }) as PurchaseRequest
    const requests = [
      request('new', 'requested', '2026-11-20T00:00:00Z'),
      request('old', 'requested', '2026-11-01T00:00:00Z'),
      request('ok', 'approved', '2026-11-10T00:00:00Z'),
      request('sent', 'ordered', '2026-11-05T00:00:00Z'),
    ]
    const result = await resultOf({ kind: 'purchase_status' }, { loadPurchaseRequests: async () => requests })
    expect(result).toMatchObject({ type: 'purchase_status', requested: 2, approved: 1, ordered: 1 })
    expect(result.type === 'purchase_status' && result.waiting.map((entry) => entry.id)).toEqual(['old', 'new'])
  })

  it('builds the admin\'s tasks the way the overview does and reports sources that failed', async () => {
    const now = Date.UTC(2026, 10, 27, 3, 0, 0)
    const overview: LabAdminOverviewResults = {
      purchaseRequests: { status: 'fulfilled', value: [{ id: 'p1', createdAt: '2026-11-20T00:00:00Z' }] },
      members: { status: 'rejected', reason: new Error('offline') },
    }
    const result = await resultOf(
      { kind: 'admin_tasks' },
      { loadAdminOverview: async () => overview, readAdminSnoozes: () => ({}) },
      { ...adminInLab, joinPasswordNeedsChange: true },
      now,
    )
    expect(result).toMatchObject({ type: 'admin_tasks', total: 2, snoozedCount: 0, failedSourceCount: 1 })
    expect(result.type === 'admin_tasks' && result.tasks.map((task) => task.kind).sort())
      .toEqual(['join_password', 'purchase_request'])
  })

  it('leaves out tasks the admin hid for this week', async () => {
    const now = Date.UTC(2026, 10, 27, 3, 0, 0)
    const overview: LabAdminOverviewResults = {
      purchaseRequests: { status: 'fulfilled', value: [{ id: 'p1', createdAt: '2026-11-20T00:00:00Z' }] },
    }
    const visible = await resultOf({ kind: 'admin_tasks' }, { loadAdminOverview: async () => overview, readAdminSnoozes: () => ({}) }, adminInLab, now)
    const key = visible.type === 'admin_tasks' ? visible.tasks[0].key : ''
    await expect(resultOf(
      { kind: 'admin_tasks' },
      { loadAdminOverview: async () => overview, readAdminSnoozes: () => ({ [key]: now + 60_000 }) },
      adminInLab,
      now,
    )).resolves.toMatchObject({ type: 'admin_tasks', total: 0, snoozedCount: 1 })
  })

  it.each([
    ['low_stock', { ...adminInLab, purchaseRequestsEnabled: false }],
    ['regulated_list', { ...adminInLab, regulationBatchEnabled: false }],
    ['cabinet_locks', { ...adminInLab, cabinetLockRulesEnabled: false }],
    ['cabinet_locks', personalSpace],
    ['inspection_gaps', { ...adminInLab, dailyInspectionEnabled: false }],
    ['inspection_gaps', personalSpace],
    ['purchase_status', personalSpace],
    ['admin_tasks', { ...adminInLab, isAdmin: false }],
    ['admin_tasks', personalSpace],
  ] as const)('reads nothing for %s when it is closed to this person', async (kind, context) => {
    await expect(resultOf({ kind }, {}, context)).resolves.toEqual(CLOSED)
  })
})

describe('running an agent plan: waste records', () => {
  const container = (overrides: Partial<WasteContainer>) => ({
    id: 'c', label: 'Container', streamCode: 'ORGANIC_HALOGENATED', status: 'active', location: null,
    capacityMl: null, startedAt: '2026-11-01T00:00:00Z', ...overrides,
  }) as WasteContainer

  it('shows how full each container is from the recorded totals', async () => {
    const containers = [
      container({ id: 'sealed', label: 'B', status: 'sealed', capacityMl: 10_000, pickupRequestedAt: '2026-11-26T00:00:00Z' }),
      container({ id: 'open', label: 'A', capacityMl: 20_000, location: 'Hood 2' }),
      container({ id: 'bare', label: 'C' }),
    ]
    const totals = {
      sealed: { depositCount: 4, totalMl: 9_500, hasUnknownAmounts: false },
      open: { depositCount: 2, totalMl: 5_000, hasUnknownAmounts: true },
    }
    const result = await resultOf({ kind: 'container_status' }, { loadContainers: async () => ({ containers, totals }) })
    expect(result.type === 'container_status' && result.containers).toEqual([
      { id: 'open', label: 'A', streamCode: 'ORGANIC_HALOGENATED', status: 'active', location: 'Hood 2', totalMl: 5_000, fillPercent: 25, hasUnknownAmounts: true, pickupRequested: false },
      { id: 'bare', label: 'C', streamCode: 'ORGANIC_HALOGENATED', status: 'active', location: null, totalMl: 0, fillPercent: null, hasUnknownAmounts: false, pickupRequested: false },
      { id: 'sealed', label: 'B', streamCode: 'ORGANIC_HALOGENATED', status: 'sealed', location: null, totalMl: 9_500, fillPercent: 95, hasUnknownAmounts: false, pickupRequested: true },
    ])
  })

  it('falls back to the fixed disposal card when containers are not in use', async () => {
    await expect(resultOf({ kind: 'container_status' }, {}, { ...adminInLab, wasteContainersEnabled: false }))
      .resolves.toEqual({ type: 'disposal_redirect' })
  })

  it('computes each period in local time, with weeks starting on Monday', () => {
    // Friday 2026-11-27, 15:00 local.
    const now = new Date(2026, 10, 27, 15, 0, 0).getTime()
    const range = (period: Parameters<typeof wastePeriodRange>[0]) => {
      const { start, end } = wastePeriodRange(period, now)
      const day = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${date.getHours()}h`
      return [day(start), end ? day(end) : null]
    }
    expect(range('today')).toEqual(['2026-11-27 0h', null])
    expect(range('this_week')).toEqual(['2026-11-23 0h', null])
    expect(range('last_week')).toEqual(['2026-11-16 0h', '2026-11-23 0h'])
    expect(range('this_month')).toEqual(['2026-11-1 0h', null])
    expect(range('last_month')).toEqual(['2026-10-1 0h', '2026-11-1 0h'])
    expect(range('last_30d')).toEqual(['2026-10-28 0h', null])
  })

  it('adds up a period by stream and leaves out voided and volume-less records', async () => {
    const now = new Date(2026, 10, 27, 15, 0, 0).getTime()
    const log = (overrides: Partial<WasteLogRecord>) => ({
      id: 'l', created_at: new Date(2026, 9, 15).toISOString(), chemicals: [], disposal_category: 'ORGANIC_HALOGEN',
      total_volume_ml: null, handler_name: null, memo: null, ...overrides,
    }) as unknown as WasteLogRecord
    const logs = [
      log({ schema_version: 2, stream_code: 'ORGANIC_HALOGENATED', normalized_amount_unit: 'mL', normalized_amount_value: 100 }),
      log({ schema_version: 2, stream_code: 'ORGANIC_HALOGENATED', amount_is_unknown: true }),
      log({ schema_version: 1, disposal_category: 'ACID', total_volume_ml: 50 }),
      log({ schema_version: 2, stream_code: 'ORGANIC_HALOGENATED', normalized_amount_unit: 'mL', normalized_amount_value: 900, voided_at: '2026-10-16T00:00:00Z' }),
      // Exactly on the end of the period: belongs to the next month.
      log({ schema_version: 1, disposal_category: 'ACID', total_volume_ml: 999, created_at: new Date(2026, 10, 1).toISOString() }),
    ]
    const loadWasteLogs = vi.fn(async () => ({ logs, truncated: false }))

    const result = await resultOf({ kind: 'waste_summary', period: 'last_month' }, { loadWasteLogs }, adminInLab, now)

    expect(loadWasteLogs).toHaveBeenCalledWith(new Date(2026, 9, 1).toISOString(), new Date(2026, 10, 1).toISOString())
    expect(result).toEqual({
      type: 'waste_summary',
      period: 'last_month',
      logCount: 3,
      totalVolumeMl: 150,
      truncated: false,
      streams: [
        { streamCode: 'ORGANIC_HALOGENATED', category: 'ORGANIC_HALOGEN', count: 2, volumeMl: 100, withoutVolumeCount: 1 },
        { streamCode: null, category: 'ACID', count: 1, volumeMl: 50, withoutVolumeCount: 0 },
      ],
    })
  })

  it('asks for an open-ended period without an end and passes on a partial read', async () => {
    const now = new Date(2026, 10, 27, 15, 0, 0).getTime()
    const loadWasteLogs = vi.fn(async () => ({ logs: [], truncated: true }))
    await expect(resultOf({ kind: 'waste_summary', period: 'this_month' }, { loadWasteLogs }, personalSpace, now))
      .resolves.toMatchObject({ type: 'waste_summary', logCount: 0, truncated: true })
    expect(loadWasteLogs).toHaveBeenCalledWith(new Date(2026, 10, 1).toISOString(), null)
  })
})

describe('running an agent plan: proposals to record something', () => {
  const acetone = { text: 'Acetone', aliases: [], casNumber: null }
  const propose = (plan: AgentRunnablePlan, reads: Partial<AgentDataSources> = {}, context = adminInLab) => (
    resultOf(plan, reads, context, undefined, true)
  )

  it('runs no write plan unless the runtime switch allows actions', async () => {
    // No reads are supplied: a closed plan must not even look at the records.
    await expect(resultOf({ kind: 'log_usage', item: acetone, change: { kind: 'used_up' } })).resolves.toEqual(CLOSED)
    await expect(resultOf({ kind: 'register_item', name: 'Acetone', casNumber: null, quantity: 2, capacity: null })).resolves.toEqual(CLOSED)
    await expect(resultOf({ kind: 'request_purchase', item: acetone, quantity: 2 })).resolves.toEqual(CLOSED)
    await expect(resultOf({ kind: 'pickup_request' })).resolves.toEqual({ type: 'disposal_redirect' })
  })

  it('proposes a usage record for every bottle with that name and picks none of them', async () => {
    const bottles = [item({ name: 'Acetone', remaining_percent: 60 }), item({ name: 'Acetone', brand: 'Sigma' })]
    const result = await propose(
      { kind: 'log_usage', item: acetone, change: { kind: 'remaining', percent: 30 } },
      { loadItems: async () => [...bottles, item({ name: 'Ethanol' })] },
    )
    expect(result).toMatchObject({
      type: 'usage_proposal', query: 'Acetone', change: { kind: 'remaining', percent: 30 },
      hiddenCount: 0, aliasOnly: false, labId: LAB_ID,
    })
    expect(result.type === 'usage_proposal' && result.items.map((entry) => entry.id).sort()).toEqual(bottles.map((entry) => entry.id).sort())
  })

  it('says so when no record has that name instead of proposing anything', async () => {
    await expect(propose(
      { kind: 'log_usage', item: acetone, change: { kind: 'used_up' } },
      { loadItems: async () => [item({ name: 'Ethanol' })] },
    )).resolves.toEqual({ type: 'item_no_match', query: 'Acetone', inventoryIsEmpty: false })
  })

  it('proposes a registration from the typed details alone, without reading the records', async () => {
    await expect(propose(
      { kind: 'register_item', name: 'Acetone', casNumber: '67-64-1', quantity: 2, capacity: '500 mL' },
      {},
      personalSpace,
    )).resolves.toEqual({
      type: 'register_proposal',
      draft: { name: 'Acetone', casNumber: '67-64-1', quantity: 2, capacity: '500 mL' },
      labId: null,
    })
  })

  it('proposes a purchase request only in a lab with purchase requests on', async () => {
    const plan: AgentRunnablePlan = { kind: 'request_purchase', item: acetone, quantity: 2 }
    await expect(propose(plan, {}, personalSpace)).resolves.toEqual(CLOSED)
    await expect(propose(plan, {}, { ...adminInLab, purchaseRequestsEnabled: false })).resolves.toEqual(CLOSED)
  })

  it('offers to link a purchase request only to inventory rows that carry the typed name', async () => {
    const row = item({ name: 'Acetone', brand: 'Sigma' })
    const linkedBottle = item({ name: 'Acetone', _source: 'cabinet_item', linked_inventory_item_id: row.id })
    const looseBottle = item({ name: 'Acetone', _source: 'cabinet_item', linked_inventory_item_id: null })
    const result = await propose(
      { kind: 'request_purchase', item: acetone, quantity: null },
      { loadItems: async () => [linkedBottle, row, looseBottle] },
    )
    expect(result).toMatchObject({ type: 'purchase_proposal', itemName: 'Acetone', quantity: null, labId: LAB_ID })
    // The linked bottle and its row are one inventory row; a bottle with no row cannot be linked.
    expect(result.type === 'purchase_proposal' && result.matches).toHaveLength(1)

    const aliasOnly = await propose(
      { kind: 'request_purchase', item: { text: '아세톤', aliases: ['acetone'], casNumber: null }, quantity: 1 },
      { loadItems: async () => [row] },
    )
    expect(aliasOnly).toMatchObject({ type: 'purchase_proposal', itemName: '아세톤', matches: [] })
  })

  it('proposes a pickup for containers that are not already waiting for one', async () => {
    const container = (id: string, pickupRequestedAt: string | null): WasteContainer => ({
      id, labId: LAB_ID, streamCode: 'ACID_AQUEOUS', label: `산 폐액-${id}`, location: null, capacityMl: 10_000,
      status: 'active', startedAt: '2026-11-01T00:00:00Z', pickupRequestedAt,
    } as WasteContainer)
    const reads = {
      loadContainers: async () => ({
        containers: [container('1', null), container('2', '2026-11-20T00:00:00Z')],
        totals: { 1: { depositCount: 2, totalMl: 4_000, hasUnknownAmounts: false } },
      }),
    }
    const result = await propose({ kind: 'pickup_request' }, reads)
    expect(result).toMatchObject({
      type: 'pickup_proposal', requestedCount: 1, labId: LAB_ID,
      containers: [{ id: '1', label: '산 폐액-1', fillPercent: 40, pickupRequested: false }],
    })

    // Without the containers feature the request still ends at the fixed card.
    await expect(propose({ kind: 'pickup_request' }, {}, { ...adminInLab, wasteContainersEnabled: false }))
      .resolves.toEqual({ type: 'disposal_redirect' })
  })
})

describe('running an agent plan: a waste batch read from one sentence', () => {
  const mL = (value: number) => ({ value, unit: 'mL', kind: 'volume' } as const)
  const chemical = (name: string, casNumber: string) => ({
    id: casNumber, name, casNumber, molecularFormula: 'C3H6O', properties: { isOrganic: true, isHalogenated: false },
  })
  const plan = (...names: string[]): AgentRunnablePlan => ({
    kind: 'waste_batch', components: names.map((name) => ({ name, amount: mL(100) })),
  })

  it('looks each component up by name and adds nothing by itself', async () => {
    const lookupChemical = vi.fn(async (query: string) => (query === '아세톤' ? chemical('Acetone', '67-64-1') : null))
    // Offered without the runtime switch: the draft stays on the device.
    const result = await resultOf(plan('아세톤', '없는물질'), { lookupChemical, loadFormChoices: async () => [] }, personalSpace)
    expect(result).toMatchObject({
      type: 'waste_batch_proposal',
      labId: null,
      components: [
        { typedName: '아세톤', amount: mL(100), lookup: { status: 'found', verifiedByCas: false, analysis: { chemical: { casNumber: '67-64-1' } } } },
        { typedName: '없는물질', lookup: { status: 'not_found' } },
      ],
    })
    expect(lookupChemical.mock.calls.map(([query]) => query)).toEqual(['아세톤', '없는물질'])
  })

  it('asks which form when a name fits several, instead of taking one', async () => {
    const lookupChemical = vi.fn()
    const result = await resultOf(plan('염산'), {
      lookupChemical,
      loadFormChoices: async () => [{ name: '염산 35%' }, { name: '염산 10%' }],
    })
    expect(result).toMatchObject({ components: [{ lookup: { status: 'choose_form', choices: [{ name: '염산 35%' }, { name: '염산 10%' }] } }] })
    expect(lookupChemical).not.toHaveBeenCalled()
  })

  it('confirms an identity only through a CAS number the person typed', async () => {
    const result = await resultOf(plan('67-64-1'), {
      lookupChemical: async () => chemical('Acetone', '67-64-1'),
      // A CAS number names one substance, so no form question is asked.
    })
    expect(result).toMatchObject({ components: [{ lookup: { status: 'found', verifiedByCas: true } }] })
  })

  it('reports a failed lookup for that component only', async () => {
    const result = await resultOf(plan('아세톤', '메탄올'), {
      lookupChemical: async (query) => {
        if (query === '메탄올') throw new Error('offline')
        return chemical('Acetone', '67-64-1')
      },
      // A failed form lookup is not a reason to drop the component.
      loadFormChoices: async () => { throw new Error('offline') },
    })
    expect(result).toMatchObject({ components: [{ lookup: { status: 'found' } }, { lookup: { status: 'failed' } }] })
  })
})
