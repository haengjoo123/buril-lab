// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { SafetyCenterApprovalItem } from '../../services/opsAdminService'
import type { FeedbackInboxItem } from '../../types/feedback'
import {
  OPS_LIST_CAP,
  buildOpsInbox,
  buildOpsNavCounts,
  describeRate,
  formatBadgeCount,
  formatCappedCount,
  formatRate,
  isSmallSample,
  pickBlockingProblem,
  summarizeCenterStatuses,
  summarizeNewFeedback,
  summarizePendingCenters,
  waitSeverity,
  type KpiInbox,
} from './opsHomeTasks'

const NOW = Date.parse('2026-11-06T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString()
}

function center(overrides: Partial<SafetyCenterApprovalItem> = {}): SafetyCenterApprovalItem {
  return {
    id: 'center', institution_name: '버릴대학교', institution_domain: 'buril.ac.kr', center_name: '센터',
    status: 'pending', created_by: 'requester', approved_by: null, approved_at: null,
    verification_document_path: null, verification_document_name: null, verification_document_mime_type: null,
    verification_document_size: null, verification_document_uploaded_at: null,
    created_at: daysAgo(1), updated_at: daysAgo(1),
    ...overrides,
  }
}

function feedback(overrides: Partial<FeedbackInboxItem> = {}): FeedbackInboxItem {
  return {
    id: 'feedback', type: 'bug', message: 'm', contact: null, user_email: null, user_id: null, user_agent: null,
    created_at: daysAgo(1), status: 'new', resolved_at: null, resolved_by: null, lab_id: null, source_screen: null,
    ...overrides,
  }
}

describe('ops home counts', () => {
  it('marks counts from a full server page as lower bounds', () => {
    expect(formatCappedCount({ count: 5, isLowerBound: false })).toBe('5')
    expect(formatCappedCount({ count: 200, isLowerBound: true })).toBe('200+')
    const full = Array.from({ length: OPS_LIST_CAP }, (_, index) => center({ id: `c${index}` }))
    expect(summarizePendingCenters(full, NOW).pending).toEqual({ count: 200, isLowerBound: true })
    expect(summarizePendingCenters(full.slice(1), NOW).pending).toEqual({ count: 199, isLowerBound: false })
  })

  it('caps navigation badges at 99+ and hides zero or unknown counts', () => {
    expect(formatBadgeCount(null)).toBeNull()
    expect(formatBadgeCount({ count: 0, isLowerBound: true })).toBeNull()
    expect(formatBadgeCount({ count: 7, isLowerBound: false })).toBe('7')
    expect(formatBadgeCount({ count: 99, isLowerBound: false })).toBe('99')
    expect(formatBadgeCount({ count: 100, isLowerBound: false })).toBe('99+')
    expect(formatBadgeCount({ count: 200, isLowerBound: true })).toBe('99+')
  })

  it('counts pending centers and new feedback for the badges, null while unknown', () => {
    expect(buildOpsNavCounts({ centers: null, feedback: null })).toEqual({ centers: null, feedback: null })
    expect(buildOpsNavCounts({
      centers: [center(), center({ status: 'approved' }), center({ status: 'rejected' })],
      feedback: [feedback(), feedback({ status: 'in_progress' }), feedback({ status: 'resolved' }), feedback()],
    })).toEqual({
      centers: { count: 1, isLowerBound: false },
      feedback: { count: 2, isLowerBound: false },
    })
  })
})

