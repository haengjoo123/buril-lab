import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InventoryItem } from './inventoryService';

const mocks = vi.hoisted(() => ({
    rpc: vi.fn(),
    from: vi.fn(),
    getCurrentUserDisplayName: vi.fn(),
    labState: { currentLabId: '11111111-1111-4111-8111-111111111111' as string | null },
}));

vi.mock('./supabaseClient', () => ({
    supabase: {
        rpc: mocks.rpc,
        from: mocks.from,
        auth: { getUser: vi.fn() },
    },
}));

vi.mock('../store/useLabStore', () => ({
    useLabStore: {
        getState: () => mocks.labState,
    },
}));

vi.mock('../utils/userDisplayName', () => ({
    getCurrentUserDisplayName: mocks.getCurrentUserDisplayName,
}));

import { inventoryService } from './inventoryService';

function inventoryItem(
    id: string,
    source: 'inventory' | 'cabinet_item' = 'inventory',
): InventoryItem {
    return {
        id,
        lab_id: mocks.labState.currentLabId,
        user_id: null,
        name: source === 'inventory' ? 'Acetone' : 'Dichloromethane',
        brand: null,
        product_number: null,
        cas_number: null,
        quantity: 1,
        capacity: '500 mL',
        storage_type: source === 'cabinet_item' ? 'cabinet' : 'other',
        cabinet_id: source === 'cabinet_item' ? 'cabinet-a' : null,
        storage_location_id: null,
        product_id: null,
        expiry_date: null,
        memo: null,
        remaining_percent: null,
        created_at: '2026-08-02T00:00:00.000Z',
        updated_at: '2026-08-02T00:00:00.000Z',
        _source: source,
    };
}

function successfulResult(items: Array<{ item_id: string; item_source: string }>) {
    return {
        data: {
            removed_count: items.length,
            removed_items: items,
        },
        error: null,
    };
}

function queryResult<T>(data: T, error: unknown = null) {
    const result = Promise.resolve({ data, error });
    const chain: Record<string, unknown> & PromiseLike<{ data: T; error: unknown }> = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        order: vi.fn(() => chain),
        then: result.then.bind(result),
    };
    return chain;
}

