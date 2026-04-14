import { describe, expect, it } from 'vitest';
import type { ReagentPlacement, ShelfData } from '../types/fridge';
import { buildCabinetAutoLayoutPlan } from './cabinetAutoLayoutPlanner';
import { checkCabinetCompatibility } from './storageCompatibilityChecker';

function createItem(overrides: Partial<ReagentPlacement> = {}): ReagentPlacement {
    return {
        id: overrides.id ?? `item-${Math.random().toString(16).slice(2)}`,
        reagentId: overrides.reagentId ?? overrides.id ?? `reagent-${Math.random().toString(16).slice(2)}`,
        name: overrides.name ?? 'Acetone',
        position: overrides.position ?? 4,
        depthPosition: overrides.depthPosition ?? 50,
        width: overrides.width ?? 8,
        template: overrides.template ?? 'A',
        shelfId: overrides.shelfId ?? 'shelf-1',
        isAcidic: overrides.isAcidic ?? false,
        isBasic: overrides.isBasic ?? false,
        hCodes: overrides.hCodes ?? [],
        notes: overrides.notes,
        casNo: overrides.casNo,
        chemId: overrides.chemId,
        expiryDate: overrides.expiryDate,
        capacity: overrides.capacity,
        productNumber: overrides.productNumber,
        brand: overrides.brand,
        remaining_percent: overrides.remaining_percent,
    };
}

function createShelf(id: string, level: number, items: ReagentPlacement[], dividers: number[] = []): ShelfData {
    return {
        id,
        level,
        dividers,
        items,
    };
}

function getPlacedItem(preview: ReturnType<typeof buildCabinetAutoLayoutPlan>, itemId: string) {
    return preview.plannedShelves.flatMap((shelf) => shelf.items).find((item) => item.id === itemId);
}

