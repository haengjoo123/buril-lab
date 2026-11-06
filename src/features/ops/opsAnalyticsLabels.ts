import i18n from '../../locales/i18n'
import type { AnalyticsReviewType, AnalyticsSummary } from '../../services/opsAnalyticsService'
import type { HandlingAction, WasteHazardFlag, WasteMatrix, WasteStreamCode } from '../../types'

export type OpsAnalyticsLabelMap = Readonly<Record<string, string>>

export const SEARCH_OUTCOME_LABELS: OpsAnalyticsLabelMap = {
  get matched() { return i18n.t('ops_label_out_matched') },
  get no_result() { return i18n.t('ops_label_out_no_result') },
  get invalid_query() { return i18n.t('ops_label_out_invalid_query') },
  get technical_error() { return i18n.t('ops_label_out_technical_error') },
  get legacy_success_unknown() { return i18n.t('ops_label_out_legacy_success_unknown') },
}

export const MATRIX_LABELS: Readonly<Record<WasteMatrix, string>> = {
  get aqueous() { return i18n.t('ops_label_mx_aqueous') },
  get organic_non_halogenated() { return i18n.t('ops_label_mx_organic_non_halogenated') },
  get organic_halogenated() { return i18n.t('ops_label_mx_organic_halogenated') },
  get mixed_biphasic() { return i18n.t('ops_label_mx_mixed_biphasic') },
  get solid_slurry() { return i18n.t('ops_label_mx_solid_slurry') },
  get unknown() { return i18n.t('ops_label_mx_unknown') },
}

export const WASTE_STREAM_LABELS: Readonly<Record<WasteStreamCode, string>> = {
  get ACID_AQUEOUS() { return i18n.t('ops_label_ws_acid_aqueous') },
  get ALKALI_AQUEOUS() { return i18n.t('ops_label_ws_alkali_aqueous') },
  get ORGANIC_HALOGENATED() { return i18n.t('ops_label_ws_organic_halogenated') },
  get ORGANIC_NON_HALOGENATED() { return i18n.t('ops_label_ws_organic_non_halogenated') },
  get HEAVY_METAL() { return i18n.t('ops_label_ws_heavy_metal') },
  get CYANIDE_SULFIDE() { return i18n.t('ops_label_ws_cyanide_sulfide') },
  get REACTIVE_OXIDIZER() { return i18n.t('ops_label_ws_reactive_oxidizer') },
  get SOLID_CONTAMINATED() { return i18n.t('ops_label_ws_solid_contaminated') },
  get AQUEOUS_OTHER() { return i18n.t('ops_label_ws_aqueous_other') },
  get SPECIAL_REVIEW() { return i18n.t('ops_label_ws_special_review') },
}

export const HANDLING_ACTION_LABELS: Readonly<Record<HandlingAction, string>> = {
  get container_deposit() { return i18n.t('ops_label_ha_container_deposit') },
  get isolated() { return i18n.t('ops_label_ha_isolated') },
  get handover() { return i18n.t('ops_label_ha_handover') },
}

export const HAZARD_FLAG_LABELS: Readonly<Record<WasteHazardFlag, string>> = {
  get FLAMMABLE() { return i18n.t('ops_label_hz_flammable') },
  get OXIDIZER() { return i18n.t('ops_label_hz_oxidizer') },
  get EXPLOSIVE() { return i18n.t('ops_label_hz_explosive') },
  get SELF_REACTIVE() { return i18n.t('ops_label_hz_self_reactive') },
  get WATER_REACTIVE() { return i18n.t('ops_label_hz_water_reactive') },
  get PYROPHORIC() { return i18n.t('ops_label_hz_pyrophoric') },
  get CORROSIVE() { return i18n.t('ops_label_hz_corrosive') },
  get ACUTE_TOXIC() { return i18n.t('ops_label_hz_acute_toxic') },
  get CMR() { return i18n.t('ops_label_hz_cmr') },
  get ENVIRONMENTAL_HAZARD() { return i18n.t('ops_label_hz_environmental_hazard') },
  get CYANIDE() { return i18n.t('ops_label_hz_cyanide') },
  get SULFIDE() { return i18n.t('ops_label_hz_sulfide') },
  get HEAVY_METAL() { return i18n.t('ops_label_hz_heavy_metal') },
  get HYDROFLUORIC_ACID() { return i18n.t('ops_label_hz_hydrofluoric_acid') },
  get FLUORIDE() { return i18n.t('ops_label_hz_fluoride') },
  get REACTIVE() { return i18n.t('ops_label_hz_reactive') },
  get UNKNOWN_COMPONENT() { return i18n.t('ops_label_hz_unknown_component') },
}

