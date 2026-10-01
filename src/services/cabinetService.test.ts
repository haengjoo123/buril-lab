import { beforeEach, describe, expect, it, vi } from 'vitest';

const optimizeCabinetImageMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());
const postBytesMock = vi.hoisted(() => vi.fn());
const postJsonMock = vi.hoisted(() => vi.fn());

vi.mock('./supabaseClient', () => ({
    supabase: {
        rpc: rpcMock,
        from: fromMock,
    },
}));

vi.mock('./internalApi', () => ({ postBytes: postBytesMock, postJson: postJsonMock }));
vi.mock('../store/useLabStore', () => ({
    useLabStore: { getState: () => ({ currentLabId: '33333333-3333-4333-8333-333333333333' }) },
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

describe('versioned cabinet snapshots', () => {
    it('creates the cabinet and its initial shelves in one transaction', async () => {
        rpcMock.mockReset();
        rpcMock.mockResolvedValueOnce({ data: { id: cabinetId }, error: null });
        expect(await cabinetService.createCabinet('New cabinet')).toEqual({ id: cabinetId });
        expect(rpcMock).toHaveBeenCalledOnce();
        expect(rpcMock).toHaveBeenCalledWith('create_cabinet_v2', {
            p_name: 'New cabinet', p_lab_id: '33333333-3333-4333-8333-333333333333',
            p_width: 5, p_height: 9, p_depth: 2, p_location: null,
        });
    });

    it('requires loading the cabinet and sends explicit deletion IDs from that snapshot', async () => {
        const id = '77777777-7777-4777-8777-777777777777';
        rpcMock.mockReset();
        await expect(cabinetService.saveCabinetState(id, [], { width: 5, height: 9, depth: 2 })).rejects.toThrow('불러온');
        expect(rpcMock).not.toHaveBeenCalled();
        rpcMock.mockResolvedValueOnce({ data: { cabinet: { name: 'Test', width: 5, height: 9, depth: 2, layout_revision: 12 }, shelves: [{ id: 'shelf', level: 0, dividers: [] }], items: [{ id: 'item', shelf_id: 'shelf', name: 'Test', width: 8, position: 30, depth_position: null, template: 'A' }] }, error: null });
        const details = await cabinetService.getCabinetDetails(id);
        expect(details.shelves[0].items[0].depthPosition).toBe(50);
        rpcMock.mockResolvedValueOnce({ data: 13, error: null });
        await cabinetService.saveCabinetState(id, [], { width: 5, height: 9, depth: 2 });
        expect(rpcMock).toHaveBeenLastCalledWith('save_cabinet_state_v2', expect.objectContaining({ p_expected_revision: 12, p_removed_shelf_ids: ['shelf'], p_removed_item_ids: ['item'] }));
    });

    it('uses the server clock for listing trash and never requests permanent deletion from the browser', async () => {
        rpcMock.mockResolvedValueOnce({ data: [], error: null });
        expect(await cabinetService.getTrash(cabinetId)).toEqual([]);
        expect(rpcMock).toHaveBeenLastCalledWith('get_cabinet_trash_v2', { p_cabinet_id: cabinetId });
    });
});

describe('atomic cabinet activity audit', () => {
    beforeEach(() => {
        rpcMock.mockReset();
        rpcMock.mockResolvedValue({ data: { success: true }, error: null });
    });

    it('uses only the database-derived activity and audit path', async () => {
        await cabinetService.logActivity(cabinetId, 'add', 'Synthetic reagent', 'Inventory registration', 'memo');

        expect(rpcMock).toHaveBeenCalledOnce();
        expect(rpcMock).toHaveBeenCalledWith('record_cabinet_activity_v2', {
            p_cabinet_id: cabinetId,
            p_action_type: 'add',
            p_item_name: 'Synthetic reagent',
            p_reason: 'Inventory registration',
            p_memo: 'memo',
            p_request_id: '11111111-1111-4111-8111-111111111111',
        });
    });

    it('never falls back to the forgeable generic audit path', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        rpcMock.mockResolvedValue({ data: null, error: { code: '42501', message: 'sensitive provider detail' } });

        await expect(cabinetService.logActivity(cabinetId, 'remove', 'Synthetic reagent')).resolves.toBeUndefined();

        expect(rpcMock).toHaveBeenCalledOnce();
        expect(rpcMock).not.toHaveBeenCalledWith('insert_audit_log_rpc', expect.anything());
        expect(consoleSpy).toHaveBeenCalledWith('Error logging atomic cabinet activity:', { code: '42501' });
        expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain('sensitive provider detail');
        consoleSpy.mockRestore();
    });
});

describe('cabinet image upload', () => {
    beforeEach(() => {
        optimizeCabinetImageMock.mockReset();
        postBytesMock.mockReset();
        postJsonMock.mockReset();
        optimizeCabinetImageMock.mockResolvedValue({ file: optimizedFile });
        postBytesMock.mockResolvedValue({ success: true,
            imageUrl: 'https://supabase.example/storage/v1/object/sign/cabinets/photo.webp?token=signed',
            referencedCount: 1, warning: false, urlUnavailable: false });
        postJsonMock.mockResolvedValue({ success: true, imageUrl: null, referencedCount: 0, warning: false });
    });

    it('sends only the optimized WebP through the authenticated server path', async () => {
        await expect(cabinetService.uploadCabinetImage(cabinetId, originalFile))
            .resolves.toContain('/storage/v1/object/sign/cabinets/');

        expect(optimizeCabinetImageMock).toHaveBeenCalledWith(originalFile);
        expect(postBytesMock).toHaveBeenCalledWith(`/api/cabinets/${cabinetId}/image`, optimizedFile, 'image/webp');
        expect(postBytesMock.mock.calls[0][1]).not.toBe(originalFile);
    });

    it('does not fall back to browser Storage when the server upload fails', async () => {
        postBytesMock.mockRejectedValueOnce(new Error('server unavailable'));
        await expect(cabinetService.uploadCabinetImage(cabinetId, originalFile))
            .rejects.toThrow('server unavailable');
        expect(postBytesMock).toHaveBeenCalledOnce();
    });

    it('removes a photo only through the retention-aware server path', async () => {
        await expect(cabinetService.removeCabinetImage(cabinetId)).resolves.toBeUndefined();
        expect(postJsonMock).toHaveBeenCalledWith(`/api/cabinets/${cabinetId}/image`, { action: 'remove' });
    });
});

describe('private cabinet image hydration', () => {
    const row = { id: cabinetId, name: 'Private cabinet', image_path:
        `labs/33333333-3333-4333-8333-333333333333/cabinets/${cabinetId}/44444444-4444-4444-8444-444444444444.webp`,
    image_url: 'https://legacy-public.example/photo.webp' };

    beforeEach(() => {
        const query: Record<string, ReturnType<typeof vi.fn>> = {};
        query.select = vi.fn(() => query);
        query.eq = vi.fn(() => query);
        query.is = vi.fn(() => query);
        query.order = vi.fn().mockResolvedValue({ data: [row], error: null });
        fromMock.mockReset();
        fromMock.mockReturnValue(query);
        postJsonMock.mockReset();
    });

    it('replaces a stored public URL with a short signed URL', async () => {
        const signed = 'https://supabase.example/storage/v1/object/sign/cabinets/photo.webp?token=signed';
        postJsonMock.mockResolvedValueOnce({ success: true, urls: { [cabinetId]: signed } });
        const result = await cabinetService.getCabinets();
        expect(result[0].image_url).toBe(signed);
        expect(postJsonMock).toHaveBeenCalledWith('/api/cabinets/image-urls', { cabinetIds: [cabinetId] });
    });

    it('hides the legacy URL when signing is unavailable', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        postJsonMock.mockRejectedValueOnce(new Error('signing unavailable'));
        const result = await cabinetService.getCabinets();
        expect(result[0].image_url).toBeUndefined();
        expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain('signing unavailable');
        consoleSpy.mockRestore();
    });
});
