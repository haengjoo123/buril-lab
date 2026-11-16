import {
  evaluateRegulationApplicability,
  isHazardousChemicalCategory,
  type ChemicalRegulationCategory,
  type ChemicalRegulationEntry,
  type RegulationApplicability,
} from './chemicalRegulations'

/**
 * What a lab has to do with a substance because of its 화학물질관리법 class.
 *
 * A hand-checked static table on purpose, like fatalToxicityDilutionLimits:
 * every line shown to researchers traces to a legal text someone read. The
 * clauses, what was left out and why are in
 * docs/operations/regulation-obligations-sources.md. Generic lab rules that
 * apply to every chemical (보호구, 음식물, 밀폐, 운반) are deliberately not
 * repeated here; this card only says what this substance's class changes.
 */

export type RegulationObligationId =
  | 'do_not_use_banned'
  | 'check_permit'
  | 'check_restricted_use'
  | 'store_locked'
  | 'separate_storage'
  | 'label_container'

export interface RegulationObligationSource {
  /** Short citation shown to users, e.g. "화학물질관리법 제16조". */
  citation: string
  url?: string
  /** ISO date the citation was read against the legal text. */
  checkedAt: string
}

export interface RegulationObligationRule {
  id: RegulationObligationId
  categories: readonly ChemicalRegulationCategory[]
  /**
   * For classes published with labelled thresholds ("인체급성유해성 : 1%, 생태유해성 : 1%"),
   * only thresholds whose label matches trigger this duty.
   */
  thresholdLabel?: RegExp
  text: { ko: string; en: string }
  source: RegulationObligationSource
}

export type RegulationObligationCondition =
  | { kind: 'always' }
  /** Every triggering class has a concentration rule and none was entered. */
  | { kind: 'concentration'; lowestPercent: number }

export interface RegulationObligation {
  id: RegulationObligationId
  text: { ko: string; en: string }
  source: RegulationObligationSource
  /** The substance's classes that trigger this duty. */
  categories: ChemicalRegulationCategory[]
  condition: RegulationObligationCondition
}

export const REGULATION_OBLIGATIONS_CHECKED_AT = '2026-11-16'

/**
 * 유해화학물질 (법 제2조제7호): 인체급성·인체만성·생태유해성물질과 사고대비물질.
 * 허가·제한·금지물질 are not 유해화학물질 by themselves; when such a substance
 * is also hazardous, KECO lists that class as a separate entry.
 */
const HAZARDOUS_SUBSTANCE_CLASSES: readonly ChemicalRegulationCategory[] = [
  'human_eco_hazard',
  'acute_toxic',
  'chronic_toxic',
  'eco_toxic',
  'toxic',
  'accident_preparedness',
]

/** Classes toxic to people, the subject of the 일상점검표 locked-storage item. */
const HUMAN_TOXIC_CLASSES: readonly ChemicalRegulationCategory[] = [
  'human_eco_hazard',
  'acute_toxic',
  'chronic_toxic',
  'toxic',
]

const HWA_LAW = 'https://www.law.go.kr/법령/화학물질관리법'
const HWA_DECREE = 'https://www.law.go.kr/법령/화학물질관리법시행령'
const LAB_INSPECTION_RULE = 'https://www.law.go.kr/행정규칙/연구실안전점검및정밀안전진단에관한지침'
const checkedAt = REGULATION_OBLIGATIONS_CHECKED_AT

