export type ReagentTemplateType = 'A' | 'B' | 'C' | 'D'; // Bottle types

export interface ReagentTemplate {
    type: ReagentTemplateType;
    width: number; // Percentage width on shelf (0-100)
    height: number;
    depth: number;
    modelPath?: string; // Path to GLB model if available
    color: string; // Fallback color

    // Optional data for dragging new items
    chemicalData?: Record<string, unknown>; // Should be the full Chemical type
    name?: string;
}

// Reagent placed on a shelf
export interface ReagentPlacement {
    id: string; // Unique placement ID
    reagentId: string; // Reference to actual chemical data
    name: string; // Display name
    position: number; // 0-100% position on shelf (가로)
    depthPosition?: number; // 0-100% 앞뒤 위치 (미설정 시 50)
    width: number; // Width in %
    template: ReagentTemplateType;
    shelfId: string;

    // Safety data cache for quick access
    isAcidic: boolean;
    isBasic: boolean;
    hCodes: string[];

    // User notes and additional info
    notes?: string;
    casNo?: string;
    chemId?: number;
}

export interface DragItem {
    id: string; // placement ID
    originalShelfId: string;
    originalPosition: number;
    originalDepthPosition?: number;
}

export interface ShelfData {
    id: string;
    level: number; // Vertical level (0 = bottom)
    dividers: number[]; // Positions of dividers (0-100%)
    items: ReagentPlacement[];
}

export interface FridgeState {
    shelves: ShelfData[];
    mode: 'VIEW' | 'EDIT' | 'PLACE';
    draggedItem: DragItem | null;
    searchQuery: string;

    /** 시약장 가로 길이 (월드 유닛) */
    cabinetWidth: number;
    /** 시약장 세로 길이 (월드 유닛) */
    cabinetHeight: number;
    /** 시약장 폭/깊이 (월드 유닛) */
    cabinetDepth: number;
    /** 비율 고정 시 가로/세로 비율 (null이면 미고정) */
    cabinetAspectRatio: number | null;
    /** PLACE 모드에서 포커스된 선반 ID */
    focusedShelfId: string | null;

    // Actions
    addShelf: () => void;
    removeShelf: (shelfId: string) => void;
    addDivider: (shelfId: string, position: number) => void;
    addVerticalPanel: (position?: number) => void;
    removeVerticalPanel: () => void;
    moveDivider: (shelfId: string, index: number, position: number) => void;
    removeDivider: (shelfId: string, index: number) => void;
    placeReagent: (shelfId: string, item: Omit<ReagentPlacement, 'shelfId'>) => boolean;
    moveReagent: (id: string, newShelfId: string, newPosition: number, newDepthPosition?: number) => boolean;
    removeReagent: (id: string) => void;
    setMode: (mode: 'VIEW' | 'EDIT' | 'PLACE') => void;
    setSearchQuery: (query: string) => void;
    setDraggedTemplate: (template: ReagentTemplate | null) => void;
    setDraggedItem: (item: DragItem | null) => void;
    draggedTemplate: ReagentTemplate | null;
    setCabinetDimensions: (width?: number, height?: number) => void;
    setCabinetDepth: (depth: number) => void;
    setCabinetAspectRatio: (ratio: number | null) => void;
    setFocusedShelfId: (id: string | null) => void;

    // Selection & Updates
    selectedReagentId: string | null;
    setSelectedReagentId: (id: string | null) => void;
    updateReagent: (id: string, updates: Partial<ReagentPlacement>) => void;
}
