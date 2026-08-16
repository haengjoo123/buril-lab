/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { getInternalApiUrl } from './apiUrl';
import { normalizeCasNumber } from '../utils/casNumber';


const getKoshaBaseUrl = () => getInternalApiUrl('/api/kosha');

// KOSHA API Types (Internal)
import type { MsdsSection } from '../types';

const KOSHA_MSDS_SECTION_COUNT = 16;

interface KoshaMsdsSectionResponse {
    sectionNumber: number;
    status: number;
    body: string;
}

interface KoshaMsdsApiResponse {
    sections?: KoshaMsdsSectionResponse[];
    missingSections?: number[];
}

export interface KoshaMsdsResult {
    sections: MsdsSection[];
    missingSections: number[];
}

interface CachedMsdsResult {
    result: KoshaMsdsResult;
    expiresAt: number;
}

const MSDS_CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;
const msdsResultCache = new Map<number, CachedMsdsResult>();
const msdsPendingRequests = new Map<number, Promise<KoshaMsdsResult>>();
// Reference: Image 4 (getChemList response) - Actual response has chemNameKor
interface KoshaSearchItem {
    chemId: number;
    chemNameKor: string;
    casNo: string;
    enNo?: string;
    keNo?: string;
    unNo?: string;
}

// XML Parser Instance
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_"
});

/**
 * Parse only the pH value from a KOSHA Section 9 detail string. Conditions
 * such as temperature, concentration and molarity are removed first so their
 * numbers can never be mistaken for the pH of the reference material.
 */
export const parseKoshaPhDetail = (detail?: string | null): number | undefined => {
    const normalized = String(detail ?? '').normalize('NFKC').trim();
    if (!normalized) return undefined;

    const explicitPh = normalized.match(/\bpH\s*(?:[:=]|is|는|은)?\s*(-?\d+(?:\.\d+)?)/i);
    if (explicitPh) {
        const value = Number(explicitPh[1]);
        return Number.isFinite(value) && value >= 0 && value <= 14 ? value : undefined;
    }

    const withoutConditions = normalized
        .replace(/-?\d+(?:\.\d+)?\s*(?:°\s*[CF]|℃|℉)/gi, ' ')
        .replace(/-?\d+(?:\.\d+)?\s*%/g, ' ')
        .replace(/-?\d+(?:\.\d+)?\s*(?:mM|M|mol\s*\/?\s*L|mg\s*\/?\s*mL)\b/gi, ' ')
        .replace(/\([^)]*(?:°\s*[CF]|℃|℉|%|mM|mol\s*\/?\s*L)[^)]*\)/gi, ' ');
    const candidates = withoutConditions.match(/-?\d+(?:\.\d+)?/g) ?? [];
    const values = candidates
        .map(Number)
        .filter((value) => Number.isFinite(value) && value >= 0 && value <= 14);

    return values.length === 1 ? values[0] : undefined;
};

/**
 * Fetches Physicochemical properties (specifically pH) from KOSHA API
 * Endpoint: /chemdetail09 (Physical/Chemical Properties)
 */
export const fetchKoshaPH = async (chemId: number | string): Promise<number | undefined> => {
    try {
        // KOSHA API requires 6-digit chemId string (e.g. "001034")
        const paddedId = String(chemId).padStart(6, '0');
        console.log(`[KOSHA] Fetching PH for chemId: ${paddedId} (Original: ${chemId})`);

        const res = await axios.get(`${getKoshaBaseUrl()}/chemdetail09`, {
            params: {
                chemId: paddedId,
            }
        });

        const data = parser.parse(res.data);
        const items = data?.response?.body?.items?.item;

        if (!items) {
            console.warn('[KOSHA] No items returned for physicochemical properties.');
            return undefined;
        }

        // XML parser might return single object if only one item, or array
        const list = Array.isArray(items) ? items : [items];

        console.log('[KOSHA] Physicochemical Items:', list);

        // Find the item corresponding to pH
        // Based on doc: msdsItemNameKor could be "라.pH" or similar.
        const phItem = list.find((item: any) =>
            item.msdsItemNameKor && item.msdsItemNameKor.includes('pH')
        );

        if (phItem) {
            console.log(`[KOSHA] Found pH Item:`, phItem);

            if (phItem.itemDetail) {
                const parsedPh = parseKoshaPhDetail(String(phItem.itemDetail));
                if (parsedPh !== undefined) {
                    console.log(`[KOSHA] Successfully parsed pH: ${parsedPh} from "${phItem.itemDetail}"`);
                    return parsedPh;
                } else {
                    console.warn(`[KOSHA] Could not isolate a valid pH from details: "${phItem.itemDetail}"`);
                }
            } else {
                console.warn('[KOSHA] pH item found but has no details.');
            }
        } else {
            console.warn('[KOSHA] pH item NOT found in list.');
        }

        return undefined;

    } catch (e) {
        console.warn('[KOSHA] Failed to fetch PH:', e);
        return undefined;
    }
};

