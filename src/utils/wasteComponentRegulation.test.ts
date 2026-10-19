import { describe, expect, it } from 'vitest'
import type { WasteComponent } from '../types'
import type { ChemicalRegulationRecord } from './chemicalRegulations'
import {
  concentrationToPercent,
  evaluateComponentRegulations,
  regulationConcentrationForComponent,
} from './wasteComponentRegulation'

const hydrochloricAcid = (overrides: Partial<WasteComponent> = {}): WasteComponent => ({
  chemical: { id: 'hcl', name: 'Hydrochloric acid', casNumber: '7647-01-0', molecularFormula: 'HCl', molecularWeight: 36.46 },
  ...overrides,
} as WasteComponent)

const hclRecord: ChemicalRegulationRecord = {
  casNumber: '7647-01-0',
  entries: [
    { category: 'accident_preparedness', typeName: '사고대비물질', contentThreshold: '염화 수소 및 이를 10% 이상 함유한 혼합물' },
    { category: 'human_eco_hazard', typeName: '인체등유해성물질', contentThreshold: '인체급성유해성 : 10%' },
    { category: 'existing', typeName: '기존화학물질' },
  ],
}

describe('concentrationToPercent', () => {
  it('keeps w/w percentages exact and marks other bases approximate', () => {
    expect(concentrationToPercent({ value: 35, unit: '%', basis: 'w_w' })).toEqual({ percent: 35, approximate: false })
    expect(concentrationToPercent({ value: 10, unit: '%', basis: 'w_v' })).toEqual({ percent: 10, approximate: true })
  })

  it('converts molarity and mg/mL to an approximate w/v percentage', () => {
    expect(concentrationToPercent({ value: 1, unit: 'M' }, 36.46)?.percent).toBeCloseTo(3.646)
    expect(concentrationToPercent({ value: 500, unit: 'mM' }, 36.46)?.percent).toBeCloseTo(1.823)
    expect(concentrationToPercent({ value: 50, unit: 'mg/mL' })).toEqual({ percent: 5, approximate: true })
  })

  it('cannot convert molarity without a molecular weight, or values above 100%', () => {
    expect(concentrationToPercent({ value: 1, unit: 'M' })).toBeNull()
    expect(concentrationToPercent({ value: 1, unit: 'M' }, 0)).toBeNull()
    expect(concentrationToPercent({ value: 120, unit: '%', basis: 'w_w' })).toBeNull()
  })
})

describe('regulationConcentrationForComponent', () => {
  it('uses an entered concentration', () => {
    expect(regulationConcentrationForComponent(hydrochloricAcid({ concentration: { value: 1, unit: 'M' } })))
      .toMatchObject({ source: 'entered', approximate: true })
  })

  it('judges a neat product or solid as supplied when no concentration is entered', () => {
    expect(regulationConcentrationForComponent(hydrochloricAcid({ materialForm: 'neat' })))
      .toEqual({ percent: 100, approximate: false, source: 'as_supplied' })
    expect(regulationConcentrationForComponent(hydrochloricAcid({ materialForm: 'solid' }))?.source).toBe('as_supplied')
  })

  it('prefers a label concentration for a neat product', () => {
    expect(regulationConcentrationForComponent(hydrochloricAcid({
      materialForm: 'neat',
      concentration: { value: 35, unit: '%', basis: 'w_w' },
    }))).toEqual({ percent: 35, approximate: false, source: 'entered' })
  })

  it('cannot judge a solution without a concentration, including drafts without a form', () => {
    expect(regulationConcentrationForComponent(hydrochloricAcid({ materialForm: 'solution' }))).toBeNull()
    expect(regulationConcentrationForComponent(hydrochloricAcid())).toBeNull()
  })
})

describe('evaluateComponentRegulations', () => {
  it('marks 1 M HCl below both 10% thresholds and neat HCl as applying', () => {
    const dilute = evaluateComponentRegulations(hydrochloricAcid({ concentration: { value: 1, unit: 'M' } }), hclRecord)
    expect(dilute.map(({ applicability }) => applicability.status)).toEqual(['below', 'below'])

    const neat = evaluateComponentRegulations(hydrochloricAcid({ materialForm: 'neat' }), hclRecord)
    expect(neat.map(({ applicability }) => applicability.status)).toEqual(['applies', 'applies'])
  })

  it('leaves a solution without concentration undecided and skips inventory-only classes', () => {
    const results = evaluateComponentRegulations(hydrochloricAcid(), hclRecord)
    expect(results.map(({ entry }) => entry.typeName)).toEqual(['사고대비물질', '인체등유해성물질'])
    expect(results.every(({ applicability }) => applicability.status === 'unknown')).toBe(true)
  })
})
