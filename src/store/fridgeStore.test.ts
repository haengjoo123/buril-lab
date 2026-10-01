import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompatibilityPlanPreview, ReagentPlacement, ShelfData } from '../types/fridge';

const saveCabinetStateMock = vi.hoisted(() => vi.fn());
const getCabinetDetailsMock = vi.hoisted(() => vi.fn());
const saveReagentGHSMock = vi.hoisted(() => vi.fn());
const lookupGHSMock = vi.hoisted(() => vi.fn());

vi.mock('../services/cabinetService', () => ({
    cabinetService: {
        saveCabinetState: saveCabinetStateMock,
        getCabinetDetails: getCabinetDetailsMock,
        saveReagentGHS: saveReagentGHSMock,
    },
}));

vi.mock('../services/pubchemService', () => ({
    lookupGHSByCAS: lookupGHSMock,
}));

import { useFridgeStore } from './fridgeStore';

const createItem = (position: number): ReagentPlacement => ({
    id: '11111111-1111-4111-8111-111111111111',
    reagentId: 'reagent-1',
    name: 'Acetone',
    position,
    depthPosition: 50,
    width: 8,
    template: 'A',
    shelfId: '22222222-2222-4222-8222-222222222222',
    isAcidic: false,
    isBasic: false,
    hCodes: ['H225'],
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}

describe('cabinet async and placement safety', () => {
    beforeEach(() => {
        resetStore();
        saveCabinetStateMock.mockReset();
        getCabinetDetailsMock.mockReset();
        saveReagentGHSMock.mockReset();
        lookupGHSMock.mockReset();
    });

    it('refuses saving after a failed load, including a reload of the same cabinet', async () => {
        getCabinetDetailsMock.mockRejectedValue(new Error('offline'));
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        await useFridgeStore.getState().loadCabinet('33333333-3333-4333-8333-333333333333');
        await expect(useFridgeStore.getState().saveCabinetStrict()).rejects.toThrow('before it has loaded');
        expect(saveCabinetStateMock).not.toHaveBeenCalled();
        log.mockRestore();
    });

    it('keeps the newest response when the same cabinet is loaded twice', async () => {
        const first = deferred<{ shelves: ShelfData[]; cabinetName: string; width: number; height: number; depth: number }>();
        getCabinetDetailsMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ shelves: createShelves(40), cabinetName: 'New', width: 5, height: 9, depth: 2 });
        const older = useFridgeStore.getState().loadCabinet('same');
        await useFridgeStore.getState().loadCabinet('same');
        first.resolve({ shelves: createShelves(4), cabinetName: 'Old', width: 5, height: 9, depth: 2 });
        await older;
        expect(useFridgeStore.getState().cabinetName).toBe('New');
        expect(useFridgeStore.getState().shelves[0].items[0].position).toBe(40);
    });

    it('does not apply or save an enrichment result after switching cabinets', async () => {
        const lookup = deferred<unknown>();
        useFridgeStore.setState({ shelves: [{ ...createShelves(4)[0], items: [{ ...createItem(4), casNo: '67-64-1', hCodes: [] }] }] });
        lookupGHSMock.mockReturnValue(lookup.promise);
        const enrichment = useFridgeStore.getState().enrichReagentGHS(createItem(4).id);
        getCabinetDetailsMock.mockResolvedValue({ shelves: [], cabinetName: 'B', width: 5, height: 9, depth: 2 });
        await useFridgeStore.getState().loadCabinet('B');
        lookup.resolve({ success: true, hCodes: ['H225'], status: 'success', isAcidic: false, isBasic: false });
        await enrichment;
        expect(useFridgeStore.getState().shelves).toEqual([]);
        expect(saveCabinetStateMock).not.toHaveBeenCalled();
        expect(saveReagentGHSMock).not.toHaveBeenCalled();
    });

    it('allows a new lookup when CAS changes and ignores the older lookup', async () => {
        const first = deferred<unknown>(); const second = deferred<unknown>();
        useFridgeStore.setState({ shelves: [{ ...createShelves(4)[0], items: [{ ...createItem(4), casNo: '67-64-1', hCodes: [] }] }] });
        lookupGHSMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const old = useFridgeStore.getState().enrichReagentGHS(createItem(4).id);
        useFridgeStore.getState().updateReagent(createItem(4).id, { casNo: '7732-18-5' });
        const current = useFridgeStore.getState().enrichReagentGHS(createItem(4).id);
        first.resolve({ success: true, hCodes: ['H225'], status: 'success', isAcidic: false, isBasic: false });
        await old;
        second.resolve({ success: true, hCodes: [], status: 'no_ghs', isAcidic: false, isBasic: false });
        await current;
        expect(lookupGHSMock).toHaveBeenCalledTimes(2);
        expect(useFridgeStore.getState().shelves[0].items[0].hCodes).toEqual([]);
        expect(saveReagentGHSMock).toHaveBeenCalledOnce();
        expect(saveCabinetStateMock).not.toHaveBeenCalled();
    });

    it('rejects an invalid destination and an oversized manual placement without changing items', () => {
        const previous = useFridgeStore.getState().shelves;
        expect(useFridgeStore.getState().moveReagent(createItem(4).id, 'missing', 30)).toBe(false);
        expect(useFridgeStore.getState().placeReagent(previous[0].id, { ...createItem(4), position: 90, width: 30 })).toBe(false);
        expect(useFridgeStore.getState().shelves).toBe(previous);
    });

    it('clears pending placement and drag state when returning to view mode', () => {
        useFridgeStore.setState({ draggedItem: { id: 'item', originalShelfId: 'shelf', originalPosition: 30 }, focusedShelfId: 'shelf' });
        useFridgeStore.getState().setMode('VIEW');
        expect(useFridgeStore.getState().draggedItem).toBeNull();
        expect(useFridgeStore.getState().focusedShelfId).toBeNull();
    });
});

