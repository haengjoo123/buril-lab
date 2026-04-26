import { postJson } from './internalApi'
import { analyticsService } from './analyticsService'
import { supabase } from './supabaseClient'
import type { SolutionContext } from '../types'

export interface DisposalGuideResult {
    guide: string
}

export interface DisposalGuideChemicalInput {
    name: string
    casNumber?: string
    molecularFormula?: string
    category?: string
    solutionContext?: SolutionContext
}

function normalizeSolutionContext(context?: SolutionContext) {
    if (!context) return null

    return {
        physicalForm: context.physicalForm,
        solventClass: context.solventClass,
        solventName: context.solventName || '',
        solventPreset: context.solventPreset || '',
        isCustomSolvent: Boolean(context.isCustomSolvent),
        isSolventVerified: Boolean(context.isSolventVerified),
        solventResolution: context.solventResolution || '',
        solventCasNumber: context.solventCasNumber || '',
        solventMolecularFormula: context.solventMolecularFormula || '',
    }
}

function generateCacheKey(chemicals: DisposalGuideChemicalInput[]): string {
    // Determine a stable key: sort the chemicals array deterministically
    const sorted = [...chemicals].map(c => ({
        name: c.name || '',
        casNumber: c.casNumber || '',
        molecularFormula: c.molecularFormula || '',
        category: c.category || '',
        solutionContext: normalizeSolutionContext(c.solutionContext),
    })).sort((a, b) => {
        const aStr = `${a.name}|${a.casNumber}|${a.molecularFormula}|${a.category}|${JSON.stringify(a.solutionContext)}`
        const bStr = `${b.name}|${b.casNumber}|${b.molecularFormula}|${b.category}|${JSON.stringify(b.solutionContext)}`
        return aStr.localeCompare(bStr)
    });
    return JSON.stringify(sorted);
}

export async function getAIDisposalGuide(
    chemicals: DisposalGuideChemicalInput[],
    context?: {
        sourceScreen?: string
        triggerSource?: string
        metadata?: Record<string, unknown>
    }
): Promise<DisposalGuideResult> {
    const cacheKey = generateCacheKey(chemicals);
    let responseSource: 'cache' | 'ai' = 'ai';

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
            responseSource = 'cache';
            const cachedResult = data.response_data as DisposalGuideResult;
            void analyticsService.trackAIDisposalGuideView({
                chemicals,
                sourceScreen: context?.sourceScreen || 'unknown',
                triggerSource: context?.triggerSource || 'user_request',
                metadata: {
                    ...context?.metadata,
                    cache_key: cacheKey,
                    response_source: responseSource,
                },
            });
            return cachedResult;
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

    void analyticsService.trackAIDisposalGuideView({
        chemicals,
        sourceScreen: context?.sourceScreen || 'unknown',
        triggerSource: context?.triggerSource || 'user_request',
        metadata: {
            ...context?.metadata,
            cache_key: cacheKey,
            response_source: responseSource,
        },
    });

    return result;
}
