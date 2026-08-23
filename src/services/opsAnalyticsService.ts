import { getInternalApiUrl } from './apiUrl'
import { supabase } from './supabaseClient'

export class OpsAnalyticsApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'OpsAnalyticsApiError'
    this.status = status
  }
}

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

interface ApiErrorPayload { error?: string }

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'Content-Type': 'application/json',
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }
}

async function apiError(response: Response): Promise<OpsAnalyticsApiError> {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const payload = await response.json() as ApiErrorPayload
    return new OpsAnalyticsApiError(payload.error || `Request failed with status ${response.status}`, response.status)
  }
  const message = await response.text()
  return new OpsAnalyticsApiError(message || `Request failed with status ${response.status}`, response.status)
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(getInternalApiUrl(path), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  })
  if (!response.ok) throw await apiError(response)
  return await response.json() as T
}

export async function loadAnalyticsSummary(days: number): Promise<{
  summary: AnalyticsSummary
  governance: AnalyticsGovernance
}> {
  return await postJson('/api/admin/analytics/summary', { days })
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

export async function loadAnalyticsReviews(
  cursor: AnalyticsReviewCursor | null = null,
  limit = 50,
): Promise<{ items: AnalyticsReviewCandidate[]; nextCursor: AnalyticsReviewCursor | null }> {
  return await postJson('/api/admin/analytics/reviews', { operation: 'list', cursor, limit })
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
  if (!response.ok) throw await apiError(response)
  const disposition = response.headers.get('content-disposition') || ''
  const filename = disposition.match(/filename="([^"]+)"/i)?.[1] || 'buril-analytics.csv'
  return {
    blob: await response.blob(),
    filename,
    sha256: response.headers.get('x-content-sha256'),
  }
}
