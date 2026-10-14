import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  BarChart3,
  Check,
  Download,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react'
import {
  OpsAnalyticsApiError,
  decideAnalyticsReview,
  exportAnalyticsCsv,
  loadAnalyticsMixtures,
  loadAnalyticsReviews,
  loadAnalyticsSearches,
  loadAnalyticsSummary,
  type AnalyticsDistribution,
  type AnalyticsGovernance,
  type AnalyticsMixtures,
  type AnalyticsReviewCandidate,
  type AnalyticsSearchItem,
  type AnalyticsSummary,
} from '../../services/opsAnalyticsService'
import {
  HANDLING_ACTION_LABELS,
  HAZARD_FLAG_LABELS,
  MATRIX_LABELS,
  REVIEW_TYPE_LABELS,
  SEARCH_OUTCOME_LABELS,
  WASTE_STREAM_LABELS,
  canonicalComponentDisplayKey,
  koreanChemicalDisplayName,
  koreanReviewDisplayText,
  opsAnalyticsLabel,
  type OpsAnalyticsLabelMap,
} from './opsAnalyticsLabels'

type AnalyticsTab = 'overview' | 'searches' | 'mixtures' | 'reviews' | 'governance'

const PERIODS = [7, 30, 90] as const
const TABS: Array<{ id: AnalyticsTab; labelKey: string }> = [
  { id: 'overview', labelKey: 'ops_an_tab_overview' },
  { id: 'searches', labelKey: 'ops_an_tab_searches' },
  { id: 'mixtures', labelKey: 'ops_an_tab_mixtures' },
  { id: 'reviews', labelKey: 'ops_an_tab_reviews' },
  { id: 'governance', labelKey: 'ops_an_tab_governance' },
]

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
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
      <AlertTriangle className="h-3 w-3" /> {t('ops_an_small_sample')}
    </span>
  )
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

function trendDateLabel(value: string, t: (key: string, opts?: Record<string, unknown>) => string): { short: string; long: string } {
  const [year, month, day] = value.split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return { short: value, long: value }
  return { short: `${month}/${day}`, long: t('ops_an_date_long', { year, month, day }) }
}

