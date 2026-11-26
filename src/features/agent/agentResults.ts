import type { InventoryItem } from '../../services/inventoryService'
import type { PurchaseRequest } from '../../services/purchaseRequestService'
import type { WasteContainerStatus } from '../../services/wasteContainerService'
import type { ExpiryStatus } from '../../utils/expiryStatus'
import type { RegulationObligation } from '../../utils/regulationObligations'
import type { LabAdminTask } from '../admin/labAdminTasks'
import type { CabinetLockGroup } from '../dailyInspection/labSafetySignals'
import type { InventoryExpiryFilter } from '../inventory/inventoryExpiryFilter'
import type { StockForecast } from '../purchaseRequests/stockForecast'
import type {
  AgentExpiryWindow,
  AgentFacet,
  AgentPlan,
  AgentPlannerScreen,
  AgentUnsupportedReason,
} from './agentContract'
import type { AgentWasteIntent, AgentWastePeriod } from './agentGuard'

/** Screens an agent result may open, including the waste screens reached by fixed rules. */
export type AgentScreen = AgentPlannerScreen | 'logs' | 'cart'

/** What the app can run: a plan from the server, or a waste records question decided by fixed rules. */
export type AgentRunnablePlan = AgentPlan | AgentWasteIntent

/** Things the app does in response to a result. Built by the app, never by a model. */
export type AgentUiAction =
  | { type: 'search_chemical'; query: string }
  /** itemId is the cabinet's own record id; null opens the cabinet without a highlight. */
  | { type: 'open_cabinet'; cabinetId: string; itemId: string | null; shelfId: string | null }
  | { type: 'open_screen'; screen: AgentScreen }
  | { type: 'open_inventory'; filter: InventoryExpiryFilter | null }

export type AgentScreenUnavailableReason = 'admin_only' | 'lab_only' | 'not_enabled'

/** One substance the lab holds that 화학물질관리법 classifies as hazardous or controlled. */
export interface AgentRegulatedSubstance {
  casNumber: string
  /** The published Korean name when there is one, otherwise the lab's own item name. */
  name: string
  /** Class names exactly as published, e.g. "사고대비물질". */
  classes: string[]
  /** Records of this substance in the inventory. */
  itemCount: number
}

export interface AgentContainerRow {
  id: string
  label: string
  streamCode: string
  status: WasteContainerStatus
  location: string | null
  totalMl: number
  /** Recorded volume over capacity as a rounded percent; null without a capacity. */
  fillPercent: number | null
  /** Some deposits have no amount, so the total is a lower bound. */
  hasUnknownAmounts: boolean
  pickupRequested: boolean
}

export interface AgentWasteStreamRow {
  /** V2 stream code, or null for a legacy record grouped by its category. */
  streamCode: string | null
  category: string
  count: number
  volumeMl: number
  /** Records whose amount is unknown or recorded by mass, so they add no volume. */
  withoutVolumeCount: number
}

/**
 * What the result area shows. Every value comes from the lab's own records or
 * from fixed app logic; there is no free-text field for a model to fill.
 */
export type AgentResult =
  | {
    type: 'item_matches'
    query: string
    facet: AgentFacet
    items: InventoryItem[]
    /** Records in the same tier that were left out of `items`. */
    hiddenCount: number
    /** Matched through a suggested alias only, so the name shown may differ from what was typed. */
    aliasOnly: boolean
  }
  | { type: 'item_no_match'; query: string; inventoryIsEmpty: boolean }
  | {
    type: 'expiry_list'
    window: AgentExpiryWindow
    rows: Array<{ item: InventoryItem; status: ExpiryStatus }>
    /** Matching records, including those beyond `rows`. */
    total: number
    /** Records with no expiry date, which this answer cannot cover. */
    undatedCount: number
    inventoryCount: number
  }
  | {
    type: 'low_stock'
    forecasts: StockForecast[]
    /** Products running low, including those beyond `forecasts`. */
    total: number
    inventoryCount: number
    /** False when no bottle was recorded as used up, so only last-bottle amounts could be judged. */
    hasUsageHistory: boolean
  }
  | {
    type: 'regulated_list'
    substances: AgentRegulatedSubstance[]
    /** Regulated substances, including those beyond `substances`. */
    total: number
    /** Duties across all of them, each listed once. */
    obligations: RegulationObligation[]
    /** Records without a CAS number, which cannot be looked up. */
    withoutCasCount: number
    /** CAS numbers the lookup has not answered. */
    unresolvedCount: number
    inventoryCount: number
  }
  | { type: 'cabinet_locks'; unlocked: CabinetLockGroup[]; unset: CabinetLockGroup[] }
  | {
    type: 'inspection_gaps'
    /** Weekdays without a record, newest first (KST). */
    missingDates: string[]
    lookbackDays: number
    /** Whether today's inspection is recorded. */
    recordedToday: boolean
  }
  | {
    type: 'purchase_status'
    requested: number
    approved: number
    ordered: number
    /** Oldest undecided requests first. */
    waiting: Array<Pick<PurchaseRequest, 'id' | 'itemName' | 'quantity' | 'createdAt'>>
  }
  | {
    type: 'admin_tasks'
    tasks: LabAdminTask[]
    /** Tasks to handle this week, including those beyond `tasks`. */
    total: number
    snoozedCount: number
    /** Sources that failed to load, whose tasks are therefore missing. */
    failedSourceCount: number
  }
  | { type: 'container_status'; containers: AgentContainerRow[] }
  | {
    type: 'waste_summary'
    period: AgentWastePeriod
    streams: AgentWasteStreamRow[]
    /** Live records in the period; voided ones are left out. */
    logCount: number
    totalVolumeMl: number
    /** More records exist than were read, so the totals are lower bounds. */
    truncated: boolean
  }
  | { type: 'disposal_redirect' }
  | { type: 'screen_unavailable'; screen: AgentScreen; reason: AgentScreenUnavailableReason }
  | { type: 'unsupported'; reason: AgentUnsupportedReason }

/** Results drawn by the status cards: answers about the lab as a whole rather than one reagent. */
export const AGENT_STATUS_RESULT_TYPES = [
  'low_stock',
  'regulated_list',
  'cabinet_locks',
  'inspection_gaps',
  'purchase_status',
  'admin_tasks',
  'container_status',
  'waste_summary',
] as const

export type AgentStatusResult = Extract<AgentResult, { type: (typeof AGENT_STATUS_RESULT_TYPES)[number] }>

export function isAgentStatusResult(result: AgentResult): result is AgentStatusResult {
  return (AGENT_STATUS_RESULT_TYPES as readonly string[]).includes(result.type)
}

export type AgentErrorKind =
  | 'login_required'
  | 'disabled'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'update_required'
  | 'failed'
