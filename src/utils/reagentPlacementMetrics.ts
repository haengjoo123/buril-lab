import type { ReagentPlacement, ReagentTemplateType, ShelfData } from '../types/fridge';

export const CONTAINER_BASE_WIDTHS: Record<ReagentTemplateType, number> = {
    A: 8,
    B: 10,
    C: 8,
    D: 10,
};

export const TEMPLATE_DEPTHS: Record<ReagentTemplateType, number> = {
    A: 0.44,
    B: 0.35,
    C: 0.44,
    D: 0.44,
};

export const MESH_BASE_WIDTHS: Record<ReagentTemplateType, number> = {
    A: 0.44,
    B: 0.5,
    C: 0.44,
    D: 0.5,
};

export const TEMPLATE_HEIGHTS: Record<ReagentTemplateType, number> = {
    A: 1.05,
    B: 1.15,
    C: 0.95,
    D: 1.0,
};

export interface ShelfZone {
    xStart: number;
    xEnd: number;
}

const SHELF_BOTTOM_Y = -0.25;
const SHELF_BOTTOM_OFFSET = 0.02;
const SHELF_BOARD_HEIGHT = 0.2;

export function getItemScale(template: ReagentTemplateType, width: number): number {
    return width / (CONTAINER_BASE_WIDTHS[template] || 10);
}

export function getItemVisualWidthPct(
    template: ReagentTemplateType,
    width: number,
    cabinetWidth: number
): number {
    const scale = getItemScale(template, width);
    const visualWidth = (MESH_BASE_WIDTHS[template] || 0.5) * scale;
    return (visualWidth / cabinetWidth) * 100;
}

export function getItemDepthPct(
    template: ReagentTemplateType,
    width: number,
    cabinetDepth: number,
    safetyFactor = 1
): number {
    const scale = getItemScale(template, width);
    return ((TEMPLATE_DEPTHS[template] || 0.44) * scale / cabinetDepth) * 100 * safetyFactor;
}

export function getItemPhysicalHeight(
    template: ReagentTemplateType,
    width: number
): number {
    const scale = getItemScale(template, width);
    return (TEMPLATE_HEIGHTS[template] || 1) * scale;
}

export function getShelfClearanceHeight(cabinetHeight: number, shelfCount: number): number {
    const floatingShelfCount = Math.max(shelfCount - 1, 0);
    const bottom = SHELF_BOTTOM_Y + SHELF_BOTTOM_OFFSET;
    const top = SHELF_BOTTOM_Y + cabinetHeight;
    const usableHeight = top - bottom;

    if (floatingShelfCount === 0) {
        return usableHeight;
    }

    const totalGap = usableHeight - floatingShelfCount * SHELF_BOARD_HEIGHT;
    return totalGap / (floatingShelfCount + 1);
}

export function getShelfClearanceMap(
    shelves: ShelfData[],
    cabinetHeight: number
): Map<string, number> {
    const clearance = getShelfClearanceHeight(cabinetHeight, shelves.length);
    return new Map(shelves.map((shelf) => [shelf.id, clearance]));
}

export function getShelfZones(
    dividers: number[],
    margin = 4,
    dividerMargin = 2
): ShelfZone[] {
    const sortedDividers = [...dividers].sort((a, b) => a - b);
    const boundaries = [0, ...sortedDividers, 100];
    const zones: ShelfZone[] = [];

    for (let i = 0; i < boundaries.length - 1; i++) {
        const rawStart = boundaries[i];
        const rawEnd = boundaries[i + 1];
        const xStart = rawStart + (rawStart === 0 ? margin : dividerMargin);
        const xEnd = rawEnd - (rawEnd === 100 ? margin : dividerMargin);

        if (xEnd - xStart > 2) {
            zones.push({ xStart, xEnd });
        }
    }

    if (zones.length === 0) {
        return [{ xStart: margin, xEnd: 100 - margin }];
    }

    return zones;
}

export function createPlacementWithPosition(
    item: ReagentPlacement,
    shelfId: string,
    position: number,
    depthPosition: number
): ReagentPlacement {
    return {
        ...item,
        shelfId,
        position,
        depthPosition,
    };
}
