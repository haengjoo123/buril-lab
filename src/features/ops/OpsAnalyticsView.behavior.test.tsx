// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ko', changeLanguage: vi.fn() },
  }),
}))
vi.mock('../../locales/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('../../services/supabaseClient', () => ({ supabase: {} }))
vi.mock('../../components/MfaSettingsPanel', () => ({ MfaSettingsPanel: () => null }))
vi.mock('../../services/opsAnalyticsService', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/opsAnalyticsService')>(),
  loadAnalyticsSummary: vi.fn(),
  loadAnalyticsSearches: vi.fn(),
  loadAnalyticsMixtures: vi.fn(),
  loadAnalyticsReviews: vi.fn(),
  decideAnalyticsReview: vi.fn(),
  exportAnalyticsCsv: vi.fn(),
}))

import { InternalApiError } from '../../services/internalApi'
import {
  decideAnalyticsReview,
  loadAnalyticsMixtures,
  loadAnalyticsReviews,
  loadAnalyticsSearches,
  loadAnalyticsSummary,
  type AnalyticsReviewCandidate,
  type AnalyticsSearchItem,
} from '../../services/opsAnalyticsService'
import { OpsAnalyticsView } from './OpsAnalyticsView'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const summaryPayload = {
  summary: {
    periodDays: 30, submittedSearches: 4, uniqueUsers: 2, noResultRate: 0, technicalErrorRate: 0,
    ingestionRecoveryCount: 0, analyticsIngestionFailureRate: 0.4, batchConversionRate: 50,
    finalizedBatches: 1, mixedBatches: 0,
    dataCompleteness: { itemCount: 1, casPercent: 100, concentrationPercent: 100, volumePercent: 100 },
    dailyTrend: [],
  },
  governance: {
    collection: { authenticatedEvents: 4, guestEvents: 0, guestSubjects: 0, guestEventsExpiringIn7Days: 0, oldestGuestEventAt: null },
    deletions: { requestCount: 0, deletedEvents: 0, deletedActions: 0 },
    exports: { count: 0, lastExportAt: null, allAudited: true },
    monthlyRollups: { searchCells: 0, mixtureCells: 0, externalSearchCells: 0, externalMixtureCells: 0 },
    commercialization: {
      externalProductEnabled: false, institutionDataAgreementReady: false,
      reidentificationRiskReviewReady: false, legalReviewReady: false,
      searchThreshold: { events: 30, users: 5, labs: 3 }, mixtureThreshold: { batches: 10, users: 5, labs: 3 },
      monthlyOnly: true, retroactiveInclusion: false,
    },
    reviews: { pending: 1, approved: 0, rejected: 0 },
  },
}

const searchItem: AnalyticsSearchItem = {
  query: 'acetone', normalizedQuery: 'acetone', demandIndex: 3, events7d: 1, events30d: 2, events90d: 3,
  matchedCount: 3, noResultCount: 0, technicalErrorCount: 0, uniqueSubjects: 2, smallSample: false,
  confusionScore: 10,
  components: { noResultRate: 0, reformulationRate: 0, scanCorrectionRate: 0, unresolvedRate: 0 },
  variants: [], resolvedStandards: [],
}

function candidate(id: string, overrides: Partial<AnalyticsReviewCandidate> = {}): AnalyticsReviewCandidate {
  return {
    id, candidate_type: 'safety_rule', source_key: id, title: `Candidate ${id.slice(0, 4)}`, summary: 'Summary',
    proposed_alias: null, canonical_name: null, canonical_cas: null, evidence: {}, sample_count: 3,
    status: 'pending', review_notes: null, reviewed_by: null, reviewed_at: null,
    created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z',
    ...overrides,
  }
}

const FIRST = '11111111-1111-4111-8111-111111111111'
const SECOND = '22222222-2222-4222-8222-222222222222'

let container: HTMLDivElement
let root: Root
const probe = { search: '' }

function LocationProbe() {
  const { search } = useLocation()
  useEffect(() => { probe.search = search }, [search])
  return null
}

async function flush() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => { await Promise.resolve() })
  }
}

async function render(path: string) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <OpsAnalyticsView />
        <LocationProbe />
      </MemoryRouter>,
    )
  })
  await flush()
}

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find((element) => element.textContent?.trim() === label)
  if (!match) throw new Error(`No button labelled ${label}`)
  return match
}

