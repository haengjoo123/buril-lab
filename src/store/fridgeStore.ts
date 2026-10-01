import { hasPlacementCollision, isCabinetLayoutValid } from '../utils/cabinetPlacementValidation';
import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type {
    CompatibilityPlanPreview,
    FridgeState,
    ReagentPlacement,
    ShelfData,
} from '../types/fridge';
import { cabinetService } from '../services/cabinetService';
import { lookupGHSByCAS, lookupGHSByIdentity } from '../services/pubchemService';
import { useLabStore } from './useLabStore';
import { buildCabinetAutoLayoutPlan } from '../utils/cabinetAutoLayoutPlanner';
import { findNearbyReagentSlot } from '../utils/findNearbyReagentSlot';
import {
    getItemDepthPct,
    getItemVisualWidthPct,
} from '../utils/reagentPlacementMetrics';
import { getShelfSectionByIndex } from '../utils/shelfSections';
import {
    createCabinetLayoutSnapshot,
    createCabinetLayoutHistoryChange,
    redoCabinetLayoutHistory,
    undoCabinetLayoutHistory,
} from '../utils/cabinetLayoutHistory';

export interface AutoPlaceResult {
    itemId: string;
    shelfLevel: number;
    reagentName: string;
}

interface AutoPlaceOptions {
    shelfId?: string;
    sectionIndex?: number;
}

interface FridgeStore extends FridgeState {
    checkCollision: (shelfId: string, position: number, width: number, depthPosition?: number, templateType?: string, ignoreItemId?: string) => boolean;
    sortShelves: (criteria: 'name' | 'type') => void;
    cabinetId: string | null;
    cabinetName: string;
    isLoadingCabinet: boolean;
    loadedCabinetId: string | null;
    cabinetSaveError: string | null;
    loadCabinet: (cabinetId: string) => Promise<void>;
    saveCabinet: () => Promise<void>;
    saveCabinetStrict: () => Promise<void>;
    clearCabinet: () => void;
    autoPlaceReagent: (
        itemData: Omit<ReagentPlacement, 'shelfId' | 'position' | 'depthPosition'>,
        options?: AutoPlaceOptions
    ) => AutoPlaceResult | null;
    placeReagentNear: (
        referenceItemId: string,
        itemData: Omit<ReagentPlacement, 'id' | 'shelfId' | 'position' | 'depthPosition'>
    ) => AutoPlaceResult | null;
    autoPlaceResult: AutoPlaceResult | null;
    clearAutoPlaceResult: () => void;
    /** Background CAS → H-code enrichment via PubChem */
    enrichReagentGHS: (reagentId: string) => Promise<void>;
}

const INITIAL_SHELVES: ShelfData[] = [
    { id: uuidv4(), level: 0, dividers: [], items: [] },
    { id: uuidv4(), level: 1, dividers: [], items: [] },
    { id: uuidv4(), level: 2, dividers: [], items: [] },
    { id: uuidv4(), level: 3, dividers: [], items: [] },
];

const DEFAULT_CABINET_WIDTH = 5;
const DEFAULT_CABINET_HEIGHT = 9;
const DEFAULT_CABINET_DEPTH = 2;
let cabinetLoadSequence = 0;
const GHS_IN_FLIGHT_ITEM_IDS = new Set<string>();
const CABINET_SAVE_QUEUES = new Map<string, Promise<void>>();

interface CabinetSaveSnapshot {
    cabinetId: string;
    shelves: ShelfData[];
    width: number;
    height: number;
    depth: number;
    generation?: number;
}

const getCabinetSaveErrorMessage = (error: unknown): string => {
    if (error instanceof Error && error.message.trim()) return error.message;
    if (typeof error === 'object' && error && 'message' in error) {
        const message = String(error.message).trim();
        if (message) return message;
    }
    return 'Failed to save cabinet';
};

const enqueueCabinetSave = (snapshot: CabinetSaveSnapshot): Promise<void> => {
    const previousSave = CABINET_SAVE_QUEUES.get(snapshot.cabinetId) ?? Promise.resolve();
    const queuedSave = previousSave
        .catch(() => undefined)
        .then(() => {
            if (snapshot.generation !== undefined && snapshot.generation !== cabinetLoadSequence) throw new Error('캐비넷이 변경되었습니다. 다시 저장해 주세요.');
            return cabinetService.saveCabinetState(
            snapshot.cabinetId,
            snapshot.shelves,
            {
                width: snapshot.width,
                height: snapshot.height,
                depth: snapshot.depth,
            }
        );
        });

    CABINET_SAVE_QUEUES.set(snapshot.cabinetId, queuedSave);
    void queuedSave.finally(() => {
        if (CABINET_SAVE_QUEUES.get(snapshot.cabinetId) === queuedSave) {
            CABINET_SAVE_QUEUES.delete(snapshot.cabinetId);
        }
    }).catch(() => undefined);

    return queuedSave;
};

function resetCompatibilityPlanPreview(): { compatibilityPlanPreview: CompatibilityPlanPreview | null } {
    return { compatibilityPlanPreview: null };
}