/**
 * Resolves a Korean chemical name to CAS No and English Name using KOSHA MSDS API.
 * Does NOT fetch details anymore, as we relay to PubChem.
 */
export const resolveKoreanChemical = async (keyword: string): Promise<{ casNo: string, nameKo: string, nameEn: string, chemId: number } | null> => {
    try {
        console.log(`[KOSHA] Resolving: ${keyword}`);

        // 1. Search for Chemical
        const searchRes = await axios.get(`${getKoshaBaseUrl()}/chemlist`, {
            params: {
                searchWrd: keyword,
                searchCnd: 0, // 0 = Korean Name
            }
        });

        const searchObj = parser.parse(searchRes.data);
        const items = searchObj?.response?.body?.items?.item;

        if (!items) {
            console.warn('[KOSHA] No results found.');
            return null;
        }

        // Handle single item vs array logic from XML parser
        const list: KoshaSearchItem[] = Array.isArray(items) ? items : [items];

        const trimmedKw = keyword.trim();

        // 1. Strict Match: Only accept exact name or exact name inside parens/before parens
        // e.g. "시트르산(구연산)" -> correctly matches "구연산"
        // "구연산리튬" -> fails to match "구연산"
        const bestMatch = list.find(item => {
            const name = item.chemNameKor?.trim() || "";
            if (name === trimmedKw) return true;
            
            const beforeParen = name.split('(')[0].trim();
            const inParenMatch = name.match(/\((.*?)\)/);
            const inParen = inParenMatch ? inParenMatch[1].trim() : '';

            if (beforeParen === trimmedKw) return true;
            if (inParen === trimmedKw || inParen.split(',').map(s => s.trim()).includes(trimmedKw)) return true;
            
            return false;
        });

        // Debugging: Log the structure to see correct keys
        console.log(`[KOSHA] Found ${list.length} partial matches, strict match result:`, bestMatch || 'None');

        if (!bestMatch) {
             console.warn(`[KOSHA] Found results, but no exact match for '${keyword}'. Prevented fallback to unrelated chemicals.`);
             return null;
        }

        const { chemId, chemNameKor, casNo } = bestMatch;
        const normalizedCasNumber = normalizeCasNumber(String(casNo || ''));
        if (!normalizedCasNumber) {
            console.warn(`[KOSHA] Ignored invalid CAS returned for '${keyword}': ${casNo}`);
            return null;
        }

        console.log(`[KOSHA] Resolved: ${chemNameKor} -> CAS: ${casNo}`);

        return {
            casNo: normalizedCasNumber,
            nameKo: chemNameKor || '', // Ensure valid string
            nameEn: '', // KOSHA chemlist does not return English Name. We rely on PubChem for that.
            chemId: Number(chemId)
        };

    } catch (error) {
        console.error('[KOSHA] API Error:', error);
        return null;
    }
};

/**
 * 한글 화학물질명을 자동완성하기 위해 KOSHA chemlist를 조회한다.
 * 일반 검색 API를 재사용하므로 prefix/부분일치 결과를 그대로 노출한다.
 */
export const fetchKoshaSuggestions = async (keyword: string, limit: number = 5): Promise<string[]> => {
    const trimmedKeyword = keyword.trim();

    if (trimmedKeyword.length < 2) {
        return [];
    }

    try {
        const searchRes = await axios.get(`${getKoshaBaseUrl()}/chemlist`, {
            params: {
                searchWrd: trimmedKeyword,
                searchCnd: 0, // 0 = Korean Name
                numOfRows: Math.max(limit * 2, 10),
                pageNo: 1,
            }
        });

        const searchObj = parser.parse(searchRes.data);
        const items = searchObj?.response?.body?.items?.item;

        if (!items) {
            return [];
        }

        const list: KoshaSearchItem[] = Array.isArray(items) ? items : [items];
        const uniqueSuggestions = new Set<string>();

        for (const item of list) {
            const candidate = item.chemNameKor?.trim();

            if (!candidate) {
                continue;
            }

            uniqueSuggestions.add(candidate);

            if (uniqueSuggestions.size >= limit) {
                break;
            }
        }

        return Array.from(uniqueSuggestions);
    } catch (error) {
        console.warn('[KOSHA] Failed to fetch suggestions:', error);
        return [];
    }
};

/**
 * Resolves a CAS No to KOSHA chemId
 */
