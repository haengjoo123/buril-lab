import { describe, expect, it } from 'vitest';
import type { InventoryItem } from '../services/inventoryService';
import type { ReagentPlacement } from '../types/fridge';
import { classifyInventoryHazard } from './inventoryHazardClassifier';
import { checkShelfCompatibility, classifyStorageGroups } from './storageCompatibilityChecker';

function createInventoryItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
    return {
        id: overrides.id ?? 'item-1',
        lab_id: overrides.lab_id ?? 'lab-1',
        user_id: overrides.user_id ?? null,
        name: overrides.name ?? 'Sodium azide',
        brand: overrides.brand ?? null,
        product_number: overrides.product_number ?? null,
        cas_number: overrides.cas_number ?? '26628-22-8',
        quantity: overrides.quantity ?? 1,
        capacity: overrides.capacity ?? '25g',
        storage_type: overrides.storage_type ?? 'cabinet',
        cabinet_id: overrides.cabinet_id ?? null,
        storage_location_id: overrides.storage_location_id ?? null,
        product_id: overrides.product_id ?? null,
        expiry_date: overrides.expiry_date ?? null,
        manufacturer_date_type: overrides.manufacturer_date_type ?? 'unlabeled',
        received_date: overrides.received_date ?? null,
        opened_date: overrides.opened_date ?? null,
        memo: overrides.memo ?? null,
        remaining_percent: overrides.remaining_percent ?? 100,
        created_at: overrides.created_at ?? '2026-01-01T00:00:00.000Z',
        updated_at: overrides.updated_at ?? '2026-01-01T00:00:00.000Z',
        cabinet_name: overrides.cabinet_name,
        storage_location_name: overrides.storage_location_name,
        _source: overrides._source ?? 'inventory',
    };
}

function createPlacement(overrides: Partial<ReagentPlacement> = {}): ReagentPlacement {
    return {
        id: overrides.id ?? 'placement-1',
        reagentId: overrides.reagentId ?? overrides.id ?? 'reagent-1',
        name: overrides.name ?? 'Sodium azide',
        position: overrides.position ?? 4,
        width: overrides.width ?? 8,
        template: overrides.template ?? 'A',
        shelfId: overrides.shelfId ?? 'shelf-1',
        isAcidic: overrides.isAcidic ?? false,
        isBasic: overrides.isBasic ?? false,
        hCodes: overrides.hCodes ?? [],
        notes: overrides.notes,
        casNo: overrides.casNo,
        capacity: overrides.capacity,
        productNumber: overrides.productNumber,
        brand: overrides.brand,
    };
}

describe('classifyInventoryHazard', () => {
    it('does not classify Sodium azide as high-risk from its name alone', () => {
        const result = classifyInventoryHazard(createInventoryItem());

        expect(result.level).toBe('none');
        expect(result.groups).not.toContain('TOXIC_AZIDE');
        expect(result.needsReview).toBe(true);
        expect(result.filterCategories).not.toContain('special_high');
        expect(result.groupLabelKeys).not.toContain('storage_group_azide');
    });

    it('classifies fatal acute toxicity H-codes as high-risk', () => {
        const result = classifyInventoryHazard(
            createInventoryItem({
                name: 'Neutral acute toxicity sample',
                cas_number: '50-00-0',
            }),
            { hCodes: ['H300'] },
        );

        expect(result.level).toBe('high');
        expect(result.groups).toContain('ACUTE_TOXIC');
        expect(result.groupLabelKeys).toContain('storage_group_acute_toxic');
    });

    it('keeps ordinary flammables visible without labeling every solvent special-high', () => {
        const result = classifyInventoryHazard(
            createInventoryItem({ name: 'Acetone', cas_number: '67-64-1' }),
            { hCodes: ['H225'] },
        );

        expect(result.level).toBe('none');
        expect(result.filterCategories).toContain('flammable');
        expect(result.filterCategories).not.toContain('special_high');
        expect(result.groupLabelKeys).toContain('storage_group_flammable');
    });

    it('separates corrosive and other managed risks into their own filters', () => {
        const corrosive = classifyInventoryHazard(
            createInventoryItem({ name: 'Hydrochloric acid', cas_number: '7647-01-0' }),
            { hCodes: ['H314'] },
        );
        const environmental = classifyInventoryHazard(
            createInventoryItem({ name: 'Environmental sample' }),
            { hCodes: ['H410'] },
        );

        expect(corrosive.filterCategories).toContain('corrosive');
        expect(environmental.filterCategories).toContain('other_managed');
    });
});

describe('storageCompatibilityChecker azide handling', () => {
    it('classifies azide placements and warns when stored with acids', () => {
        const sodiumAzide = createPlacement({ id: 'azide', name: 'Sodium azide', casNo: '26628-22-8' });
        const aceticAcid = createPlacement({ id: 'acid', name: 'Acetic acid', position: 20 });

        expect(classifyStorageGroups(sodiumAzide)).not.toContain('TOXIC_AZIDE');

        const warnings = checkShelfCompatibility([sodiumAzide, aceticAcid]);

        expect(warnings).toEqual([]);
    });
});
