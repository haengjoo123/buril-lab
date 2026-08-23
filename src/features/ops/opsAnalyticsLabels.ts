import type { AnalyticsReviewType } from '../../services/opsAnalyticsService'
import type { HandlingAction, WasteHazardFlag, WasteMatrix, WasteStreamCode } from '../../types'

export type OpsAnalyticsLabelMap = Readonly<Record<string, string>>

export const SEARCH_OUTCOME_LABELS: OpsAnalyticsLabelMap = {
  matched: '결과 있음',
  no_result: '결과 없음',
  invalid_query: '잘못된 검색어',
  technical_error: '기술 오류',
  legacy_success_unknown: '이전 검색(결과 미확인)',
}

export const MATRIX_LABELS: Readonly<Record<WasteMatrix, string>> = {
  aqueous: '물·수용액',
  organic_non_halogenated: '비할로겐 유기용매',
  organic_halogenated: '할로겐 유기용매',
  mixed_biphasic: '혼합용매·두 층',
  solid_slurry: '고체·슬러리',
  unknown: '미확인',
}

export const WASTE_STREAM_LABELS: Readonly<Record<WasteStreamCode, string>> = {
  ACID_AQUEOUS: '산성 수계 폐액',
  ALKALI_AQUEOUS: '알칼리성 수계 폐액',
  ORGANIC_HALOGENATED: '할로겐 유기용매 폐액',
  ORGANIC_NON_HALOGENATED: '비할로겐 유기용매 폐액',
  HEAVY_METAL: '중금속 폐액',
  CYANIDE_SULFIDE: '시안·황화물 폐액',
  REACTIVE_OXIDIZER: '반응성·산화성 폐기물',
  SOLID_CONTAMINATED: '오염 고체·슬러리',
  AQUEOUS_OTHER: '기타 수계 폐액',
  SPECIAL_REVIEW: '별도 검토 폐기물',
}

export const HANDLING_ACTION_LABELS: Readonly<Record<HandlingAction, string>> = {
  container_deposit: '폐액통 입고',
  isolated: '격리',
  handover: '담당자 인계',
}

export const HAZARD_FLAG_LABELS: Readonly<Record<WasteHazardFlag, string>> = {
  FLAMMABLE: '인화성',
  OXIDIZER: '산화성',
  EXPLOSIVE: '폭발성',
  SELF_REACTIVE: '자기반응성',
  WATER_REACTIVE: '수반응성',
  PYROPHORIC: '자연발화성',
  CORROSIVE: '부식성',
  ACUTE_TOXIC: '급성독성',
  CMR: '발암성·생식독성',
  ENVIRONMENTAL_HAZARD: '환경유해성',
  CYANIDE: '시안',
  SULFIDE: '황화물',
  HEAVY_METAL: '중금속',
  HYDROFLUORIC_ACID: '불산(HF)',
  FLUORIDE: '불화물',
  REACTIVE: '반응성',
  UNKNOWN_COMPONENT: '미상 성분',
}

export const REVIEW_TYPE_LABELS: Readonly<Record<AnalyticsReviewType, string>> = {
  search_alias: '검색 별칭',
  safety_rule: '안전규칙 검토',
  education_content: '교육 콘텐츠',
}

export function opsAnalyticsLabel(
  value: string,
  labels: OpsAnalyticsLabelMap,
  fallback = '기타',
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
  if (nameMatch) return `명칭 ${koreanChemicalDisplayName(nameMatch[1])}`

  return '식별값 확인 필요'
}
