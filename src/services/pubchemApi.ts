/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Chemical, MsdsSection } from '../types';
import { COMMON_CHEMICALS } from '../data/commonChemicals';

/**
 * Fetch autocomplete suggestions for a chemical name from PubChem
 */
export const fetchPubchemSuggestions = async (query: string, limit: number = 5): Promise<string[]> => {
    if (!query || query.trim().length < 2) return [];
    try {
        const url = `https://pubchem.ncbi.nlm.nih.gov/rest/autocomplete/compound/${encodeURIComponent(query.trim())}/json?limit=${limit}`;
        const response = await fetch(url);
        if (!response.ok) return [];
        const data = await response.json();
        return data?.dictionary_terms?.compound || [];
    } catch (e) {
        console.warn('Failed to fetch pubchem suggestions', e);
        return [];
    }
};


const PUBCHEM_BASE_URL = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
const PUBCHEM_VIEW_URL = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound';

/**
 * PUG View 전체 레코드 조회 (heading 없음).
 * 일부 화합물은 GHS/Safety 등 heading별 URL이 404이지만 전체 레코드에는 데이터가 있을 수 있음.
 */
const fetchFullPugView = async (cid: string | number): Promise<any | null> => {
    try {
        const url = `${PUBCHEM_VIEW_URL}/${cid}/JSON`;
        const response = await fetch(url);
        if (!response.ok) return null;
        const data = await response.json();
        return data?.Record ?? null;
    } catch (e) {
        console.warn('[PubChem] Full PUG View fetch failed', e);
        return null;
    }
};

/**
 * 전체 Record에서 GHS(Signal, Hazard Statements, Pictograms) 추출
 */
const parseGHSFromRecord = (record: any): Chemical['ghs'] | undefined => {
    if (!record) return undefined;
    let signal = '';
    const hazardStatements: string[] = [];
    const pictograms: string[] = [];
    const traverse = (node: any) => {
        if (node.Information) {
            for (const info of node.Information) {
                if (info.Name === 'Signal') {
                    signal = info.Value?.StringWithMarkup?.[0]?.String || '';
                }
                if (info.Name === 'GHS Hazard Statements') {
                    if (info.Value?.StringWithMarkup) {
                        info.Value.StringWithMarkup.forEach((s: any) => {
                            if (s.String) hazardStatements.push(s.String);
                        });
                    }
                }
                if (info.Name === 'Pictogram(s)') {
                    if (info.Value?.StringWithMarkup) {
                        info.Value.StringWithMarkup.forEach((s: any) => {
                            if (s.Markup) {
                                s.Markup.forEach((m: any) => {
                                    if (m.URL) pictograms.push(m.URL);
                                });
                            }
                        });
                    }
                }
            }
        }
        if (node.Section) node.Section.forEach(traverse);
    };
    traverse(record);
    if (!signal && hazardStatements.length === 0 && pictograms.length === 0) return undefined;
    return {
        signal: signal || 'Warning',
        hazardStatements: [...new Set(hazardStatements)],
        pictograms: [...new Set(pictograms)]
    };
};

/**
 * Fetch Synonyms to find CAS Number
 */
const fetchSynonyms = async (cid: string | number): Promise<string[]> => {
    try {
        const url = `${PUBCHEM_BASE_URL}/compound/cid/${cid}/synonyms/JSON`;
        const response = await fetch(url);
        if (!response.ok) return [];

        const data = await response.json();
        return data.InformationList?.Information?.[0]?.Synonym || [];
    } catch (e) {
        console.warn('Failed to fetch synonyms', e);
        return [];
    }
};

