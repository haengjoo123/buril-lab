/* eslint-disable @typescript-eslint/no-explicit-any */
import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

let ai: GoogleGenAI | null = null;
if (GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}

export interface ReagentScanResult {
    name: string;
    casNumber?: string;
    suggestedContainerType: 'A' | 'B' | 'C' | 'D';
    capacity?: string;
    expiryDate?: string;
    brand?: string;
    productNumber?: string;
    success: boolean;
    error?: string;
}

/**
 * Analyze a reagent label image using Gemini Vision API.
 * Returns structured info about the reagent (name, CAS, container type, capacity, expiry).
 */
export async function scanReagentLabel(imageSrc: string): Promise<ReagentScanResult> {
    if (!ai) {
        return {
            name: '',
            suggestedContainerType: 'A',
            success: false,
            error: 'Gemini API key not configured.',
        };
    }

    try {
        const prompt = `You are a chemistry lab assistant. Analyze this image of a reagent/chemical container label.
Extract the following information and return it as a JSON object ONLY (no markdown, no extra text):

{
  "name": "<Chemical/reagent name, in the language shown on the label>",
  "casNumber": "<CAS Number if visible, otherwise null>",
  "suggestedContainerType": "<One of: A (brown glass bottle), B (plastic container), C (clear glass bottle), D (ampoule/vial box) — choose based on what you see in the image>",
  "capacity": "<Volume or weight shown on the label, e.g. '500mL', '1kg', otherwise null>",
  "expiryDate": "<Expiry date in YYYY-MM-DD format if visible, otherwise null>",
  "brand": "<Manufacturer/brand name if visible, e.g. 'Sigma-Aldrich', 'Merck', otherwise null>",
  "productNumber": "<Product/catalog number if visible, e.g. 'A1234', otherwise null>"
}

Rules:
- For suggestedContainerType: A = amber/brown glass bottle, B = white/opaque plastic bottle or container, C = clear/transparent glass bottle, D = cardboard box with ampoules or vials inside
- If you cannot determine the container type from the image, default to "A"
- Always try to extract the chemical name
- Return ONLY the JSON object, no other text`;

        // Separate the base64 part and the mime type
        const [header, base64Data] = imageSrc.split(',');
        const mimeMatch = header.match(/^data:(image\/[a-zA-Z]+);base64/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

        const payload = {
            contents: [
                {
                    role: 'user' as const,
                    parts: [
                        { text: prompt },
                        {
                            inlineData: {
                                data: base64Data,
                                mimeType: mimeType,
                            },
                        },
                    ],
                },
            ],
        };

        let response;
        try {
            response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                ...payload,
            });
        } catch (error: any) {
            if (error?.status === 503 || error?.status === 'UNAVAILABLE' || error?.message?.includes('503')) {
                console.warn('[Reagent Scan] 3.0 Flash unavailable. Falling back to gemini-2.5-flash...');
                response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    ...payload,
                });
            } else {
                throw error;
            }
        }

        const responseText = (response.text || '').trim();
        console.log('[Reagent Scan] Raw response:', responseText);

        // Parse JSON from response (strip possible markdown fences)
        const jsonStr = responseText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(jsonStr);

        const validTypes = ['A', 'B', 'C', 'D'];
        const containerType = validTypes.includes(parsed.suggestedContainerType)
            ? parsed.suggestedContainerType
            : 'A';

        return {
            name: parsed.name || '',
            casNumber: parsed.casNumber || undefined,
            suggestedContainerType: containerType,
            capacity: parsed.capacity || undefined,
            expiryDate: parsed.expiryDate || undefined,
            brand: parsed.brand || undefined,
            productNumber: parsed.productNumber || undefined,
            success: true,
        };
    } catch (error: any) {
        console.error('[Reagent Scan] API error:', error);
        return {
            name: '',
            suggestedContainerType: 'A',
            success: false,
            error: error.message || 'Failed to analyze reagent label.',
        };
    }
}
