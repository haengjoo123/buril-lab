import { beforeEach, describe, expect, it, vi } from 'vitest';

const optimizeCabinetImageMock = vi.hoisted(() => vi.fn());
const uploadMock = vi.hoisted(() => vi.fn());
const getPublicUrlMock = vi.hoisted(() => vi.fn());
const removeMock = vi.hoisted(() => vi.fn());
const storageFromMock = vi.hoisted(() => vi.fn());

vi.mock('./supabaseClient', () => ({
    supabase: {
        storage: {
            from: storageFromMock,
        },
    },
}));

vi.mock('../utils/cabinetImageOptimization', () => ({
    optimizeCabinetImage: optimizeCabinetImageMock,
}));

vi.mock('uuid', () => ({
    v4: () => '11111111-1111-4111-8111-111111111111',
}));

import { cabinetService } from './cabinetService';

const cabinetId = '22222222-2222-4222-8222-222222222222';
const optimizedFile = new File(['optimized'], 'cabinet-photo-optimized.webp', { type: 'image/webp' });
const originalFile = new File(['original'], 'large-camera-photo.jpg', { type: 'image/jpeg' });

describe('cabinet image upload', () => {
    beforeEach(() => {
        optimizeCabinetImageMock.mockReset();
        uploadMock.mockReset();
        getPublicUrlMock.mockReset();
        removeMock.mockReset();
        storageFromMock.mockReset();
        storageFromMock.mockReturnValue({
            upload: uploadMock,
            getPublicUrl: getPublicUrlMock,
            remove: removeMock,
        });
        optimizeCabinetImageMock.mockResolvedValue({ file: optimizedFile });
        uploadMock.mockResolvedValue({ error: null });
        getPublicUrlMock.mockReturnValue({ data: { publicUrl: 'https://example.test/cabinets/photo.webp' } });
        removeMock.mockResolvedValue({ error: null });
    });

    it('uploads only the optimized WebP and keeps the source file out of Storage', async () => {
        const updateSpy = vi.spyOn(cabinetService, 'updateCabinet').mockResolvedValue();

        await expect(cabinetService.uploadCabinetImage(cabinetId, originalFile))
            .resolves.toBe('https://example.test/cabinets/photo.webp');

        expect(optimizeCabinetImageMock).toHaveBeenCalledWith(originalFile);
        expect(uploadMock).toHaveBeenCalledWith(
            `${cabinetId}-11111111-1111-4111-8111-111111111111.webp`,
            optimizedFile,
            {
                upsert: false,
                contentType: 'image/webp',
                cacheControl: '31536000',
            },
        );
        expect(uploadMock.mock.calls[0][1]).not.toBe(originalFile);
        expect(updateSpy).toHaveBeenCalledWith(cabinetId, {
            image_url: 'https://example.test/cabinets/photo.webp',
        });
        expect(removeMock).not.toHaveBeenCalled();
        updateSpy.mockRestore();
    });

    it('cleans up a newly uploaded transformed file if the database link fails', async () => {
        const updateSpy = vi.spyOn(cabinetService, 'updateCabinet').mockRejectedValue(new Error('database unavailable'));

        await expect(cabinetService.uploadCabinetImage(cabinetId, originalFile))
            .rejects.toThrow('database unavailable');

        expect(removeMock).toHaveBeenCalledWith([
            `${cabinetId}-11111111-1111-4111-8111-111111111111.webp`,
        ]);
        updateSpy.mockRestore();
    });
});
