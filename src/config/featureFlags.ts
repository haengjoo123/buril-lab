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
/** Personal lab tools require the 20261109 migrations before production enablement. */
export const isLabToolsEnabled = import.meta.env.DEV || isExplicitlyEnabled(import.meta.env.VITE_ENABLE_LAB_TOOLS)
/** Enable only after the additive import migration and AI endpoint are deployed. */
export const isInventoryImportV2Enabled = isExplicitlyEnabled(import.meta.env.VITE_ENABLE_INVENTORY_IMPORT_V2)
/**
 * Physical waste containers (폐액통 단위 기록·표지). Enable only after the
 * 20261017090000_waste_containers migration is applied to that environment.
 */
export const isWasteContainersEnabled = isExplicitlyEnabled(import.meta.env.VITE_ENABLE_WASTE_CONTAINERS)
/**
 * Compares a deposit with the selected container's recorded contents before
 * it is saved. Off unless a reviewed deployment explicitly enables it.
 */
export const isContainerContentCheckEnabled = isWasteContainersEnabled
  && isExplicitlyEnabled(import.meta.env.VITE_ENABLE_CONTAINER_CONTENT_CHECK)
/**
 * Pickup requests for waste containers. Reads the pickup columns, so enable only
 * after the 20261113090000_waste_container_pickup_requests migration is applied.
 */
export const isContainerPickupRequestsEnabled = isWasteContainersEnabled
  && isExplicitlyEnabled(import.meta.env.VITE_ENABLE_CONTAINER_PICKUP_REQUESTS)
/**
 * Daily lab safety inspections. Reads lab_daily_inspections, so enable only
 * after the 20261113100000_lab_daily_inspections migration is applied.
 */
export const isDailyInspectionEnabled = isExplicitlyEnabled(import.meta.env.VITE_ENABLE_DAILY_INSPECTION)
/** QR labels on inventory items and waste containers, QR scanning and stocktake. */
export const isQrLabelsEnabled = isExplicitlyEnabled(import.meta.env.VITE_ENABLE_QR_LABELS)
/**
 * Supplier SDS files on inventory items. Reads inventory_sds_documents, so enable
 * only after the 20261114090000_inventory_sds_documents migration is applied.
 */
export const isSdsAttachmentsEnabled = isExplicitlyEnabled(import.meta.env.VITE_ENABLE_SDS_ATTACHMENTS)
/** Local notifications on the native app for expiring reagents and the daily inspection. */
export const isDeviceRemindersEnabled = isExplicitlyEnabled(import.meta.env.VITE_ENABLE_DEVICE_REMINDERS)
/** Draft chemical list export for the lab's prior hazard analysis (사전유해인자위험분석). */
export const isHazardRegisterExportEnabled = isExplicitlyEnabled(import.meta.env.VITE_ENABLE_HAZARD_REGISTER_EXPORT)
/** Low-stock forecast and purchase requests approved by the lab admin. Needs its migration. */
export const isPurchaseRequestsEnabled = isExplicitlyEnabled(import.meta.env.VITE_ENABLE_PURCHASE_REQUESTS)
/**
 * AI-drafted handling and storage notes (reagent_reference_drafts) on the reagent detail
 * screen, always labelled as an unreviewed draft. Off unless a reviewed deployment enables it.
 */
export const isAiHandlingDraftsEnabled = isExplicitlyEnabled(import.meta.env.VITE_ENABLE_AI_HANDLING_DRAFTS)
/**
 * Shows 화학물질관리법 classes as the handling actions they require, with the
 * legal basis folded away. Off keeps the original classification list.
 */
export const isRegulationActionsEnabled = isExplicitlyEnabled(import.meta.env.VITE_ENABLE_REGULATION_ACTIONS)
/**
 * Lab-wide 화학물질관리법 classification (inventory filter, hazard list column).
 * Calls /api/chemicals/regulations-batch, whose database cache needs the
 * 20261116090000_regulation_source_cache migration in that environment.
 */
export const isRegulationBatchEnabled = isExplicitlyEnabled(import.meta.env.VITE_ENABLE_REGULATION_BATCH)
/**
 * Cabinet lock setting and the "toxic reagent in a cabinet without a lock"
 * storage warning. Reads cabinets.locked, added by 20261116100000_cabinet_locked.
 */
export const isCabinetLockRulesEnabled = isExplicitlyEnabled(import.meta.env.VITE_ENABLE_CABINET_LOCK_RULES)
/**
 * Daily inspection hints from lab data (cabinet locks, waste containers) and the
 * matching admin to-dos and 화관법 status line. No database changes of its own.
 */
export const isInspectionHintsEnabled = isExplicitlyEnabled(import.meta.env.VITE_ENABLE_INSPECTION_HINTS)
/** One workbook gathering inventory, inspections, cabinets and containers for an inspection (no database changes). */
export const isInspectionPrepExportEnabled = isExplicitlyEnabled(import.meta.env.VITE_ENABLE_INSPECTION_PREP_EXPORT)
export const isChemicalEnrichmentEnabled = !isExplicitlyDisabled(
  import.meta.env.VITE_ENABLE_CHEMICAL_ENRICHMENT,
)
/** Search analytics stays off unless a reviewed deployment explicitly enables it. */
export function isSearchAnalyticsDeploymentEnabled(value: string | undefined): boolean {
  return isExplicitlyEnabled(value)
}

export const isSearchAnalyticsEnabled = isSearchAnalyticsDeploymentEnabled(
  import.meta.env.VITE_ENABLE_SEARCH_ANALYTICS,
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
