import { postJson } from './internalApi'

export interface GeminiAnalysisResult {
    searchTerm: string
    success: boolean
    usedModelName?: string
    error?: string
}

/**
 * Perform Image Analysis using Google's new GenAI SDK
 * Returns the best single search term extracted from the image
 */
export async function performGeminiImageAnalysis(imageSrc: string): Promise<GeminiAnalysisResult> {
    try {
        const result = await postJson<GeminiAnalysisResult>('/api/gemini/image-analysis', { imageSrc })

        if (!result.searchTerm) {
            throw new Error(result.error || 'No valid search term identified in the image.')
        }

        return result
    } catch (error) {
        console.error('[Gemini Vision] API error:', error)
        return {
            searchTerm: '',
            success: false,
            error: error instanceof Error ? error.message : 'Failed to analyze image with Gemini API',
        }
    }
}
