import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompatibilityPlanPreview, ReagentPlacement, ShelfData } from '../types/fridge';

const saveCabinetStateMock = vi.hoisted(() => vi.fn());

vi.mock('../services/cabinetService', () => ({
    cabinetService: {
        saveCabinetState: saveCabinetStateMock,
    },
}));

vi.mock('../services/pubchemService', () => ({
    lookupGHSByCAS: vi.fn(),
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