export const fetchChemicalInfo = async (query: string): Promise<Chemical | null> => {
    if (!query) return null;

    // 1. Check Local Dataset first (O(1) lookup)
    const normalizedQuery = query.trim().toUpperCase();
    if (COMMON_CHEMICALS[normalizedQuery]) {
        console.log(`[Cache Hit] Found ${query} in local dataset.`);
        return COMMON_CHEMICALS[normalizedQuery];
    }

    try {
        // 2. PubChem API Logic
        const url = `${PUBCHEM_BASE_URL}/compound/name/${encodeURIComponent(query)}/property/MolecularFormula,MolecularWeight,IUPACName,Title,CanonicalSMILES/JSON`;

        const response = await fetch(url);

        if (!response.ok) {
            if (response.status === 404) {
                console.warn(`Chemical not found in PubChem: ${query}`);
                return null;
            }
            throw new Error(`PubChem API Error: ${response.statusText}`);
        }

        const data = await response.json();
        const compoundProps = data.PropertyTable?.Properties?.[0];

        if (!compoundProps) {
            return null;
        }

        const cid = compoundProps.CID;

        // 3. PUG View 전체 레코드 1회 조회 후 GHS/물성 파싱 (heading별 URL 404 방지), Synonyms 병렬
        const [fullRecord, synonyms] = await Promise.all([
            fetchFullPugView(cid),
            fetchSynonyms(cid)
        ]);
        const ghsData = fullRecord ? parseGHSFromRecord(fullRecord) : undefined;
        const physicalProps = fullRecord ? parsePhysicalFromRecord(fullRecord) : undefined;

        // Find CAS Number from synonyms (Pattern: d-dd-d where d is digit, but usually 2-7 digits first)
        // Strict CAS pattern: \d{2,7}-\d{2}-\d
        const casPattern = /^\d{2,7}-\d{2}-\d$/;
        // Find the first synonym that matches the CAS pattern
        const foundCas = synonyms.find((s: string) => casPattern.test(s));

        // Name Priority: Title (Common Name) > Uppercase Query (if matched) > IUPACName > Query
        const displayName = compoundProps.Title || compoundProps.IUPACName || query;

        return {
            id: String(cid || Date.now()),
            name: displayName,
            // Use found CAS or fallback to query if it looks like a CAS, otherwise just empty or query?
            // User complained query "AgHO" became CAS.
            // If no CAS found, maybe we shouldn't show the query as CAS unless it looks like one.
            casNumber: foundCas || (casPattern.test(query) ? query : displayName),
            molecularFormula: compoundProps.MolecularFormula,
            molecularWeight: parseFloat(compoundProps.MolecularWeight),
            properties: {
                isOrganic: compoundProps.MolecularFormula?.includes('C'),
                isHalogenated: false, // Analyzer determines this
            },
            physicalProperties: physicalProps,
            ghs: ghsData
        };

    } catch (error) {
        console.error("Failed to fetch chemical info:", error);
        return null; // Return null on network error to allow manual retry or handling
    }
};

/**
 * 전체 Record에서 물성·안정성(Chemical and Physical Properties, Stability and Reactivity) 추출
 */
const parsePhysicalFromRecord = (record: any): Chemical['physicalProperties'] | undefined => {
    if (!record) return undefined;
    const result: Chemical['physicalProperties'] = {};

    const extractValue = (sectionName: string): string | undefined => {
        let foundVal: string | undefined;
        const traverse = (node: any) => {
            if (foundVal) return;
            if (node.TOCHeading === sectionName && node.Information) {
                for (const info of node.Information) {
                    if (info.Value?.StringWithMarkup?.[0]?.String) {
                        foundVal = info.Value.StringWithMarkup[0].String;
                        return;
                    }
                    if (info.Value?.StringWithMarkup?.[0]?.Value) {
                        foundVal = info.Value.StringWithMarkup[0].Value;
                        return;
                    }
                }
            }
            if (node.Section) node.Section.forEach(traverse);
        };
        traverse(record);
        return foundVal;
    };

    const solubilityRaw = extractValue('Solubility');
    if (solubilityRaw) result.solubility = solubilityRaw;

    const fpRaw = extractValue('Flash Point');
    if (fpRaw) {
        const match = fpRaw.match(/(-?[\d.]+)\s*°?\s*C/i);
        if (match) result.flashPoint = parseFloat(match[1]);
    }

    const bpRaw = extractValue('Boiling Point');
    if (bpRaw) {
        const match = bpRaw.match(/(-?[\d.]+)\s*°?\s*C/i);
        if (match) result.boilingPoint = parseFloat(match[1]);
    }

    const logPRaw = extractValue('Octanol/Water Partition Coefficient');
    if (logPRaw) {
        const match = logPRaw.match(/(-?[\d.]+)/);
        if (match) result.logKow = parseFloat(match[1]);
    }

    const traverseStability = (node: any) => {
        if (result.stability) return;
        if (node.TOCHeading === 'Stability' || node.TOCHeading === 'Stability/Shelf Life' || node.TOCHeading === 'Reactivity Profile') {
            if (node.Information) {
                for (const info of node.Information) {
                    const text = info.Value?.StringWithMarkup?.[0]?.String || '';
                    if (text) {
                        result.stability = text;
                        return;
                    }
                }
            }
        }
        if (node.Section) node.Section.forEach(traverseStability);
    };
    traverseStability(record);

    return Object.keys(result).length > 0 ? result : undefined;
};

