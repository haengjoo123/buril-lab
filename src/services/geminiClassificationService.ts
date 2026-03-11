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
        const { category } = await postJson<{ category: DisposalCategory | 'UNKNOWN' | null }>(
            '/api/gemini/classify',
            { chemical }
        )

        if (!category || category === 'UNKNOWN') {
            return null
        }

        const { binColor, label } = getCategoryDetails(category)

        return {
            category,
            reason: `reason_${category.toLowerCase()}`,
            isAiEstimated: true,
            binColor,
            label,
        }
    } catch (error) {
        console.error('[Gemini Classification] API error:', error)
        return null
    }
}
