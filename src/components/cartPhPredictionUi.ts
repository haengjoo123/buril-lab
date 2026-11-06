import { APPROVED_PH_CATALOG_RECORDS, PH_CATALOG_BY_ID } from '../features/phPrediction'
import type {
  PhPredictionResult,
  PhPredictionSnapshot,
  WasteComponent,
  WasteMatrix,
} from '../types'
import { formulaCompositionKey } from '../utils/chemicalFormula'

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

/**
 * The pH chemical form matters only where a batch can be (or may become) one
 * aqueous solution, and only when there is an approved form to choose or one
 * already chosen. Organic solvents and solids never show the picker.
 */
export function shouldOfferPhCatalogForm(
  predictionEnabled: boolean,
  matrix: WasteMatrix,
  component: Pick<WasteComponent, 'chemical' | 'phCatalogId' | 'materialForm'>,
): boolean {
  if (!predictionEnabled) return false
  if (matrix !== 'aqueous' && matrix !== 'unknown') return false
  if (component.phCatalogId) return true
  if (component.materialForm === 'solid') return false
  return getApprovedPhCatalogOptions(component).length > 0
}

/** A readable name for a catalog form id, never the internal slug. */
export function getPhCatalogFormLabel(
  phCatalogId: string | undefined,
  language: string,
): string | null {
  if (!phCatalogId) return null
  const record = PH_CATALOG_BY_ID.get(phCatalogId)
  if (!record) return null
  if (language.toLowerCase().startsWith('ko')) {
    const koreanName = record.names.find((name) => /[가-힣]/.test(name))
    if (koreanName) return koreanName
  }
  const label = record.exactFormLabel.trim()
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : null
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

/**
 * pH prediction says nothing about organic solvent or solid batches, so they
 * get no pH block at all. Only a mixed phase, which still holds water, gets
 * the one-line scope notice.
 */
export function shouldShowPhPredictionMatrixNotice(
  predictionEnabled: boolean,
  matrix: WasteMatrix,
  componentCount: number,
): boolean {
  return predictionEnabled
    && componentCount > 0
    && matrix === 'mixed_biphasic'
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
