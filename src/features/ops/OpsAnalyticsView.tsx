import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useActionToast } from '../../components/admin/ActionToast'
import { InternalApiError } from '../../services/internalApi'
import {
  decideAnalyticsReview,
  exportAnalyticsCsv,
  isAnalyticsReviewAlreadyDecided,
  loadAnalyticsMixtures,
  loadAnalyticsReviews,
  loadAnalyticsSearches,
  loadAnalyticsSummary,
  type AnalyticsDistribution,
  type AnalyticsGovernance,
  type AnalyticsMixtures,
  type AnalyticsReviewCandidate,
  type AnalyticsReviewCursor,
  type AnalyticsSearchItem,
  type AnalyticsSummary,
} from '../../services/opsAnalyticsService'
import {
  HANDLING_ACTION_LABELS,
  HAZARD_FLAG_LABELS,
  INGESTION_FAILURE_BASELINE_PERCENT,
  MATRIX_LABELS,
  REVIEW_TYPE_LABELS,
  SEARCH_OUTCOME_LABELS,
  WASTE_STREAM_LABELS,
  canonicalComponentDisplayKey,
  fillDailyTrend,
  ingestionFailureStatus,
  koreanChemicalDisplayName,
  koreanReviewDisplayText,
  opsAnalyticsLabel,
  searchEventWindows,
  type OpsAnalyticsLabelMap,
  type SearchEventWindow,
} from './opsAnalyticsLabels'
import { OpsAccessNotice } from './OpsAccessNotice'
import { getOpsAccessProblem, isConsoleWideAccessIssue, type OpsAccessProblem } from './opsAccess'

type AnalyticsTab = 'overview' | 'searches' | 'mixtures' | 'reviews' | 'governance'
type AnalyticsResource = 'summary' | 'searches' | 'mixtures' | 'reviews'
type ReviewFilter = 'pending' | 'all'
type Translate = (key: string, opts?: Record<string, unknown>) => string

const PERIODS = [7, 30, 90] as const
type AnalyticsPeriod = (typeof PERIODS)[number]
const DEFAULT_TAB: AnalyticsTab = 'overview'
const TABS: Array<{ id: AnalyticsTab; labelKey: string }> = [
  { id: 'overview', labelKey: 'ops_an_tab_overview' },
  { id: 'searches', labelKey: 'ops_an_tab_searches' },
  { id: 'mixtures', labelKey: 'ops_an_tab_mixtures' },
  { id: 'reviews', labelKey: 'ops_an_tab_reviews' },
  { id: 'governance', labelKey: 'ops_an_tab_governance' },
]
/** Overview and governance both read the summary call. The review list ignores the period. */
const TAB_RESOURCE: Record<AnalyticsTab, AnalyticsResource> = {
  overview: 'summary',
  searches: 'searches',
  mixtures: 'mixtures',
  reviews: 'reviews',
  governance: 'summary',
}
/** Operator role each call needs (OPERATOR_ACTIONS in functions/api/admin/feedback/_shared.ts). */
const RESOURCE_ROLE: Record<AnalyticsResource, string> = {
  summary: 'reader',
  searches: 'reader',
  mixtures: 'reader',
  reviews: 'approver',
}
const REVIEW_PAGE_SIZE = 50

type SummaryPayload = Awaited<ReturnType<typeof loadAnalyticsSummary>>
interface SearchesPayload { demand: AnalyticsSearchItem[]; confusion: AnalyticsSearchItem[] }
interface ReviewsPayload { items: AnalyticsReviewCandidate[]; nextCursor: AnalyticsReviewCursor | null }
type ReviewDraft = {
  notes: string
  evidenceReference: string
  proposedAlias: string
  canonicalName: string
  canonicalCas: string
}

function parseTab(value: string | null): AnalyticsTab {
  return TABS.find((item) => item.id === value)?.id ?? DEFAULT_TAB
}

function asNumber(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ko-KR') : '—'
}

