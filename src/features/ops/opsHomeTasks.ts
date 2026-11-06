import type { InboxSeverity } from '../../components/admin/InboxRow'
import type { SafetyCenterApprovalItem } from '../../services/opsAdminService'
import type { AnalyticsKpis } from '../../services/opsAnalyticsService'
import type { FeedbackInboxItem, FeedbackType } from '../../types/feedback'
import { isConsoleWideAccessIssue, type OpsAccessIssue, type OpsAccessProblem } from './opsAccess'
import { APPROVAL_WAIT_WARNING_DAYS, getWaitingDays } from './safetyCenterApprovalQueue'

/**
 * The operator list endpoints return at most this many rows, newest first
 * (functions/api/admin/feedback/list.ts, functions/api/admin/safety-centers/list.ts).
 * A full page means older rows may be missing, so counts from it are lower bounds.
 */
export const OPS_LIST_CAP = 200

/** An inbox item waiting longer than this many days turns its row red. Same rule as the approval queue. */
export const OPS_WAIT_WARNING_DAYS = APPROVAL_WAIT_WARNING_DAYS

/** A rate over fewer cases than this is shown as n/N or flagged as a small sample (plan 1-A). */
export const SMALL_SAMPLE_MIN = 10

/** Navigation badges stop counting here and show "99+". */
export const OPS_BADGE_MAX = 99

export const OPS_CENTERS_PENDING_PATH = '/ops/centers?status=pending'
export const OPS_FEEDBACK_PATH = '/ops/feedback'
export const OPS_REVIEWS_PATH = '/ops/analytics?tab=reviews'

const FEEDBACK_TYPE_ORDER: readonly FeedbackType[] = ['bug', 'improvement', 'general']

/** A count read from a capped list. `isLowerBound` means the list was full, so there may be more. */
export interface CappedCount {
  count: number
  isLowerBound: boolean
}

/** "12", or "12+" when the list hit the server cap. */
export function formatCappedCount({ count, isLowerBound }: CappedCount): string {
  return isLowerBound ? `${count}+` : String(count)
}

/** Badge text for a navigation item, or null when there is nothing to show (zero or unknown). */
export function formatBadgeCount(value: CappedCount | null | undefined): string | null {
  if (!value || !Number.isFinite(value.count) || value.count <= 0) return null
  if (value.count > OPS_BADGE_MAX) return `${OPS_BADGE_MAX}+`
  return formatCappedCount(value)
}

function isCapped(items: readonly unknown[]): boolean {
  return items.length >= OPS_LIST_CAP
}

function oldestWaitingDays(createdAts: readonly string[], now: number): number | null {
  if (createdAts.length === 0) return null
  return Math.max(...createdAts.map((createdAt) => getWaitingDays(createdAt, now)))
}

/**
 * amber while the oldest item is fresh or its age is unknown, red once it has waited more than
 * OPS_WAIT_WARNING_DAYS. A capped list never goes below amber, even with no visible item.
 */
export function waitSeverity(oldestDays: number | null): InboxSeverity {
  return oldestDays !== null && oldestDays > OPS_WAIT_WARNING_DAYS ? 'red' : 'amber'
}

export interface PendingCentersSummary {
  pending: CappedCount
  /** Longest wait among the listed requests. A lower bound when `pending.isLowerBound`. */
  oldestDays: number | null
  /** Pending requests whose requester domain was checked by the server, and how many matched. */
  domain: { matched: number; checked: number }
}

export function summarizePendingCenters(
  items: readonly SafetyCenterApprovalItem[],
  now: number,
): PendingCentersSummary {
  const pending = items.filter((item) => item.status === 'pending')
  let matched = 0
  let checked = 0
  for (const item of pending) {
    if (typeof item.domain_matches !== 'boolean') continue
    checked += 1
    if (item.domain_matches) matched += 1
  }
  return {
    pending: { count: pending.length, isLowerBound: isCapped(items) },
    oldestDays: oldestWaitingDays(pending.map((item) => item.created_at), now),
    domain: { matched, checked },
  }
}

