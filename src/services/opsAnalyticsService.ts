import { getInternalApiUrl } from './apiUrl'
import { InternalApiError, postJson } from './internalApi'
import { supabase } from './supabaseClient'

export interface AnalyticsDistribution {
  median?: number
  q1?: number
  q3?: number
  p10?: number
  p90?: number
}

export interface AnalyticsSummary {
  periodDays: number
  submittedSearches: number
  uniqueUsers: number
  noResultRate: number
  technicalErrorRate: number
  ingestionRecoveryCount: number
  analyticsIngestionFailureRate: number
  batchConversionRate: number
  finalizedBatches: number
  mixedBatches: number
  dataCompleteness: {
    itemCount: number
    casPercent: number
    concentrationPercent: number
    volumePercent: number
  }
  dailyTrend: Array<{ date: string; searches: number; noResults: number }>
}

export interface AnalyticsGovernance {
  collection: {
    authenticatedEvents: number
    guestEvents: number
    guestSubjects: number
    guestEventsExpiringIn7Days: number
    oldestGuestEventAt: string | null
  }
  deletions: { requestCount: number; deletedEvents: number; deletedActions: number }
  exports: { count: number; lastExportAt: string | null; allAudited: boolean }
  monthlyRollups: {
    searchCells: number
    mixtureCells: number
    externalSearchCells: number
    externalMixtureCells: number
  }
  commercialization: {
    externalProductEnabled: boolean
    institutionDataAgreementReady: boolean
    reidentificationRiskReviewReady: boolean
    legalReviewReady: boolean
    searchThreshold: { events: number; users: number; labs: number }
    mixtureThreshold: { batches: number; users: number; labs: number }
    monthlyOnly: boolean
    retroactiveInclusion: boolean
  }
  reviews: { pending: number; approved: number; rejected: number }
}

/** n of N. The UI shows a percent only when denominator >= SMALL_SAMPLE_MIN (10); below that, "n/N". */
export interface KpiRatio { numerator: number; denominator: number }
/** Current period and the previous period of the same length (see metricDefinitions for each window). */
export interface KpiPair<T> { current: T; previous: T }

export interface KpiOnboardingFunnel {
  shown: number
  stepCompleted: number
  allStepsCompleted: number
  firstValueReached: number
  skipped: number
}

/** Closed list from record_waste_handling_v2 (BL:6791-6794). */
export type WasteMissingField =
  | 'components' | 'matrix' | 'total_amount' | 'measured_ph' | 'identity' | 'hazard_data'
  | 'additional_components' | 'mixing_state' | 'fluoride_container' | 'inventory_quantity'
  | 'policy_stream' | 'policy_destination'

export interface KpiSeatBuckets { upTo2: number; from3To5: number; from6To10: number; over10: number }

