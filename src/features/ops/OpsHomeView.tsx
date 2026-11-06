import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import { InboxQuietState, InboxRow } from '../../components/admin/InboxRow'
import { Sparkline } from '../../components/admin/Sparkline'
import { StatTile } from '../../components/admin/StatTile'
import type { SafetyCenterApprovalItem } from '../../services/opsAdminService'
import { isAnalyticsKpis, type AnalyticsKpis, type AnalyticsSummary } from '../../services/opsAnalyticsService'
import { OpsAccessNotice } from './OpsAccessNotice'
import {
  B2bKpiTiles,
  DefinitionsToggle,
  IngestionTile,
  MetricDefinitionList,
  NorthStarBody,
  ProductKpiTiles,
  SafetyKpiTiles,
  SmallSampleMark,
} from './OpsHomeKpis'
import type { OpsAccessIssue, OpsAccessProblem } from './opsAccess'
import { formatNumber, localeOf } from './kpiDisplay'
import { fillDailyTrend } from './opsAnalyticsLabels'
import {
  buildOpsInbox,
  describeRate,
  formatCappedCount,
  OPS_LIST_CAP,
  formatRate,
  isSmallSample,
  pickBlockingProblem,
  summarizeCenterStatuses,
  summarizePendingCenters,
  type OpsInboxTask,
  type OpsInboxTaskId,
} from './opsHomeTasks'
import {
  OPS_HOME_PERIODS,
  type OpsConsoleData,
  type OpsHomePeriod,
  type OpsSourceId,
  type OpsSourceState,
} from './useOpsConsoleData'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** Every home call is a `reader` action (OPERATOR_ACTIONS in functions/api/admin/feedback/_shared.ts). */
const HOME_ROLE = 'reader'

const TASK_SOURCE: Record<OpsInboxTaskId, OpsSourceId> = {
  centers: 'centers',
  feedback: 'feedback',
  reviews: 'summary',
}

/** Name of each inbox row when its source could not be loaded. */
const TASK_NAME_KEY: Record<OpsInboxTaskId, string> = {
  centers: 'ops_console_nav_centers',
  feedback: 'ops_console_nav_feedback',
  reviews: 'ops_an_tab_reviews',
}

const ACCESS_TITLE_KEY: Record<OpsAccessIssue, string> = {
  signed_out: 'ops_access_signed_out_title',
  mfa_required: 'ops_access_mfa_title',
  review_required: 'ops_access_review_title',
  role_required: 'ops_access_role_title',
  rate_limited: 'ops_access_rate_limited_title',
  denied: 'ops_access_denied_title',
}

