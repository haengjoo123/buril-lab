import type { InventoryItem } from '../../../services/inventoryService'
import type { WasteContainer, WasteContainerTotals } from '../../../services/wasteContainerService'
import type { AgentItemRef, AgentUsageChange } from '../agentContract'
import type { AgentResult } from '../agentResults'
import { matchInventoryItems } from '../matchItems'
import { containerRows } from './wasteRecords'

/** How many inventory records a purchase request may be linked to in the proposal. */
export const AGENT_PURCHASE_MATCH_LIMIT = 4

/**
 * Proposals only describe what could be recorded. Each one lists the lab's own
 * records for the person to choose from; none of them saves anything.
 */
export function runUsageProposal(
  items: InventoryItem[],
  item: AgentItemRef,
  change: AgentUsageChange,
  labId: string | null,
): AgentResult {
  const { matches, totalInTier, aliasOnly } = matchInventoryItems(items, item)
  if (matches.length === 0) {
    return { type: 'item_no_match', query: item.text, inventoryIsEmpty: items.length === 0 }
  }
  return {
    type: 'usage_proposal',
    query: item.text,
    change,
    items: matches.map((match) => match.item),
    hiddenCount: totalInTier - matches.length,
    aliasOnly,
    labId,
  }
}

/** The inventory row a record stands for; a cabinet bottle counts through the row it is linked to. */
export function inventoryRowId(item: InventoryItem): string | null {
  return item._source === 'cabinet_item' ? item.linked_inventory_item_id ?? null : item.id
}

export function runPurchaseProposal(
  items: InventoryItem[],
  item: AgentItemRef,
  quantity: number | null,
  labId: string,
): AgentResult {
  const { matches, aliasOnly } = matchInventoryItems(items, item)
  const seen = new Set<string>()
  const linkable: InventoryItem[] = []
  // A record found only through a suggested alias may be another product, so it is not offered.
  for (const match of aliasOnly ? [] : matches) {
    const rowId = inventoryRowId(match.item)
    if (!rowId || seen.has(rowId)) continue
    seen.add(rowId)
    linkable.push(match.item)
    if (linkable.length === AGENT_PURCHASE_MATCH_LIMIT) break
  }
  return { type: 'purchase_proposal', itemName: item.text, quantity, matches: linkable, labId }
}

export function runPickupProposal(
  containers: WasteContainer[],
  totals: Readonly<Record<string, WasteContainerTotals>>,
  labId: string | null,
): AgentResult {
  const rows = containerRows(containers, totals).filter((row) => row.status !== 'collected')
  return {
    type: 'pickup_proposal',
    containers: rows.filter((row) => !row.pickupRequested),
    requestedCount: rows.filter((row) => row.pickupRequested).length,
    labId,
  }
}
