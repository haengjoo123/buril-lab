import type { ReagentPlacement, ShelfData } from '../types/fridge';
import { getItemDepthPct, getItemVisualWidthPct, getShelfZones } from './reagentPlacementMetrics';

export interface NearbyReagentSlot {
    shelfId: string;
    position: number;
    depthPosition: number;
}

interface FindNearbyReagentSlotInput {
    shelves: ShelfData[];
    referenceItem: ReagentPlacement;
    cabinetWidth: number;
    cabinetDepth: number;
    gapXPct?: number;
    gapZPct?: number;
    positionStep?: number;
    depthStep?: number;
}

const DEFAULT_GAP_X_PCT = 4;
const DEFAULT_GAP_Z_PCT = 6;
const DEFAULT_POSITION_STEP = 2;
const DEFAULT_DEPTH_STEP = 4;

function buildOrderedShelves(
    shelves: ShelfData[],
    referenceShelfId: string
): ShelfData[] {
    const referenceShelf = shelves.find((shelf) => shelf.id === referenceShelfId);
    const referenceLevel = referenceShelf?.level ?? 0;

    return [...shelves].sort((left, right) => {
        if (left.id === referenceShelfId && right.id !== referenceShelfId) return -1;
        if (right.id === referenceShelfId && left.id !== referenceShelfId) return 1;

        const leftDistance = Math.abs(left.level - referenceLevel);
        const rightDistance = Math.abs(right.level - referenceLevel);
        if (leftDistance !== rightDistance) return leftDistance - rightDistance;

        return left.level - right.level;
    });
}

function buildPositionCandidates(
    xStart: number,
    xEnd: number,
    width: number,
    referencePosition: number,
    step: number,
    includeReferencePosition = true
): number[] {
    const maxPosition = xEnd - width;
    if (maxPosition < xStart) return [];

    const candidates: number[] = [];
    const seen = new Set<number>();

    for (let position = xStart; position <= maxPosition + 0.001; position += step) {
        const normalized = Number(position.toFixed(3));
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        candidates.push(normalized);
    }

    const normalizedReferencePosition = Number(referencePosition.toFixed(3));
    if (
        includeReferencePosition
        && normalizedReferencePosition >= xStart
        && normalizedReferencePosition <= maxPosition
        && !seen.has(normalizedReferencePosition)
    ) {
        seen.add(normalizedReferencePosition);
        candidates.push(normalizedReferencePosition);
    }

    const filteredCandidates = includeReferencePosition
        ? candidates
        : candidates.filter((position) => Math.abs(position - referencePosition) >= 0.001);

    return filteredCandidates.sort((left, right) => {
        const leftDistance = Math.abs(left - referencePosition);
        const rightDistance = Math.abs(right - referencePosition);
        if (leftDistance !== rightDistance) return leftDistance - rightDistance;
        return left - right;
    });
}

function buildDepthCandidates(
    width: number,
    template: ReagentPlacement['template'],
    cabinetDepth: number,
    referenceDepthPosition: number,
    step: number
): number[] {
    const depthPct = getItemDepthPct(template, width, cabinetDepth);
    const depthHalf = depthPct / 2;
    const minDepth = Math.max(depthHalf, 5 + depthHalf);
    const maxDepth = Math.min(100 - depthHalf, 95 - depthHalf);
    if (maxDepth < minDepth) return [];

    const candidates: number[] = [];
    const seen = new Set<number>();

    for (let depthPosition = minDepth; depthPosition <= maxDepth + 0.001; depthPosition += step) {
        const normalized = Number(depthPosition.toFixed(3));
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        candidates.push(normalized);
    }

    const clampedReference = Math.min(maxDepth, Math.max(minDepth, referenceDepthPosition));
    const normalizedReferenceDepth = Number(clampedReference.toFixed(3));
    if (!seen.has(normalizedReferenceDepth)) {
        seen.add(normalizedReferenceDepth);
        candidates.push(normalizedReferenceDepth);
    }

    return candidates.sort((left, right) => {
        const leftDistance = Math.abs(left - clampedReference);
        const rightDistance = Math.abs(right - clampedReference);
        if (leftDistance !== rightDistance) return leftDistance - rightDistance;
        return left - right;
    });
}