async function click(label: string) {
  await act(async () => { button(label).click() })
  await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.mocked(loadAnalyticsSummary).mockResolvedValue(summaryPayload)
  vi.mocked(loadAnalyticsSearches).mockResolvedValue([searchItem])
  vi.mocked(loadAnalyticsMixtures).mockResolvedValue({
    pairs: [], combinations: [], excludedStates: { separate: 0, unknown: 0 },
    handlingSummary: { total: 0, isolated: 0, handover: 0, isolatedRate: 0, handoverRate: 0 },
  })
  vi.mocked(loadAnalyticsReviews).mockResolvedValue({ items: [], nextCursor: null })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('OpsAnalyticsView per-tab loading', () => {
  it('loads only what the active tab needs and reuses cached results', async () => {
    await render('/ops/analytics')
    expect(loadAnalyticsSummary).toHaveBeenCalledTimes(1)
    expect(loadAnalyticsSummary).toHaveBeenCalledWith(30)
    expect(loadAnalyticsSearches).not.toHaveBeenCalled()
    expect(loadAnalyticsMixtures).not.toHaveBeenCalled()
    expect(loadAnalyticsReviews).not.toHaveBeenCalled()

    await click('ops_an_tab_searches')
    expect(probe.search).toBe('?tab=searches')
    expect(loadAnalyticsSearches).toHaveBeenCalledTimes(2)
    expect(vi.mocked(loadAnalyticsSearches).mock.calls.map((call) => call[2]).sort()).toEqual(['confusion', 'demand'])

    // Overview and governance share the cached summary; switching back does not refetch.
    await click('ops_an_tab_overview')
    expect(probe.search).toBe('')
    await click('ops_an_tab_governance')
    expect(loadAnalyticsSummary).toHaveBeenCalledTimes(1)

    // Refresh reloads only the current tab's data.
    await click('ops_an_refresh')
    expect(loadAnalyticsSummary).toHaveBeenCalledTimes(2)
    expect(loadAnalyticsSearches).toHaveBeenCalledTimes(2)
  })

  it('loads a new period once and hides event windows longer than it', async () => {
    await render('/ops/analytics?tab=searches')
    expect(container.textContent).toContain('ops_an_events_30d')
    expect(container.textContent).not.toContain('ops_an_events_90d')

    await click('ops_an_days')
    // The first period button is 7 days.
    expect(vi.mocked(loadAnalyticsSearches).mock.calls.some((call) => call[0] === 7)).toBe(true)
    expect(container.textContent).toContain('ops_an_events_7d')
    expect(container.textContent).not.toContain('ops_an_events_30d')
  })
})

describe('OpsAnalyticsView access handling', () => {
  it('keeps a review-role refusal inside the reviews tab', async () => {
    vi.mocked(loadAnalyticsReviews).mockRejectedValue(new InternalApiError('role', 403, 'OPERATOR_ROLE_REQUIRED'))
    await render('/ops/analytics?tab=reviews')
    expect(loadAnalyticsReviews).toHaveBeenCalledWith(null, 50, 'pending')
    expect(container.textContent).toContain('ops_access_role_title')
    expect(container.textContent).toContain('ops_access_role_needed')
    expect(container.querySelector('nav')).not.toBeNull()

    await click('ops_an_tab_overview')
    expect(container.textContent).toContain('ops_an_m_00')
  })

  it('keeps an overdue approver review inside the reviews tab and names the role to renew', async () => {
    vi.mocked(loadAnalyticsReviews).mockRejectedValue(new InternalApiError('review', 403, 'OPERATOR_REVIEW_REQUIRED'))
    await render('/ops/analytics?tab=reviews')
    expect(container.querySelector('nav')).not.toBeNull()
    expect(container.textContent).toContain('ops_access_review_title')
    expect(container.textContent).toContain('ops_access_review_role')

    await click('ops_an_tab_overview')
    expect(container.textContent).toContain('ops_an_m_00')
  })

  it('keeps the screen when a decision needs the approver review renewed', async () => {
    vi.mocked(loadAnalyticsReviews).mockResolvedValueOnce({ items: [candidate(FIRST)], nextCursor: null })
    vi.mocked(decideAnalyticsReview).mockRejectedValue(new InternalApiError('review', 403, 'OPERATOR_REVIEW_REQUIRED'))
    await render('/ops/analytics?tab=reviews')

    await click('ops_an_reject')
    expect(container.querySelector('nav')).not.toBeNull()
    expect(container.textContent).toContain('ops_access_review_title · ops_access_review_role')
    expect(container.textContent).toContain('Candidate 1111')
  })

  it('blocks the whole screen when the reader review is overdue and names that role', async () => {
    vi.mocked(loadAnalyticsSummary).mockRejectedValue(new InternalApiError('review', 403, 'OPERATOR_REVIEW_REQUIRED'))
    await render('/ops/analytics')
    expect(container.querySelector('nav')).toBeNull()
    expect(container.textContent).toContain('ops_access_review_title')
    expect(container.textContent).toContain('ops_access_review_role')
  })

  it('blocks the whole screen when the core data is refused without a code', async () => {
    vi.mocked(loadAnalyticsSummary).mockRejectedValue(new InternalApiError('denied', 403))
    await render('/ops/analytics')
    expect(container.querySelector('nav')).toBeNull()
    expect(container.textContent).toContain('ops_access_denied_title')
  })

  it('shows a rate limit inline with a retry button', async () => {
    vi.mocked(loadAnalyticsSummary).mockRejectedValueOnce(new InternalApiError('slow down', 429, 'RATE_LIMITED', 12))
    await render('/ops/analytics')
    expect(container.querySelector('nav')).not.toBeNull()
    expect(container.textContent).toContain('ops_access_rate_limited_wait')

    await click('ops_access_retry')
    expect(loadAnalyticsSummary).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('ops_an_m_00')
  })
})

describe('OpsAnalyticsView review list', () => {
  it('pages with the cursor and switches to the full list on request', async () => {
    const cursor = { createdAt: '2026-11-01T00:00:00.000Z', id: FIRST }
    vi.mocked(loadAnalyticsReviews)
      .mockResolvedValueOnce({ items: [candidate(FIRST)], nextCursor: cursor })
      .mockResolvedValueOnce({ items: [candidate(SECOND)], nextCursor: null })
      .mockResolvedValueOnce({ items: [candidate(FIRST, { status: 'approved' })], nextCursor: null })
    await render('/ops/analytics?tab=reviews')

    await click('ops_an_load_more')
    expect(loadAnalyticsReviews).toHaveBeenLastCalledWith(cursor, 50, 'pending')
    expect(container.textContent).toContain('Candidate 1111')
    expect(container.textContent).toContain('Candidate 2222')
    expect(() => button('ops_an_load_more')).toThrow()

    await click('ops_an_all')
    expect(loadAnalyticsReviews).toHaveBeenLastCalledWith(null, 50, null)
    expect(container.textContent).toContain('ops_an_review_status_approved')
  })

  it('reloads the list and explains when a candidate was already decided', async () => {
    vi.mocked(loadAnalyticsReviews)
      .mockResolvedValueOnce({ items: [candidate(FIRST)], nextCursor: null })
      .mockResolvedValueOnce({ items: [], nextCursor: null })
    vi.mocked(decideAnalyticsReview).mockRejectedValue(
      new InternalApiError('decided', 409, 'REVIEW_ALREADY_DECIDED'),
    )
    await render('/ops/analytics?tab=reviews')

    await click('ops_an_reject')
    expect(decideAnalyticsReview).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('ops_an_review_already_decided')
    expect(loadAnalyticsReviews).toHaveBeenCalledTimes(2)
    expect(container.textContent).not.toContain('Candidate 1111')
    expect(container.textContent).toContain('ops_an_no_candidates')
  })

  it('ignores a second click while the same decision is in flight', async () => {
    vi.mocked(loadAnalyticsReviews).mockResolvedValueOnce({ items: [candidate(FIRST)], nextCursor: null })
    let resolveDecision: (value: AnalyticsReviewCandidate) => void = () => undefined
    vi.mocked(decideAnalyticsReview).mockImplementation(() => new Promise((resolve) => { resolveDecision = resolve }))
    await render('/ops/analytics?tab=reviews')

    const reject = button('ops_an_reject')
    await act(async () => {
      reject.click()
      reject.click()
    })
    expect(decideAnalyticsReview).toHaveBeenCalledTimes(1)

    await act(async () => { resolveDecision(candidate(FIRST, { status: 'rejected' })) })
    await flush()
    expect(container.textContent).toContain('ops_an_review_rejected')
    expect(container.textContent).not.toContain('Candidate 1111')
  })
})
