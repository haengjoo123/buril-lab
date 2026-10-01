import { describe, expect, it } from 'vitest';
import { hasPlacementCollision, isCabinetLayoutValid } from './cabinetPlacementValidation';
import type { ReagentPlacement, ShelfData } from '../types/fridge';
const dimensions = { cabinetWidth: 5, cabinetHeight: 9, cabinetDepth: 2 };
const item: ReagentPlacement = { id: 'item', reagentId: 'r', shelfId: 's', position: 30, depthPosition: 50, width: 8, template: 'A', name: 'Test', hCodes: [], isAcidic: false, isBasic: false };
const shelves: ShelfData[] = [{ id: 's', level: 0, dividers: [], items: [item] }];
describe('cabinet physical placement', () => {
    it('rejects missing destinations without removing an existing item', () => expect(hasPlacementCollision(shelves, dimensions, { ...item, shelfId: 'missing' }, item.id)).toBe(true));
    it('checks logical bounds after resizing', () => expect(hasPlacementCollision(shelves, dimensions, { ...item, position: 90, width: 30 }, item.id)).toBe(true));
    it('checks the physical footprint against the front and rear walls', () => {
        expect(hasPlacementCollision(shelves, dimensions, { ...item, depthPosition: 0 }, item.id)).toBe(true);
        expect(hasPlacementCollision(shelves, dimensions, { ...item, depthPosition: 100 }, item.id)).toBe(true);
    });
    it('blocks divider intersections and shelf height overflow', () => {
        expect(hasPlacementCollision([{ ...shelves[0], dividers: [34] }], dimensions, item, item.id)).toBe(true);
        expect(hasPlacementCollision(shelves, { ...dimensions, cabinetHeight: 2 }, { ...item, width: 30 }, item.id)).toBe(true);
    });
    it('allows depth separation and blocks intersecting containers', () => {
        expect(hasPlacementCollision(shelves, dimensions, item)).toBe(true);
        expect(hasPlacementCollision(shelves, dimensions, { ...item, depthPosition: 80 })).toBe(false);
    });
    it('rejects non-finite coordinates and excessive shelf counts', () => {
        expect(hasPlacementCollision(shelves, dimensions, { ...item, position: NaN }, item.id)).toBe(true);
        expect(isCabinetLayoutValid(Array.from({ length: 30 }, (_, n) => ({ id: String(n), level: n, dividers: [], items: [] })), { ...dimensions, cabinetHeight: 2 })).toBe(false);
    });
});
