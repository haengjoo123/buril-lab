import axios from 'axios';
import { normalizeCasNumber } from '../utils/casNumber';

/**
 * Wikipedia/Wikidata를 활용해 한글 물질명(관용명, 이명)으로부터 CAS 번호를 자동으로 조회합니다.
 * KOSHA나 PubChem에서 조회가 실패하는 경우 최종 Fallback으로 사용합니다.
 */
export const resolveWikiCas = async (keyword: string): Promise<string | null> => {
    try {
        console.log(`[Wiki] Resolving CAS for: ${keyword}`);
        
        // 1. Wikipedia API: Resolve title (following redirects) -> Get Wikidata Item ID
        const queryUrl = `https://ko.wikipedia.org/w/api.php?action=query&prop=pageprops&titles=${encodeURIComponent(keyword)}&redirects=1&format=json&origin=*`;
        const res = await axios.get(queryUrl);
        
        const pages = res.data?.query?.pages;
        if (!pages) return null;
        
        const pageId = Object.keys(pages)[0];
        if (pageId === '-1') return null; // Page not found
        
        const wikibaseItem = pages[pageId].pageprops?.wikibase_item;
        if (!wikibaseItem) return null;
        
        console.log(`[Wiki] Found Wikidata Item: ${wikibaseItem}`);

        // 2. Wikidata API: Get CAS Number property (P231)
        const wikidataUrl = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${wikibaseItem}&property=P231&format=json&origin=*`;
        const wdRes = await axios.get(wikidataUrl);
        
        const claims = wdRes.data?.claims?.P231;
        if (!claims || claims.length === 0) return null;
        
        const casNo = claims[0]?.mainsnak?.datavalue?.value;
        const result = typeof casNo === 'string' ? normalizeCasNumber(casNo) : null;
        
        if (result) {
            console.log(`[Wiki] CAS resolved: ${keyword} -> ${result}`);
        }
        return result;
        
    } catch (e) {
        console.warn('[Wiki] Failed to resolve CAS from Wikipedia:', e);
        return null;
    }
};
