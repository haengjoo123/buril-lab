import type { InventoryItem } from '../../../services/inventoryService'
import type { AgentFacet, AgentItemRef } from '../agentContract'
import type { AgentResult } from '../agentResults'
import { matchInventoryItems } from '../matchItems'

/** Where a reagent is, how much is left, or when it expires — answered from the lab's records only. */
export function runItemLookup(
  items: InventoryItem[],
  item: AgentItemRef,
  facet: AgentFacet,
): AgentResult {
  const { matches, totalInTier, aliasOnly } = matchInventoryItems(items, item)
  if (matches.length === 0) {
    return { type: 'item_no_match', query: item.text, inventoryIsEmpty: items.length === 0 }
  }
  return {
    type: 'item_matches',
    query: item.text,
    facet,
    items: matches.map((match) => match.item),
    hiddenCount: totalInTier - matches.length,
    aliasOnly,
  }
}
