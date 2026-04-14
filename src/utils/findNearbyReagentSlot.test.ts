import { describe, expect, it } from 'vitest';
import { findNearbyReagentSlot } from './findNearbyReagentSlot';
import type { ReagentPlacement, ShelfData } from '../types/fridge';

function createItem(overrides: Partial<ReagentPlacement> = {}): ReagentPlacement {
    return {
        id: overrides.id ?? `item-${Math.random().toString(16).slice(2)}`,
        reagentId: overrides.reagentId ?? overrides.id ?? 'inventory-id',
        linkedInventoryItemId: overrides.linkedInventoryItemId,
        name: overrides.name ?? 'Test Reagent',
        position: overrides.position ?? 20,
        depthPosition: overrides.depthPosition ?? 50,
        width: overrides.width ?? 10,
        template: overrides.template ?? 'B',
        shelfId: overrides.shelfId ?? 'shelf-1',
        isAcidic: overrides.isAcidic ?? false,
        isBasic: overrides.isBasic ?? false,
        hCodes: overrides.hCodes ?? [],
        notes: overrides.notes,
        casNo: overrides.casNo,
        capacity: overrides.capacity,
        productNumber: overrides.productNumber,
        brand: overrides.brand,
        expiryDate: overrides.expiryDate,
        remaining_percent: overrides.remaining_percent,
    };
}

function createShelf(id: string, level: number, items: ReagentPlacement[] = []): ShelfData {
    return {
        id,
        level,
        dividers: [],
        items: items.map((item) => ({ ...item, shelfId: id })),
    };
}

describe('findNearbyReagentSlot', () => {
    it('places the copy on the same shelf when nearby space exists', () => {
        const source = createItem({ id: 'source', position: 30, width: 10, shelfId: 'shelf-1' });
        const blocker = createItem({ id: 'blocker', position: 12, width: 10, shelfId: 'shelf-1' });
        const shelves = [
            createShelf('shelf-1', 0, [source, blocker]),
            createShelf('shelf-2', 1, []),
        ];

        const slot = findNearbyReagentSlot({
            shelves,
            referenceItem: source,
            cabinetWidth: 5,
            cabinetDepth: 2,
        });

        expect(slot).not.toBeNull();
        expect(slot?.shelfId).toBe('shelf-1');
        expect(slot?.position).toBe(44);
        expect(slot?.depthPosition).toBe(50);
    });

    it('falls back to the closest adjacent shelf when the source shelf is full', () => {
        const source = createItem({ id: 'source', position: 30, width: 10, shelfId: 'shelf-1' });
        const blockers = [
            createItem({ id: 'left-0', position: 4, width: 10, shelfId: 'shelf-1' }),
            createItem({ id: 'left-1', position: 16, width: 10, shelfId: 'shelf-1' }),
            createItem({ id: 'right-0', position: 44, width: 10, shelfId: 'shelf-1' }),
            createItem({ id: 'right-1', position: 56, width: 10, shelfId: 'shelf-1' }),
            createItem({ id: 'right-2', position: 68, width: 10, shelfId: 'shelf-1' }),
            createItem({ id: 'right-3', position: 80, width: 10, shelfId: 'shelf-1' }),
            createItem({ id: 'front', position: 30, width: 10, depthPosition: 34, shelfId: 'shelf-1' }),
            createItem({ id: 'back', position: 30, width: 10, depthPosition: 66, shelfId: 'shelf-1' }),
        ];
        const shelves = [
            createShelf('shelf-1', 1, [source, ...blockers]),
            createShelf('shelf-0', 0, []),
            createShelf('shelf-2', 2, []),
        ];

        const slot = findNearbyReagentSlot({
            shelves,
            referenceItem: source,
            cabinetWidth: 5,
            cabinetDepth: 2,
        });

        expect(slot).not.toBeNull();
        expect(slot?.shelfId).toBe('shelf-0');
        expect(slot?.position).toBe(30);
        expect(slot?.depthPosition).toBe(50);
    });

    it('returns null when there is no valid slot in any shelf', () => {
        const source = createItem({ id: 'source', position: 4, width: 92, shelfId: 'shelf-1' });
        const shelves = [
            createShelf('shelf-1', 0, [source]),
            createShelf('shelf-2', 1, [createItem({ id: 'full', position: 4, width: 92, shelfId: 'shelf-2' })]),
        ];

        const slot = findNearbyReagentSlot({
            shelves,
            referenceItem: source,
            cabinetWidth: 5,
            cabinetDepth: 2,
        });

        expect(slot).toBeNull();
    });
});
