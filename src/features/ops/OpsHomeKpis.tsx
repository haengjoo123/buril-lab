import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'
import { Sparkline } from '../../components/admin/Sparkline'
import { StatTile } from '../../components/admin/StatTile'
import type {
  AnalyticsKpis,
  AnalyticsSummary,
  KpiOnboardingFunnel,
  KpiRatio,
  WasteMissingField,
} from '../../services/opsAnalyticsService'
import {
  comparableCountDelta,
  formatNumber,
  localeOf,
  ratioDisplay,
  ratioPointsDelta,
  sumFunnels,
  wsalTrend,
  type KpiDelta,
} from './kpiDisplay'
import { getStorageRuleGroupLabelKeys } from '../../utils/storageCompatibilityChecker'
import { metricsInGroup, type MetricGroup } from './metricDefinitions'
import { ingestionFailureStatus, INGESTION_FAILURE_BASELINE_PERCENT } from './opsAnalyticsLabels'
import { describeRate, formatRate, isSmallSample, type RateDisplay } from './opsHomeTasks'

/**
 * The operator home's KPI mode (phase 2): the north star and the goal-group tiles read from
 * analytics_admin_kpis_v1. Components the phase-1 tiles also use (SmallSampleMark, IngestionTile)
 * live here too, so OpsHomeView imports this file and never the other way round.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string

/** Hours or days with at most one decimal, e.g. a median. */
function formatDecimal(value: number, language: string): string {
  return value.toLocaleString(localeOf(language), { maximumFractionDigits: 1 })
}

export function SmallSampleMark() {
  const { t } = useTranslation()
  return (
    <span
      title={t('ops_an_small_sample')}
      className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-2xs font-medium text-amber-700 ring-1 ring-amber-200"
    >
      {t('ops_home_small_sample_short')}
      <span className="sr-only"> · {t('ops_an_small_sample')}</span>
    </span>
  )
}

function smallSampleBadge(display: RateDisplay): ReactNode {
  return isSmallSample(display) ? <SmallSampleMark /> : undefined
}

/** Arrows carry no color: a change is not judged good or bad here. */
function formatDelta(delta: KpiDelta, unit: 'count' | 'points', t: Translate): string {
  if (delta.kind === 'same') return t('ops_kpi_delta_same')
  if (unit === 'points') {
    return t(delta.kind === 'up' ? 'ops_kpi_delta_points_up' : 'ops_kpi_delta_points_down', { value: delta.value.toFixed(1) })
  }
  return t(delta.kind === 'up' ? 'ops_kpi_delta_up' : 'ops_kpi_delta_down', { value: formatNumber(delta.value) })
}

/** "▲3 (직전 12)", or only "직전 4" while the previous count is too small for an arrow. */
function countComparison(current: number, previous: number, t: Translate): string {
  const delta = comparableCountDelta(current, previous)
  return delta
    ? t('ops_kpi_delta_vs_previous', { delta: formatDelta(delta, 'count', t), previous: formatNumber(previous) })
    : t('ops_kpi_previous_count', { value: formatNumber(previous) })
}

/**
 * "▲1.5%p (직전 20.0%)" when both periods have at least SMALL_SAMPLE_MIN cases, otherwise only
 * "직전 3/5". Nothing when the previous period had no cases. `arrows: false` for cohorts that had
 * longer to finish (onboarding), where a change is context, not a trend.
 */
function ratioComparison(current: KpiRatio, previous: KpiRatio, t: Translate, arrows = true): string | null {
  const before = ratioDisplay(previous)
  if (before.kind === 'empty') return null
  const delta = arrows ? ratioPointsDelta(current, previous) : null
  return delta
    ? t('ops_kpi_delta_vs_previous', { delta: formatDelta(delta, 'points', t), previous: formatRate(before) })
    : t('ops_kpi_previous_ratio', { value: formatRate(before) })
}

function joinParts(parts: ReadonlyArray<string | null | undefined>): string {
  return parts.filter(Boolean).join(' · ')
}

