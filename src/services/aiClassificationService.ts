import type { Chemical, DisposalCategory } from '../types'
import { postJson } from './internalApi'
import { getCategoryDetails } from '../utils/chemicalAnalyzer'

export interface ClassificationResult {
    category: DisposalCategory
    reason: string
    isAiEstimated: boolean
    binColor: string
    label: string
}

export async function classifyChemicalWithAI(chemical: Chemical): Promise<ClassificationResult | null> {
    try {
        console.log('[AI Classification] Requesting classification...');
        const result = await postJson<{ category: DisposalCategory | 'UNKNOWN' | null }>(
            '/api/ai/classify',
            { chemical }
        )

        const aiCategory = result.category;

        if (!aiCategory || aiCategory === 'UNKNOWN') {
            return null
        }

        const { binColor, label } = getCategoryDetails(aiCategory)

        return {
            category: aiCategory,
            reason: `reason_${aiCategory.toLowerCase()}`,
            isAiEstimated: true,
            binColor,
            label,
        }
    } catch (error) {
        console.error('[AI Classification] API error/Cache error:', error)
        return null
    }
}