export const resolveCasChemical = async (casNo: string): Promise<{ chemId: number; nameKo?: string } | null> => {
    try {
        const normalizedCasNumber = normalizeCasNumber(casNo);
        if (!normalizedCasNumber) {
            console.warn(`[KOSHA] Rejected invalid CAS: ${casNo}`);
            return null;
        }

        console.log(`[KOSHA] Resolving CAS: ${normalizedCasNumber}`);

        // Search for Chemical by CAS
        const searchRes = await axios.get(`${getKoshaBaseUrl()}/chemlist`, {
            params: {
                searchWrd: normalizedCasNumber,
                searchCnd: 1, // 1 = CAS No (Confirmed by doc)
            }
        });

        const searchObj = parser.parse(searchRes.data);
        const items = searchObj?.response?.body?.items?.item;

        if (!items) {
            console.warn('[KOSHA] No results found for CAS.');
            return null;
        }

        const list: KoshaSearchItem[] = Array.isArray(items) ? items : [items];
        const exactMatch = list.find((item) => normalizeCasNumber(String(item.casNo || '')) === normalizedCasNumber);
        if (!exactMatch) {
            console.warn(`[KOSHA] Response did not confirm CAS ${normalizedCasNumber}.`);
            return null;
        }
        const { chemId, chemNameKor } = exactMatch;

        if (!chemId) return null;

        console.log(`[KOSHA] CAS Resolved: ${normalizedCasNumber} -> chemId: ${chemId}, name: ${chemNameKor}`);
        return { chemId: Number(chemId), nameKo: chemNameKor || undefined };

    } catch (error) {
        console.error('[KOSHA] CAS Resolve Error:', error);
        return null;
    }
};

// --- MSDS Full Fetching ---

const msdsSectionNames = [
    "1. 화학제품과 회사에 관한 정보",
    "2. 유해성·위험성",
    "3. 구성성분의 명칭 및 함유량",
    "4. 응급조치 요령",
    "5. 폭발·화재시 대처방법",
    "6. 누출 사고시 대처방법",
    "7. 취급 및 저장방법",
    "8. 노출방지 및 개인보호구",
    "9. 물리화학적 특성",
    "10. 안정성 및 반응성",
    "11. 독성에 관한 정보",
    "12. 환경에 미치는 영향",
    "13. 폐기시 주의사항",
    "14. 운송에 필요한 정보",
    "15. 법적 규제현황",
    "16. 그 밖의 참고사항"
];

/**
 * Fetches the KOSHA document through the server-side batch endpoint. This
 * counts as one public API request instead of 16 concurrent browser requests.
 */
export const fetchKoshaMsds = async (chemId: number): Promise<KoshaMsdsResult> => {
    const cachedResult = msdsResultCache.get(chemId);
    if (cachedResult && cachedResult.expiresAt > Date.now()) {
        return cachedResult.result;
    }
    if (cachedResult) {
        msdsResultCache.delete(chemId);
    }

    const pendingRequest = msdsPendingRequests.get(chemId);
    if (pendingRequest) {
        return pendingRequest;
    }

    const request = fetchKoshaMsdsDocument(chemId);
    msdsPendingRequests.set(chemId, request);

    try {
        const result = await request;
        // Keep only complete results in memory so an explicit retry can recover
        // sections that were temporarily unavailable at KOSHA.
        if (result.missingSections.length === 0) {
            msdsResultCache.set(chemId, {
                result,
                expiresAt: Date.now() + MSDS_CLIENT_CACHE_TTL_MS,
            });
        }
        return result;
    } finally {
        msdsPendingRequests.delete(chemId);
    }
};

const fetchKoshaMsdsDocument = async (chemId: number): Promise<KoshaMsdsResult> => {
    const paddedId = String(chemId).padStart(6, '0');
    console.log(`[KOSHA] Fetching Full MSDS for: ${paddedId}`);

    const response = await axios.get<KoshaMsdsApiResponse>(`${getKoshaBaseUrl()}/msds`, {
        params: { chemId: paddedId },
    });
    const responseSections = response.data.sections || [];
    const missingSections = new Set(response.data.missingSections || []);
    const sections: MsdsSection[] = [];

    responseSections.forEach((responseSection) => {
        const sectionNumber = responseSection.sectionNumber;
        if (responseSection.status < 200 || responseSection.status >= 300) {
            console.warn(`[KOSHA] Failed section ${sectionNumber}`);
            missingSections.add(sectionNumber);
            return;
        }

        try {
            const parsed = parser.parse(responseSection.body);
            const items = parsed?.response?.body?.items?.item;

            if (!items) {
                missingSections.add(sectionNumber);
                return;
            }

            const list = Array.isArray(items) ? items : [items];
            const content = list.map((item: any) => ({
                label: item.msdsItemNameKor || 'Unknown',
                value: item.itemDetail || '자료없음'
            }));

            if (content.length > 0) {
                sections.push({
                    title: msdsSectionNames[sectionNumber - 1] || `Section ${sectionNumber}`,
                    content
                });
            } else {
                missingSections.add(sectionNumber);
            }
        } catch (error) {
            console.warn(`[KOSHA] Parse error section ${sectionNumber}`, error);
            missingSections.add(sectionNumber);
        }
    });

    for (let sectionNumber = 1; sectionNumber <= KOSHA_MSDS_SECTION_COUNT; sectionNumber += 1) {
        if (!responseSections.some((section) => section.sectionNumber === sectionNumber)) {
            missingSections.add(sectionNumber);
        }
    }

    return {
        sections,
        missingSections: Array.from(missingSections).sort((a, b) => a - b),
    };
};