describe('ops home inbox', () => {
  it('turns a row red only after more than 3 days', () => {
    expect(waitSeverity(null)).toBe('amber')
    expect(waitSeverity(0)).toBe('amber')
    expect(waitSeverity(3)).toBe('amber')
    expect(waitSeverity(4)).toBe('red')
  })

  it('counts waits in Asia/Seoul calendar days', () => {
    // NOW is 21:00 KST on 6 Nov. 23:59 KST on 2 Nov is four calendar days back (3 days 21 hours ago);
    // 00:00 KST on 3 Nov is three.
    const inbox = buildOpsInbox({
      centers: { items: [center({ created_at: '2026-11-02T14:59:00.000Z' })], loadedAt: NOW },
      feedback: { items: [feedback({ created_at: '2026-11-02T15:00:00.000Z' })], loadedAt: NOW },
      reviewsPending: 0,
    })
    expect(inbox.tasks.map((task) => [task.id, task.severity])).toEqual([['centers', 'red'], ['feedback', 'amber']])
  })

  it('keeps exactly 3 days amber and 3 days and a minute still 3 whole days', () => {
    const inbox = buildOpsInbox({
      centers: { items: [center({ created_at: daysAgo(3) })], loadedAt: NOW },
      feedback: { items: [feedback({ created_at: new Date(NOW - 3 * DAY_MS - 60_000).toISOString() })], loadedAt: NOW },
      reviewsPending: 0,
    })
    expect(inbox.tasks.map((task) => [task.id, task.severity])).toEqual([['centers', 'amber'], ['feedback', 'amber']])
  })

  it('reports the oldest pending wait and the domain checks the server made', () => {
    const summary = summarizePendingCenters([
      center({ created_at: daysAgo(4), domain_matches: true }),
      center({ created_at: daysAgo(1), domain_matches: false }),
      center({ created_at: daysAgo(2), domain_matches: null }),
      center({ created_at: daysAgo(30), status: 'approved', domain_matches: true }),
    ], NOW)
    expect(summary.pending.count).toBe(3)
    expect(summary.oldestDays).toBe(4)
    expect(summary.domain).toEqual({ matched: 1, checked: 2 })
  })

  it('breaks new feedback down by type, bug first, and ignores handled items', () => {
    const summary = summarizeNewFeedback([
      feedback({ type: 'general', created_at: daysAgo(2) }),
      feedback({ type: 'bug', created_at: daysAgo(5) }),
      feedback({ type: 'bug' }),
      feedback({ type: 'improvement', status: 'in_progress', created_at: daysAgo(40) }),
    ], NOW)
    expect(summary.fresh.count).toBe(3)
    expect(summary.oldestDays).toBe(5)
    expect(summary.byType).toEqual([{ type: 'bug', count: 2 }, { type: 'general', count: 1 }])
  })

  it('orders rows by severity, links each to its screen, and leaves out zero rows', () => {
    const inbox = buildOpsInbox({
      centers: { items: [center({ created_at: daysAgo(1) })], loadedAt: NOW },
      feedback: { items: [feedback({ created_at: daysAgo(6) })], loadedAt: NOW },
      reviewsPending: 7,
    })
    expect(inbox.tasks.map((task) => [task.id, task.severity, task.path])).toEqual([
      ['feedback', 'red', '/ops/feedback'],
      ['centers', 'amber', '/ops/centers?status=pending'],
      ['reviews', 'slate', '/ops/analytics?tab=reviews'],
    ])
    expect(inbox.isQuiet).toBe(false)

    const partlyEmpty = buildOpsInbox({
      centers: { items: [center({ status: 'approved' })], loadedAt: NOW },
      feedback: { items: [], loadedAt: NOW },
      reviewsPending: 2,
    })
    expect(partlyEmpty.tasks.map((task) => task.id)).toEqual(['reviews'])
  })

  it('is quiet only when every source answered with nothing to do', () => {
    expect(buildOpsInbox({
      centers: { items: [], loadedAt: NOW }, feedback: { items: [], loadedAt: NOW }, reviewsPending: 0,
    })).toEqual({ tasks: [], missing: [], isQuiet: true })

    const missingSummary = buildOpsInbox({
      centers: { items: [], loadedAt: NOW }, feedback: { items: [], loadedAt: NOW }, reviewsPending: null,
    })
    expect(missingSummary.isQuiet).toBe(false)
    expect(missingSummary.missing).toEqual(['reviews'])

    expect(buildOpsInbox({ centers: null, feedback: null, reviewsPending: null }).missing)
      .toEqual(['centers', 'feedback', 'reviews'])
  })

  it('shows a full page of pending requests as 200+', () => {
    const items = Array.from({ length: OPS_LIST_CAP }, (_, index) => center({ id: `c${index}` }))
    const [task] = buildOpsInbox({ centers: { items, loadedAt: NOW }, feedback: { items: [], loadedAt: NOW }, reviewsPending: 0 }).tasks
    expect(formatCappedCount(task.count)).toBe('200+')
  })

  it('never reads a capped list as done: older items may be missing from it', () => {
    const handledCenters = Array.from({ length: OPS_LIST_CAP }, (_, index) => center({ id: `c${index}`, status: 'approved' }))
    const handledFeedback = Array.from({ length: OPS_LIST_CAP }, (_, index) => feedback({ id: `f${index}`, status: 'resolved' }))
    const inbox = buildOpsInbox({
      centers: { items: handledCenters, loadedAt: NOW },
      feedback: { items: handledFeedback, loadedAt: NOW },
      reviewsPending: 0,
    })
    expect(inbox.isQuiet).toBe(false)
    expect(inbox.tasks.map((task) => [task.id, task.severity, formatCappedCount(task.count)])).toEqual([
      ['centers', 'amber', '0+'],
      ['feedback', 'amber', '0+'],
    ])
    // The navigation badge still shows nothing for an unknown zero.
    expect(formatBadgeCount(buildOpsNavCounts({ centers: handledCenters, feedback: null }).centers)).toBeNull()
  })

  it('keeps the oldest visible wait on a capped list and its red severity', () => {
    const items = Array.from({ length: OPS_LIST_CAP }, (_, index) => feedback({
      id: `f${index}`, status: index === 0 ? 'new' : 'resolved', created_at: daysAgo(index === 0 ? 5 : 1),
    }))
    const [task] = buildOpsInbox({ centers: { items: [], loadedAt: NOW }, feedback: { items, loadedAt: NOW }, reviewsPending: 0 }).tasks
    expect(task).toMatchObject({ id: 'feedback', severity: 'red', oldestDays: 5, count: { count: 1, isLowerBound: true } })
  })

  it('summarizes approved centers over every request in the list', () => {
    expect(summarizeCenterStatuses([])).toEqual({
      total: { count: 0, isLowerBound: false }, approved: { count: 0, isLowerBound: false },
    })
    expect(summarizeCenterStatuses([center({ status: 'approved' }), center(), center({ status: 'rejected' })])).toEqual({
      total: { count: 3, isLowerBound: false }, approved: { count: 1, isLowerBound: false },
    })
  })
})

