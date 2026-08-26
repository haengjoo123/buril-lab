const MEBIBYTE = 1024 * 1024;

/**
 * Cabinet photographs are reference images, not archival originals. Keeping a
 * bounded, re-encoded image makes the private-storage migration and its daily
 * recovery copies predictable without reducing a label photograph to a tiny
 * thumbnail.
 */
export const CABINET_IMAGE_MAX_INPUT_BYTES = 20 * MEBIBYTE;
export const CABINET_IMAGE_MAX_OUTPUT_BYTES = 2 * MEBIBYTE;
export const CABINET_IMAGE_MAX_LONG_EDGE = 1920;
export const CABINET_IMAGE_MIN_LONG_EDGE = 1280;
export const CABINET_IMAGE_MAX_SOURCE_PIXELS = 64_000_000;

const WEBP_QUALITY_STEPS = [0.84, 0.78, 0.72] as const;

type SupportedInputMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export type CabinetImageOptimizationFailure =
    | 'empty_file'
    | 'input_too_large'
    | 'unsupported_type'
    | 'invalid_signature'
    | 'decode_failed'
    | 'invalid_dimensions'
    | 'source_too_large'
    | 'webp_unsupported'
    | 'optimized_file_too_large';

export class CabinetImageOptimizationError extends Error {
    readonly code: CabinetImageOptimizationFailure;

    constructor(code: CabinetImageOptimizationFailure) {
        super(code);
        this.name = 'CabinetImageOptimizationError';
        this.code = code;
    }
}

export interface CabinetImageDimensions {
    width: number;
    height: number;
}

export interface OptimizedCabinetImage {
    file: File;
    originalBytes: number;
    optimizedBytes: number;
    width: number;
    height: number;
    quality: number;
}

interface DecodedCabinetImage extends CabinetImageDimensions {
    source: CanvasImageSource;
    release: () => void;
}

interface CabinetImageCanvas {
    draw(source: CanvasImageSource): void;
    encodeWebp(quality: number): Promise<Blob | null>;
}

export interface CabinetImageOptimizationRuntime {
    decode(file: Blob): Promise<DecodedCabinetImage>;
    createCanvas(width: number, height: number): CabinetImageCanvas;
    createFile(blob: Blob, name: string, lastModified: number): File;
}

function fail(code: CabinetImageOptimizationFailure): never {
    throw new CabinetImageOptimizationError(code);
}

function isSupportedInputMimeType(value: string): value is SupportedInputMimeType {
    return value === 'image/jpeg' || value === 'image/png' || value === 'image/webp';
}

function detectedMimeType(bytes: Uint8Array): SupportedInputMimeType | null {
    if (
        bytes.length >= 3
        && bytes[0] === 0xff
        && bytes[1] === 0xd8
        && bytes[2] === 0xff
    ) {
        return 'image/jpeg';
    }

    if (
        bytes.length >= 8
        && bytes[0] === 0x89
        && bytes[1] === 0x50
        && bytes[2] === 0x4e
        && bytes[3] === 0x47
        && bytes[4] === 0x0d
        && bytes[5] === 0x0a
        && bytes[6] === 0x1a
        && bytes[7] === 0x0a
    ) {
        return 'image/png';
    }

    if (
        bytes.length >= 12
        && bytes[0] === 0x52
        && bytes[1] === 0x49
        && bytes[2] === 0x46
        && bytes[3] === 0x46
        && bytes[8] === 0x57
        && bytes[9] === 0x45
        && bytes[10] === 0x42
        && bytes[11] === 0x50
    ) {
        return 'image/webp';
    }

    return null;
}

async function readSignature(file: Blob): Promise<Uint8Array> {
    try {
        return new Uint8Array(await file.slice(0, 12).arrayBuffer());
    } catch {
        fail('invalid_signature');
    }
}

export async function validateCabinetImageInput(file: File): Promise<SupportedInputMimeType> {
    if (!Number.isSafeInteger(file.size) || file.size <= 0) fail('empty_file');
    if (file.size > CABINET_IMAGE_MAX_INPUT_BYTES) fail('input_too_large');

    const declaredType = file.type.trim().toLowerCase();
    if (declaredType && !isSupportedInputMimeType(declaredType)) fail('unsupported_type');

    const detectedType = detectedMimeType(await readSignature(file));
    if (!detectedType) fail('invalid_signature');
    if (declaredType && declaredType !== detectedType) fail('invalid_signature');
    return detectedType;
}

