import type { PhPredictionResult } from '../../types';

/**
 * A calculated pH may support routing only when it stays clear of the Korean
 * waste-acid (<= 2) and waste-alkali (>= 12.5) thresholds. The buffer is
 * wider than the approved golden-case error bound (0.1 pH) so a calculation
 * never establishes a legal corrosivity class without a direct measurement.
 */
export const PREDICTED_PH_ROUTING_MIN_EXCLUSIVE = 2.2;
export const PREDICTED_PH_ROUTING_MAX_EXCLUSIVE = 12.3;

export type PredictedPhRoutingCandidate = Pick<
    PhPredictionResult,
    'status' | 'confidence' | 'value' | 'issueCodes' | 'modelVersion' | 'catalogVersion' | 'inputHash'
>;

/**
 * Returns the narrowly-scoped predicted pH that may replace a measured pH for
 * aqueous acid/alkali routing. Approximate, edge, and out-of-scope results
 * deliberately remain measurement-required.
 */
export function getPredictedPhForRouting(
    result: PredictedPhRoutingCandidate | null | undefined,
): number | undefined {
    if (!result || result.status !== 'available' || result.confidence !== 'good') return undefined;
    if (result.issueCodes.length > 0 || !Number.isFinite(result.value)) return undefined;
    if (!result.modelVersion.trim() || !result.catalogVersion.trim() || !result.inputHash.trim()) return undefined;

    const value = result.value!;
    return value > PREDICTED_PH_ROUTING_MIN_EXCLUSIVE && value < PREDICTED_PH_ROUTING_MAX_EXCLUSIVE
        ? value
        : undefined;
}
