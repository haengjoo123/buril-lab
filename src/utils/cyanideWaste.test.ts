import { describe, expect, it } from 'vitest'
import type { Chemical, WasteBatchDraft, WasteComponent, WasteMatrix } from '../types'
import { analyzeChemical, requiresAlkalineCyanideWaste } from './chemicalAnalyzer'
import {
  analyzeWasteBatch,
  createEmptyWasteBatch,
  createWasteComponentFromAnalysis,
  needsAlkalineCyanideCheck,
  normalizeWasteAmount,
} from './wasteBatch'

const chemical = (name: string, casNumber: string, molecularFormula: string, hazardStatements: string[]): Chemical => ({
  id: casNumber, name, casNumber, molecularFormula, ghs: { signal: 'Danger', hazardStatements },
})

const CHEMICALS = {
  sodiumCyanide: chemical('Sodium cyanide', '143-33-9', 'CNNa', ['H290', 'H300', 'H310', 'H330', 'H410']),
  ammoniumCyanide: chemical('시안화 암모늄(AMMONIUM CYANIDE)', '12211-52-8', 'CH4N2', ['H300', 'H310', 'H330']),
  zincDicyanide: chemical('아연 시아니드( 관용명 : ZINC DICYANIDE )', '557-21-1', '', ['H310', 'H330']),
  nitroprusside: chemical('SODIUM NITROPRUSSIDE', '14402-89-2', 'C5FeN6Na2O', ['H300', 'H310', 'H330']),
  ferricyanide: chemical('Potassium ferricyanide', '13746-66-2', 'C6FeK3N6', []),
  guanidineThiocyanate: chemical('Guanidine thiocyanate', '593-84-0', 'C2H6N4S', ['H302', 'H312', 'H332', 'H412']),
  hydrogenCyanide: chemical('Hydrogen cyanide', '74-90-8', 'CHN', ['H224', 'H300', 'H310', 'H330']),
  acrylonitrile: chemical('Acrylonitrile (Vinyl cyanide)', '107-13-1', 'C3H3N', ['H225', 'H301', 'H310', 'H330', 'H350']),
  acetoneCyanohydrin: chemical('Acetone cyanohydrin', '75-86-5', 'C4H7NO', ['H300', 'H310', 'H330']),
  sulfuricAcid: chemical('Sulfuric acid', '7664-93-9', 'H2O4S', ['H290', 'H314']),
}

const component = (key: keyof typeof CHEMICALS): WasteComponent =>
  createWasteComponentFromAnalysis(analyzeChemical({ ...CHEMICALS[key] }), {
    cartLineId: key,
    identityConfidence: 'verified',
    ghsDataStatus: 'verified',
  })

const batch = (
  components: WasteComponent[],
  options: { matrix?: WasteMatrix; ph?: number } = {},
): WasteBatchDraft => {
  const matrix = options.matrix ?? 'aqueous'
  const unit = matrix === 'solid_slurry' ? 'g' : 'mL'
  return {
    ...createEmptyWasteBatch({ id: 'batch', now: '2026-10-21T00:00:00.000Z' }),
    components,
    matrix,
    matrixSource: 'user',
    mixingState: 'already_mixed',
    totalAmount: { value: 100, unit, ...normalizeWasteAmount(100, unit)!, isApproximate: false, isUnknown: false },
    ...(options.ph === undefined
      ? { measuredPhStatus: 'unknown' as const }
      : { measuredPhStatus: 'measured' as const, measuredBatchPh: options.ph }),
  }
}

const decide = (components: WasteComponent[], options?: { matrix?: WasteMatrix; ph?: number }) => {
  const decision = analyzeWasteBatch(batch(components, options))
  return {
    status: decision.decisionStatus,
    stream: decision.streamCode,
    reasons: decision.blockingReasons.map(({ code }) => code),
    missing: decision.missingFields,
  }
}