function asPercent(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}%` : '—'
}

function dateInputValue(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 10)
}

function startOfKstDate(value: string): string {
  return new Date(`${value}T00:00:00+09:00`).toISOString()
}

function dayAfterKstDate(value: string): string {
  const date = new Date(`${value}T00:00:00+09:00`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString()
}

/** Short toast copy for a refusal that only affects one action. */
function accessProblemMessage(problem: OpsAccessProblem, t: Translate, requiredRole?: string): string {
  if (problem.issue === 'rate_limited') {
    return problem.retryAfterSeconds
      ? t('ops_access_rate_limited_wait', { seconds: problem.retryAfterSeconds })
      : t('ops_access_rate_limited_body')
  }
  if (problem.issue === 'review_required') {
    const title = t('ops_access_review_title')
    return requiredRole ? `${title} · ${t('ops_access_review_role', { role: requiredRole })}` : title
  }
  return problem.issue === 'role_required' ? t('ops_access_role_title') : t('ops_access_denied_title')
}

interface ResourceEntry<T> {
  /** Last good response and when it arrived. Kept while a refresh runs or fails. */
  value?: { data: T; loadedAt: number }
  error?: unknown
  loading: boolean
}

type ResourceEntries<T> = Partial<Record<string, ResourceEntry<T>>>

/**
 * Per-key cache for one analytics call, e.g. summary by period. Switching back to a loaded
 * tab or period is instant, and a key that is already loading is never requested twice.
 */
function useResourceCache<T>() {
  const [entries, setEntries] = useState<ResourceEntries<T>>({})
  const inFlight = useRef(new Set<string>())

  /** Loads one key. Resolves with the error, or null on success or when the key is already loading. */
  const run = useCallback(async (key: string, fetcher: () => Promise<T>): Promise<unknown> => {
    if (inFlight.current.has(key)) return null
    inFlight.current.add(key)
    setEntries((current) => ({ ...current, [key]: { value: current[key]?.value, loading: true } }))
    try {
      const data = await fetcher()
      setEntries((current) => ({ ...current, [key]: { value: { data, loadedAt: Date.now() }, loading: false } }))
      return null
    } catch (error) {
      setEntries((current) => ({ ...current, [key]: { value: current[key]?.value, error, loading: false } }))
      return error
    } finally {
      inFlight.current.delete(key)
    }
  }, [])

  /** Rewrites cached data in place (for example after a decision) without refetching. */
  const update = useCallback((updater: (data: T, key: string) => T) => {
    setEntries((current) => {
      const next: ResourceEntries<T> = {}
      for (const [key, entry] of Object.entries(current)) {
        next[key] = entry?.value ? { ...entry, value: { ...entry.value, data: updater(entry.value.data, key) } } : entry
      }
      return next
    })
  }, [])

  /** Forgets matching keys so the next visit loads them again. */
  const drop = useCallback((shouldDrop: (key: string, entry: ResourceEntry<T>) => boolean) => {
    setEntries((current) => {
      const next: ResourceEntries<T> = {}
      for (const [key, entry] of Object.entries(current)) {
        if (entry && !shouldDrop(key, entry)) next[key] = entry
      }
      return next
    })
  }, [])

  return { entries, run, update, drop }
}

const dropFailedWithoutData = (_key: string, entry: ResourceEntry<unknown>) => entry.error !== undefined && !entry.value

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
      {detail && <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>}
    </div>
  )
}

function SmallSampleBadge() {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-2xs font-medium text-amber-700 ring-1 ring-amber-200">
      <AlertTriangle className="h-3 w-3" /> {t('ops_an_small_sample')}
    </span>
  )
}

function LoadErrorNotice({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <span>{t('ops_an_load_failed')}</span>
      <button type="button" onClick={onRetry} className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-200 bg-white px-3 text-sm font-medium text-red-800 hover:bg-red-100">
        <RefreshCw className="h-4 w-4" aria-hidden="true" /> {t('ops_access_retry')}
      </button>
    </div>
  )
}

/**
 * Shows one tab's data with its own loading and error state, so a slow or refused call never
 * blocks the other tabs. Stale data stays visible under a refresh error.
 */
function ResourceView<T>({
  entry,
  requiredRole,
  onRetry,
  children,
}: {
  entry: ResourceEntry<T> | undefined
  requiredRole: string
  onRetry: () => void
  children: (data: T, loadedAt: number) => ReactNode
}) {
  const { t } = useTranslation()
  if (!entry || (!entry.value && entry.loading)) {
    return (
      <div role="status" className="flex min-h-[16rem] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" aria-hidden="true" />
        <span className="sr-only">{t('loading')}</span>
      </div>
    )
  }
  const problem = entry.error !== undefined ? getOpsAccessProblem(entry.error) : null
  const notice = entry.error === undefined
    ? null
    : problem
      ? <OpsAccessNotice compact problem={problem} requiredRole={requiredRole} onRetry={onRetry} />
      : <LoadErrorNotice onRetry={onRetry} />
  if (!entry.value) return notice
  return <>{notice}{children(entry.value.data, entry.value.loadedAt)}</>
}

function DistributionText({
  value,
  suffix = '',
  compact = false,
}: {
  value: AnalyticsDistribution
  suffix?: string
  compact?: boolean
}) {
  const { t } = useTranslation()
  if (value.median === undefined) return <span className="text-slate-400">{t('ops_an_no_input')}</span>
  const unit = suffix ? ` ${suffix}` : ''
  if (compact) return <span>{t('ops_an_median', { value: `${asNumber(value.median)}${unit}` })}</span>
  return (
    <span>
      {t('ops_an_median', { value: `${asNumber(value.median)}${unit}` })} · {t('ops_an_iqr', { range: `${asNumber(value.q1)}–${asNumber(value.q3)}${unit}` })}
      {value.p10 !== undefined && <> · {t('ops_an_p10_p90', { range: `${asNumber(value.p10)}–${asNumber(value.p90)}${unit}` })}</>}
    </span>
  )
}

function trendDateLabel(value: string, t: Translate): { short: string; long: string } {
  const [year, month, day] = value.split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return { short: value, long: value }
  return { short: `${month}/${day}`, long: t('ops_an_date_long', { year, month, day }) }
}

function IngestionHealth({ summary }: { summary: AnalyticsSummary }) {
  const { t } = useTranslation()
  const rate = summary.analyticsIngestionFailureRate
  const status = ingestionFailureStatus(rate)
  const attention = status === 'attention'
  return (
    <section className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 ${attention ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white shadow-sm'}`}>
      {attention
        ? <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
        : <CheckCircle2 className={`h-5 w-5 shrink-0 ${status === 'normal' ? 'text-emerald-600' : 'text-slate-400'}`} aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-slate-950">{t('ops_an_ingestion_title')}</h2>
        <p className="mt-0.5 text-xs leading-5 text-slate-600">
          {t('ops_an_ingestion_baseline', { value: INGESTION_FAILURE_BASELINE_PERCENT })} · {t('ops_an_ingestion_recovered', { count: summary.ingestionRecoveryCount })}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-lg font-semibold tabular-nums text-slate-950">
          {status === 'unknown' ? '—' : `${rate.toFixed(2)}%`}
        </span>
        {status !== 'unknown' && (
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${attention ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300' : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'}`}>
            {attention ? t('ops_an_status_attention') : t('ops_an_status_normal')}
          </span>
        )}
      </div>
    </section>
  )
}

function OverviewPanel({ summary, days, loadedAt }: { summary: AnalyticsSummary; days: number; loadedAt: number }) {
  const { t } = useTranslation()
  // The SQL leaves out days without searches; show them as zero over the whole window.
  const trend = useMemo(
    () => fillDailyTrend(summary.dailyTrend, days, new Date(loadedAt)),
    [summary.dailyTrend, days, loadedAt],
  )
  const maxSearches = Math.max(1, ...trend.map((point) => point.searches))
  const trendTotal = trend.reduce((total, point) => total + point.searches, 0)
  const peak = trend.reduce<(typeof trend)[number] | null>(
    (highest, point) => point.searches > 0 && (!highest || point.searches > highest.searches) ? point : highest,
    null,
  )
  const density = trend.length <= 10 ? 'regular' : trend.length <= 35 ? 'compact' : 'dense'
  const labelEvery = Math.max(1, Math.ceil(trend.length / 8))
  const columnWidth = density === 'regular' ? 58 : density === 'compact' ? 24 : 10
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={t('ops_an_m_00')} value={t('ops_an_unit_cases', { value: summary.submittedSearches.toLocaleString('ko-KR') })} detail={t('ops_an_m_01')} />
        <MetricCard label={t('ops_an_m_02')} value={t('ops_an_unit_people', { value: summary.uniqueUsers.toLocaleString('ko-KR') })} detail={t('ops_an_m_03')} />
        <MetricCard label={t('ops_an_m_04')} value={asPercent(summary.noResultRate)} detail={t('ops_an_m_05')} />
        <MetricCard label={t('ops_an_m_06')} value={asPercent(summary.batchConversionRate)} detail={t('ops_an_m_07')} />
        <MetricCard label={t('ops_an_m_08')} value={t('ops_an_unit_cases', { value: summary.finalizedBatches.toLocaleString('ko-KR') })} detail={t('ops_an_m_09')} />
        <MetricCard label={t('ops_an_m_10')} value={t('ops_an_unit_cases', { value: summary.mixedBatches.toLocaleString('ko-KR') })} detail={t('ops_an_m_11')} />
        <MetricCard label={t('ops_an_m_12')} value={asPercent(summary.technicalErrorRate)} detail={t('ops_an_m_13')} />
        <MetricCard label={t('ops_an_m_14')} value={t('ops_an_unit_items', { value: summary.dataCompleteness.itemCount.toLocaleString('ko-KR') })} detail={t('ops_an_completeness', { cas: asPercent(summary.dataCompleteness.casPercent), concentration: asPercent(summary.dataCompleteness.concentrationPercent), volume: asPercent(summary.dataCompleteness.volumePercent) })} />
      </div>

      <IngestionHealth summary={summary} />

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-blue-600" />
            <div>
              <h2 className="font-semibold text-slate-950">{t('ops_an_daily_searches')}</h2>
              <p className="mt-1 text-xs text-slate-500">{t('ops_an_daily_searches_desc')}</p>
            </div>
          </div>
          <div className="text-right text-xs leading-5 text-slate-500">
            <p>{t('ops_an_period_total')} <strong className="text-slate-800">{t('ops_an_unit_cases', { value: trendTotal.toLocaleString('ko-KR') })}</strong> · {t('ops_an_daily_avg')} <strong className="text-slate-800">{t('ops_an_unit_cases', { value: (trendTotal / days).toFixed(1) })}</strong></p>
            {peak && <p>{t('ops_an_peak_day', { date: trendDateLabel(peak.date, t).short, value: peak.searches.toLocaleString('ko-KR') })}</p>}
          </div>
        </div>
        {trendTotal === 0 ? (
          <p className="mt-6 rounded-lg bg-slate-50 py-10 text-center text-sm text-slate-500">{t('ops_an_no_searches_period')}</p>
        ) : (
          <div className="mt-5 overflow-x-auto pb-2">
            <div
              className={`flex h-56 items-end ${density === 'regular' ? 'gap-2' : density === 'compact' ? 'gap-1' : 'gap-0.5'}`}
              style={{ minWidth: `${Math.max(540, trend.length * columnWidth)}px` }}
            >
              {trend.map((point, index) => {
                const date = trendDateLabel(point.date, t)
                const title = `${t('ops_an_trend_title', { date: date.long, count: point.searches })}${point.noResults > 0 ? t('ops_an_trend_title_noresult', { count: point.noResults }) : ''}`
                const showDate = (trend.length - 1 - index) % labelEvery === 0
                return (
                  <div
                    key={point.date}
                    className={`group flex h-full flex-1 flex-col items-center justify-end ${density === 'regular' ? 'min-w-12' : density === 'compact' ? 'min-w-5' : 'min-w-2'}`}
                    title={title}
                  >
                    {density === 'regular'
                      ? <span className="mb-2 text-xs font-semibold tabular-nums text-slate-800">{t('ops_an_unit_cases', { value: point.searches.toLocaleString('ko-KR') })}</span>
                      : <span className="sr-only">{title}</span>}
                    <div className={`flex h-36 w-full items-end justify-center bg-slate-50 ${density === 'regular' ? 'rounded-lg px-2' : 'rounded-sm px-px'}`}>
                      {point.searches > 0 ? (
                        <div
                          className={`w-full bg-blue-500 transition-colors group-hover:bg-blue-700 ${density === 'regular' ? 'max-w-9 rounded-t-md' : 'rounded-t-sm'}`}
                          style={{ height: `${Math.max(6, (point.searches / maxSearches) * 128)}px` }}
                        />
                      ) : (
                        <div className="h-0.5 w-full rounded-full bg-slate-200" />
                      )}
                    </div>
                    <time
                      dateTime={point.date}
                      aria-hidden={density === 'regular' ? undefined : true}
                      className={`mt-2 whitespace-nowrap text-2xs font-medium tabular-nums text-slate-600 ${showDate ? '' : 'invisible'}`}
                    >
                      {date.short}
                    </time>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function ConfusionComponents({ item }: { item: AnalyticsSearchItem }) {
  const { t } = useTranslation()
  const components = [
    ['ops_an_conf_no_result', item.components.noResultRate],
    ['ops_an_conf_reformulated', item.components.reformulationRate],
    ['ops_an_conf_scan_corrected', item.components.scanCorrectionRate],
    ['ops_an_conf_unresolved', item.components.unresolvedRate],
  ] as const
  return (
    <div className="grid gap-1 text-2xs text-slate-600">
      {components.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3"><span>{t(label)}</span><span className="font-medium text-slate-900">{asPercent(value)}</span></div>
      ))}
    </div>
  )
}

function QueryVariants({ query, variants }: { query: string; variants: string[] }) {
  const { t } = useTranslation()
  const seen = new Set([query.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR')])
  const useful = variants.filter((variant) => {
    const key = variant.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR')
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (useful.length === 0) return null
  const visible = useful.slice(0, 3)
  return (
    <div className="mt-1 max-w-xs text-xs leading-5 text-slate-500">
      {t('ops_an_variants', { list: visible.join(' · ') })}{useful.length > visible.length ? t('ops_an_variants_more', { count: useful.length - visible.length }) : ''}
    </div>
  )
}

const EVENT_WINDOW_COPY: Record<SearchEventWindow, { key: string; count: (item: AnalyticsSearchItem) => number }> = {
  7: { key: 'ops_an_events_7d', count: (item) => item.events7d },
  30: { key: 'ops_an_events_30d', count: (item) => item.events30d },
  90: { key: 'ops_an_events_90d', count: (item) => item.events90d },
}

function SearchPeriodCounts({ item, windows }: { item: AnalyticsSearchItem; windows: SearchEventWindow[] }) {
  const { t } = useTranslation()
  if (windows.length === 0) return <span className="text-slate-400">—</span>
  return (
    <>
      {windows.map((window) => (
        <span key={window} className="block">{t(EVENT_WINDOW_COPY[window].key, { count: EVENT_WINDOW_COPY[window].count(item) })}</span>
      ))}
    </>
  )
}

function ConfusionScoreBadge({ score }: { score: number }) {
  const { t } = useTranslation()
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 font-semibold ${score >= 50 ? 'bg-red-50 text-red-700' : score >= 25 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
      {t('ops_an_score', { value: score.toFixed(1) })}
    </span>
  )
}

function SearchesPanel({
  demandItems,
  confusionItems,
  days,
}: {
  demandItems: AnalyticsSearchItem[]
  confusionItems: AnalyticsSearchItem[]
  days: number
}) {
  const { t } = useTranslation()
  const [ranking, setRanking] = useState<'demand' | 'confusion'>('demand')
  const items = ranking === 'demand' ? demandItems : confusionItems
  // Counts for windows longer than the selected period are cut to the period, so hide them.
  const windows = searchEventWindows(days)
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="font-semibold text-slate-950">{t('ops_an_searches_heading')}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">{t('ops_an_confusion_note')}</p>
        </div>
        <div className="flex rounded-lg border border-slate-200 p-1 text-xs font-medium">
          <button type="button" aria-pressed={ranking === 'demand'} onClick={() => setRanking('demand')} className={`rounded-md px-3 py-1.5 ${ranking === 'demand' ? 'bg-slate-950 text-white' : 'text-slate-600'}`}>{t('ops_an_rank_demand')}</button>
          <button type="button" aria-pressed={ranking === 'confusion'} onClick={() => setRanking('confusion')} className={`rounded-md px-3 py-1.5 ${ranking === 'confusion' ? 'bg-slate-950 text-white' : 'text-slate-600'}`}>{t('ops_an_rank_confusion')}</button>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-slate-500">{t('ops_an_no_search_data')}</p>
      ) : (
        <>
          {/* Narrow screens: one card per query instead of a 1100px table. */}
          <ul className="divide-y divide-slate-100 md:hidden">
            {items.map((item) => (
              <li key={item.normalizedQuery} className="space-y-3 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="break-words font-medium text-slate-950">{item.query}</div>
                    <QueryVariants query={item.query} variants={item.variants} />
                  </div>
                  <div className="shrink-0 text-sm"><ConfusionScoreBadge score={item.confusionScore} /></div>
                </div>
                {item.smallSample && <SmallSampleBadge />}
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-slate-500">{t('ops_an_th_volume')}</dt>
                    <dd className="mt-0.5 text-base font-semibold text-slate-950">{t('ops_an_unit_cases', { value: item.demandIndex.toLocaleString('ko-KR') })}</dd>
                    <dd className="text-slate-500">{t('ops_an_searched_by', { count: item.uniqueSubjects })}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">{t('ops_an_th_period')}</dt>
                    <dd className="mt-0.5 leading-5 text-slate-700"><SearchPeriodCounts item={item} windows={windows} /></dd>
                  </div>
                </dl>
                <p className="text-xs text-slate-500">{t('ops_an_err_counts', { noResult: item.noResultCount, technical: item.technicalErrorCount })}</p>
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-500">{t('ops_an_th_causes')}</p>
                  <ConfusionComponents item={item} />
                </div>
                <div className="text-xs leading-5 text-slate-600">
                  <p className="font-medium text-slate-500">{t('ops_an_th_resolved')}</p>
                  <p>{item.resolvedStandards.map(koreanChemicalDisplayName).join(' · ') || t('ops_an_no_resolution_yet')}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('ops_an_th_query')}</th>
                  <th className="px-4 py-3 font-medium">{t('ops_an_th_volume')}</th>
                  <th className="px-4 py-3 font-medium">{t('ops_an_th_period')}</th>
                  <th className="px-4 py-3 font-medium">{t('ops_an_th_confusion')}</th>
                  <th className="px-4 py-3 font-medium">{t('ops_an_th_causes')}</th>
                  <th className="px-4 py-3 font-medium">{t('ops_an_th_resolved')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.normalizedQuery} className="align-top">
                    <td className="px-4 py-4">
                      <div className="font-medium text-slate-950">{item.query}</div>
                      <QueryVariants query={item.query} variants={item.variants} />
                      {item.smallSample && <div className="mt-2"><SmallSampleBadge /></div>}
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-lg font-semibold text-slate-950">{t('ops_an_unit_cases', { value: item.demandIndex.toLocaleString('ko-KR') })}</div>
                      <div className="text-xs text-slate-500">{t('ops_an_searched_by', { count: item.uniqueSubjects })}</div>
                    </td>
                    <td className="px-4 py-4 text-xs leading-5 text-slate-700"><SearchPeriodCounts item={item} windows={windows} /></td>
                    <td className="px-4 py-4">
                      <ConfusionScoreBadge score={item.confusionScore} />
                      <div className="mt-1 text-xs text-slate-500">{t('ops_an_err_counts', { noResult: item.noResultCount, technical: item.technicalErrorCount })}</div>
                    </td>
                    <td className="px-4 py-4"><ConfusionComponents item={item} /></td>
                    <td className="px-4 py-4 text-xs leading-5 text-slate-600">{item.resolvedStandards.map(koreanChemicalDisplayName).join(' · ') || t('ops_an_no_resolution_yet')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

function KeyValueList({
  value,
  labels,
  fallback,
}: {
  value: Record<string, number>
  labels: OpsAnalyticsLabelMap
  fallback: string
}) {
  const { t } = useTranslation()
  const entries = Object.entries(value).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return <span>{t('ops_an_none')}</span>
  return (
    <span>
      {entries.map(([key, count], index) => (
        <span key={key}>
          {index > 0 && ' · '}{opsAnalyticsLabel(key, labels, fallback)} {count}
        </span>
      ))}
    </span>
  )
}

function MixturesPanel({ data }: { data: AnalyticsMixtures }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={t('ops_an_m_15')} value={t('ops_an_unit_cases', { value: data.excludedStates.separate.toLocaleString('ko-KR') })} detail={t('ops_an_m_16')} />
        <MetricCard label={t('ops_an_m_17')} value={t('ops_an_unit_cases', { value: data.excludedStates.unknown.toLocaleString('ko-KR') })} detail={t('ops_an_m_16')} />
        <MetricCard label={t('ops_an_m_18')} value={asPercent(data.handlingSummary.isolatedRate)} detail={t('ops_an_of_total', { total: data.handlingSummary.total, count: data.handlingSummary.isolated })} />
        <MetricCard label={t('ops_an_m_19')} value={asPercent(data.handlingSummary.handoverRate)} detail={t('ops_an_of_total', { total: data.handlingSummary.total, count: data.handlingSummary.handover })} />
      </div>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-950">{t('ops_an_mixed_heading')}</h2>
          <p className="mt-1 text-xs text-slate-500">{t('ops_an_mixed_note')}</p>
        </div>
        <div className="divide-y divide-slate-100">
          {data.pairs.map((pair) => (
            <article key={`${pair.componentAKey}|${pair.componentBKey}`} className="grid gap-4 p-5 lg:grid-cols-[1.2fr_.7fr_1.3fr]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-slate-950">
                    {koreanChemicalDisplayName(pair.componentAName)} + {koreanChemicalDisplayName(pair.componentBName)}
                  </h3>
                  {pair.smallSample && <SmallSampleBadge />}
                </div>
                <p className="mt-2 break-all text-xs text-slate-500">
                  {canonicalComponentDisplayKey(pair.componentAKey)} · {canonicalComponentDisplayKey(pair.componentBKey)}
                </p>
                {pair.hazardFlags.length > 0 && (
                  <p className="mt-2 text-xs font-medium text-red-700">
                    {t('ops_an_hazard_flags', { list: pair.hazardFlags.map((flag) => opsAnalyticsLabel(flag, HAZARD_FLAG_LABELS, t('ops_an_other_hazard'))).join(', ') })}
                  </p>
                )}
              </div>
              <div className="text-sm text-slate-600">
                <p>{t('ops_an_pair_counts', { batches: pair.batchCount, users: pair.uniqueUsers, labs: pair.uniqueLabs > 0 ? t('ops_an_labs_count', { count: pair.uniqueLabs }) : t('ops_an_labs_unknown') })}</p>
                <p className="mt-1">{t('ops_an_search_linked', { count: pair.searchLinkedBatchCount })}</p>
              </div>
              <div className="space-y-1 text-xs leading-5 text-slate-600">
                <p>{t('ops_an_final_ph')}: <DistributionText value={pair.phDistribution} compact={pair.smallSample} /></p>
                <p>{t('ops_an_total_volume')}: <DistributionText value={pair.volumeDistributionMl} suffix="mL" compact={pair.smallSample} /></p>
                {Object.entries(pair.concentrationDistributions).map(([unit, distribution]) => (
                  <p key={unit}>{t('ops_an_concentration')} ({unit}): <DistributionText value={distribution} compact={pair.smallSample} /></p>
                ))}
                <p>{t('ops_an_matrix')}: <KeyValueList value={pair.matrices} labels={MATRIX_LABELS} fallback={t('ops_an_unclassified')} /></p>
                <p>{t('ops_an_stream')}: <KeyValueList value={pair.streams} labels={WASTE_STREAM_LABELS} fallback={t('ops_an_unclassified')} /></p>
                <p>{t('ops_an_handling')}: <KeyValueList value={pair.actions} labels={HANDLING_ACTION_LABELS} fallback={t('ops_an_other_handling')} /></p>
              </div>
            </article>
          ))}
          {data.pairs.length === 0 && <p className="p-10 text-center text-sm text-slate-500">{t('ops_an_no_mixed')}</p>}
        </div>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-950">{t('ops_an_multi_heading')}</h2>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {data.combinations.map((combination) => (
            <div key={combination.key} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex items-start justify-between gap-3"><span className="font-medium text-slate-900">{koreanChemicalDisplayName(combination.name)}</span><span className="shrink-0 text-slate-600">{t('ops_an_unit_cases', { value: combination.batchCount })}</span></div>
              {combination.smallSample && <div className="mt-2"><SmallSampleBadge /></div>}
            </div>
          ))}
          {data.combinations.length === 0 && <p className="text-sm text-slate-500">{t('ops_an_no_multi')}</p>}
        </div>
      </section>
    </div>
  )
}

function DecidedReviewRow({ item }: { item: AnalyticsReviewCandidate }) {
  const { t, i18n } = useTranslation()
  const approved = item.status === 'approved'
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium text-slate-900">{koreanReviewDisplayText(item.title)}</h2>
            <span className="rounded-full bg-blue-50 px-2 py-1 text-2xs font-medium text-blue-700">{REVIEW_TYPE_LABELS[item.candidate_type]}</span>
            <span className={`rounded-full px-2 py-1 text-2xs font-semibold ring-1 ${approved ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-700 ring-slate-200'}`}>
              {approved ? t('ops_an_review_status_approved') : t('ops_an_review_status_rejected')}
            </span>
          </div>
          {item.proposed_alias && <p className="mt-2 text-xs text-slate-600">{t('ops_an_alias')} <strong>{item.proposed_alias}</strong> → {item.canonical_name ? koreanChemicalDisplayName(item.canonical_name) : t('ops_an_standard_name_tbd')} {item.canonical_cas ? `(CAS ${item.canonical_cas})` : ''}</p>}
          {item.review_notes && <p className="mt-2 break-words text-sm leading-6 text-slate-600">{item.review_notes}</p>}
        </div>
        {item.reviewed_at && (
          <time dateTime={item.reviewed_at} className="text-xs text-slate-500">
            {t('ops_an_reviewed_on', { value: new Date(item.reviewed_at).toLocaleDateString(i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US') })}
          </time>
        )}
      </div>
    </article>
  )
}

function ReviewPanel({
  items,
  filter,
  hasMore,
  loadingMore,
  onLoadMore,
  onDecision,
  decidingIds,
}: {
  items: AnalyticsReviewCandidate[]
  filter: ReviewFilter
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onDecision: (item: AnalyticsReviewCandidate, status: 'approved' | 'rejected', draft: ReviewDraft) => Promise<void>
  /** Candidates with a decision in flight. A set, so deciding one candidate never re-enables another. */
  decidingIds: ReadonlySet<string>
}) {
  const { t, i18n } = useTranslation()
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({})
  // Candidates decided on this screen drop out of the pending view right away.
  const visible = filter === 'pending' ? items.filter((item) => item.status === 'pending') : items
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        {t('ops_an_review_note')}
      </div>
      {visible.map((item) => {
        if (item.status !== 'pending') return <DecidedReviewRow key={item.id} item={item} />
        const draft = drafts[item.id] || {
          notes: '',
          evidenceReference: '',
          proposedAlias: item.proposed_alias || '',
          canonicalName: item.canonical_name || '',
          canonicalCas: item.canonical_cas || '',
        }
        const setDraft = (next: Partial<typeof draft>) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, ...next } }))
        const deciding = decidingIds.has(item.id)
        return (
          <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-slate-950">{koreanReviewDisplayText(item.title)}</h2>
                  <span className="rounded-full bg-blue-50 px-2 py-1 text-2xs font-medium text-blue-700">{REVIEW_TYPE_LABELS[item.candidate_type]}</span>
                  <span className="text-xs text-slate-500">{t('ops_an_related_records', { count: item.sample_count })}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{koreanReviewDisplayText(item.summary)}</p>
                {item.proposed_alias && <p className="mt-2 text-xs text-slate-600">{t('ops_an_alias')} <strong>{item.proposed_alias}</strong> → {item.canonical_name ? koreanChemicalDisplayName(item.canonical_name) : t('ops_an_standard_name_tbd')} {item.canonical_cas ? `(CAS ${item.canonical_cas})` : ''}</p>}
              </div>
              <time className="text-xs text-slate-500">{t('ops_an_candidate_created', { value: new Date(item.created_at).toLocaleDateString(i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US') })}</time>
            </div>
            {item.candidate_type === 'search_alias' && (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <label className="text-xs font-medium text-slate-600">{t('ops_an_lbl_alias')}
                  <input value={draft.proposedAlias} onChange={(event) => setDraft({ proposedAlias: event.target.value })} maxLength={200} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-500" />
                </label>
                <label className="text-xs font-medium text-slate-600">{t('ops_an_lbl_std_name')}
                  <input value={draft.canonicalName} onChange={(event) => setDraft({ canonicalName: event.target.value })} maxLength={300} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-500" placeholder={t('ops_an_ph_verify')} />
                </label>
                <label className="text-xs font-medium text-slate-600">{t('ops_an_lbl_std_cas')}
                  <input value={draft.canonicalCas} onChange={(event) => setDraft({ canonicalCas: event.target.value })} maxLength={32} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-500" placeholder={t('ops_an_ph_cas')} />
                </label>
              </div>
            )}
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-xs font-medium text-slate-600">{t('ops_an_lbl_notes')}
                <textarea value={draft.notes} onChange={(event) => setDraft({ notes: event.target.value })} maxLength={4000} rows={3} className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-blue-500" placeholder={t('ops_an_ph_notes')} />
              </label>
              <label className="text-xs font-medium text-slate-600">{t('ops_an_lbl_evidence')}
                <input value={draft.evidenceReference} onChange={(event) => setDraft({ evidenceReference: event.target.value })} maxLength={1000} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-500" placeholder={t('ops_an_ph_evidence')} />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={deciding} onClick={() => void onDecision(item, 'rejected', draft)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><X className="h-4 w-4" /> {t('ops_an_reject')}</button>
              <button type="button" disabled={deciding || (item.candidate_type === 'search_alias' && (!draft.proposedAlias.trim() || !draft.canonicalName.trim()))} onClick={() => void onDecision(item, 'approved', draft)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">{deciding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t('ops_an_approve')}</button>
            </div>
          </article>
        )
      })}
      {visible.length === 0 && !hasMore && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          {filter === 'pending' ? t('ops_an_no_candidates') : t('ops_an_no_candidates_all')}
        </div>
      )}
      {hasMore && (
        <div className="flex justify-center">
          <button type="button" disabled={loadingMore} onClick={onLoadMore} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} {t('ops_an_load_more')}
          </button>
        </div>
      )}
    </div>
  )
}

function ExportPanel() {
  const { t } = useTranslation()
  const reasonHintId = useId()
  const today = useMemo(() => new Date(), [])
  const initialFrom = useMemo(() => {
    const date = new Date(today)
    date.setDate(date.getDate() - 29)
    return dateInputValue(date)
  }, [today])
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(dateInputValue(today))
  // No default reason: the audit log needs the operator's own words for each export.
  const [reason, setReason] = useState('')
  const [outcome, setOutcome] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [problem, setProblem] = useState<OpsAccessProblem | null>(null)
  const reasonTooShort = reason.trim().length < 5

  const runExport = async () => {
    setBusy(true)
    setMessage(null)
    setProblem(null)
    try {
      const result = await exportAnalyticsCsv({
        from: startOfKstDate(from),
        to: dayAfterKstDate(to),
        reason,
        ...(outcome ? { outcome } : {}),
      })
      const url = URL.createObjectURL(result.blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = result.filename
      anchor.click()
      URL.revokeObjectURL(url)
      setMessage(t('ops_an_export_done'))
    } catch (error) {
      const accessProblem = getOpsAccessProblem(error)
      if (accessProblem) setProblem(accessProblem)
      else setMessage(error instanceof Error ? error.message : t('ops_an_export_failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2"><Download className="h-5 w-5 text-blue-600" /><h2 className="font-semibold text-slate-950">{t('ops_an_export_heading')}</h2></div>
      <p className="mt-2 text-xs leading-5 text-slate-500">{t('ops_an_export_note')}</p>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <label className="text-xs font-medium text-slate-600">{t('ops_an_start_date')}<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /></label>
        <label className="text-xs font-medium text-slate-600">{t('ops_an_end_date')}<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /></label>
        <label className="text-xs font-medium text-slate-600">{t('ops_an_search_result')}<select value={outcome} onChange={(event) => setOutcome(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"><option value="">{t('ops_an_all')}</option>{Object.entries(SEARCH_OUTCOME_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div>
          <label className="block text-xs font-medium text-slate-600">{t('ops_an_export_reason')}
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={1000}
              required
              aria-describedby={reasonHintId}
              placeholder={t('ops_an_export_reason_ph')}
              className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal text-slate-900"
            />
          </label>
          <p id={reasonHintId} className="mt-1 text-xs text-slate-500">{t('ops_an_export_reason_hint')}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">{t('ops_an_export_no_pii')}</p>
        <button type="button" disabled={busy || reasonTooShort || !from || !to} onClick={() => void runExport()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {t('ops_an_export_csv')}</button>
      </div>
      {problem && <div className="mt-3"><OpsAccessNotice compact problem={problem} requiredRole="raw_exporter" onRetry={reasonTooShort || busy ? undefined : () => void runExport()} /></div>}
      {message && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{message}</p>}
    </section>
  )
}

/**
 * External provision stays blocked until every gate is done, so the blocked state is one quiet
 * line with the detail behind a toggle. If it is ever enabled, the full panel shows in red.
 */
function ExternalProvisionStatus({ commercialization }: { commercialization: AnalyticsGovernance['commercialization'] }) {
  const { t } = useTranslation()
  const detailId = useId()
  const [expanded, setExpanded] = useState(false)
  const enabled = commercialization.externalProductEnabled
  const gates = [
    { label: t('ops_an_gate_agreement'), ready: commercialization.institutionDataAgreementReady },
    { label: t('ops_an_gate_reid'), ready: commercialization.reidentificationRiskReviewReady },
    { label: t('ops_an_gate_legal'), ready: commercialization.legalReviewReady },
  ]
  const showDetail = enabled || expanded
  return (
    <section className={`rounded-xl border ${enabled ? 'border-red-300 bg-red-50 p-5' : 'border-emerald-200 bg-emerald-50 px-4 py-3'}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {enabled
          ? <ShieldAlert className="h-6 w-6 shrink-0 text-red-700" aria-hidden="true" />
          : <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />}
        <h2 className={`min-w-0 font-semibold text-slate-950 ${enabled ? '' : 'text-sm'}`}>
          {t('ops_an_external_data', { state: enabled ? t('ops_an_allowed') : t('ops_an_blocked') })}
        </h2>
        {!enabled && (
          <span className="text-xs text-slate-600">
            {t('ops_an_external_gates_progress', { done: gates.filter((gate) => gate.ready).length, total: gates.length })}
          </span>
        )}
        {!enabled && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={detailId}
            onClick={() => setExpanded((current) => !current)}
            className="ml-auto inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
          >
            {expanded ? t('ops_an_details_hide') : t('ops_an_details_show')}
            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
        )}
      </div>
      {/* Always in the DOM so the toggle's aria-controls points at a real element. */}
      <div id={detailId} hidden={!showDetail} className={enabled ? 'mt-1 pl-9' : 'mt-2'}>
        <p className="text-sm leading-6 text-slate-700">{t('ops_an_external_note')}</p>
        <div className="mt-3 grid gap-2 text-xs text-slate-700 sm:grid-cols-3">
          <p className="rounded-lg bg-white/70 px-3 py-2">{t('ops_an_search_threshold')}<br /><strong>{t('ops_an_threshold_values', { count: commercialization.searchThreshold.events, users: commercialization.searchThreshold.users, labs: commercialization.searchThreshold.labs })}</strong></p>
          <p className="rounded-lg bg-white/70 px-3 py-2">{t('ops_an_mixture_threshold')}<br /><strong>{t('ops_an_threshold_values', { count: commercialization.mixtureThreshold.batches, users: commercialization.mixtureThreshold.users, labs: commercialization.mixtureThreshold.labs })}</strong></p>
          <p className="rounded-lg bg-white/70 px-3 py-2">{t('ops_an_agg_unit')}<br /><strong>{t('ops_an_monthly_only')}</strong></p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {gates.map((gate) => (
            <span key={gate.label} className={`rounded-full px-2.5 py-1 font-medium ${gate.ready ? 'bg-emerald-100 text-emerald-800' : 'bg-white/70 text-slate-600 ring-1 ring-slate-200'}`}>
              {gate.label}: {gate.ready ? t('ops_an_done') : t('ops_an_not_done')}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

function GovernancePanel({ governance }: { governance: AnalyticsGovernance }) {
  const { t, i18n } = useTranslation()
  const expiringGuestDetail = governance.collection.guestEventsExpiringIn7Days > 0
    ? t('ops_an_guest_expiring', { count: governance.collection.guestEventsExpiringIn7Days })
    : t('ops_an_guest_none_expiring')
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={t('ops_an_m_20')} value={t('ops_an_unit_cases', { value: governance.collection.authenticatedEvents.toLocaleString('ko-KR') })} />
        <MetricCard label={t('ops_an_m_21')} value={t('ops_an_unit_cases', { value: governance.collection.guestEvents.toLocaleString('ko-KR') })} detail={expiringGuestDetail} />
        <MetricCard label={t('ops_an_m_22')} value={t('ops_an_unit_cases', { value: governance.deletions.requestCount.toLocaleString('ko-KR') })} detail={t('ops_an_deleted_detail', { events: governance.deletions.deletedEvents, actions: governance.deletions.deletedActions })} />
        <MetricCard label={t('ops_an_m_23')} value={t('ops_an_unit_times', { value: governance.exports.count.toLocaleString('ko-KR') })} detail={governance.exports.lastExportAt ? t('ops_an_last_export', { value: new Date(governance.exports.lastExportAt).toLocaleString(i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US') }) : t('ops_an_no_export_yet')} />
      </div>
      <ExternalProvisionStatus commercialization={governance.commercialization} />
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard label={t('ops_an_m_24')} value={t('ops_an_unit_items', { value: governance.monthlyRollups.externalSearchCells.toLocaleString('ko-KR') })} detail={t('ops_an_rollup_search', { value: governance.monthlyRollups.searchCells.toLocaleString('ko-KR') })} />
        <MetricCard label={t('ops_an_m_25')} value={t('ops_an_unit_items', { value: governance.monthlyRollups.externalMixtureCells.toLocaleString('ko-KR') })} detail={t('ops_an_rollup_mixture', { value: governance.monthlyRollups.mixtureCells.toLocaleString('ko-KR') })} />
        <MetricCard label={t('ops_an_m_26')} value={t('ops_an_unit_cases', { value: governance.reviews.pending.toLocaleString('ko-KR') })} detail={t('ops_an_review_detail', { approved: governance.reviews.approved, rejected: governance.reviews.rejected })} />
      </div>
      <ExportPanel />
    </div>
  )
}

export function OpsAnalyticsView() {
  const { t, i18n } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = parseTab(searchParams.get('tab'))
  const [days, setDays] = useState<AnalyticsPeriod>(30)
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('pending')
  const [consoleProblem, setConsoleProblem] = useState<OpsAccessProblem | null>(null)
  const [decidingIds, setDecidingIds] = useState<ReadonlySet<string>>(() => new Set())
  // Synchronous guard: a fast double click must not send a second decision before the re-render.
  const decidingRef = useRef(new Set<string>())
  const [loadingMoreFilter, setLoadingMoreFilter] = useState<ReviewFilter | null>(null)
  const { showToast, toastElement } = useActionToast({ appearance: 'light' })
  const { entries: summaryEntries, run: runSummary, update: updateSummaries, drop: dropSummaries } = useResourceCache<SummaryPayload>()
  const { entries: searchEntries, run: runSearches, drop: dropSearches } = useResourceCache<SearchesPayload>()
  const { entries: mixtureEntries, run: runMixtures, drop: dropMixtures } = useResourceCache<AnalyticsMixtures>()
  const { entries: reviewEntries, run: runReviews, update: updateReviews, drop: dropReviews } = useResourceCache<ReviewsPayload>()

  const resource = TAB_RESOURCE[tab]
  const usesDateRange = tab === 'overview' || tab === 'searches' || tab === 'mixtures'
  const periodKey = String(days)
  const summaryEntry = summaryEntries[periodKey]
  const searchEntry = searchEntries[periodKey]
  const mixtureEntry = mixtureEntries[periodKey]
  const reviewEntry = reviewEntries[reviewFilter]
  const activeEntry: ResourceEntry<unknown> | undefined = resource === 'summary'
    ? summaryEntry
    : resource === 'searches' ? searchEntry : resource === 'mixtures' ? mixtureEntry : reviewEntry
  const hasActiveEntry = activeEntry !== undefined
  const activeLoading = activeEntry?.loading === true
  const activeLoadedAt = activeEntry?.value?.loadedAt

  const reportLoadError = useCallback((error: unknown, target: AnalyticsResource) => {
    const problem = getOpsAccessProblem(error)
    if (!problem) return
    // Sign-in, MFA and access-review refusals apply to the whole console, and an uncoded refusal
    // of the core data means this account cannot use the screen. A refusal of only the review
    // list (it needs the approver role, whose monthly review is kept apart) stays inside that tab.
    if (target === 'reviews' && problem.issue === 'review_required') return
    if (isConsoleWideAccessIssue(problem.issue) || (problem.issue === 'denied' && target !== 'reviews')) {
      setConsoleProblem(problem)
    }
  }, [])

  /** Loads only what one tab needs. Overview and governance share the summary call. */
  const loadTab = useCallback(async (target: AnalyticsTab, period: AnalyticsPeriod, filter: ReviewFilter) => {
    const targetResource = TAB_RESOURCE[target]
    const key = String(period)
    let error: unknown = null
    if (targetResource === 'summary') {
      error = await runSummary(key, () => loadAnalyticsSummary(period))
    } else if (targetResource === 'searches') {
      error = await runSearches(key, async () => {
        const [demand, confusion] = await Promise.all([
          loadAnalyticsSearches(period, 100, 'demand'),
          loadAnalyticsSearches(period, 100, 'confusion'),
        ])
        return { demand, confusion }
      })
    } else if (targetResource === 'mixtures') {
      error = await runMixtures(key, () => loadAnalyticsMixtures(period))
    } else {
      error = await runReviews(filter, () => loadAnalyticsReviews(null, REVIEW_PAGE_SIZE, filter === 'pending' ? 'pending' : null))
    }
    if (error) reportLoadError(error, targetResource)
  }, [reportLoadError, runMixtures, runReviews, runSearches, runSummary])

  // Fetch the active tab's data the first time it is shown for this period or filter.
  useEffect(() => {
    if (consoleProblem || hasActiveEntry) return
    void loadTab(tab, days, reviewFilter)
  }, [consoleProblem, days, hasActiveEntry, loadTab, reviewFilter, tab])

  const refreshActiveTab = () => { void loadTab(tab, days, reviewFilter) }

  const retryAfterAccessProblem = () => {
    dropSummaries(dropFailedWithoutData)
    dropSearches(dropFailedWithoutData)
    dropMixtures(dropFailedWithoutData)
    dropReviews(dropFailedWithoutData)
    setConsoleProblem(null)
    void loadTab(tab, days, reviewFilter)
  }

  const selectTab = (next: AnalyticsTab) => {
    // Replace, not push: switching sub-tabs should not fill the back button history.
    setSearchParams((current) => {
      const params = new URLSearchParams(current)
      if (next === DEFAULT_TAB) params.delete('tab')
      else params.set('tab', next)
      return params
    }, { replace: true })
  }

  const loadMoreReviews = async () => {
    const filter = reviewFilter
    const cursor = reviewEntries[filter]?.value?.data.nextCursor
    if (!cursor || loadingMoreFilter) return
    setLoadingMoreFilter(filter)
    try {
      const page = await loadAnalyticsReviews(cursor, REVIEW_PAGE_SIZE, filter === 'pending' ? 'pending' : null)
      updateReviews((data, key) => {
        if (key !== filter) return data
        const known = new Set(data.items.map((item) => item.id))
        return { items: [...data.items, ...page.items.filter((item) => !known.has(item.id))], nextCursor: page.nextCursor }
      })
    } catch (error) {
      const problem = getOpsAccessProblem(error)
      // An overdue review of the approver role stays with the review list, like its first page.
      if (problem && problem.issue !== 'review_required' && isConsoleWideAccessIssue(problem.issue)) setConsoleProblem(problem)
      else showToast(problem ? accessProblemMessage(problem, t, RESOURCE_ROLE.reviews) : t('ops_an_load_failed'), { tone: 'error' })
    } finally {
      setLoadingMoreFilter(null)
    }
  }

  const decide = async (item: AnalyticsReviewCandidate, status: 'approved' | 'rejected', draft: ReviewDraft) => {
    if (decidingRef.current.has(item.id)) return
    decidingRef.current.add(item.id)
    setDecidingIds(new Set(decidingRef.current))
    try {
      const updated = await decideAnalyticsReview({
        candidateId: item.id,
        status,
        notes: draft.notes,
        evidence: draft.evidenceReference.trim() ? { operatorReference: draft.evidenceReference.trim() } : {},
        proposedAlias: draft.proposedAlias.trim() || null,
        canonicalName: draft.canonicalName.trim() || null,
        canonicalCas: draft.canonicalCas.trim() || null,
      })
      updateReviews((data) => ({
        ...data,
        items: data.items.map((candidate) => candidate.id === item.id ? { ...candidate, ...updated, status: updated.status || status } : candidate),
      }))
      updateSummaries((data) => ({
        ...data,
        governance: {
          ...data.governance,
          reviews: {
            ...data.governance.reviews,
            pending: Math.max(0, data.governance.reviews.pending - 1),
            [status]: data.governance.reviews[status] + 1,
          },
        },
      }))
      showToast(status === 'approved' ? t('ops_an_review_approved') : t('ops_an_review_rejected'))
    } catch (decisionError) {
      const alreadyDecided = isAnalyticsReviewAlreadyDecided(decisionError)
      if (alreadyDecided || (decisionError instanceof InternalApiError && decisionError.status === 404)) {
        // Someone else decided (or removed) it first: reload this list and let other cached
        // review views and the governance counts reload on their next visit.
        showToast(alreadyDecided ? t('ops_an_review_already_decided') : t('ops_an_review_not_found'), { tone: 'info' })
        dropReviews((key) => key !== reviewFilter)
        dropSummaries(() => true)
        void loadTab('reviews', days, reviewFilter)
        return
      }
      const problem = getOpsAccessProblem(decisionError)
      // An overdue review of the approver role refuses only decisions; the other tabs still work.
      if (problem && problem.issue !== 'review_required' && isConsoleWideAccessIssue(problem.issue)) {
        setConsoleProblem(problem)
        return
      }
      const message = problem
        ? accessProblemMessage(problem, t, RESOURCE_ROLE.reviews)
        : decisionError instanceof InternalApiError && decisionError.status === 400
          ? t('ops_an_decision_invalid')
          : t('ops_an_decision_failed')
      showToast(message, { tone: 'error' })
    } finally {
      decidingRef.current.delete(item.id)
      setDecidingIds(new Set(decidingRef.current))
    }
  }

  // Only the reader calls (summary, searches, mixtures) reach here with an overdue review, so that is the role to renew.
  if (consoleProblem) return <OpsAccessNotice problem={consoleProblem} requiredRole={RESOURCE_ROLE.summary} onRetry={retryAfterAccessProblem} />

  return (
    <div className="space-y-5 p-5 pb-16">
      {toastElement}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {usesDateRange && <p className="text-sm font-medium text-slate-700">{t('ops_an_range')}</p>}
        {tab === 'reviews' && (
          <div role="group" aria-label={t('ops_an_review_filter_label')} className="flex rounded-lg border border-slate-200 bg-white p-1">
            {(['pending', 'all'] as const).map((filter) => (
              <button key={filter} type="button" aria-pressed={reviewFilter === filter} onClick={() => setReviewFilter(filter)} className={`rounded-md px-3 py-1.5 text-xs font-medium ${reviewFilter === filter ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                {filter === 'pending' ? t('ops_an_review_status_pending') : t('ops_an_all')}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {usesDateRange && (
            <div role="group" aria-label={t('ops_an_range')} className="flex rounded-lg border border-slate-200 bg-white p-1">
              {PERIODS.map((period) => <button key={period} type="button" aria-pressed={days === period} onClick={() => setDays(period)} className={`rounded-md px-3 py-1.5 text-xs font-medium ${days === period ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{t('ops_an_days', { count: period })}</button>)}
            </div>
          )}
          {activeLoadedAt !== undefined && (
            <span className="text-xs tabular-nums text-slate-500">
              {t('ops_an_updated_at', { time: new Date(activeLoadedAt).toLocaleTimeString(i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US', { hour: '2-digit', minute: '2-digit' }) })}
            </span>
          )}
          <button type="button" disabled={activeLoading} onClick={refreshActiveTab} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">{activeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {t('ops_an_refresh')}</button>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm" aria-label={t('ops_an_nav_label')}>
        {TABS.map((item) => <button key={item.id} type="button" aria-current={tab === item.id ? 'page' : undefined} onClick={() => selectTab(item.id)} className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium ${tab === item.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{t(item.labelKey)}</button>)}
      </nav>
      {tab === 'overview' && (
        <ResourceView entry={summaryEntry} requiredRole={RESOURCE_ROLE.summary} onRetry={refreshActiveTab}>
          {(data, loadedAt) => <OverviewPanel summary={data.summary} days={days} loadedAt={loadedAt} />}
        </ResourceView>
      )}
      {tab === 'searches' && (
        <ResourceView entry={searchEntry} requiredRole={RESOURCE_ROLE.searches} onRetry={refreshActiveTab}>
          {(data) => <SearchesPanel demandItems={data.demand} confusionItems={data.confusion} days={days} />}
        </ResourceView>
      )}
      {tab === 'mixtures' && (
        <ResourceView entry={mixtureEntry} requiredRole={RESOURCE_ROLE.mixtures} onRetry={refreshActiveTab}>
          {(data) => <MixturesPanel data={data} />}
        </ResourceView>
      )}
      {tab === 'reviews' && (
        <ResourceView entry={reviewEntry} requiredRole={RESOURCE_ROLE.reviews} onRetry={refreshActiveTab}>
          {(data) => (
            <ReviewPanel
              items={data.items}
              filter={reviewFilter}
              hasMore={Boolean(data.nextCursor)}
              loadingMore={loadingMoreFilter === reviewFilter}
              onLoadMore={() => void loadMoreReviews()}
              onDecision={decide}
              decidingIds={decidingIds}
            />
          )}
        </ResourceView>
      )}
      {tab === 'governance' && (
        <ResourceView entry={summaryEntry} requiredRole={RESOURCE_ROLE.summary} onRetry={refreshActiveTab}>
          {(data) => <GovernancePanel governance={data.governance} />}
        </ResourceView>
      )}
      <div className="sr-only" aria-live="polite">{activeLoading && activeEntry?.value ? t('ops_an_refreshing') : ''}</div>
    </div>
  )
}
