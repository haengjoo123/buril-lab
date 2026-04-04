import { postJson } from './internalApi'
import { supabase } from './supabaseClient'

export interface DisposalGuideResult {
    guide: string
}

function generateCacheKey(chemicals: Array<{ name?: string, casNumber?: string, molecularFormula?: string, category?: string }>): string {
    // Determine a stable key: sort the chemicals array deterministically
    const sorted = [...chemicals].map(c => ({
        name: c.name || '',
        casNumber: c.casNumber || '',
        molecularFormula: c.molecularFormula || '',
        category: c.category || ''
    })).sort((a, b) => {
        const aStr = `${a.name}|${a.casNumber}|${a.molecularFormula}|${a.category}`
        const bStr = `${b.name}|${b.casNumber}|${b.molecularFormula}|${b.category}`
        return aStr.localeCompare(bStr)
    });
    return JSON.stringify(sorted);
}

export async function getAIDisposalGuide(
    chemicals: Array<{
        name: string
        casNumber?: string
        molecularFormula?: string
        category?: string
    }>
): Promise<DisposalGuideResult> {
    const cacheKey = generateCacheKey(chemicals);

    // 1. Check cache
    try {
        const { data } = await supabase
            .from('ai_api_cache')
            .select('response_data')
            .eq('api_type', 'disposal_guide')
            .eq('cache_key', cacheKey)
            .maybeSingle();

        if (data && data.response_data && (data.response_data as DisposalGuideResult).guide) {
            console.log('[Gemini Disposal Guide] Cache hit!');
            return data.response_data as DisposalGuideResult;
        }
    } catch (err) {
        console.warn('[Gemini Disposal Guide] Failed to read cache:', err);
    }

    // 2. Not cached, request from AI
    console.log('[Gemini Disposal Guide] Cache miss, requesting AI...');
    const result = await postJson<DisposalGuideResult>('/api/gemini/disposal-guide', { chemicals });

    // 3. Save to cache
    try {
        if (result && result.guide) {
            await supabase.from('ai_api_cache').insert({
                api_type: 'disposal_guide',
                cache_key: cacheKey,
                response_data: result
            });
        }
    } catch (err) {
        console.warn('[Gemini Disposal Guide] Failed to save cache:', err);
    }

    return result;
}
