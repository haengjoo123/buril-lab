import { postJson } from './internalApi'
import type { ManufacturerDateType } from '../utils/manufacturerDate'

export type ReagentContainerType = 'A' | 'B' | 'C' | 'D'

export type ReagentScanValidation =
    | 'valid'
    | 'missing'
    | 'invalid'
    | 'review_required'

export interface ReagentScanFieldSnapshot<T = string> {
    value: T | null
    confidence: number
    validation: ReagentScanValidation
}

export interface ReagentScanFieldSnapshots {
    name: ReagentScanFieldSnapshot<string>
    casNumber: ReagentScanFieldSnapshot<string>
    capacity: ReagentScanFieldSnapshot<string>
    expiryDate: ReagentScanFieldSnapshot<string>
    manufacturerDateType?: ReagentScanFieldSnapshot<ManufacturerDateType>
    brand: ReagentScanFieldSnapshot<string>
    productNumber: ReagentScanFieldSnapshot<string>
    containerType: ReagentScanFieldSnapshot<ReagentContainerType>
}

export interface ReagentScanResult {
    name: string
    casNumber?: string
    suggestedContainerType: ReagentContainerType | null
    capacity?: string
    expiryDate?: string
    manufacturerDateType?: ManufacturerDateType
    brand?: string
    productNumber?: string
    fieldSnapshots?: ReagentScanFieldSnapshots
    reviewRequired?: boolean
    reviewReasons?: string[]
    success: boolean
    error?: string
}

export const REAGENT_SCAN_AUTO_PLACE_CONFIDENCE = 0.8

export type ReagentScanIdentityField = 'name' | 'casNumber'

export interface ReagentScanIdentityCandidate {
    field: ReagentScanIdentityField
    value: string
    confidence: number
}

const OPTIONAL_FIELD_KEYS = [
    'casNumber',
    'capacity',
    'expiryDate',
    'brand',
    'productNumber',
] as const

function hasSnapshotValue(snapshot?: ReagentScanFieldSnapshot<unknown>): boolean {
    if (!snapshot) return false
    return snapshot.value !== null
        && snapshot.value !== undefined
        && String(snapshot.value).trim().length > 0
}

function hasAutoPlaceConfidence(snapshot?: ReagentScanFieldSnapshot<unknown>): boolean {
    if (!snapshot) return false
    return typeof snapshot.confidence === 'number'
        && Number.isFinite(snapshot.confidence)
        && snapshot.confidence >= REAGENT_SCAN_AUTO_PLACE_CONFIDENCE
        && snapshot.confidence <= 1
}

/**
 * Only server-validated identity fields may become search candidates. Invalid,
 * missing, or review-only OCR values remain visible in the Scanner but can
 * never silently become a query.
 */
export function getReagentScanIdentityCandidates(
    result: ReagentScanResult,
): ReagentScanIdentityCandidate[] {
    const snapshots = result.fieldSnapshots
    if (!result.success || !snapshots) return []

    const candidates: ReagentScanIdentityCandidate[] = []
    const addCandidate = (
        field: ReagentScanIdentityField,
        snapshot: ReagentScanFieldSnapshot<string>,
    ) => {
        if (snapshot.validation !== 'valid' || !hasSnapshotValue(snapshot)) return
        candidates.push({
            field,
            value: String(snapshot.value).trim(),
            confidence: snapshot.confidence,
        })
    }

    addCandidate('name', snapshots.name)
    addCandidate('casNumber', snapshots.casNumber)
    return candidates
}

/**
 * An identity is auto-verified only when there is one unambiguous,
 * high-confidence candidate and the other identity field is genuinely absent.
 * A conflicting/invalid second field always requires an explicit user choice.
 */