export interface CenterStatusSummary {
  total: CappedCount
  approved: CappedCount
}

export function summarizeCenterStatuses(items: readonly SafetyCenterApprovalItem[]): CenterStatusSummary {
  const isLowerBound = isCapped(items)
  return {
    total: { count: items.length, isLowerBound },
    approved: { count: items.filter((item) => item.status === 'approved').length, isLowerBound },
  }
}

export interface NewFeedbackSummary {
  fresh: CappedCount
  /** Longest wait among the listed items. A lower bound when `fresh.isLowerBound`. */
  oldestDays: number | null
  /** Non-zero counts per type, bug first. */
  byType: Array<{ type: FeedbackType; count: number }>
}

export function summarizeNewFeedback(items: readonly FeedbackInboxItem[], now: number): NewFeedbackSummary {
  const fresh = items.filter((item) => item.status === 'new')
  const byType = FEEDBACK_TYPE_ORDER
    .map((type) => ({ type, count: fresh.filter((item) => item.type === type).length }))
    .filter((entry) => entry.count > 0)
  return {
    fresh: { count: fresh.length, isLowerBound: isCapped(items) },
    oldestDays: oldestWaitingDays(fresh.map((item) => item.created_at), now),
    byType,
  }
}

export type OpsInboxTaskId = 'centers' | 'feedback' | 'reviews'

interface OpsInboxTaskBase {
  severity: InboxSeverity
  count: CappedCount
  path: string
}

export type OpsInboxTask =
  | (OpsInboxTaskBase & { id: 'centers'; oldestDays: number | null; domain: PendingCentersSummary['domain'] })
  | (OpsInboxTaskBase & { id: 'feedback'; oldestDays: number | null; byType: NewFeedbackSummary['byType'] })
  /** `lastUpdatedAt`: when a pending candidate last changed (KPI inbox only; null from governance). */
  | (OpsInboxTaskBase & { id: 'reviews'; lastUpdatedAt: string | null })

/** One source's list and when it arrived. `loadedAt` is "now" for ages, so render stays pure. */
export interface LoadedList<T> {
  items: readonly T[]
  loadedAt: number
}

/** The exact queue sizes from analytics_admin_kpis_v1 and when the summary call that carried them arrived. */
export interface KpiInbox {
  inbox: AnalyticsKpis['inbox']
  loadedAt: number
}

export interface OpsInboxInput {
  centers: LoadedList<SafetyCenterApprovalItem> | null
  feedback: LoadedList<FeedbackInboxItem> | null
  /** governance.reviews.pending from the analytics summary. */
  reviewsPending: number | null
  /** Exact counts from the KPI function, when the server has it (phase 2). */
  kpiInbox?: KpiInbox | null
}

export interface OpsInbox {
  /**
   * Rows with something to do, most urgent first. Zero-count rows are left out, except from a
   * capped list (`count.isLowerBound`): older items may be missing, so it can never read as done.
   */
  tasks: OpsInboxTask[]
  /** Sources without data. While any is missing the inbox cannot claim there is nothing to do. */
  missing: OpsInboxTaskId[]
  /** Every source answered and nothing is waiting. */
  isQuiet: boolean
}

const SEVERITY_RANK: Record<InboxSeverity, number> = { red: 0, amber: 1, slate: 2 }
const TASK_ORDER: Record<OpsInboxTaskId, number> = { centers: 0, feedback: 1, reviews: 2 }

function kpiCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

/**
 * Which numbers an inbox row uses: a loaded list that is not capped is exact and may be fresher
 * (sections hand their changes back), so it wins. Otherwise the KPI count wins when it is at least
 * as fresh as the list (or there is no list); a capped list newer than the KPIs stays a lower bound.
 */
