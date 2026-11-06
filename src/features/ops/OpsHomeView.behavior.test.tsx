// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SafetyCenterApprovalItem } from '../../services/opsAdminService'
import type { AnalyticsKpis } from '../../services/opsAnalyticsService'
import type { FeedbackInboxItem } from '../../types/feedback'

// A stable translation object, like react-i18next's, so effects keyed on `t` run once.
const translation = vi.hoisted(() => ({
  t: (key: string, options?: unknown) => (
    options && typeof options === 'object' ? `${key}:${JSON.stringify(options)}` : key
  ),
  i18n: { language: 'ko', changeLanguage: () => undefined },
}))

const services = vi.hoisted(() => ({
  listSafetyCenterApprovals: vi.fn(),
  updateSafetyCenterApprovalStatus: vi.fn(),
  getSafetyCenterVerificationDocumentUrl: vi.fn(),
  listFeedbackInbox: vi.fn(),
  updateFeedbackStatus: vi.fn(),
  loadAnalyticsSummary: vi.fn(),
}))

vi.mock('react-i18next', () => ({ useTranslation: () => translation }))
vi.mock('../../locales/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('../../services/supabaseClient', () => ({ supabase: {} }))
vi.mock('../../components/MfaSettingsPanel', () => ({
  MfaSettingsPanel: () => <div>mfa-settings-marker</div>,
}))
vi.mock('../../services/opsAdminService', () => ({
  listSafetyCenterApprovals: services.listSafetyCenterApprovals,
  updateSafetyCenterApprovalStatus: services.updateSafetyCenterApprovalStatus,
  getSafetyCenterVerificationDocumentUrl: services.getSafetyCenterVerificationDocumentUrl,
}))
vi.mock('../../services/feedbackAdminService', () => ({
  listFeedbackInbox: services.listFeedbackInbox,
  updateFeedbackStatus: services.updateFeedbackStatus,
}))
// The analytics screen loads its own summary; a stub keeps the call counts about the console.
vi.mock('./OpsAnalyticsView', () => ({ OpsAnalyticsView: () => <div>analytics-screen</div> }))
vi.mock('../../services/opsAnalyticsService', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/opsAnalyticsService')>(),
  loadAnalyticsSummary: services.loadAnalyticsSummary,
  loadAnalyticsSearches: vi.fn(),
  loadAnalyticsMixtures: vi.fn(),
  loadAnalyticsReviews: vi.fn(),
}))

import { InternalApiError } from '../../services/internalApi'
import { OpsConsoleView } from './OpsConsoleView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DAY_MS = 24 * 60 * 60 * 1000
const T0 = Date.parse('2026-11-06T01:30:00.000Z')

function daysAgo(days: number): string {
  return new Date(T0 - days * DAY_MS).toISOString()
}

function center(overrides: Partial<SafetyCenterApprovalItem>): SafetyCenterApprovalItem {
  return {
    id: 'center', institution_name: '버릴대학교', institution_domain: 'buril.ac.kr', center_name: '센터',
    status: 'pending', created_by: 'requester', approved_by: null, approved_at: null,
    verification_document_path: 'docs/proof.pdf', verification_document_name: 'proof.pdf',
    verification_document_mime_type: 'application/pdf', verification_document_size: 2048,
    verification_document_uploaded_at: daysAgo(1), created_at: daysAgo(1), updated_at: daysAgo(1),
    requester_email_domain: null, domain_matches: null,
    ...overrides,
  }
}

function feedback(overrides: Partial<FeedbackInboxItem>): FeedbackInboxItem {
  return {
    id: 'feedback', type: 'bug', message: 'm', contact: null, user_email: null, user_id: null, user_agent: null,
    created_at: daysAgo(1), status: 'new', resolved_at: null, resolved_by: null, lab_id: null, source_screen: null,
    ...overrides,
  }
}