export function DefinitionsToggle({
  open,
  onToggle,
  controls,
  context,
}: {
  open: boolean
  onToggle: () => void
  controls: string
  /** Names the group for screen readers, since every group has a "정의" button. */
  context: string
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-blue-700 hover:bg-blue-50"
    >
      <Info className="h-3.5 w-3.5" aria-hidden="true" />
      {t(open ? 'ops_kpi_definitions_hide' : 'ops_kpi_definitions_show')}
      <span className="sr-only"> · {context}</span>
    </button>
  )
}

/** The "정의" panel: each metric's plain-language definition, its small-sample rule, the exclusions. */
export function MetricDefinitionList({
  id,
  group,
  exclusions,
}: {
  id: string
  group: MetricGroup
  exclusions: AnalyticsKpis['exclusions']
}) {
  const { t } = useTranslation()
  return (
    <div id={id} className="grid gap-2 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">
      <dl className="grid gap-2">
        {metricsInGroup(group).map((metric) => (
          <div key={metric.id} className="min-w-0">
            <dt className="font-medium text-slate-800">{t(metric.labelKey)}</dt>
            <dd className="[overflow-wrap:anywhere]">
              {t(metric.tooltipKey)}
              {metric.minSample > 0 && <> {t('ops_kpi_min_sample', { value: metric.minSample })}</>}
            </dd>
          </div>
        ))}
      </dl>
      <p>{t('ops_kpi_exclusions', {
        labs: formatNumber(exclusions?.internalLabs),
        users: formatNumber(exclusions?.internalUsers),
      })}</p>
    </div>
  )
}

/** "주간 기록 연구실": this week's labs, the change against last week, and the 8-week line. */
export function NorthStarBody({ kpis }: { kpis: AnalyticsKpis }) {
  const { t } = useTranslation()
  const wsal = kpis.product.wsal
  const trend = wsalTrend(kpis)
  const delta = comparableCountDelta(wsal.current, wsal.previous)
  const previous = formatNumber(wsal.previous)
  const total = formatNumber(wsal.totalLabs)
  return (
    <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <p className="text-2xl font-semibold tabular-nums text-slate-950">
          {t('ops_home_unit_places', { value: formatNumber(wsal.current) })}
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          {delta
            ? t('ops_kpi_north_star_caption', { delta: formatDelta(delta, 'count', t), previous, total })
            : t('ops_kpi_north_star_caption_plain', { previous, total })}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-start gap-1">
        <Sparkline
          values={trend}
          width={160}
          height={32}
          label={t('ops_kpi_north_star_trend', {
            first: formatNumber(trend[0]),
            last: formatNumber(trend[trend.length - 1]),
          })}
        />
        <span className="text-2xs text-slate-500">{t('ops_kpi_weeks_8')}</span>
      </div>
    </div>
  )
}

/** Search-record ingestion failures (D7, analytics_admin_summary). The same tile in both modes. */
export function IngestionTile({ summary }: { summary: AnalyticsSummary }) {
  const { t } = useTranslation()
  const ingestion = describeRate(summary.analyticsIngestionFailureRate, summary.submittedSearches, false)
  const ingestionStatus = ingestion.kind === 'empty' ? 'unknown' : ingestionFailureStatus(summary.analyticsIngestionFailureRate)
  const baseline = t('ops_an_ingestion_baseline', { value: INGESTION_FAILURE_BASELINE_PERCENT })
  return (
    <StatTile
      appearance="light"
      label={t('ops_an_ingestion_title')}
      value={formatRate(ingestion, 2)}
      tone={ingestionStatus === 'attention' ? 'attention' : ingestionStatus === 'normal' ? 'good' : 'neutral'}
      badge={smallSampleBadge(ingestion)}
      caption={ingestionStatus === 'unknown'
        ? `${baseline} · ${t('ops_an_no_searches_period')}`
        : `${baseline} · ${t(ingestionStatus === 'attention' ? 'ops_an_status_attention' : 'ops_an_status_normal')}`}
    />
  )
}

