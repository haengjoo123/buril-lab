import type { LabAdminOverviewResults, LabAdminSourceKey, LabAdminSourceValues } from '../../../services/labAdminOverviewService'
import type { PurchaseRequest } from '../../../services/purchaseRequestService'
import { buildLabAdminTasks, type LabAdminSnoozes } from '../../admin/labAdminTasks'
import { kstDateString } from '../../dailyInspection/inspectionSummary'
import {
  INSPECTION_LOOKBACK_DAYS,
  missingInspectionWeekdays,
  type CabinetLockSummary,
} from '../../dailyInspection/labSafetySignals'
import type { AgentResult } from '../agentResults'

export const AGENT_PURCHASE_WAITING_LIMIT = 5
export const AGENT_ADMIN_TASK_LIMIT = 8

export function runCabinetLocks(summary: CabinetLockSummary): AgentResult {
  return { type: 'cabinet_locks', unlocked: summary.unlocked, unset: summary.unset }
}

/**
 * Weekdays without a daily inspection record. This only reports what is
 * missing; it never fills in or suggests an inspection answer.
 */
export function runInspectionGaps(records: ReadonlyArray<{ inspectionDate: string }>, now: number): AgentResult {
  const today = kstDateString(now)
  return {
    type: 'inspection_gaps',
    missingDates: missingInspectionWeekdays(records, now),
    lookbackDays: INSPECTION_LOOKBACK_DAYS,
    recordedToday: records.some((record) => record.inspectionDate === today),
  }
}

export function runPurchaseStatus(requests: readonly PurchaseRequest[]): AgentResult {
  const count = (status: PurchaseRequest['status']) => requests.filter((request) => request.status === status).length
  const waiting = requests
    .filter((request) => request.status === 'requested')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(0, AGENT_PURCHASE_WAITING_LIMIT)
    .map(({ id, itemName, quantity, createdAt }) => ({ id, itemName, quantity, createdAt }))
  return {
    type: 'purchase_status',
    requested: count('requested'),
    approved: count('approved'),
    ordered: count('ordered'),
    waiting,
  }
}

function loaded<K extends LabAdminSourceKey>(results: LabAdminOverviewResults, key: K): LabAdminSourceValues[K] | null {
  const result = results[key]
  return result?.status === 'fulfilled' ? result.value : null
}

/**
 * This week's "확인할 일", built by the same function as the lab admin
 * overview, so both list the same tasks in the same order.
 */
export function runAdminTasks(
  results: LabAdminOverviewResults,
  options: { now: number; snoozes: LabAdminSnoozes; joinPasswordNeedsChange: boolean },
): AgentResult {
  const { active, snoozed } = buildLabAdminTasks({
    centerRequests: loaded(results, 'centerRequests'),
    linkRequests: loaded(results, 'linkRequests'),
    inventory: loaded(results, 'inventory')?.datedItems ?? null,
    dangerWarnings: loaded(results, 'dangerWarnings'),
    wasteContainers: loaded(results, 'wasteContainers'),
    members: loaded(results, 'members'),
    purchaseRequests: loaded(results, 'purchaseRequests'),
    dailyInspections: loaded(results, 'dailyInspections'),
    cabinetLocks: loaded(results, 'cabinetLocks'),
    joinPasswordNeedsChange: options.joinPasswordNeedsChange,
  }, options.now, options.snoozes)

  return {
    type: 'admin_tasks',
    tasks: active.slice(0, AGENT_ADMIN_TASK_LIMIT),
    total: active.length,
    snoozedCount: snoozed.length,
    failedSourceCount: Object.values(results).filter((result) => result?.status === 'rejected').length,
  }
}
