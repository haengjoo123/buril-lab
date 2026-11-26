import {
  createInventoryOperationRequestId,
  inventoryService,
  storageLocationService,
  type InventoryItem,
  type StorageLocation,
} from '../../services/inventoryService'
import { createPurchaseRequest, toPurchaseError, type NewPurchaseRequest } from '../../services/purchaseRequestService'
import { requestWasteContainerPickup, toWasteContainerError } from '../../services/wasteContainerService'
import { useLabStore } from '../../store/useLabStore'
import { useWasteStore } from '../../store/useWasteStore'
import type { AnalysisResult, WasteDataStatus, WasteSolutionVolume } from '../../types'
import { agentDataSources } from './agentDataSources'
import type { AgentActionErrorKind, AgentWasteComponentLookup } from './agentResults'
import { lookupWasteComponent } from './executors/wasteBatch'
import type { ParsedWasteAmount } from './parseWasteComponents'

/** A confirmed proposal that was not saved, with a reason the card can explain. */
export class AgentActionError extends Error {
  readonly kind: AgentActionErrorKind
  constructor(kind: AgentActionErrorKind) {
    super(`Agent action was not saved: ${kind}`)
    this.name = 'AgentActionError'
    this.kind = kind
  }
}

/**
 * A proposal belongs to the space it was built in. If the person has moved to
 * another lab since, its records are not the ones on screen: refuse to save.
 */
function assertSameSpace(labId: string | null): void {
  if ((useLabStore.getState().currentLabId ?? null) !== labId) throw new AgentActionError('space_changed')
}

/** One looked-up component the person chose to put into the waste batch draft. */
export interface AgentWasteBatchAddition {
  typedName: string
  analysis: AnalysisResult
  verifiedByCas: boolean
  amount: ParsedWasteAmount
}

const ML_PER_UNIT = { uL: 0.001, mL: 1, L: 1_000 } as const

/** Only a volume fits the batch's per-component amount; a mass is entered in the review. */
function solutionVolumeOf(amount: ParsedWasteAmount): WasteSolutionVolume | undefined {
  if (amount.kind !== 'volume' || amount.unit === 'mg' || amount.unit === 'g' || amount.unit === 'kg') return undefined
  return { value: amount.value, unit: amount.unit, normalizedMl: amount.value * ML_PER_UNIT[amount.unit] }
}

/** Same reading of the hazard lookup as when an inventory bottle starts a batch. */
function ghsStatusOf(analysis: AnalysisResult): WasteDataStatus {
  const status = analysis.chemical.hazardLookup?.status
  if (status === 'classified' || status === 'not_classified') return 'verified'
  if (status === 'source_absent' || status === 'identity_ambiguous') return 'lookup_failed'
  return 'not_checked'
}

/**
 * Every write the agent can make, each one the same service call the ordinary
 * screens use and each made only after the person confirms a proposal. An
 * object so the layout fixture and tests can stand in for the backend.
 */
export interface AgentActions {
  setRemaining: (labId: string | null, item: InventoryItem, percent: number) => Promise<void>
  /** Marks one bottle on a cabinet shelf as used up. `requestId` makes a retry safe. */
  recordUsedUp: (labId: string | null, cabinetItemId: string, requestId: string) => Promise<void>
  requestPurchase: (labId: string, input: NewPurchaseRequest) => Promise<void>
  requestPickup: (labId: string | null, containerId: string) => Promise<void>
  /** Storage places for the registration form. */
  loadLocations: () => Promise<StorageLocation[]>
  /** An id for one confirmed action, reused when the same action is retried. */
  newRequestId: () => string
  /** Components already in the waste batch draft, so the proposal can say it adds to them. */
  wasteBatchSize: () => number
  /** Looks up the form of a reagent the person picked from several. */
  lookupForm: (name: string) => Promise<AgentWasteComponentLookup>
  /**
   * Puts looked-up components into the waste batch draft on this device.
   * Nothing is disposed of or recorded: the review screen decides the rest.
   */
  addToWasteBatch: (labId: string | null, components: AgentWasteBatchAddition[]) => Promise<void>
}

export const agentActions: AgentActions = {
  async setRemaining(labId, item, percent) {
    assertSameSpace(labId)
    await inventoryService.updateItemUsage(item, { remaining_percent: percent })
  },
  async recordUsedUp(labId, cabinetItemId, requestId) {
    assertSameSpace(labId)
    await inventoryService.recordUsageCompletion({ cabinetItemId, requestId, completionKind: 'used' })
  },
  async requestPurchase(labId, input) {
    assertSameSpace(labId)
    try {
      await createPurchaseRequest(labId, input)
    } catch (error) {
      const code = toPurchaseError(error).code
      throw new AgentActionError(code === 'access_denied' || code === 'admin_required' ? 'not_allowed' : 'failed')
    }
  },
  async requestPickup(labId, containerId) {
    assertSameSpace(labId)
    try {
      await requestWasteContainerPickup(containerId)
    } catch (error) {
      const code = toWasteContainerError(error).code
      throw new AgentActionError(code === 'access_denied' || code === 'admin_required' ? 'not_allowed' : 'failed')
    }
  },
  loadLocations: () => storageLocationService.getLocations(),
  newRequestId: () => createInventoryOperationRequestId(),
  wasteBatchSize: () => useWasteStore.getState().batch.components.length,
  lookupForm: (name) => lookupWasteComponent(name, agentDataSources, { skipFormChoices: true }),
  async addToWasteBatch(labId, components) {
    assertSameSpace(labId)
    // The draft belongs to one space as well; it must be the one the proposal was built in.
    if ((useWasteStore.getState().batch.labId ?? null) !== labId) throw new AgentActionError('space_changed')
    for (const component of components) {
      useWasteStore.getState().addToCart(component.analysis, {
        sourceType: 'search',
        sourceRef: component.typedName,
        // A name can fit similarly named substances. Only a typed CAS number that
        // the substance carries is confirmed without the person; the review asks about the rest.
        identityConfidence: component.verifiedByCas ? 'verified' : 'review_required',
        ghsDataStatus: ghsStatusOf(component.analysis),
        solutionVolume: solutionVolumeOf(component.amount),
      })
    }
  },
}

export function actionErrorKindOf(error: unknown): AgentActionErrorKind {
  return error instanceof AgentActionError ? error.kind : 'failed'
}
