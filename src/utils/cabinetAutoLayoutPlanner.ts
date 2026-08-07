import type {
    CompatibilityPlanIssue,
    CompatibilityPlanPreview,
    ReagentPlacement,
    ShelfData,
    StorageClassification,
} from '../types/fridge';
import {
    checkCabinetCompatibility,
    checkShelfCompatibility,
    classifyStoragePlacement,
    getStorageGroupPriority,
} from './storageCompatibilityChecker';
import {
    createPlacementWithPosition,
    getItemDepthPct,
    getItemPhysicalHeight,
    getItemVisualWidthPct,
    getShelfClearanceMap,
    getShelfZones,
} from './reagentPlacementMetrics';

interface PlacementZone {
    shelfId: string;
    shelfLevel: number;
    xStart: number;
    xEnd: number;
    clearanceHeight: number;
    items: ReagentPlacement[];
}

interface ClassifiedPlacementItem {
    item: ReagentPlacement;
    classification: StorageClassification;
}

const POSITION_STEP = 2;
const DEPTH_STEP = 4;
const HEIGHT_MARGIN = 0.1;

function countCompatibilityWarnings(shelves: ShelfData[]): number {
    let count = 0;
    checkCabinetCompatibility(shelves).forEach((warnings) => {
        count += warnings.length;
    });
    return count;
}

function getZoneCategory(
    zone: PlacementZone,
    item: ClassifiedPlacementItem,
    classifications: Map<string, StorageClassification>
): number {
    if (zone.items.length === 0) return 1;

    const zonePrimaryGroups = new Set(
        zone.items.map((placed) => classifications.get(placed.id)?.primaryGroup ?? 'GENERAL')
    );

    if (zonePrimaryGroups.size === 1 && zonePrimaryGroups.has(item.classification.primaryGroup)) {
        return 0;
    }

    return 2;
}

function sortZonesForItem(
    zones: PlacementZone[],
    item: ClassifiedPlacementItem,
    classifications: Map<string, StorageClassification>
): PlacementZone[] {
    const preferUpperShelves = item.classification.primaryGroup === 'GENERAL';

    return [...zones].sort((a, b) => {
        const categoryDiff =
            getZoneCategory(a, item, classifications) - getZoneCategory(b, item, classifications);
        if (categoryDiff !== 0) return categoryDiff;

        if (getZoneCategory(a, item, classifications) === 0 && a.items.length !== b.items.length) {
            return b.items.length - a.items.length;
        }

        if (a.shelfLevel !== b.shelfLevel) {
            return preferUpperShelves
                ? b.shelfLevel - a.shelfLevel
                : a.shelfLevel - b.shelfLevel;
        }

        const aWidth = a.xEnd - a.xStart;
        const bWidth = b.xEnd - b.xStart;
        if (aWidth !== bWidth) return bWidth - aWidth;

        return a.xStart - b.xStart;
    });
}

function collidesWithPlacedItems(
    candidate: ReagentPlacement,
    placedItems: ReagentPlacement[],
    cabinetWidth: number,
    cabinetDepth: number
): boolean {
    const targetVisualWidthPct = getItemVisualWidthPct(candidate.template, candidate.width, cabinetWidth);
    const candidateStartVis = candidate.position + (candidate.width / 2) - (targetVisualWidthPct / 2);
    const candidateEndVis = candidate.position + (candidate.width / 2) + (targetVisualWidthPct / 2);

    const candidateDepthPct = getItemDepthPct(candidate.template, candidate.width, cabinetDepth);
    const candidateDepthPosition = candidate.depthPosition ?? 50;
    const candidateZStart = candidateDepthPosition - (candidateDepthPct / 2);
    const candidateZEnd = candidateDepthPosition + (candidateDepthPct / 2);

    return placedItems.some((placed) => {
        const placedVisualWidthPct = getItemVisualWidthPct(placed.template, placed.width, cabinetWidth);
        const placedStartVis = placed.position + (placed.width / 2) - (placedVisualWidthPct / 2);
        const placedEndVis = placed.position + (placed.width / 2) + (placedVisualWidthPct / 2);
        const xOverlap = !(candidateEndVis <= placedStartVis || candidateStartVis >= placedEndVis);
        if (!xOverlap) return false;

        const placedDepthPct = getItemDepthPct(placed.template, placed.width, cabinetDepth);
        const placedDepthPosition = placed.depthPosition ?? 50;
        const placedZStart = placedDepthPosition - (placedDepthPct / 2);
        const placedZEnd = placedDepthPosition + (placedDepthPct / 2);
        return !(candidateZEnd <= placedZStart || candidateZStart >= placedZEnd);
    });
}

