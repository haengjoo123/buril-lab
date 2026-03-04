/**
 * Inventory Service
 * Manages inventory items (both in-cabinet and standalone storage)
 */

import { supabase } from './supabaseClient';
import { useLabStore } from '../store/useLabStore';
import { getCurrentUserDisplayName } from '../utils/userDisplayName';

// ── Types ──────────────────────────────────────────────
type DisposalReasonKey = 'used' | 'expired' | 'broken' | 'other';
export type InventorySource = 'inventory' | 'cabinet_item';

export interface StorageLocation {
    id: string;
    lab_id: string;
    name: string;
    icon: string;
    created_at: string;
}

export interface InventoryItem {
    id: string;
    lab_id: string | null;
    user_id: string | null;
    name: string;
    brand: string | null;
    product_number: string | null;
    cas_number: string | null;
    quantity: number;
    capacity: string | null;
    storage_type: 'cabinet' | 'other';
    cabinet_id: string | null;
    storage_location_id: string | null;
    product_id: string | null;
    expiry_date: string | null;
    memo: string | null;
    created_at: string;
    updated_at: string;
    // Joined fields (from queries)
    cabinet_name?: string | null;
    shelf_id?: string | null;
    shelf_level?: number | null;
    storage_location_name?: string | null;
    storage_location_icon?: string | null;
    _source?: InventorySource;
}

export interface CreateInventoryInput {
    name: string;
    brand?: string;
    product_number?: string;
    cas_number?: string;
    quantity?: number;
    capacity?: string;
    storage_type: 'cabinet' | 'other';
    cabinet_id?: string;
    storage_location_id?: string;
    product_id?: string;
    expiry_date?: string;
    memo?: string;
}

interface InventoryRow {
    id: string;
    lab_id: string | null;
    user_id: string | null;
    name: string;
    brand: string | null;
    product_number: string | null;
    cas_number: string | null;
    quantity: number;
    capacity: string | null;
    storage_type: 'cabinet' | 'other';
    cabinet_id: string | null;
    storage_location_id: string | null;
    product_id: string | null;
    expiry_date: string | null;
    memo: string | null;
    created_at: string;
    updated_at: string;
}

interface InventoryRowWithRelations extends InventoryRow {
    cabinets: { name: string | null } | null;
    storage_locations: { name: string | null; icon: string | null } | null;
}

interface CabinetItemRowWithCabinet {
    id: string;
    name: string;
    brand: string | null;
    product_number: string | null;
    cas_no: string | null;
    capacity: string | null;
    expiry_date: string | null;
    notes: string | null;
    created_at: string;
    cabinet_id: string;
    shelf_id: string | null;
    cabinets: { name: string | null; lab_id: string | null }[] | null;
}

interface ShelfLevelRow {
    id: string;
    level: number;
}

interface AtomicDeleteRpcParams {
    p_item_id: string;
    p_item_source: InventorySource;
    p_item_name: string;
    p_lab_id: string | null;
    p_cabinet_id: string | null;
    p_cabinet_name: string | null;
    p_storage_location_name: string | null;
    p_disposal_reason: string;
}

// ── Default storage locations ──────────────────────────

const DEFAULT_LOCATIONS: { name: string; icon: string }[] = [
    { name: '냉장고', icon: '🧊' },
    { name: '냉동고', icon: '❄️' },
    { name: '상온 보관', icon: '🌡️' },
    { name: '후드', icon: '🔬' },
    { name: '벤치', icon: '🧪' },
];

// ── Storage Location Service ───────────────────────────