function prefersKpiCount(list: LoadedList<unknown> | null, kpiInbox: KpiInbox | null): kpiInbox is KpiInbox {
  if (!kpiInbox) return false
  if (list && !isCapped(list.items)) return false
  return !list || kpiInbox.loadedAt >= list.loadedAt
}

function kpiOldestDays(oldestCreatedAt: string | null | undefined, now: number): number | null {
  return typeof oldestCreatedAt === 'string' && Number.isFinite(Date.parse(oldestCreatedAt))
    ? getWaitingDays(oldestCreatedAt, now)
    : null
}

export function buildOpsInbox(input: OpsInboxInput): OpsInbox {
  const tasks: OpsInboxTask[] = []
  const missing: OpsInboxTaskId[] = []
  const kpiInbox = input.kpiInbox ?? null

  if (prefersKpiCount(input.centers, kpiInbox)) {
    const centers = kpiInbox.inbox.centers
    const count = kpiCount(centers?.count)
    if (count > 0) {
      const oldestDays = kpiOldestDays(centers?.oldestCreatedAt, kpiInbox.loadedAt)
      tasks.push({
        id: 'centers',
        severity: waitSeverity(oldestDays),
        count: { count, isLowerBound: false },
        oldestDays,
        // Only the list carries the server's domain checks.
        domain: input.centers
          ? summarizePendingCenters(input.centers.items, input.centers.loadedAt).domain
          : { matched: 0, checked: 0 },
        path: OPS_CENTERS_PENDING_PATH,
      })
    }
  } else if (input.centers) {
    const summary = summarizePendingCenters(input.centers.items, input.centers.loadedAt)
    if (summary.pending.count > 0 || summary.pending.isLowerBound) {
      tasks.push({
        id: 'centers',
        severity: waitSeverity(summary.oldestDays),
        count: summary.pending,
        oldestDays: summary.oldestDays,
        domain: summary.domain,
        path: OPS_CENTERS_PENDING_PATH,
      })
    }
  } else {
    missing.push('centers')
  }

  if (prefersKpiCount(input.feedback, kpiInbox)) {
    const feedback = kpiInbox.inbox.feedback
    const count = kpiCount(feedback?.count)
    if (count > 0) {
      const oldestDays = kpiOldestDays(feedback?.oldestCreatedAt, kpiInbox.loadedAt)
      tasks.push({
        id: 'feedback',
        severity: waitSeverity(oldestDays),
        count: { count, isLowerBound: false },
        oldestDays,
        byType: FEEDBACK_TYPE_ORDER
          .map((type) => ({ type, count: kpiCount(feedback?.byType?.[type]) }))
          .filter((entry) => entry.count > 0),
        path: OPS_FEEDBACK_PATH,
      })
    }
  } else if (input.feedback) {
    const summary = summarizeNewFeedback(input.feedback.items, input.feedback.loadedAt)
    if (summary.fresh.count > 0 || summary.fresh.isLowerBound) {
      tasks.push({
        id: 'feedback',
        severity: waitSeverity(summary.oldestDays),
        count: summary.fresh,
        oldestDays: summary.oldestDays,
        byType: summary.byType,
        path: OPS_FEEDBACK_PATH,
      })
    }
  } else {
    missing.push('feedback')
  }

  // The KPI count and governance's count come from the same summary call; the KPIs add the date.
  const kpiReviews = kpiInbox?.inbox.reviews ?? null
  const reviewsPending = kpiReviews ? kpiCount(kpiReviews.count) : input.reviewsPending
  if (typeof reviewsPending === 'number' && Number.isFinite(reviewsPending)) {
    if (reviewsPending > 0) {
      // Candidates are suggestions, not requests someone waits on, so the row stays informational.
      const lastUpdatedAt = kpiReviews?.lastUpdatedAt
      tasks.push({
        id: 'reviews',
        severity: 'slate',
        count: { count: Math.trunc(reviewsPending), isLowerBound: false },
        lastUpdatedAt: typeof lastUpdatedAt === 'string' && Number.isFinite(Date.parse(lastUpdatedAt)) ? lastUpdatedAt : null,
        path: OPS_REVIEWS_PATH,
      })
    }
  } else {
    missing.push('reviews')
  }

  tasks.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || TASK_ORDER[a.id] - TASK_ORDER[b.id])
  return { tasks, missing, isQuiet: tasks.length === 0 && missing.length === 0 }
}

