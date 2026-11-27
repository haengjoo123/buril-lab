import { loadChemicalRegulations } from '../../services/chemicalRegulationService'
import { fetchChemicalSuggestionResult, type ChemicalFormChoice } from '../../services/chemicalSuggestionService'
import { fetchRecentDailyInspections } from '../../services/dailyInspectionService'
import { inventoryService, type InventoryItem } from '../../services/inventoryService'
import { loadLabAdminOverview, type LabAdminOverviewResults } from '../../services/labAdminOverviewService'
import { loadCabinetLockSummary } from '../../services/labSafetySignalService'
import { fetchUsageCounts, listPurchaseRequests, type PurchaseRequest } from '../../services/purchaseRequestService'
import {
  fetchWasteContainers,
  fetchWasteContainerTotals,
  type WasteContainer,
  type WasteContainerTotals,
} from '../../services/wasteContainerService'
import { searchChemical } from '../../services/searchService'
import { fetchWasteLogs, type WasteLogRecord } from '../../services/wasteLogService'
import type { Chemical } from '../../types'
import type { ChemicalRegulationLookup } from '../../utils/chemicalRegulations'
import { readLabAdminSnoozes, type LabAdminSnoozes } from '../admin/labAdminTasks'
import {
  INSPECTION_LOOKBACK_DAYS,
  type CabinetLockSummary,
} from '../dailyInspection/labSafetySignals'
import type { UsageCount } from '../purchaseRequests/stockForecast'

/** Waste logs are read in pages; a period with more records than this is reported as partial. */
export const AGENT_WASTE_LOG_PAGE_SIZE = 200
export const AGENT_WASTE_LOG_LIMIT = 1_000

/**
 * Every read the agent makes, all of them existing app services running with
 * the signed-in person's own access. An object so the layout fixture and tests
 * can answer them without a backend.
 */
export interface AgentDataSources {
  loadItems: () => Promise<InventoryItem[]>
  loadUsageCounts: (labId: string | null) => Promise<Map<string, UsageCount>>
  loadRegulations: (casNumbers: readonly string[]) => Promise<Map<string, ChemicalRegulationLookup>>
  loadCabinetLocks: (labId: string) => Promise<CabinetLockSummary>
  loadInspectionDates: (labId: string) => Promise<Array<{ inspectionDate: string }>>
  loadPurchaseRequests: (labId: string) => Promise<PurchaseRequest[]>
  loadAdminOverview: (labId: string) => Promise<LabAdminOverviewResults>
  readAdminSnoozes: (labId: string) => LabAdminSnoozes
  loadContainers: () => Promise<{ containers: WasteContainer[]; totals: Record<string, WasteContainerTotals> }>
  loadWasteLogs: (createdAfter: string, createdBefore: string | null) => Promise<{ logs: WasteLogRecord[]; truncated: boolean }>
  /** Substance identity and hazard data for one name or CAS number: the lookup the normal search uses. */
  lookupChemical: (query: string) => Promise<Chemical | null>
  /** Forms to choose from when a name fits several reagents; empty when it names one. */
  loadFormChoices: (name: string) => Promise<ChemicalFormChoice[]>
}

export const agentDataSources: AgentDataSources = {
  loadItems: () => inventoryService.getItems(),
  loadUsageCounts: (labId) => fetchUsageCounts(labId),
  // A few quick rounds: an answer that waits on every pending lookup would feel stuck.
  loadRegulations: (casNumbers) => loadChemicalRegulations(casNumbers, { maxRounds: 3, retryDelayMs: 1_500 }),
  loadCabinetLocks: (labId) => loadCabinetLockSummary(labId),
  // One extra day covers today.
  loadInspectionDates: (labId) => fetchRecentDailyInspections(labId, INSPECTION_LOOKBACK_DAYS + 1),
  // Open requests only; closed ones are not part of a status answer.
  loadPurchaseRequests: (labId) => listPurchaseRequests(labId, 0),
  loadAdminOverview: (labId) => loadLabAdminOverview(labId),
  readAdminSnoozes: (labId) => readLabAdminSnoozes(labId),
  loadContainers: async () => {
    // Collected containers are left out: they need nothing more.
    const containers = await fetchWasteContainers()
    return { containers, totals: await fetchWasteContainerTotals(containers.map((container) => container.id)) }
  },
  loadWasteLogs: async (createdAfter, createdBefore) => {
    const logs: WasteLogRecord[] = []
    let total = 0
    for (let offset = 0; offset < AGENT_WASTE_LOG_LIMIT; offset += AGENT_WASTE_LOG_PAGE_SIZE) {
      const page = await fetchWasteLogs(AGENT_WASTE_LOG_PAGE_SIZE, offset, {
        sortBy: 'created_at',
        sortOrder: 'desc',
        createdAfter,
        ...(createdBefore ? { createdBefore } : {}),
      })
      logs.push(...page.logs)
      total = page.count
      if (page.logs.length < AGENT_WASTE_LOG_PAGE_SIZE) break
    }
    return { logs, truncated: total > logs.length }
  },
  lookupChemical: (query) => searchChemical(query),
  loadFormChoices: async (name) => (await fetchChemicalSuggestionResult(name)).formChoices,
}