export function ProductKpiTiles({ kpis, summary }: { kpis: AnalyticsKpis; summary: AnalyticsSummary }) {
  const { t } = useTranslation()
  const { activeUsers, activation14d, retentionW4, onboarding } = kpis.product

  const activationRatio = (cohort: AnalyticsKpis['product']['activation14d']['current']): KpiRatio => ({
    numerator: cohort.fullyActivated,
    denominator: cohort.cohortLabs,
  })
  const activation = ratioDisplay(activationRatio(activation14d.current))
  const retention = ratioDisplay(retentionW4.current)
  const funnel = sumFunnels(onboarding.web.current, onboarding.native.current)
  const previousFunnel = sumFunnels(onboarding.web.previous, onboarding.native.previous)
  const firstValue = (value: KpiOnboardingFunnel): KpiRatio => ({ numerator: value.firstValueReached, denominator: value.shown })
  const onboardingRate = ratioDisplay(firstValue(funnel))

  return (
    <div className="grid gap-3">
      <StatTile
        appearance="light"
        label={t('ops_kpi_wau_label')}
        value={t('ops_an_unit_people', { value: formatNumber(activeUsers.wau.current) })}
        caption={t('ops_kpi_wau_caption', {
          delta: countComparison(activeUsers.wau.current, activeUsers.wau.previous, t),
          mau: formatNumber(activeUsers.mau.current),
          stickiness: formatRate(ratioDisplay(activeUsers.stickiness.current)),
        })}
      />
      <StatTile
        appearance="light"
        label={t('ops_kpi_activation_label')}
        value={formatRate(activation)}
        badge={smallSampleBadge(activation)}
        caption={joinParts([
          activation14d.current.cohortLabs > 0
            ? t('ops_kpi_activation_caption', {
              member: formatNumber(activation14d.current.secondMember),
              item: formatNumber(activation14d.current.firstItem),
              waste: formatNumber(activation14d.current.firstWasteRecord),
            })
            : t('ops_kpi_no_cohort'),
          ratioComparison(activationRatio(activation14d.current), activationRatio(activation14d.previous), t),
        ])}
      />
      <StatTile
        appearance="light"
        label={t('ops_kpi_retention_label')}
        value={formatRate(retention)}
        badge={smallSampleBadge(retention)}
        caption={joinParts([
          retentionW4.current.denominator > 0
            ? t('ops_kpi_retention_caption', { value: formatNumber(retentionW4.current.denominator) })
            : t('ops_kpi_no_cohort'),
          ratioComparison(retentionW4.current, retentionW4.previous, t),
        ])}
      />
      <StatTile
        appearance="light"
        label={t('ops_kpi_onboarding_label')}
        value={formatRate(onboardingRate)}
        badge={smallSampleBadge(onboardingRate)}
        caption={joinParts([
          funnel.shown > 0
            ? t('ops_kpi_onboarding_caption', {
              web: formatRate(ratioDisplay(firstValue(onboarding.web.current))),
              native: formatRate(ratioDisplay(firstValue(onboarding.native.current))),
              skipped: formatNumber(funnel.skipped),
            })
            : t('ops_kpi_no_data'),
          // An older cohort had longer to reach first value, so its rate is context, not a trend.
          ratioComparison(firstValue(funnel), firstValue(previousFunnel), t, false),
        ])}
      />
      <IngestionTile summary={summary} />
    </div>
  )
}

const MISSING_FIELDS: ReadonlySet<WasteMissingField> = new Set<WasteMissingField>([
  'components', 'matrix', 'total_amount', 'measured_ph', 'identity', 'hazard_data',
  'additional_components', 'mixing_state', 'fluoride_container', 'inventory_quantity',
  'policy_stream', 'policy_destination',
])

