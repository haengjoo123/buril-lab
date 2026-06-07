import type { ReagentPlacement, ShelfData } from '../types/fridge';

export type CabinetLayoutSnapshot = ShelfData[];

export interface CabinetLayoutHistoryState {
    shelves: ShelfData[];
    layoutUndoStack: CabinetLayoutSnapshot[];
    layoutRedoStack: CabinetLayoutSnapshot[];
}

export const CABINET_LAYOUT_HISTORY_LIMIT = 50;

const cloneReagentPlacement = (item: ReagentPlacement): ReagentPlacement => ({
    ...item,
    hCodes: [...(item.hCodes || [])],
});

export const createCabinetLayoutSnapshot = (shelves: ShelfData[]): CabinetLayoutSnapshot =>
    shelves.map((shelf) => ({
        ...shelf,
        dividers: [...shelf.dividers],
        items: shelf.items.map(cloneReagentPlacement),
    }));

const getLayoutSignature = (shelves: ShelfData[]) => JSON.stringify(
    shelves.map((shelf) => ({
        id: shelf.id,
        level: shelf.level,
        dividers: shelf.dividers,
        items: shelf.items.map((item) => ({
            id: item.id,
            shelfId: shelf.id,
            position: item.position,
            depthPosition: item.depthPosition ?? null,
            width: item.width,
            template: item.template,
        })),
    }))
);

export const areCabinetLayoutsEqual = (left: ShelfData[], right: ShelfData[]) =>
    getLayoutSignature(left) === getLayoutSignature(right);

export const pushCabinetLayoutHistory = (
    stack: CabinetLayoutSnapshot[],
    snapshot: CabinetLayoutSnapshot,
    limit = CABINET_LAYOUT_HISTORY_LIMIT
): CabinetLayoutSnapshot[] => {
    const next = [...stack, createCabinetLayoutSnapshot(snapshot)];
    return next.length > limit ? next.slice(next.length - limit) : next;
};

export const restoreCabinetLayoutSnapshot = (
    snapshot: CabinetLayoutSnapshot,
    currentShelves: ShelfData[]
): ShelfData[] => {
    const currentItemsById = new Map<string, ReagentPlacement>();
    currentShelves.forEach((shelf) => {
        shelf.items.forEach((item) => currentItemsById.set(item.id, item));
    });

    return snapshot.map((snapshotShelf) => ({
        ...snapshotShelf,
        dividers: [...snapshotShelf.dividers],
        items: snapshotShelf.items.map((snapshotItem) => {
            const currentItem = currentItemsById.get(snapshotItem.id);
            const baseItem = cloneReagentPlacement(currentItem ?? snapshotItem);

            return {
                ...baseItem,
                shelfId: snapshotShelf.id,
                position: snapshotItem.position,
                depthPosition: snapshotItem.depthPosition,
                width: snapshotItem.width,
                template: snapshotItem.template,
            };
        }),
    }));
};

export const createCabinetLayoutHistoryChange = (
    state: Pick<CabinetLayoutHistoryState, 'shelves' | 'layoutUndoStack'>,
    nextShelves: ShelfData[]
): Pick<CabinetLayoutHistoryState, 'shelves' | 'layoutUndoStack' | 'layoutRedoStack'> | null => {
    if (areCabinetLayoutsEqual(state.shelves, nextShelves)) return null;

    return {
        shelves: createCabinetLayoutSnapshot(nextShelves),
        layoutUndoStack: pushCabinetLayoutHistory(state.layoutUndoStack, state.shelves),
        layoutRedoStack: [],
    };
};

export const undoCabinetLayoutHistory = (
    state: CabinetLayoutHistoryState
): Pick<CabinetLayoutHistoryState, 'shelves' | 'layoutUndoStack' | 'layoutRedoStack'> | null => {
    const previousSnapshot = state.layoutUndoStack[state.layoutUndoStack.length - 1];
    if (!previousSnapshot) return null;

    return {
        shelves: restoreCabinetLayoutSnapshot(previousSnapshot, state.shelves),
        layoutUndoStack: state.layoutUndoStack.slice(0, -1),
        layoutRedoStack: pushCabinetLayoutHistory(state.layoutRedoStack, state.shelves),
    };
};

export const redoCabinetLayoutHistory = (
    state: CabinetLayoutHistoryState
): Pick<CabinetLayoutHistoryState, 'shelves' | 'layoutUndoStack' | 'layoutRedoStack'> | null => {
    const nextSnapshot = state.layoutRedoStack[state.layoutRedoStack.length - 1];
    if (!nextSnapshot) return null;

    return {
        shelves: restoreCabinetLayoutSnapshot(nextSnapshot, state.shelves),
        layoutUndoStack: pushCabinetLayoutHistory(state.layoutUndoStack, state.shelves),
        layoutRedoStack: state.layoutRedoStack.slice(0, -1),
    };
};
