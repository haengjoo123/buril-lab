import type { SafetyCenterStatus } from '../safety-center/types'

const DAY_MS = 24 * 60 * 60 * 1000
/** Asia/Seoul is UTC+9 all year (no daylight saving). */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** A pending request older than this many days is shown in orange so it gets picked up first. */
export const APPROVAL_WAIT_WARNING_DAYS = 3

export type ApprovalStatusFilter = 'all' | SafetyCenterStatus

export type ApprovalStatusCounts = Record<ApprovalStatusFilter, number>

interface ApprovalQueueItem {
  status: SafetyCenterStatus
  created_at: string
}

function toTime(value: string): number {
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

function seoulDayNumber(time: number): number {
  return Math.floor((time + KST_OFFSET_MS) / DAY_MS)
}

/**
 * Days a request has waited, counted on the Asia/Seoul calendar: 0 = created today, 1 = yesterday
 * (even at 23:00), never negative. Matches the dates shown next to each request.
 */
export function getWaitingDays(createdAt: string, now: number): number {
  const created = Date.parse(createdAt)
  if (!Number.isFinite(created)) return 0
  return Math.max(0, seoulDayNumber(now) - seoulDayNumber(created))
}

export function countApprovalsByStatus(items: ReadonlyArray<{ status: SafetyCenterStatus }>): ApprovalStatusCounts {
  const counts: ApprovalStatusCounts = { all: items.length, pending: 0, approved: 0, rejected: 0 }
  for (const item of items) counts[item.status] += 1
  return counts
}

/**
 * Pending requests come first and oldest first, so the longest wait is on top.
 * Decided requests keep the newest-first order the server returns.
 */
export function sortApprovalQueue<T extends ApprovalQueueItem>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aPending = a.item.status === 'pending'
      const bPending = b.item.status === 'pending'
      if (aPending !== bPending) return aPending ? -1 : 1
      const diff = aPending
        ? toTime(a.item.created_at) - toTime(b.item.created_at)
        : toTime(b.item.created_at) - toTime(a.item.created_at)
      return diff || a.index - b.index
    })
    .map(({ item }) => item)
}
