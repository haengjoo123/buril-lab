/**
 * Concentration limits that let a dilute solution of a fatal acute-toxicity
 * substance (H300/H310/H330) leave the special-review hold.
 *
 * Source: KECO 화학물질정보 (`chemSbstnList`, via /api/chemicals/regulations),
 * read 2026-10-20. `percent` is the LOWEST threshold of every hazardous class
 * the substance has under the Chemicals Control Act, so a solution below it is
 * no 유해화학물질 mixture at all (formaldehyde: 인체만성유해성 0.1%, not the
 * 1% acute threshold). A substance whose classes publish no threshold, or that
 * KECO does not classify (ethidium bromide), stays blocked.
 *
 * The table is static on purpose: the batch analyzer and the server RPC that
 * re-checks it are synchronous and offline, and a copy fetched per component
 * would make the decision depend on network timing. The server keeps the same
 * table in `private.waste_fatal_toxicity_dilution_limit_v1`; a test checks the
 * two stay equal. Substances whose dilute solution keeps another hard rule
 * (nitric acid: oxidizer; mercury, osmium: heavy metal; bromine: oxidizer)
 * are left out because a limit would not change their outcome or would need a
 * separate policy decision.
 */
export interface FatalToxicityDilutionLimit {
  casNumber: string
  nameKo: string
  /** Below this w/w % the substance is not a 유해화학물질 mixture. "N% 이상" rules apply at equality. */
  percent: number
  /** Converts M and mM; vetted here so the server computes the same percentage. */
  molecularWeight: number
  /** Worst-case density (g/mL) of what is measured out, applied when a % has no w/w or w/v basis. */
  worstCaseDensity: number
  /** KECO classes and the published concentration rules the limit is the minimum of. */
  sources: ReadonlyArray<{ typeName: string; uniqueNumber: string; contentThreshold: string }>
}

export const FATAL_TOXICITY_DILUTION_SOURCE = Object.freeze({
  authority: 'KECO',
  service: 'data.go.kr 15149420 chemSbstnList',
  accessedAt: '2026-10-20',
})

export const FATAL_TOXICITY_DILUTION_LIMITS: readonly FatalToxicityDilutionLimit[] = Object.freeze([
  {
    casNumber: '7664-93-9',
    nameKo: '황산',
    percent: 10,
    molecularWeight: 98.079,
    worstCaseDensity: 1.84,
    sources: [
      { typeName: '사고대비물질', uniqueNumber: '45', contentThreshold: '황산 및 이를 10% 이상 함유한 혼합물' },
      { typeName: '인체등유해성물질', uniqueNumber: '97-1-405', contentThreshold: '인체급성유해성 : 10%' },
    ],
  },
  {
    casNumber: '50-00-0',
    nameKo: '포르말린',
    percent: 0.1,
    molecularWeight: 30.026,
    // Formalin, the liquid people actually measure by volume.
    worstCaseDensity: 1.09,
    sources: [
      { typeName: '제한물질', uniqueNumber: '06-5-5', contentThreshold: '폼알데하이드 및 이를 1% 이상 함유한 혼합물' },
      { typeName: '사고대비물질', uniqueNumber: '1', contentThreshold: '포르말린 또는 포름알데히드 및 이를 1% 이상 함유한 혼합물' },
      { typeName: '인체등유해성물질', uniqueNumber: '97-1-345', contentThreshold: '인체급성유해성 : 1%, 인체만성유해성 : 0.1%' },
    ],
  },
  {
    casNumber: '111-30-8',
    nameKo: '글루타르알데히드',
    percent: 1,
    molecularWeight: 100.117,
    // The 50% aqueous stock is denser than the neat dialdehyde.
    worstCaseDensity: 1.13,
    sources: [
      { typeName: '인체등유해성물질', uniqueNumber: '97-1-5', contentThreshold: '인체급성유해성 : 1%, 생태유해성 : 25%' },
    ],
  },
  {
    casNumber: '60-24-2',
    nameKo: '2-메르캅토에탄올',
    percent: 1,
    molecularWeight: 78.13,
    worstCaseDensity: 1.114,
    sources: [
      { typeName: '인체등유해성물질', uniqueNumber: '2023-1-1135', contentThreshold: '인체급성유해성 : 1%, 생태유해성 : 25%' },
    ],
  },
])

const LIMITS_BY_CAS = new Map(FATAL_TOXICITY_DILUTION_LIMITS.map((limit) => [limit.casNumber, limit]))

/** Exact (trimmed) CAS match, the same lookup the server makes on the submitted payload. */
export function fatalToxicityDilutionLimit(casNumber: string | null | undefined): FatalToxicityDilutionLimit | undefined {
  return LIMITS_BY_CAS.get(casNumber?.trim() ?? '')
}