/** public.analytics_admin_kpis_v1 (supabase/migrations/20261106090000_admin_kpis_v1.sql). Counts only. */
export interface AnalyticsKpis {
  schemaVersion: 1
  /** ISO timestamp (UTC offset) of the transaction that computed the numbers. */
  generatedAt: string
  period: {
    days: number
    timeZone: 'Asia/Seoul'
    /** current = [currentStart, currentEnd), previous = [previousStart, currentStart). */
    currentStart: string
    currentEnd: string
    previousStart: string
  }
  exclusions: { internalLabs: number; internalUsers: number }
  inbox: {
    centers: { count: number; oldestCreatedAt: string | null }
    feedback: { count: number; byType: { bug: number; improvement: number; general: number }; oldestCreatedAt: string | null }
    reviews: { count: number; oldestCreatedAt: string | null; lastUpdatedAt: string | null }
  }
  product: {
    wsal: {
      current: number
      previous: number
      totalLabs: number
      /** Exactly 8 rolling weeks, oldest first; the last item's labs === current. */
      weekly: Array<{ start: string; end: string; labs: number }>
    }
    activeUsers: { wau: KpiPair<number>; mau: KpiPair<number>; stickiness: KpiPair<KpiRatio> }
    activation14d: KpiPair<{
      cohortLabs: number
      secondMember: number
      firstItem: number
      firstWasteRecord: number
      fullyActivated: number
    }>
    retentionW4: KpiPair<KpiRatio>
    onboarding: { web: KpiPair<KpiOnboardingFunnel>; native: KpiPair<KpiOnboardingFunnel> }
  }
  safety: {
    needsReview: KpiPair<KpiRatio & { needsInput: number; blocked: number }> & {
      /** Current period, at most 5, most frequent first. */
      topMissingFields: Array<{ field: WasteMissingField; records: number }>
    }
    corrections: KpiPair<KpiRatio> & {
      /** Current period, voided records only; sums to current.numerator. */
      byReason: { amount: number; duplicate: number; category: number; other: number }
    }
    dangerIgnored: KpiPair<{ events: number; labs: number }> & {
      /** Current period, at most 5; ruleId is one of the STORAGE_RULES ids (closed list in the migration). */
      topRules: Array<{ ruleId: string; events: number }>
    }
    centerRequests: {
      open: number
      overdue: number
      overdueLabs: number
      dueSoon: number
      firstResponse: KpiPair<{ requests: number; responded: number; medianHours: number | null }>
    }
    ghsCheckGaps: KpiPair<KpiRatio & { lookupFailed: number; notChecked: number }>
  }
  b2b: {
    centerPipeline: {
      applications: KpiPair<number>
      pending: number
      approved: number
      rejected: number
      approvalDays: { centers: number; median: number | null }
      activeCenters: KpiPair<number>
      linkedLabs: number
      linkRequestsPending: number
      requests: KpiPair<number>
      exports: KpiPair<number>
    }
    institutions: {
      labsTotal: number
      labsWithInstitution: number
      institutions: number
      institutionsWithApprovedCenter: number
      coveredLabs: number
      salesCandidates: {
        count: number
        /** At most 10; institution is lower(trim(name)), at most 100 characters. */
        top: Array<{ institution: string; activeLabs: number; hasPendingCenter: boolean }>
      }
    }
    labProReadiness: KpiPair<{ habitualLabs: number; readyLabs: number; seats: KpiSeatBuckets }>
    purchaseIntent: KpiPair<{ events: number; labs: number; users: number; withCas: number }> & {
      /** Current period, at most 5, only brands with >= 3 labs and >= 5 users. Internal use only. */
      topBrands: Array<{ brand: string; events: number; labs: number; users: number }>
      hiddenBrands: number
    }
  }
}

export type AnalyticsKpisErrorCode = 'KPIS_UNAVAILABLE' | 'KPIS_FAILED'

export interface AnalyticsSummaryResponse {
  summary: AnalyticsSummary
  governance: AnalyticsGovernance
  /** Only when requested with includeKpis. null when the KPI function failed or is not deployed yet. */
  kpis?: AnalyticsKpis | null
  kpisError?: AnalyticsKpisErrorCode
}

/** A KPI payload this app version can read (schemaVersion 1 with the period, inbox, product, safety and b2b objects). */
export function isAnalyticsKpis(value: unknown): value is AnalyticsKpis {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.schemaVersion === 1
    && ['inbox', 'product', 'safety', 'b2b', 'period'].every((key) => {
      const section = record[key]
      return Boolean(section) && typeof section === 'object' && !Array.isArray(section)
    })
}

export interface AnalyticsSearchItem {
  query: string
  normalizedQuery: string
  demandIndex: number
  events7d: number
  events30d: number
  events90d: number
  matchedCount: number
  noResultCount: number
  technicalErrorCount: number
  uniqueSubjects: number
  smallSample: boolean
  confusionScore: number
  components: {
    noResultRate: number
    reformulationRate: number
    scanCorrectionRate: number
    unresolvedRate: number
  }
  variants: string[]
  resolvedStandards: string[]
}

export interface AnalyticsMixturePair {
  componentAKey: string
  componentAName: string
  componentBKey: string
  componentBName: string
  batchCount: number
  uniqueUsers: number
  uniqueLabs: number
  searchLinkedBatchCount: number
  smallSample: boolean
  phDistribution: AnalyticsDistribution
  volumeDistributionMl: AnalyticsDistribution
  concentrationDistributions: Record<string, AnalyticsDistribution>
  hazardFlags: string[]
  streams: Record<string, number>
  actions: Record<string, number>
  matrices: Record<string, number>
}

export interface AnalyticsMixtures {
  pairs: AnalyticsMixturePair[]
  combinations: Array<{ key: string; name: string; batchCount: number; smallSample: boolean }>
  excludedStates: { separate: number; unknown: number }
  handlingSummary: {
    total: number
    isolated: number
    handover: number
    isolatedRate: number
    handoverRate: number
  }
}

export type AnalyticsReviewStatus = 'pending' | 'approved' | 'rejected'
export type AnalyticsReviewType = 'search_alias' | 'safety_rule' | 'education_content'