describe('ops home blocking refusal', () => {
  it('blocks the home only when every source was refused', () => {
    expect(pickBlockingProblem([])).toBeNull()
    expect(pickBlockingProblem([{ issue: 'mfa_required' }, null, { issue: 'mfa_required' }])).toBeNull()
    expect(pickBlockingProblem([{ issue: 'mfa_required' }, { issue: 'mfa_required' }, { issue: 'mfa_required' }]))
      .toEqual({ issue: 'mfa_required' })
  })

  it('explains sign-in before MFA and MFA before the role', () => {
    expect(pickBlockingProblem([{ issue: 'role_required' }, { issue: 'mfa_required' }, { issue: 'signed_out' }]))
      .toEqual({ issue: 'signed_out' })
    expect(pickBlockingProblem([{ issue: 'role_required' }, { issue: 'review_required' }, { issue: 'mfa_required' }]))
      .toEqual({ issue: 'mfa_required' })
    expect(pickBlockingProblem([{ issue: 'role_required' }, { issue: 'role_required' }, { issue: 'denied' }]))
      .toEqual({ issue: 'denied' })
  })

  it('never blocks for rate limiting', () => {
    expect(pickBlockingProblem([{ issue: 'rate_limited' }, { issue: 'mfa_required' }, { issue: 'mfa_required' }])).toBeNull()
    expect(pickBlockingProblem([
      { issue: 'rate_limited', retryAfterSeconds: 5 }, { issue: 'rate_limited' }, { issue: 'rate_limited' },
    ])).toBeNull()
  })
})

describe('ops home rates', () => {
  it('shows nothing when the period has no cases or the value is missing', () => {
    expect(formatRate(describeRate(0, 0, false))).toBe('—')
    expect(formatRate(describeRate(undefined, 20, false))).toBe('—')
    expect(formatRate(describeRate(12, undefined, true))).toBe('—')
  })

  it('shows n/N under 10 cases when the denominator is exact', () => {
    const display = describeRate(60, 5, true)
    expect(display).toEqual({ kind: 'ratio', numerator: 3, denominator: 5 })
    expect(formatRate(display)).toBe('3/5')
    expect(isSmallSample(display)).toBe(true)
    expect(formatRate(describeRate(100, 9, true))).toBe('9/9')
    expect(formatRate(describeRate(150, 4, true))).toBe('4/4')
  })

  it('switches to a percent at exactly 10 cases', () => {
    const display = describeRate(30, 10, true)
    expect(formatRate(display)).toBe('30.0%')
    expect(isSmallSample(display)).toBe(false)
  })

  it('keeps the percent but flags a small sample when only an upper bound is known', () => {
    const display = describeRate(33.33, 3, false)
    expect(formatRate(display)).toBe('33.3%')
    expect(isSmallSample(display)).toBe(true)
    expect(isSmallSample(describeRate(33.33, 12, false))).toBe(false)
    expect(formatRate(describeRate(0.42, 120, false), 2)).toBe('0.42%')
  })
})

