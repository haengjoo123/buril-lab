import type { Chemical, DisposalCategory } from '../types'
import { postJson } from './internalApi'
import { getCategoryDetails } from '../utils/chemicalAnalyzer'
import { supabase } from './supabaseClient'

export interface ClassificationResult {
    category: DisposalCategory
    reason: string
    isAiEstimated: boolean
    binColor: string
    label: string
}

function generateCacheKey(chemical: Chemical): string {
    const name = chemical.name || '';
    const cas = chemical.casNumber || '';
    const formula = chemical.molecularFormula || '';
    return JSON.stringify(`${name}|${cas}|${formula}`);
}

export async function classifyChemicalWithAI(chemical: Chemical): Promise<ClassificationResult | null> {
    try {
        const cacheKey = generateCacheKey(chemical);

        // 1. Check cache
        const { data } = await supabase
            .from('ai_api_cache')
            .select('response_data')
            .eq('api_type', 'classify')
            .eq('cache_key', cacheKey)
            .maybeSingle();

        if (data && data.response_data && (data.response_data as any).category) {
            const category = (data.response_data as any).category as DisposalCategory;
            if (category !== 'UNKNOWN') {
                console.log('[Gemini Classification] Cache hit!');
                const { binColor, label } = getCategoryDetails(category);
                return {
                    category,
                    reason: `reason_${category.toLowerCase()}`,
                    isAiEstimated: true,
                    binColor,
                    label,
                };
            }
        }

        // 2. Cache miss, request from AI
        console.log('[Gemini Classification] Cache miss, requesting AI...');
        const result = await postJson<{ category: DisposalCategory | 'UNKNOWN' | null }>(
            '/api/gemini/classify',
            { chemical }
        )

        const category = result.category;

        if (!category || category === 'UNKNOWN') {
            return null
        }

        // 3. Save to cache
        await supabase.from('ai_api_cache').insert({
            api_type: 'classify',
            cache_key: cacheKey,
            response_data: { category }
        });

        const { binColor, label } = getCategoryDetails(category)

        return {
            category,
            reason: `reason_${category.toLowerCase()}`,
            isAiEstimated: true,
            binColor,
            label,
        }
    } catch (error) {
        console.error('[Gemini Classification] API error/Cache error:', error)
        return null
    }
}
