import { lookupGHSByCAS } from '../services/pubchemService';
import { useLabStore } from '../store/useLabStore';
import type {
    ReagentGhsStatus,
    ReagentPlacement,
    StorageClassification,
} from '../types/fridge';
import { classifyStoragePlacement } from './storageCompatibilityChecker';

export type AutoPlacementBlockReason =
    | 'missing_cas'
    | 'ghs_unverified'
    | 'ghs_without_storage_codes'
    | 'storage_classification_review';

type AutoPlaceItem = Omit<ReagentPlacement, 'shelfId' | 'position' | 'depthPosition'>;

export interface AutoPlacementResolution {
    allowed: boolean;
    item: AutoPlaceItem;
    classification: StorageClassification;
    reason?: AutoPlacementBlockReason;
}

const asPlacement = (item: AutoPlaceItem): ReagentPlacement => ({
    ...item,
    shelfId: '',
    position: 0,
    depthPosition: 50,
});

export function getAutoPlacementBlockReason(
    item: Pick<ReagentPlacement, 'name' | 'hCodes' | 'casNo' | 'ghsStatus' | 'isAcidic' | 'isBasic'>,
    classification = classifyStoragePlacement(asPlacement({
        ...item,
        id: 'auto-placement-check',
        reagentId: 'auto-placement-check',
        width: 0,
        template: 'A',
    })),
): AutoPlacementBlockReason | undefined {
    if (!item.casNo?.trim()) return 'missing_cas';
    if (item.ghsStatus !== 'success') return 'ghs_unverified';
    if (!item.hCodes || item.hCodes.length === 0) return 'ghs_without_storage_codes';
    if (classification.groups.includes('GENERAL')) return 'storage_classification_review';
    if (classification.needsReview || classification.confidence !== 'high') {
        return 'storage_classification_review';
    }
    return undefined;
}

function withGhsResult(item: AutoPlaceItem, result: Awaited<ReturnType<typeof lookupGHSByCAS>>): AutoPlaceItem {
    const status: ReagentGhsStatus = result.status;
    return {
        ...item,
        hCodes: result.success ? result.hCodes : [],
        isAcidic: result.success ? result.isAcidic : false,
        isBasic: result.success ? result.isBasic : false,
        ghsStatus: status,
        ghsCheckedAt: new Date().toISOString(),
    };
}

export async function resolveAutoPlacementStorageData(
    item: AutoPlaceItem,
): Promise<AutoPlacementResolution> {
    let resolvedItem = item;

    if (item.ghsStatus !== 'success') {
        if (!item.casNo?.trim()) {
            const classification = classifyStoragePlacement(asPlacement(item));
            return { allowed: false, item, classification, reason: 'missing_cas' };
        }

        const result = await lookupGHSByCAS(item.casNo, {
            labId: useLabStore.getState().currentLabId,
        });
        resolvedItem = withGhsResult(item, result);
    }

    const classification = classifyStoragePlacement(asPlacement(resolvedItem));
    const reason = getAutoPlacementBlockReason(resolvedItem, classification);

    return {
        allowed: !reason,
        item: resolvedItem,
        classification,
        reason,
    };
}
