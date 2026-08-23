import { useCallback, useEffect, useMemo, useState } from 'react'
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
const TABS: Array<{ id: AnalyticsTab; label: string }> = [
  { id: 'overview', label: '개요' },
  { id: 'searches', label: '검색 분석' },
  { id: 'mixtures', label: '배치 분석' },
  { id: 'reviews', label: '개선 후보 검토' },
  { id: 'governance', label: '데이터 관리' },
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
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">
      <AlertTriangle className="h-3 w-3" /> 데이터가 적어 참고용
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
  if (value.median === undefined) return <span className="text-slate-400">입력 없음</span>
  const unit = suffix ? ` ${suffix}` : ''
  if (compact) return <span>중앙값 {asNumber(value.median)}{unit}</span>
  return (
    <span>
      중앙값 {asNumber(value.median)}{unit} · 사분위 범위 {asNumber(value.q1)}–{asNumber(value.q3)}{unit}
      {value.p10 !== undefined && <> · 10~90% 범위 {asNumber(value.p10)}–{asNumber(value.p90)}{unit}</>}
    </span>
  )
}

function trendDateLabel(value: string): { short: string; long: string } {
  const [year, month, day] = value.split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return { short: value, long: value }
  return { short: `${month}/${day}`, long: `${year}년 ${month}월 ${day}일` }
}

