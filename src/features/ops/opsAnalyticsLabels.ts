import i18n from '../../locales/i18n'
import type { AnalyticsReviewType } from '../../services/opsAnalyticsService'
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
