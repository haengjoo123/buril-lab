import { describe, expect, it } from 'vitest';
import {
  INVENTORY_EXPIRY_FILTER_LABEL_KEYS,
  matchesInventoryExpiryFilter,
  parseInventoryExpiryFilter,
} from './inventoryExpiryFilter';

describe('inventory expiry filter', () => {
  it('accepts only the known values', () => {
    expect(parseInventoryExpiryFilter('expired')).toBe('expired');
    expect(parseInventoryExpiryFilter('expiring')).toBe('expiring');
    expect(parseInventoryExpiryFilter('attention')).toBe('attention');
    expect(parseInventoryExpiryFilter('new')).toBeNull();
    expect(parseInventoryExpiryFilter(null)).toBeNull();
  });

  it('maps expired to past or today and expiring to the next 30 days', () => {
    expect(matchesInventoryExpiryFilter('expired', 'expired')).toBe(true);
    expect(matchesInventoryExpiryFilter('critical', 'expired')).toBe(false);
    expect(matchesInventoryExpiryFilter('critical', 'expiring')).toBe(true);
    expect(matchesInventoryExpiryFilter('warning', 'expiring')).toBe(true);
    expect(matchesInventoryExpiryFilter('ok', 'expiring')).toBe(false);
    expect(matchesInventoryExpiryFilter(undefined, 'expired')).toBe(false);
  });

  it('keeps expired and expiring reagents together under attention', () => {
    expect(matchesInventoryExpiryFilter('expired', 'attention')).toBe(true);
    expect(matchesInventoryExpiryFilter('critical', 'attention')).toBe(true);
    expect(matchesInventoryExpiryFilter('warning', 'attention')).toBe(true);
    expect(matchesInventoryExpiryFilter('ok', 'attention')).toBe(false);
    expect(matchesInventoryExpiryFilter(null, 'attention')).toBe(false);
    expect(matchesInventoryExpiryFilter(undefined, 'attention')).toBe(false);
  });

  it('has a chip label for every filter', () => {
    expect(INVENTORY_EXPIRY_FILTER_LABEL_KEYS).toEqual({
      expired: 'inventory_filter_expired',
      expiring: 'inventory_filter_expiring',
      attention: 'inventory_filter_attention',
    });
  });
});
