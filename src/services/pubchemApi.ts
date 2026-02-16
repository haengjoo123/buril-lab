import type { Chemical } from '../types';
import { COMMON_CHEMICALS } from '../data/commonChemicals';

const PUBCHEM_BASE_URL = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
const PUBCHEM_VIEW_URL = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound';

/**
 * Fetch GHS Safety Data (Signal, Hazard Statements) from PubChem PUG View API
 */
const fetchGHSData = async (cid: string | number): Promise<Chemical['ghs'] | undefined> => {
    try {
        const url = `${PUBCHEM_VIEW_URL}/${cid}/JSON?heading=GHS+Classification`;
        const response = await fetch(url);

        if (!response.ok) return undefined;

        const data = await response.json();

        // Navigate deep JSON structure safely
        // Record -> Section -> ... -> Information -> Name: "Signal" / "GHS Hazard Statements"

        // 1. Find the "Safety and Hazards" section (usually handled by ?heading=GHS+Classification, but structure varies)
        // Ensure we are in the right Record
        const sections = data.Record?.Section;
        if (!sections) return undefined;

        // Recursive helper to find "GHS Classification" section or specific Info
        // However, with ?heading=GHS+Classification, the response is usually trimmed to that section.
        // The structure usually is:
        // Section[0] -> "Safety and Hazards" -> Section -> "Hazards Identification" -> Section -> "GHS Classification"

        // Let's search for "Information" array directly inside the first section tree
        // Or flattener approach

        let signal = '';
        const hazardStatements: string[] = [];
        const pictograms: string[] = [];

        // Helper to traverse and extract
        const traverse = (node: any) => {
            if (node.Information) {
                for (const info of node.Information) {
                    if (info.Name === 'Signal') {
                        signal = info.Value?.StringWithMarkup?.[0]?.String || '';
                    }
                    if (info.Name === 'GHS Hazard Statements') {
                        // Value can be StringWithMarkup array
                        if (info.Value?.StringWithMarkup) {
                            info.Value.StringWithMarkup.forEach((s: any) => {
                                if (s.String) hazardStatements.push(s.String);
                            });
                        }
                    }
                    if (info.Name === 'Pictogram(s)') {
                        if (info.Value?.StringWithMarkup) {
                            info.Value.StringWithMarkup.forEach((s: any) => {
                                // Extract from Markup -> URL
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
            if (node.Section) {
                node.Section.forEach(traverse);
            }
        };

        traverse(data.Record);

        // if (!signal && hazardStatements.length === 0) return undefined; // Let's return even if only pictograms found, though unlikely

        return {
            signal: signal || 'Warning', // Default if found statements but no signal
            hazardStatements: [...new Set(hazardStatements)], // Dedupe
            pictograms: [...new Set(pictograms)]
        };

    } catch (e) {
        console.warn('Failed to fetch GHS data', e);
        return undefined;
    }
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

        // 3. Fetch GHS Data, Physical Properties, and Synonyms in parallel
        const [ghsData, physicalProps, synonyms] = await Promise.all([
            fetchGHSData(cid),
            fetchPhysicalProperties(cid),
            fetchSynonyms(cid)
        ]);

        // Find CAS Number from synonyms (Pattern: d-dd-d where d is digit, but usually 2-7 digits first)
        // Strict CAS pattern: \d{2,7}-\d{2}-\d
        const casPattern = /^\d{2,7}-\d{2}-\d$/;
        // Find the first synonym that matches the CAS pattern
        const foundCas = synonyms.find((s: string) => casPattern.test(s));

        // Name Priority: Title (Common Name) > Uppercase Query (if matched) > IUPACName > Query
        let displayName = compoundProps.Title || compoundProps.IUPACName || query;

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
 * Fetch Physical Properties and Stability info from PubChem PUG View API
 */
const fetchPhysicalProperties = async (cid: string | number): Promise<Chemical['physicalProperties'] | undefined> => {
    try {
        const url = `${PUBCHEM_VIEW_URL}/${cid}/JSON?heading=Chemical+and+Physical+Properties`;
        // Note: Stability info is often in a separate section "Stability and Reactivity", but let's try to fetch broadly or separate calls.
        // Actually PUG View API allows full record or specific headings. "Stability+and+Reactivity" is another heading.
        // Let's try fetching the full record is too big. Let's make parallel calls or one smart call if possible.
        // PUG View doesn't support multi-heading in one param easily usually, but let's try separately for Stability.

        const [propsResponse, stabilityResponse] = await Promise.all([
            fetch(url),
            fetch(`${PUBCHEM_VIEW_URL}/${cid}/JSON?heading=Stability+and+Reactivity`)
        ]);

        const propsData = propsResponse.ok ? await propsResponse.json() : {};
        const stabilityData = stabilityResponse.ok ? await stabilityResponse.json() : {};

        const result: Chemical['physicalProperties'] = {};

        // Helper to find specific localized props
        // Section -> Chemical and Physical Properties -> Experimental Properties -> ...

        const extractValue = (record: any, sectionName: string): string | undefined => {
            let foundVal: string | undefined;
            const traverse = (node: any) => {
                if (foundVal) return;

                if (node.TOCHeading === sectionName && node.Information) {
                    // Get the first good String value
                    for (const info of node.Information) {
                        if (info.Value?.StringWithMarkup?.[0]?.String) {
                            foundVal = info.Value.StringWithMarkup[0].String;
                            return;
                        }
                        if (info.Value?.StringWithMarkup?.[0]?.Value) { // specific case
                            foundVal = info.Value.StringWithMarkup[0].Value;
                            return;
                        }
                    }
                }
                if (node.Section) {
                    node.Section.forEach(traverse);
                }
            };
            traverse(record.Record);
            return foundVal;
        };

        // 1. Solubility
        const solubilityRaw = extractValue(propsData, 'Solubility');
        if (solubilityRaw) {
            result.solubility = solubilityRaw; // e.g. "Miscible with water", "Insoluble"
        }

        // 2. Flash Point
        const fpRaw = extractValue(propsData, 'Flash Point');
        if (fpRaw) {
            // Parse "12 deg C", "-20 C", "54 F"
            // We need C.
            const match = fpRaw.match(/(-?[\d.]+)\s*°?\s*C/i);
            if (match) {
                result.flashPoint = parseFloat(match[1]);
            }
        }

        // 3. Boiling Point
        const bpRaw = extractValue(propsData, 'Boiling Point');
        if (bpRaw) {
            const match = bpRaw.match(/(-?[\d.]+)\s*°?\s*C/i);
            if (match) {
                result.boilingPoint = parseFloat(match[1]);
            }
        }

        // 4. Log Kow (Octanol/Water Partition Coefficient)
        const logPRaw = extractValue(propsData, 'Octanol/Water Partition Coefficient');
        if (logPRaw) {
            const match = logPRaw.match(/(-?[\d.]+)/);
            if (match) {
                result.logKow = parseFloat(match[1]);
            }
        }

        // 5. Stability
        // Extract from stabilityData -> Section "Stability and Reactivity" -> "Reactivity Profile" or "Stability"
        // Let's grab "Stability/Shelf Life" or "Stability"
        const traverseStability = (node: any) => {
            if (result.stability) return;
            // Look for keywords in any info under Stability headers
            if (node.TOCHeading === 'Stability' || node.TOCHeading === 'Stability/Shelf Life' || node.TOCHeading === 'Reactivity Profile') {
                if (node.Information) {
                    for (const info of node.Information) {
                        const text = info.Value?.StringWithMarkup?.[0]?.String || '';
                        if (text) {
                            // Just take the first meaningful description
                            result.stability = text;
                            return;
                        }
                    }
                }
            }
            if (node.Section) node.Section.forEach(traverseStability);
        };
        if (stabilityData.Record) {
            traverseStability(stabilityData.Record);
        }

        return result;

    } catch (e) {
        console.warn('Failed to fetch physical properties', e);
        return undefined;
    }
};

/**
 * Fetches Safety and Hazards data from PubChem to emulate MSDS content.
 */
import type { MsdsSection } from '../types';

export const fetchPubChemMsds = async (cid: string | number): Promise<MsdsSection[]> => {
    try {
        const url = `${PUBCHEM_VIEW_URL}/${cid}/JSON?heading=Safety+and+Hazards`;
        const response = await fetch(url);

        if (!response.ok) return [];

        const data = await response.json();
        const rootSection = data.Record?.Section?.[0]; // Usually "Safety and Hazards"

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