const createShelves = (position: number): ShelfData[] => [{
    id: '22222222-2222-4222-8222-222222222222',
    level: 0,
    dividers: [],
    items: [createItem(position)],
}];

const createPreview = (plannedShelves: ShelfData[]): CompatibilityPlanPreview => ({
    plannedShelves,
    beforeWarningCount: 1,
    afterWarningCount: 0,
    movedItemCount: 1,
    movedItemIds: ['11111111-1111-4111-8111-111111111111'],
    reviewItems: [],
    unplacedItems: [],
    canApply: true,
});

const resetStore = () => {
    useFridgeStore.setState({
        cabinetId: '33333333-3333-4333-8333-333333333333',
        loadedCabinetId: '33333333-3333-4333-8333-333333333333',
        isLoadingCabinet: false,
        cabinetName: 'Test cabinet',
        cabinetWidth: 5,
        cabinetHeight: 9,
        cabinetDepth: 2,
        shelves: createShelves(4),
        layoutUndoStack: [],
        layoutRedoStack: [],
        compatibilityPlanPreview: null,
        isApplyingCompatibilityPlan: false,
        cabinetSaveError: null,
    });
};

describe('fridge cabinet persistence', () => {
    beforeEach(() => {
        saveCabinetStateMock.mockReset();
        resetStore();
    });

    it('propagates save failures and records a UI-visible save error', async () => {
        saveCabinetStateMock.mockRejectedValueOnce(new Error('database unavailable'));

        await expect(useFridgeStore.getState().saveCabinet()).rejects.toThrow('database unavailable');

        expect(useFridgeStore.getState().cabinetSaveError).toBe('database unavailable');
    });

    it('keeps the original layout and preview when compatibility-plan persistence fails', async () => {
        const originalShelves = createShelves(4);
        const preview = createPreview(createShelves(40));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        useFridgeStore.setState({
            shelves: originalShelves,
            compatibilityPlanPreview: preview,
        });
        saveCabinetStateMock.mockRejectedValueOnce(new Error('write failed'));

        await expect(useFridgeStore.getState().applyCompatibilityPlan()).resolves.toBe(false);

        const state = useFridgeStore.getState();
        expect(state.shelves).toEqual(originalShelves);
        expect(state.layoutUndoStack).toEqual([]);
        expect(state.layoutRedoStack).toEqual([]);
        expect(state.compatibilityPlanPreview).toEqual(preview);
        expect(state.isApplyingCompatibilityPlan).toBe(false);
        consoleError.mockRestore();
    });

    it('commits a compatibility plan to local state only after persistence succeeds', async () => {
        const originalShelves = createShelves(4);
        const plannedShelves = createShelves(40);
        useFridgeStore.setState({
            shelves: originalShelves,
            compatibilityPlanPreview: createPreview(plannedShelves),
        });
        saveCabinetStateMock.mockResolvedValueOnce(undefined);

        await expect(useFridgeStore.getState().applyCompatibilityPlan()).resolves.toBe(true);

        const state = useFridgeStore.getState();
        expect(saveCabinetStateMock).toHaveBeenCalledWith(
            '33333333-3333-4333-8333-333333333333',
            plannedShelves,
            { width: 5, height: 9, depth: 2 }
        );
        expect(state.shelves).toEqual(plannedShelves);
        expect(state.layoutUndoStack).toEqual([originalShelves]);
        expect(state.layoutRedoStack).toEqual([]);
        expect(state.compatibilityPlanPreview).toBeNull();
        expect(state.cabinetSaveError).toBeNull();
    });

    it('serializes saves so an older snapshot cannot finish after a newer one', async () => {
        let resolveFirstSave: (() => void) | undefined;
        saveCabinetStateMock
            .mockImplementationOnce(() => new Promise<void>((resolve) => {
                resolveFirstSave = resolve;
            }))
            .mockResolvedValueOnce(undefined);

        const firstSave = useFridgeStore.getState().saveCabinet();
        useFridgeStore.setState({ shelves: createShelves(60) });
        const secondSave = useFridgeStore.getState().saveCabinet();

        await vi.waitFor(() => expect(saveCabinetStateMock).toHaveBeenCalledTimes(1));
        resolveFirstSave?.();
        await firstSave;
        await secondSave;

        expect(saveCabinetStateMock).toHaveBeenCalledTimes(2);
        expect(saveCabinetStateMock.mock.calls[0][1][0].items[0].position).toBe(4);
        expect(saveCabinetStateMock.mock.calls[1][1][0].items[0].position).toBe(60);
    });
});
