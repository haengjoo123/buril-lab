import { describe, expect, it } from 'vitest';
import type { InventoryItem } from '../../services/inventoryService';
import { createInventorySearchMatcher } from './inventorySearch';

function item(overrides: Partial<InventoryItem>): InventoryItem {
    return {
        id: overrides.id ?? overrides.name ?? 'item',
        lab_id: null,
        user_id: null,
        name: 'Unnamed',
        brand: null,
        product_number: null,
        cas_number: null,
        quantity: 1,
        capacity: null,
        storage_type: 'other',
        cabinet_id: null,
        storage_location_id: null,
        product_id: null,
        expiry_date: null,
        manufacturer_date_type: 'unlabeled',
        received_date: null,
        opened_date: null,
        memo: null,
        remaining_percent: 100,
        created_at: '2026-11-01T00:00:00.000Z',
        updated_at: '2026-11-01T00:00:00.000Z',
        _source: 'inventory',
        ...overrides,
    };
}

const search = (query: string, items: InventoryItem[]) => {
    const matcher = createInventorySearchMatcher(query);
    return matcher ? items.filter(matcher).map((entry) => entry.name) : items.map((entry) => entry.name);
};

describe('inventory search', () => {
    const stock = [
        item({ name: 'Hydrochloric acid 37%' }),
        item({ name: 'HCl solution', cas_number: '7647-01-0' }),
        item({ name: 'Tris-HCl' }),
        item({ name: 'Acetone', brand: 'Duksan' }),
        item({ name: '아세톤 (특급)' }),
        item({ name: 'Sulfuric acid 98%', cas_number: '7664-93-9' }),
    ];

    it('finds an English-named stock by its Korean name and by CAS equivalence', () => {
        expect(search('염산', stock)).toEqual(['Hydrochloric acid 37%', 'HCl solution']);
    });

    it('finds Korean-named stock from an English query and vice versa', () => {
        expect(search('acetone', stock)).toEqual(['Acetone', '아세톤 (특급)']);
        expect(search('아세톤', stock)).toEqual(['Acetone', '아세톤 (특급)']);
    });

    it('keeps plain substring matching on brand, product number and CAS', () => {
        expect(search('duksan', stock)).toEqual(['Acetone']);
        expect(search('7664-93', stock)).toEqual(['Sulfuric acid 98%']);
    });

    it('ignores spacing differences and does not widen unrelated acids', () => {
        expect(search('hydrochloricacid', stock)).toContain('Hydrochloric acid 37%');
        expect(search('황산', stock)).toEqual(['Sulfuric acid 98%']);
    });

    it('returns no matcher for an empty query', () => {
        expect(createInventorySearchMatcher('   ')).toBeNull();
    });
});