/**
 * Fetches Safety and Hazards data from PubChem to emulate MSDS content.
 * heading 전용 URL 404 시 전체 레코드에서 Safety and Hazards 섹션을 파싱해 사용.
 */
export const fetchPubChemMsds = async (cid: string | number): Promise<MsdsSection[]> => {
    try {
        const url = `${PUBCHEM_VIEW_URL}/${cid}/JSON?heading=Safety+and+Hazards`;
        const response = await fetch(url);

        let rootSection: any = null;
        if (response.ok) {
            const data = await response.json();
            rootSection = data.Record?.Section?.[0]; // Usually "Safety and Hazards"
        }
        // heading 전용 URL이 404인 화합물(예: Psicose)은 전체 레코드에서 Safety and Hazards 섹션 추출
        if (!rootSection?.Section) {
            const fullRecord = await fetchFullPugView(cid);
            if (fullRecord?.Section) {
                rootSection = fullRecord.Section.find((s: any) => s.TOCHeading === 'Safety and Hazards');
            }
        }
        if (!rootSection || !rootSection.Section) return [];

        const sections: MsdsSection[] = [];

        // Recursive helper to flatten content of a section
        const extractContent = (node: any): { label: string; value: string }[] => {
            const items: { label: string; value: string }[] = [];

            if (node.Information) {
                node.Information.forEach((info: any) => {
                    const label = info.Name || info.Description || 'Info';
                    let value = '';

                    // Special handling for Pictograms to get image URLs
                    if (label === 'Pictogram(s)' && info.Value?.StringWithMarkup) {
                        const urls: string[] = [];
                        info.Value.StringWithMarkup.forEach((s: any) => {
                            if (s.Markup) {
                                s.Markup.forEach((m: any) => {
                                    if (m.URL) urls.push(m.URL);
                                });
                            }
                        });
                        if (urls.length > 0) {
                            value = urls.join('|');
                        }
                    }

                    // Standard text fallback if value not set yet
                    if (!value) {
                        if (info.Value?.StringWithMarkup) {
                            value = info.Value.StringWithMarkup.map((s: any) => s.String).join('\n');
                        } else if (info.Value?.Number) {
                            value = String(info.Value.Number);
                        }
                    }

                    if (value) {
                        items.push({ label, value });
                    }
                });
            }

            if (node.Section) {
                node.Section.forEach((sub: any) => {
                    // If subsection has its own heading, maybe add it as a label prefix?
                    // Or just flatten it.
                    const subItems = extractContent(sub);
                    subItems.forEach(item => {
                        items.push({
                            label: `${sub.TOCHeading} - ${item.label}`,
                            value: item.value
                        });
                    });
                });
            }
            return items;
        };

        // Root sections under "Safety and Hazards" are usually:
        // 1. Hazards Identification
        // 2. First Aid Measures
        // 3. Fire Fighting Measures
        // ...

        rootSection.Section.forEach((sec: any) => {
            const content = extractContent(sec);
            if (content.length > 0) {
                sections.push({
                    title: sec.TOCHeading,
                    content: content
                });
            }
        });

        return sections;

    } catch (e) {
        console.warn('[PubChem] Failed to fetch MSDS data', e);
        return [];
    }
};
