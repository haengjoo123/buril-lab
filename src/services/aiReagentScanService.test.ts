import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    postJson: vi.fn(),
}))

vi.mock('./internalApi', () => ({
    postJson: mocks.postJson,
}))

import {
    canAutoPlaceReagentScan,
    getAutoVerifiedReagentScanIdentity,
    getReagentScanIdentityCandidates,
    getReagentScanReviewReasons,
    scanReagentLabel,
    type ReagentScanFieldSnapshots,
    type ReagentScanResult,
} from './aiReagentScanService'

function createSnapshots(
    overrides: Partial<ReagentScanFieldSnapshots> = {},
): ReagentScanFieldSnapshots {
    return {
        name: { value: 'Acetone', confidence: 0.99, validation: 'valid' },
        casNumber: { value: '67-64-1', confidence: 0.99, validation: 'valid' },
        capacity: { value: '500 mL', confidence: 0.96, validation: 'valid' },
        expiryDate: { value: null, confidence: 0, validation: 'missing' },
        brand: { value: null, confidence: 0, validation: 'missing' },
        productNumber: { value: null, confidence: 0, validation: 'missing' },
        containerType: { value: 'A', confidence: 0.98, validation: 'valid' },
        ...overrides,
    }
}

function createResult(overrides: Partial<ReagentScanResult> = {}): ReagentScanResult {
    return {
        name: 'Acetone',
        casNumber: '67-64-1',
        suggestedContainerType: 'A',
        capacity: '500 mL',
        fieldSnapshots: createSnapshots(),
        reviewRequired: false,
        reviewReasons: [],
        success: true,
        ...overrides,
    }
}

describe('reagent scan automatic placement gate', () => {
    beforeEach(() => {
        mocks.postJson.mockReset()
    })

    it('allows automatic placement only for a complete high-confidence snapshot', () => {
        const result = createResult()

        expect(getReagentScanReviewReasons(result)).toEqual([])
        expect(canAutoPlaceReagentScan(result)).toBe(true)
    })

    it('requires review for a low-confidence extracted field', () => {
        const result = createResult({
            fieldSnapshots: createSnapshots({
                brand: { value: 'Merck?', confidence: 0.61, validation: 'valid' },
            }),
        })

        expect(getReagentScanReviewReasons(result)).toContain('brand_low_confidence')
        expect(canAutoPlaceReagentScan(result)).toBe(false)
    })

    it('requires review for invalid optional data or an unknown container', () => {
        const invalidCas = createResult({
            fieldSnapshots: createSnapshots({
                casNumber: { value: '67-64-2', confidence: 0.99, validation: 'invalid' },
            }),
        })
        const unknownContainer = createResult({
            suggestedContainerType: null,
            fieldSnapshots: createSnapshots({
                containerType: { value: null, confidence: 0, validation: 'review_required' },
            }),
        })

        expect(canAutoPlaceReagentScan(invalidCas)).toBe(false)
        expect(getReagentScanReviewReasons(invalidCas)).toContain('casNumber_invalid')
        expect(canAutoPlaceReagentScan(unknownContainer)).toBe(false)
        expect(getReagentScanReviewReasons(unknownContainer)).toContain('containerType_review_required')
    })

    it('blocks automatic placement when a manufacturer date lacks an explicit type', () => {
        const result = createResult({
            expiryDate: '2028-02-29',
            fieldSnapshots: createSnapshots({
                expiryDate: { value: '2028-02-29', confidence: 0.99, validation: 'valid' },
            }),
        })

        expect(getReagentScanReviewReasons(result)).toContain('manufacturerDateType_review_required')
        expect(canAutoPlaceReagentScan(result)).toBe(false)
    })

    it('treats a legacy successful response without snapshots as review-only', () => {
        const legacy = createResult({ fieldSnapshots: undefined })

        expect(getReagentScanReviewReasons(legacy)).toContain('field_snapshot_missing')
        expect(canAutoPlaceReagentScan(legacy)).toBe(false)
    })

    it('normalizes the server review decision and preserves API failure UX without an A default', async () => {
        mocks.postJson.mockResolvedValueOnce(createResult({
            reviewRequired: false,
            fieldSnapshots: createSnapshots({
                name: { value: 'Acetone', confidence: 0.5, validation: 'valid' },
            }),
        }))
        const reviewed = await scanReagentLabel('data:image/jpeg;base64,AA==')

        expect(reviewed.reviewRequired).toBe(true)
        expect(reviewed.reviewReasons).toContain('name_low_confidence')

        mocks.postJson.mockRejectedValueOnce(new Error('OpenAI Responses is not configured.'))
        const failed = await scanReagentLabel('data:image/jpeg;base64,AA==')

        expect(failed).toMatchObject({
            name: '',
            suggestedContainerType: null,
            success: false,
            error: 'OpenAI Responses is not configured.',
        })
    })
})

describe('reagent scan search identity gate', () => {
    it('requires an explicit choice when both a valid name and CAS are available', () => {
        const result = createResult()

        expect(getReagentScanIdentityCandidates(result)).toEqual([
            { field: 'name', value: 'Acetone', confidence: 0.99 },
            { field: 'casNumber', value: '67-64-1', confidence: 0.99 },
        ])
        expect(getAutoVerifiedReagentScanIdentity(result)).toBeNull()
    })

    it('auto-verifies one high-confidence identity only when the other field is absent', () => {
        const result = createResult({
            casNumber: undefined,
            fieldSnapshots: createSnapshots({
                casNumber: { value: null, confidence: 0, validation: 'missing' },
            }),
        })

        expect(getReagentScanIdentityCandidates(result)).toEqual([
            { field: 'name', value: 'Acetone', confidence: 0.99 },
        ])
        expect(getAutoVerifiedReagentScanIdentity(result)).toBe('name')
    })

    it('never auto-verifies a low-confidence or conflicting invalid identity', () => {
        const lowConfidence = createResult({
            casNumber: undefined,
            fieldSnapshots: createSnapshots({
                name: { value: 'Acetone?', confidence: 0.61, validation: 'valid' },
                casNumber: { value: null, confidence: 0, validation: 'missing' },
            }),
        })
        const conflictingInvalidCas = createResult({
            fieldSnapshots: createSnapshots({
                casNumber: { value: '67-64-2', confidence: 0.99, validation: 'invalid' },
            }),
        })

        expect(getAutoVerifiedReagentScanIdentity(lowConfidence)).toBeNull()
        expect(getReagentScanIdentityCandidates(conflictingInvalidCas)).toEqual([
            { field: 'name', value: 'Acetone', confidence: 0.99 },
        ])
        expect(getAutoVerifiedReagentScanIdentity(conflictingInvalidCas)).toBeNull()
    })

    it('excludes invalid or legacy OCR values from search candidates', () => {
        const invalid = createResult({
            fieldSnapshots: createSnapshots({
                name: { value: '???', confidence: 0.9, validation: 'review_required' },
                casNumber: { value: '67-64-2', confidence: 0.99, validation: 'invalid' },
            }),
        })
        const legacy = createResult({ fieldSnapshots: undefined })

        expect(getReagentScanIdentityCandidates(invalid)).toEqual([])
        expect(getReagentScanIdentityCandidates(legacy)).toEqual([])
    })
})