function findOpenSlot(
    zone: PlacementZone,
    item: ReagentPlacement,
    cabinetWidth: number,
    cabinetDepth: number
): { position: number; depthPosition: number } | null {
    const maxPosition = zone.xEnd - item.width;
    if (maxPosition < zone.xStart) return null;

    const depthPct = getItemDepthPct(item.template, item.width, cabinetDepth);
    const depthHalf = depthPct / 2;
    const minDepth = Math.max(5 + depthHalf, depthHalf);
    const maxDepth = Math.min(95 - depthHalf, 100 - depthHalf);

    for (let position = zone.xStart; position <= maxPosition; position += POSITION_STEP) {
        for (let depthPosition = maxDepth; depthPosition >= minDepth; depthPosition -= DEPTH_STEP) {
            const candidate = createPlacementWithPosition(item, zone.shelfId, position, depthPosition);
            if (!collidesWithPlacedItems(candidate, zone.items, cabinetWidth, cabinetDepth)) {
                return {
                    position,
                    depthPosition,
                };
            }
        }
    }

    return null;
}

function isCompatibleWithZoneItems(zone: PlacementZone, item: ReagentPlacement): boolean {
    const candidate = createPlacementWithPosition(item, zone.shelfId, zone.xStart, 50);
    const warnings = checkShelfCompatibility([...zone.items, candidate], []);

    return !warnings.some((warning) => warning.itemAId === item.id || warning.itemBId === item.id);
}

function createPlanIssue(
    item: ClassifiedPlacementItem,
    messageKey: string
): CompatibilityPlanIssue {
    return {
        itemId: item.item.id,
        itemName: item.item.name,
        group: item.classification.primaryGroup,
        confidence: item.classification.confidence,
        messageKey,
    };
}

function hasMoved(original: ReagentPlacement, next: ReagentPlacement): boolean {
    return (
        original.shelfId !== next.shelfId ||
        Math.abs(original.position - next.position) > 0.5 ||
        Math.abs((original.depthPosition ?? 50) - (next.depthPosition ?? 50)) > 0.5
    );
}

