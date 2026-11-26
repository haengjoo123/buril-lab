import type { InventoryItem } from '../../../services/inventoryService'
import { forecastStock, type UsageCount } from '../../purchaseRequests/stockForecast'
import type { AgentResult } from '../agentResults'

export const AGENT_LOW_STOCK_LIMIT = 10

/** Products running low, by the same forecast the inventory's "부족·구매" tool uses. */
export function runLowStock(items: InventoryItem[], usage: ReadonlyMap<string, UsageCount>): AgentResult {
  const forecasts = forecastStock(items, usage)
  return {
    type: 'low_stock',
    forecasts: forecasts.slice(0, AGENT_LOW_STOCK_LIMIT),
    total: forecasts.length,
    inventoryCount: items.length,
    hasUsageHistory: [...usage.values()].some((count) => count.usedCount > 0),
  }
}
