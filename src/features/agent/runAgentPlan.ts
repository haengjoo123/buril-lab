import type { AgentDataSources } from './agentDataSources'
import type { AgentResult, AgentRunnablePlan, AgentUiAction } from './agentResults'
import { screenUnavailableReason, type AgentRuntimeContext } from './capabilityRegistry'
import { runExpiryList } from './executors/expiryList'
import { runItemLookup } from './executors/itemLookup'
import { runAdminTasks, runCabinetLocks, runInspectionGaps, runPurchaseStatus } from './executors/labStatus'
import { runLowStock } from './executors/lowStock'
import { runPickupProposal, runPurchaseProposal, runUsageProposal } from './executors/proposals'
import { runWasteBatchProposal } from './executors/wasteBatch'
import { distinctCasNumbers, runRegulatedList } from './executors/regulatedList'
import { runContainerStatus, runWasteSummary, wastePeriodRange } from './executors/wasteRecords'

/** A plan either shows something in the result area or makes the app go somewhere. */
export type AgentPlanOutcome =
  | { result: AgentResult }
  | { uiAction: AgentUiAction }

/** The server sent a plan this build does not know: the app is older than the server. */
export class AgentUpdateRequiredError extends Error {
  constructor() {
    super('This app version cannot run the returned agent plan.')
    this.name = 'AgentUpdateRequiredError'
  }
}

export interface AgentPlanDependencies {
  /** Reads, all made with the signed-in person's own access. */
  sources: AgentDataSources
  context: AgentRuntimeContext
  /** Injected so date-based answers can be tested. */
  now?: number
  /**
   * Whether the runtime switch allows proposals to record something. The
   * server says so with every plan; without it a write plan is not run.
   */
  allowActions?: boolean
}

/** The plan asked for something this person or this build cannot use. */
const CLOSED: AgentPlanOutcome = { result: { type: 'unsupported', reason: 'capability_disabled' } }

/**
 * Runs a plan with the app's own data and rules. A plan only names what to do;
 * every fact shown afterwards comes from here. Each branch checks again that
 * the feature is open to this person, whatever the plan says.
 */
export async function runAgentPlan(
  plan: AgentRunnablePlan,
  { sources, context, now = Date.now(), allowActions = false }: AgentPlanDependencies,
): Promise<AgentPlanOutcome> {
  const { labId } = context
  switch (plan.kind) {
    case 'item_lookup':
      return { result: runItemLookup(await sources.loadItems(), plan.item, plan.facet) }
    case 'expiry_list':
      return { result: runExpiryList(await sources.loadItems(), plan.window) }
    case 'open_screen': {
      const reason = screenUnavailableReason(plan.screen, context)
      return reason
        ? { result: { type: 'screen_unavailable', screen: plan.screen, reason } }
        : { uiAction: { type: 'open_screen', screen: plan.screen } }
    }
    case 'low_stock': {
      if (!context.purchaseRequestsEnabled) return CLOSED
      const [items, usage] = await Promise.all([sources.loadItems(), sources.loadUsageCounts(labId)])
      return { result: runLowStock(items, usage) }
    }
    case 'regulated_list': {
      if (!context.regulationBatchEnabled) return CLOSED
      const items = await sources.loadItems()
      const casNumbers = distinctCasNumbers(items)
      const lookups = casNumbers.length > 0 ? await sources.loadRegulations(casNumbers) : new Map()
      return { result: runRegulatedList(items, lookups) }
    }
    case 'cabinet_locks':
      if (!context.cabinetLockRulesEnabled || !labId) return CLOSED
      return { result: runCabinetLocks(await sources.loadCabinetLocks(labId)) }
    case 'inspection_gaps':
      if (!context.dailyInspectionEnabled || !labId) return CLOSED
      return { result: runInspectionGaps(await sources.loadInspectionDates(labId), now) }
    case 'purchase_status':
      if (!context.purchaseRequestsEnabled || !labId) return CLOSED
      return { result: runPurchaseStatus(await sources.loadPurchaseRequests(labId)) }
    case 'admin_tasks':
      if (!context.isAdmin || !labId) return CLOSED
      return {
        result: runAdminTasks(await sources.loadAdminOverview(labId), {
          now,
          snoozes: sources.readAdminSnoozes(labId),
          joinPasswordNeedsChange: context.joinPasswordNeedsChange,
        }),
      }
    case 'container_status': {
      // Without the containers feature there is nothing to list: fall back to the fixed card.
      if (!context.wasteContainersEnabled) return { result: { type: 'disposal_redirect' } }
      const { containers, totals } = await sources.loadContainers()
      return { result: runContainerStatus(containers, totals) }
    }
    case 'waste_summary': {
      const { start, end } = wastePeriodRange(plan.period, now)
      const { logs, truncated } = await sources.loadWasteLogs(start.toISOString(), end ? end.toISOString() : null)
      // The service's upper bound is inclusive; drop a record that falls exactly on it.
      const inRange = end ? logs.filter((log) => new Date(log.created_at).getTime() < end.getTime()) : logs
      return { result: runWasteSummary(plan.period, inRange, truncated) }
    }
    case 'log_usage':
      if (!allowActions) return CLOSED
      return { result: runUsageProposal(await sources.loadItems(), plan.item, plan.change, labId) }
    case 'register_item':
      if (!allowActions) return CLOSED
      return {
        result: {
          type: 'register_proposal',
          draft: { name: plan.name, casNumber: plan.casNumber, quantity: plan.quantity, capacity: plan.capacity },
          labId,
        },
      }
    case 'request_purchase':
      if (!allowActions || !context.purchaseRequestsEnabled || !labId) return CLOSED
      return { result: runPurchaseProposal(await sources.loadItems(), plan.item, plan.quantity, labId) }
    case 'pickup_request': {
      // Without the switch or the containers feature, the request gets the fixed card as before.
      if (!allowActions || !context.wasteContainersEnabled) return { result: { type: 'disposal_redirect' } }
      const { containers, totals } = await sources.loadContainers()
      return { result: runPickupProposal(containers, totals, labId) }
    }
    case 'waste_batch':
      // No switch: the draft stays on this device until the person finishes the review.
      return { result: await runWasteBatchProposal(plan.components, sources, labId) }
    case 'handoff_search':
      return { uiAction: { type: 'search_chemical', query: plan.query } }
    case 'redirect_disposal':
      return { result: { type: 'disposal_redirect' } }
    case 'unsupported':
      return { result: { type: 'unsupported', reason: plan.reason } }
    default:
      throw new AgentUpdateRequiredError()
  }
}