/** Pending center and new feedback counts for the navigation badges. Null while a list is unknown. */
export function buildOpsNavCounts(input: {
  centers: readonly SafetyCenterApprovalItem[] | null
  feedback: readonly FeedbackInboxItem[] | null
}): { centers: CappedCount | null; feedback: CappedCount | null } {
  return {
    centers: input.centers
      ? { count: input.centers.filter((item) => item.status === 'pending').length, isLowerBound: isCapped(input.centers) }
      : null,
    feedback: input.feedback
      ? { count: input.feedback.filter((item) => item.status === 'new').length, isLowerBound: isCapped(input.feedback) }
      : null,
  }
}

/** Which refusal to explain first when the whole home is blocked. MFA before review, review before role. */
const BLOCKING_PRIORITY: readonly OpsAccessIssue[] = ['signed_out', 'mfa_required', 'review_required', 'denied', 'role_required']

/**
 * The refusal that blocks the whole home, or null when at least one source can still be shown.
 * The home is blocked when every source was refused for access reasons and at least one refusal
 * applies to the whole console, or when every source was refused outright (no role, no access).
 * Rate limiting never blocks: the last data stays and each card offers a retry.
 */
export function pickBlockingProblem(problems: ReadonlyArray<OpsAccessProblem | null>): OpsAccessProblem | null {
  if (problems.length === 0) return null
  const refused = problems.filter((problem): problem is OpsAccessProblem => problem !== null)
  if (refused.length !== problems.length) return null
  if (refused.some((problem) => problem.issue === 'rate_limited')) return null
  const blocksConsole = refused.some((problem) => isConsoleWideAccessIssue(problem.issue))
    || refused.every((problem) => problem.issue === 'denied' || problem.issue === 'role_required')
  if (!blocksConsole) return null
  for (const issue of BLOCKING_PRIORITY) {
    const match = refused.find((problem) => problem.issue === issue)
    if (match) return match
  }
  return null
}

export type RateDisplay =
  /** No cases in the period. */
  | { kind: 'empty' }
  /** Few cases and the exact denominator is known: show "3/5" instead of a percent. */
  | { kind: 'ratio'; numerator: number; denominator: number }
  | { kind: 'percent'; percent: number; smallSample: boolean }

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * How to show a server percent. `base` is the number of cases behind it. When `exactBase` is true,
 * `base` is the exact denominator (e.g. completeness over the item count) and a small sample becomes
 * n/N. Otherwise `base` only bounds the denominator (rates over part of the searches), so the
 * percent stays and is flagged as a small sample.
 */
export function describeRate(percent: unknown, base: unknown, exactBase: boolean): RateDisplay {
  if (!isFiniteNumber(base) || base <= 0 || !isFiniteNumber(percent)) return { kind: 'empty' }
  const denominator = Math.trunc(base)
  if (exactBase && denominator < SMALL_SAMPLE_MIN) {
    const numerator = Math.min(denominator, Math.max(0, Math.round((percent * denominator) / 100)))
    return { kind: 'ratio', numerator, denominator }
  }
  return { kind: 'percent', percent, smallSample: denominator < SMALL_SAMPLE_MIN }
}

export function formatRate(display: RateDisplay, digits = 1): string {
  if (display.kind === 'empty') return '—'
  if (display.kind === 'ratio') return `${display.numerator}/${display.denominator}`
  return `${display.percent.toFixed(digits)}%`
}

export function isSmallSample(display: RateDisplay): boolean {
  return display.kind === 'ratio' || (display.kind === 'percent' && display.smallSample)
}
