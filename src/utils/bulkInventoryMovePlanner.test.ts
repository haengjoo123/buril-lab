import { describe, expect, it } from 'vitest';
import type { ReagentPlacement, ShelfData } from '../types/fridge';
import { planBulkInventoryCabinetMove } from './bulkInventoryMovePlanner';

function placement(overrides: Partial<ReagentPlacement> = {}): ReagentPlacement {
    return {
        id: 'existing-1',
        reagentId: 'existing-inventory',
        linkedInventoryItemId: 'existing-inventory',
        name: 'Existing',
        position: 2,
        depthPosition: 50,
        width: 10,
        template: 'B',
        shelfId: 'shelf-1',
        isAcidic: false,
        isBasic: false,
        hCodes: [],
        ...overrides,
    };
}

function shelves(items: ReagentPlacement[] = []): ShelfData[] {
    return [{ id: 'shelf-1', level: 0, dividers: [], items }];
}

describe('planBulkInventoryCabinetMove', () => {
    it('plans every candidate against both existing and newly planned placements', () => {
        const result = planBulkInventoryCabinetMove({
            shelves: shelves([placement()]),
            cabinetWidth: 5,
            cabinetDepth: 2,
            candidates: [
                { itemId: 'item-a', itemSource: 'inventory', name: 'A', template: 'A', width: 8 },
                { itemId: 'item-b', itemSource: 'cabinet_item', name: 'B', template: 'B', width: 10 },
            ],
        });

        expect(result).toHaveLength(2);
        expect(result?.map((item) => item.placement.shelf_id)).toEqual(['shelf-1', 'shelf-1']);
        expect(new Set(result?.map((item) => (
            `${item.placement.position}:${item.placement.depth_position}`
        ))).size).toBe(2);
    });

    it('removes a target existing placement from the planning snapshot before repositioning it', () => {
        const result = planBulkInventoryCabinetMove({
            shelves: shelves([placement()]),
            cabinetWidth: 5,
            cabinetDepth: 2,
            candidates: [{
                itemId: 'existing-inventory',
                itemSource: 'inventory',
                name: 'Existing',
                template: 'B',
                width: 10,
            }],
        });

        expect(result?.[0].placement).toMatchObject({
            shelf_id: 'shelf-1',
            position: 2,
            depth_position: 50,
        });
    });

    it('returns null when the entire target cabinet cannot be planned', () => {
        expect(planBulkInventoryCabinetMove({
            shelves: [],
            cabinetWidth: 5,
            cabinetDepth: 2,
            candidates: [{
                itemId: 'item-a',
                itemSource: 'inventory',
                name: 'A',
                template: 'A',
                width: 8,
            }],
        })).toBeNull();
    });
});