function collidesWithGap(
    candidate: NearbyReagentSlot,
    candidateItem: ReagentPlacement,
    shelfItems: ReagentPlacement[],
    cabinetWidth: number,
    cabinetDepth: number,
    gapXPct: number,
    gapZPct: number,
    ignoreItemId?: string
): boolean {
    const candidateVisualWidthPct = getItemVisualWidthPct(
        candidateItem.template,
        candidateItem.width,
        cabinetWidth
    );
    const candidateStartX =
        candidate.position + (candidateItem.width / 2) - (candidateVisualWidthPct / 2) - (gapXPct / 2);
    const candidateEndX =
        candidate.position + (candidateItem.width / 2) + (candidateVisualWidthPct / 2) + (gapXPct / 2);

    const candidateDepthPct = getItemDepthPct(
        candidateItem.template,
        candidateItem.width,
        cabinetDepth
    );
    const candidateStartZ = candidate.depthPosition - (candidateDepthPct / 2) - (gapZPct / 2);
    const candidateEndZ = candidate.depthPosition + (candidateDepthPct / 2) + (gapZPct / 2);

    return shelfItems.some((item) => {
        if (item.id === ignoreItemId) return false;

        const itemVisualWidthPct = getItemVisualWidthPct(item.template, item.width, cabinetWidth);
        const itemStartX =
            item.position + (item.width / 2) - (itemVisualWidthPct / 2) - (gapXPct / 2);
        const itemEndX =
            item.position + (item.width / 2) + (itemVisualWidthPct / 2) + (gapXPct / 2);

        const xOverlap = !(candidateEndX <= itemStartX || candidateStartX >= itemEndX);
        if (!xOverlap) return false;

        const itemDepthPct = getItemDepthPct(item.template, item.width, cabinetDepth);
        const itemDepthPosition = item.depthPosition ?? 50;
        const itemStartZ = itemDepthPosition - (itemDepthPct / 2) - (gapZPct / 2);
        const itemEndZ = itemDepthPosition + (itemDepthPct / 2) + (gapZPct / 2);

        return !(candidateEndZ <= itemStartZ || candidateStartZ >= itemEndZ);
    });
}

export function findNearbyReagentSlot({
    shelves,
    referenceItem,
    cabinetWidth,
    cabinetDepth,
    gapXPct = DEFAULT_GAP_X_PCT,
    gapZPct = DEFAULT_GAP_Z_PCT,
    positionStep = DEFAULT_POSITION_STEP,
    depthStep = DEFAULT_DEPTH_STEP,
}: FindNearbyReagentSlotInput): NearbyReagentSlot | null {
    const orderedShelves = buildOrderedShelves(shelves, referenceItem.shelfId);
    const referenceDepthPosition = referenceItem.depthPosition ?? 50;
    const referenceShelf = orderedShelves.find((shelf) => shelf.id === referenceItem.shelfId) || null;
    const adjacentShelves = orderedShelves.filter((shelf) => shelf.id !== referenceItem.shelfId);

    const searchShelf = (
        shelf: ShelfData,
        options?: {
            includeReferencePosition?: boolean;
            onlyReferencePosition?: boolean;
            excludeReferenceDepth?: boolean;
            onlyReferenceDepth?: boolean;
        }
    ): NearbyReagentSlot | null => {
        let bestCandidate: NearbyReagentSlot | null = null;
        let bestScore = Number.POSITIVE_INFINITY;
        const zones = getShelfZones(shelf.dividers);

        for (const zone of zones) {
            let positionCandidates = buildPositionCandidates(
                zone.xStart,
                zone.xEnd,
                referenceItem.width,
                referenceItem.position,
                positionStep,
                options?.includeReferencePosition ?? true
            );
            if (options?.onlyReferencePosition) {
                positionCandidates = positionCandidates.filter((position) => Math.abs(position - referenceItem.position) < 0.001);
            }
            if (positionCandidates.length === 0) continue;

            let depthCandidates = buildDepthCandidates(
                referenceItem.width,
                referenceItem.template,
                cabinetDepth,
                referenceDepthPosition,
                depthStep
            );
            if (options?.onlyReferenceDepth) {
                depthCandidates = depthCandidates.filter((depthPosition) => Math.abs(depthPosition - referenceDepthPosition) < 0.001);
            }
            if (options?.excludeReferenceDepth) {
                depthCandidates = depthCandidates.filter((depthPosition) => Math.abs(depthPosition - referenceDepthPosition) >= 0.001);
            }
            if (depthCandidates.length === 0) continue;

            for (const position of positionCandidates) {
                for (const depthPosition of depthCandidates) {
                    const candidate: NearbyReagentSlot = {
                        shelfId: shelf.id,
                        position,
                        depthPosition,
                    };

                    if (collidesWithGap(
                        candidate,
                        referenceItem,
                        shelf.items,
                        cabinetWidth,
                        cabinetDepth,
                        gapXPct,
                        gapZPct
                    )) {
                        continue;
                    }

                    const score =
                        Math.abs(position - referenceItem.position) +
                        Math.abs(depthPosition - referenceDepthPosition);

                    if (score < bestScore) {
                        bestScore = score;
                        bestCandidate = candidate;
                    }
                }
            }
        }

        return bestCandidate;
    };

    if (referenceShelf) {
        const sameShelfSideCandidate = searchShelf(referenceShelf, {
            includeReferencePosition: false,
            onlyReferenceDepth: true,
        });
        if (sameShelfSideCandidate) {
            return sameShelfSideCandidate;
        }

        const sameShelfDepthCandidate = searchShelf(referenceShelf, {
            includeReferencePosition: true,
            onlyReferencePosition: true,
            excludeReferenceDepth: true,
        });
        if (sameShelfDepthCandidate) {
            return sameShelfDepthCandidate;
        }
    }

    for (const shelf of adjacentShelves) {
        const candidate = searchShelf(shelf);
        if (candidate) {
            return candidate;
        }
    }

    return null;
}