describe('ops home inbox with exact counts from the KPIs', () => {
  function kpiInbox(overrides: Partial<KpiInbox['inbox']> = {}, loadedAt = NOW): KpiInbox {
    return {
      loadedAt,
      inbox: {
        centers: { count: 5, oldestCreatedAt: daysAgo(2) },
        feedback: { count: 4, byType: { bug: 1, improvement: 0, general: 3 }, oldestCreatedAt: daysAgo(6) },
        reviews: { count: 3, oldestCreatedAt: daysAgo(9), lastUpdatedAt: daysAgo(1) },
        ...overrides,
      },
    }
  }

  it('keeps an uncapped list, which is exact and may be fresher', () => {
    const inbox = buildOpsInbox({
      centers: { items: [center(), center({ id: 'c2' })], loadedAt: NOW },
      feedback: { items: [], loadedAt: NOW },
      reviewsPending: 0,
      kpiInbox: kpiInbox(),
    })
    const centers = inbox.tasks.find((task) => task.id === 'centers')
    expect(centers?.count).toEqual({ count: 2, isLowerBound: false })
    // An empty uncapped feedback list wins over the KPI's 4: a section may just have resolved them.
    expect(inbox.tasks.some((task) => task.id === 'feedback')).toBe(false)
  })

  it('replaces a capped list with the newer exact count and its oldest wait', () => {
    const items = Array.from({ length: OPS_LIST_CAP }, (_, index) => center({ id: `c${index}` }))
    const [task] = buildOpsInbox({
      centers: { items, loadedAt: NOW - 1_000 },
      feedback: { items: [], loadedAt: NOW },
      reviewsPending: 0,
      kpiInbox: kpiInbox({ centers: { count: 250, oldestCreatedAt: daysAgo(12) } }),
    }).tasks
    expect(task).toMatchObject({ id: 'centers', severity: 'red', oldestDays: 12, count: { count: 250, isLowerBound: false } })
    expect(formatCappedCount(task.count)).toBe('250')
    // The domain checks still come from the list.
    expect(task.id === 'centers' && task.domain).toEqual({ matched: 0, checked: 0 })
  })

  it('keeps a capped list that is newer than the KPIs as a lower bound', () => {
    const items = Array.from({ length: OPS_LIST_CAP }, (_, index) => center({ id: `c${index}` }))
    const [task] = buildOpsInbox({
      centers: { items, loadedAt: NOW + 1_000 },
      feedback: { items: [], loadedAt: NOW },
      reviewsPending: 0,
      kpiInbox: kpiInbox({ centers: { count: 250, oldestCreatedAt: daysAgo(12) } }),
    }).tasks
    expect(formatCappedCount(task.count)).toBe('200+')
  })

  it('fills a list that has not loaded yet, so the row is no longer missing', () => {
    const inbox = buildOpsInbox({ centers: null, feedback: null, reviewsPending: null, kpiInbox: kpiInbox() })
    expect(inbox.missing).toEqual([])
    expect(inbox.tasks.map((task) => [task.id, formatCappedCount(task.count)])).toEqual([
      ['feedback', '4'], ['centers', '5'], ['reviews', '3'],
    ])
    expect(inbox.tasks.find((task) => task.id === 'feedback')).toMatchObject({
      severity: 'red', oldestDays: 6, byType: [{ type: 'bug', count: 1 }, { type: 'general', count: 3 }],
    })
    expect(inbox.tasks.find((task) => task.id === 'centers')).toMatchObject({ severity: 'amber', oldestDays: 2 })

    const quiet = buildOpsInbox({
      centers: null, feedback: null, reviewsPending: null,
      kpiInbox: kpiInbox({
        centers: { count: 0, oldestCreatedAt: null },
        feedback: { count: 0, byType: { bug: 0, improvement: 0, general: 0 }, oldestCreatedAt: null },
        reviews: { count: 0, oldestCreatedAt: null, lastUpdatedAt: null },
      }),
    })
    expect(quiet).toEqual({ tasks: [], missing: [], isQuiet: true })
  })

  it('takes the review count and its last update from the KPIs, and governance without them', () => {
    const withKpis = buildOpsInbox({
      centers: { items: [], loadedAt: NOW }, feedback: { items: [], loadedAt: NOW }, reviewsPending: 9, kpiInbox: kpiInbox(),
    })
    expect(withKpis.tasks).toEqual([expect.objectContaining({
      id: 'reviews', severity: 'slate', count: { count: 3, isLowerBound: false }, lastUpdatedAt: daysAgo(1),
    })])

    const withoutKpis = buildOpsInbox({
      centers: { items: [], loadedAt: NOW }, feedback: { items: [], loadedAt: NOW }, reviewsPending: 9, kpiInbox: null,
    })
    expect(withoutKpis.tasks).toEqual([expect.objectContaining({
      id: 'reviews', count: { count: 9, isLowerBound: false }, lastUpdatedAt: null,
    })])
  })
})