/** The pgTAP fixture's output for p_days = 7 (spec section 4), relative to T0. */
function kpisFixture(): AnalyticsKpis {
  const weeklyLabs = [0, 0, 0, 0, 1, 1, 1, 4]
  return {
    schemaVersion: 1,
    generatedAt: daysAgo(0),
    period: { days: 7, timeZone: 'Asia/Seoul', currentStart: daysAgo(7), currentEnd: daysAgo(0), previousStart: daysAgo(14) },
    exclusions: { internalLabs: 1, internalUsers: 1 },
    inbox: {
      centers: { count: 1, oldestCreatedAt: daysAgo(5) },
      feedback: { count: 2, byType: { bug: 1, improvement: 1, general: 0 }, oldestCreatedAt: daysAgo(4) },
      reviews: { count: 2, oldestCreatedAt: daysAgo(6), lastUpdatedAt: daysAgo(1) },
    },
    product: {
      wsal: {
        current: 4, previous: 1, totalLabs: 4,
        weekly: weeklyLabs.map((labs, index) => ({ start: daysAgo(7 * (8 - index)), end: daysAgo(7 * (7 - index)), labs })),
      },
      activeUsers: {
        wau: { current: 6, previous: 1 }, mau: { current: 6, previous: 0 },
        stickiness: { current: { numerator: 6, denominator: 6 }, previous: { numerator: 1, denominator: 2 } },
      },
      activation14d: {
        current: { cohortLabs: 2, secondMember: 1, firstItem: 1, firstWasteRecord: 1, fullyActivated: 1 },
        previous: { cohortLabs: 0, secondMember: 0, firstItem: 0, firstWasteRecord: 0, fullyActivated: 0 },
      },
      retentionW4: { current: { numerator: 1, denominator: 1 }, previous: { numerator: 0, denominator: 0 } },
      onboarding: {
        web: {
          current: { shown: 1, stepCompleted: 1, allStepsCompleted: 0, firstValueReached: 1, skipped: 0 },
          previous: { shown: 1, stepCompleted: 1, allStepsCompleted: 1, firstValueReached: 0, skipped: 0 },
        },
        native: {
          current: { shown: 1, stepCompleted: 0, allStepsCompleted: 0, firstValueReached: 0, skipped: 1 },
          previous: { shown: 0, stepCompleted: 0, allStepsCompleted: 0, firstValueReached: 0, skipped: 0 },
        },
      },
    },
    safety: {
      needsReview: {
        current: { numerator: 2, denominator: 4, needsInput: 1, blocked: 1 },
        previous: { numerator: 0, denominator: 1, needsInput: 0, blocked: 0 },
        topMissingFields: [{ field: 'hazard_data', records: 1 }, { field: 'measured_ph', records: 1 }, { field: 'mixing_state', records: 1 }],
      },
      corrections: {
        current: { numerator: 3, denominator: 7 }, previous: { numerator: 0, denominator: 1 },
        byReason: { amount: 1, duplicate: 1, category: 0, other: 1 },
      },
      dangerIgnored: {
        current: { events: 5, labs: 2 }, previous: { events: 1, labs: 1 },
        topRules: [{ ruleId: 'store_flam_oxid', events: 2 }, { ruleId: 'store_acid_cyanide', events: 1 }],
      },
      centerRequests: {
        open: 3, overdue: 1, overdueLabs: 1, dueSoon: 1,
        firstResponse: { current: { requests: 3, responded: 2, medianHours: 7 }, previous: { requests: 1, responded: 1, medianHours: 6 } },
      },
      ghsCheckGaps: {
        current: { numerator: 2, denominator: 5, lookupFailed: 1, notChecked: 1 },
        previous: { numerator: 0, denominator: 1, lookupFailed: 0, notChecked: 0 },
      },
    },
    b2b: {
      centerPipeline: {
        applications: { current: 1, previous: 1 }, pending: 1, approved: 2, rejected: 1,
        approvalDays: { centers: 2, median: 2 }, activeCenters: { current: 1, previous: 1 },
        linkedLabs: 1, linkRequestsPending: 1, requests: { current: 3, previous: 1 }, exports: { current: 1, previous: 0 },
      },
      institutions: {
        labsTotal: 4, labsWithInstitution: 4, institutions: 2, institutionsWithApprovedCenter: 1, coveredLabs: 2,
        salesCandidates: { count: 1, top: [{ institution: 'hanbit univ', activeLabs: 2, hasPendingCenter: true }] },
      },
      labProReadiness: {
        current: { habitualLabs: 1, readyLabs: 1, seats: { upTo2: 0, from3To5: 1, from6To10: 0, over10: 0 } },
        previous: { habitualLabs: 0, readyLabs: 0, seats: { upTo2: 0, from3To5: 0, from6To10: 0, over10: 0 } },
      },
      purchaseIntent: {
        current: { events: 6, labs: 4, users: 6, withCas: 3 }, previous: { events: 1, labs: 1, users: 1, withCas: 0 },
        topBrands: [{ brand: 'sigma', events: 5, labs: 3, users: 5 }], hiddenBrands: 1,
      },
    },
  }
}

function summaryPayload(overrides: { submittedSearches?: number; reviewsPending?: number } = {}) {
  return {
    summary: {
      periodDays: 7, submittedSearches: overrides.submittedSearches ?? 42, uniqueUsers: 9, noResultRate: 12.5,
      technicalErrorRate: 0, ingestionRecoveryCount: 0, analyticsIngestionFailureRate: 0.3,
      batchConversionRate: 40, finalizedBatches: 6, mixedBatches: 2,
      dataCompleteness: { itemCount: 5, casPercent: 60, concentrationPercent: 100, volumePercent: 80 },
      dailyTrend: [{ date: '2026-11-04', searches: 10, noResults: 1 }, { date: '2026-11-05', searches: 32, noResults: 4 }],
    },
    governance: {
      collection: { authenticatedEvents: 0, guestEvents: 0, guestSubjects: 0, guestEventsExpiringIn7Days: 0, oldestGuestEventAt: null },
      deletions: { requestCount: 0, deletedEvents: 0, deletedActions: 0 },
      exports: { count: 0, lastExportAt: null, allAudited: true },
      monthlyRollups: { searchCells: 0, mixtureCells: 0, externalSearchCells: 0, externalMixtureCells: 0 },
      commercialization: {
        externalProductEnabled: false, institutionDataAgreementReady: false,
        reidentificationRiskReviewReady: false, legalReviewReady: false,
        searchThreshold: { events: 30, users: 5, labs: 3 }, mixtureThreshold: { batches: 10, users: 5, labs: 3 },
        monthlyOnly: true, retroactiveInclusion: false,
      },
      reviews: { pending: overrides.reviewsPending ?? 4, approved: 0, rejected: 0 },
    },
  }
}

