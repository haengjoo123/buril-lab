import { DEFAULT_PH_CATALOG_APPROVAL, type PhCatalogApproval } from '../features/phPrediction'

/**
 * Feature flags bundled into the web/PWA/native client.
 *
 * V2 is globally active. `VITE_ENABLE_WASTE_V2=false` remains an explicit
 * emergency rollback switch for a future deployment.
 */
export function isExplicitlyEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function isExplicitlyDisabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'false'
}

export const isWasteV2Enabled = !isExplicitlyDisabled(import.meta.env.VITE_ENABLE_WASTE_V2)
export const isChemicalEnrichmentEnabled = !isExplicitlyDisabled(
  import.meta.env.VITE_ENABLE_CHEMICAL_ENRICHMENT,
)

export function isPhPredictionDeploymentEnabled(
  value: string | undefined,
  approval: Pick<PhCatalogApproval, 'runtimeReady'>,
): boolean {
  return approval.runtimeReady && !isExplicitlyDisabled(value)
}

/**
 * Computed catalog approval is the hard safety gate. Once its pinned source,
 * fingerprint, and golden-case checks pass, prediction is on by default and
 * an explicit false value remains the emergency rollback.
 */
export const isPhPredictionEnabled = isPhPredictionDeploymentEnabled(
  import.meta.env.VITE_ENABLE_PH_PREDICTION,
  DEFAULT_PH_CATALOG_APPROVAL,
)
