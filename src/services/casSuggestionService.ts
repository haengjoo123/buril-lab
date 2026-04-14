import { postJson } from './internalApi';

export type CasResolveStatus = 'match' | 'no_match' | 'ambiguous' | 'conflict' | 'skipped';
export type CasSuggestionConfidence = 'high' | 'medium' | 'low';
export type CasEvidenceCode =
    | 'kosha_exact_name_match'
    | 'kosha_alias_exact_match'
    | 'pubchem_canonical_exact_match'
    | 'pubchem_iupac_exact_match'
    | 'pubchem_synonym_exact_match'
    | 'wikidata_title_exact_match'
    | 'cas_consensus';
export type CasSuggestionSource = 'KOSHA' | 'PubChem' | 'Wikidata';
export type CasReasonCode =
    | 'missing_name'
    | 'unsupported_name_pattern'
    | 'no_exact_match'
    | 'multiple_candidates'
    | 'source_conflict'
    | 'low_confidence';

export interface CasResolveCandidateOption {
    casNumber: string;
    canonicalName?: string;
    localizedName?: string;
    matchedAlias?: string;
    confidence: CasSuggestionConfidence;
}

export interface CasResolveItemInput {
    id: string;
    inputName: string;
    sourceType: string;
    brand?: string;
    productNumber?: string;
    capacity?: string;
}

export interface CasResolveItemResult {
    id: string;
    status: CasResolveStatus;
    casNumber?: string;
    canonicalName?: string;
    localizedName?: string;
    matchedInput: string;
    matchedAlias?: string;
    alternatives?: CasResolveCandidateOption[];
    evidence: CasEvidenceCode[];
    sources: CasSuggestionSource[];
    confidence: CasSuggestionConfidence;
    reason?: CasReasonCode;
}

interface CasResolveResponse {
    items: CasResolveItemResult[];
}

const RESOLVE_BATCH_SIZE = 25;

async function resolveCasSuggestionBatch(items: CasResolveItemInput[]): Promise<CasResolveItemResult[]> {
    if (items.length === 0) return [];

    try {
        const response = await postJson<CasResolveResponse>('/api/reagents/cas-resolve', { items });
        return response.items || [];
    } catch {
        const { resolveCasSuggestionsFallback } = await import('./casSuggestionFallback');
        return await resolveCasSuggestionsFallback(items);
    }
}

export async function resolveCasSuggestions(items: CasResolveItemInput[]): Promise<CasResolveItemResult[]> {
    if (items.length === 0) return [];

    const allResults: CasResolveItemResult[] = [];

    for (let index = 0; index < items.length; index += RESOLVE_BATCH_SIZE) {
        const batch = items.slice(index, index + RESOLVE_BATCH_SIZE);
        const results = await resolveCasSuggestionBatch(batch);
        allResults.push(...results);
    }

    return allResults;
}

export async function resolveSingleCasSuggestion(item: CasResolveItemInput): Promise<CasResolveItemResult | null> {
    const [result] = await resolveCasSuggestions([item]);
    return result || null;
}