describe('buildCabinetAutoLayoutPlan', () => {
    it('separates incompatible reagents into different divider zones on the same shelf', () => {
        const flammable = createItem({
            id: 'flammable',
            name: 'Acetone',
            hCodes: ['H225'],
        });
        const oxidizer = createItem({
            id: 'oxidizer',
            name: 'Hydrogen Peroxide',
            hCodes: ['H272'],
            position: 18,
        });
        const shelves = [createShelf('shelf-1', 0, [flammable, oxidizer], [50])];

        const preview = buildCabinetAutoLayoutPlan(shelves, 5, 9, 2);
        const placedFlammable = getPlacedItem(preview, 'flammable');
        const placedOxidizer = getPlacedItem(preview, 'oxidizer');

        expect(preview.afterWarningCount).toBe(0);
        expect(preview.unplacedItems).toHaveLength(0);
        expect(placedFlammable?.shelfId).toBe('shelf-1');
        expect(placedOxidizer?.shelfId).toBe('shelf-1');
        const flammableCenter = placedFlammable!.position + placedFlammable!.width / 2;
        const oxidizerCenter = placedOxidizer!.position + placedOxidizer!.width / 2;
        expect((flammableCenter < 50 && oxidizerCenter > 50) || (flammableCenter > 50 && oxidizerCenter < 50)).toBe(true);
    });

    it('separates flammable, oxidizer, and acid reagents without leaving compatibility conflicts', () => {
        const shelves = [
            createShelf('shelf-1', 0, [
                createItem({ id: 'flammable', name: 'Ethanol', hCodes: ['H225'], shelfId: 'shelf-1' }),
                createItem({ id: 'oxidizer', name: 'Potassium permanganate', hCodes: ['H272'], shelfId: 'shelf-1', position: 18 }),
                createItem({ id: 'acid', name: 'Hydrochloric Acid', shelfId: 'shelf-1', position: 32 }),
            ]),
            createShelf('shelf-2', 1, []),
            createShelf('shelf-3', 2, []),
        ];

        const preview = buildCabinetAutoLayoutPlan(shelves, 5, 9, 2);
        const placedShelfIds = new Set(
            ['flammable', 'oxidizer', 'acid']
                .map((id) => getPlacedItem(preview, id)?.shelfId)
                .filter(Boolean)
        );

        expect(preview.afterWarningCount).toBe(0);
        expect(preview.unplacedItems).toHaveLength(0);
        expect(placedShelfIds.size).toBe(3);
        expect(checkCabinetCompatibility(preview.plannedShelves).size).toBe(0);
    });

    it('does not place a container when its height exceeds the shelf clearance', () => {
        const shelves = [
            createShelf('shelf-1', 0, [createItem({ id: 'tall-acid', name: 'Nitric Acid', width: 16 })]),
            createShelf('shelf-2', 1, []),
            createShelf('shelf-3', 2, []),
            createShelf('shelf-4', 3, []),
        ];

        const preview = buildCabinetAutoLayoutPlan(shelves, 5, 9, 2);

        expect(getPlacedItem(preview, 'tall-acid')).toBeUndefined();
        expect(preview.canApply).toBe(false);
        expect(preview.unplacedItems).toEqual([
            expect.objectContaining({
                itemId: 'tall-acid',
                messageKey: 'cabinet_auto_place_unplaced_height',
            }),
        ]);
    });

    it('places a name-only reagent as a general reagent and marks it for review', () => {
        const shelves = [
            createShelf('shelf-1', 0, [
                createItem({
                    id: 'general-item',
                    name: 'Buffer Solution',
                    hCodes: [],
                    casNo: undefined,
                    notes: undefined,
                    brand: undefined,
                    productNumber: undefined,
                }),
            ]),
        ];

        const preview = buildCabinetAutoLayoutPlan(shelves, 5, 9, 2);

        expect(getPlacedItem(preview, 'general-item')).toBeDefined();
        expect(preview.unplacedItems).toHaveLength(0);
        expect(preview.reviewItems).toEqual([
            expect.objectContaining({
                itemId: 'general-item',
                group: 'GENERAL',
                messageKey: 'cabinet_auto_place_review_general',
            }),
        ]);
    });

    it('moves hard-to-identify reagents into the classification review list and leaves them unplaced', () => {
        const shelves = [
            createShelf('shelf-1', 0, [
                createItem({
                    id: 'unknown-item',
                    name: '???',
                    hCodes: [],
                    notes: undefined,
                    casNo: undefined,
                    brand: undefined,
                    productNumber: undefined,
                }),
            ]),
        ];

        const preview = buildCabinetAutoLayoutPlan(shelves, 5, 9, 2);

        expect(getPlacedItem(preview, 'unknown-item')).toBeUndefined();
        expect(preview.reviewItems).toEqual([
            expect.objectContaining({
                itemId: 'unknown-item',
                messageKey: 'cabinet_auto_place_review_identity',
            }),
        ]);
        expect(preview.unplacedItems).toEqual([
            expect.objectContaining({
                itemId: 'unknown-item',
                messageKey: 'cabinet_auto_place_unplaced_identity',
            }),
        ]);
    });

    it('blocks apply when space runs out and reports the unplaced item accurately', () => {
        const shelves = [
            createShelf('shelf-1', 0, [
                createItem({ id: 'acid-1', name: 'Acetic Acid A', width: 29 }),
                createItem({ id: 'acid-2', name: 'Acetic Acid B', width: 29, position: 32 }),
                createItem({ id: 'acid-3', name: 'Acetic Acid C', width: 29, position: 60 }),
            ]),
        ];

        const preview = buildCabinetAutoLayoutPlan(shelves, 5, 9, 2);

        expect(preview.canApply).toBe(false);
        expect(preview.afterWarningCount).toBe(0);
        expect(preview.unplacedItems).toHaveLength(1);
        expect(preview.unplacedItems[0]).toEqual(
            expect.objectContaining({
                itemId: 'acid-3',
                messageKey: 'cabinet_auto_place_unplaced_space',
            })
        );
    });
});