export function getAutoVerifiedReagentScanIdentity(
    result: ReagentScanResult,
): ReagentScanIdentityField | null {
    const snapshots = result.fieldSnapshots
    const candidates = getReagentScanIdentityCandidates(result)
    if (!snapshots || candidates.length !== 1) return null

    const candidate = candidates[0]
    const otherSnapshot = candidate.field === 'name'
        ? snapshots.casNumber
        : snapshots.name
    const otherFieldIsAbsent = otherSnapshot.validation === 'missing'
        && !hasSnapshotValue(otherSnapshot)

    return otherFieldIsAbsent && hasAutoPlaceConfidence(
        candidate.field === 'name' ? snapshots.name : snapshots.casNumber,
    )
        ? candidate.field
        : null
}

/**
 * Independently re-check the server snapshot before allowing an automatic
 * cabinet placement. This deliberately treats legacy responses without a
 * snapshot as review-only.
 */
export function getReagentScanReviewReasons(result: ReagentScanResult): string[] {
    const reasons = new Set<string>(result.reviewReasons || [])
    const snapshots = result.fieldSnapshots

    if (!snapshots) {
        reasons.add('field_snapshot_missing')
        return [...reasons]
    }

    const requiredFields = [
        ['name', snapshots.name],
        ['containerType', snapshots.containerType],
    ] as const

    requiredFields.forEach(([key, snapshot]) => {
        if (!snapshot) {
            reasons.add(`${key}_snapshot_missing`)
            return
        }
        if (snapshot.validation !== 'valid' || !hasSnapshotValue(snapshot)) {
            reasons.add(`${key}_${snapshot.validation === 'valid' ? 'missing' : snapshot.validation}`)
            return
        }
        if (!hasAutoPlaceConfidence(snapshot)) {
            reasons.add(`${key}_low_confidence`)
        }
    })

    OPTIONAL_FIELD_KEYS.forEach((key) => {
        const snapshot = snapshots[key]
        if (!snapshot) {
            reasons.add(`${key}_snapshot_missing`)
            return
        }
        if (snapshot.validation === 'missing' && !hasSnapshotValue(snapshot)) return
        if (snapshot.validation !== 'valid') {
            reasons.add(`${key}_${snapshot.validation}`)
            return
        }
        if (
            hasSnapshotValue(snapshot)
            && !hasAutoPlaceConfidence(snapshot)
        ) {
            reasons.add(`${key}_low_confidence`)
        }
    })

    if (snapshots.expiryDate.validation === 'valid' && hasSnapshotValue(snapshots.expiryDate)) {
        const manufacturerDateType = snapshots.manufacturerDateType
        if (!manufacturerDateType || manufacturerDateType.validation !== 'valid'
            || !hasSnapshotValue(manufacturerDateType)
            || manufacturerDateType.value === 'unlabeled') {
            reasons.add('manufacturerDateType_review_required')
        } else if (!hasAutoPlaceConfidence(manufacturerDateType)) {
            reasons.add('manufacturerDateType_low_confidence')
        }
    }

    if (!result.name.trim()) reasons.add('name_missing')
    if (!result.suggestedContainerType) reasons.add('containerType_review_required')

    return [...reasons]
}

export function canAutoPlaceReagentScan(result: ReagentScanResult): boolean {
    return result.success
        && result.reviewRequired !== true
        && getReagentScanReviewReasons(result).length === 0
}

/**
 * Analyze a reagent label image using the server-side AI vision API.
 * Returns structured info about the reagent (name, CAS, container type, capacity, expiry).
 */
export async function scanReagentLabel(imageSrc: string): Promise<ReagentScanResult> {
    try {
        const result = await postJson<ReagentScanResult>('/api/ai/scan-label', { imageSrc })
        if (!result.success) return result

        const reviewReasons = getReagentScanReviewReasons(result)
        return {
            ...result,
            reviewRequired: result.reviewRequired === true || reviewReasons.length > 0,
            reviewReasons,
        }
    } catch (error) {
        console.error('[Reagent Scan] API error:', error)
        return {
            name: '',
            suggestedContainerType: null,
            success: false,
            error: error instanceof Error ? error.message : 'Failed to analyze reagent label.',
        }
    }
}
