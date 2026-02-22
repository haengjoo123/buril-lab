import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { FridgeState, ShelfData, ReagentPlacement } from '../types/fridge';
import { cabinetService } from '../services/cabinetService';

interface FridgeStore extends FridgeState {
    checkCollision: (shelfId: string, position: number, width: number, depthPosition?: number, templateType?: string, ignoreItemId?: string) => boolean;
    sortShelves: (criteria: 'name' | 'type') => void;
    cabinetId: string | null;
    cabinetName: string;
    isLoadingCabinet: boolean;
    loadCabinet: (cabinetId: string) => Promise<void>;
    saveCabinet: () => Promise<void>;
    clearCabinet: () => void;
}

const TEMPLATE_DEPTHS = {
    A: 0.4,
    B: 0.5,
    C: 0.8,
    D: 0.8,
};

const INITIAL_SHELVES: ShelfData[] = [
    { id: uuidv4(), level: 0, dividers: [], items: [] },
    { id: uuidv4(), level: 1, dividers: [], items: [] },
    { id: uuidv4(), level: 2, dividers: [], items: [] },
    { id: uuidv4(), level: 3, dividers: [], items: [] },
];

const DEFAULT_CABINET_WIDTH = 5;
const DEFAULT_CABINET_HEIGHT = 9;
const DEFAULT_CABINET_DEPTH = 2;