function OverviewPanel({ summary, days }: { summary: AnalyticsSummary; days: number }) {
  const { t } = useTranslation()
  const trend = [...summary.dailyTrend].sort((a, b) => a.date.localeCompare(b.date))
  const maxSearches = Math.max(1, ...trend.map((point) => point.searches))
  const trendTotal = trend.reduce((total, point) => total + point.searches, 0)
  const peak = trend.reduce<(typeof trend)[number] | null>(
    (highest, point) => !highest || point.searches > highest.searches ? point : highest,
    null,
  )
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
        {trend.length === 0 ? (
          <p className="mt-6 rounded-lg bg-slate-50 py-10 text-center text-sm text-slate-500">{t('ops_an_no_searches_period')}</p>
        ) : (
          <div className="mt-5 overflow-x-auto pb-2">
            <div className="flex h-56 items-end gap-2" style={{ minWidth: `${Math.max(540, trend.length * 58)}px` }}>
              {trend.map((point) => {
                const date = trendDateLabel(point.date, t)
                return (
                  <div key={point.date} className="group flex h-full min-w-12 flex-1 flex-col items-center justify-end" title={`${t('ops_an_trend_title', { date: date.long, count: point.searches })}${point.noResults > 0 ? t('ops_an_trend_title_noresult', { count: point.noResults }) : ''}`}>
                    <span className="mb-2 text-xs font-semibold tabular-nums text-slate-800">{t('ops_an_unit_cases', { value: point.searches.toLocaleString('ko-KR') })}</span>
                    <div className="flex h-36 w-full items-end justify-center rounded-lg bg-slate-50 px-2">
                      <div
                        className="w-full max-w-9 rounded-t-md bg-blue-500 transition-colors group-hover:bg-blue-700"
                        style={{ height: `${Math.max(6, (point.searches / maxSearches) * 128)}px` }}
                      />
                    </div>
                    <time dateTime={point.date} className="mt-2 text-[11px] font-medium tabular-nums text-slate-600">{date.short}</time>
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
    <div className="grid gap-1 text-[11px] text-slate-600">
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

function SearchesPanel({
  demandItems,
  confusionItems,
}: {
  demandItems: AnalyticsSearchItem[]
  confusionItems: AnalyticsSearchItem[]
}) {
  const { t } = useTranslation()
  const [ranking, setRanking] = useState<'demand' | 'confusion'>('demand')
  const items = ranking === 'demand' ? demandItems : confusionItems
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="font-semibold text-slate-950">{t('ops_an_searches_heading')}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">{t('ops_an_confusion_note')}</p>
        </div>
        <div className="flex rounded-lg border border-slate-200 p-1 text-xs font-medium">
          <button type="button" onClick={() => setRanking('demand')} className={`rounded-md px-3 py-1.5 ${ranking === 'demand' ? 'bg-slate-950 text-white' : 'text-slate-600'}`}>{t('ops_an_rank_demand')}</button>
          <button type="button" onClick={() => setRanking('confusion')} className={`rounded-md px-3 py-1.5 ${ranking === 'confusion' ? 'bg-slate-950 text-white' : 'text-slate-600'}`}>{t('ops_an_rank_confusion')}</button>
        </div>
      </div>
      <div className="overflow-x-auto">
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
                <td className="px-4 py-4 text-xs leading-5 text-slate-700"><span className="block">{t('ops_an_events_7d', { count: item.events7d })}</span><span className="block">{t('ops_an_events_30d', { count: item.events30d })}</span><span className="block">{t('ops_an_events_90d', { count: item.events90d })}</span></td>
                <td className="px-4 py-4">
                  <span className={`inline-flex rounded-full px-2.5 py-1 font-semibold ${item.confusionScore >= 50 ? 'bg-red-50 text-red-700' : item.confusionScore >= 25 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {t('ops_an_score', { value: item.confusionScore.toFixed(1) })}
                  </span>
                  <div className="mt-1 text-xs text-slate-500">{t('ops_an_err_counts', { noResult: item.noResultCount, technical: item.technicalErrorCount })}</div>
                </td>
                <td className="px-4 py-4"><ConfusionComponents item={item} /></td>
                <td className="px-4 py-4 text-xs leading-5 text-slate-600">{item.resolvedStandards.map(koreanChemicalDisplayName).join(' · ') || t('ops_an_no_resolution_yet')}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-500">{t('ops_an_no_search_data')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
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

function ReviewPanel({
  items,
  onDecision,
  decidingId,
}: {
  items: AnalyticsReviewCandidate[]
  onDecision: (
    item: AnalyticsReviewCandidate,
    status: 'approved' | 'rejected',
    draft: { notes: string; evidenceReference: string; proposedAlias: string; canonicalName: string; canonicalCas: string },
  ) => Promise<void>
  decidingId: string | null
}) {
  const { t, i18n } = useTranslation()
  type ReviewDraft = {
    notes: string
    evidenceReference: string
    proposedAlias: string
    canonicalName: string
    canonicalCas: string
  }
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({})
  const pending = items.filter((item) => item.status === 'pending')
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        {t('ops_an_review_note')}
      </div>
      {pending.map((item) => {
        const draft = drafts[item.id] || {
          notes: '',
          evidenceReference: '',
          proposedAlias: item.proposed_alias || '',
          canonicalName: item.canonical_name || '',
          canonicalCas: item.canonical_cas || '',
        }
        const setDraft = (next: Partial<typeof draft>) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, ...next } }))
        return (
          <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-slate-950">{koreanReviewDisplayText(item.title)}</h2>
                  <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700">{REVIEW_TYPE_LABELS[item.candidate_type]}</span>
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
              <button type="button" disabled={decidingId === item.id} onClick={() => void onDecision(item, 'rejected', draft)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><X className="h-4 w-4" /> {t('ops_an_reject')}</button>
              <button type="button" disabled={decidingId === item.id || (item.candidate_type === 'search_alias' && (!draft.proposedAlias.trim() || !draft.canonicalName.trim()))} onClick={() => void onDecision(item, 'approved', draft)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">{decidingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t('ops_an_approve')}</button>
            </div>
          </article>
        )
      })}
      {pending.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">{t('ops_an_no_candidates')}</div>}
    </div>
  )
}

function ExportPanel() {
  const { t } = useTranslation()
  const today = useMemo(() => new Date(), [])
  const initialFrom = useMemo(() => {
    const date = new Date(today)
    date.setDate(date.getDate() - 29)
    return dateInputValue(date)
  }, [today])
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(dateInputValue(today))
  const [reason, setReason] = useState(() => t('ops_an_default_reason'))
  const [outcome, setOutcome] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const runExport = async () => {
    setBusy(true)
    setMessage(null)
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
      setMessage(error instanceof Error ? error.message : t('ops_an_export_failed'))
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
        <label className="text-xs font-medium text-slate-600">{t('ops_an_export_reason')}<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /></label>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">{t('ops_an_export_no_pii')}</p>
        <button type="button" disabled={busy || reason.trim().length < 5 || !from || !to} onClick={() => void runExport()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {t('ops_an_export_csv')}</button>
      </div>
      {message && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{message}</p>}
    </section>
  )
}

function GovernancePanel({ governance }: { governance: AnalyticsGovernance }) {
  const { t, i18n } = useTranslation()
  const commercialization = governance.commercialization
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
      <section className={`rounded-xl border p-5 ${commercialization.externalProductEnabled ? 'border-red-300 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
        <div className="flex items-start gap-3">
          {commercialization.externalProductEnabled ? <ShieldAlert className="mt-0.5 h-6 w-6 text-red-700" /> : <ShieldCheck className="mt-0.5 h-6 w-6 text-emerald-700" />}
          <div>
            <h2 className="font-semibold text-slate-950">{t('ops_an_external_data', { state: commercialization.externalProductEnabled ? t('ops_an_allowed') : t('ops_an_blocked') })}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-700">{t('ops_an_external_note')}</p>
            <div className="mt-3 grid gap-2 text-xs text-slate-700 sm:grid-cols-3">
              <p className="rounded-lg bg-white/70 px-3 py-2">{t('ops_an_search_threshold')}<br /><strong>{t('ops_an_threshold_values', { count: commercialization.searchThreshold.events, users: commercialization.searchThreshold.users, labs: commercialization.searchThreshold.labs })}</strong></p>
              <p className="rounded-lg bg-white/70 px-3 py-2">{t('ops_an_mixture_threshold')}<br /><strong>{t('ops_an_threshold_values', { count: commercialization.mixtureThreshold.batches, users: commercialization.mixtureThreshold.users, labs: commercialization.mixtureThreshold.labs })}</strong></p>
              <p className="rounded-lg bg-white/70 px-3 py-2">{t('ops_an_agg_unit')}<br /><strong>{t('ops_an_monthly_only')}</strong></p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {[
                { label: t('ops_an_gate_agreement'), ready: commercialization.institutionDataAgreementReady },
                { label: t('ops_an_gate_reid'), ready: commercialization.reidentificationRiskReviewReady },
                { label: t('ops_an_gate_legal'), ready: commercialization.legalReviewReady },
              ].map((gate) => (
                <span key={gate.label} className={`rounded-full px-2.5 py-1 font-medium ${gate.ready ? 'bg-emerald-100 text-emerald-800' : 'bg-white/70 text-slate-600 ring-1 ring-slate-200'}`}>
                  {gate.label}: {gate.ready ? t('ops_an_done') : t('ops_an_not_done')}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
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
  const { t } = useTranslation()
  const [tab, setTab] = useState<AnalyticsTab>('overview')
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30)
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [governance, setGovernance] = useState<AnalyticsGovernance | null>(null)
  const [searches, setSearches] = useState<AnalyticsSearchItem[]>([])
  const [confusingSearches, setConfusingSearches] = useState<AnalyticsSearchItem[]>([])
  const [mixtures, setMixtures] = useState<AnalyticsMixtures | null>(null)
  const [reviews, setReviews] = useState<AnalyticsReviewCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [decidingId, setDecidingId] = useState<string | null>(null)
  const usesDateRange = tab === 'overview' || tab === 'searches' || tab === 'mixtures'

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const [summaryPayload, searchPayload, confusionPayload, mixturePayload, reviewPayload] = await Promise.all([
        loadAnalyticsSummary(days),
        loadAnalyticsSearches(days, 100, 'demand'),
        loadAnalyticsSearches(days, 100, 'confusion'),
        loadAnalyticsMixtures(days),
        loadAnalyticsReviews(),
      ])
      setSummary(summaryPayload.summary)
      setGovernance(summaryPayload.governance)
      setSearches(searchPayload)
      setConfusingSearches(confusionPayload)
      setMixtures(mixturePayload)
      setReviews(reviewPayload.items)
      setAccessDenied(false)
    } catch (loadError) {
      setAccessDenied(loadError instanceof OpsAnalyticsApiError && (loadError.status === 401 || loadError.status === 403))
      setError(loadError instanceof Error ? loadError.message : t('ops_an_load_failed'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [days, t])

  useEffect(() => { void load(true) }, [load])

  const decide = async (
    item: AnalyticsReviewCandidate,
    status: 'approved' | 'rejected',
    draft: { notes: string; evidenceReference: string; proposedAlias: string; canonicalName: string; canonicalCas: string },
  ) => {
    setDecidingId(item.id)
    setError(null)
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
      setReviews((current) => current.map((candidate) => candidate.id === item.id ? updated : candidate))
      if (governance) {
        setGovernance({
          ...governance,
          reviews: {
            ...governance.reviews,
            pending: Math.max(0, governance.reviews.pending - 1),
            [status]: governance.reviews[status] + 1,
          },
        })
      }
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : t('ops_an_decision_failed'))
    } finally {
      setDecidingId(null)
    }
  }

  if (loading) return <div className="flex min-h-[24rem] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>
  if (accessDenied) return <div className="p-5"><div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center"><ShieldAlert className="mx-auto h-9 w-9 text-amber-700" /><h2 className="mt-3 font-semibold text-slate-950">{t('ops_an_denied_title')}</h2><p className="mt-2 text-sm text-slate-600">{t('ops_an_denied_body')}</p></div></div>

  return (
    <div className="space-y-5 p-5 pb-16">
      {usesDateRange && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium text-slate-700">{t('ops_an_range')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 bg-white p-1">
              {PERIODS.map((period) => <button key={period} type="button" onClick={() => setDays(period)} className={`rounded-md px-3 py-1.5 text-xs font-medium ${days === period ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{t('ops_an_days', { count: period })}</button>)}
            </div>
            <button type="button" disabled={refreshing} onClick={() => void load()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">{refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {t('ops_an_refresh')}</button>
          </div>
        </div>
      )}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm" aria-label={t('ops_an_nav_label')}>
        {TABS.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium ${tab === item.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{t(item.labelKey)}</button>)}
      </nav>
      {tab === 'overview' && summary && <OverviewPanel summary={summary} days={days} />}
      {tab === 'searches' && <SearchesPanel demandItems={searches} confusionItems={confusingSearches} />}
      {tab === 'mixtures' && mixtures && <MixturesPanel data={mixtures} />}
      {tab === 'reviews' && <ReviewPanel items={reviews} onDecision={decide} decidingId={decidingId} />}
      {tab === 'governance' && governance && <GovernancePanel governance={governance} />}
      <div className="sr-only" aria-live="polite">{refreshing ? t('ops_an_refreshing') : ''}</div>
    </div>
  )
}
