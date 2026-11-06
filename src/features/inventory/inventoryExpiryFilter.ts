import type { ExpiryLevel } from '../../utils/expiryStatus';

/**
 * ?filter= values the inventory understands (links from the lab admin overview).
 * expired = past or due today; expiring = within 30 days (getExpiryStatus 'critical' | 'warning');
 * attention = both, for a card that lists expired and expiring reagents together.
 */
export type InventoryExpiryFilter = 'expired' | 'expiring' | 'attention';

export const INVENTORY_FILTER_PARAM = 'filter';

/** Chip label for each filter. */
export const INVENTORY_EXPIRY_FILTER_LABEL_KEYS: Record<InventoryExpiryFilter, string> = {
    expired: 'inventory_filter_expired',
    expiring: 'inventory_filter_expiring',
    attention: 'inventory_filter_attention',
};

export function parseInventoryExpiryFilter(value: string | null | undefined): InventoryExpiryFilter | null {
    return value === 'expired' || value === 'expiring' || value === 'attention' ? value : null;
}

export function matchesInventoryExpiryFilter(level: ExpiryLevel | undefined, filter: InventoryExpiryFilter): boolean {
    if (filter === 'expired') return level === 'expired';
    if (filter === 'attention') return level === 'expired' || level === 'critical' || level === 'warning';
    return level === 'critical' || level === 'warning';
}
