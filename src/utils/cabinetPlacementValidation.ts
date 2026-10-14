import type { ReagentPlacement, ShelfData } from '../types/fridge';
import { getItemDepthPct, getItemPhysicalHeight, getItemVisualWidthPct, getShelfClearanceHeight } from './reagentPlacementMetrics';

export interface PlacementDimensions { cabinetWidth: number; cabinetHeight: number; cabinetDepth: number }

export function hasPlacementCollision(shelves: ShelfData[], dimensions: PlacementDimensions, candidate: Pick<ReagentPlacement, 'shelfId' | 'position' | 'width' | 'depthPosition' | 'template'>, ignoreId?: string): boolean {
    const shelf = shelves.find(s => s.id === candidate.shelfId);
    const { position, width, template } = candidate;
    const depth = candidate.depthPosition ?? 50;
    if (!shelf || ![position, width, depth, dimensions.cabinetWidth, dimensions.cabinetHeight, dimensions.cabinetDepth].every(Number.isFinite) || dimensions.cabinetWidth <= 0 || dimensions.cabinetHeight <= 0 || dimensions.cabinetDepth <= 0 || width <= 0 || position < 0 || position + width > 100) return true;
    const halfX = getItemVisualWidthPct(template, width, dimensions.cabinetWidth) / 2;
    const halfZ = getItemDepthPct(template, width, dimensions.cabinetDepth) / 2;
    const center = position + width / 2;
    if (center - halfX < 1 || center + halfX > 99 || depth - halfZ < 1 || depth + halfZ > 99) return true;
    if (getItemPhysicalHeight(template, width) + 0.05 > getShelfClearanceHeight(dimensions.cabinetHeight, shelves.length)) return true;
    if (shelf.dividers.some(d => d >= center - halfX - 1 && d <= center + halfX + 1)) return true;
    return shelf.items.some(item => {
        if (item.id === ignoreId) return false;
        const otherHalfX = getItemVisualWidthPct(item.template, item.width, dimensions.cabinetWidth) / 2;
        const otherHalfZ = getItemDepthPct(item.template, item.width, dimensions.cabinetDepth) / 2;
        return Math.abs(center - item.position - item.width / 2) < halfX + otherHalfX + 0.5
            && Math.abs(depth - (item.depthPosition ?? 50)) < halfZ + otherHalfZ + 0.5;
    });
}

export function isCabinetLayoutValid(shelves: ShelfData[], dimensions: PlacementDimensions): boolean {
    if (!shelves.length || getShelfClearanceHeight(dimensions.cabinetHeight, shelves.length) < 0.2) return false;
    return shelves.every(s => s.items.every(item => !hasPlacementCollision(shelves, dimensions, item, item.id)));
}