export const REGULATION_OBLIGATION_RULES: readonly RegulationObligationRule[] = [
  {
    id: 'do_not_use_banned',
    categories: ['banned'],
    text: {
      ko: '금지물질이에요. 허가를 받아 공급된 시험·연구용 시약인지 기관 안전 부서에 확인한 뒤 쓰세요.',
      en: 'Banned substance. Check with your safety office that it was supplied as a permitted test or research reagent before using it.',
    },
    source: { citation: '화학물질관리법 제18조제1항, 같은 법 시행규칙 제14조', url: `${HWA_LAW}/제18조`, checkedAt },
  },
  {
    id: 'check_permit',
    categories: ['permitted'],
    text: {
      ko: '허가물질이에요. 연구용으로 쓰기 전에 신고 대상인지 기관 안전 부서에 확인하세요.',
      en: 'Permitted substance. Before research use, ask your safety office whether it has to be reported.',
    },
    source: { citation: '화학물질관리법 제19조, 같은 법 시행령 제9조의2', url: `${HWA_LAW}/제19조`, checkedAt },
  },
  {
    id: 'check_restricted_use',
    categories: ['restricted'],
    text: {
      ko: '제한된 용도로는 쓸 수 없어요. 연구용 시약으로 쓰는 것은 신고하지 않아도 돼요.',
      en: 'Not allowed for its restricted uses. Using it as a research reagent needs no report.',
    },
    source: { citation: '화학물질관리법 제18조제2항·제5항, 같은 법 시행령 제8조의2', url: `${HWA_DECREE}/제8조의2`, checkedAt },
  },
  {
    id: 'store_locked',
    categories: HUMAN_TOXIC_CLASSES,
    thresholdLabel: /인체/,
    text: {
      ko: '다른 시약과 떼어, 잠글 수 있는 시약장에 보관하세요.',
      en: 'Keep it apart from other reagents, in a cabinet that locks.',
    },
    source: { citation: '연구실 안전점검 및 정밀안전진단에 관한 지침 별표2 일상점검표(화공안전)', url: LAB_INSPECTION_RULE, checkedAt },
  },
  {
    id: 'separate_storage',
    categories: HAZARDOUS_SUBSTANCE_CLASSES,
    text: {
      ko: '반응할 수 있는 물질과 섞어 두지 말고 칸을 나눠 보관하세요.',
      en: "Don't store it with substances it can react with; keep it in its own section.",
    },
    source: { citation: '화학물질관리법 제13조제3호, 같은 법 시행규칙 별표1', url: `${HWA_LAW}/제13조`, checkedAt },
  },
  {
    id: 'label_container',
    categories: HAZARDOUS_SUBSTANCE_CLASSES,
    text: {
      ko: '덜어 쓰는 용기에도 물질명과 경고표시를 붙이세요.',
      en: 'Label any container you decant it into with its name and hazard warning.',
    },
    source: { citation: '화학물질관리법 제16조, 같은 법 시행규칙 별표2', url: `${HWA_LAW}/제16조`, checkedAt },
  },
]

/**
 * Applicability of one class for one duty. A duty that names threshold labels
 * looks only at those thresholds; it returns null when the class has none.
 */
function applicabilityForRule(
  entry: ChemicalRegulationEntry,
  rule: RegulationObligationRule,
  concentrationPercent: number | null | undefined,
): RegulationApplicability | null {
  const applicability = evaluateRegulationApplicability(entry, concentrationPercent)
  if (!rule.thresholdLabel || applicability.status === 'always') return applicability
  if (!applicability.thresholds.some((threshold) => threshold.label)) return applicability

  const label = rule.thresholdLabel
  const thresholds = applicability.thresholds.filter((threshold) => label.test(threshold.label ?? ''))
  if (thresholds.length === 0) return null
  if (applicability.status === 'unknown') return { status: 'unknown', thresholds }
  const concentration = concentrationPercent as number
  const matched = thresholds.filter((threshold) => concentration >= threshold.percent)
  return matched.length > 0 ? { status: 'applies', thresholds, matched } : { status: 'below', thresholds }
}

/**
 * Duties for a substance's classes, in table order and without duplicates. A
 * class below its threshold at the entered concentration adds nothing. When
 * every class behind a duty still depends on an unknown concentration, the
 * duty carries the lowest threshold as its condition.
 */
export function obligationsForEntries(
  entries: readonly ChemicalRegulationEntry[],
  concentrationPercent?: number | null,
  rules: readonly RegulationObligationRule[] = REGULATION_OBLIGATION_RULES,
): RegulationObligation[] {
  const hazardous = entries.filter((entry) => isHazardousChemicalCategory(entry.category))

  const obligations: RegulationObligation[] = []
  for (const rule of rules) {
    const triggering = hazardous
      .filter((entry) => rule.categories.includes(entry.category))
      .map((entry) => ({ entry, applicability: applicabilityForRule(entry, rule, concentrationPercent) }))
      .filter((item): item is { entry: ChemicalRegulationEntry; applicability: RegulationApplicability } => (
        item.applicability !== null && item.applicability.status !== 'below'
      ))
    if (triggering.length === 0) continue

    const definite = triggering.some(({ applicability }) => applicability.status === 'always' || applicability.status === 'applies')
    const thresholds = triggering.flatMap(({ applicability }) => (
      applicability.status === 'unknown' ? applicability.thresholds.map((threshold) => threshold.percent) : []
    ))
    obligations.push({
      id: rule.id,
      text: rule.text,
      source: rule.source,
      categories: Array.from(new Set(triggering.map(({ entry }) => entry.category))),
      condition: definite || thresholds.length === 0
        ? { kind: 'always' }
        : { kind: 'concentration', lowestPercent: Math.min(...thresholds) },
    })
  }
  return obligations
}

/** Whether any listed duty applies (or may apply) to the substance. */
export function hasObligation(
  entries: readonly ChemicalRegulationEntry[],
  id: RegulationObligationId,
  concentrationPercent?: number | null,
): boolean {
  return obligationsForEntries(entries, concentrationPercent).some((obligation) => obligation.id === id)
}