function formatClock(value: number, language: string): string {
  return new Date(value).toLocaleTimeString(localeOf(language), {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** "11월 5일" on the Asia/Seoul calendar, like the waits in the inbox. */
function formatShortDate(value: string, language: string): string {
  return new Date(value).toLocaleDateString(localeOf(language), { month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' })
}

/** Phones (below Tailwind's sm) start with the goal groups folded, so the inbox and north star come first. */
function isNarrowViewport(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 639px)').matches
}

/**
 * "최장 N일 대기". From a capped list (`isLowerBound`) older items may be missing, so the age reads as
 * a minimum ("최장 N일 이상 대기") and a same-day age says nothing.
 */
function oldestLabel(days: number | null, isLowerBound: boolean, t: Translate): string | null {
  if (days === null) return null
  if (isLowerBound) return days > 0 ? t('ops_home_oldest_days_at_least', { count: days }) : null
  return days === 0 ? t('ops_home_oldest_today') : t('ops_home_oldest_days', { count: days })
}

/** Why a count from a full server page ends in "+". */
function cappedNote(t: Translate): string {
  return t('ops_home_capped_note', { value: OPS_LIST_CAP })
}

function RetryButton({ onClick, label }: { onClick: () => void; label?: string }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
    >
      <RefreshCw className="h-4 w-4" aria-hidden="true" />
      {t('ops_access_retry')}
      {label && <span className="sr-only"> · {label}</span>}
    </button>
  )
}

function LoadingBlock() {
  const { t } = useTranslation()
  return (
    <div role="status" className="flex min-h-[7rem] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-blue-600" aria-hidden="true" />
      <span className="sr-only">{t('loading')}</span>
    </div>
  )
}

/**
 * Why one card has no fresh data: the access refusal (role, rate limit) with its fix, or a plain
 * load error. Both retry only that card's call. `brief` is for a second card fed by the same call:
 * one line with a retry, so the fix (e.g. the MFA panel) is not shown twice.
 */
function SourceFailure({
  problem,
  message,
  onRetry,
  brief = false,
}: {
  problem: OpsAccessProblem | null
  message: string
  onRetry: () => void
  brief?: boolean
}) {
  const { t } = useTranslation()
  if (problem && !brief) return <OpsAccessNotice compact problem={problem} requiredRole={HOME_ROLE} onRetry={onRetry} />
  return (
    <div
      role={brief ? undefined : 'alert'}
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${problem
        ? 'border-amber-200 bg-amber-50 text-slate-800'
        : 'border-red-200 bg-red-50 text-red-800'}`}
    >
      <span className="min-w-0">{problem ? t(ACCESS_TITLE_KEY[problem.issue]) : message}</span>
      <RetryButton onClick={onRetry} />
    </div>
  )
}

/**
 * One goal group. Without KPIs it is the phase-1 group as it was. With KPIs (`definitions`) the title
 * folds the group (folded on phones at first) and a "정의" button explains its metrics.
 */
function KpiGroup({
  id,
  title,
  caption,
  definitions = null,
  children,
}: {
  id: string
  title: string
  caption: string
  /** Renders the group's definition panel with the given id; turns on the KPI header. */
  definitions?: ((panelId: string) => ReactNode) | null
  children: ReactNode
}) {
  const [open, setOpen] = useState(() => !isNarrowViewport())
  const [showDefinitions, setShowDefinitions] = useState(false)
  if (!definitions) {
    return (
      <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id={id} className="text-sm font-semibold text-slate-800">{title}</h2>
          <span className="shrink-0 text-xs text-slate-500">{caption}</span>
        </div>
        {children}
      </section>
    )
  }
  const bodyId = `${id}-body`
  const definitionsId = `${id}-defs`
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2">
        <h2 id={id} className="min-w-0 flex-1 text-sm font-semibold text-slate-800">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((value) => !value)}
            className="inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-lg text-left hover:text-slate-950"
          >
            <span className="min-w-0">{title}</span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>
        </h2>
        <span className="shrink-0 text-xs text-slate-500">{caption}</span>
        <DefinitionsToggle
          open={showDefinitions}
          onToggle={() => setShowDefinitions((value) => !value)}
          controls={definitionsId}
          context={title}
        />
      </div>
      {showDefinitions && definitions(definitionsId)}
      <div id={bodyId} hidden={!open} className="grid gap-3">
        {children}
      </div>
    </section>
  )
}

/** The north star (D2): labs recording weekly. Its own card right under the inbox. */
function NorthStarSection({ kpis, children }: { kpis: AnalyticsKpis | null; children: ReactNode }) {
  const { t } = useTranslation()
  const [showDefinitions, setShowDefinitions] = useState(false)
  const title = t('ops_kpi_north_star_title')
  const definitionsId = 'ops-home-north-star-defs'
  return (
    <section
      aria-labelledby="ops-home-north-star-title"
      className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:col-span-2 sm:p-5 xl:col-span-3"
    >
      <div className="flex flex-wrap items-center gap-x-2">
        <h2 id="ops-home-north-star-title" className="min-w-0 flex-1 text-base font-semibold text-slate-950">{title}</h2>
        <span className="shrink-0 text-xs text-slate-500">{t('ops_kpi_window_7d')}</span>
        {kpis && (
          <DefinitionsToggle
            open={showDefinitions}
            onToggle={() => setShowDefinitions((value) => !value)}
            controls={definitionsId}
            context={title}
          />
        )}
      </div>
      {kpis && showDefinitions && (
        <div className="mt-2">
          <MetricDefinitionList id={definitionsId} group="north_star" exclusions={kpis.exclusions} />
        </div>
      )}
      {children}
    </section>
  )
}

/** Runs the card body only for loaded data; otherwise the spinner or that source's failure. */
function SourceCard<T>({
  source,
  failureMessage,
  onRetry,
  briefFailure = false,
  children,
}: {
  source: OpsSourceState<T>
  failureMessage: string
  onRetry: () => void
  briefFailure?: boolean
  children: (data: T) => ReactNode
}) {
  const failure = source.failed
    ? <SourceFailure problem={source.problem} message={failureMessage} onRetry={onRetry} brief={briefFailure} />
    : null
  if (source.data === null) return failure ?? <LoadingBlock />
  return <>{failure}{children(source.data)}</>
}

function ProductTiles({ summary, days, loadedAt }: { summary: AnalyticsSummary; days: OpsHomePeriod; loadedAt: number }) {
  const { t } = useTranslation()
  const trend = fillDailyTrend(summary.dailyTrend, days, new Date(loadedAt)).map((point) => point.searches)
  const trendMax = trend.length > 0 ? Math.max(...trend) : 0
  const searches = summary.submittedSearches
  const basis = searches > 0 ? t('ops_home_basis_searches', { value: formatNumber(searches) }) : t('ops_an_no_searches_period')
  const noResult = describeRate(summary.noResultRate, searches, false)
  const conversion = describeRate(summary.batchConversionRate, searches, false)

  return (
    <div className="grid gap-3">
      <StatTile
        appearance="light"
        label={t('ops_an_m_00')}
        value={t('ops_an_unit_cases', { value: formatNumber(searches) })}
        caption={t('ops_an_m_01')}
      >
        {trendMax > 0 && (
          <Sparkline
            values={trend}
            width={160}
            label={t('ops_home_trend_label', { days, max: formatNumber(trendMax) })}
          />
        )}
      </StatTile>
      <StatTile
        appearance="light"
        label={t('ops_an_m_02')}
        value={t('ops_an_unit_people', { value: formatNumber(summary.uniqueUsers) })}
        caption={t('ops_an_m_03')}
      />
      <StatTile
        appearance="light"
        label={t('ops_an_m_04')}
        value={formatRate(noResult)}
        badge={isSmallSample(noResult) ? <SmallSampleMark /> : undefined}
        caption={isSmallSample(noResult) || noResult.kind === 'empty' ? basis : t('ops_an_m_05')}
      />
      <StatTile
        appearance="light"
        label={t('ops_an_m_06')}
        value={formatRate(conversion)}
        badge={isSmallSample(conversion) ? <SmallSampleMark /> : undefined}
        caption={isSmallSample(conversion) || conversion.kind === 'empty' ? basis : t('ops_an_m_07')}
      />
    </div>
  )
}

function SafetyTiles({ summary }: { summary: AnalyticsSummary }) {
  const { t } = useTranslation()
  const items = summary.dataCompleteness.itemCount
  const cas = describeRate(summary.dataCompleteness.casPercent, items, true)
  const concentration = describeRate(summary.dataCompleteness.concentrationPercent, items, true)
  const volume = describeRate(summary.dataCompleteness.volumePercent, items, true)

  return (
    <div className="grid gap-3">
      <IngestionTile summary={summary} />
      <StatTile
        appearance="light"
        label={t('ops_an_m_14')}
        value={t('ops_an_unit_items', { value: formatNumber(items) })}
        badge={items > 0 && isSmallSample(cas) ? <SmallSampleMark /> : undefined}
        caption={items > 0
          ? t('ops_an_completeness', { cas: formatRate(cas), concentration: formatRate(concentration), volume: formatRate(volume) })
          : t('ops_home_no_items')}
      />
      <StatTile
        appearance="light"
        label={t('ops_an_m_10')}
        value={t('ops_an_unit_cases', { value: formatNumber(summary.mixedBatches) })}
        caption={t('ops_home_mixed_basis', { total: formatNumber(summary.finalizedBatches) })}
      />
    </div>
  )
}

function B2bTiles({ items, loadedAt }: { items: readonly SafetyCenterApprovalItem[]; loadedAt: number }) {
  const { t } = useTranslation()
  const statuses = summarizeCenterStatuses(items)
  const pending = summarizePendingCenters(items, loadedAt)
  const oldest = oldestLabel(pending.oldestDays, pending.pending.isLowerBound, t)
  const pendingCaption = pending.pending.isLowerBound
    ? [oldest, cappedNote(t)].filter(Boolean).join(' · ')
    : oldest ?? t('ops_home_none_waiting')

  return (
    <div className="grid gap-3">
      <StatTile
        appearance="light"
        label={t('ops_home_kpi_centers_approved')}
        value={t('ops_home_unit_places', { value: formatCappedCount(statuses.approved) })}
        caption={t('ops_home_kpi_centers_total', { value: formatCappedCount(statuses.total) })}
      />
      <StatTile
        appearance="light"
        label={t('ops_home_kpi_centers_pending')}
        value={t('ops_home_unit_places', { value: formatCappedCount(pending.pending) })}
        tone={pending.pending.count > 0 ? 'attention' : 'neutral'}
        caption={pendingCaption}
      />
    </div>
  )
}

function taskRowText(
  task: OpsInboxTask,
  t: Translate,
  language: string,
): { title: string; meta: string | null; detail: string | null; openLabel: string } {
  const count = formatCappedCount(task.count)
  const { isLowerBound } = task.count
  // A capped list with nothing visible still has a row: older items may be missing from it.
  const isUnchecked = isLowerBound && task.count.count === 0
  if (task.id === 'centers') {
    const parts = [oldestLabel(task.oldestDays, isLowerBound, t)]
    if (task.domain.checked > 0) {
      parts.push(t('ops_home_domain_match', { matched: task.domain.matched, checked: task.domain.checked }))
    }
    if (isLowerBound) parts.push(cappedNote(t))
    return {
      title: isUnchecked ? t('ops_home_task_centers_unchecked') : t('ops_home_task_centers', { value: count }),
      meta: parts.filter(Boolean).join(' · ') || null,
      detail: null,
      openLabel: t('ops_home_open_centers'),
    }
  }
  if (task.id === 'feedback') {
    const parts = [oldestLabel(task.oldestDays, isLowerBound, t), isLowerBound ? cappedNote(t) : null]
    return {
      title: isUnchecked ? t('ops_home_task_feedback_unchecked') : t('ops_home_task_feedback', { value: count }),
      meta: parts.filter(Boolean).join(' · ') || null,
      detail: task.byType.map((entry) => t(`ops_home_feedback_type_${entry.type}`, { value: entry.count })).join(' · ') || null,
      openLabel: t('ops_home_open_feedback'),
    }
  }
  return {
    title: t('ops_home_task_reviews', { value: count }),
    meta: task.lastUpdatedAt ? t('ops_kpi_reviews_updated', { date: formatShortDate(task.lastUpdatedAt, language) }) : null,
    detail: null,
    openLabel: t('ops_home_open_reviews'),
  }
}

interface OpsHomeViewProps {
  data: OpsConsoleData
  onNavigate: (path: string) => void
}

/**
 * Operator console home: what is waiting today (centers, feedback, review candidates) and the
 * current summary numbers. The parent loads the data once and shares it with the nav badges.
 *
 * With the KPI function deployed (phase 2) the summary call also carries `kpis`: exact inbox
 * counts, the north star and the goal-group KPIs. Without it (`kpis` null or absent) the home is the
 * phase-1 home, plus one line when the server reported the KPIs as failed.
 */
export function OpsHomeView({ data, onNavigate }: OpsHomeViewProps) {
  const { t, i18n } = useTranslation()
  const language = i18n.language || 'ko'
  const { centers, feedback, summary, days, setDays, reload, loadedAt, isLoading } = data

  const blockingProblem = pickBlockingProblem([centers.problem, feedback.problem, summary.problem])
  if (blockingProblem) {
    return <OpsAccessNotice problem={blockingProblem} requiredRole={HOME_ROLE} onRetry={() => void reload()} />
  }

  const sources: Record<OpsSourceId, OpsSourceState<unknown>> = { centers, feedback, summary }
  // The inbox is a snapshot, so the last KPIs serve whichever period they were loaded for.
  const lastKpis = summary.data && isAnalyticsKpis(summary.data.payload.kpis) ? summary.data.payload.kpis : null
  const inbox = buildOpsInbox({
    centers: centers.data && centers.loadedAt !== null ? { items: centers.data, loadedAt: centers.loadedAt } : null,
    feedback: feedback.data && feedback.loadedAt !== null ? { items: feedback.data, loadedAt: feedback.loadedAt } : null,
    reviewsPending: summary.data?.payload.governance?.reviews?.pending ?? null,
    kpiInbox: lastKpis && summary.loadedAt !== null ? { inbox: lastKpis.inbox, loadedAt: summary.loadedAt } : null,
  })
  // A source without data shows a retry row; one that failed after loading keeps its row and adds one.
  const failedTasks = (['centers', 'feedback', 'reviews'] as const).filter((id) => sources[TASK_SOURCE[id]].failed)
  const isInboxLoading = inbox.missing.some((id) => !sources[TASK_SOURCE[id]].failed)
  const clock = loadedAt !== null ? formatClock(loadedAt, language) : null
  const summaryForPeriod = summary.data?.period === days ? summary.data : null
  const summaryCard: OpsSourceState<NonNullable<typeof summaryForPeriod>> = { ...summary, data: summaryForPeriod }
  const payload = summaryForPeriod?.payload ?? null
  const kpis = payload && isAnalyticsKpis(payload.kpis) ? payload.kpis : null
  const kpisFailed = typeof payload?.kpisError === 'string'
  // While another period loads, the last KPIs keep the KPI layout, so the page never flashes back to
  // the phase-1 tiles in between.
  const layoutKpis = kpis ?? (summaryForPeriod === null ? lastKpis : null)
  // The north star also holds the place while the first summary loads; it is the first card fed by
  // the summary call, so it explains a refusal in full and the cards after it stay brief.
  const showNorthStar = layoutKpis !== null || (summaryCard.data === null && !summaryCard.failed)
  const retrySummary = () => void reload(['summary'])
  const retryCenters = () => void reload(['centers'])
  const periodCaption = t('ops_home_period_recent', { days })
  // The product card already explains a refusal in full (e.g. with the MFA panel). When the center
  // list was refused for the same reason, the B2B card only repeats the title, so the fix shows once.
  const summaryRefusal = summaryCard.failed ? summaryCard.problem : null
  const centersRefusalShown = summaryRefusal !== null && centers.failed && centers.problem?.issue === summaryRefusal.issue
  const definitionsFor = (group: 'product' | 'safety' | 'b2b') => (layoutKpis
    ? (panelId: string) => <MetricDefinitionList id={panelId} group={group} exclusions={layoutKpis.exclusions} />
    : null)

  return (
    <div className="flex flex-col gap-5 p-4 pb-16 sm:p-5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div role="group" aria-label={t('ops_an_range')} className="flex rounded-lg border border-slate-200 bg-white p-1">
          {OPS_HOME_PERIODS.map((period) => (
            <button
              key={period}
              type="button"
              aria-pressed={days === period}
              onClick={() => setDays(period)}
              className={`min-h-9 rounded-md px-3 text-xs font-medium ${days === period ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {t('ops_an_days', { count: period })}
            </button>
          ))}
        </div>
        {clock && <span className="text-xs tabular-nums text-slate-500">{t('ops_an_updated_at', { time: clock })}</span>}
        <button
          type="button"
          disabled={isLoading}
          onClick={() => void reload()}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          {t('ops_an_refresh')}
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <section
          aria-labelledby="ops-home-inbox-title"
          className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:col-span-2 sm:p-5 xl:col-span-3"
        >
          <h2 id="ops-home-inbox-title" className="flex items-center gap-2 text-base font-semibold text-slate-950">
            {t('ops_home_inbox_title')}{' '}
            {inbox.tasks.length > 0 && (
              <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
                {inbox.tasks.length}
              </span>
            )}
          </h2>
          {(inbox.tasks.length > 0 || failedTasks.length > 0) && (
            <ul className="mt-1 divide-y divide-slate-100">
              {inbox.tasks.map((task) => {
                const text = taskRowText(task, t, language)
                return (
                  <InboxRow
                    key={task.id}
                    appearance="light"
                    severity={task.severity}
                    title={text.title}
                    meta={text.meta}
                    detail={text.detail}
                    onOpen={() => onNavigate(task.path)}
                    openLabel={text.openLabel}
                  />
                )
              })}
              {failedTasks.map((id) => {
                const source = sources[TASK_SOURCE[id]]
                const name = t(TASK_NAME_KEY[id])
                return (
                  <InboxRow
                    key={`failed-${id}`}
                    appearance="light"
                    severity="slate"
                    title={name}
                    meta={source.problem ? t(ACCESS_TITLE_KEY[source.problem.issue]) : t('ops_home_source_failed')}
                    actions={<RetryButton label={name} onClick={() => void reload([TASK_SOURCE[id]])} />}
                  />
                )
              })}
            </ul>
          )}
          {isInboxLoading && inbox.tasks.length === 0 && failedTasks.length === 0 && <LoadingBlock />}
          {inbox.isQuiet && <InboxQuietState appearance="light" lastCheckedLabel={clock ?? undefined} />}
        </section>

        {showNorthStar && (
          <NorthStarSection kpis={layoutKpis}>
            <SourceCard source={summaryCard} failureMessage={t('ops_an_load_failed')} onRetry={retrySummary}>
              {(loaded) => (isAnalyticsKpis(loaded.payload.kpis) ? <NorthStarBody kpis={loaded.payload.kpis} /> : null)}
            </SourceCard>
          </NorthStarSection>
        )}

        {kpisFailed && layoutKpis === null && (
          <p className="text-xs text-slate-500 sm:col-span-2 xl:col-span-3">{t('ops_kpi_unavailable')}</p>
        )}

        <KpiGroup
          id="ops-home-group-product"
          title={t('ops_home_group_product')}
          caption={periodCaption}
          definitions={definitionsFor('product')}
        >
          <SourceCard
            source={summaryCard}
            failureMessage={t('ops_an_load_failed')}
            onRetry={retrySummary}
            briefFailure={showNorthStar}
          >
            {(loaded) => (isAnalyticsKpis(loaded.payload.kpis)
              ? <ProductKpiTiles kpis={loaded.payload.kpis} summary={loaded.payload.summary} />
              : <ProductTiles summary={loaded.payload.summary} days={loaded.period} loadedAt={summary.loadedAt ?? 0} />)}
          </SourceCard>
        </KpiGroup>

        <KpiGroup
          id="ops-home-group-safety"
          title={t('ops_home_group_safety')}
          caption={periodCaption}
          definitions={definitionsFor('safety')}
        >
          {/* Same call as the card above, which already explains a refusal in full. */}
          <SourceCard source={summaryCard} failureMessage={t('ops_an_load_failed')} onRetry={retrySummary} briefFailure>
            {(loaded) => (isAnalyticsKpis(loaded.payload.kpis)
              ? <SafetyKpiTiles kpis={loaded.payload.kpis} />
              : <SafetyTiles summary={loaded.payload.summary} />)}
          </SourceCard>
        </KpiGroup>

        {layoutKpis ? (
          <KpiGroup
            id="ops-home-group-b2b"
            title={t('ops_home_group_b2b')}
            caption={periodCaption}
            definitions={definitionsFor('b2b')}
          >
            <SourceCard source={summaryCard} failureMessage={t('ops_an_load_failed')} onRetry={retrySummary} briefFailure>
              {(loaded) => (isAnalyticsKpis(loaded.payload.kpis) ? <B2bKpiTiles kpis={loaded.payload.kpis} /> : null)}
            </SourceCard>
          </KpiGroup>
        ) : (
          <KpiGroup id="ops-home-group-b2b" title={t('ops_home_group_b2b')} caption={t('ops_home_period_cumulative')}>
            <SourceCard
              source={centers}
              failureMessage={t('ops_centers_load_failed')}
              onRetry={retryCenters}
              briefFailure={centersRefusalShown}
            >
              {(items) => <B2bTiles items={items} loadedAt={centers.loadedAt ?? 0} />}
            </SourceCard>
          </KpiGroup>
        )}
      </div>
    </div>
  )
}
