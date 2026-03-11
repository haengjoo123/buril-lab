/**
 * Google Cloud Vision OCR Service
 * Uses Google Cloud Vision API DOCUMENT_TEXT_DETECTION for block-level recognition
 * Supports Korean + English text on chemical labels
 */

import { postJson } from './internalApi'

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
 * Perform OCR using Google Cloud Vision API with DOCUMENT_TEXT_DETECTION
 * Returns full text + individual blocks for interactive selection
 */
export async function performVisionOcr(imageSrc: string): Promise<VisionOcrResult> {
    return postJson<VisionOcrResult>('/api/vision/ocr', { imageSrc })
}
