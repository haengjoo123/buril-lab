import type { WasteContainer, WasteContainerTotals } from '../../../services/wasteContainerService'
import type { WasteLogRecord } from '../../../services/wasteLogService'
import { getWasteLogVolumeMl, hasNoWasteLogVolume } from '../../../utils/wasteLogVolume'
import { sortContainers } from '../../wasteContainers/containerSummary'
import type { AgentWastePeriod } from '../agentGuard'
import type { AgentContainerRow, AgentResult, AgentWasteStreamRow } from '../agentResults'

/**
 * Answers about waste records. These report what was recorded; they never say
 * how anything should be disposed of.
 */
export function containerRows(
  containers: WasteContainer[],
  totals: Readonly<Record<string, WasteContainerTotals>>,
): AgentContainerRow[] {
  return sortContainers(containers).map((container) => {
    const total = totals[container.id]
    const totalMl = total?.totalMl ?? 0
    return {
      id: container.id,
      label: container.label,
      streamCode: container.streamCode,
      status: container.status,
      location: container.location,
      totalMl,
      fillPercent: container.capacityMl ? Math.round((totalMl / container.capacityMl) * 100) : null,
      hasUnknownAmounts: total?.hasUnknownAmounts ?? false,
      pickupRequested: Boolean(container.pickupRequestedAt),
    }
  })
}

export function runContainerStatus(
  containers: WasteContainer[],
  totals: Readonly<Record<string, WasteContainerTotals>>,
): AgentResult {
  return { type: 'container_status', containers: containerRows(containers, totals) }
}

/** Start (inclusive) and end (exclusive, or null for "until now") of a period, in local time. */
export function wastePeriodRange(period: AgentWastePeriod, now: number): { start: Date; end: Date | null } {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  // Weeks start on Monday.
  const monday = new Date(today)
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  if (period === 'today') return { start: today, end: null }
  if (period === 'this_week') return { start: monday, end: null }
  if (period === 'last_week') {
    const start = new Date(monday)
    start.setDate(monday.getDate() - 7)
    return { start, end: monday }
  }
  if (period === 'this_month') return { start: firstOfMonth, end: null }
  if (period === 'last_month') {
    return { start: new Date(today.getFullYear(), today.getMonth() - 1, 1), end: firstOfMonth }
  }
  const start = new Date(today)
  start.setDate(today.getDate() - 30)
  return { start, end: null }
}

export function runWasteSummary(
  period: AgentWastePeriod,
  logs: readonly WasteLogRecord[],
  truncated: boolean,
): AgentResult {
  const streams = new Map<string, AgentWasteStreamRow>()
  let logCount = 0
  let totalVolumeMl = 0
  for (const log of logs) {
    // A voided record was corrected or withdrawn: it is not part of what was disposed.
    if (log.voided_at) continue
    logCount += 1
    const volumeMl = getWasteLogVolumeMl(log)
    totalVolumeMl += volumeMl
    const key = log.stream_code ? `stream:${log.stream_code}` : `category:${log.disposal_category}`
    const row = streams.get(key) ?? {
      streamCode: log.stream_code ?? null,
      category: log.disposal_category,
      count: 0,
      volumeMl: 0,
      withoutVolumeCount: 0,
    }
    row.count += 1
    row.volumeMl += volumeMl
    if (hasNoWasteLogVolume(log)) row.withoutVolumeCount += 1
    streams.set(key, row)
  }

  return {
    type: 'waste_summary',
    period,
    streams: [...streams.values()].sort((left, right) => right.volumeMl - left.volumeMl || right.count - left.count),
    logCount,
    totalVolumeMl,
    truncated,
  }
}
