import type { ReagentPlacement, ReagentTemplateType, ShelfData } from '../types/fridge';
import { getItemDepthPct, getItemVisualWidthPct } from './reagentPlacementMetrics';

export interface BulkMovePlacementCandidate {
    itemId: string;
    itemSource: 'inventory' | 'cabinet_item';
    name: string;
    template: ReagentTemplateType;
    width: number;
}

export interface BulkMovePlacement {
    shelf_id: string;
    template: ReagentTemplateType;
    width: number;
    position: number;
    depth_position: number;
}

export interface BulkMovePlacementPlanItem {
    itemId: string;
    itemSource: 'inventory' | 'cabinet_item';
    placement: BulkMovePlacement;
}

function collides(input: {
    shelf: ShelfData;
    position: number;
    width: number;
    depthPosition: number;
    template: ReagentTemplateType;
    cabinetWidth: number;
    cabinetDepth: number;
}): boolean {
    const start = input.position;
    const end = input.position + input.width;
    if (start < 0 || end > 100) return true;

    const visualWidth = getItemVisualWidthPct(
        input.template,
        input.width,
        input.cabinetWidth,
    );
    const startVisual = input.position + input.width / 2 - visualWidth / 2;
    const endVisual = input.position + input.width / 2 + visualWidth / 2;
    const depth = getItemDepthPct(
        input.template,
        input.width,
        input.cabinetDepth,
    );
    const startDepth = input.depthPosition - depth / 2;
    const endDepth = input.depthPosition + depth / 2;

    return input.shelf.items.some((item) => {
        const itemVisualWidth = getItemVisualWidthPct(
            item.template,
            item.width,
            input.cabinetWidth,
        );
        const itemStartVisual = item.position + item.width / 2 - itemVisualWidth / 2;
        const itemEndVisual = item.position + item.width / 2 + itemVisualWidth / 2;
        const overlapsHorizontally = !(
            endVisual <= itemStartVisual || startVisual >= itemEndVisual
        );
        if (!overlapsHorizontally) return false;

        const itemDepth = getItemDepthPct(
            item.template,
            item.width,
            input.cabinetDepth,
        );
        const itemDepthPosition = item.depthPosition ?? 50;
        const itemStartDepth = itemDepthPosition - itemDepth / 2;
        const itemEndDepth = itemDepthPosition + itemDepth / 2;
        return !(endDepth <= itemStartDepth || startDepth >= itemEndDepth);
    });
}

/**
 * Plan all cabinet placements without mutating Zustand or the database. A null
 * result means the entire move must be rejected before calling the atomic RPC.
 */
export function planBulkInventoryCabinetMove(input: {
    shelves: ShelfData[];
    cabinetWidth: number;
    cabinetDepth: number;
    candidates: BulkMovePlacementCandidate[];
}): BulkMovePlacementPlanItem[] | null {
    if (!Number.isFinite(input.cabinetWidth) || input.cabinetWidth <= 0 ||
        !Number.isFinite(input.cabinetDepth) || input.cabinetDepth <= 0) {
        return null;
    }

    const candidateKeys = new Set(input.candidates.map((candidate) => (
        `${candidate.itemSource}:${candidate.itemId}`
    )));
    const plannedShelves = input.shelves.map((shelf): ShelfData => ({
        ...shelf,
        items: shelf.items.filter((item) => !(
            candidateKeys.has(`cabinet_item:${item.id}`) ||
            (item.linkedInventoryItemId && candidateKeys.has(`inventory:${item.linkedInventoryItemId}`)) ||
            candidateKeys.has(`inventory:${item.reagentId}`)
        )),
    }));
    const sortedShelves = [...plannedShelves].sort((left, right) => left.level - right.level);
    const result: BulkMovePlacementPlanItem[] = [];

    for (const candidate of input.candidates) {
        if (!Number.isFinite(candidate.width) || candidate.width <= 0 || candidate.width > 96) {
            return null;
        }

        let placement: BulkMovePlacement | null = null;
        for (const shelf of sortedShelves) {
            const startPosition = 2;
            const endPosition = 100 - candidate.width - 2;
            for (let position = startPosition; position <= endPosition; position += 2) {
                for (const depthPosition of [50, 80, 20]) {
                    if (!collides({
                        shelf,
                        position,
                        width: candidate.width,
                        depthPosition,
                        template: candidate.template,
                        cabinetWidth: input.cabinetWidth,
                        cabinetDepth: input.cabinetDepth,
                    })) {
                        placement = {
                            shelf_id: shelf.id,
                            template: candidate.template,
                            width: candidate.width,
                            position,
                            depth_position: depthPosition,
                        };
                        break;
                    }
                }
                if (placement) break;
            }
            if (placement) {
                const simulated: ReagentPlacement = {
                    id: `planned:${candidate.itemSource}:${candidate.itemId}`,
                    reagentId: candidate.itemId,
                    linkedInventoryItemId: candidate.itemSource === 'inventory'
                        ? candidate.itemId
                        : undefined,
                    name: candidate.name,
                    shelfId: placement.shelf_id,
                    template: placement.template,
                    width: placement.width,
                    position: placement.position,
                    depthPosition: placement.depth_position,
                    isAcidic: false,
                    isBasic: false,
                    hCodes: [],
                };
                const targetShelf = plannedShelves.find((shelf) => shelf.id === placement?.shelf_id);
                targetShelf?.items.push(simulated);
                result.push({
                    itemId: candidate.itemId,
                    itemSource: candidate.itemSource,
                    placement,
                });
                break;
            }
        }

        if (!placement) return null;
    }

    return result;
}