function getLayoutTransientCleanup(state: FridgeStore, shelves: ShelfData[]): Partial<FridgeStore> {
    const shelfIds = new Set(shelves.map((shelf) => shelf.id));
    const itemIds = new Set(shelves.flatMap((shelf) => shelf.items.map((item) => item.id)));
    const patch: Partial<FridgeStore> = {};

    if (state.selectedReagentId && !itemIds.has(state.selectedReagentId)) {
        patch.selectedReagentId = null;
    }
    if (typeof state.highlightedItemId === 'string' && !itemIds.has(state.highlightedItemId)) {
        patch.highlightedItemId = null;
    }
    if (Array.isArray(state.highlightedItemId)) {
        const nextHighlightedIds = state.highlightedItemId.filter((id) => itemIds.has(id));
        patch.highlightedItemId = nextHighlightedIds.length > 0 ? nextHighlightedIds : null;
    }
    if (state.draggedItem && !itemIds.has(state.draggedItem.id)) {
        patch.draggedItem = null;
    }
    if (state.focusedShelfId && !shelfIds.has(state.focusedShelfId)) {
        patch.focusedShelfId = null;
    }
    if (state.pendingPlacement && !shelfIds.has(state.pendingPlacement.shelfId)) {
        patch.pendingPlacement = null;
    }

    return patch;
}

function createLayoutStorePatch(state: FridgeStore, shelves: ShelfData[]): Partial<FridgeStore> | null {
    if (state.isLoadingCabinet || state.isApplyingCompatibilityPlan || (state.cabinetId && state.loadedCabinetId !== state.cabinetId)) return null;
    const historyChange = createCabinetLayoutHistoryChange(state, shelves);
    if (!historyChange || !shelves.length) return null;
    if (shelves.length > state.shelves.length && !isCabinetLayoutValid(shelves, state)) return null;
    if (shelves.length === state.shelves.length && shelves.some(shelf => {
        const previous = state.shelves.find(s => s.id === shelf.id);
        const dividersChanged = JSON.stringify(previous?.dividers) !== JSON.stringify(shelf.dividers);
        return shelf.items.some(item => {
            const oldItem = state.shelves.flatMap(s => s.items).find(i => i.id === item.id);
            return (dividersChanged || JSON.stringify(oldItem) !== JSON.stringify(item)) && hasPlacementCollision(shelves, state, item, item.id);
        });
    })) return null;

    return {
        ...historyChange,
        ...getLayoutTransientCleanup(state, historyChange.shelves),
        ...resetCompatibilityPlanPreview(),
    };
}