export function buildCabinetAutoLayoutPlan(
    shelves: ShelfData[],
    cabinetWidth: number,
    cabinetHeight: number,
    cabinetDepth: number
): CompatibilityPlanPreview {
    const originalItems = shelves.flatMap((shelf) => shelf.items);
    const beforeWarningCount = countCompatibilityWarnings(shelves);

    if (originalItems.length === 0) {
        return {
            plannedShelves: shelves,
            beforeWarningCount,
            afterWarningCount: beforeWarningCount,
            movedItemCount: 0,
            movedItemIds: [],
            reviewItems: [],
            unplacedItems: [],
            canApply: false,
        };
    }

    const clearanceByShelfId = getShelfClearanceMap(shelves, cabinetHeight);
    const plannedShelves: ShelfData[] = shelves.map((shelf) => ({
        ...shelf,
        items: [],
    }));
    const plannedShelfById = new Map(plannedShelves.map((shelf) => [shelf.id, shelf]));
    const classifications = new Map<string, StorageClassification>();
    const reviewItems: CompatibilityPlanIssue[] = [];
    const unplacedItems: CompatibilityPlanIssue[] = [];

    const confidenceOrder = {
        high: 0,
        medium: 1,
        low: 2,
        review: 3,
    } as const;

    const itemsToPlace: ClassifiedPlacementItem[] = originalItems
        .map((item) => {
            const classification = classifyStoragePlacement(item);
            classifications.set(item.id, classification);
            return { item, classification };
        })
        .sort((a, b) => {
            const priorityDiff =
                getStorageGroupPriority(a.classification.primaryGroup) -
                getStorageGroupPriority(b.classification.primaryGroup);
            if (priorityDiff !== 0) return priorityDiff;

            const confidenceDiff =
                confidenceOrder[a.classification.confidence] -
                confidenceOrder[b.classification.confidence];
            if (confidenceDiff !== 0) return confidenceDiff;

            if (a.item.width !== b.item.width) return b.item.width - a.item.width;
            return a.item.name.localeCompare(b.item.name);
        });

    const zones: PlacementZone[] = [...shelves]
        .sort((a, b) => a.level - b.level)
        .flatMap((shelf) =>
            getShelfZones(shelf.dividers).map((zone) => ({
                shelfId: shelf.id,
                shelfLevel: shelf.level,
                xStart: zone.xStart,
                xEnd: zone.xEnd,
                clearanceHeight: clearanceByShelfId.get(shelf.id) ?? 0,
                items: [],
            }))
        );

    for (const classifiedItem of itemsToPlace) {
        const itemHeight = getItemPhysicalHeight(classifiedItem.item.template, classifiedItem.item.width);

        if (classifiedItem.classification.confidence === 'review') {
            reviewItems.push(createPlanIssue(classifiedItem, 'cabinet_auto_place_review_identity'));
            unplacedItems.push(createPlanIssue(classifiedItem, 'cabinet_auto_place_unplaced_identity'));
            continue;
        }

        if (!zones.some((zone) => itemHeight + HEIGHT_MARGIN <= zone.clearanceHeight)) {
            unplacedItems.push(createPlanIssue(classifiedItem, 'cabinet_auto_place_unplaced_height'));
            continue;
        }

        const candidateZones = sortZonesForItem(zones, classifiedItem, classifications);
        let placed = false;
        let hasCompatibleZone = false;

        for (const zone of candidateZones) {
            if (itemHeight + HEIGHT_MARGIN > zone.clearanceHeight) continue;
            if (!isCompatibleWithZoneItems(zone, classifiedItem.item)) continue;
            hasCompatibleZone = true;

            const slot = findOpenSlot(zone, classifiedItem.item, cabinetWidth, cabinetDepth);
            if (!slot) continue;

            const placedItem = createPlacementWithPosition(
                classifiedItem.item,
                zone.shelfId,
                slot.position,
                slot.depthPosition
            );

            zone.items.push(placedItem);
            plannedShelfById.get(zone.shelfId)?.items.push(placedItem);
            placed = true;

            if (classifiedItem.classification.needsReview) {
                reviewItems.push(createPlanIssue(classifiedItem, 'cabinet_auto_place_review_general'));
            }

            break;
        }

        if (!placed) {
            unplacedItems.push(
                createPlanIssue(
                    classifiedItem,
                    hasCompatibleZone
                        ? 'cabinet_auto_place_unplaced_space'
                        : 'cabinet_auto_place_unplaced_conflict'
                )
            );
        }
    }

    plannedShelves.forEach((shelf) => {
        shelf.items.sort((a, b) => {
            if (a.position !== b.position) return a.position - b.position;
            return (b.depthPosition ?? 50) - (a.depthPosition ?? 50);
        });
    });

    const afterWarningCount = countCompatibilityWarnings(plannedShelves);
    const movedItemIds = originalItems
        .filter((item) => {
            const nextItem = plannedShelves
                .flatMap((shelf) => shelf.items)
                .find((plannedItem) => plannedItem.id === item.id);

            return nextItem ? hasMoved(item, nextItem) : false;
        })
        .map((item) => item.id);

    return {
        plannedShelves,
        beforeWarningCount,
        afterWarningCount,
        movedItemCount: movedItemIds.length,
        movedItemIds,
        reviewItems,
        unplacedItems,
        canApply: originalItems.length > 0
            && afterWarningCount === 0
            && reviewItems.length === 0
            && unplacedItems.length === 0,
    };
}
