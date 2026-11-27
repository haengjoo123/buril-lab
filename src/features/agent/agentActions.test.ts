import { beforeEach, describe, expect, it, vi } from 'vitest'

const labState = vi.hoisted(() => ({ currentLabId: null as string | null }))
const wasteState = vi.hoisted(() => ({ batch: { components: [] as unknown[], labId: null as string | null }, addToCart: vi.fn() }))
const updateItemUsage = vi.hoisted(() => vi.fn())

vi.mock('../../store/useLabStore', () => ({ useLabStore: { getState: () => labState } }))
vi.mock('../../store/useWasteStore', () => ({ useWasteStore: { getState: () => wasteState } }))
vi.mock('../../services/inventoryService', () => ({
  inventoryService: { updateItemUsage },
  storageLocationService: {},
  createInventoryOperationRequestId: () => 'request-id',
}))
vi.mock('../../services/purchaseRequestService', () => ({ createPurchaseRequest: vi.fn(), toPurchaseError: vi.fn() }))
vi.mock('../../services/wasteContainerService', () => ({ requestWasteContainerPickup: vi.fn(), toWasteContainerError: vi.fn() }))
vi.mock('./agentDataSources', () => ({ agentDataSources: {} }))

import type { InventoryItem } from '../../services/inventoryService'
import { AgentActionError, agentActions, type AgentWasteBatchAddition } from './agentActions'

const LAB_ID = '11111111-1111-4111-8111-111111111111'

function addition(overrides: Partial<AgentWasteBatchAddition> = {}): AgentWasteBatchAddition {
  return {
    typedName: '아세톤',
    analysis: { chemical: { id: 'a', name: 'Acetone', casNumber: '67-64-1', molecularFormula: 'C3H6O' } } as AgentWasteBatchAddition['analysis'],
    verifiedByCas: false,
    amount: { value: 200, unit: 'mL', kind: 'volume' },
    ...overrides,
  }
}

describe('agent actions', () => {
  beforeEach(() => {
    labState.currentLabId = LAB_ID
    wasteState.batch = { components: [], labId: LAB_ID }
    wasteState.addToCart.mockReset()
    updateItemUsage.mockReset().mockResolvedValue(undefined)
  })

  it('refuses to save a proposal built in another space', async () => {
    labState.currentLabId = 'another-lab'
    const item = { id: 'item' } as InventoryItem
    await expect(agentActions.setRemaining(LAB_ID, item, 30)).rejects.toBeInstanceOf(AgentActionError)
    await expect(agentActions.addToWasteBatch(LAB_ID, [addition()])).rejects.toMatchObject({ kind: 'space_changed' })
    expect(updateItemUsage).not.toHaveBeenCalled()
    expect(wasteState.addToCart).not.toHaveBeenCalled()
  })

  it('records a remaining level through the inventory service', async () => {
    const item = { id: 'item' } as InventoryItem
    await agentActions.setRemaining(LAB_ID, item, 30)
    expect(updateItemUsage).toHaveBeenCalledWith(item, { remaining_percent: 30 })
  })

  it('refuses to add to a waste batch draft that belongs to another space', async () => {
    wasteState.batch = { components: [], labId: null }
    await expect(agentActions.addToWasteBatch(LAB_ID, [addition()])).rejects.toMatchObject({ kind: 'space_changed' })
    expect(wasteState.addToCart).not.toHaveBeenCalled()
  })

  it('adds components for review, confirming identity only for a typed CAS number', async () => {
    const byName = addition()
    const byCas = addition({ typedName: '67-56-1', verifiedByCas: true, amount: { value: 1.5, unit: 'L', kind: 'volume' } })
    const byMass = addition({ typedName: '염화나트륨', amount: { value: 5, unit: 'g', kind: 'mass' } })
    const tiny = addition({ typedName: 'DMSO', amount: { value: 500, unit: 'uL', kind: 'volume' } })
    await agentActions.addToWasteBatch(LAB_ID, [byName, byCas, byMass, tiny])

    expect(wasteState.addToCart.mock.calls.map(([, options]) => options)).toEqual([
      { sourceType: 'search', sourceRef: '아세톤', identityConfidence: 'review_required', ghsDataStatus: 'not_checked', solutionVolume: { value: 200, unit: 'mL', normalizedMl: 200 } },
      { sourceType: 'search', sourceRef: '67-56-1', identityConfidence: 'verified', ghsDataStatus: 'not_checked', solutionVolume: { value: 1.5, unit: 'L', normalizedMl: 1_500 } },
      // A mass does not fit the per-component volume; it is entered in the review.
      { sourceType: 'search', sourceRef: '염화나트륨', identityConfidence: 'review_required', ghsDataStatus: 'not_checked', solutionVolume: undefined },
      { sourceType: 'search', sourceRef: 'DMSO', identityConfidence: 'review_required', ghsDataStatus: 'not_checked', solutionVolume: { value: 500, unit: 'uL', normalizedMl: 0.5 } },
    ])
    expect(wasteState.addToCart.mock.calls[0][0]).toBe(byName.analysis)
  })

  it('reads the hazard lookup the way the inventory batch flow does', async () => {
    const withStatus = (status: string) => addition({
      analysis: { chemical: { id: 'a', name: 'A', casNumber: '', molecularFormula: '', hazardLookup: { status } } } as unknown as AgentWasteBatchAddition['analysis'],
    })
    await agentActions.addToWasteBatch(LAB_ID, [
      withStatus('classified'), withStatus('not_classified'), withStatus('source_absent'), withStatus('identity_ambiguous'), withStatus('transient_error'),
    ])
    expect(wasteState.addToCart.mock.calls.map(([, options]) => options.ghsDataStatus))
      .toEqual(['verified', 'verified', 'lookup_failed', 'lookup_failed', 'not_checked'])
  })
})
