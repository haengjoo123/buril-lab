/** A=갈색병 B=플라스틱 C=유리병(GLB) D=바이알박스 */
export type ReagentTemplateType = 'A' | 'B' | 'C' | 'D';

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
    linkedInventoryItemId?: string; // Exact linked inventory row when available
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
    /** Status of the authoritative CAS/GHS lookup used for storage decisions. */
    ghsStatus?: ReagentGhsStatus;
    ghsCheckedAt?: string;

    // User notes and additional info
    notes?: string;
    casNo?: string;
    chemId?: number;
    expiryDate?: string; // ISO date string (YYYY-MM-DD)
    capacity?: string; // e.g. "500mL", "1kg"

    // Product info (from inventory registration)
    productNumber?: string; // e.g. "A1234-500ML"
    brand?: string; // e.g. "Sigma-Aldrich"
    remaining_percent?: number;
}

export interface DragItem {
    id: string; // placement ID
    originalShelfId: string;
    originalPosition: number;
    originalDepthPosition?: number;
}

export interface PendingPlacement {
    shelfId: string;
    position: number;
    depthPosition: number;
    width: number;
    template: ReagentTemplateType;
    chemicalData?: Record<string, unknown>;
}

export interface ShelfData {
    id: string;
    level: number; // Vertical level (0 = bottom)
    dividers: number[]; // Positions of dividers (0-100%)
    items: ReagentPlacement[];
}

export type ReagentGhsStatus =
    | 'not_checked'
    | 'pending'
    | 'success'
    | 'no_ghs'
    | 'not_found'
    | 'transient_error'
    | 'invalid_cas';

export type StoragePlacementGroup =
    | 'FLAMMABLE'
    | 'OXIDIZER'
    | 'INORGANIC_ACID'
    | 'ORGANIC_ACID'
    | 'BASE'
    | 'TOXIC_CYANIDE'
    | 'TOXIC_SULFIDE'
    | 'TOXIC_AZIDE'
    | 'ACUTE_TOXIC'
    | 'WATER_REACTIVE'
    | 'PYROPHORIC'
    | 'EXPLOSIVE'
    | 'ORGANIC_PEROXIDE'
    | 'COMPRESSED_GAS'
    | 'ORGANIC_SOLVENT'
    | 'GENERAL';

export type StorageClassificationConfidence = 'high' | 'medium' | 'low' | 'review';

export type StorageClassificationEvidence =
    | 'h_codes'
    | 'acid_base_flags'
    | 'name_patterns'
    | 'cas_number'
    | 'fallback_general'
    | 'insufficient_identity';

export interface StorageClassification {
    /** Groups supported by authoritative evidence and safe for compatibility rules. */
    groups: StoragePlacementGroup[];
    /** Name-derived candidates shown for review only; never used for compatibility rules. */
    candidateGroups: StoragePlacementGroup[];
    primaryGroup: StoragePlacementGroup;
    confidence: StorageClassificationConfidence;
    evidence: StorageClassificationEvidence[];
    needsReview: boolean;
}

export interface CompatibilityPlanIssue {
    itemId: string;
    itemName: string;
    group: StoragePlacementGroup;
    confidence: StorageClassificationConfidence;
    messageKey: string;
}

export interface CompatibilityPlanPreview {
    plannedShelves: ShelfData[];
    beforeWarningCount: number;
    afterWarningCount: number;
    movedItemCount: number;
    movedItemIds: string[];
    reviewItems: CompatibilityPlanIssue[];
    unplacedItems: CompatibilityPlanIssue[];
    canApply: boolean;
}

export interface FridgeState {
    shelves: ShelfData[];
    layoutUndoStack: ShelfData[][];
    layoutRedoStack: ShelfData[][];
    mode: 'VIEW' | 'EDIT' | 'PLACE';
    draggedItem: DragItem | null;
    pendingPlacement: PendingPlacement | null;
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
    undoCabinetLayout: () => boolean;
    redoCabinetLayout: () => boolean;
    setMode: (mode: 'VIEW' | 'EDIT' | 'PLACE') => void;
    setSearchQuery: (query: string) => void;
    setDraggedTemplate: (template: ReagentTemplate | null) => void;
    setDraggedItem: (item: DragItem | null) => void;
    setPendingPlacement: (placement: PendingPlacement | null) => void;
    draggedTemplate: ReagentTemplate | null;
    setCabinetDimensions: (width?: number, height?: number) => void;
    setCabinetDepth: (depth: number) => void;
    setCabinetAspectRatio: (ratio: number | null) => void;
    setFocusedShelfId: (id: string | null) => void;

    // Selection & Updates
    selectedReagentId: string | null;
    highlightedItemId: string | string[] | null;
    setSelectedReagentId: (id: string | null) => void;
    setHighlightedItemId: (id: string | string[] | null) => void;
    updateReagent: (id: string, updates: Partial<ReagentPlacement>) => void;

    // Auto-placement
    autoPlaceReagent: (itemData: Omit<ReagentPlacement, 'shelfId' | 'position' | 'depthPosition'>) => { itemId: string; shelfLevel: number; reagentName: string } | null;
    autoPlaceResult: { itemId: string; shelfLevel: number; reagentName: string } | null;
    clearAutoPlaceResult: () => void;
    compatibilityPlanPreview: CompatibilityPlanPreview | null;
    isBuildingCompatibilityPlan: boolean;
    isApplyingCompatibilityPlan: boolean;
    buildCompatibilityPlan: () => Promise<CompatibilityPlanPreview | null>;
    applyCompatibilityPlan: () => Promise<boolean>;
    clearCompatibilityPlan: () => void;
}