let container: HTMLDivElement
let root: Root
let now = T0
const probe = { path: '' }

function LocationProbe() {
  const location = useLocation()
  useEffect(() => { probe.path = `${location.pathname}${location.search}` }, [location])
  return null
}

async function flush() {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => { await Promise.resolve() })
  }
}

async function render(path = '/ops') {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <OpsConsoleView onExitToApp={() => undefined} />
        <LocationProbe />
      </MemoryRouter>,
    )
  })
  await flush()
}

function buttons(predicate: (button: HTMLButtonElement) => boolean): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter(predicate)
}

function buttonWithText(text: string, scope: ParentNode = container): HTMLButtonElement {
  const match = [...scope.querySelectorAll('button')].find((element) => element.textContent?.includes(text))
  if (!match) throw new Error(`No button with ${text}`)
  return match
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
  await flush()
}

function inbox(): HTMLElement {
  const section = container.querySelector('section[aria-labelledby="ops-home-inbox-title"]')
  if (!(section instanceof HTMLElement)) throw new Error('No inbox')
  return section
}

/** Opens a section from the sidebar (the first of the two navigation bars). */
async function openSection(labelKey: string) {
  const [navButton] = buttons((button) => button.textContent?.includes(labelKey) === true && button.closest('nav') !== null)
  await click(navButton)
}

function callCounts() {
  return {
    centers: services.listSafetyCenterApprovals.mock.calls.length,
    feedback: services.listFeedbackInbox.mock.calls.length,
    summary: services.loadAnalyticsSummary.mock.calls.length,
  }
}

