import type { InventoryItem } from '../../../services/inventoryService'
import { getExpiryStatus, type ExpiryStatus } from '../../../utils/expiryStatus'
import type { InventoryExpiryFilter } from '../../inventory/inventoryExpiryFilter'
import type { AgentExpiryWindow } from '../agentContract'
import type { AgentResult } from '../agentResults'

export const AGENT_EXPIRY_LIST_LIMIT = 20

/** expired counts the due date itself, as getExpiryStatus does. */
function inWindow(status: ExpiryStatus, window: AgentExpiryWindow): boolean {
  const expired = status.level === 'expired'
  if (window === 'expired') return expired
  if (window === 'within_7d') return status.level === 'critical'
  if (window === 'within_30d') return status.level === 'critical' || status.level === 'warning'
  return expired || status.level === 'critical' || status.level === 'warning'
}

/** The inventory screen's own filter closest to a window, for the "see all" link. */
export function inventoryFilterForWindow(window: AgentExpiryWindow): InventoryExpiryFilter {
  if (window === 'expired') return 'expired'
  if (window === 'attention') return 'attention'
  return 'expiring'
}

/**
 * Reagents past or near their date. Records without a date cannot be judged,
 * so they are counted and reported rather than silently left out.
 */
export function runExpiryList(items: InventoryItem[], window: AgentExpiryWindow): AgentResult {
  const dated: Array<{ item: InventoryItem; status: ExpiryStatus }> = []
  let undatedCount = 0
  for (const item of items) {
    const status = getExpiryStatus(item.expiry_date)
    if (!status) undatedCount += 1
    else dated.push({ item, status })
  }

  const matching = dated
    .filter(({ status }) => inWindow(status, window))
    .sort((left, right) => left.status.daysLeft - right.status.daysLeft
      || left.item.name.localeCompare(right.item.name))

  return {
    type: 'expiry_list',
    window,
    rows: matching.slice(0, AGENT_EXPIRY_LIST_LIMIT),
    total: matching.length,
    undatedCount,
    inventoryCount: items.length,
  }
}
