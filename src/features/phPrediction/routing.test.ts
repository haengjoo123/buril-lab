import { describe, expect, it } from 'vitest';
import { getPredictedPhForRouting } from './routing';

const eligiblePrediction = {
    status: 'available' as const,
    confidence: 'good' as const,
    value: 7,
    issueCodes: [],
    modelVersion: 'buril-ph-1.0.0',
    catalogVersion: 'catalog-1',
    inputHash: 'fnv1a:12345678',
};

describe('getPredictedPhForRouting', () => {
    it('admits only high-confidence, issue-free predictions within the buffered legal range', () => {
        expect(getPredictedPhForRouting(eligiblePrediction)).toBe(7);
        expect(getPredictedPhForRouting({ ...eligiblePrediction, value: 2.2 })).toBeUndefined();
        expect(getPredictedPhForRouting({ ...eligiblePrediction, value: 12.3 })).toBeUndefined();
        expect(getPredictedPhForRouting({ ...eligiblePrediction, value: 2.21 })).toBe(2.21);
        expect(getPredictedPhForRouting({ ...eligiblePrediction, value: 12.29 })).toBe(12.29);
    });

    it('fails closed for approximate or qualified calculations', () => {
        expect(getPredictedPhForRouting({ ...eligiblePrediction, confidence: 'approximate' })).toBeUndefined();
        expect(getPredictedPhForRouting({ ...eligiblePrediction, issueCodes: ['volume_additivity_assumed'] })).toBeUndefined();
        expect(getPredictedPhForRouting({ ...eligiblePrediction, status: 'approximate' })).toBeUndefined();
    });
});