export const storageLocationService = {
    /**
     * Get all storage locations for the current lab.
     * If none exist yet, seed default ones.
     */
    async getLocations(): Promise<StorageLocation[]> {
        const { currentLabId } = useLabStore.getState();

        let query = supabase
            .from('storage_locations')
            .select('*');

        if (currentLabId) {
            query = query.eq('lab_id', currentLabId);
        } else {
            query = query.is('lab_id', null);
        }

        const { data, error } = await query.order('created_at', { ascending: true });

        if (error) {
            console.error('[StorageLocation] fetch error:', error);
            return [];
        }

        // Seed defaults if empty
        if (!data || data.length === 0) {
            return await this.seedDefaults(currentLabId);
        }

        return data;
    },

    /** Seed default locations for a lab or personal space */
    async seedDefaults(labId: string | null): Promise<StorageLocation[]> {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData.user?.id || null;

        const rows = DEFAULT_LOCATIONS.map(loc => ({
            lab_id: labId,
            ...(labId ? {} : { user_id: userId }),
            name: loc.name,
            icon: loc.icon,
        }));

        const { data, error } = await supabase
            .from('storage_locations')
            .insert(rows)
            .select();

        if (error) {
            console.error('[StorageLocation] seed error:', error);
            return [];
        }

        return data || [];
    },

    /** Add a new custom storage location */
    async addLocation(name: string, icon: string = '📦'): Promise<StorageLocation | null> {
        const { currentLabId } = useLabStore.getState();
        const { data: userData } = await supabase.auth.getUser();

        const { data, error } = await supabase
            .from('storage_locations')
            .insert({
                lab_id: currentLabId || null,
                ...(currentLabId ? {} : { user_id: userData.user?.id || null }),
                name,
                icon
            })
            .select()
            .single();

        if (error) {
            console.error('[StorageLocation] add error:', error);
            return null;
        }

        return data;
    },

    /** Delete a storage location */
    async deleteLocation(id: string): Promise<void> {
        const { error } = await supabase
            .from('storage_locations')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('[StorageLocation] delete error:', error);
        }
    },
};

// ── Inventory Service ──────────────────────────────────