describe('inventoryService V2 record removal', () => {
    beforeEach(() => {
        mocks.rpc.mockReset();
        mocks.from.mockReset();
        mocks.getCurrentUserDisplayName.mockReset();
        mocks.getCurrentUserDisplayName.mockResolvedValue('Researcher Kim');
        mocks.labState.currentLabId = '11111111-1111-4111-8111-111111111111';
    });

    it('moves multiple inventory records to one storage location with one exact RPC receipt', async () => {
        const requestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
        const locationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
        const targets = [
            { item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', item_source: 'inventory' as const },
            { item_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', item_source: 'inventory' as const },
        ];
        const destination = { storage_type: 'other' as const, storage_location_id: locationId };
        mocks.rpc.mockResolvedValue({
            data: {
                request_id: requestId,
                moved_count: 2,
                moved_items: targets.map((target) => ({
                    ...target,
                    inventory_item_id: target.item_id,
                    cabinet_item_id: null,
                    source: {
                        storage_type: 'cabinet',
                        cabinet_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                        storage_location_id: null,
                    },
                    destination,
                })),
                destination,
                idempotent: false,
            },
            error: null,
        });

        const receipt = await inventoryService.moveRecords({
            targets,
            destination,
            requestId,
        });

        expect(receipt.movedCount).toBe(2);
        expect(receipt.movedItems.map((item) => item.itemId)).toEqual(
            targets.map((target) => target.item_id),
        );
        expect(mocks.rpc).toHaveBeenCalledWith('move_inventory_records_v2', {
            p_targets: targets,
            p_destination: destination,
            p_request_id: requestId,
        });
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it('accepts a cabinet move receipt with server-generated placement IDs', async () => {
        const requestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
        const cabinetId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
        const inventoryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const cabinetItemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        const target = {
            item_id: inventoryId,
            item_source: 'inventory' as const,
            placement: {
                shelf_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                template: 'A' as const,
                width: 8,
                position: 2,
                depth_position: 50,
            },
        };
        const destination = { storage_type: 'cabinet' as const, cabinet_id: cabinetId };
        mocks.rpc.mockResolvedValue({
            data: {
                request_id: requestId,
                moved_count: 1,
                moved_items: [{
                    item_id: inventoryId,
                    item_source: 'inventory',
                    inventory_item_id: inventoryId,
                    cabinet_item_id: cabinetItemId,
                    source: {
                        storage_type: 'other',
                        cabinet_id: null,
                        storage_location_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
                    },
                    destination,
                }],
                destination,
                idempotent: true,
            },
            error: null,
        });

        const receipt = await inventoryService.moveRecords({
            targets: [target],
            destination,
            requestId,
        });

        expect(receipt.movedItems[0]).toMatchObject({
            itemId: inventoryId,
            inventoryItemId: inventoryId,
            cabinetItemId,
        });
        expect(receipt.idempotent).toBe(true);
    });

    it('rejects a partial bulk-move receipt without applying a client-side fallback', async () => {
        const targets = [
            { item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', item_source: 'inventory' as const },
            { item_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', item_source: 'inventory' as const },
        ];
        const destination = {
            storage_type: 'other' as const,
            storage_location_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        };
        mocks.rpc.mockResolvedValue({
            data: {
                request_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                moved_count: 1,
                moved_items: [],
                destination,
                idempotent: false,
            },
            error: null,
        });

        await expect(inventoryService.moveRecords({
            targets,
            destination,
            requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        })).rejects.toThrow('invalid atomic receipt');
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it('records one used cabinet unit with the server-derived scope and keeps grouped rows at quantity 1', async () => {
        const cabinetItemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        const inventoryItemId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const requestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
        mocks.rpc.mockResolvedValue({
            data: {
                request_id: requestId,
                cabinet_item_id: cabinetItemId,
                inventory_item_id: inventoryItemId,
                completion_kind: 'used',
                previous_quantity: 2,
                remaining_quantity: 1,
                cabinet_item_removed: false,
                inventory_item_removed: false,
                idempotent: false,
            },
            error: null,
        });

        await expect(inventoryService.recordUsageCompletion({
            cabinetItemId,
            requestId,
            completionKind: 'used',
        })).resolves.toEqual({
            requestId,
            cabinetItemId,
            inventoryItemId,
            completionKind: 'used',
            previousQuantity: 2,
            remainingQuantity: 1,
            cabinetItemRemoved: false,
            inventoryItemRemoved: false,
            idempotent: false,
        });

        expect(mocks.rpc).toHaveBeenCalledWith('record_inventory_usage_completion_v2', {
            p_cabinet_item_id: cabinetItemId,
            p_request_id: requestId,
            p_completion_kind: 'used',
        });
        expect(mocks.from).not.toHaveBeenCalled();
        expect(mocks.getCurrentUserDisplayName).not.toHaveBeenCalled();
    });

    it('accepts an idempotent empty-container receipt that removed the final linked rows', async () => {
        const cabinetItemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        const inventoryItemId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const requestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
        mocks.rpc.mockResolvedValue({
            data: {
                request_id: requestId,
                cabinet_item_id: cabinetItemId,
                inventory_item_id: inventoryItemId,
                completion_kind: 'empty_container',
                previous_quantity: 1,
                remaining_quantity: 0,
                cabinet_item_removed: true,
                inventory_item_removed: true,
                idempotent: true,
            },
            error: null,
        });

        const receipt = await inventoryService.recordUsageCompletion({
            cabinetItemId,
            requestId,
            completionKind: 'empty_container',
        });

        expect(receipt.remainingQuantity).toBe(0);
        expect(receipt.cabinetItemRemoved).toBe(true);
        expect(receipt.inventoryItemRemoved).toBe(true);
        expect(receipt.idempotent).toBe(true);
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it('rejects a usage-completion receipt whose removal flags contradict the remaining quantity', async () => {
        const cabinetItemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        const requestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
        mocks.rpc.mockResolvedValue({
            data: {
                request_id: requestId,
                cabinet_item_id: cabinetItemId,
                inventory_item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                completion_kind: 'used',
                previous_quantity: 2,
                remaining_quantity: 1,
                cabinet_item_removed: true,
                inventory_item_removed: false,
                idempotent: false,
            },
            error: null,
        });

        await expect(inventoryService.recordUsageCompletion({
            cabinetItemId,
            requestId,
            completionKind: 'used',
        })).rejects.toThrow('사용 완료 처리가 요청과 일치하지 않습니다');
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it('never falls back to direct mutations when usage completion RPC is unavailable', async () => {
        const error = {
            code: 'PGRST202',
            message: 'record_inventory_usage_completion_v2 was not found',
        };
        mocks.rpc.mockResolvedValue({ data: null, error });

        await expect(inventoryService.recordUsageCompletion({
            cabinetItemId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            completionKind: 'used',
        })).rejects.toThrow('사용 완료 처리 기능이 서버에 배포되지 않았습니다');

        expect(mocks.rpc).toHaveBeenCalledTimes(1);
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it('validates usage completion identifiers before calling the server', async () => {
        await expect(inventoryService.recordUsageCompletion({
            cabinetItemId: 'not-a-uuid',
            requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            completionKind: 'used',
        })).rejects.toThrow('cabinetItemId must be a valid UUID');

        await expect(inventoryService.recordUsageCompletion({
            cabinetItemId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            requestId: 'not-a-uuid',
            completionKind: 'used',
        })).rejects.toThrow('requestId must be a valid UUID');

        expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('uses remove_inventory_record_v2 with a one-item array for deleteItem', async () => {
        const item = inventoryItem('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        mocks.rpc.mockResolvedValue(successfulResult([
            { item_id: item.id, item_source: 'inventory' },
        ]));

        await inventoryService.deleteItem(item);

        expect(mocks.rpc).toHaveBeenCalledTimes(1);
        expect(mocks.rpc).toHaveBeenCalledWith('remove_inventory_record_v2', {
            p_items: [{ item_id: item.id, item_source: 'inventory' }],
            p_lab_id: mocks.labState.currentLabId,
            p_actor_name: 'Researcher Kim',
            p_reason: 'Incorrect inventory record',
        });
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it('removes a mixed-source selection with one RPC call', async () => {
        const inventory = inventoryItem('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        const cabinetItem = inventoryItem(
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'cabinet_item',
        );
        const targets = [
            { item_id: inventory.id, item_source: 'inventory' },
            { item_id: cabinetItem.id, item_source: 'cabinet_item' },
        ];
        mocks.rpc.mockResolvedValue(successfulResult(targets));

        const result = await inventoryService.deleteItems([inventory, cabinetItem]);

        expect(mocks.rpc).toHaveBeenCalledTimes(1);
        expect(mocks.rpc).toHaveBeenCalledWith('remove_inventory_record_v2', {
            p_items: targets,
            p_lab_id: mocks.labState.currentLabId,
            p_actor_name: 'Researcher Kim',
            p_reason: 'Incorrect inventory record',
        });
        expect(result).toEqual({ removedCount: 2, items: targets });
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it('does not fall back to direct deletes or waste_logs when the RPC fails', async () => {
        const error = { code: '42501', message: 'Access denied' };
        mocks.rpc.mockResolvedValue({ data: null, error });

        await expect(inventoryService.deleteItems([
            inventoryItem('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
        ])).rejects.toBe(error);

        expect(mocks.rpc).toHaveBeenCalledTimes(1);
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it('does not bypass a missing atomic update RPC with a direct table mutation', async () => {
        const error = { code: 'PGRST202', message: 'update_inventory_item_atomic was not found' };
        mocks.rpc.mockResolvedValue({ data: null, error });

        await expect(inventoryService.updateItem(
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            { name: 'Updated acetone' },
        )).rejects.toBe(error);

        expect(mocks.rpc).toHaveBeenCalledWith('update_inventory_item_atomic', {
            p_item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            p_item_source: 'inventory',
            p_updates: { name: 'Updated acetone' },
            p_actor_name: 'Researcher Kim',
        });
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it('rejects an unexpected partial-looking response instead of updating the UI partially', async () => {
        const first = inventoryItem('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        const second = inventoryItem('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
        mocks.rpc.mockResolvedValue(successfulResult([
            { item_id: first.id, item_source: 'inventory' },
        ]));

        await expect(inventoryService.deleteItems([first, second])).rejects.toThrow(
            '어떤 항목도 부분 삭제로 처리하지 않습니다',
        );
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it('rejects a same-count response that does not match the requested records', async () => {
        const requested = inventoryItem('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        mocks.rpc.mockResolvedValue(successfulResult([
            {
                item_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                item_source: 'inventory',
            },
        ]));

        await expect(inventoryService.deleteItems([requested])).rejects.toThrow(
            '어떤 항목도 부분 삭제로 처리하지 않습니다',
        );
    });

    it('enforces the server contract of 1 to 100 records before calling the RPC', async () => {
        await expect(inventoryService.deleteItems([])).rejects.toThrow('1개 이상 100개 이하');

        const tooMany = Array.from({ length: 101 }, (_, index) =>
            inventoryItem(`${String(index).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`)
        );
        await expect(inventoryService.deleteItems(tooMany)).rejects.toThrow('1개 이상 100개 이하');

        expect(mocks.rpc).not.toHaveBeenCalled();
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it('removes a cabinet placement and its linked inventory through one exact RPC target', async () => {
        const cabinetItemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        const linkedInventoryItemId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const target = { item_id: cabinetItemId, item_source: 'cabinet_item' };
        mocks.rpc.mockResolvedValue(successfulResult([target]));

        await inventoryService.deleteLinkedInventoryByCabinetItemId({
            cabinetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            cabinetItemId,
            linkedInventoryItemId,
            itemName: 'Acetone',
            reasonKey: 'used',
        });

        expect(mocks.rpc).toHaveBeenCalledTimes(1);
        expect(mocks.rpc).toHaveBeenCalledWith('remove_inventory_record_v2', {
            p_items: [target],
            p_lab_id: mocks.labState.currentLabId,
            p_actor_name: 'Researcher Kim',
            p_reason: 'Inventory record removed after full use',
        });
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it('falls back to the exact linked inventory ID only when the cabinet row is already gone', async () => {
        const cabinetItemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        const linkedInventoryItemId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const inventoryTarget = {
            item_id: linkedInventoryItemId,
            item_source: 'inventory',
        };
        mocks.rpc
            .mockResolvedValueOnce({
                data: null,
                error: { code: 'P0002', message: 'Inventory record not found' },
            })
            .mockResolvedValueOnce(successfulResult([inventoryTarget]));

        await inventoryService.deleteLinkedInventoryByCabinetItemId({
            cabinetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            cabinetItemId,
            linkedInventoryItemId,
            itemName: 'Acetone',
            reasonKey: 'expired',
        });

        expect(mocks.rpc).toHaveBeenCalledTimes(2);
        expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'remove_inventory_record_v2', {
            p_items: [inventoryTarget],
            p_lab_id: mocks.labState.currentLabId,
            p_actor_name: 'Researcher Kim',
            p_reason: 'Expired inventory record removed',
        });
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it('clears all linked inventory IDs with one all-or-nothing RPC and no direct delete', async () => {
        const rows = [
            { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
            { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
        ];
        const targets = rows.map((row) => ({
            item_id: row.id,
            item_source: 'inventory',
        }));
        const query = queryResult(rows);
        mocks.from.mockReturnValue(query);
        mocks.rpc.mockResolvedValue(successfulResult(targets));

        await inventoryService.clearCabinetInventory(
            'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            [],
        );

        expect(mocks.from).toHaveBeenCalledWith('inventory');
        expect(query.select).toHaveBeenCalledWith('id');
        expect(query.eq).toHaveBeenNthCalledWith(1, 'cabinet_id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
        expect(query.eq).toHaveBeenNthCalledWith(2, 'storage_type', 'cabinet');
        expect(query.limit).toHaveBeenCalledWith(101);
        expect(query).not.toHaveProperty('delete');
        expect(mocks.rpc).toHaveBeenCalledTimes(1);
        expect(mocks.rpc).toHaveBeenCalledWith('remove_inventory_record_v2', {
            p_items: targets,
            p_lab_id: mocks.labState.currentLabId,
            p_actor_name: 'Researcher Kim',
            p_reason: 'Clear cabinet inventory records',
        });
    });

    it('blocks clear-all above 100 records before any mutation', async () => {
        const rows = Array.from({ length: 101 }, (_, index) => ({
            id: `${String(index).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
        }));
        mocks.from.mockReturnValue(queryResult(rows));

        await expect(inventoryService.clearCabinetInventory(
            'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            [],
        )).rejects.toThrow('100');

        expect(mocks.rpc).not.toHaveBeenCalled();
    });
});
