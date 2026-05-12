import { postJson } from './internalApi'
import { analyticsService } from './analyticsService'
import type { SolutionContext } from '../types'

export interface DisposalGuideResult {
    guide: string
    responseSource?: 'cache' | 'ai'
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

    console.log('[Gemini Disposal Guide] Requesting disposal guide...');
    const result = await postJson<DisposalGuideResult>('/api/gemini/disposal-guide', { chemicals });

    void analyticsService.trackAIDisposalGuideView({
        chemicals,
        sourceScreen: context?.sourceScreen || 'unknown',
        triggerSource: context?.triggerSource || 'user_request',
        metadata: {
            ...context?.metadata,
            cache_key: cacheKey,
            response_source: result.responseSource || 'ai',
        },
    });

    return result;
}
