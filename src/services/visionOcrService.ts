/**
 * Google Cloud Vision OCR Service
 * Uses Google Cloud Vision API DOCUMENT_TEXT_DETECTION for block-level recognition
 * Supports Korean + English text on chemical labels
 */

const VISION_API_KEY = import.meta.env.VITE_GOOGLE_VISION_API_KEY;
const VISION_API_URL = `https://vision.googleapis.com/v1/images:annotate?key=${VISION_API_KEY}`;

/** A single detected text block with its bounding box */
export interface TextBlock {
    text: string;
    confidence: number;
    boundingBox: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}

export interface VisionOcrResult {
    text: string;
    source: 'Google Vision';
    blocks: TextBlock[];
    imageWidth: number;
    imageHeight: number;
}

/**
 * Convert a data URL (base64 image) to raw base64 string
 */
function dataUrlToBase64(dataUrl: string): string {
    const base64Index = dataUrl.indexOf(',');
    return base64Index >= 0 ? dataUrl.substring(base64Index + 1) : dataUrl;
}

/**
 * Extract bounding box from Vision API vertices
 */
function verticesToBox(vertices: Array<{ x?: number; y?: number }>) {
    const xs = vertices.map(v => v.x || 0);
    const ys = vertices.map(v => v.y || 0);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
    };
}

/**
 * Perform OCR using Google Cloud Vision API with DOCUMENT_TEXT_DETECTION
 * Returns full text + individual blocks for interactive selection
 */
export async function performVisionOcr(imageSrc: string): Promise<VisionOcrResult> {
    if (!VISION_API_KEY) {
        throw new Error('Google Vision API key not configured');
    }

    const base64Image = dataUrlToBase64(imageSrc);

    const requestBody = {
        requests: [
            {
                image: {
                    content: base64Image,
                },
                features: [
                    {
                        type: 'DOCUMENT_TEXT_DETECTION',
                    },
                ],
                imageContext: {
                    languageHints: ['ko', 'en'],
                },
            },
        ],
    };

    const response = await fetch(VISION_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[Vision OCR] API error:', response.status, errorData);
        throw new Error(`Vision API error: ${response.status}`);
    }

    const data = await response.json();
    const result = data.responses?.[0];
    const fullTextAnnotation = result?.fullTextAnnotation;

    if (!fullTextAnnotation) {
        console.log('[Vision OCR] No text detected');
        return { text: '', source: 'Google Vision', blocks: [], imageWidth: 0, imageHeight: 0 };
    }

    const fullText = fullTextAnnotation.text || '';

    // Get image dimensions from the first page
    const page = fullTextAnnotation.pages?.[0];
    const imageWidth = page?.width || 0;
    const imageHeight = page?.height || 0;

    // Extract blocks with their text and bounding boxes
    const blocks: TextBlock[] = [];

    if (page?.blocks) {
        for (const block of page.blocks) {
            if (block.blockType !== 'TEXT') continue;

            // Build block text from paragraphs → words → symbols
            let blockText = '';
            const blockConfidence = block.confidence || 0;

            if (block.paragraphs) {
                for (const paragraph of block.paragraphs) {
                    if (paragraph.words) {
                        const wordTexts = paragraph.words.map((word: { symbols?: Array<{ text?: string }> }) => {
                            if (!word.symbols) return '';
                            return word.symbols.map((s: { text?: string }) => s.text || '').join('');
                        });
                        blockText += wordTexts.join(' ') + '\n';
                    }
                }
            }

            blockText = blockText.trim();
            if (!blockText) continue;

            const boundingBox = block.boundingBox?.vertices
                ? verticesToBox(block.boundingBox.vertices)
                : { x: 0, y: 0, width: 0, height: 0 };

            blocks.push({
                text: blockText,
                confidence: blockConfidence,
                boundingBox,
            });
        }
    }

    console.log(`[Vision OCR] Detected ${blocks.length} blocks, full text: ${fullText.substring(0, 80)}...`);

    return {
        text: fullText.trim(),
        source: 'Google Vision',
        blocks,
        imageWidth,
        imageHeight,
    };
}