export const useFridgeStore = create<FridgeStore>((set, get) => ({
    shelves: INITIAL_SHELVES,
    layoutUndoStack: [],
    layoutRedoStack: [],
    mode: 'VIEW',
    draggedItem: null,
    draggedTemplate: null,
    pendingPlacement: null,
    searchQuery: '',
    cabinetWidth: DEFAULT_CABINET_WIDTH,
    cabinetHeight: DEFAULT_CABINET_HEIGHT,
    cabinetDepth: DEFAULT_CABINET_DEPTH,
    cabinetAspectRatio: null,
    /** PLACE 모드에서 포커스된 선반 ID (선반 클릭 시 설정) */
    focusedShelfId: null as string | null,

    selectedReagentId: null,
    highlightedItemId: null,
    cabinetId: null,
    cabinetName: '',
    isLoadingCabinet: false,
    loadedCabinetId: null,
    cabinetSaveError: null,
    autoPlaceResult: null as AutoPlaceResult | null,
    compatibilityPlanPreview: null,
    isBuildingCompatibilityPlan: false,
    isApplyingCompatibilityPlan: false,

    loadCabinet: async (cabinetId: string) => {
        const pendingSave = CABINET_SAVE_QUEUES.get(cabinetId);
        if (pendingSave) await pendingSave.catch(() => undefined);
        const requestSequence = ++cabinetLoadSequence;
        const previousState = get();
        const isSameCabinet = previousState.cabinetId === cabinetId;
        set({
            isLoadingCabinet: true,
            loadedCabinetId: null,
            draggedItem: null, draggedTemplate: null, pendingPlacement: null,
            focusedShelfId: null, selectedReagentId: null, highlightedItemId: null,
            cabinetAspectRatio: null,
            cabinetId,
            cabinetName: isSameCabinet ? previousState.cabinetName : '',
            shelves: isSameCabinet ? previousState.shelves : [],
            isBuildingCompatibilityPlan: false,
            isApplyingCompatibilityPlan: false,
            cabinetSaveError: null,
            layoutUndoStack: [],
            layoutRedoStack: [],
            ...resetCompatibilityPlanPreview(),
        });
        try {
            const { shelves, cabinetName, width, height, depth } = await cabinetService.getCabinetDetails(cabinetId);
            if (requestSequence !== cabinetLoadSequence || get().cabinetId !== cabinetId) return;
            set({
                shelves,
                loadedCabinetId: cabinetId,
                cabinetName,
                cabinetWidth: width,
                cabinetHeight: height,
                cabinetDepth: depth,
                layoutUndoStack: [],
                layoutRedoStack: [],
                ...resetCompatibilityPlanPreview(),
            });

            // Background: enrich existing items that have CAS but no H-codes
            const loadedShelves = shelves;
            const itemsNeedingEnrichment = loadedShelves
                .flatMap(s => s.items)
                .filter(item => item.casNo
                    && (!item.hCodes || item.hCodes.length === 0)
                    && item.ghsStatus !== 'success'
                    && item.ghsStatus !== 'no_ghs'
                    && item.ghsStatus !== 'not_found'
                    && item.ghsStatus !== 'invalid_cas');

            if (itemsNeedingEnrichment.length > 0) {
                // Enrich sequentially with small delay to respect PubChem rate limits (5 req/sec)
                (async () => {
                    for (const item of itemsNeedingEnrichment) {
                        if (requestSequence !== cabinetLoadSequence) break;
                        await get().enrichReagentGHS(item.id);
                        await new Promise(r => setTimeout(r, 250)); // ~4 req/sec
                    }
                })();
            }
        } catch (err) {
            if (requestSequence === cabinetLoadSequence) set({ cabinetSaveError: getCabinetSaveErrorMessage(err) });
            console.error('Failed to load cabinet', err);
        } finally {
            if (requestSequence === cabinetLoadSequence) {
                set({ isLoadingCabinet: false });
            }
        }
    },

    saveCabinetStrict: async () => {
        const state = get();
        if (!state.cabinetId || state.isLoadingCabinet || state.isApplyingCompatibilityPlan || state.loadedCabinetId !== state.cabinetId) {
            const error = new Error('Cannot save a cabinet before it has loaded');
            set({ cabinetSaveError: error.message });
            throw error;
        }

        const snapshot: CabinetSaveSnapshot = {
            cabinetId: state.cabinetId,
            generation: cabinetLoadSequence,
            shelves: createCabinetLayoutSnapshot(state.shelves),
            width: state.cabinetWidth,
            height: state.cabinetHeight,
            depth: state.cabinetDepth,
        };

        try {
            await enqueueCabinetSave(snapshot);
            if (get().cabinetId === snapshot.cabinetId && snapshot.generation === cabinetLoadSequence) {
                const current = get();
                const ids = new Set(snapshot.shelves.flatMap(s => [s.id, ...s.items.map(i => i.id)]));
                const containsDeleted = [...current.layoutUndoStack, ...current.layoutRedoStack].some(layout => layout.some(s => !ids.has(s.id) || s.items.some(i => !ids.has(i.id))));
                set({ cabinetSaveError: null, ...(containsDeleted ? { layoutUndoStack: [], layoutRedoStack: [] } : {}) });
            }
        } catch (error) {
            if (get().cabinetId === snapshot.cabinetId) {
                set({ cabinetSaveError: getCabinetSaveErrorMessage(error) });
            }
            throw error;
        }
    },

    saveCabinet: async () => {
        await get().saveCabinetStrict();
    },

    setMode: (mode) => set(state => ({
        mode,
        focusedShelfId: mode === 'PLACE' ? state.focusedShelfId : null,
        draggedItem: null, draggedTemplate: null, pendingPlacement: null,
    })),
    setFocusedShelfId: (id) => set({ focusedShelfId: id }),
    setSearchQuery: (query) => set({ searchQuery: query }),
    setDraggedTemplate: (template) => set({ draggedTemplate: template }),
    setDraggedItem: (item) => set({ draggedItem: item }),
    setPendingPlacement: (placement) => set({ pendingPlacement: placement }),

    setCabinetDimensions: (width, height) => {
        const state = get();
        if (state.isLoadingCabinet || state.isApplyingCompatibilityPlan) return;
        const ratio = state.cabinetAspectRatio;
        let newWidth = width ?? state.cabinetWidth;
        let newHeight = height ?? state.cabinetHeight;

        if (ratio != null) {
            if (width != null) newHeight = newWidth / ratio;
            else if (height != null) newWidth = newHeight * ratio;
        }

        const dimensions = { ...state, cabinetWidth: Math.max(4, Math.min(20, Math.round(newWidth))), cabinetHeight: Math.max(2, Math.min(15, Math.round(newHeight))) };
        if (!isCabinetLayoutValid(state.shelves, dimensions)) { set({ cabinetSaveError: '현재 시약이 들어갈 공간이 부족합니다.' }); return; }
        set({
            cabinetWidth: Math.max(4, Math.min(20, Math.round(newWidth))),
            cabinetHeight: Math.max(2, Math.min(15, Math.round(newHeight))),
            ...resetCompatibilityPlanPreview(),
        });
    },

    setCabinetDepth: (depth) => {
        const state = get();
        if (state.isLoadingCabinet || state.isApplyingCompatibilityPlan) return;
        const cabinetDepth = Math.max(1, Math.min(4, Math.round(depth)));
        if (!isCabinetLayoutValid(state.shelves, { ...state, cabinetDepth })) { set({ cabinetSaveError: '현재 시약이 들어갈 공간이 부족합니다.' }); return; }
        set({ cabinetDepth, ...resetCompatibilityPlanPreview() });
    },

    setCabinetAspectRatio: (ratio) => set({
        cabinetAspectRatio: ratio,
        ...resetCompatibilityPlanPreview(),
    }),

    checkCollision: (shelfId, position, width, depthPosition = 50, templateType = 'A', ignoreItemId) => {
        const state = get();
        return hasPlacementCollision(state.shelves, state, { shelfId, position, width, depthPosition, template: templateType as ReagentPlacement['template'] }, ignoreItemId);
    },

    addShelf: () => set(state => {
        const nextShelves = [...state.shelves, {
            id: uuidv4(),
            level: state.shelves.length,
            dividers: [],
            items: []
        }];
        return createLayoutStorePatch(state, nextShelves) ?? state;
    }),

    removeShelf: (shelfId) => set(state => {
        if (state.shelves.length <= 1) return state;
        const next = state.shelves.filter(s => s.id !== shelfId);
        return createLayoutStorePatch(state, next.map((s, i) => ({ ...s, level: i }))) ?? state;
    }),

    addVerticalPanel: (position = 50) => set(state => ({
        ...(createLayoutStorePatch(state, state.shelves.map(s => {
            const hasNear = s.dividers.some(d => Math.abs(d - position) < 2);
            if (hasNear) return s;
            return { ...s, dividers: [...s.dividers, position].sort((a, b) => a - b) };
        })) ?? {}),
    })),

    removeVerticalPanel: () => set(state => {
        const allPositions = state.shelves.flatMap(s => s.dividers);
        if (allPositions.length === 0) return state;
        const maxPos = Math.max(...allPositions);
        return createLayoutStorePatch(state, state.shelves.map(s => ({
            ...s,
            dividers: s.dividers.filter(p => Math.abs(p - maxPos) >= 2)
        }))) ?? state;
    }),

    addDivider: (shelfId, position) => set(state => ({
        ...(createLayoutStorePatch(state, state.shelves.map(s => s.id === shelfId ? {
            ...s,
            dividers: [...s.dividers, position].sort((a, b) => a - b)
        } : s)) ?? {}),
    })),

    moveDivider: (shelfId, index, newPosition) => set(state => ({
        ...(createLayoutStorePatch(state, state.shelves.map(s => {
            if (s.id !== shelfId) return s;
            const newDividers = [...s.dividers];
            // Clamp between neighbors or 0-100
            if (newPosition < 0) newPosition = 0;
            if (newPosition > 100) newPosition = 100;
            // TODO: Add Logic to not cross other dividers if needed
            newDividers[index] = newPosition;
            return { ...s, dividers: newDividers.sort((a, b) => a - b) };
        })) ?? {}),
    })),

    removeDivider: (shelfId, index) => set(state => ({
        ...(createLayoutStorePatch(state, state.shelves.map(s => s.id === shelfId ? {
            ...s,
            dividers: s.dividers.filter((_, i) => i !== index)
        } : s)) ?? {}),
    })),

    placeReagent: (shelfId, itemData) => {
        if (get().isApplyingCompatibilityPlan || (get().cabinetId && get().loadedCabinetId !== get().cabinetId) || get().isLoadingCabinet || get().checkCollision(shelfId, itemData.position, itemData.width, itemData.depthPosition, itemData.template)) return false;

        const newItem: ReagentPlacement = {
            ...itemData,
            shelfId,
            id: uuidv4(),
            depthPosition: itemData.depthPosition ?? 50,
            ghsStatus: itemData.ghsStatus ?? (itemData.hCodes.length > 0 ? 'success' : 'not_checked'),
        };

        set(state => ({
            ...(createLayoutStorePatch(state, state.shelves.map(s => s.id === shelfId ? {
                ...s,
                items: [...s.items, newItem]
            } : s)) ?? {}),
        }));

        // Background: the unified service can recover CAS from an exact name too.
        if (newItem.name && newItem.hCodes.length === 0) {
            get().enrichReagentGHS(newItem.id);
        }

        return true;
    },

    moveReagent: (id, newShelfId, newPosition, newDepthPosition) => {
        const store = get();
        let item: ReagentPlacement | undefined;
        let oldShelfId: string | undefined;

        for (const s of store.shelves) {
            const found = s.items.find(i => i.id === id);
            if (found) {
                item = found;
                oldShelfId = s.id;
                break;
            }
        }

        if (!item || !oldShelfId) return false;

        const depthPos = newDepthPosition ?? item.depthPosition ?? 50;
        if (store.isApplyingCompatibilityPlan || (store.cabinetId && store.loadedCabinetId !== store.cabinetId) || store.isLoadingCabinet || store.checkCollision(newShelfId, newPosition, item.width, depthPos, item.template, id)) return false;

        set(state => ({
            ...(createLayoutStorePatch(state, state.shelves.map(s => {
                if (s.id === oldShelfId && s.id === newShelfId) {
                    return {
                        ...s,
                        items: s.items.map(i => i.id === id ? { ...i, position: newPosition, depthPosition: depthPos } : i)
                    };
                } else if (s.id === oldShelfId) {
                    return { ...s, items: s.items.filter(i => i.id !== id) };
                } else if (s.id === newShelfId) {
                    return { ...s, items: [...s.items, { ...item!, shelfId: newShelfId, position: newPosition, depthPosition: depthPos }] };
                }
                return s;
            })) ?? {}),
        }));
        return true;
    },

    removeReagent: (id) => set(state => ({
        ...(createLayoutStorePatch(state, state.shelves.map(s => ({
            ...s,
            items: s.items.filter(i => i.id !== id)
        }))) ?? {}),
    })),

    clearCabinet: () => set(state => ({
        ...(createLayoutStorePatch(state, state.shelves.map(s => ({
            ...s,
            items: []
        }))) ?? {}),
    })),

    setSelectedReagentId: (id) => set({ selectedReagentId: id }),
    setHighlightedItemId: (id) => set({ highlightedItemId: id }),
    clearAutoPlaceResult: () => set({ autoPlaceResult: null }),

    undoCabinetLayout: () => {
        const state = get();
        const historyChange = undoCabinetLayoutHistory(state);
        if (!historyChange) return false;

        set({
            ...historyChange,
            ...getLayoutTransientCleanup(state, historyChange.shelves),
            draggedItem: null,
            draggedTemplate: null,
            pendingPlacement: null,
            autoPlaceResult: null,
            ...resetCompatibilityPlanPreview(),
        });
        return true;
    },

    redoCabinetLayout: () => {
        const state = get();
        const historyChange = redoCabinetLayoutHistory(state);
        if (!historyChange) return false;

        set({
            ...historyChange,
            ...getLayoutTransientCleanup(state, historyChange.shelves),
            draggedItem: null,
            draggedTemplate: null,
            pendingPlacement: null,
            autoPlaceResult: null,
            ...resetCompatibilityPlanPreview(),
        });
        return true;
    },

    buildCompatibilityPlan: async () => {
        const sequence = cabinetLoadSequence;
        if (get().isLoadingCabinet || (get().cabinetId && get().loadedCabinetId !== get().cabinetId)) return null;
        set({
            isBuildingCompatibilityPlan: true,
            ...resetCompatibilityPlanPreview(),
        });

        try {
            const itemsNeedingEnrichment = get().shelves
                .flatMap((shelf) => shelf.items)
                .filter((item) => item.casNo
                    && (!item.hCodes || item.hCodes.length === 0)
                    && item.ghsStatus !== 'success'
                    && item.ghsStatus !== 'no_ghs'
                    && item.ghsStatus !== 'not_found'
                    && item.ghsStatus !== 'invalid_cas');

            for (const item of itemsNeedingEnrichment) {
                if (sequence !== cabinetLoadSequence) return null;
                await get().enrichReagentGHS(item.id);
                await new Promise((resolve) => setTimeout(resolve, 250));
            }

            if (sequence !== cabinetLoadSequence) return null;
            const refreshedState = get();
            const preview = buildCabinetAutoLayoutPlan(
                refreshedState.shelves,
                refreshedState.cabinetWidth,
                refreshedState.cabinetHeight,
                refreshedState.cabinetDepth
            );

            set({
                compatibilityPlanPreview: preview,
            });

            return preview;
        } catch (err) {
            console.error('Failed to build compatibility plan', err);
            return null;
        } finally {
            if (sequence === cabinetLoadSequence) set({ isBuildingCompatibilityPlan: false });
        }
    },

    applyCompatibilityPlan: async () => {
        const stateBeforeSave = get();
        const preview = stateBeforeSave.compatibilityPlanPreview;
        if (!preview?.canApply || !stateBeforeSave.cabinetId || stateBeforeSave.isLoadingCabinet || stateBeforeSave.loadedCabinetId !== stateBeforeSave.cabinetId || !isCabinetLayoutValid(preview.plannedShelves, stateBeforeSave)) return false;

        const plannedShelves = createCabinetLayoutSnapshot(preview.plannedShelves);
        const snapshot: CabinetSaveSnapshot = {
            cabinetId: stateBeforeSave.cabinetId,
            generation: cabinetLoadSequence,
            shelves: plannedShelves,
            width: stateBeforeSave.cabinetWidth,
            height: stateBeforeSave.cabinetHeight,
            depth: stateBeforeSave.cabinetDepth,
        };

        set({ isApplyingCompatibilityPlan: true });

        try {
            await enqueueCabinetSave(snapshot);

            if (get().cabinetId === snapshot.cabinetId && snapshot.generation === cabinetLoadSequence) {
                set(currentState => ({
                    ...(createLayoutStorePatch({ ...currentState, isApplyingCompatibilityPlan: false }, plannedShelves.map(s => ({ ...s, items: s.items.map(item => {
                        const latest = currentState.shelves.flatMap(shelf => shelf.items).find(i => i.id === item.id);
                        return { ...item, ...latest, shelfId: item.shelfId, position: item.position, depthPosition: item.depthPosition, width: item.width, template: item.template };
                    }) }))) ?? resetCompatibilityPlanPreview()),
                    cabinetSaveError: null,
                }));
            }
            return true;
        } catch (err) {
            console.error('Failed to apply compatibility plan', err);
            return false;
        } finally {
            if (snapshot.generation === cabinetLoadSequence) set({ isApplyingCompatibilityPlan: false });
        }
    },

    clearCompatibilityPlan: () => set({
        ...resetCompatibilityPlanPreview(),
    }),

    autoPlaceReagent: (itemData, options) => {
        const state = get();
        if (state.isApplyingCompatibilityPlan || state.isLoadingCabinet || (state.cabinetId && state.loadedCabinetId !== state.cabinetId)) return null;
        const width = itemData.width;
        const template = itemData.template;
        const STEP = 2; // scan in 2% increments

        // Try shelves from bottom (level 0) to top
        const sortedShelves = [...state.shelves]
            .filter((shelf) => !options?.shelfId || shelf.id === options.shelfId)
            .sort((a, b) => a.level - b.level);

        for (const shelf of sortedShelves) {
            const section = options?.sectionIndex
                ? getShelfSectionByIndex(shelf.dividers, options.sectionIndex)
                : null;
            if (options?.sectionIndex && !section) continue;

            const zoneStart = section?.start ?? 0;
            const zoneEnd = section?.end ?? 100;
            const startPosition = zoneStart + 2;
            const endPosition = zoneEnd - width - 2;
            if (endPosition < startPosition) continue;

            for (let pos = startPosition; pos <= endPosition; pos += STEP) {
                // Try center depth first (50), then front (80), then back (20)
                for (const depthPos of [50, 80, 20]) {
                    const collision = state.checkCollision(shelf.id, pos, width, depthPos, template);
                    if (!collision) {
                        // Found a free slot!
                        const newItem: ReagentPlacement = {
                            ...itemData,
                            shelfId: shelf.id,
                            id: uuidv4(),
                            position: pos,
                            depthPosition: depthPos,
                            ghsStatus: itemData.ghsStatus ?? (itemData.hCodes.length > 0 ? 'success' : 'not_checked'),
                        };

                        const result: AutoPlaceResult = {
                            itemId: newItem.id,
                            shelfLevel: shelf.level + 1,
                            reagentName: newItem.name,
                        };

                        set(st => ({
                            ...(createLayoutStorePatch(st, st.shelves.map(s =>
                                s.id === shelf.id
                                    ? { ...s, items: [...s.items, newItem] }
                                    : s
                            )) ?? {}),
                            highlightedItemId: newItem.id,
                            autoPlaceResult: result,
                            focusedShelfId: null, // reset first so useEffect always re-fires
                        }));

                        // Set focusedShelfId in next microtask so FridgeScene's useEffect picks up the change
                        queueMicrotask(() => {
                            if (!get().shelves.some(s => s.items.some(i => i.id === newItem.id))) return;
                            set({ focusedShelfId: shelf.id });
                        });

                        // Clear highlight after 4 seconds
                        setTimeout(() => {
                            const current = get();
                            if (current.highlightedItemId === newItem.id) {
                                set({ highlightedItemId: null });
                            }
                        }, 4000);

                        // Background: the unified service can recover CAS from an exact name too.
                        if (newItem.name && newItem.hCodes.length === 0) {
                            get().enrichReagentGHS(newItem.id);
                        }

                        return result;
                    }
                }
            }
        }

        // No free slot found
        return null;
    },

    placeReagentNear: (referenceItemId, itemData) => {
        const state = get();
        if (state.isLoadingCabinet || state.isApplyingCompatibilityPlan || (state.cabinetId && state.loadedCabinetId !== state.cabinetId)) return null;
        const referenceShelf = state.shelves.find((shelf) =>
            shelf.items.some((item) => item.id === referenceItemId)
        );
        const referenceItem = referenceShelf?.items.find((item) => item.id === referenceItemId);
        if (!referenceItem || !referenceShelf) return null;

        const slot = findNearbyReagentSlot({
            shelves: state.shelves,
            referenceItem,
            cabinetWidth: state.cabinetWidth,
            cabinetDepth: state.cabinetDepth,
        });

        if (!slot || get().checkCollision(slot.shelfId, slot.position, itemData.width, slot.depthPosition, itemData.template)) return null;

        const targetShelf = state.shelves.find((shelf) => shelf.id === slot.shelfId);
        if (!targetShelf) return null;

        const newItem: ReagentPlacement = {
            ...itemData,
            shelfId: slot.shelfId,
            id: uuidv4(),
            position: slot.position,
            depthPosition: slot.depthPosition,
            ghsStatus: itemData.ghsStatus ?? (itemData.hCodes.length > 0 ? 'success' : 'not_checked'),
        };

        const result: AutoPlaceResult = {
            itemId: newItem.id,
            shelfLevel: targetShelf.level + 1,
            reagentName: newItem.name,
        };

        set(st => ({
            ...(createLayoutStorePatch(st, st.shelves.map(s =>
                s.id === slot.shelfId
                    ? { ...s, items: [...s.items, newItem] }
                    : s
            )) ?? {}),
            highlightedItemId: newItem.id,
            selectedReagentId: newItem.id,
            autoPlaceResult: result,
            focusedShelfId: null,
        }));

        queueMicrotask(() => {
            if (!get().shelves.some(s => s.items.some(i => i.id === newItem.id))) return;
            set({ focusedShelfId: slot.shelfId });
        });

        setTimeout(() => {
            const current = get();
            if (current.highlightedItemId === newItem.id) {
                set({ highlightedItemId: null });
            }
        }, 4000);

        if (newItem.name && newItem.hCodes.length === 0) {
            get().enrichReagentGHS(newItem.id);
        }

        return result;
    },

    enrichReagentGHS: async (reagentId: string) => {

        // Find the reagent
        const state = get();
        let targetItem: ReagentPlacement | undefined;
        for (const shelf of state.shelves) {
            const found = shelf.items.find(i => i.id === reagentId);
            if (found) { targetItem = found; break; }
        }
        if (!targetItem) return;
        const sequence = cabinetLoadSequence;
        const cabinetId = state.cabinetId;
        const requestKey = `${sequence}:${cabinetId}:${reagentId}:${targetItem.casNo ?? ''}:${targetItem.name}`;
        if (GHS_IN_FLIGHT_ITEM_IDS.has(requestKey)) return;
        GHS_IN_FLIGHT_ITEM_IDS.add(requestKey);
        const stillCurrent = () => sequence === cabinetLoadSequence && get().cabinetId === cabinetId
            && get().shelves.some(s => s.items.some(i => i.id === reagentId && i.casNo === targetItem!.casNo && i.name === targetItem!.name));

        set(st => ({
            shelves: st.shelves.map(s => ({
                ...s,
                items: s.items.map(item => item.id === reagentId
                    ? { ...item, ghsStatus: 'pending' as const }
                    : item),
            })),
            ...resetCompatibilityPlanPreview(),
        }));

        try {
            const { currentLabId } = useLabStore.getState();
            const result = targetItem.casNo
                ? await lookupGHSByCAS(targetItem.casNo, { labId: currentLabId })
                : await lookupGHSByIdentity({ name: targetItem.name }, { labId: currentLabId });
            if (!stillCurrent()) return;
            const recoveredCas = 'casNumber' in result && typeof result.casNumber === 'string'
                ? result.casNumber
                : undefined;

            // Persist every lookup outcome. An empty H-code list is not enough
            // to tell "verified no data" from "lookup never happened".
            set(st => ({
                shelves: st.shelves.map(s => ({
                    ...s,
                    items: s.items.map(item =>
                        item.id === reagentId
                            ? {
                                ...item,
                                casNo: item.casNo || recoveredCas,
                                hCodes: result.success ? result.hCodes : [],
                                isAcidic: result.success ? result.isAcidic : false,
                                isBasic: result.success ? result.isBasic : false,
                                ghsStatus: result.status,
                                ghsCheckedAt: new Date().toISOString(),
                            }
                            : item
                    ),
                })),
                ...resetCompatibilityPlanPreview(),
            }));

            if (cabinetId && get().loadedCabinetId === cabinetId) {
                const item = get().shelves.flatMap(s => s.items).find(i => i.id === reagentId)!;
                try { await cabinetService.saveReagentGHS(cabinetId, item, targetItem.casNo, targetItem.name); }
                catch (error) { console.warn('Failed to persist item GHS:', error); }
            }

            console.log(
                `[GHS Enrich] ${targetItem.name} (CAS: ${targetItem.casNo}) → H-codes: [${result.hCodes.join(', ')}]`
            );
        } catch (err) {
            if (!stillCurrent()) return;
            set(st => ({
                shelves: st.shelves.map(s => ({
                    ...s,
                    items: s.items.map(item => item.id === reagentId
                        ? {
                            ...item,
                            hCodes: [],
                            isAcidic: false,
                            isBasic: false,
                            ghsStatus: 'transient_error' as const,
                            ghsCheckedAt: new Date().toISOString(),
                        }
                        : item),
                })),
                ...resetCompatibilityPlanPreview(),
            }));
            console.warn('[GHS Enrich] Failed for', targetItem.casNo, err);
        } finally {
            GHS_IN_FLIGHT_ITEM_IDS.delete(requestKey);
        }
    },

    updateReagent: (id, updates) => {
        const state = get();
        const original = state.shelves.flatMap(s => s.items).find(i => i.id === id);
        if (!original || state.isLoadingCabinet || state.isApplyingCompatibilityPlan || (state.cabinetId && state.loadedCabinetId !== state.cabinetId)) return false;
        const next = { ...original, ...updates, id: original.id, shelfId: original.shelfId };
        if (state.checkCollision(next.shelfId, next.position, next.width, next.depthPosition, next.template, id)) return false;
        set({ shelves: state.shelves.map(s => ({ ...s, items: s.items.map(i => i.id === id ? next : i) })), ...resetCompatibilityPlanPreview() });
        return true;
    },

    sortShelves: (criteria: 'name' | 'type') => {
        const currentState = get();
        const cabinetDepth = currentState.cabinetDepth;
        const cabinetWidth = currentState.cabinetWidth;
        const GAP_X = 4; // 4% width gap
        const GAP_Z = 4; // 4% depth gap
        const MARGIN = 4; // 4% margin from edges
        const DIVIDER_MARGIN = 2; // 2% margin from dividers

        // --- Helper: get visual width percentage for an item ---
        const getVisualWidthPct = (item: ReagentPlacement) =>
            getItemVisualWidthPct(item.template, item.width, cabinetWidth);

        // --- Helper: get depth percentage for an item ---
        const getDepthPct = (item: ReagentPlacement) =>
            getItemDepthPct(item.template, item.width, cabinetDepth, 1.1); // 10% safety margin

        // --- Helper: build zones for a shelf from its dividers ---
        interface Zone {
            shelfId: string;
            xStart: number;
            xEnd: number;
        }

        const buildZones = (shelf: ShelfData): Zone[] => {
            const zones: Zone[] = [];
            const sortedDividers = [...shelf.dividers].sort((a, b) => a - b);
            const boundaries = [0, ...sortedDividers, 100];
            for (let i = 0; i < boundaries.length - 1; i++) {
                const rawStart = boundaries[i];
                const rawEnd = boundaries[i + 1];
                const xStart = rawStart + (rawStart === 0 ? MARGIN : DIVIDER_MARGIN);
                const xEnd = rawEnd - (rawEnd === 100 ? MARGIN : DIVIDER_MARGIN);
                if (xEnd - xStart > 2) {
                    zones.push({ shelfId: shelf.id, xStart, xEnd });
                }
            }
            return zones;
        };

        // --- Helper: sort items by criteria ---
        const sortItems = (items: ReagentPlacement[]) => {
            return [...items].sort((a, b) => {
                if (criteria === 'name') {
                    return a.name.localeCompare(b.name);
                } else {
                    if (a.template !== b.template) return a.template.localeCompare(b.template);
                    return a.name.localeCompare(b.name);
                }
            });
        };

        // --- Helper: pack items into zones, returns placed items and overflow ---
        const packItemsIntoZones = (
            items: ReagentPlacement[],
            zones: Zone[],
            targetShelfId: string
        ): { placed: ReagentPlacement[]; overflow: ReagentPlacement[] } => {
            const placed: ReagentPlacement[] = [];
            const overflow: ReagentPlacement[] = [];

            // Two-pass approach to prevent mixed-width column overlap:
            // Pass 1: Assign items to columns (determine column membership and max widths)
            // Pass 2: Position items centered on their column's final width

            interface ColumnData {
                items: ReagentPlacement[];
                depthPcts: number[];
                maxVisualWidth: number;
                xStart: number;
                zoneIdx: number;
            }

            const columns: ColumnData[] = [];
            let zoneIdx = 0;
            let nextColumnX = zones.length > 0 ? zones[0].xStart : MARGIN;
            let currentZRemaining = 100 - MARGIN;

            // --- Pass 1: Assign items to columns ---
            let currentColumn: ColumnData | null = null;

            for (const item of items) {
                if (zoneIdx >= zones.length) {
                    overflow.push(item);
                    continue;
                }

                const itemVisualWidth = getVisualWidthPct(item);
                const itemDepthPct = getDepthPct(item);

                // Start a new column if needed
                if (!currentColumn) {
                    // Check if item fits horizontally in current zone
                    while (zoneIdx < zones.length && nextColumnX + itemVisualWidth > zones[zoneIdx].xEnd) {
                        zoneIdx++;
                        if (zoneIdx < zones.length) {
                            nextColumnX = zones[zoneIdx].xStart;
                            currentZRemaining = 100 - MARGIN;
                        }
                    }
                    if (zoneIdx >= zones.length) {
                        overflow.push(item);
                        continue;
                    }

                    currentColumn = {
                        items: [],
                        depthPcts: [],
                        maxVisualWidth: 0,
                        xStart: nextColumnX,
                        zoneIdx,
                    };
                    columns.push(currentColumn);
                    currentZRemaining = 100 - MARGIN;
                }

                // Check if item fits in current column's depth
                if (currentZRemaining - itemDepthPct < 0) {
                    // Finalize current column and start a new one
                    nextColumnX = currentColumn.xStart + currentColumn.maxVisualWidth + GAP_X;
                    currentColumn = null;
                    currentZRemaining = 100 - MARGIN;

                    // Advance zone if needed
                    while (zoneIdx < zones.length && nextColumnX + itemVisualWidth > zones[zoneIdx].xEnd) {
                        zoneIdx++;
                        if (zoneIdx < zones.length) {
                            nextColumnX = zones[zoneIdx].xStart;
                            currentZRemaining = 100 - MARGIN;
                        }
                    }
                    if (zoneIdx >= zones.length) {
                        overflow.push(item);
                        continue;
                    }

                    currentColumn = {
                        items: [],
                        depthPcts: [],
                        maxVisualWidth: 0,
                        xStart: nextColumnX,
                        zoneIdx,
                    };
                    columns.push(currentColumn);
                }

                currentColumn.items.push(item);
                currentColumn.depthPcts.push(itemDepthPct);
                currentColumn.maxVisualWidth = Math.max(currentColumn.maxVisualWidth, itemVisualWidth);
                currentZRemaining -= (itemDepthPct + GAP_Z);
            }

            // --- Pass 2: Position items within their columns ---
            for (const col of columns) {
                let zFront = 100 - MARGIN;
                const zone = zones[col.zoneIdx];

                for (let i = 0; i < col.items.length; i++) {
                    const item = col.items[i];
                    const depthPct = col.depthPcts[i];

                    // Center item on column's max visual width
                    let pos = col.xStart + (col.maxVisualWidth / 2) - (item.width / 2);
                    // Clamp to zone boundaries
                    if (zone) {
                        if (pos + item.width > zone.xEnd) pos = zone.xEnd - item.width;
                        if (pos < zone.xStart) pos = zone.xStart;
                    }

                    placed.push({
                        ...item,
                        shelfId: targetShelfId,
                        position: pos,
                        depthPosition: zFront - (depthPct / 2),
                    });

                    zFront -= (depthPct + GAP_Z);
                }
            }

            return { placed, overflow };
        };

        // =====================================================
        // Phase 1: Sort each shelf's own items into its own zones
        // =====================================================
        const shelfResults: Record<string, ReagentPlacement[]> = {};
        let allOverflow: ReagentPlacement[] = [];

        for (const shelf of currentState.shelves) {
            const zones = buildZones(shelf);
            const sorted = sortItems(shelf.items);
            const { placed, overflow } = packItemsIntoZones(sorted, zones, shelf.id);
            shelfResults[shelf.id] = placed;
            allOverflow.push(...overflow);
        }

        // =====================================================
        // Phase 2: Try to place overflow items into any shelf with remaining space
        // =====================================================
        if (allOverflow.length > 0) {
            const sortedOverflow = sortItems(allOverflow);

            for (const shelf of currentState.shelves) {
                if (sortedOverflow.length === 0) break;

                // Rebuild zones for this shelf, but now accounting for already-placed items
                const zones = buildZones(shelf);
                if (zones.length === 0) continue;

                // Try packing the overflow into this shelf
                const { placed, overflow } = packItemsIntoZones(sortedOverflow, zones, shelf.id);

                // Merge placed overflow with existing items on this shelf
                // But we need to avoid collisions with already-placed items
                // Simple approach: if shelf already has items, try to add overflow after them
                if (shelfResults[shelf.id].length === 0) {
                    // Shelf is empty (all its items overflowed elsewhere or had none) - just use placed
                    shelfResults[shelf.id] = placed;
                    allOverflow = overflow;
                }
                // If shelf already has items, skip it for overflow (items already packed tightly)
            }
        }

        const beforeIds = currentState.shelves.flatMap(s => s.items.map(i => i.id));
        const afterIds = Object.values(shelfResults).flat().map(i => i.id);
        if (beforeIds.length !== afterIds.length || new Set(afterIds).size !== beforeIds.length || beforeIds.some(id => !afterIds.includes(id))) return;
        // 5. Update state
        set(state => ({
            ...(createLayoutStorePatch(state, currentState.shelves.map(shelf => ({
                ...shelf,
                items: shelfResults[shelf.id] || [],
            }))) ?? {}),
        }));
    }
}));