export function scaleCabinetImageDimensions(
    width: number,
    height: number,
    maxLongEdge = CABINET_IMAGE_MAX_LONG_EDGE,
): CabinetImageDimensions {
    if (
        !Number.isSafeInteger(width)
        || !Number.isSafeInteger(height)
        || width <= 0
        || height <= 0
        || !Number.isSafeInteger(maxLongEdge)
        || maxLongEdge <= 0
    ) {
        fail('invalid_dimensions');
    }

    const longEdge = Math.max(width, height);
    if (longEdge <= maxLongEdge) return { width, height };

    const scale = maxLongEdge / longEdge;
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

function optimizedLongEdges(sourceLongEdge: number): number[] {
    const initial = Math.min(sourceLongEdge, CABINET_IMAGE_MAX_LONG_EDGE);
    const reduced = Math.min(initial, Math.max(CABINET_IMAGE_MIN_LONG_EDGE, Math.floor(initial * 0.8)));
    const minimum = Math.min(initial, CABINET_IMAGE_MIN_LONG_EDGE);
    return [...new Set([initial, reduced, minimum])];
}

function safeOptimizedName(name: string): string {
    const base = name
        .replace(/\.[^.]*$/, '')
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
    return `${base || 'cabinet-photo'}-optimized.webp`;
}

function browserCanvas(width: number, height: number): CabinetImageCanvas {
    if (typeof document === 'undefined') fail('webp_unsupported');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) fail('webp_unsupported');

    return {
        draw(source) {
            context.drawImage(source, 0, 0, width, height);
        },
        encodeWebp(quality) {
            return new Promise((resolve) => {
                canvas.toBlob(resolve, 'image/webp', quality);
            });
        },
    };
}

async function decodeWithImageElement(file: Blob): Promise<DecodedCabinetImage> {
    if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') {
        fail('decode_failed');
    }

    const objectUrl = URL.createObjectURL(file);
    try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error('image_decode_failed'));
            element.src = objectUrl;
        });
        if (!image.naturalWidth || !image.naturalHeight) fail('invalid_dimensions');
        return {
            source: image,
            width: image.naturalWidth,
            height: image.naturalHeight,
            release: () => URL.revokeObjectURL(objectUrl),
        };
    } catch (error) {
        URL.revokeObjectURL(objectUrl);
        if (error instanceof CabinetImageOptimizationError) throw error;
        fail('decode_failed');
    }
}

async function browserDecode(file: Blob): Promise<DecodedCabinetImage> {
    if (typeof createImageBitmap === 'function') {
        try {
            const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
            if (!bitmap.width || !bitmap.height) {
                bitmap.close();
                fail('invalid_dimensions');
            }
            return {
                source: bitmap,
                width: bitmap.width,
                height: bitmap.height,
                release: () => bitmap.close(),
            };
        } catch (error) {
            if (error instanceof CabinetImageOptimizationError) throw error;
            // Older WebViews occasionally expose createImageBitmap but cannot decode the chosen image.
            // The HTMLImageElement fallback keeps camera/gallery uploads working where possible.
        }
    }
    return decodeWithImageElement(file);
}

function browserFile(blob: Blob, name: string, lastModified: number): File {
    if (typeof File === 'undefined') fail('webp_unsupported');
    return new File([blob], name, {
        type: 'image/webp',
        lastModified: Number.isSafeInteger(lastModified) && lastModified > 0 ? lastModified : Date.now(),
    });
}

const browserRuntime: CabinetImageOptimizationRuntime = {
    decode: browserDecode,
    createCanvas: browserCanvas,
    createFile: browserFile,
};

export async function optimizeCabinetImage(
    file: File,
    runtime: CabinetImageOptimizationRuntime = browserRuntime,
): Promise<OptimizedCabinetImage> {
    await validateCabinetImageInput(file);

    let decoded: DecodedCabinetImage;
    try {
        decoded = await runtime.decode(file);
    } catch (error) {
        if (error instanceof CabinetImageOptimizationError) throw error;
        fail('decode_failed');
    }

    try {
        const sourcePixels = decoded.width * decoded.height;
        if (!Number.isSafeInteger(sourcePixels) || sourcePixels > CABINET_IMAGE_MAX_SOURCE_PIXELS) {
            fail('source_too_large');
        }

        for (const longEdge of optimizedLongEdges(Math.max(decoded.width, decoded.height))) {
            const { width, height } = scaleCabinetImageDimensions(decoded.width, decoded.height, longEdge);
            const canvas = runtime.createCanvas(width, height);
            canvas.draw(decoded.source);

            for (const quality of WEBP_QUALITY_STEPS) {
                const blob = await canvas.encodeWebp(quality);
                if (!blob) fail('webp_unsupported');
                if (blob.type !== 'image/webp') fail('webp_unsupported');
                if (blob.size <= 0) fail('webp_unsupported');
                if (blob.size > CABINET_IMAGE_MAX_OUTPUT_BYTES) continue;

                const output = runtime.createFile(blob, safeOptimizedName(file.name), file.lastModified);
                if (output.type !== 'image/webp' || output.size !== blob.size) fail('webp_unsupported');
                return {
                    file: output,
                    originalBytes: file.size,
                    optimizedBytes: output.size,
                    width,
                    height,
                    quality,
                };
            }
        }
    } finally {
        decoded.release();
    }

    fail('optimized_file_too_large');
}

export function cabinetImageUploadMessageKey(error: unknown): string {
    if (!(error instanceof CabinetImageOptimizationError)) return 'cabinet_image_upload_error';
    switch (error.code) {
        case 'input_too_large':
            return 'cabinet_image_upload_too_large';
        case 'unsupported_type':
        case 'invalid_signature':
            return 'cabinet_image_upload_unsupported_type';
        case 'source_too_large':
        case 'optimized_file_too_large':
            return 'cabinet_image_upload_optimize_failed';
        default:
            return 'cabinet_image_upload_error';
    }
}
