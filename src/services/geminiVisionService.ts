import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

let ai: GoogleGenAI | null = null;
if (GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}

export interface GeminiAnalysisResult {
    searchTerm: string;
    success: boolean;
    usedModelName?: string;
    error?: string;
}

/**
 * Perform Image Analysis using Google's new GenAI SDK
 * Returns the best single search term extracted from the image
 */
export async function performGeminiImageAnalysis(imageSrc: string): Promise<GeminiAnalysisResult> {
    if (!ai) {
        throw new Error('Gemini API key not configured. Please add VITE_GEMINI_API_KEY to your environment variables.');
    }

    try {
        const prompt = `Identify the primary chemical substance in this image. 
Return ONLY the best single search term to look it up in a database.
Prefer the CAS Number if it is clearly visible. If no CAS Number is visible, return the most prominent chemical name (Korean or English).
Do not include any other text, explanation, punctuation, or formatting. Just the search term itself.`;

        // Separate the base64 part and the mime type
        const [header, base64Data] = imageSrc.split(',');
        const mimeMatch = header.match(/^data:(image\/[a-zA-Z]+);base64/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

        const payload = {
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: prompt },
                        {
                            inlineData: {
                                data: base64Data,
                                mimeType: mimeType
                            }
                        }
                    ]
                }
            ]
        };

        let response;
        let usedModelName = 'gemini-3-flash-preview';
        try {
            response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                ...payload
            });
        } catch (error: any) {
            if (error?.status === 503 || error?.status === 'UNAVAILABLE' || error?.message?.includes('503')) {
                console.warn('[Gemini Vision] 3.0 Flash is unavailable (503). Falling back to gemini-2.5-flash...');
                usedModelName = 'gemini-2.5-flash';
                response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    ...payload
                });
            } else {
                throw error;
            }
        }

        const responseText = response.text || '';

        // Clean up the response (trim whitespace, remove newlines)
        const searchTerm = responseText.replace(/\\n/g, ' ').trim();

        console.log(`[Gemini Vision] Extracted search term: "${searchTerm}" (Model: ${usedModelName})`);

        if (!searchTerm) {
            throw new Error('No valid search term identified in the image.');
        }

        return {
            searchTerm,
            success: true,
            usedModelName
        };
    } catch (error: any) {
        console.error('[Gemini Vision] API error:', error);
        return {
            searchTerm: '',
            success: false,
            error: error.message || 'Failed to analyze image with Gemini API'
        };
    }
}
