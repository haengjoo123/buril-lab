import type { Chemical } from '../types';
import { fetchChemicalInfo } from './pubchemApi';
import { resolveKoreanChemical, resolveCasChemical, fetchKoshaPH } from './koshaApi';
import { resolveWikiCas } from './wikiApi';

/**
 * Unified search function that delegates to the appropriate API based on input language.
 * - Korean input -> Resolve CAS via KOSHA -> Setup PubChem search via CAS
 * - English/Other input -> PubChem API
 */

// KOSHA API may be missing exact names for very common chemicals or use completely different variants.
// We map common Korean names to their CAS numbers as a fallback.
const KOREAN_MANUAL_SYNONYMS: Record<string, string> = {
    '구연산': '77-92-9', // Citric acid
    '비타민C': '50-81-7', // Ascorbic acid
    '아스피린': '50-78-2', // Aspirin
    '아세톤': '67-64-1', // Acetone (often just "아세톤" in KOSHA, but ensuring safety)
};

export const searchChemical = async (query: string): Promise<Chemical | null> => {
    if (!query.trim()) return null;

    const trimmedQuery = query.trim();

    // CAS Number pattern detection (e.g., 68990-09-0)
    const casPattern = /^\d{2,7}-\d{2}-\d$/;
    const isCasNumber = casPattern.test(trimmedQuery);

    if (isCasNumber) {
        console.log(`[Search] CAS Number detected: ${trimmedQuery}`);

        // Try PubChem (name endpoint handles many CAS as synonyms) and KOSHA CAS search in parallel
        const [pubchemResult, koshaResolved] = await Promise.all([
            fetchChemicalInfo(trimmedQuery),
            resolveCasChemical(trimmedQuery)
        ]);

        if (pubchemResult) {
            let finalProps = pubchemResult.properties || { isOrganic: false, isHalogenated: false };

            if (koshaResolved?.chemId) {
                try {
                    const koshaPh = await fetchKoshaPH(koshaResolved.chemId);
                    if (koshaPh !== undefined && finalProps.ph === undefined) {
                        finalProps = { ...finalProps, ph: koshaPh };
                    }
                } catch (e) {
                    console.warn('[Search] Failed to fetch pH from KOSHA:', e);
                }
            }

            const displayName = koshaResolved?.nameKo
                ? `${koshaResolved.nameKo} (${pubchemResult.name})`
                : pubchemResult.name;

            return {
                ...pubchemResult,
                name: displayName,
                properties: finalProps,
                koshaId: koshaResolved?.chemId
            };
        }

        // PubChem name search failed for this CAS - use KOSHA data if available
        if (koshaResolved?.chemId) {
            console.log(`[Search] PubChem failed for CAS ${trimmedQuery}, using KOSHA data (chemId: ${koshaResolved.chemId})`);
            const koshaPh = await fetchKoshaPH(koshaResolved.chemId).catch(() => undefined);

            return {
                id: String(koshaResolved.chemId),
                name: koshaResolved.nameKo || trimmedQuery,
                casNumber: trimmedQuery,
                molecularFormula: '',
                molecularWeight: 0,
                properties: {
                    isOrganic: false,
                    isHalogenated: false,
                    ph: koshaPh
                },
                koshaId: koshaResolved.chemId
            };
        }

        console.warn(`[Search] CAS ${trimmedQuery} not found in PubChem or KOSHA`);
        return null;
    }

    // Regex to detect Korean characters
    const hasKorean = /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(query);

    if (hasKorean) {
        let casToSearch: string | null = null;
        let koshaId: number | undefined = undefined;
        let finalNameKo: string | undefined = undefined;

        // 0. Manual Check
        if (KOREAN_MANUAL_SYNONYMS[trimmedQuery]) {
            casToSearch = KOREAN_MANUAL_SYNONYMS[trimmedQuery];
            finalNameKo = trimmedQuery;
            console.log(`[Search] Match found in local synonyms: '${trimmedQuery}' -> ${casToSearch}`);
            // Let's resolve koshaId since we skipped KOSHA search
            const koshaResolved = await resolveCasChemical(casToSearch).catch(() => null);
            if (koshaResolved?.chemId) {
                koshaId = koshaResolved.chemId;
            }
        } 
        
        // 1. Resolve Korean Name to CAS via KOSHA
        if (!casToSearch) {
            const resolved = await resolveKoreanChemical(trimmedQuery);
            if (resolved && resolved.casNo) {
                casToSearch = resolved.casNo;
                koshaId = resolved.chemId;
                finalNameKo = resolved.nameKo;
                console.log(`[Search] Resolved '${trimmedQuery}' to CAS ${casToSearch}. Fetching from PubChem...`);
            }
        }

        // 2. Fallback to Wikipedia API if KOSHA didn't have it
        if (!casToSearch) {
            const wikiCas = await resolveWikiCas(trimmedQuery);
            if (wikiCas) {
                casToSearch = wikiCas;
                finalNameKo = trimmedQuery;
                console.log(`[Search] Wikipedia resolved '${trimmedQuery}' to CAS ${casToSearch}`);
                // Try resolving KOSHA ID with this new CAS
                const koshaResolved = await resolveCasChemical(casToSearch).catch(() => null);
                if (koshaResolved?.chemId) {
                    koshaId = koshaResolved.chemId;
                }
            }
        }

        if (casToSearch) {
            // 3. Parallel Fetch: PubChem Info + KOSHA pH
            const [pubchemResult, koshaPh] = await Promise.all([
                fetchChemicalInfo(casToSearch),
                // Only fetch pH if we have a chemId
                koshaId ? fetchKoshaPH(koshaId) : Promise.resolve(undefined)
            ]);

            if (pubchemResult) {
                const baseProps = pubchemResult.properties || { isOrganic: false, isHalogenated: false };
                const mergedProps = {
                    ...baseProps,
                    ph: koshaPh !== undefined ? koshaPh : baseProps.ph
                };

                return {
                    ...pubchemResult,
                    name: finalNameKo ? `${finalNameKo} (${pubchemResult.name})` : pubchemResult.name, // e.g., "벤젠 (Benzene)"
                    properties: mergedProps,
                    koshaId: koshaId
                };
            }
        }
        // Fallback: If PubChem fails or KOSHA fails, we return null
        return null;

    } else {
        // English/Other input
        console.log(`[Search] Primary: PubChem for '${query}'`);
        const pubchemResult = await fetchChemicalInfo(query);

        if (pubchemResult) {
            let finalProps = pubchemResult.properties || { isOrganic: false, isHalogenated: false };
            let koshaId: number | undefined;

            // If pH is missing, try supplemental fetch from KOSHA using CAS
            // Also try to resolve KOSHA ID for MSDS button
            if (pubchemResult.casNumber) {
                // Always try to find KOSHA ID if we have CAS? 
                // It might be useful for the MSDS button even if pH is found.
                // But let's only do it if we are already doing it for pH or if we want to support KOSHA MSDS for english searches.
                // The user wants "MSDS 확인" button. If they search in English, having KOSHA MSDS (in Korean) might be useful for Korean users using English names.
                // Let's resolve it.
                try {
                    const koshaResolved = await resolveCasChemical(pubchemResult.casNumber);
                    if (koshaResolved?.chemId) {
                        koshaId = koshaResolved.chemId;
                        const supplementalPh = await fetchKoshaPH(koshaResolved.chemId);
                        if (supplementalPh !== undefined && finalProps.ph === undefined) {
                            console.log(`[Search] Supplementary pH found via KOSHA: ${supplementalPh}`);
                            finalProps = { ...finalProps, ph: supplementalPh };
                        }
                    }
                } catch (e) {
                    console.warn('[Search] Failed to fetch supplementary info from KOSHA:', e);
                }
            }

            return {
                ...pubchemResult,
                properties: finalProps,
                koshaId: koshaId
            };
        }

        // Fallback: Check KOSHA (It might handle distinct spellings or synonyms e.g. "Dichlorodifluoromethan")
        console.log(`[Search] Primary failed. Fallback: Resolving '${query}' via KOSHA...`);
        const resolved = await resolveKoreanChemical(query);

        if (resolved && resolved.casNo) {
            console.log(`[Search] Fallback Resolved '${query}' to CAS ${resolved.casNo}. Fetching from PubChem...`);

            // Parallel Fetch for fallback too
            const [fallbackResult, koshaPh] = await Promise.all([
                fetchChemicalInfo(resolved.casNo),
                resolved.chemId ? fetchKoshaPH(resolved.chemId) : Promise.resolve(undefined)
            ]);

            if (fallbackResult) {
                const baseProps = fallbackResult.properties || { isOrganic: false, isHalogenated: false };
                const mergedProps = {
                    ...baseProps,
                    ph: koshaPh !== undefined ? koshaPh : baseProps.ph
                };

                return {
                    ...fallbackResult,
                    properties: mergedProps,
                    koshaId: resolved.chemId
                    // Optional: Append original query if significantly different, or keep standard name
                    // For english typos, keeping the official English name is usually better.
                };
            }
        }

        return null;
    }
};