export interface AnalyticsReviewCandidate {
  id: string
  candidate_type: AnalyticsReviewType
  source_key: string
  title: string
  summary: string
  proposed_alias: string | null
  canonical_name: string | null
  canonical_cas: string | null
  evidence: Record<string, unknown>
  sample_count: number
  status: AnalyticsReviewStatus
  review_notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export interface AnalyticsReviewCursor {
  createdAt: string
  id: string
}

interface ApiErrorPayload { error?: string; code?: unknown; retryAfterSeconds?: unknown }

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'Content-Type': 'application/json',
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }
}

/** CSV export streams a file, so it keeps its own fetch but reports errors like every other operator call. */
async function exportApiError(response: Response): Promise<InternalApiError> {
  let payload: ApiErrorPayload | undefined
  if ((response.headers.get('content-type') || '').includes('application/json')) {
    try { payload = await response.json() as ApiErrorPayload } catch { /* keep the HTTP status */ }
  }
  const message = typeof payload?.error === 'string' && payload.error ? payload.error : `Request failed with status ${response.status}`
  const code = typeof payload?.code === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(payload.code) ? payload.code : undefined
  // Same rule as internalApi: the body value first, then a numeric Retry-After header, 1s..24h.
  const header = response.headers.get('Retry-After')
  const retryValue = payload?.retryAfterSeconds ?? (header && /^\d+$/.test(header) ? Number(header) : undefined)
  const retryAfter = typeof retryValue === 'number' && Number.isSafeInteger(retryValue) && retryValue > 0 && retryValue <= 86_400
    ? retryValue : undefined
  return new InternalApiError(message, response.status, code, retryAfter)
}

/**
 * The search summary and governance for the last `days`. `includeKpis` also asks for the operator
 * KPIs (analytics_admin_kpis_v1) in the same call; without it the request body stays `{ days }`.
 */
export async function loadAnalyticsSummary(
  days: number,
  options: { includeKpis?: boolean } = {},
): Promise<AnalyticsSummaryResponse> {
  return await postJson('/api/admin/analytics/summary', options.includeKpis ? { days, includeKpis: true } : { days })
}

export async function loadAnalyticsSearches(
  days: number,
  limit = 100,
  order: 'demand' | 'confusion' = 'demand',
): Promise<AnalyticsSearchItem[]> {
  const payload = await postJson<{ items: AnalyticsSearchItem[] }>('/api/admin/analytics/search', {
    days,
    limit,
    order,
  })
  return payload.items
}

export async function loadAnalyticsMixtures(days: number, limit = 100): Promise<AnalyticsMixtures> {
  return await postJson('/api/admin/analytics/mixtures', { days, limit })
}

/**
 * Lists review candidates, newest first. `status` narrows the list to one state;
 * leaving it out (or null) keeps the original behaviour of listing every candidate.
 */
export async function loadAnalyticsReviews(
  cursor: AnalyticsReviewCursor | null = null,
  limit = 50,
  status: AnalyticsReviewStatus | null = null,
): Promise<{ items: AnalyticsReviewCandidate[]; nextCursor: AnalyticsReviewCursor | null }> {
  return await postJson('/api/admin/analytics/reviews', {
    operation: 'list',
    cursor,
    limit,
    ...(status ? { status } : {}),
  })
}

/** The candidate was decided (by someone else or in another tab) before this decision arrived. */
export function isAnalyticsReviewAlreadyDecided(error: unknown): boolean {
  return error instanceof InternalApiError && error.status === 409
}

export async function decideAnalyticsReview(input: {
  candidateId: string
  status: Exclude<AnalyticsReviewStatus, 'pending'>
  notes: string
  evidence?: Record<string, unknown>
  proposedAlias?: string | null
  canonicalName?: string | null
  canonicalCas?: string | null
}): Promise<AnalyticsReviewCandidate> {
  const payload = await postJson<{ item: AnalyticsReviewCandidate }>('/api/admin/analytics/reviews', {
    operation: 'decide',
    ...input,
  })
  return payload.item
}

export async function exportAnalyticsCsv(input: {
  from: string
  to: string
  reason: string
  outcome?: string
}): Promise<{ blob: Blob; filename: string; sha256: string | null }> {
  const response = await fetch(getInternalApiUrl('/api/admin/analytics/export'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  })
  if (!response.ok) throw await exportApiError(response)
  const disposition = response.headers.get('content-disposition') || ''
  const filename = disposition.match(/filename="([^"]+)"/i)?.[1] || 'buril-analytics.csv'
  return {
    blob: await response.blob(),
    filename,
    sha256: response.headers.get('x-content-sha256'),
  }
}
