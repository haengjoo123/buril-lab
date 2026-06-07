import { describe, expect, it } from 'vitest';
import type { ReagentPlacement, ShelfData } from '../types/fridge';
import {
    createCabinetLayoutHistoryChange,
    redoCabinetLayoutHistory,
    undoCabinetLayoutHistory,
} from './cabinetLayoutHistory';

const makeItem = (overrides: Partial<ReagentPlacement>): ReagentPlacement => ({
    id: 'item-a',
    reagentId: 'reagent-a',
    name: 'Acetone',
    position: 10,
    depthPosition: 50,
    width: 8,
    template: 'A',
    shelfId: 'shelf-a',
    isAcidic: false,
    isBasic: false,
    hCodes: [],
    ...overrides,
});

const makeShelves = (items: ReagentPlacement[] = [makeItem({})]): ShelfData[] => [
    { id: 'shelf-a', level: 0, dividers: [], items: items.filter((item) => item.shelfId === 'shelf-a') },
    { id: 'shelf-b', level: 1, dividers: [], items: items.filter((item) => item.shelfId === 'shelf-b') },
];

describe('cabinet layout history', () => {
    it('moves between previous and next positions with undo and redo', () => {
        const initialShelves = makeShelves();
        const movedShelves = makeShelves([
            makeItem({ position: 70, depthPosition: 20 }),
        ]);
        const changed = createCabinetLayoutHistoryChange({
            shelves: initialShelves,
            layoutUndoStack: [],
        }, movedShelves);

        expect(changed?.layoutUndoStack).toHaveLength(1);

        const undone = undoCabinetLayoutHistory({
            shelves: changed!.shelves,
            layoutUndoStack: changed!.layoutUndoStack,
            layoutRedoStack: changed!.layoutRedoStack,
        });
        expect(undone?.shelves[0].items[0].position).toBe(10);
        expect(undone?.layoutRedoStack).toHaveLength(1);

        const redone = redoCabinetLayoutHistory({
            shelves: undone!.shelves,
            layoutUndoStack: undone!.layoutUndoStack,
            layoutRedoStack: undone!.layoutRedoStack,
        });
        expect(redone?.shelves[0].items[0].position).toBe(70);
        expect(redone?.shelves[0].items[0].depthPosition).toBe(20);
        expect(redone?.layoutRedoStack).toHaveLength(0);
    });

    it('clears redo history when a new layout change happens after undo', () => {
        const initialShelves = makeShelves();
        const movedShelves = makeShelves([makeItem({ position: 40 })]);
        const changed = createCabinetLayoutHistoryChange({
            shelves: initialShelves,
            layoutUndoStack: [],
        }, movedShelves)!;
        const undone = undoCabinetLayoutHistory({
            shelves: changed.shelves,
            layoutUndoStack: changed.layoutUndoStack,
            layoutRedoStack: changed.layoutRedoStack,
        })!;
        const newChange = createCabinetLayoutHistoryChange({
            shelves: undone.shelves,
            layoutUndoStack: undone.layoutUndoStack,
        }, makeShelves([makeItem({ position: 80 })]));

        expect(newChange?.layoutRedoStack).toHaveLength(0);
    });

    it('keeps latest reagent metadata while restoring only layout fields', () => {
        const initialShelves = makeShelves([makeItem({ name: 'Old name', casNo: 'old-cas', position: 10 })]);
        const movedShelves = makeShelves([makeItem({ name: 'Old name', casNo: 'old-cas', position: 60 })]);
        const changed = createCabinetLayoutHistoryChange({
            shelves: initialShelves,
            layoutUndoStack: [],
        }, movedShelves)!;
        const editedCurrentShelves = makeShelves([
            makeItem({ name: 'Latest name', casNo: 'latest-cas', position: 60, hCodes: ['H225'] }),
        ]);
        const undone = undoCabinetLayoutHistory({
            shelves: editedCurrentShelves,
            layoutUndoStack: changed.layoutUndoStack,
            layoutRedoStack: changed.layoutRedoStack,
        });

        const item = undone?.shelves[0].items[0];
        expect(item?.position).toBe(10);
        expect(item?.name).toBe('Latest name');
        expect(item?.casNo).toBe('latest-cas');
        expect(item?.hCodes).toEqual(['H225']);
    });

    it('restores deleted items and removes newly added items through snapshots', () => {
        const initialShelves = makeShelves([makeItem({ id: 'deleted-item', reagentId: 'deleted', name: 'Deleted' })]);
        const emptyShelves = makeShelves([]);
        const deletion = createCabinetLayoutHistoryChange({
            shelves: initialShelves,
            layoutUndoStack: [],
        }, emptyShelves)!;
        const restoredDeletion = undoCabinetLayoutHistory({
            shelves: deletion.shelves,
            layoutUndoStack: deletion.layoutUndoStack,
            layoutRedoStack: deletion.layoutRedoStack,
        });
        expect(restoredDeletion?.shelves[0].items.map((item) => item.id)).toEqual(['deleted-item']);

        const addition = createCabinetLayoutHistoryChange({
            shelves: emptyShelves,
            layoutUndoStack: [],
        }, makeShelves([makeItem({ id: 'new-item', reagentId: 'new', name: 'New' })]))!;
        const restoredAddition = undoCabinetLayoutHistory({
            shelves: addition.shelves,
            layoutUndoStack: addition.layoutUndoStack,
            layoutRedoStack: addition.layoutRedoStack,
        });
        expect(restoredAddition?.shelves.flatMap((shelf) => shelf.items)).toHaveLength(0);
    });
});