export function SafetyKpiTiles({ kpis }: { kpis: AnalyticsKpis }) {
  const { t, i18n } = useTranslation()
  const language = i18n.language || 'ko'
  const { needsReview, dangerIgnored, corrections, centerRequests, ghsCheckGaps } = kpis.safety

  const review = ratioDisplay(needsReview.current)
  const fields = (Array.isArray(needsReview.topMissingFields) ? needsReview.topMissingFields : [])
    .filter((entry) => MISSING_FIELDS.has(entry.field))
    .slice(0, 2)
    .map((entry) => t(`ops_kpi_field_${entry.field}`))
  // Commas inside the list, so the " · " before the period comparison still reads as a new part.
  const reviewCaption = needsReview.current.denominator <= 0
    ? t('ops_kpi_no_data')
    : fields.length > 0 ? t('ops_kpi_needs_review_caption', { fields: fields.join(', ') }) : t('ops_kpi_needs_review_none')

  const topRule = Array.isArray(dangerIgnored.topRules) ? dangerIgnored.topRules[0] : undefined
  const topRuleKeys = topRule ? getStorageRuleGroupLabelKeys(topRule.ruleId) : null
  // "인화성+산화제" reads at a glance; the raw id stays only as a fallback for an unknown rule.
  const topRuleLabel = topRule ? (topRuleKeys ? topRuleKeys.map((key) => t(key)).join('+') : topRule.ruleId) : ''
  const correction = ratioDisplay(corrections.current)
  const reasons = corrections.byReason
  const firstResponse = centerRequests.firstResponse.current
  const gaps = ratioDisplay(ghsCheckGaps.current)

  return (
    <div className="grid gap-3">
      <StatTile
        appearance="light"
        label={t('ops_kpi_needs_review_label')}
        value={formatRate(review)}
        badge={smallSampleBadge(review)}
        caption={joinParts([reviewCaption, ratioComparison(needsReview.current, needsReview.previous, t)])}
      />
      <StatTile
        appearance="light"
        label={t('ops_kpi_danger_label')}
        value={t('ops_kpi_danger_value', {
          events: formatNumber(dangerIgnored.current.events),
          labs: formatNumber(dangerIgnored.current.labs),
        })}
        tone={dangerIgnored.current.events > 0 ? 'attention' : 'neutral'}
        caption={(
          <span className="[overflow-wrap:anywhere]">
            {topRule
              ? t('ops_kpi_danger_caption', { previous: formatNumber(dangerIgnored.previous.events), rule: topRuleLabel })
              : t('ops_kpi_danger_caption_none', { previous: formatNumber(dangerIgnored.previous.events) })}
          </span>
        )}
      />
      <StatTile
        appearance="light"
        label={t('ops_kpi_corrections_label')}
        value={formatRate(correction)}
        badge={smallSampleBadge(correction)}
        caption={joinParts([
          corrections.current.denominator > 0
            ? t('ops_kpi_corrections_caption', {
              amount: formatNumber(reasons?.amount),
              duplicate: formatNumber(reasons?.duplicate),
              category: formatNumber(reasons?.category),
              other: formatNumber(reasons?.other),
            })
            : t('ops_kpi_no_data'),
          ratioComparison(corrections.current, corrections.previous, t),
        ])}
      />
      <StatTile
        appearance="light"
        label={t('ops_kpi_requests_label')}
        value={t('ops_kpi_requests_value', {
          overdue: formatNumber(centerRequests.overdue),
          soon: formatNumber(centerRequests.dueSoon),
        })}
        tone={centerRequests.overdue > 0 ? 'danger' : centerRequests.dueSoon > 0 ? 'attention' : 'neutral'}
        caption={typeof firstResponse.medianHours === 'number' && Number.isFinite(firstResponse.medianHours)
          ? t('ops_kpi_requests_caption', {
            hours: formatDecimal(firstResponse.medianHours, language),
            responded: formatNumber(firstResponse.responded),
            requests: formatNumber(firstResponse.requests),
          })
          : t('ops_kpi_requests_caption_none', { requests: formatNumber(firstResponse.requests) })}
      />
      <StatTile
        appearance="light"
        label={t('ops_kpi_ghs_label')}
        value={formatRate(gaps)}
        badge={smallSampleBadge(gaps)}
        caption={joinParts([
          ghsCheckGaps.current.denominator > 0
            ? t('ops_kpi_ghs_caption', {
              failed: formatNumber(ghsCheckGaps.current.lookupFailed),
              unchecked: formatNumber(ghsCheckGaps.current.notChecked),
            })
            : t('ops_kpi_no_data'),
          ratioComparison(ghsCheckGaps.current, ghsCheckGaps.previous, t),
        ])}
      />
    </div>
  )
}

/** Shown institutions in the sales tile; the rest are counted in the value. */
const SALES_ITEMS_SHOWN = 3