describe('operator console home', () => {
  beforeEach(() => {
    now = T0
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    services.listSafetyCenterApprovals.mockResolvedValue([
      center({ id: 'old', created_at: daysAgo(5), requester_email_domain: 'buril.ac.kr', domain_matches: true }),
      center({ id: 'new', created_at: daysAgo(1), requester_email_domain: 'gmail.com', domain_matches: false }),
      center({ id: 'done', status: 'approved', created_at: daysAgo(20) }),
    ])
    services.listFeedbackInbox.mockResolvedValue([
      feedback({ id: 'f1', type: 'bug', created_at: daysAgo(2) }),
      feedback({ id: 'f2', type: 'bug', created_at: daysAgo(1) }),
      feedback({ id: 'f3', type: 'improvement', created_at: daysAgo(0) }),
      feedback({ id: 'f4', status: 'resolved', created_at: daysAgo(30) }),
    ])
    services.loadAnalyticsSummary.mockResolvedValue(summaryPayload())
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('loads the three sources once and lists what is waiting', async () => {
    await render()

    expect(callCounts()).toEqual({ centers: 1, feedback: 1, summary: 1 })
    expect(services.loadAnalyticsSummary).toHaveBeenCalledWith(7, { includeKpis: true })

    const text = inbox().textContent ?? ''
    expect(text).toContain('ops_home_task_centers:{"value":"2"}')
    expect(text).toContain('ops_home_oldest_days:{"count":5}')
    expect(text).toContain('ops_home_domain_match:{"matched":1,"checked":2}')
    expect(text).toContain('ops_home_task_feedback:{"value":"3"}')
    expect(text).toContain('ops_home_feedback_type_bug:{"value":2} · ops_home_feedback_type_improvement:{"value":1}')
    expect(text).toContain('ops_home_task_reviews:{"value":"4"}')
    // The oldest center request waited more than 3 days, so it is listed first as urgent.
    expect(inbox().querySelector('li')?.textContent).toContain('admin_inbox_severity_red')
    expect(inbox().querySelector('li')?.textContent).toContain('ops_home_task_centers')
    expect(container.textContent).toContain('ops_home_group_product')
    expect(container.textContent).toContain('ops_an_updated_at')
  })

  it('shows small samples as n/N or flags them', async () => {
    services.loadAnalyticsSummary.mockResolvedValue(summaryPayload({ submittedSearches: 4 }))
    await render()

    // Five batch components: completeness is shown as counts, not percents.
    expect(container.textContent).toContain('ops_an_completeness:{"cas":"3/5","concentration":"5/5","volume":"4/5"}')
    // Four searches: the rate stays but is marked as a small sample with its basis.
    expect(container.textContent).toContain('ops_home_small_sample_short')
    expect(container.textContent).toContain('ops_home_basis_searches:{"value":"4"}')
  })

  it('puts the pending counts on the navigation with the count in the accessible name', async () => {
    await render()

    const centerItems = buttons((button) => button.getAttribute('aria-label') === 'ops_console_nav_centers, ops_console_nav_badge_centers:{"value":"2"}')
    const feedbackItems = buttons((button) => button.getAttribute('aria-label') === 'ops_console_nav_feedback, ops_console_nav_badge_feedback:{"value":"3"}')
    // Sidebar and mobile tabs.
    expect(centerItems).toHaveLength(2)
    expect(feedbackItems).toHaveLength(2)
    expect(centerItems[0].querySelector('[aria-hidden="true"]:last-child')?.textContent).toBe('2')
  })

  it('opens the pending centers from the inbox row', async () => {
    await render()

    await click(buttonWithText('ops_home_open_centers', inbox()))

    expect(probe.path).toBe('/ops/centers?status=pending')
    expect(container.textContent).toContain('ops_centers_heading')
  })

  it('shows one calm line and no badges when nothing is waiting', async () => {
    services.listSafetyCenterApprovals.mockResolvedValue([center({ status: 'approved' })])
    services.listFeedbackInbox.mockResolvedValue([feedback({ status: 'resolved' })])
    services.loadAnalyticsSummary.mockResolvedValue(summaryPayload({ reviewsPending: 0 }))
    await render()

    const text = inbox().textContent ?? ''
    expect(text).toContain('admin_inbox_quiet')
    expect(text).toContain('admin_inbox_last_checked')
    expect(inbox().querySelectorAll('li')).toHaveLength(0)
    expect(buttons((button) => (button.getAttribute('aria-label') ?? '').includes('badge'))).toHaveLength(0)
  })

  it('keeps the other cards when one source fails and retries only that call', async () => {
    services.loadAnalyticsSummary.mockRejectedValue(new Error('boom'))
    await render()

    const text = inbox().textContent ?? ''
    expect(text).toContain('ops_home_task_centers')
    expect(text).toContain('ops_an_tab_reviews')
    expect(text).toContain('ops_home_source_failed')
    expect(text).not.toContain('admin_inbox_quiet')
    expect(container.textContent).toContain('ops_an_load_failed')
    // The B2B card reads the center list, so it still shows.
    expect(container.textContent).toContain('ops_home_kpi_centers_approved')

    services.loadAnalyticsSummary.mockResolvedValue(summaryPayload())
    await click(buttonWithText('ops_access_retry', inbox()))

    expect(callCounts()).toEqual({ centers: 1, feedback: 1, summary: 2 })
    expect(container.textContent).not.toContain('ops_an_load_failed')
    expect(inbox().textContent).toContain('ops_home_task_reviews')
  })

  it('names the missing role inside the card that was refused', async () => {
    services.listFeedbackInbox.mockRejectedValue(new InternalApiError('role', 403, 'OPERATOR_ROLE_REQUIRED'))
    await render()

    expect(inbox().textContent).toContain('ops_console_nav_feedback')
    expect(inbox().textContent).toContain('ops_access_role_title')
    expect(inbox().textContent).toContain('ops_home_task_centers')
    expect(container.textContent).not.toContain('mfa-settings-marker')
  })

  it('shows the MFA step-up once when only the summary needs it', async () => {
    services.loadAnalyticsSummary.mockRejectedValue(new InternalApiError('mfa', 403, 'MFA_REQUIRED'))
    await render()

    // The inbox and the B2B card still show; the two summary cards share one MFA panel.
    expect(inbox().textContent).toContain('ops_home_task_centers')
    expect(container.textContent).toContain('ops_home_kpi_centers_approved')
    expect(container.textContent?.match(/mfa-settings-marker/g)).toHaveLength(1)
  })

  it('shows the MFA step-up instead of the home when every source needs MFA', async () => {
    const mfa = new InternalApiError('mfa', 403, 'MFA_REQUIRED')
    services.listSafetyCenterApprovals.mockRejectedValue(mfa)
    services.listFeedbackInbox.mockRejectedValue(mfa)
    services.loadAnalyticsSummary.mockRejectedValue(mfa)
    await render()

    expect(container.textContent).toContain('ops_access_mfa_title')
    expect(container.textContent?.match(/mfa-settings-marker/g)).toHaveLength(1)
    expect(container.querySelector('section[aria-labelledby="ops-home-inbox-title"]')).toBeNull()

    services.listSafetyCenterApprovals.mockResolvedValue([])
    services.listFeedbackInbox.mockResolvedValue([])
    services.loadAnalyticsSummary.mockResolvedValue(summaryPayload({ reviewsPending: 0 }))
    await click(buttonWithText('ops_access_retry'))

    expect(callCounts()).toEqual({ centers: 2, feedback: 2, summary: 2 })
    expect(inbox().textContent).toContain('admin_inbox_quiet')
  })

  it('reloads only the summary when the period changes', async () => {
    await render()

    await click(buttonWithText('ops_an_days:{"count":30}'))

    expect(callCounts()).toEqual({ centers: 1, feedback: 1, summary: 2 })
    expect(services.loadAnalyticsSummary).toHaveBeenLastCalledWith(30, { includeKpis: true })
    expect(buttonWithText('ops_an_days:{"count":30}').getAttribute('aria-pressed')).toBe('true')
    expect(container.textContent).toContain('ops_home_period_recent:{"days":30}')
  })

  it('reloads everything from the refresh button', async () => {
    await render()

    await click(buttonWithText('ops_an_refresh'))

    expect(callCounts()).toEqual({ centers: 2, feedback: 2, summary: 2 })
  })

  it('reloads on return to the home only when the data is older than a minute', async () => {
    await render()
    expect(callCounts()).toEqual({ centers: 1, feedback: 1, summary: 1 })

    // The analytics screen does not reload the badge counts; the home does not reload fresh data.
    await openSection('ops_console_nav_analytics')
    await openSection('ops_console_nav_overview')
    expect(callCounts()).toEqual({ centers: 1, feedback: 1, summary: 1 })

    now = T0 + 61_000
    await openSection('ops_console_nav_analytics')
    expect(callCounts()).toEqual({ centers: 1, feedback: 1, summary: 1 })
    await openSection('ops_console_nav_overview')
    expect(callCounts()).toEqual({ centers: 2, feedback: 2, summary: 2 })
  })

  it('keeps the badges and the home in step with the centers and feedback screens, with no extra call', async () => {
    await render()

    // The centers screen loads its own list once.
    await openSection('ops_console_nav_centers')
    expect(callCounts()).toEqual({ centers: 2, feedback: 1, summary: 1 })

    // Both pending requests are approved there: the badge clears while the operator stays.
    services.updateSafetyCenterApprovalStatus.mockImplementation((id: string) => Promise.resolve(center({ id, status: 'approved' })))
    await click(buttonWithText('ops_centers_action_approve', container.querySelector('article') as HTMLElement))
    expect(buttons((button) => button.getAttribute('aria-label') === 'ops_console_nav_centers, ops_console_nav_badge_centers:{"value":"1"}')).toHaveLength(2)
    await click(buttonWithText('ops_centers_action_approve', container.querySelector('article') as HTMLElement))
    expect(buttons((button) => (button.getAttribute('aria-label') ?? '').includes('ops_console_nav_badge_centers'))).toHaveLength(0)

    // Back on the home within a minute: the list the screen handed over is used as it is.
    await openSection('ops_console_nav_overview')
    expect(callCounts()).toEqual({ centers: 2, feedback: 1, summary: 1 })
    expect(inbox().textContent).not.toContain('ops_home_task_centers')

    services.updateFeedbackStatus.mockImplementation((id: string, status: FeedbackInboxItem['status']) => (
      Promise.resolve(feedback({ id, status }))
    ))
    await openSection('ops_console_nav_feedback')
    expect(callCounts().feedback).toBe(2)
    for (let index = 0; index < 3; index += 1) {
      await click(buttonWithText('ops_feedback_action_resolve', container.querySelector('article') as HTMLElement))
    }
    expect(buttons((button) => (button.getAttribute('aria-label') ?? '').includes('ops_console_nav_badge_feedback'))).toHaveLength(0)
    await openSection('ops_console_nav_analytics')
    expect(callCounts()).toEqual({ centers: 2, feedback: 2, summary: 1 })
  })

  it('passes on an approval that finishes after the operator left the screen', async () => {
    await render('/ops/centers')
    let resolveApproval: (item: SafetyCenterApprovalItem) => void = () => undefined
    services.updateSafetyCenterApprovalStatus.mockImplementationOnce(() => new Promise((resolve) => { resolveApproval = resolve }))

    await click(buttonWithText('ops_centers_action_approve', container.querySelector('article') as HTMLElement))
    await openSection('ops_console_nav_analytics')
    await act(async () => { resolveApproval(center({ id: 'old', status: 'approved' })) })
    await flush()

    expect(buttons((button) => button.getAttribute('aria-label') === 'ops_console_nav_centers, ops_console_nav_badge_centers:{"value":"1"}')).toHaveLength(2)
  })

  it('never lets an older console reload overwrite the list a screen handed over', async () => {
    await render()
    let resolveStale: (items: SafetyCenterApprovalItem[]) => void = () => undefined
    services.listSafetyCenterApprovals
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve }))
      .mockResolvedValueOnce([center({ id: 'old', status: 'approved' }), center({ id: 'new', status: 'approved' })])

    // The home refresh is still on its way when the centers screen loads a newer list.
    await click(buttonWithText('ops_an_refresh'))
    await openSection('ops_console_nav_centers')
    expect(buttons((button) => (button.getAttribute('aria-label') ?? '').includes('ops_console_nav_badge_centers'))).toHaveLength(0)

    await act(async () => { resolveStale([center({ id: 'old' }), center({ id: 'new' })]) })
    await flush()
    expect(buttons((button) => (button.getAttribute('aria-label') ?? '').includes('ops_console_nav_badge_centers'))).toHaveLength(0)
  })

  it('reloads the review count after the review tab, and only then', async () => {
    await render()
    expect(inbox().textContent).toContain('ops_home_task_reviews:{"value":"4"}')

    services.loadAnalyticsSummary.mockResolvedValue(summaryPayload({ reviewsPending: 0 }))
    await click(buttonWithText('ops_home_open_reviews', inbox()))
    expect(probe.path).toBe('/ops/analytics?tab=reviews')
    await openSection('ops_console_nav_overview')

    expect(callCounts()).toEqual({ centers: 1, feedback: 1, summary: 2 })
    expect(inbox().textContent).not.toContain('ops_home_task_reviews')

    // A visit that never opens the review tab keeps the fresh summary.
    await openSection('ops_console_nav_analytics')
    await openSection('ops_console_nav_overview')
    expect(callCounts().summary).toBe(2)
  })

  it('lets the screen the console opens on load its own list for the badge', async () => {
    await render('/ops/centers')

    // The centers screen's own call feeds the badge; the console loads only the feedback count.
    expect(callCounts()).toEqual({ centers: 1, feedback: 1, summary: 0 })
    expect(buttons((button) => button.getAttribute('aria-label') === 'ops_console_nav_centers, ops_console_nav_badge_centers:{"value":"2"}')).toHaveLength(2)
    expect(buttons((button) => (button.getAttribute('aria-label') ?? '').includes('ops_console_nav_badge_feedback'))).toHaveLength(2)

    // Back on the home within a minute, that list is still fresh; the summary loads for the first time.
    await openSection('ops_console_nav_overview')
    expect(callCounts()).toEqual({ centers: 1, feedback: 1, summary: 1 })
    expect(inbox().textContent).toContain('ops_home_task_centers:{"value":"2"}')
  })

  it('shows the MFA step-up once when the summary and the center list both need it', async () => {
    const mfa = new InternalApiError('mfa', 403, 'MFA_REQUIRED')
    services.listSafetyCenterApprovals.mockRejectedValue(mfa)
    services.loadAnalyticsSummary.mockRejectedValue(mfa)
    await render()

    // The feedback list loaded, so the home stays; the product card explains MFA, the B2B card only names it.
    expect(inbox().textContent).toContain('ops_home_task_feedback')
    expect(container.textContent?.match(/mfa-settings-marker/g)).toHaveLength(1)
  })

  it('never calls a capped list done and reads its oldest wait as a minimum', async () => {
    services.listSafetyCenterApprovals.mockResolvedValue(
      Array.from({ length: 200 }, (_, index) => center({ id: `c${index}`, status: 'approved' })),
    )
    services.listFeedbackInbox.mockResolvedValue(Array.from({ length: 200 }, (_, index) => feedback({
      id: `f${index}`, status: index === 0 ? 'new' : 'resolved', created_at: daysAgo(index === 0 ? 2 : 1),
    })))
    services.loadAnalyticsSummary.mockResolvedValue(summaryPayload({ reviewsPending: 0 }))
    await render()

    const text = inbox().textContent ?? ''
    expect(text).not.toContain('admin_inbox_quiet')
    expect(text).toContain('ops_home_task_centers_unchecked')
    expect(text).toContain('ops_home_capped_note:{"value":200}')
    expect(text).toContain('ops_home_task_feedback:{"value":"1+"}')
    expect(text).toContain('ops_home_oldest_days_at_least:{"count":2}')
    expect(text).not.toContain('ops_home_oldest_days:')
    // The B2B card does not claim that nothing is waiting either.
    expect(container.textContent).not.toContain('ops_home_none_waiting')
  })

  describe('with the KPI function deployed', () => {
    function group(id: string): HTMLElement {
      const section = container.querySelector(`section[aria-labelledby="${id}"]`)
      if (!(section instanceof HTMLElement)) throw new Error(`No group ${id}`)
      return section
    }

    function tile(label: string): HTMLElement {
      const match = [...container.querySelectorAll('p')].find((element) => element.textContent === label)
      const card = match?.closest('div.rounded-xl')
      if (!(card instanceof HTMLElement)) throw new Error(`No tile ${label}`)
      return card
    }

    it('shows the north star with its 8-week line and the goal-group KPIs', async () => {
      services.loadAnalyticsSummary.mockResolvedValue({ ...summaryPayload(), kpis: kpisFixture() })
      await render()

      const northStar = group('ops-home-north-star-title')
      expect(northStar.textContent).toContain('ops_kpi_north_star_title')
      expect(northStar.textContent).toContain('ops_home_unit_places:{"value":"4"}')
      // One lab the week before is too few for an arrow: only "직전 1곳" is shown.
      expect(northStar.textContent).toContain('ops_kpi_north_star_caption_plain:{"previous":"1","total":"4"}')
      expect(northStar.textContent).not.toContain('ops_kpi_delta_up')
      const trend = northStar.querySelector('[role="img"]')
      expect(trend?.getAttribute('aria-label')).toBe('ops_kpi_north_star_trend:{"first":"0","last":"4"}')
      expect(northStar.textContent).toContain('ops_kpi_weeks_8')

      // Mobile order is the DOM order: inbox, north star, then the goal groups.
      const order = [...container.querySelectorAll('section[aria-labelledby]')].map((section) => section.getAttribute('aria-labelledby'))
      expect(order.slice(0, 5)).toEqual([
        'ops-home-inbox-title', 'ops-home-north-star-title', 'ops-home-group-product', 'ops-home-group-safety', 'ops-home-group-b2b',
      ])

      // The KPI tiles replace the phase-1 tiles; the ingestion tile moves to the product group.
      expect(container.textContent).not.toContain('ops_an_m_00')
      expect(container.textContent).not.toContain('ops_home_kpi_centers_approved')
      expect(container.textContent).not.toContain('ops_kpi_unavailable')
      expect(group('ops-home-group-product').textContent).toContain('ops_an_ingestion_title')
      expect(tile('ops_kpi_wau_label').textContent).toContain('ops_an_unit_people:{"value":"6"}')
      expect(tile('ops_kpi_wau_label').textContent).toContain('"stickiness":"6/6"')
      expect(tile('ops_kpi_danger_label').textContent).toContain('ops_kpi_danger_value:{"events":"5","labs":"2"}')
      expect(tile('ops_kpi_danger_label').textContent).toContain('"rule":"storage_group_flammable+storage_group_oxidizer"')
      expect(tile('ops_kpi_requests_label').textContent).toContain('ops_kpi_requests_caption:{"hours":"7","responded":"2","requests":"3"}')
      expect(tile('ops_kpi_sales_label').textContent).toContain('hanbit univ')
      expect(tile('ops_kpi_sales_label').textContent).toContain('ops_kpi_sales_pending_center')
      expect(tile('ops_kpi_purchase_label').textContent).toContain('ops_kpi_purchase_brands:{"brands":"sigma 5"}')
      // B2B follows the period with the KPIs instead of reading the whole center list.
      expect(group('ops-home-group-b2b').textContent).toContain('ops_home_period_recent:{"days":7}')
    })

    it('shows rates over fewer than 10 cases as n/N with the small-sample mark, never a bare percent', async () => {
      services.loadAnalyticsSummary.mockResolvedValue({ ...summaryPayload(), kpis: kpisFixture() })
      await render()

      const activation = tile('ops_kpi_activation_label')
      expect(activation.textContent).toContain('1/2')
      expect(activation.textContent).toContain('ops_home_small_sample_short')
      expect(activation.textContent).toContain('ops_kpi_activation_caption:{"member":"1","item":"1","waste":"1"}')
      for (const label of ['ops_kpi_needs_review_label', 'ops_kpi_corrections_label', 'ops_kpi_ghs_label', 'ops_kpi_active_centers_label']) {
        const text = tile(label).textContent ?? ''
        expect(text, label).toContain('ops_home_small_sample_short')
        expect(text, label).not.toMatch(/\d%/)
      }
      expect(tile('ops_kpi_needs_review_label').textContent).toContain('2/4')
      // The two most frequent missing fields, comma-separated inside the " · " parts of the caption.
      expect(tile('ops_kpi_needs_review_label').textContent)
        .toContain('ops_kpi_needs_review_caption:{"fields":"ops_kpi_field_hazard_data, ops_kpi_field_measured_ph"}')
      // The previous period had one record: no arrow, only "직전 0/1".
      expect(tile('ops_kpi_needs_review_label').textContent).toContain('ops_kpi_previous_ratio:{"value":"0/1"}')
      expect(tile('ops_kpi_needs_review_label').textContent).not.toContain('ops_kpi_delta_points')
      // No previous cohort: nothing to compare.
      expect(activation.textContent).not.toContain('ops_kpi_previous_ratio')
    })

    it('compares counts and rates only when the previous period has 10 or more cases', async () => {
      const kpis = kpisFixture()
      kpis.product.wsal = { ...kpis.product.wsal, current: 23, previous: 20, totalLabs: 41 }
      kpis.safety.corrections = { ...kpis.safety.corrections, current: { numerator: 3, denominator: 100 }, previous: { numerator: 4, denominator: 50 } }
      services.loadAnalyticsSummary.mockResolvedValue({ ...summaryPayload(), kpis })
      await render()

      expect(group('ops-home-north-star-title').textContent)
        .toContain('ops_kpi_north_star_caption:{"delta":"ops_kpi_delta_up:{\\"value\\":\\"3\\"}","previous":"20","total":"41"}')
      const corrections = tile('ops_kpi_corrections_label').textContent ?? ''
      expect(corrections).toContain('3.0%')
      expect(corrections).not.toContain('ops_home_small_sample_short')
      expect(corrections).toContain('ops_kpi_delta_vs_previous:{"delta":"ops_kpi_delta_points_down:{\\"value\\":\\"5.0\\"}","previous":"8.0%"}')
    })

    it('takes exact inbox counts from the KPIs instead of a capped list', async () => {
      services.listSafetyCenterApprovals.mockResolvedValue(
        Array.from({ length: 200 }, (_, index) => center({ id: `c${index}`, status: index < 150 ? 'pending' : 'approved', created_at: daysAgo(1) })),
      )
      const kpis = kpisFixture()
      kpis.inbox.centers = { count: 263, oldestCreatedAt: daysAgo(9) }
      services.loadAnalyticsSummary.mockResolvedValue({ ...summaryPayload(), kpis })
      await render()

      const text = inbox().textContent ?? ''
      expect(text).toContain('ops_home_task_centers:{"value":"263"}')
      expect(text).toContain('ops_home_oldest_days:{"count":9}')
      expect(text).not.toContain('ops_home_capped_note')
      expect(text).not.toContain('ops_home_oldest_days_at_least')
      // The feedback list is not capped, so its own exact count stays.
      expect(text).toContain('ops_home_task_feedback:{"value":"3"}')
      // Review candidates come from the KPIs (2, not governance's 4), with their last update.
      expect(text).toContain('ops_home_task_reviews:{"value":"2"}')
      expect(text).toContain('ops_kpi_reviews_updated:{"date":')
    })

    it('falls back to the phase-1 home with one note when the KPIs are unavailable', async () => {
      services.loadAnalyticsSummary.mockResolvedValue({ ...summaryPayload(), kpis: null, kpisError: 'KPIS_UNAVAILABLE' })
      await render()

      expect(container.textContent).toContain('ops_an_m_00')
      expect(container.textContent).toContain('ops_home_kpi_centers_approved')
      expect(container.textContent?.match(/ops_kpi_unavailable/g)).toHaveLength(1)
      expect(container.querySelector('section[aria-labelledby="ops-home-north-star-title"]')).toBeNull()
      expect(container.querySelectorAll('section[aria-labelledby^="ops-home-group"] [aria-expanded]')).toHaveLength(0)
      expect(inbox().textContent).toContain('ops_home_task_reviews:{"value":"4"}')
      expect(inbox().textContent).not.toContain('ops_kpi_reviews_updated')
    })

    it('stays silent on an older server that does not send the KPIs', async () => {
      await render()

      expect(container.textContent).toContain('ops_an_m_00')
      expect(container.textContent).not.toContain('ops_kpi_unavailable')
      expect(container.querySelector('section[aria-labelledby="ops-home-north-star-title"]')).toBeNull()
    })

    it('explains each group from its "정의" button and folds the group from its title', async () => {
      services.loadAnalyticsSummary.mockResolvedValue({ ...summaryPayload(), kpis: kpisFixture() })
      await render()

      const safety = group('ops-home-group-safety')
      const definitions = buttonWithText('ops_kpi_definitions_show', safety)
      expect(definitions.getAttribute('aria-expanded')).toBe('false')
      await click(definitions)

      const panel = document.getElementById(definitions.getAttribute('aria-controls') ?? '')
      expect(panel?.textContent).toContain('ops_kpi_def_needs_review')
      expect(panel?.textContent).toContain('ops_kpi_def_corrections')
      expect(panel?.textContent).toContain('ops_kpi_def_danger')
      expect(panel?.textContent).toContain('ops_kpi_def_requests')
      expect(panel?.textContent).toContain('ops_kpi_def_ghs')
      expect(panel?.textContent).not.toContain('ops_kpi_def_wau')
      expect(panel?.textContent).toContain('ops_kpi_min_sample:{"value":10}')
      expect(panel?.textContent).toContain('ops_kpi_exclusions:{"labs":"1","users":"1"}')
      expect(buttonWithText('ops_kpi_definitions_hide', safety).getAttribute('aria-expanded')).toBe('true')

      // jsdom has no matchMedia, so the groups start open as on a desktop.
      const fold = safety.querySelector('h2 button')
      expect(fold?.getAttribute('aria-expanded')).toBe('true')
      const body = document.getElementById(fold?.getAttribute('aria-controls') ?? '')
      expect(body?.hidden).toBe(false)
      await click(fold as HTMLElement)
      expect(fold?.getAttribute('aria-expanded')).toBe('false')
      expect(body?.hidden).toBe(true)
    })

    it('starts with the goal groups folded on a phone', async () => {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (query: string) => ({ matches: query === '(max-width: 639px)', media: query }),
      })
      try {
        services.loadAnalyticsSummary.mockResolvedValue({ ...summaryPayload(), kpis: kpisFixture() })
        await render()

        for (const id of ['ops-home-group-product', 'ops-home-group-safety', 'ops-home-group-b2b']) {
          const fold = group(id).querySelector('h2 button')
          expect(fold?.getAttribute('aria-expanded'), id).toBe('false')
          expect(document.getElementById(fold?.getAttribute('aria-controls') ?? '')?.hidden, id).toBe(true)
        }
        // The inbox and the north star stay open.
        expect(group('ops-home-north-star-title').textContent).toContain('ops_home_unit_places:{"value":"4"}')
      } finally {
        Reflect.deleteProperty(window, 'matchMedia')
      }
    })

    it('keeps the KPI layout while another period loads', async () => {
      services.loadAnalyticsSummary.mockResolvedValue({ ...summaryPayload(), kpis: kpisFixture() })
      await render()
      let resolveMonth: (value: unknown) => void = () => undefined
      services.loadAnalyticsSummary.mockImplementationOnce(() => new Promise((resolve) => { resolveMonth = resolve }))

      await click(buttonWithText('ops_an_days:{"count":30}'))
      expect(container.textContent).not.toContain('ops_home_kpi_centers_approved')
      expect(container.querySelector('section[aria-labelledby="ops-home-north-star-title"] [role="status"]')).not.toBeNull()

      await act(async () => { resolveMonth({ ...summaryPayload(), kpis: kpisFixture() }) })
      await flush()
      expect(group('ops-home-north-star-title').textContent).toContain('ops_home_unit_places:{"value":"4"}')
    })
  })

  it('keeps the console light while it is open and gives the app its dark theme back', async () => {
    document.documentElement.classList.add('dark')
    try {
      await render()
      expect(document.documentElement.classList.contains('dark')).toBe(false)

      act(() => root.unmount())
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    } finally {
      document.documentElement.classList.remove('dark')
      root = createRoot(container)
    }
  })

  it('leaves a light document light after the console closes', async () => {
    await render()
    act(() => root.unmount())
    root = createRoot(container)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
