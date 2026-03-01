import { GoogleGenAI } from '@google/genai';
import type { Chemical, DisposalCategory } from '../types';
import { getCategoryDetails } from '../utils/chemicalAnalyzer';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

let ai: GoogleGenAI | null = null;
if (GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}

export interface ClassificationResult {
    category: DisposalCategory;
    reason: string;
    isAiEstimated: boolean;
    binColor: string;
    label: string;
}

export async function classifyChemicalWithAI(chemical: Chemical): Promise<ClassificationResult | null> {
    if (!ai) {
        console.warn('[Gemini Classification] API key not configured.');
        return null;
    }

    try {
        const prompt = `Analyze the following chemical substance and assign it to EXACTLY ONE of these disposal categories:
"ACID", "ALKALI", "NEUTRAL", "ORGANIC_HALOGEN", "ORGANIC_NON_HALOGEN", "HEAVY_METAL", "CYANIDE", "REACTIVE", "SOLID_WASTE", "UNKNOWN"

Chemical Name: ${chemical.name}
Formula: ${chemical.molecularFormula || 'Not provided'}
CAS Number: ${chemical.casNumber || 'Not provided'}

Strict Rules for Assignment:
1. REACTIVE takes ultimate precedence (e.g. explosive, peroxide, nitrate, strong oxidizers AND specifically Nitric Acid / HNO3, Perchloric Acid / HClO4).
2. CYANIDE if it contains cyanide OR sulfide (S2-).
3. HEAVY_METAL if it contains Ag, Cd, Pb, Hg, Cr, As, Ni, Cu, Zn, or Ba.
4. ORGANIC_HALOGEN if it contains Carbon AND Halogens (F, Cl, Br, I).
5. ORGANIC_NON_HALOGEN if it contains Carbon but no Halogens.
6. ACID if it is strictly an inorganic acid (e.g. HCl, H2SO4) but NEVER Nitric/Perchloric/Sulfides.
7. ALKALI if it is strictly an inorganic base.
8. SOLID_WASTE if it is commonly a solid waste (powders, resins, sand, beads) AND NOT reactive, cyanide, or heavy metal.
9. NEUTRAL if it's a completely pure, harmless inorganic aqueous solution WITHOUT any organics, heavy metals, or toxins.
10. UNKNOWN if none of the above perfectly apply.

Return ONLY the category name as a plain string. No other text.`;

        let response;

        try {
            response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: [{ role: 'user', parts: [{ text: prompt }] }]
            });
        } catch (error: any) {
            if (error?.status === 503 || error?.status === 'UNAVAILABLE' || error?.message?.includes('503')) {
                console.warn('[Gemini Classification] 3.0 Flash unavailable. Falling back to 2.5 Flash.');
                response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: [{ role: 'user', parts: [{ text: prompt }] }]
                });
            } else {
                throw error;
            }
        }

        const rawText = (response.text || '').trim().toUpperCase();

        // Clean up response if it has extra chars
        const validCategories: DisposalCategory[] = ['ACID', 'ALKALI', 'NEUTRAL', 'ORGANIC_HALOGEN', 'ORGANIC_NON_HALOGEN', 'HEAVY_METAL', 'CYANIDE', 'REACTIVE', 'SOLID_WASTE', 'UNKNOWN'];
        const finalCategory = validCategories.find(c => rawText.includes(c)) || 'UNKNOWN';

        if (finalCategory === 'UNKNOWN') {
            return null; // Let the caller fall back to standard unknown logic
        }

        const { binColor, label } = getCategoryDetails(finalCategory);

        return {
            category: finalCategory,
            reason: `reason_${finalCategory.toLowerCase()}`,
            isAiEstimated: true,
            binColor,
            label
        };

    } catch (error) {
        console.error('[Gemini Classification] API error:', error);
        return null;
    }
}