describe('cyanide classification', () => {
  it('files ammonium cyanide, zinc dicyanide and nitroprusside with the other inorganic cyanides', () => {
    for (const key of ['sodiumCyanide', 'ammoniumCyanide', 'zincDicyanide', 'nitroprusside'] as const) {
      const analysis = analyzeChemical({ ...CHEMICALS[key] })
      expect(analysis.category, key).toBe('CYANIDE')
      expect(analysis.hazardProfile?.flags, key).toContain('CYANIDE')
    }
  })

  it('flags hydrogen cyanide as cyanide but keeps it held for special review', () => {
    const analysis = analyzeChemical({ ...CHEMICALS.hydrogenCyanide })
    expect(analysis.hazardProfile?.flags).toContain('CYANIDE')
    expect(analysis.category).toBe('SPECIAL_HAZARD')
    expect(analysis.reason).toBe('reason_hydrogen_cyanide')
  })

  it('does not treat organic nitriles or cyanohydrins as cyanide salts', () => {
    for (const key of ['acrylonitrile', 'acetoneCyanohydrin'] as const) {
      expect(analyzeChemical({ ...CHEMICALS[key] }).hazardProfile?.flags, key).not.toContain('CYANIDE')
    }
  })

  it('requires an alkaline pH only for cyanides that can release HCN', () => {
    expect(requiresAlkalineCyanideWaste('Sodium cyanide')).toBe(true)
    expect(requiresAlkalineCyanideWaste('SODIUM NITROPRUSSIDE (sodium nitroferricyanide)')).toBe(true)
    expect(requiresAlkalineCyanideWaste('Potassium ferricyanide')).toBe(false)
    expect(requiresAlkalineCyanideWaste('칼륨 시안화제1철(POTASSIUM FERROCYANIDE)')).toBe(false)
    expect(requiresAlkalineCyanideWaste('테트라암모니움 헥사사이아노페레이트')).toBe(false)
    expect(requiresAlkalineCyanideWaste('과니딘 티오시아네이트')).toBe(false)
  })
})

describe('analyzeWasteBatch with cyanide', () => {
  it('asks for the measured pH of aqueous cyanide before the cyanide container', () => {
    expect(needsAlkalineCyanideCheck(batch([component('sodiumCyanide')]))).toBe(true)
    expect(decide([component('sodiumCyanide')]))
      .toEqual({ status: 'needs_input', stream: 'CYANIDE_SULFIDE', reasons: [], missing: ['measured_ph'] })
  })

  it('routes cyanide at pH 10 or higher and blocks it below', () => {
    expect(decide([component('sodiumCyanide')], { ph: 10 })).toMatchObject({ status: 'ready', stream: 'CYANIDE_SULFIDE' })
    expect(decide([component('sodiumCyanide')], { ph: 9.9 }))
      .toMatchObject({ status: 'blocked', reasons: ['cyanide_not_alkaline'] })
  })

  it('applies the same rule to the unified cyanides', () => {
    for (const key of ['ammoniumCyanide', 'zincDicyanide', 'nitroprusside'] as const) {
      expect(decide([component(key)]), key).toMatchObject({ status: 'needs_input', stream: 'CYANIDE_SULFIDE', missing: ['measured_ph'] })
      expect(decide([component(key)], { ph: 11 }), key).toMatchObject({ status: 'ready', stream: 'CYANIDE_SULFIDE' })
    }
  })

  it('does not ask for pH for stable cyanide complexes, thiocyanates or solid cyanide', () => {
    expect(decide([component('ferricyanide')])).toMatchObject({ status: 'ready', stream: 'CYANIDE_SULFIDE' })
    expect(decide([component('guanidineThiocyanate')])).toMatchObject({ status: 'ready', stream: 'CYANIDE_SULFIDE' })
    expect(decide([component('sodiumCyanide')], { matrix: 'solid_slurry' })).toMatchObject({ status: 'ready', stream: 'CYANIDE_SULFIDE' })
  })

  it('keeps hydrogen cyanide held and cyanide with acid blocked', () => {
    expect(decide([component('hydrogenCyanide')], { ph: 11 }))
      .toMatchObject({ status: 'blocked', stream: 'SPECIAL_REVIEW', reasons: ['special_hazard'] })
    expect(decide([component('sodiumCyanide'), component('sulfuricAcid')], { ph: 11 }).reasons)
      .toContain('dangerous_compatibility')
  })
})