export const useFridgeStore = create<FridgeStore>((set, get) => ({
    shelves: INITIAL_SHELVES,
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

    loadCabinet: async (cabinetId: string) => {
        set({ isLoadingCabinet: true, cabinetId, cabinetName: '', shelves: [] });
        try {
            const { shelves, cabinetName } = await cabinetService.getCabinetDetails(cabinetId);
            set({ shelves: shelves.length > 0 ? shelves : INITIAL_SHELVES, cabinetName });
        } catch (err) {
            console.error('Failed to load cabinet', err);
        } finally {
            set({ isLoadingCabinet: false });
        }
    },

    saveCabinet: async () => {
        const state = get();
        if (!state.cabinetId) return;
        try {
            await cabinetService.saveCabinetState(state.cabinetId, state.shelves);
        } catch (err) {
            console.error('Failed to save cabinet', err);
        }
    },

    setMode: (mode) => set(state => ({
        mode,
        focusedShelfId: mode === 'PLACE' ? state.focusedShelfId : null,
    })),
    setFocusedShelfId: (id) => set({ focusedShelfId: id }),
    setSearchQuery: (query) => set({ searchQuery: query }),
    setDraggedTemplate: (template) => set({ draggedTemplate: template }),
    setDraggedItem: (item) => set({ draggedItem: item }),
    setPendingPlacement: (placement) => set({ pendingPlacement: placement }),

    setCabinetDimensions: (width, height) => {
        const state = get();
        const ratio = state.cabinetAspectRatio;
        let newWidth = width ?? state.cabinetWidth;
        let newHeight = height ?? state.cabinetHeight;

        if (ratio != null) {
            if (width != null) newHeight = newWidth / ratio;
            else if (height != null) newWidth = newHeight * ratio;
        }

        set({
            cabinetWidth: Math.max(4, Math.min(20, newWidth)),
            cabinetHeight: Math.max(1.2, Math.min(15, newHeight)),
        });
    },

    setCabinetDepth: (depth) => set({
        cabinetDepth: Math.max(0.8, Math.min(4, depth)),
    }),

    setCabinetAspectRatio: (ratio) => set({ cabinetAspectRatio: ratio }),

    checkCollision: (shelfId, position, width, depthPosition = 50, templateType = 'A', ignoreItemId) => {
        const shelf = get().shelves.find(s => s.id === shelfId);
        if (!shelf) return true; // Invalid shelf

        const start = position;
        const end = position + width;

        if (start < 0 || end > 100) return true; // Out of bounds

        const state = get();
        const cabinetDepth = state.cabinetDepth;

        // Target item depth range (centered)
        const targetPhysicalDepth = TEMPLATE_DEPTHS[templateType as keyof typeof TEMPLATE_DEPTHS] || 0.5;
        const targetDepthPct = (targetPhysicalDepth / cabinetDepth) * 100;
        const targetZStart = depthPosition - (targetDepthPct / 2);
        const targetZEnd = depthPosition + (targetDepthPct / 2);

        // Check against other items
        for (const item of shelf.items) {
            if (item.id === ignoreItemId) continue;
            const itemStart = item.position;
            const itemEnd = item.position + item.width;

            // X-axis Overlap Check
            // Overlap condition: not (end <= itemStart || start >= itemEnd)
            const xOverlap = !(end <= itemStart || start >= itemEnd);

            if (xOverlap) {
                // Check Z-axis Overlap
                const itemPhysicalDepth = TEMPLATE_DEPTHS[item.template as keyof typeof TEMPLATE_DEPTHS] || 0.5;
                const itemDepthPct = (itemPhysicalDepth / cabinetDepth) * 100;
                const itemZStart = (item.depthPosition ?? 50) - (itemDepthPct / 2);
                const itemZEnd = (item.depthPosition ?? 50) + (itemDepthPct / 2);

                const zOverlap = !(targetZEnd <= itemZStart || targetZStart >= itemZEnd);

                if (zOverlap) return true;
            }
        }

        return false;
    },

    addShelf: () => set(state => ({
        shelves: [...state.shelves, {
            id: uuidv4(),
            level: state.shelves.length,
            dividers: [],
            items: []
        }]
    })),

    removeShelf: (shelfId) => set(state => {
        if (state.shelves.length === 0) return state;
        const next = state.shelves.filter(s => s.id !== shelfId);
        return {
            shelves: next.map((s, i) => ({ ...s, level: i }))
        };
    }),

    addVerticalPanel: (position = 50) => set(state => ({
        shelves: state.shelves.map(s => {
            const hasNear = s.dividers.some(d => Math.abs(d - position) < 2);
            if (hasNear) return s;
            return { ...s, dividers: [...s.dividers, position].sort((a, b) => a - b) };
        })
    })),

    removeVerticalPanel: () => set(state => {
        const allPositions = state.shelves.flatMap(s => s.dividers);
        if (allPositions.length === 0) return state;
        const maxPos = Math.max(...allPositions);
        return {
            shelves: state.shelves.map(s => ({
                ...s,
                dividers: s.dividers.filter(p => Math.abs(p - maxPos) >= 2)
            }))
        };
    }),

    addDivider: (shelfId, position) => set(state => ({
        shelves: state.shelves.map(s => s.id === shelfId ? {
            ...s,
            dividers: [...s.dividers, position].sort((a, b) => a - b)
        } : s)
    })),

    moveDivider: (shelfId, index, newPosition) => set(state => ({
        shelves: state.shelves.map(s => {
            if (s.id !== shelfId) return s;
            const newDividers = [...s.dividers];
            // Clamp between neighbors or 0-100
            if (newPosition < 0) newPosition = 0;
            if (newPosition > 100) newPosition = 100;
            // TODO: Add Logic to not cross other dividers if needed
            newDividers[index] = newPosition;
            return { ...s, dividers: newDividers.sort((a, b) => a - b) };
        })
    })),

    removeDivider: (shelfId, index) => set(state => ({
        shelves: state.shelves.map(s => s.id === shelfId ? {
            ...s,
            dividers: s.dividers.filter((_, i) => i !== index)
        } : s)
    })),

    placeReagent: (shelfId, itemData) => {
        const store = get();
        if (store.checkCollision(shelfId, itemData.position, itemData.width, itemData.depthPosition, itemData.template)) {
            return false;
        }

        const newItem: ReagentPlacement = {
            ...itemData,
            shelfId,
            id: uuidv4(),
            depthPosition: itemData.depthPosition ?? 50,
        };

        set(state => ({
            shelves: state.shelves.map(s => s.id === shelfId ? {
                ...s,
                items: [...s.items, newItem]
            } : s)
        }));
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

        if (store.checkCollision(newShelfId, newPosition, item.width, depthPos, item.template, id)) {
            return false;
        }

        set(state => ({
            shelves: state.shelves.map(s => {
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
            })
        }));
        return true;
    },

    removeReagent: (id) => set(state => ({
        shelves: state.shelves.map(s => ({
            ...s,
            items: s.items.filter(i => i.id !== id)
        }))
    })),

    clearCabinet: () => set(state => ({
        shelves: state.shelves.map(s => ({
            ...s,
            items: []
        }))
    })),

    setSelectedReagentId: (id) => set({ selectedReagentId: id }),
    setHighlightedItemId: (id) => set({ highlightedItemId: id }),

    updateReagent: (id, updates) => set(state => ({
        shelves: state.shelves.map(s => {
            const hasItem = s.items.some(i => i.id === id);
            if (!hasItem) return s;
            return {
                ...s,
                items: s.items.map(item =>
                    item.id === id ? { ...item, ...updates } : item
                )
            };
        })
    })),

    sortShelves: (criteria: 'name' | 'type') => set(state => ({
        shelves: state.shelves.map(shelf => {
            if (shelf.items.length === 0) return shelf;

            // 1. Sort items
            const sortedItems = [...shelf.items].sort((a, b) => {
                if (criteria === 'name') {
                    return a.name.localeCompare(b.name);
                } else {
                    // Type first, then Name
                    if (a.template !== b.template) return a.template.localeCompare(b.template);
                    return a.name.localeCompare(b.name);
                }
            });

            // 2. Repack items (Front-to-Back, Left-to-Right logic)
            const state = get();
            const cabinetDepth = state.cabinetDepth;
            const GAP_X = 2; // 2% width gap
            const GAP_Z = 2; // 2% depth gap

            const packedItems: ReagentPlacement[] = [];

            // Group by criteria so similar items form columns
            const groups: { [key: string]: ReagentPlacement[] } = {};
            for (const item of sortedItems) {
                const key = criteria === 'name' ? item.name : `${item.template}-${item.name}`;
                if (!groups[key]) groups[key] = [];
                groups[key].push(item);
            }

            let currentX = 2; // Start from 2% left margin

            for (const key in groups) {
                const groupItems = groups[key];
                if (groupItems.length === 0) continue;

                // Find the maximum width in this group to ensure the column is wide enough
                const maxItemWidth = Math.max(...groupItems.map(item => item.width));

                // We'll use the first item's template for physical depth estimation 
                // (assuming items with same name have similar depth/template)
                const template = groupItems[0].template;
                const physicalDepth = TEMPLATE_DEPTHS[template as keyof typeof TEMPLATE_DEPTHS] || 0.5;
                const depthPct = (physicalDepth / cabinetDepth) * 100;

                // Pack this group from Front to Back
                const startZ = 100 - (depthPct / 2) - 2; // 2% margin at front
                let currentZ = startZ;

                for (const item of groupItems) {
                    if (currentZ - (depthPct / 2) < 0) {
                        // Reached the back -> Next column within the same group
                        currentX += maxItemWidth + GAP_X;
                        currentZ = startZ;
                    }

                    packedItems.push({
                        ...item,
                        // Center the item horizontally within the column if it's narrower than maxItemWidth
                        position: currentX + (maxItemWidth - item.width) / 2,
                        depthPosition: currentZ
                    });

                    // Move towards the back for the next item
                    currentZ -= (depthPct + GAP_Z);
                }

                // Finish group -> move to next column for the next group
                currentX += maxItemWidth + GAP_X;
            }

            return { ...shelf, items: packedItems };
        })
    }))
}));
