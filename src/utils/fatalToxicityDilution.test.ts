import { describe, expect, it } from 'vitest'
import type { Chemical, WasteBatchDraft, WasteComponent, WasteConcentration, WasteMatrix, WasteMaterialForm } from '../types'
import { analyzeChemical } from './chemicalAnalyzer'
import type { ChemicalRegulationRecord } from './chemicalRegulations'
import { assessFatalToxicityDilution, concentrationAwareCategory } from './fatalToxicityDilution'
import {
  analyzeWasteBatch,
  createEmptyWasteBatch,
  createWasteComponentFromAnalysis,
  normalizeWasteAmount,
} from './wasteBatch'
import { evaluateComponentRegulations } from './wasteComponentRegulation'

// Sulfuric acid as KECO publishes it (scripts/fixtures/keco-fatal-toxicity-dilution-2026-10-20.json).
const sulfuricRecord: ChemicalRegulationRecord = {
  casNumber: '7664-93-9',
  entries: [
    { category: 'accident_preparedness', typeName: '사고대비물질', uniqueNumber: '45', contentThreshold: '황산 및 이를 10% 이상 함유한 혼합물' },
    { category: 'human_eco_hazard', typeName: '인체등유해성물질', uniqueNumber: '97-1-405', contentThreshold: '인체급성유해성 : 10%' },
    { category: 'existing', typeName: '기존화학물질', uniqueNumber: 'KE-32570' },
  ],
}

const CHEMICALS: Record<string, Chemical> = {
  sulfuric: {
    id: 'h2so4', name: 'Sulfuric acid', casNumber: '7664-93-9', molecularFormula: 'H2O4S',
    ghs: { signal: 'Danger', hazardStatements: ['H290', 'H314', 'H330', 'H350'] },
  },
  nitric: {
    id: 'hno3', name: 'Nitric acid', casNumber: '7697-37-2', molecularFormula: 'HNO3',
    ghs: { signal: 'Danger', hazardStatements: ['H271', 'H314', 'H330'] },
  },
  formaldehyde: {
    id: 'hcho', name: 'Formaldehyde', casNumber: '50-00-0', molecularFormula: 'CH2O',
    ghs: { signal: 'Danger', hazardStatements: ['H220', 'H301', 'H311', 'H314', 'H330', 'H350'] },
  },
  ethidium: {
    id: 'etbr', name: 'Ethidium bromide', casNumber: '1239-45-8', molecularFormula: 'C21H20BrN3',
    ghs: { signal: 'Danger', hazardStatements: ['H302', 'H315', 'H330', 'H341'] },
  },
  mercaptoethanol: {
    id: 'bme', name: '2-Mercaptoethanol', casNumber: '60-24-2', molecularFormula: 'C2H6OS',
    ghs: { signal: 'Danger', hazardStatements: ['H227', 'H301', 'H311', 'H318', 'H330', 'H400'] },
  },
  ethanol: {
    id: 'etoh', name: 'Ethanol', casNumber: '64-17-5', molecularFormula: 'C2H6O',
    ghs: { signal: 'Danger', hazardStatements: ['H225', 'H319'] },
  },
  sodiumCyanide: {
    id: 'nacn', name: 'Sodium cyanide', casNumber: '143-33-9', molecularFormula: 'CNNa',
    ghs: { signal: 'Danger', hazardStatements: ['H290', 'H300', 'H310', 'H330', 'H372', 'H410'] },
  },
}

const component = (
  key: keyof typeof CHEMICALS,
  materialForm?: WasteMaterialForm,
  concentration?: WasteConcentration,
): WasteComponent => createWasteComponentFromAnalysis(analyzeChemical({ ...CHEMICALS[key] }), {
  cartLineId: key,
  identityConfidence: 'verified',
  ghsDataStatus: 'verified',
  materialForm,
  concentration,
})

const batch = (components: WasteComponent[], matrix: WasteMatrix = 'aqueous'): WasteBatchDraft => ({
  ...createEmptyWasteBatch({ id: 'batch', now: '2026-10-20T00:00:00.000Z' }),
  components,
  matrix,
  matrixSource: 'user',
  totalAmount: {
    value: 100,
    unit: 'mL',
    ...normalizeWasteAmount(100, 'mL')!,
    isApproximate: false,
    isUnknown: false,
  },
})

const decide = (...components: WasteComponent[]) => {
  const decision = analyzeWasteBatch(batch(components))
  return {
    status: decision.decisionStatus,
    stream: decision.streamCode,
    reasons: decision.blockingReasons.map(({ code }) => code),
  }
}