export function B2bKpiTiles({ kpis }: { kpis: AnalyticsKpis }) {
  const { t, i18n } = useTranslation()
  const language = i18n.language || 'ko'
  const { centerPipeline: pipeline, institutions, labProReadiness, purchaseIntent } = kpis.b2b

  const active = ratioDisplay({ numerator: pipeline.activeCenters.current, denominator: pipeline.approved })
  const medianDays = pipeline.approvalDays?.median
  const candidates = Array.isArray(institutions.salesCandidates.top)
    ? institutions.salesCandidates.top.slice(0, SALES_ITEMS_SHOWN)
    : []
  const ready = labProReadiness.current
  const purchase = purchaseIntent.current
  const brands = Array.isArray(purchaseIntent.topBrands) ? purchaseIntent.topBrands : []

  return (
    <div className="grid gap-3">
      <StatTile
        appearance="light"
        label={t('ops_kpi_active_centers_label')}
        value={formatRate(active)}
        badge={smallSampleBadge(active)}
        caption={typeof medianDays === 'number' && Number.isFinite(medianDays)
          ? t('ops_kpi_active_centers_caption', {
            applications: formatNumber(pipeline.applications.current),
            pending: formatNumber(pipeline.pending),
            days: formatDecimal(medianDays, language),
          })
          : t('ops_kpi_active_centers_caption_no_median', {
            applications: formatNumber(pipeline.applications.current),
            pending: formatNumber(pipeline.pending),
          })}
      />
      <StatTile
        appearance="light"
        label={t('ops_kpi_linked_labs_label')}
        value={t('ops_home_unit_places', { value: formatNumber(pipeline.linkedLabs) })}
        caption={t('ops_kpi_linked_labs_caption', {
          pending: formatNumber(pipeline.linkRequestsPending),
          requests: formatNumber(pipeline.requests.current),
          exports: formatNumber(pipeline.exports.current),
        })}
      />
      <StatTile
        appearance="light"
        label={t('ops_kpi_sales_label')}
        value={t('ops_home_unit_places', { value: formatNumber(institutions.salesCandidates.count) })}
        caption={t('ops_kpi_sales_caption', {
          covered: formatNumber(institutions.coveredLabs),
          total: formatNumber(institutions.labsWithInstitution),
        })}
      >
        {candidates.length > 0 && (
          <ul className="grid gap-1">
            {candidates.map((candidate) => (
              <li key={candidate.institution} className="flex min-w-0 items-center gap-1.5 text-xs leading-5 text-slate-600">
                <span className="min-w-0 truncate" title={candidate.institution}>{candidate.institution}</span>
                <span className="shrink-0 tabular-nums text-slate-500">
                  {t('ops_kpi_sales_item_labs', { value: formatNumber(candidate.activeLabs) })}
                </span>
                {candidate.hasPendingCenter && (
                  <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-2xs font-medium text-blue-700 ring-1 ring-blue-200">
                    {t('ops_kpi_sales_pending_center')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </StatTile>
      <StatTile
        appearance="light"
        label={t('ops_kpi_pro_label')}
        value={t('ops_home_unit_places', { value: formatNumber(ready.readyLabs) })}
        caption={t('ops_kpi_pro_caption', {
          habitual: formatNumber(ready.habitualLabs),
          small: formatNumber(ready.seats?.from3To5),
          medium: formatNumber(ready.seats?.from6To10),
          large: formatNumber(ready.seats?.over10),
        })}
      />
      <StatTile
        appearance="light"
        label={t('ops_kpi_purchase_label')}
        value={t('ops_an_unit_cases', { value: formatNumber(purchase.events) })}
        caption={t('ops_kpi_purchase_caption', {
          labs: formatNumber(purchase.labs),
          cas: formatRate(ratioDisplay({ numerator: purchase.withCas, denominator: purchase.events })),
        })}
      >
        {(brands.length > 0 || purchaseIntent.hiddenBrands > 0) && (
          <div className="grid gap-0.5 text-xs leading-5">
            {brands.length > 0 && (
              <p className="text-slate-600 [overflow-wrap:anywhere]">
                {t('ops_kpi_purchase_brands', {
                  brands: brands.map((brand) => `${brand.brand} ${formatNumber(brand.events)}`).join(', '),
                })}
              </p>
            )}
            {purchaseIntent.hiddenBrands > 0 && (
              <p className="text-slate-500">{t('ops_kpi_purchase_hidden', { value: formatNumber(purchaseIntent.hiddenBrands) })}</p>
            )}
          </div>
        )}
      </StatTile>
    </div>
  )
}
