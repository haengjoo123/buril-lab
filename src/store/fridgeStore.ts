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
    A: 0.44, // 0.22 radius * 2
    B: 0.35, // box depth
    C: 0.7,  // 0.35 radius * 2
    D: 0.8,  // box depth
};

// The raw THREE.js width of the base geometries before scaling
const MESH_BASE_WIDTHS: Record<string, number> = {
    A: 0.44, // 0.22 radius * 2
    B: 0.5,  // box width
    C: 0.7,  // 0.35 radius * 2
    D: 1.2,  // box width
};

const CONTAINER_BASE_WIDTHS: Record<string, number> = { A: 8, B: 10, C: 9, D: 15 };

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
            const { shelves, cabinetName, width, height, depth } = await cabinetService.getCabinetDetails(cabinetId);
            set({
                shelves: shelves.length > 0 ? shelves : INITIAL_SHELVES,
                cabinetName,
                cabinetWidth: width,
                cabinetHeight: height,
                cabinetDepth: depth
            });
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
            await cabinetService.updateCabinet(state.cabinetId, {
                width: state.cabinetWidth,
                height: state.cabinetHeight,
                depth: state.cabinetDepth
            });
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
            cabinetWidth: Math.max(4, Math.min(20, Math.round(newWidth))),
            cabinetHeight: Math.max(2, Math.min(15, Math.round(newHeight))),
        });
    },

    setCabinetDepth: (depth) => set({
        cabinetDepth: Math.max(1, Math.min(4, Math.round(depth))),
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

        // Target item depth/width range (centered)
        const targetPhysicalDepth = TEMPLATE_DEPTHS[templateType as keyof typeof TEMPLATE_DEPTHS] || 0.5;
        const targetScale = width / (CONTAINER_BASE_WIDTHS[templateType || 'A'] || 10);

        const targetVisualWidth = (MESH_BASE_WIDTHS[templateType || 'A'] || 0.5) * targetScale;
        const targetVisualWidthPct = (targetVisualWidth / cabinetDepth) * 100; // actually cabinetWidth, but using generic bounding
        const startVis = position + (width / 2) - (targetVisualWidthPct / 2);
        const endVis = position + (width / 2) + (targetVisualWidthPct / 2);

        const targetDepthPct = (targetPhysicalDepth * targetScale / cabinetDepth) * 100;
        const targetZStart = depthPosition - (targetDepthPct / 2);
        const targetZEnd = depthPosition + (targetDepthPct / 2);

        // Check against other items
        for (const item of shelf.items) {
            if (item.id === ignoreItemId) continue;

            // X-axis Overlap Check
            const itemScale = item.width / (CONTAINER_BASE_WIDTHS[item.template] || 10);
            const itemVisualWidth = (MESH_BASE_WIDTHS[item.template] || 0.5) * itemScale;
            // Note: cabinetWidth should really be used here for X axis.
            const itemVisualWidthPct = (itemVisualWidth / cabinetDepth) * 100;
            const itemStartVis = item.position + (item.width / 2) - (itemVisualWidthPct / 2);
            const itemEndVis = item.position + (item.width / 2) + (itemVisualWidthPct / 2);

            const xOverlap = !(endVis <= itemStartVis || startVis >= itemEndVis);

            if (xOverlap) {
                // Check Z-axis Overlap
                const itemPhysicalDepth = TEMPLATE_DEPTHS[item.template as keyof typeof TEMPLATE_DEPTHS] || 0.5;
                const itemDepthPct = (itemPhysicalDepth * itemScale / cabinetDepth) * 100;
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

    sortShelves: (criteria: 'name' | 'type') => {
        const currentState = get();
        const cabinetDepth = currentState.cabinetDepth;
        const cabinetWidth = currentState.cabinetWidth;
        const GAP_X = 4; // 4% width gap
        const GAP_Z = 4; // 4% depth gap
        const MARGIN = 4; // 4% margin from edges
        const DIVIDER_MARGIN = 2; // 2% margin from dividers

        // --- Helper: get visual width percentage for an item ---
        const getVisualWidthPct = (item: ReagentPlacement) => {
            const itemScale = item.width / (CONTAINER_BASE_WIDTHS[item.template] || 10);
            const visualWidth = (MESH_BASE_WIDTHS[item.template] || 0.5) * itemScale;
            return (visualWidth / cabinetWidth) * 100;
        };

        // --- Helper: get depth percentage for an item ---
        const getDepthPct = (item: ReagentPlacement) => {
            const itemPhysicalDepth = TEMPLATE_DEPTHS[item.template as keyof typeof TEMPLATE_DEPTHS] || 0.5;
            const itemScale = item.width / (CONTAINER_BASE_WIDTHS[item.template] || 10);
            return (itemPhysicalDepth * itemScale / cabinetDepth) * 100 * 1.1; // 10% safety margin
        };

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

        // 5. Update state
        set({
            shelves: currentState.shelves.map(shelf => ({
                ...shelf,
                items: shelfResults[shelf.id] || [],
            })),
        });
    }
}));
