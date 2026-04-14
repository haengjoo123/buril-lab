import { XMLParser } from 'fast-xml-parser';

import type {
    CasEvidenceCode,
    CasResolveCandidateOption,
    CasResolveItemInput,
    CasResolveItemResult,
    CasSuggestionConfidence,
    CasSuggestionSource,
} from './casSuggestionService';
import { getInternalApiUrl } from './apiUrl';

type Candidate = {
    casNumber: string;
    canonicalName?: string;
    localizedName?: string;
    matchedAlias?: string;
    evidence: CasEvidenceCode[];
    sources: CasSuggestionSource[];
    confidence: CasSuggestionConfidence;
};

type SourceLookup =
    | { kind: 'none' }
    | { kind: 'ambiguous'; candidates: Candidate[] }
    | { kind: 'match'; candidate: Candidate };

const PUBCHEM_BASE_URL = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
const CAS_PATTERN = /^\d{2,7}-\d{2}-\d$/;
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
});

function normalizeName(value?: string | null): string {
    return (value || '')
        .normalize('NFKC')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[()[\]{}]/g, ' ')
        .replace(/[.,]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function shouldSkipName(rawName: string): boolean {
    const normalized = normalizeName(rawName);
    if (!normalized) return true;

    const compact = normalized.replace(/\s+/g, '');
    if (compact.length <= 2) return true;

    if (/[+,/]/.test(rawName)) return true;

    const skipPatterns = [
        /\bbuffer\b/i,
        /\bmedia\b/i,
        /\bsolution\b/i,
        /\bmixture\b/i,
        /\bmix\b/i,
        /\bserum\b/i,
        /\bagar\b/i,
        /\bbroth\b/i,
        /\bpbs\b/i,
        /\bdmem\b/i,
        /\brpmi\b/i,
        /\btbe\b/i,
        /\btae\b/i,
        /\btris[- ]?hcl\b/i,
        /\b(?:lb|m9)\b/i,
        /\b\d+(?:\.\d+)?\s*(?:m|n|x|%)\b/i,
        /\b\d+(?:\.\d+)?\s*(?:mg\/ml|g\/l|mol\/l)\b/i,
    ];

    return skipPatterns.some((pattern) => pattern.test(rawName));
}

function passesCasChecksum(casNumber: string): boolean {
    const [left, middle, right] = casNumber.split('-');
    if (!left || !middle || !right) return false;

    const digits = `${left}${middle}`.split('').reverse();
    const checksum = Number.parseInt(right, 10);
    if (!Number.isFinite(checksum)) return false;

    const total = digits.reduce((sum, digit, index) => sum + Number.parseInt(digit, 10) * (index + 1), 0);
    return total % 10 === checksum;
}

function normalizeCasNumber(value?: string | null): string | null {
    const normalized = (value || '').replace(/\s+/g, '').trim();
    if (!CAS_PATTERN.test(normalized)) return null;
    if (!passesCasChecksum(normalized)) return null;
    return normalized;
}

function unique<T>(values: T[]): T[] {
    return Array.from(new Set(values));
}

function mergeCandidate(base: Candidate, additions: Partial<Candidate>): Candidate {
    return {
        casNumber: additions.casNumber || base.casNumber,
        canonicalName: additions.canonicalName || base.canonicalName,
        localizedName: additions.localizedName || base.localizedName,
        matchedAlias: additions.matchedAlias || base.matchedAlias,
        evidence: unique([...(base.evidence || []), ...(additions.evidence || [])]),
        sources: unique([...(base.sources || []), ...(additions.sources || [])]),
        confidence: additions.confidence || base.confidence,
    };
}

function toCandidateOptions(candidates: Candidate[]): CasResolveCandidateOption[] {
    const seen = new Set<string>();
    const options: CasResolveCandidateOption[] = [];

    for (const candidate of candidates) {
        const key = `${candidate.casNumber}|${candidate.canonicalName || ''}|${candidate.localizedName || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        options.push({
            casNumber: candidate.casNumber,
            canonicalName: candidate.canonicalName,
            localizedName: candidate.localizedName,
            matchedAlias: candidate.matchedAlias,
            confidence: candidate.confidence,
        });
        if (options.length >= 3) break;
    }

    return options;
}

async function fetchJson<T>(url: string): Promise<T | null> {
    const response = await fetch(url, {
        headers: {
            Accept: 'application/json',
        },
    });

    if (!response.ok) return null;
    return await response.json() as T;
}

async function fetchText(url: string): Promise<string | null> {
    const response = await fetch(url, {
        headers: {
            Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
        },
    });

    if (!response.ok) return null;
    return await response.text();
}

async function fetchPubChemRecordByLookup(lookup: string): Promise<{
    title?: string;
    iupacName?: string;
    synonyms: string[];
    casNumbers: string[];
} | null> {
    const propertyUrl = `${PUBCHEM_BASE_URL}/compound/name/${encodeURIComponent(lookup)}/property/Title,IUPACName/JSON`;
    const propertyResponse = await fetchJson<{
        PropertyTable?: {
            Properties?: Array<{
                CID?: number;
                Title?: string;
                IUPACName?: string;
            }>;
        };
    }>(propertyUrl);

    const property = propertyResponse?.PropertyTable?.Properties?.[0];
    const cid = property?.CID;
    if (!cid) return null;

    const synonymsResponse = await fetchJson<{
        InformationList?: {
            Information?: Array<{
                Synonym?: string[];
            }>;
        };
    }>(`${PUBCHEM_BASE_URL}/compound/cid/${cid}/synonyms/JSON`);

    const synonyms = synonymsResponse?.InformationList?.Information?.[0]?.Synonym || [];
    const casNumbers = unique(
        synonyms
            .map((item) => normalizeCasNumber(item))
            .filter((item): item is string => Boolean(item)),
    );

    return {
        title: property?.Title?.trim(),
        iupacName: property?.IUPACName?.trim(),
        synonyms,
        casNumbers,
    };
}

async function searchPubChemExact(query: string): Promise<SourceLookup> {
    const record = await fetchPubChemRecordByLookup(query);
    if (!record) return { kind: 'none' };

    if (record.casNumbers.length === 0) return { kind: 'none' };
    if (record.casNumbers.length > 1) {
        return {
            kind: 'ambiguous',
            candidates: record.casNumbers.slice(0, 3).map((casNumber) => ({
                casNumber,
                canonicalName: record.title || record.iupacName || query.trim(),
                evidence: [],
                sources: ['PubChem'],
                confidence: 'medium',
            })),
        };
    }

    const normalizedQuery = normalizeName(query);
    const matchedCanonical = record.title && normalizeName(record.title) === normalizedQuery;
    const matchedIupac = record.iupacName && normalizeName(record.iupacName) === normalizedQuery;
    const matchedSynonym = record.synonyms.find((synonym) => normalizeName(synonym) === normalizedQuery);

    let evidence: CasEvidenceCode | null = null;
    if (matchedCanonical) evidence = 'pubchem_canonical_exact_match';
    else if (matchedIupac) evidence = 'pubchem_iupac_exact_match';
    else if (matchedSynonym) evidence = 'pubchem_synonym_exact_match';

    if (!evidence) {
        return { kind: 'none' };
    }

    return {
        kind: 'match',
        candidate: {
            casNumber: record.casNumbers[0],
            canonicalName: record.title || record.iupacName || query.trim(),
            matchedAlias: evidence === 'pubchem_synonym_exact_match' ? matchedSynonym : undefined,
            evidence: [evidence],
            sources: ['PubChem'],
            confidence: 'medium',
        },
    };
}

async function enrichCandidateWithKoshaName(candidate: Candidate): Promise<Candidate> {
    const params = new URLSearchParams({
        searchWrd: candidate.casNumber,
        searchCnd: '1',
        pageNo: '1',
        numOfRows: '3',
    });

    const xmlText = await fetchText(getInternalApiUrl(`/api/kosha/chemlist?${params.toString()}`));
    if (!xmlText) return candidate;

    const parsed = parser.parse(xmlText) as {
        response?: { body?: { items?: { item?: { chemNameKor?: string; casNo?: string } | Array<{ chemNameKor?: string; casNo?: string }> } } };
    };

    const items = parsed.response?.body?.items?.item;
    const list = Array.isArray(items) ? items : (items ? [items] : []);
    const matched = list.find((item) => normalizeCasNumber(String(item.casNo || '')) === candidate.casNumber);
    const localizedName = String(matched?.chemNameKor || '').trim();

    if (!localizedName) {
        return candidate;
    }

    return mergeCandidate(candidate, {
        localizedName,
        evidence: ['cas_consensus'],
        sources: ['KOSHA'],
        confidence: 'high',
    });
}

function toResult(item: CasResolveItemInput, result: Omit<CasResolveItemResult, 'id'>): CasResolveItemResult {
    return {
        id: item.id,
        ...result,
    };
}

async function resolveSingleFallback(item: CasResolveItemInput): Promise<CasResolveItemResult> {
    const matchedInput = item.inputName.trim();

    if (!matchedInput) {
        return toResult(item, {
            status: 'skipped',
            matchedInput,
            evidence: [],
            sources: [],
            confidence: 'low',
            reason: 'missing_name',
        });
    }

    if (shouldSkipName(matchedInput)) {
        return toResult(item, {
            status: 'skipped',
            matchedInput,
            evidence: [],
            sources: [],
            confidence: 'low',
            reason: 'unsupported_name_pattern',
        });
    }

    const pubchemLookup = await searchPubChemExact(matchedInput);
    if (pubchemLookup.kind === 'ambiguous') {
        return toResult(item, {
            status: 'ambiguous',
            matchedInput,
            alternatives: toCandidateOptions(pubchemLookup.candidates),
            evidence: [],
            sources: [],
            confidence: 'low',
            reason: 'multiple_candidates',
        });
    }

    if (pubchemLookup.kind === 'match') {
        const enriched = await enrichCandidateWithKoshaName(pubchemLookup.candidate);
        return toResult(item, {
            status: 'match',
            matchedInput,
            casNumber: enriched.casNumber,
            canonicalName: enriched.canonicalName,
            localizedName: enriched.localizedName,
            matchedAlias: enriched.matchedAlias,
            evidence: enriched.evidence,
            sources: enriched.sources,
            confidence: enriched.confidence,
            reason: enriched.confidence === 'low' ? 'low_confidence' : undefined,
        });
    }

    return toResult(item, {
        status: 'no_match',
        matchedInput,
        evidence: [],
        sources: [],
        confidence: 'low',
        reason: 'no_exact_match',
    });
}

export async function resolveCasSuggestionsFallback(items: CasResolveItemInput[]): Promise<CasResolveItemResult[]> {
    return await Promise.all(items.map((item) => resolveSingleFallback(item)));
}
