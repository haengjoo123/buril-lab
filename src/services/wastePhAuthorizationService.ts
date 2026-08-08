import type { PhPredictionResult, WasteBatchDraft } from '../types';
import { postJson } from './internalApi';
import {
    buildWastePhPredictionAuthorizationContext,
    type WastePhPredictionAuthorizationContext,
} from './wasteLogService';

export interface PredictedPhAuthorization {
    authorizationId: string;
    expiresAt: string;
    prediction: PhPredictionResult;
}

interface PredictedPhAuthorizationResponse {
    authorizationId?: unknown;
    expiresAt?: unknown;
    prediction?: unknown;
}

const isPrediction = (value: unknown): value is PhPredictionResult => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const candidate = value as Partial<PhPredictionResult>;
    return (
        (candidate.status === 'available' || candidate.status === 'approximate'
            || candidate.status === 'unsupported' || candidate.status === 'blocked' || candidate.status === 'failed')
        && (candidate.confidence === 'good' || candidate.confidence === 'approximate' || candidate.confidence === 'unavailable')
        && Array.isArray(candidate.issueCodes)
        && Array.isArray(candidate.assumptions)
        && typeof candidate.modelVersion === 'string'
        && typeof candidate.catalogVersion === 'string'
        && typeof candidate.inputHash === 'string'
    );
};

export function buildPredictedPhAuthorizationRequest(
    batch: WasteBatchDraft,
): { context: WastePhPredictionAuthorizationContext } {
    return { context: buildWastePhPredictionAuthorizationContext(batch) };
}

/**
 * Requests a short-lived server authorization for this exact batch. The server
 * recomputes pH from the normalized payload; it never accepts the browser's
 * displayed prediction as evidence.
 */
export async function authorizePredictedPhForWasteBatch(
    batch: WasteBatchDraft,
): Promise<PredictedPhAuthorization> {
    const response = await postJson<PredictedPhAuthorizationResponse>(
        '/api/waste/authorize-predicted-ph',
        buildPredictedPhAuthorizationRequest(batch),
    );
    if (typeof response.authorizationId !== 'string'
        || !response.authorizationId.trim()
        || typeof response.expiresAt !== 'string'
        || !Number.isFinite(Date.parse(response.expiresAt))
        || !isPrediction(response.prediction)) {
        throw new Error('The predicted pH authorization response is invalid.');
    }

    return {
        authorizationId: response.authorizationId,
        expiresAt: response.expiresAt,
        prediction: response.prediction,
    };
}