export const REVIEW_TYPE_LABELS: Readonly<Record<AnalyticsReviewType, string>> = {
  get search_alias() { return i18n.t('ops_label_rv_search_alias') },
  get safety_rule() { return i18n.t('ops_label_rv_safety_rule') },
  get education_content() { return i18n.t('ops_label_rv_education_content') },
}

export function opsAnalyticsLabel(
  value: string,
  labels: OpsAnalyticsLabelMap,
  fallback = i18n.t('ops_label_other'),
): string {
  return labels[value] ?? fallback
}

/**
 * Korean names sometimes arrive as "한국어명 (English name)". The English
 * parenthetical is useful in storage and exports, but duplicates the primary
 * label in the Korean operator UI. Formulae and standards such as (NaOH),
 * (HF), (CAS 67-64-1), and (pH 7) remain visible.
 */
export function koreanChemicalDisplayName(value: string): string {
  const trimmed = value.trim()
  if (!/[가-힣]/u.test(trimmed)) return trimmed

  return trimmed
    .replace(/\s*\(([^()]*)\)/g, (match, parenthetical: string) => {
      const isEnglishName = !/[가-힣]/u.test(parenthetical) && /[a-z]{3}/.test(parenthetical)
      return isEnglishName ? '' : match
    })
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function koreanReviewDisplayText(value: string): string {
  return koreanChemicalDisplayName(value).replaceAll('골든셋', '검증 기준표')
}

export function canonicalComponentDisplayKey(value: string): string {
  const casMatch = /^cas:(.+)$/i.exec(value)
  if (casMatch) return `CAS ${casMatch[1]}`

  const nameMatch = /^name:(.+)$/i.exec(value)
  if (nameMatch) return `${i18n.t('ops_label_name_prefix')} ${koreanChemicalDisplayName(nameMatch[1])}`

  return i18n.t('ops_label_id_needs_check')
}

/**
 * Event-count windows in the search table. The search SQL only reads events inside the selected
 * period (BL:2526-2534), so a window longer than the period would just repeat the period total.
 */
export const SEARCH_EVENT_WINDOWS = [7, 30, 90] as const
export type SearchEventWindow = (typeof SEARCH_EVENT_WINDOWS)[number]

export function searchEventWindows(periodDays: number): SearchEventWindow[] {
  return SEARCH_EVENT_WINDOWS.filter((window) => window <= periodDays)
}

/** Operating baseline for the estimated ingestion failure rate (SEARCH_BATCH_ANALYTICS_RUNBOOK.md, 운영 기준). */
export const INGESTION_FAILURE_BASELINE_PERCENT = 1

export type IngestionFailureStatus = 'normal' | 'attention' | 'unknown'

export function ingestionFailureStatus(ratePercent: number | undefined): IngestionFailureStatus {
  if (typeof ratePercent !== 'number' || !Number.isFinite(ratePercent) || ratePercent < 0) return 'unknown'
  return ratePercent < INGESTION_FAILURE_BASELINE_PERCENT ? 'normal' : 'attention'
}

const DAY_MS = 86_400_000
// Asia/Seoul is a fixed UTC+9 offset (no daylight saving time since 1988).
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1_000

/** Calendar date (YYYY-MM-DD) in Asia/Seoul, the day boundary the analytics SQL groups by. */
export function seoulDateString(date: Date): string {
  return new Date(date.getTime() + SEOUL_OFFSET_MS).toISOString().slice(0, 10)
}

export type DailyTrendPoint = AnalyticsSummary['dailyTrend'][number]

/**
 * The summary SQL returns only the dates that had searches (BL:2665-2673). This fills every
 * Asia/Seoul date the selected window touches, from the date of (now - periodDays) through today,
 * with zero rows so quiet days stay visible. Dates the server sent outside that range are kept.
 */
export function fillDailyTrend(
  points: readonly DailyTrendPoint[],
  periodDays: number,
  now: Date = new Date(),
): DailyTrendPoint[] {
  const days = Number.isFinite(periodDays) ? Math.min(Math.max(Math.trunc(periodDays), 1), 365) : 30
  const byDate = new Map<string, DailyTrendPoint>()
  for (const point of points) {
    const existing = byDate.get(point.date)
    byDate.set(point.date, existing
      ? { date: point.date, searches: existing.searches + point.searches, noResults: existing.noResults + point.noResults }
      : { date: point.date, searches: point.searches, noResults: point.noResults })
  }
  const nowMs = now.getTime()
  if (Number.isFinite(nowMs)) {
    const first = Date.parse(`${seoulDateString(new Date(nowMs - days * DAY_MS))}T00:00:00Z`)
    const last = Date.parse(`${seoulDateString(now)}T00:00:00Z`)
    for (let day = first; day <= last; day += DAY_MS) {
      const date = new Date(day).toISOString().slice(0, 10)
      if (!byDate.has(date)) byDate.set(date, { date, searches: 0, noResults: 0 })
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}
