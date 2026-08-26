import { describe, expect, it, vi } from 'vitest';
import {
    CABINET_IMAGE_MAX_INPUT_BYTES,
    CABINET_IMAGE_MAX_OUTPUT_BYTES,
    CabinetImageOptimizationError,
    cabinetImageUploadMessageKey,
    optimizeCabinetImage,
    scaleCabinetImageDimensions,
    validateCabinetImageInput,
    type CabinetImageOptimizationRuntime,
} from './cabinetImageOptimization';

function fileFromBytes(bytes: number[], type: string, name = 'cabinet.jpg'): File {
    const blob = new Blob([new Uint8Array(bytes)], { type });
    return Object.assign(blob, {
        name,
        lastModified: Date.parse('2026-08-26T00:00:00.000Z'),
    }) as File;
}

function jpegBytes(): number[] {
    return [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0];
}

function fakeRuntime(encodedSizes: number[]): CabinetImageOptimizationRuntime {
    const encodeWebp = vi.fn(async () => {
        const size = encodedSizes.shift() ?? 100;
        return new Blob([new Uint8Array(size)], { type: 'image/webp' });
    });
    const draw = vi.fn();
    return {
        decode: vi.fn(async () => ({
            source: {} as CanvasImageSource,
            width: 4000,
            height: 2250,
            release: vi.fn(),
        })),
        createCanvas: vi.fn(() => ({ draw, encodeWebp })),
        createFile: (blob, name, lastModified) => Object.assign(blob, { name, lastModified }) as File,
    };
}

describe('cabinet image optimization', () => {
    it('accepts only JPEG, PNG, and WebP files whose bytes match their declared type', async () => {
        await expect(validateCabinetImageInput(fileFromBytes(jpegBytes(), 'image/jpeg'))).resolves.toBe('image/jpeg');
        await expect(validateCabinetImageInput(fileFromBytes([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ], 'image/png'))).resolves.toBe('image/png');
        await expect(validateCabinetImageInput(fileFromBytes([
            0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
        ], 'image/webp'))).resolves.toBe('image/webp');
        await expect(validateCabinetImageInput(fileFromBytes(jpegBytes(), 'image/png'))).rejects.toMatchObject({
            code: 'invalid_signature',
        });
        await expect(validateCabinetImageInput(fileFromBytes([1, 2, 3], 'image/gif'))).rejects.toMatchObject({
            code: 'unsupported_type',
        });
    });

    it('rejects empty and oversized source files before image decoding', async () => {
        const empty = fileFromBytes([], 'image/jpeg');
        await expect(validateCabinetImageInput(empty)).rejects.toMatchObject({ code: 'empty_file' });

        const signature = fileFromBytes(jpegBytes(), 'image/jpeg');
        const oversized = {
            name: 'oversized.jpg',
            type: 'image/jpeg',
            size: CABINET_IMAGE_MAX_INPUT_BYTES + 1,
            lastModified: signature.lastModified,
            slice: signature.slice.bind(signature),
        } as File;
        await expect(validateCabinetImageInput(oversized)).rejects.toMatchObject({ code: 'input_too_large' });
    });

    it('preserves aspect ratio while keeping the long edge bounded', () => {
        expect(scaleCabinetImageDimensions(4000, 2250)).toEqual({ width: 1920, height: 1080 });
        expect(scaleCabinetImageDimensions(1200, 800)).toEqual({ width: 1200, height: 800 });
        expect(() => scaleCabinetImageDimensions(0, 100)).toThrow(CabinetImageOptimizationError);
    });

    it('re-encodes a valid photo as a bounded WebP instead of uploading the original bytes', async () => {
        const runtime = fakeRuntime([CABINET_IMAGE_MAX_OUTPUT_BYTES + 1, 512]);
        const result = await optimizeCabinetImage(fileFromBytes(jpegBytes(), 'image/jpeg', 'cabinet photo.jpg'), runtime);

        expect(result.file.type).toBe('image/webp');
        expect(result.file.name).toBe('cabinet-photo-optimized.webp');
        expect(result.optimizedBytes).toBe(512);
        expect(result.width).toBe(1920);
        expect(result.height).toBe(1080);
        expect(runtime.createCanvas).toHaveBeenCalledWith(1920, 1080);
    });

    it('fails closed instead of keeping the original when no WebP attempt fits the output limit', async () => {
        const runtime = fakeRuntime(Array.from({ length: 9 }, () => CABINET_IMAGE_MAX_OUTPUT_BYTES + 1));

        await expect(optimizeCabinetImage(fileFromBytes(jpegBytes(), 'image/jpeg'), runtime))
            .rejects.toMatchObject({ code: 'optimized_file_too_large' });
    });

    it('returns a useful, non-sensitive message key for transform failures', () => {
        expect(cabinetImageUploadMessageKey(new CabinetImageOptimizationError('input_too_large')))
            .toBe('cabinet_image_upload_too_large');
        expect(cabinetImageUploadMessageKey(new Error('private path / token')))
            .toBe('cabinet_image_upload_error');
    });
});
