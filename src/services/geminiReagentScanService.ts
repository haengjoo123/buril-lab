import { postJson } from './internalApi'

export interface ReagentScanResult {
    name: string
    casNumber?: string
    suggestedContainerType: 'A' | 'B' | 'C' | 'D'
    capacity?: string
    expiryDate?: string
    brand?: string
    productNumber?: string
    success: boolean
    error?: string
}

/**
 * Analyze a reagent label image using Gemini Vision API.
 * Returns structured info about the reagent (name, CAS, container type, capacity, expiry).
 */
export async function scanReagentLabel(imageSrc: string): Promise<ReagentScanResult> {
    try {
        return await postJson<ReagentScanResult>('/api/gemini/scan-label', { imageSrc })
    } catch (error) {
        console.error('[Reagent Scan] API error:', error)
        return {
            name: '',
            suggestedContainerType: 'A',
            success: false,
            error: error instanceof Error ? error.message : 'Failed to analyze reagent label.',
        }
    }
}