describe('assessFatalToxicityDilution', () => {
  it('holds neat, solid and unknown-concentration components', () => {
    expect(assessFatalToxicityDilution(component('sulfuric', 'neat')).status).toBe('not_solution')
    expect(assessFatalToxicityDilution(component('sulfuric', 'neat', { value: 1, unit: 'M' })).status).toBe('not_solution')
    expect(assessFatalToxicityDilution(component('sulfuric', 'solid')).status).toBe('not_solution')
    expect(assessFatalToxicityDilution(component('sulfuric')).status).toBe('concentration_unknown')
    expect(assessFatalToxicityDilution(component('sulfuric', 'solution')).status).toBe('concentration_unknown')
  })

  it('converts molarity with the vetted molecular weight even when the chemical has none', () => {
    const oneMolar = assessFatalToxicityDilution(component('sulfuric', 'solution', { value: 1, unit: 'M' }))
    expect(oneMolar).toMatchObject({ status: 'below' })
    expect(oneMolar.status === 'below' && oneMolar.percent).toBeCloseTo(9.8079)
    expect(assessFatalToxicityDilution(component('sulfuric', undefined, { value: 2, unit: 'M' })).status).toBe('at_or_above')
    expect(assessFatalToxicityDilution(component('sulfuric', undefined, { value: 500, unit: 'mM' })).status).toBe('below')
  })

  it('applies the published "N% 이상" rule at equality', () => {
    expect(assessFatalToxicityDilution(component('sulfuric', undefined, { value: 10, unit: '%', basis: 'w_w' })).status)
      .toBe('at_or_above')
    expect(assessFatalToxicityDilution(component('sulfuric', undefined, { value: 9.9, unit: '%', basis: 'w_w' })).status)
      .toBe('below')
  })

  it('treats a volume or unspecified % as the dense liquid measured out', () => {
    // 6% v/v concentrated acid is about 11% by mass: never under-count it.
    expect(assessFatalToxicityDilution(component('sulfuric', undefined, { value: 6, unit: '%', basis: 'v_v' })).status)
      .toBe('at_or_above')
    expect(assessFatalToxicityDilution(component('sulfuric', undefined, { value: 6, unit: '%' })).status)
      .toBe('at_or_above')
    expect(assessFatalToxicityDilution(component('sulfuric', undefined, { value: 5, unit: '%', basis: 'v_v' })).status)
      .toBe('below')
    expect(assessFatalToxicityDilution(component('sulfuric', undefined, { value: 6, unit: '%', basis: 'w_v' })).status)
      .toBe('below')
  })

  it('uses the strictest class: formaldehyde stays held from its 0.1% chronic threshold', () => {
    expect(assessFatalToxicityDilution(component('formaldehyde', undefined, { value: 4, unit: '%', basis: 'w_v' })).status)
      .toBe('at_or_above')
    expect(assessFatalToxicityDilution(component('formaldehyde', undefined, { value: 0.5, unit: '%', basis: 'w_w' })).status)
      .toBe('at_or_above')
    expect(assessFatalToxicityDilution(component('formaldehyde', undefined, { value: 0.05, unit: '%', basis: 'w_w' })).status)
      .toBe('below')
  })

  it('does not apply to components held by another rule or without a limit', () => {
    expect(assessFatalToxicityDilution(component('nitric', undefined, { value: 1, unit: 'M' })).status).toBe('not_applicable')
    expect(assessFatalToxicityDilution(component('ethanol', undefined, { value: 1, unit: 'M' })).status).toBe('not_applicable')
    expect(assessFatalToxicityDilution(component('ethidium', undefined, { value: 0.5, unit: 'mg/mL' })).status).toBe('no_limit')
  })

  it('reclassifies only a solution below its limit', () => {
    expect(concentrationAwareCategory(component('sulfuric', undefined, { value: 1, unit: 'M' }))).toBe('ACID')
    expect(concentrationAwareCategory(component('sulfuric', 'neat'))).toBe('SPECIAL_HAZARD')
    expect(concentrationAwareCategory(component('mercaptoethanol', undefined, { value: 0.1, unit: '%', basis: 'v_v' })))
      .toBe('ORGANIC_NON_HALOGEN')
  })
})

describe('analyzeWasteBatch with fatal acute-toxicity components', () => {
  it('guides dilute sulfuric acid to the aqueous acid stream', () => {
    expect(decide(component('sulfuric', 'solution', { value: 1, unit: 'M' })))
      .toEqual({ status: 'ready', stream: 'ACID_AQUEOUS', reasons: [] })
  })

  it('keeps neat, unknown and at-threshold sulfuric acid in special review', () => {
    for (const held of [
      component('sulfuric', 'neat'),
      component('sulfuric'),
      component('sulfuric', 'solution', { value: 2, unit: 'M' }),
    ]) {
      expect(decide(held)).toEqual({ status: 'blocked', stream: 'SPECIAL_REVIEW', reasons: ['special_hazard'] })
    }
  })

  it('never relaxes the nitric acid oxidizer hold', () => {
    expect(decide(component('nitric', 'solution', { value: 0.1, unit: 'M' })))
      .toMatchObject({ status: 'blocked', stream: 'REACTIVE_OXIDIZER', reasons: ['reactive_waste'] })
  })

  it('keeps ethidium bromide held because no legal threshold exists', () => {
    expect(decide(component('ethidium', 'solution', { value: 0.5, unit: 'mg/mL' })))
      .toMatchObject({ status: 'blocked', reasons: ['special_hazard'] })
  })

  it('still blocks acid with cyanide once the hold is lifted', () => {
    const result = decide(
      component('sulfuric', 'solution', { value: 0.1, unit: 'M' }),
      component('sodiumCyanide', 'solution', { value: 0.1, unit: 'M' }),
    )
    expect(result.status).toBe('blocked')
    expect(result.reasons).toContain('dangerous_compatibility')
    expect(result.reasons).not.toContain('special_hazard')
  })

  it('keeps the legal chips in line with the decision', () => {
    const statuses = (item: WasteComponent) => evaluateComponentRegulations(item, sulfuricRecord)
      .map(({ applicability }) => applicability.status)
    expect(statuses(component('sulfuric', 'solution', { value: 1, unit: 'M' }))).toEqual(['below', 'below'])
    expect(statuses(component('sulfuric', 'solution', { value: 6, unit: '%', basis: 'v_v' }))).toEqual(['applies', 'applies'])
    expect(statuses(component('sulfuric', 'neat'))).toEqual(['applies', 'applies'])
  })
})
