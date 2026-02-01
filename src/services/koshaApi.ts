import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';


const BASE_URL = '/api/kosha';
const SERVICE_KEY = import.meta.env.VITE_KOSHA_API_KEY;

// KOSHA API Types (Internal)
import type { MsdsSection } from '../types';
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
 * Fetches Physicochemical properties (specifically pH) from KOSHA API
 * Endpoint: /chemdetail09 (Physical/Chemical Properties)
 */
export const fetchKoshaPH = async (chemId: number | string): Promise<number | undefined> => {
    try {
        // KOSHA API requires 6-digit chemId string (e.g. "001034")
        const paddedId = String(chemId).padStart(6, '0');
        console.log(`[KOSHA] Fetching PH for chemId: ${paddedId} (Original: ${chemId})`);

        const res = await axios.get(`${BASE_URL}/chemdetail09`, {
            params: {
                chemId: paddedId,
                serviceKey: SERVICE_KEY
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
                // Parse pH from string like "3.5 (at 20C)" or "7"
                // Simple regex to grab the first float number
                const match = String(phItem.itemDetail).match(/(-?[\d.]+)/);
                if (match) {
                    const val = parseFloat(match[1]);
                    console.log(`[KOSHA] Successfully parsed pH: ${val} from "${phItem.itemDetail}"`);
                    return val;
                } else {
                    console.warn(`[KOSHA] Failed to regex match pH from details: "${phItem.itemDetail}"`);
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
        const searchRes = await axios.get(`${BASE_URL}/chemlist`, {
            params: {
                searchWrd: keyword,
                searchCnd: 0, // 0 = Korean Name
                serviceKey: SERVICE_KEY
            }
        });

        const searchObj = parser.parse(searchRes.data);
        const items = searchObj?.response?.body?.items?.item;

        if (!items) {
            console.warn('[KOSHA] No results found.');
            return null;
        }

        // Handle single item vs array logic from XML parser
        const firstMatch: KoshaSearchItem = Array.isArray(items) ? items[0] : items;

        // Debugging: Log the structure to see correct keys
        console.log('[KOSHA] First Match:', firstMatch);

        const { chemId, chemNameKor, casNo } = firstMatch;

        if (!chemId || !casNo) return null;

        console.log(`[KOSHA] Resolved: ${chemNameKor} -> CAS: ${casNo}`);

        return {
            casNo: String(casNo).trim(),
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
 * Resolves a CAS No to KOSHA chemId
 */
export const resolveCasChemical = async (casNo: string): Promise<{ chemId: number } | null> => {
    try {
        console.log(`[KOSHA] Resolving CAS: ${casNo}`);

        // Search for Chemical by CAS
        const searchRes = await axios.get(`${BASE_URL}/chemlist`, {
            params: {
                searchWrd: casNo,
                searchCnd: 1, // 1 = CAS No (Confirmed by doc)
                serviceKey: SERVICE_KEY
            }
        });

        const searchObj = parser.parse(searchRes.data);
        const items = searchObj?.response?.body?.items?.item;

        if (!items) {
            console.warn('[KOSHA] No results found for CAS.');
            return null;
        }

        const firstMatch: KoshaSearchItem = Array.isArray(items) ? items[0] : items;
        const { chemId } = firstMatch;

        if (!chemId) return null;

        return { chemId: Number(chemId) };

    } catch (error) {
        console.error('[KOSHA] CAS Resolve Error:', error);
        return null;
    }
};

// --- MSDS Full Fetching ---

/**
 * Fetches all MSDS sections (1-16) from KOSHA API
 * This is a heavy operation, so should only be called on user request.
 */
export const fetchKoshaMsds = async (chemId: number): Promise<MsdsSection[]> => {
    const paddedId = String(chemId).padStart(6, '0');
    console.log(`[KOSHA] Fetching Full MSDS for: ${paddedId}`);

    // Define section names (approximately)
    const sectionNames = [
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

    // Create array of promises for 16 sections
    const promises = Array.from({ length: 16 }, (_, i) => {
        const detailNum = String(i + 1).padStart(2, '0'); // 01, 02, ... 16
        return axios.get(`${BASE_URL}/chemdetail${detailNum}`, {
            params: {
                chemId: paddedId,
                serviceKey: SERVICE_KEY
            }
        }).then(res => ({ idx: i, data: res.data })).catch(e => ({ idx: i, error: e }));
    });

    const results = await Promise.all(promises);

    const sections: MsdsSection[] = [];

    results.forEach((res: any) => {
        if (res.error) {
            console.warn(`[KOSHA] Failed section ${res.idx + 1}`);
            return;
        }

        try {
            const parsed = parser.parse(res.data);
            const items = parsed?.response?.body?.items?.item;

            if (!items) return;

            const list = Array.isArray(items) ? items : [items];

            // Map items to label/value
            const content = list.map((item: any) => ({
                label: item.msdsItemNameKor || 'Unknown',
                value: item.itemDetail || '자료없음'
            }));

            if (content.length > 0) {
                sections.push({
                    title: sectionNames[res.idx] || `Section ${res.idx + 1}`,
                    content: content
                });
            }

        } catch (e) {
            console.warn(`[KOSHA] Parse error section ${res.idx + 1}`, e);
        }
    });

    // Sort by original index to ensure order
    // But since we pushed in loop of results which depends on promise resolution order? No Promise.all preserves order of results array.
    // Wait, Promise.all returns results in order.
    // But I pushed to sections inside forEach which iterates the results array. So it is ordered.
    // Let's just make sure empty sections are handled.

    return sections;
};;
