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

interface ClassificationCachePayload {
    category?: DisposalCategory | 'UNKNOWN' | null
}

interface ClassificationCacheRow {
    response_data?: ClassificationCachePayload | null
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

        const cachedRow = data as ClassificationCacheRow | null;
        const cachedCategory = cachedRow?.response_data?.category;

        if (cachedCategory) {
            if (cachedCategory !== 'UNKNOWN') {
                console.log('[Gemini Classification] Cache hit!');
                const { binColor, label } = getCategoryDetails(cachedCategory);
                return {
                    category: cachedCategory,
                    reason: `reason_${cachedCategory.toLowerCase()}`,
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

        const aiCategory = result.category;

        if (!aiCategory || aiCategory === 'UNKNOWN') {
            return null
        }

        // 3. Save to cache
        await supabase.from('ai_api_cache').insert({
            api_type: 'classify',
            cache_key: cacheKey,
            response_data: { category: aiCategory }
        });

        const { binColor, label } = getCategoryDetails(aiCategory)

        return {
            category: aiCategory,
            reason: `reason_${aiCategory.toLowerCase()}`,
            isAiEstimated: true,
            binColor,
            label,
        }
    } catch (error) {
        console.error('[Gemini Classification] API error/Cache error:', error)
        return null
    }
}