export const inventoryService = {
    /**
     * 삭제 로그를 waste_logs에 기록합니다.
     * handler_name 컬럼이 없는 환경에서도 로그 유실을 막기 위해 fallback insert를 시도합니다.
     */
    async logDeleteToWasteLogs(input: {
        userId: string | null;
        labId: string | null;
        chemical: {
            id: string;
            name: string;
            cas_number?: string;
            brand?: string;
            quantity?: number;
            capacity?: string;
            storage_type?: 'cabinet' | 'other';
        };
        location: string;
        memo: string;
    }): Promise<void> {
        const handlerName = await getCurrentUserDisplayName(input.labId);
        const chemicalWithLocation = {
            ...input.chemical,
            deleted_location: input.location,
        };
        const row = {
            user_id: input.userId,
            lab_id: input.labId,
            chemicals: [chemicalWithLocation],
            disposal_category: input.chemical.name,
            handler_name: handlerName || null,
            memo: input.memo,
        };

        const { error } = await supabase.from('waste_logs').insert(row);
        if (!error) return;

        // 하위 스키마 호환: handler_name 미지원 시 재시도
        const fallbackRow = {
            user_id: row.user_id,
            lab_id: row.lab_id,
            chemicals: row.chemicals,
            disposal_category: row.disposal_category,
            memo: row.memo,
        };
        const { error: fallbackError } = await supabase.from('waste_logs').insert(fallbackRow);
        if (fallbackError) {
            throw fallbackError;
        }
    },

    /** Get all inventory items for the current lab (includes cabinet_items) */
    async getItems(): Promise<InventoryItem[]> {
        const { currentLabId } = useLabStore.getState();
        const normalizeText = (value?: string | null) => (value || '').trim().toLowerCase();
        const buildCabinetItemKey = (input: {
            cabinetId?: string | null;
            name?: string | null;
            brand?: string | null;
            productNumber?: string | null;
            capacity?: string | null;
            casNumber?: string | null;
        }) => {
            return [
                normalizeText(input.cabinetId),
                normalizeText(input.name),
                normalizeText(input.brand),
                normalizeText(input.productNumber),
                normalizeText(input.capacity),
                normalizeText(input.casNumber),
            ].join('|');
        };

        // 1. Fetch from inventory table
        let invQuery = supabase
            .from('inventory')
            .select(`
                *,
                cabinets ( name ),
                storage_locations ( name, icon )
            `);

        if (currentLabId) {
            invQuery = invQuery.eq('lab_id', currentLabId);
        } else {
            invQuery = invQuery.is('lab_id', null);
        }

        const { data: invData, error: invError } = await invQuery.order('created_at', { ascending: false });

        if (invError) {
            console.error('[Inventory] fetch error:', invError);
        }

        const inventoryRows = (invData || []) as InventoryRowWithRelations[];
        const inventoryItems: InventoryItem[] = inventoryRows.map((item) => ({
            ...item,
            cabinet_name: item.cabinets?.name || null,
            shelf_id: null,
            shelf_level: null,
            storage_location_name: item.storage_locations?.name || null,
            storage_location_icon: item.storage_locations?.icon || null,
            _source: 'inventory',
        }));

        // 2. Fetch cabinet_items (reagents placed in cabinets)
        let cabQuery = supabase
            .from('cabinet_items')
            .select(`
                id, name, brand, product_number, cas_no, capacity, expiry_date, notes, created_at,
                cabinet_id, shelf_id,
                cabinets!inner ( name, lab_id )
            `);

        // Filter by lab through the cabinets relation
        if (currentLabId) {
            cabQuery = cabQuery.eq('cabinets.lab_id', currentLabId);
        } else {
            cabQuery = cabQuery.is('cabinets.lab_id', null);
        }

        const { data: cabData, error: cabError } = await cabQuery.order('created_at', { ascending: false });

        if (cabError) {
            console.error('[Inventory] cabinet_items fetch error:', cabError);
        }

        // 동일 스펙 다건을 누락시키지 않기 위해 키 단위 "개수" 기반 dedupe 사용
        const linkedCountByKey = new Map<string, number>();
        for (const item of inventoryItems) {
            if (item.storage_type !== 'cabinet') continue;
            const key = buildCabinetItemKey({
                cabinetId: item.cabinet_id,
                name: item.name,
                brand: item.brand,
                productNumber: item.product_number,
                capacity: item.capacity,
                casNumber: item.cas_number,
            });
            linkedCountByKey.set(key, (linkedCountByKey.get(key) || 0) + 1);
        }

        const cabinetRows = (cabData || []) as CabinetItemRowWithCabinet[];
        const cabinetItems: InventoryItem[] = cabinetRows
            .filter((ci) => {
                const key = buildCabinetItemKey({
                    cabinetId: ci.cabinet_id,
                    name: ci.name,
                    brand: ci.brand,
                    productNumber: ci.product_number,
                    capacity: ci.capacity,
                    casNumber: ci.cas_no,
                });
                const remainingLinked = linkedCountByKey.get(key) || 0;
                if (remainingLinked <= 0) return true;
                linkedCountByKey.set(key, remainingLinked - 1);
                return false;
            })
            .map((ci) => ({
                id: ci.id,
                lab_id: ci.cabinets?.[0]?.lab_id || null,
                user_id: null,
                name: ci.name,
                brand: ci.brand || null,
                product_number: ci.product_number || null,
                cas_number: ci.cas_no || null,
                quantity: 1,
                capacity: ci.capacity || null,
                storage_type: 'cabinet' as const,
                cabinet_id: ci.cabinet_id,
                shelf_id: ci.shelf_id || null,
                shelf_level: null,
                storage_location_id: null,
                product_id: null,
                expiry_date: ci.expiry_date || null,
                memo: ci.notes || null,
                created_at: ci.created_at,
                updated_at: ci.created_at,
                cabinet_name: ci.cabinets?.[0]?.name || undefined,
                storage_location_name: undefined,
                storage_location_icon: undefined,
                _source: 'cabinet_item',
            }));

        // Resolve shelf levels for cabinet_items (shelf_id -> level)
        const shelfIds = Array.from(new Set(
            cabinetItems
                .map(item => item.shelf_id)
                .filter((id): id is string => Boolean(id))
        ));

        if (shelfIds.length > 0) {
            const { data: shelfRows, error: shelfError } = await supabase
                .from('cabinet_shelves')
                .select('id, level')
                .in('id', shelfIds);

            if (shelfError) {
                console.error('[Inventory] cabinet_shelves fetch error:', shelfError);
            } else {
                const levelRows = (shelfRows || []) as ShelfLevelRow[];
                const levelMap = new Map<string, number>(
                    levelRows.map((row) => [row.id, Number(row.level)])
                );
                for (const item of cabinetItems) {
                    if (!item.shelf_id) continue;
                    const level = levelMap.get(item.shelf_id);
                    item.shelf_level = Number.isFinite(level) ? (level as number) : null;
                }
            }
        }

        return [...inventoryItems, ...cabinetItems];
    },

    /** Search inventory items by name */
    async searchItems(queryStr: string): Promise<InventoryItem[]> {
        const { currentLabId } = useLabStore.getState();
        if (!queryStr.trim()) return [];

        let query = supabase
            .from('inventory')
            .select(`
                *,
                cabinets ( name ),
                storage_locations ( name, icon )
            `);

        if (currentLabId) {
            query = query.eq('lab_id', currentLabId);
        } else {
            query = query.is('lab_id', null);
        }

        const { data, error } = await query
            .ilike('name', `%${queryStr.trim()}%`)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            console.error('[Inventory] search error:', error);
            return [];
        }

        const rows = (data || []) as InventoryRowWithRelations[];
        return rows.map((item) => ({
            ...item,
            cabinet_name: item.cabinets?.name || null,
            storage_location_name: item.storage_locations?.name || null,
            storage_location_icon: item.storage_locations?.icon || null,
            _source: 'inventory',
        }));
    },

    /** Create a new inventory item */
    async createItem(input: CreateInventoryInput): Promise<InventoryItem | null> {
        const { currentLabId } = useLabStore.getState();
        const { data: userData } = await supabase.auth.getUser();

        const row = {
            lab_id: currentLabId || null,
            user_id: userData.user?.id || null,
            name: input.name,
            brand: input.brand || null,
            product_number: input.product_number || null,
            cas_number: input.cas_number || null,
            quantity: input.quantity ?? 1,
            capacity: input.capacity || null,
            storage_type: input.storage_type,
            cabinet_id: input.storage_type === 'cabinet' ? (input.cabinet_id || null) : null,
            storage_location_id: input.storage_type === 'other' ? (input.storage_location_id || null) : null,
            product_id: input.product_id || null,
            expiry_date: input.expiry_date || null,
            memo: input.memo || null,
        };

        const { data, error } = await supabase
            .from('inventory')
            .insert(row)
            .select()
            .single();

        if (error) {
            console.error('[Inventory] create error:', error);
            return null;
        }

        return data;
    },

    /** Update an inventory item */
    async updateItem(id: string, updates: Partial<CreateInventoryInput>, source: InventorySource = 'inventory'): Promise<void> {
        if (source === 'cabinet_item') {
            const cabinetItemUpdates: Record<string, string | null> = {};
            if (updates.name !== undefined) cabinetItemUpdates.name = updates.name.trim();
            if (updates.brand !== undefined) cabinetItemUpdates.brand = updates.brand || null;
            if (updates.product_number !== undefined) cabinetItemUpdates.product_number = updates.product_number || null;
            if (updates.cas_number !== undefined) cabinetItemUpdates.cas_no = updates.cas_number || null;
            if (updates.capacity !== undefined) cabinetItemUpdates.capacity = updates.capacity || null;
            if (updates.expiry_date !== undefined) cabinetItemUpdates.expiry_date = updates.expiry_date || null;
            if (updates.memo !== undefined) cabinetItemUpdates.notes = updates.memo || null;

            if (Object.keys(cabinetItemUpdates).length === 0) return;

            const { error } = await supabase
                .from('cabinet_items')
                .update(cabinetItemUpdates)
                .eq('id', id);
            if (error) {
                console.error('[Inventory] update cabinet_item error:', error);
                throw error;
            }
            return;
        }

        const payload: Record<string, string | number | null> = {};
        if (updates.name !== undefined) payload.name = updates.name.trim();
        if (updates.brand !== undefined) payload.brand = updates.brand || null;
        if (updates.product_number !== undefined) payload.product_number = updates.product_number || null;
        if (updates.cas_number !== undefined) payload.cas_number = updates.cas_number || null;
        if (updates.quantity !== undefined) payload.quantity = Math.max(1, updates.quantity);
        if (updates.capacity !== undefined) payload.capacity = updates.capacity || null;
        if (updates.product_id !== undefined) payload.product_id = updates.product_id || null;
        if (updates.expiry_date !== undefined) payload.expiry_date = updates.expiry_date || null;
        if (updates.memo !== undefined) payload.memo = updates.memo || null;

        if (updates.storage_type !== undefined) {
            payload.storage_type = updates.storage_type;
            payload.cabinet_id = updates.storage_type === 'cabinet' ? (updates.cabinet_id || null) : null;
            payload.storage_location_id = updates.storage_type === 'other' ? (updates.storage_location_id || null) : null;
        } else {
            if (updates.cabinet_id !== undefined) payload.cabinet_id = updates.cabinet_id || null;
            if (updates.storage_location_id !== undefined) payload.storage_location_id = updates.storage_location_id || null;
        }

        if (Object.keys(payload).length === 0) return;

        const { error } = await supabase
            .from('inventory')
            .update(payload)
            .eq('id', id);
        if (error) {
            console.error('[Inventory] update error:', error);
            throw error;
        }
    },

    /** Delete an inventory item through an atomic DB RPC transaction */
    async deleteItem(item: InventoryItem): Promise<void> {
        const source: InventorySource = item._source || 'inventory';
        const payload: AtomicDeleteRpcParams = {
            p_item_id: item.id,
            p_item_source: source,
            p_item_name: item.name,
            p_lab_id: item.lab_id || null,
            p_cabinet_id: item.cabinet_id || null,
            p_cabinet_name: item.cabinet_name || null,
            p_storage_location_name: item.storage_location_name || null,
            p_disposal_reason: '재고 목록에서 삭제',
        };

        const { error } = await supabase.rpc('delete_inventory_item_atomic', payload);
        if (error) {
            const missingRpc =
                error.code === '42883' ||
                error.code === 'PGRST202' ||
                String(error.message || '').includes('delete_inventory_item_atomic');
            if (missingRpc) {
                throw new Error('삭제 RPC가 배포되지 않았습니다. `database/delete_inventory_item_atomic.sql`을 먼저 적용해주세요.');
            }
            console.error('[Inventory] atomic delete error:', error);
            throw error;
        }
    },

    /**
     * Called from cabinet 3D view when a reagent is removed.
     * Cleans up any linked inventory row.
     */
    async deleteLinkedInventoryByCabinetItemId(
        cabinetId: string,
        itemName: string,
        reasonKey?: DisposalReasonKey
    ): Promise<void> {
        const reasonLabelMap: Record<DisposalReasonKey, string> = {
            used: '사용완료',
            expired: '유효기간 만료',
            broken: '파손',
            other: '기타',
        };
        const disposalReason = reasonKey ? reasonLabelMap[reasonKey] : '단순 삭제';

        const { data: cabinetInfo } = await supabase
            .from('cabinets')
            .select('name, lab_id')
            .eq('id', cabinetId)
            .maybeSingle();

        const { data: matchedInventory } = await supabase
            .from('inventory')
            .select('id, lab_id, name, cas_number, brand, quantity, capacity, storage_type')
            .eq('cabinet_id', cabinetId)
            .eq('storage_type', 'cabinet')
            .eq('name', itemName)
            .limit(1)
            .maybeSingle();

        if (matchedInventory) {
            // Delete it
            await supabase
                .from('inventory')
                .delete()
                .eq('id', matchedInventory.id);

            // Add to waste_logs
            try {
                const { data: userData } = await supabase.auth.getUser();
                await this.logDeleteToWasteLogs({
                    userId: userData.user?.id || null,
                    labId: matchedInventory.lab_id || cabinetInfo?.lab_id || null,
                    chemical: {
                        id: matchedInventory.id,
                        name: matchedInventory.name,
                        cas_number: matchedInventory.cas_number || undefined,
                        brand: matchedInventory.brand || undefined,
                        quantity: matchedInventory.quantity,
                        capacity: matchedInventory.capacity || undefined,
                        storage_type: matchedInventory.storage_type,
                    },
                    location: cabinetInfo?.name || '시약장',
                    memo: disposalReason,
                });
            } catch (err) {
                console.error('[Inventory] linked waste_log error (non-fatal):', err);
            }
            return;
        }

        // 연결된 inventory 행이 없어도, 시약장 삭제 정보는 최소한 이름 기준으로 남깁니다.
        try {
            const { currentLabId } = useLabStore.getState();
            const { data: userData } = await supabase.auth.getUser();
            await this.logDeleteToWasteLogs({
                userId: userData.user?.id || null,
                labId: currentLabId || cabinetInfo?.lab_id || null,
                chemical: {
                    id: `cabinet:${cabinetId}:${itemName}`,
                    name: itemName,
                    storage_type: 'cabinet',
                },
                location: cabinetInfo?.name || '시약장',
                memo: disposalReason,
            });
        } catch (err) {
            console.error('[Inventory] fallback linked waste_log error (non-fatal):', err);
        }
    },
};
