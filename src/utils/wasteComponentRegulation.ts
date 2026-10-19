import type { WasteComponent, WasteConcentration } from '../types'
import {
  evaluateRegulationApplicability,
  hazardousRegulationEntries,
  type ChemicalRegulationEntry,
  type ChemicalRegulationRecord,
  type RegulationApplicability,
} from './chemicalRegulations'

export interface RegulationConcentration {
  percent: number
  /** True when the value was converted or is not on the w/w basis the published rules use. */
  approximate: boolean
  /** 'as_supplied' means no concentration was entered and the neat product or solid is judged as 100%. */
  source: 'entered' | 'as_supplied'
}

export interface ComponentRegulationResult {
  entry: ChemicalRegulationEntry
  applicability: RegulationApplicability
}

const validMolecularWeight = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value > 0

/** Convert an entered concentration to a mass percentage. M, mM and mg/mL become w/v and are marked approximate. */
export function concentrationToPercent(
  concentration: WasteConcentration,
  molecularWeight?: number,
): Omit<RegulationConcentration, 'source'> | null {
  const { value, unit } = concentration
  if (!Number.isFinite(value) || value <= 0) return null
  let percent: number | null
  let approximate = true
  if (unit === '%') {
    percent = value
    approximate = concentration.basis !== 'w_w'
  } else if (unit === 'mg/mL') {
    percent = value / 10
  } else if (validMolecularWeight(molecularWeight)) {
    const molar = unit === 'mM' ? value / 1000 : value
    percent = (molar * molecularWeight) / 10
  } else {
    percent = null
  }
  return percent !== null && percent <= 100 ? { percent, approximate } : null
}

/**
 * The concentration a component's legal classes are judged at. A solution
 * without a usable concentration cannot be judged; a neat product or solid
 * without a label concentration is judged as supplied (100%).
 */
export function regulationConcentrationForComponent(component: WasteComponent): RegulationConcentration | null {
  if (component.concentration) {
    const converted = concentrationToPercent(component.concentration, component.chemical.molecularWeight)
    if (converted) return { ...converted, source: 'entered' }
  }
  const form = component.materialForm ?? 'solution'
  return form === 'neat' || form === 'solid'
    ? { percent: 100, approximate: false, source: 'as_supplied' }
    : null
}

/** Hazardous legal classes of a component, each judged at the component's concentration. */
export function evaluateComponentRegulations(
  component: WasteComponent,
  record: ChemicalRegulationRecord,
): ComponentRegulationResult[] {
  const concentration = regulationConcentrationForComponent(component)
  return hazardousRegulationEntries(record).map((entry) => ({
    entry,
    applicability: evaluateRegulationApplicability(entry, concentration?.percent ?? null),
  }))
}
