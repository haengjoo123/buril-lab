import { APPROVED_PH_CATALOG_RECORDS } from '../features/phPrediction'
import type {
  PhPredictionResult,
  PhPredictionSnapshot,
  WasteComponent,
  WasteMatrix,
} from '../types'
import { parseFormula } from '../utils/chemicalAnalyzer'

const formulaCompositionKey = (value: string | undefined): string => {
  const normalized = value?.replace(/\s+/g, '').replace(/\((?:aq|s|l|g)\)$/i, '') ?? ''
  if (!normalized) return ''

  let entries: Array<[string, number]>
  try {
    entries = Object.entries(parseFormula(normalized))
      .filter((entry): entry is [string, number] => Number.isFinite(entry[1]) && entry[1] > 0)
      .sort(([left], [right]) => left.localeCompare(right))
  } catch {
    return normalized.toUpperCase()
  }

  return entries.length > 0
    ? entries.map(([element, count]) => `${element}:${count}`).join('|')
    : normalized.toUpperCase()
}

/**
 * Only exact, approved forms may be selected. An unidentified component must
 * never receive a broad catalog picker that invites an arbitrary match.
 */
export function getApprovedPhCatalogOptions(
  component: Pick<WasteComponent, 'chemical'>,
) {
  const cas = component.chemical.casNumber?.trim()
  const formula = formulaCompositionKey(component.chemical.molecularFormula)
  if (!cas && !formula) return []

  return APPROVED_PH_CATALOG_RECORDS.filter((record) => (
    (!cas || record.casNumber === cas)
    && (!formula || formulaCompositionKey(record.formula) === formula)
  ))
}

/** Blocked, unsupported, or failed results never expose a numeric value. */
export function canDisplayPhPredictionNumber(result: PhPredictionResult): boolean {
  if (result.status !== 'available' && result.status !== 'approximate') return false
  const value = result.displayValue ?? result.value
  return value !== undefined && Number.isFinite(value)
}

export function shouldAskPhPredictionCompleteness(
  predictionEnabled: boolean,
  matrix: WasteMatrix,
  componentCount: number,
): boolean {
  return predictionEnabled && matrix === 'aqueous' && componentCount > 0
}

export function shouldShowPhPredictionMatrixNotice(
  predictionEnabled: boolean,
  matrix: WasteMatrix,
  componentCount: number,
): boolean {
  return predictionEnabled
    && componentCount > 0
    && matrix !== 'aqueous'
    && matrix !== 'unknown'
}

export function createPhPredictionAuditSnapshot(
  result: PhPredictionResult,
  capturedAt: string,
): PhPredictionSnapshot {
  return {
    ...result,
    origin: 'client_generated',
    capturedAt,
  }
}