function OverviewPanel({ summary, days }: { summary: AnalyticsSummary; days: number }) {
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
        <MetricCard label="제출된 검색" value={`${summary.submittedSearches.toLocaleString('ko-KR')}건`} detail="검색 버튼을 눌러 실행한 횟수" />
        <MetricCard label="검색한 이용자" value={`${summary.uniqueUsers.toLocaleString('ko-KR')}명`} detail="로그인·비회원 이용자 합계" />
        <MetricCard label="결과를 찾지 못한 비율" value={asPercent(summary.noResultRate)} detail="검색 결과가 없었던 경우" />
        <MetricCard label="검색 후 배치 추가율" value={asPercent(summary.batchConversionRate)} detail="검색한 시약을 폐액 배치에 추가한 비율" />
        <MetricCard label="저장된 최종 배치" value={`${summary.finalizedBatches.toLocaleString('ko-KR')}건`} detail="최종 기록까지 완료된 폐액 배치" />
        <MetricCard label="실제로 혼합된 배치" value={`${summary.mixedBatches.toLocaleString('ko-KR')}건`} detail="이미 섞인 것으로 확인된 배치" />
        <MetricCard label="검색 오류율" value={asPercent(summary.technicalErrorRate)} detail="검색 처리 중 기술 문제가 발생한 비율" />
        <MetricCard label="분석된 배치 성분" value={`${summary.dataCompleteness.itemCount.toLocaleString('ko-KR')}개`} detail={`CAS 확인 ${asPercent(summary.dataCompleteness.casPercent)} · 농도 입력 ${asPercent(summary.dataCompleteness.concentrationPercent)} · 부피 입력 ${asPercent(summary.dataCompleteness.volumePercent)}`} />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-blue-600" />
            <div>
              <h2 className="font-semibold text-slate-950">일별 검색량</h2>
              <p className="mt-1 text-xs text-slate-500">검색이 있었던 날짜별 제출 건수입니다.</p>
            </div>
          </div>
          <div className="text-right text-xs leading-5 text-slate-500">
            <p>기간 합계 <strong className="text-slate-800">{trendTotal.toLocaleString('ko-KR')}건</strong> · 하루 평균 <strong className="text-slate-800">{(trendTotal / days).toFixed(1)}건</strong></p>
            {peak && <p>가장 많았던 날 {trendDateLabel(peak.date).short} · {peak.searches.toLocaleString('ko-KR')}건</p>}
          </div>
        </div>
        {trend.length === 0 ? (
          <p className="mt-6 rounded-lg bg-slate-50 py-10 text-center text-sm text-slate-500">선택한 기간에 검색 기록이 없습니다.</p>
        ) : (
          <div className="mt-5 overflow-x-auto pb-2">
            <div className="flex h-56 items-end gap-2" style={{ minWidth: `${Math.max(540, trend.length * 58)}px` }}>
              {trend.map((point) => {
                const date = trendDateLabel(point.date)
                return (
                  <div key={point.date} className="group flex h-full min-w-12 flex-1 flex-col items-center justify-end" title={`${date.long} · 검색 ${point.searches}건${point.noResults > 0 ? ` · 결과 없음 ${point.noResults}건` : ''}`}>
                    <span className="mb-2 text-xs font-semibold tabular-nums text-slate-800">{point.searches.toLocaleString('ko-KR')}건</span>
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
  const components = [
    ['결과 없음', item.components.noResultRate],
    ['다시 검색함', item.components.reformulationRate],
    ['스캔 결과를 수정함', item.components.scanCorrectionRate],
    ['해결되지 않음', item.components.unresolvedRate],
  ] as const
  return (
    <div className="grid gap-1 text-[11px] text-slate-600">
      {components.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3"><span>{label}</span><span className="font-medium text-slate-900">{asPercent(value)}</span></div>
      ))}
    </div>
  )
}

function QueryVariants({ query, variants }: { query: string; variants: string[] }) {
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
      다른 검색 표현: {visible.join(' · ')}{useful.length > visible.length ? ` 외 ${useful.length - visible.length}개` : ''}
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
  const [ranking, setRanking] = useState<'demand' | 'confusion'>('demand')
  const items = ranking === 'demand' ? demandItems : confusionItems
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="font-semibold text-slate-950">자주 찾는 검색어와 해결이 어려운 검색어</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">혼동도는 결과 없음·재검색·수동 수정·미해결을 반영한 100점 기준입니다.</p>
        </div>
        <div className="flex rounded-lg border border-slate-200 p-1 text-xs font-medium">
          <button type="button" onClick={() => setRanking('demand')} className={`rounded-md px-3 py-1.5 ${ranking === 'demand' ? 'bg-slate-950 text-white' : 'text-slate-600'}`}>많이 검색한 순</button>
          <button type="button" onClick={() => setRanking('confusion')} className={`rounded-md px-3 py-1.5 ${ranking === 'confusion' ? 'bg-slate-950 text-white' : 'text-slate-600'}`}>해결이 어려운 순</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">검색어</th>
              <th className="px-4 py-3 font-medium">검색량</th>
              <th className="px-4 py-3 font-medium">기간별 검색량</th>
              <th className="px-4 py-3 font-medium">혼동도</th>
              <th className="px-4 py-3 font-medium">혼동 원인</th>
              <th className="px-4 py-3 font-medium">해결된 표준 시약</th>
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
                  <div className="text-lg font-semibold text-slate-950">{item.demandIndex.toLocaleString('ko-KR')}건</div>
                  <div className="text-xs text-slate-500">{item.uniqueSubjects}명이 검색</div>
                </td>
                <td className="px-4 py-4 text-xs leading-5 text-slate-700"><span className="block">7일 {item.events7d}건</span><span className="block">30일 {item.events30d}건</span><span className="block">90일 {item.events90d}건</span></td>
                <td className="px-4 py-4">
                  <span className={`inline-flex rounded-full px-2.5 py-1 font-semibold ${item.confusionScore >= 50 ? 'bg-red-50 text-red-700' : item.confusionScore >= 25 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {item.confusionScore.toFixed(1)}점
                  </span>
                  <div className="mt-1 text-xs text-slate-500">결과 없음 {item.noResultCount}건 · 기술 오류 {item.technicalErrorCount}건</div>
                </td>
                <td className="px-4 py-4"><ConfusionComponents item={item} /></td>
                <td className="px-4 py-4 text-xs leading-5 text-slate-600">{item.resolvedStandards.map(koreanChemicalDisplayName).join(' · ') || '아직 해결 기록 없음'}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-500">선택 기간에 검색 데이터가 없습니다.</td></tr>
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
  const entries = Object.entries(value).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return <span>없음</span>
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
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="별도로 처리된 배치" value={`${data.excludedStates.separate.toLocaleString('ko-KR')}건`} detail="혼합 조합 통계에는 포함하지 않음" />
        <MetricCard label="혼합 여부를 모르는 배치" value={`${data.excludedStates.unknown.toLocaleString('ko-KR')}건`} detail="혼합 조합 통계에는 포함하지 않음" />
        <MetricCard label="혼합 후 격리" value={asPercent(data.handlingSummary.isolatedRate)} detail={`전체 ${data.handlingSummary.total}건 중 ${data.handlingSummary.isolated}건`} />
        <MetricCard label="혼합 후 담당자 인계" value={asPercent(data.handlingSummary.handoverRate)} detail={`전체 ${data.handlingSummary.total}건 중 ${data.handlingSummary.handover}건`} />
      </div>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-950">실제로 함께 섞인 성분</h2>
          <p className="mt-1 text-xs text-slate-500">혼합 빈도만으로 위험성을 판단하지 않습니다. 안전규칙 변경 전에는 근거 자료와 담당자 검토가 필요합니다.</p>
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
                    위험 특성: {pair.hazardFlags.map((flag) => opsAnalyticsLabel(flag, HAZARD_FLAG_LABELS, '기타 위험 특성')).join(', ')}
                  </p>
                )}
              </div>
              <div className="text-sm text-slate-600">
                <p><strong className="text-slate-950">{pair.batchCount}</strong>건 · {pair.uniqueUsers}명 · {pair.uniqueLabs > 0 ? `${pair.uniqueLabs}개 연구실` : '연구실 정보 없음'}</p>
                <p className="mt-1">검색에서 바로 추가된 배치 {pair.searchLinkedBatchCount}건</p>
              </div>
              <div className="space-y-1 text-xs leading-5 text-slate-600">
                <p>최종 pH: <DistributionText value={pair.phDistribution} compact={pair.smallSample} /></p>
                <p>합산 부피: <DistributionText value={pair.volumeDistributionMl} suffix="mL" compact={pair.smallSample} /></p>
                {Object.entries(pair.concentrationDistributions).map(([unit, distribution]) => (
                  <p key={unit}>농도 ({unit}): <DistributionText value={distribution} compact={pair.smallSample} /></p>
                ))}
                <p>용매·형태: <KeyValueList value={pair.matrices} labels={MATRIX_LABELS} fallback="미분류" /></p>
                <p>폐액 분류: <KeyValueList value={pair.streams} labels={WASTE_STREAM_LABELS} fallback="미분류" /></p>
                <p>처리 방식: <KeyValueList value={pair.actions} labels={HANDLING_ACTION_LABELS} fallback="기타 처리" /></p>
              </div>
            </article>
          ))}
          {data.pairs.length === 0 && <p className="p-10 text-center text-sm text-slate-500">분석할 실제 혼합 배치가 없습니다.</p>}
        </div>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-950">다성분 조합</h2>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {data.combinations.map((combination) => (
            <div key={combination.key} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex items-start justify-between gap-3"><span className="font-medium text-slate-900">{koreanChemicalDisplayName(combination.name)}</span><span className="shrink-0 text-slate-600">{combination.batchCount}건</span></div>
              {combination.smallSample && <div className="mt-2"><SmallSampleBadge /></div>}
            </div>
          ))}
          {data.combinations.length === 0 && <p className="text-sm text-slate-500">다성분 조합이 없습니다.</p>}
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
        검색 별칭은 승인한 경우에만 검색 기능에 반영됩니다. 혼합 관련 후보를 승인해도 안전규칙이 자동으로 바뀌지는 않습니다.
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
                  <span className="text-xs text-slate-500">관련 기록 {item.sample_count}건</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{koreanReviewDisplayText(item.summary)}</p>
                {item.proposed_alias && <p className="mt-2 text-xs text-slate-600">별칭 <strong>{item.proposed_alias}</strong> → {item.canonical_name ? koreanChemicalDisplayName(item.canonical_name) : '표준명 미확정'} {item.canonical_cas ? `(CAS ${item.canonical_cas})` : ''}</p>}
              </div>
              <time className="text-xs text-slate-500">후보 생성 {new Date(item.created_at).toLocaleDateString('ko-KR')}</time>
            </div>
            {item.candidate_type === 'search_alias' && (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <label className="text-xs font-medium text-slate-600">승인할 별칭
                  <input value={draft.proposedAlias} onChange={(event) => setDraft({ proposedAlias: event.target.value })} maxLength={200} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-500" />
                </label>
                <label className="text-xs font-medium text-slate-600">표준 시약명
                  <input value={draft.canonicalName} onChange={(event) => setDraft({ canonicalName: event.target.value })} maxLength={300} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-500" placeholder="승인 전에 반드시 확인" />
                </label>
                <label className="text-xs font-medium text-slate-600">표준 CAS(선택)
                  <input value={draft.canonicalCas} onChange={(event) => setDraft({ canonicalCas: event.target.value })} maxLength={32} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-500" placeholder="예: 67-64-1" />
                </label>
              </div>
            )}
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-xs font-medium text-slate-600">검토 메모
                <textarea value={draft.notes} onChange={(event) => setDraft({ notes: event.target.value })} maxLength={4000} rows={3} className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-blue-500" placeholder="판단 근거와 후속 작업을 기록하세요." />
              </label>
              <label className="text-xs font-medium text-slate-600">근거 자료
                <input value={draft.evidenceReference} onChange={(event) => setDraft({ evidenceReference: event.target.value })} maxLength={1000} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-500" placeholder="문헌 링크 또는 내부 업무 번호" />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={decidingId === item.id} onClick={() => void onDecision(item, 'rejected', draft)} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><X className="h-4 w-4" /> 거절</button>
              <button type="button" disabled={decidingId === item.id || (item.candidate_type === 'search_alias' && (!draft.proposedAlias.trim() || !draft.canonicalName.trim()))} onClick={() => void onDecision(item, 'approved', draft)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">{decidingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} 승인</button>
            </div>
          </article>
        )
      })}
      {pending.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">검토할 개선 후보가 없습니다.</div>}
    </div>
  )
}

function ExportPanel() {
  const today = useMemo(() => new Date(), [])
  const initialFrom = useMemo(() => {
    const date = new Date(today)
    date.setDate(date.getDate() - 29)
    return dateInputValue(date)
  }, [today])
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(dateInputValue(today))
  const [reason, setReason] = useState('내부 검색·배치 품질 검토')
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
      setMessage('감사 기록을 남기고 CSV 파일을 내보냈습니다.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'CSV 내보내기에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2"><Download className="h-5 w-5 text-blue-600" /><h2 className="font-semibold text-slate-950">비식별 분석 데이터 내보내기</h2></div>
      <p className="mt-2 text-xs leading-5 text-slate-500">개인과 연구실을 알아볼 수 있는 정보는 제외합니다. 한 번에 최대 90일·5만 건까지 내보낼 수 있으며 모든 내보내기 기록은 감사 로그에 남습니다.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <label className="text-xs font-medium text-slate-600">시작일<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /></label>
        <label className="text-xs font-medium text-slate-600">종료일<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /></label>
        <label className="text-xs font-medium text-slate-600">검색 결과<select value={outcome} onChange={(event) => setOutcome(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"><option value="">전체</option>{Object.entries(SEARCH_OUTCOME_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-xs font-medium text-slate-600">내보내는 이유<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm" /></label>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">사용자와 연구실을 식별할 수 있는 정보는 포함되지 않습니다.</p>
        <button type="button" disabled={busy || reason.trim().length < 5 || !from || !to} onClick={() => void runExport()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} CSV 내보내기</button>
      </div>
      {message && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{message}</p>}
    </section>
  )
}

function GovernancePanel({ governance }: { governance: AnalyticsGovernance }) {
  const commercialization = governance.commercialization
  const expiringGuestDetail = governance.collection.guestEventsExpiringIn7Days > 0
    ? `${governance.collection.guestEventsExpiringIn7Days}건은 7일 안에 자동 삭제`
    : '7일 안에 자동 삭제될 기록 없음'
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="현재 보관 중인 로그인 검색" value={`${governance.collection.authenticatedEvents.toLocaleString('ko-KR')}건`} />
        <MetricCard label="현재 보관 중인 비회원 검색" value={`${governance.collection.guestEvents.toLocaleString('ko-KR')}건`} detail={expiringGuestDetail} />
        <MetricCard label="삭제 요청 처리" value={`${governance.deletions.requestCount.toLocaleString('ko-KR')}건`} detail={`검색 ${governance.deletions.deletedEvents}건 · 후속 행동 ${governance.deletions.deletedActions}건 삭제`} />
        <MetricCard label="CSV 내보내기" value={`${governance.exports.count.toLocaleString('ko-KR')}회`} detail={governance.exports.lastExportAt ? `최근 ${new Date(governance.exports.lastExportAt).toLocaleString('ko-KR')}` : '아직 내보낸 기록 없음'} />
      </div>
      <section className={`rounded-xl border p-5 ${commercialization.externalProductEnabled ? 'border-red-300 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
        <div className="flex items-start gap-3">
          {commercialization.externalProductEnabled ? <ShieldAlert className="mt-0.5 h-6 w-6 text-red-700" /> : <ShieldCheck className="mt-0.5 h-6 w-6 text-emerald-700" />}
          <div>
            <h2 className="font-semibold text-slate-950">외부 데이터 제공: {commercialization.externalProductEnabled ? '허용됨' : '차단됨'}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-700">기관 약정·재식별 위험평가·법률 검토가 모두 끝나기 전에는 데이터를 외부에 제공하지 않습니다. 현재와 과거 데이터도 자동으로 포함되지 않습니다.</p>
            <div className="mt-3 grid gap-2 text-xs text-slate-700 sm:grid-cols-3">
              <p className="rounded-lg bg-white/70 px-3 py-2">검색 공개 최소 기준<br /><strong>{commercialization.searchThreshold.events}건 · {commercialization.searchThreshold.users}명 · {commercialization.searchThreshold.labs}개 연구실</strong></p>
              <p className="rounded-lg bg-white/70 px-3 py-2">혼합 공개 최소 기준<br /><strong>{commercialization.mixtureThreshold.batches}건 · {commercialization.mixtureThreshold.users}명 · {commercialization.mixtureThreshold.labs}개 연구실</strong></p>
              <p className="rounded-lg bg-white/70 px-3 py-2">제공 가능한 집계 단위<br /><strong>월별 통계만</strong></p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {[
                { label: '기관 데이터 약정', ready: commercialization.institutionDataAgreementReady },
                { label: '재식별 위험평가', ready: commercialization.reidentificationRiskReviewReady },
                { label: '법률 검토', ready: commercialization.legalReviewReady },
              ].map((gate) => (
                <span key={gate.label} className={`rounded-full px-2.5 py-1 font-medium ${gate.ready ? 'bg-emerald-100 text-emerald-800' : 'bg-white/70 text-slate-600 ring-1 ring-slate-200'}`}>
                  {gate.label}: {gate.ready ? '완료' : '미완료'}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard label="공개 기준을 충족한 검색" value={`${governance.monthlyRollups.externalSearchCells.toLocaleString('ko-KR')}개`} detail={`전체 월간 검색 집계 ${governance.monthlyRollups.searchCells.toLocaleString('ko-KR')}개`} />
        <MetricCard label="공개 기준을 충족한 혼합" value={`${governance.monthlyRollups.externalMixtureCells.toLocaleString('ko-KR')}개`} detail={`전체 월간 혼합 집계 ${governance.monthlyRollups.mixtureCells.toLocaleString('ko-KR')}개`} />
        <MetricCard label="검토할 개선 후보" value={`${governance.reviews.pending.toLocaleString('ko-KR')}건`} detail={`승인 ${governance.reviews.approved}건 · 거절 ${governance.reviews.rejected}건`} />
      </div>
      <ExportPanel />
    </div>
  )
}

export function OpsAnalyticsView() {
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
      setError(loadError instanceof Error ? loadError.message : '분석 데이터를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [days])

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
      setError(decisionError instanceof Error ? decisionError.message : '검토 결정을 저장하지 못했습니다.')
    } finally {
      setDecidingId(null)
    }
  }

  if (loading) return <div className="flex min-h-[24rem] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>
  if (accessDenied) return <div className="p-5"><div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center"><ShieldAlert className="mx-auto h-9 w-9 text-amber-700" /><h2 className="mt-3 font-semibold text-slate-950">운영자 분석 권한이 필요합니다</h2><p className="mt-2 text-sm text-slate-600">운영자 허용목록과 현재 로그인 계정을 확인해 주세요.</p></div></div>

  return (
    <div className="space-y-5 p-5 pb-16">
      {usesDateRange && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium text-slate-700">조회 기간</p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-slate-200 bg-white p-1">
              {PERIODS.map((period) => <button key={period} type="button" onClick={() => setDays(period)} className={`rounded-md px-3 py-1.5 text-xs font-medium ${days === period ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{period}일</button>)}
            </div>
            <button type="button" disabled={refreshing} onClick={() => void load()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">{refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} 새로고침</button>
          </div>
        </div>
      )}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm" aria-label="분석 화면">
        {TABS.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium ${tab === item.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{item.label}</button>)}
      </nav>
      {tab === 'overview' && summary && <OverviewPanel summary={summary} days={days} />}
      {tab === 'searches' && <SearchesPanel demandItems={searches} confusionItems={confusingSearches} />}
      {tab === 'mixtures' && mixtures && <MixturesPanel data={mixtures} />}
      {tab === 'reviews' && <ReviewPanel items={reviews} onDecision={decide} decidingId={decidingId} />}
      {tab === 'governance' && governance && <GovernancePanel governance={governance} />}
      <div className="sr-only" aria-live="polite">{refreshing ? '분석 데이터를 갱신하는 중입니다.' : ''}</div>
    </div>
  )
}
