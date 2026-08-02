/**
 * Inventory Service
 * Manages inventory items (both in-cabinet and standalone storage)
 */

import { supabase } from './supabaseClient';
import { useLabStore } from '../store/useLabStore';
import { getCurrentUserDisplayName } from '../utils/userDisplayName';
import type { ReagentTemplateType } from '../types/fridge';

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
    remaining_percent: number | null;
    created_at: string;
    updated_at: string;
    // Joined fields (from queries)
    cabinet_name?: string | null;
    shelf_id?: string | null;
    shelf_level?: number | null;
    storage_location_name?: string | null;
    storage_location_icon?: string | null;
    linked_inventory_item_id?: string | null;
    placement_template?: ReagentTemplateType | null;
    placement_width?: number | null;
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
    remaining_percent?: number;
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
    remaining_percent: number | null;
    created_at: string;
    updated_at: string;
}

interface InventoryRowWithRelations extends InventoryRow {
    cabinets: { name: string | null } | null;
    storage_locations: { name: string | null; icon: string | null } | null;
}

interface CabinetItemRowWithCabinet {
    id: string;
    inventory_item_id: string | null;
    name: string;
    brand: string | null;
    product_number: string | null;
    cas_no: string | null;
    capacity: string | null;
    expiry_date: string | null;
    notes: string | null;
    remaining_percent: number | null;
    created_at: string;
    cabinet_id: string;
    shelf_id: string | null;
    template: ReagentTemplateType | null;
    width: number | null;
    cabinets: { name: string | null; lab_id: string | null } | { name: string | null; lab_id: string | null }[] | null;
}

interface ShelfLevelRow {
    id: string;
    level: number;
}

export interface InventoryRemovalTarget {
    item_id: string;
    item_source: InventorySource;
}

export interface InventoryRemovalResult {
    removedCount: number;
    items: InventoryRemovalTarget[];
}

export interface InventoryMovePlacement {
    shelf_id: string;
    template: ReagentTemplateType;
    width: number;
    position: number;
    depth_position: number;
}

export interface InventoryMoveTarget {
    item_id: string;
    item_source: InventorySource;
    placement?: InventoryMovePlacement;
}

export type InventoryMoveDestination =
    | { storage_type: 'cabinet'; cabinet_id: string }
    | { storage_type: 'other'; storage_location_id: string };

export interface InventoryMoveLocationSnapshot {
    storageType: 'cabinet' | 'other';
    cabinetId: string | null;
    storageLocationId: string | null;
}

export interface InventoryMoveReceiptItem {
    itemId: string;
    itemSource: InventorySource;
    inventoryItemId: string | null;
    cabinetItemId: string | null;
    source: InventoryMoveLocationSnapshot;
    destination: InventoryMoveLocationSnapshot;
}

export interface InventoryMoveReceipt {
    requestId: string;
    movedCount: number;
    movedItems: InventoryMoveReceiptItem[];
    destination: InventoryMoveDestination;
    idempotent: boolean;
}

export type InventoryUsageCompletionKind = 'used' | 'empty_container';

export interface InventoryUsageCompletionReceipt {
    requestId: string;
    cabinetItemId: string;
    inventoryItemId: string | null;
    completionKind: InventoryUsageCompletionKind;
    previousQuantity: number;
    remainingQuantity: number;
    cabinetItemRemoved: boolean;
    inventoryItemRemoved: boolean;
    idempotent: boolean;
}

interface LinkedCabinetCasSyncInput {
    source: InventorySource;
    sourceId?: string | null;
    cabinetId?: string | null;
    linkedInventoryItemId?: string | null;
    name: string;
    brand?: string | null;
    productNumber?: string | null;
    capacity?: string | null;
    previousCasNumber?: string | null;
    nextCasNumber?: string | null;
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

function normalizeLinkedText(value?: string | null): string {
    return (value || '').trim().toLowerCase();
}

function normalizeLinkedCas(value?: string | null): string {
    return (value || '').replace(/[^0-9-]/g, '').trim();
}

async function getLinkedInventoryIdsForCabinet(cabinetId?: string | null): Promise<Set<string>> {
    if (!cabinetId) return new Set<string>();

    const { data, error } = await supabase
        .from('cabinet_items')
        .select('inventory_item_id')
        .eq('cabinet_id', cabinetId)
        .not('inventory_item_id', 'is', null);

    if (error) throw error;

    return new Set(
        (data || [])
            .map((row: { inventory_item_id?: string | null }) => row.inventory_item_id)
            .filter((id): id is string => Boolean(id))
    );
}

async function findLinkedCabinetItemIdByInventoryId(
    inventoryItemId: string,
    cabinetId?: string | null
): Promise<string | null> {
    let query = supabase
        .from('cabinet_items')
        .select('id')
        .eq('inventory_item_id', inventoryItemId);

    if (cabinetId) {
        query = query.eq('cabinet_id', cabinetId);
    }

    const { data, error } = await query.limit(1).maybeSingle();
    if (error) throw error;

    return data?.id || null;
}

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

        // 동일 lab_id + name 조합이 중복되어 있으면(예: seed 중복 실행) 하나만 노출
        const seen = new Set<string>();
        return data.filter((row) => {
            const key = `${row.lab_id ?? ''}\0${(row.name || '').trim()}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
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

const MAX_ATOMIC_REMOVAL_ITEMS = 100;
const RECORD_REMOVAL_REASON = 'Incorrect inventory record';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CABINET_RECORD_REMOVAL_REASONS: Record<DisposalReasonKey, string> = {
    used: 'Inventory record removed after full use',
    expired: 'Expired inventory record removed',
    broken: 'Broken inventory record removed',
    other: 'Cabinet inventory record removed',
};

const isInventoryRecordNotFoundError = (error: unknown): boolean => {
    if (!error || typeof error !== 'object' || Array.isArray(error)) return false;
    return (error as { code?: unknown }).code === 'P0002';
};

export const createInventoryOperationRequestId = (): string => {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }

    throw new Error('This environment cannot create an idempotency key.');
};

const parseUsageCompletionReceipt = (
    value: unknown,
    expected: {
        requestId: string;
        cabinetItemId: string;
        completionKind: InventoryUsageCompletionKind;
    },
): InventoryUsageCompletionReceipt => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('사용 완료 처리 결과를 확인할 수 없습니다. 재고 목록을 새로고침한 뒤 다시 확인해 주세요.');
    }

    const payload = value as Record<string, unknown>;
    const read = (snakeCase: string, camelCase: string): unknown =>
        payload[snakeCase] ?? payload[camelCase];
    const requestId = read('request_id', 'requestId');
    const cabinetItemId = read('cabinet_item_id', 'cabinetItemId');
    const inventoryItemId = read('inventory_item_id', 'inventoryItemId');
    const completionKind = read('completion_kind', 'completionKind');
    const previousQuantity = read('previous_quantity', 'previousQuantity');
    const remainingQuantity = read('remaining_quantity', 'remainingQuantity');
    const cabinetItemRemoved = read('cabinet_item_removed', 'cabinetItemRemoved');
    const inventoryItemRemoved = read('inventory_item_removed', 'inventoryItemRemoved');
    const idempotent = payload.idempotent;

    const quantitiesAreValid = Number.isInteger(previousQuantity) &&
        Number.isInteger(remainingQuantity) &&
        (previousQuantity as number) >= 1 &&
        (remainingQuantity as number) === (previousQuantity as number) - 1;
    const removalFlagsAreValid = typeof cabinetItemRemoved === 'boolean' &&
        typeof inventoryItemRemoved === 'boolean' &&
        cabinetItemRemoved === ((remainingQuantity as number) === 0) &&
        inventoryItemRemoved === ((remainingQuantity as number) === 0) &&
        cabinetItemRemoved === inventoryItemRemoved;

    if (requestId !== expected.requestId ||
        cabinetItemId !== expected.cabinetItemId ||
        completionKind !== expected.completionKind ||
        typeof inventoryItemId !== 'string' ||
        !UUID_PATTERN.test(inventoryItemId) ||
        typeof idempotent !== 'boolean' ||
        !quantitiesAreValid ||
        !removalFlagsAreValid) {
        throw new Error('사용 완료 처리가 요청과 일치하지 않습니다. 재고 목록을 새로고침한 뒤 다시 확인해 주세요.');
    }

    return {
        requestId,
        cabinetItemId,
        inventoryItemId,
        completionKind,
        previousQuantity,
        remainingQuantity,
        cabinetItemRemoved,
        inventoryItemRemoved,
        idempotent,
    } as InventoryUsageCompletionReceipt;
};

const normalizeMoveLocationSnapshot = (
    value: unknown,
): InventoryMoveLocationSnapshot | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const storageType = record.storage_type ?? record.storageType;
    const cabinetId = record.cabinet_id ?? record.cabinetId ?? null;
    const storageLocationId = record.storage_location_id ?? record.storageLocationId ?? null;
    if ((storageType !== 'cabinet' && storageType !== 'other') ||
        (cabinetId !== null && (typeof cabinetId !== 'string' || !UUID_PATTERN.test(cabinetId))) ||
        (storageLocationId !== null &&
            (typeof storageLocationId !== 'string' || !UUID_PATTERN.test(storageLocationId)))) {
        return null;
    }
    if (storageType === 'cabinet' && (!cabinetId || storageLocationId !== null)) return null;
    if (storageType === 'other' && cabinetId !== null) return null;

    return { storageType, cabinetId, storageLocationId };
};

const destinationMatches = (
    snapshot: InventoryMoveLocationSnapshot,
    expected: InventoryMoveDestination,
): boolean => expected.storage_type === 'cabinet'
    ? snapshot.storageType === 'cabinet' &&
        snapshot.cabinetId === expected.cabinet_id &&
        snapshot.storageLocationId === null
    : snapshot.storageType === 'other' &&
        snapshot.cabinetId === null &&
        snapshot.storageLocationId === expected.storage_location_id;

const parseInventoryMoveReceipt = (
    value: unknown,
    expected: {
        requestId: string;
        targets: InventoryMoveTarget[];
        destination: InventoryMoveDestination;
    },
): InventoryMoveReceipt => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('The inventory-move RPC returned an invalid atomic receipt.');
    }
    const payload = value as Record<string, unknown>;
    const requestId = payload.request_id ?? payload.requestId;
    const movedCount = payload.moved_count ?? payload.movedCount;
    const rawItems = payload.moved_items ?? payload.movedItems;
    const destination = normalizeMoveLocationSnapshot(payload.destination);
    const idempotent = payload.idempotent;
    const movedItems = Array.isArray(rawItems)
        ? rawItems.flatMap((candidate): InventoryMoveReceiptItem[] => {
            if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
            const item = candidate as Record<string, unknown>;
            const itemId = item.item_id ?? item.itemId;
            const itemSource = item.item_source ?? item.itemSource;
            const inventoryItemId = item.inventory_item_id ?? item.inventoryItemId ?? null;
            const cabinetItemId = item.cabinet_item_id ?? item.cabinetItemId ?? null;
            const source = normalizeMoveLocationSnapshot(item.source);
            const itemDestination = normalizeMoveLocationSnapshot(item.destination);
            if (typeof itemId !== 'string' || !UUID_PATTERN.test(itemId) ||
                (itemSource !== 'inventory' && itemSource !== 'cabinet_item') ||
                (inventoryItemId !== null &&
                    (typeof inventoryItemId !== 'string' || !UUID_PATTERN.test(inventoryItemId))) ||
                (cabinetItemId !== null &&
                    (typeof cabinetItemId !== 'string' || !UUID_PATTERN.test(cabinetItemId))) ||
                !source ||
                !itemDestination ||
                !destinationMatches(itemDestination, expected.destination)) {
                return [];
            }
            if ((itemSource === 'inventory' && inventoryItemId !== itemId) ||
                (itemSource === 'cabinet_item' && cabinetItemId !== itemId)) {
                return [];
            }
            return [{
                itemId,
                itemSource,
                inventoryItemId,
                cabinetItemId,
                source,
                destination: itemDestination,
            }];
        })
        : [];
    const expectedKeys = new Set(expected.targets.map((target) => (
        `${target.item_source}:${target.item_id}`
    )));
    const returnedKeys = new Set(movedItems.map((item) => (
        `${item.itemSource}:${item.itemId}`
    )));
    const exactTargets = expectedKeys.size === returnedKeys.size &&
        [...expectedKeys].every((key) => returnedKeys.has(key));

    if (requestId !== expected.requestId ||
        movedCount !== expected.targets.length ||
        movedItems.length !== expected.targets.length ||
        !destination ||
        !destinationMatches(destination, expected.destination) ||
        typeof idempotent !== 'boolean' ||
        !exactTargets) {
        throw new Error('The inventory-move RPC returned an invalid atomic receipt.');
    }

    return {
        requestId,
        movedCount,
        movedItems,
        destination: expected.destination,
        idempotent,
    } as InventoryMoveReceipt;
};

const parseRemovalResult = (
    value: unknown,
    expectedTargets: InventoryRemovalTarget[],
): InventoryRemovalResult => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('재고 데이터 삭제 결과를 확인할 수 없습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.');
    }

    const payload = value as {
        removed_count?: unknown;
        removed_items?: unknown;
        items?: unknown;
    };
    const rawItems = Array.isArray(payload.removed_items)
        ? payload.removed_items
        : Array.isArray(payload.items)
            ? payload.items
            : [];
    const items = rawItems.filter((item): item is InventoryRemovalTarget => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        const candidate = item as Partial<InventoryRemovalTarget>;
        return typeof candidate.item_id === 'string' &&
            (candidate.item_source === 'inventory' || candidate.item_source === 'cabinet_item');
    });
    const removedCount = typeof payload.removed_count === 'number'
        ? payload.removed_count
        : Number.NaN;

    const expectedKeys = new Set(
        expectedTargets.map((item) => `${item.item_source}:${item.item_id}`)
    );
    const returnedKeys = new Set(
        items.map((item) => `${item.item_source}:${item.item_id}`)
    );
    const resultMatchesRequest = expectedKeys.size === returnedKeys.size &&
        [...expectedKeys].every((key) => returnedKeys.has(key));

    if (removedCount !== expectedTargets.length ||
        items.length !== expectedTargets.length ||
        !resultMatchesRequest) {
        throw new Error('재고 데이터 삭제가 완료되지 않았습니다. 어떤 항목도 부분 삭제로 처리하지 않습니다.');
    }

    return { removedCount, items };
};

const removeInventoryRecords = async (
    targets: InventoryRemovalTarget[],
    labId: string | null,
    actorName: string | null,
    reason: string = RECORD_REMOVAL_REASON,
): Promise<InventoryRemovalResult> => {
    if (targets.length < 1 || targets.length > MAX_ATOMIC_REMOVAL_ITEMS) {
        throw new Error('재고 데이터는 한 번에 1개 이상 100개 이하로 삭제할 수 있습니다.');
    }

    const seen = new Set<string>();
    for (const target of targets) {
        const key = `${target.item_source}:${target.item_id}`;
        if (!target.item_id || seen.has(key)) {
            throw new Error('중복되거나 올바르지 않은 재고 삭제 항목이 포함되어 있습니다.');
        }
        seen.add(key);
    }

    const { data, error } = await supabase.rpc('remove_inventory_record_v2', {
        p_items: targets,
        p_lab_id: labId,
        p_actor_name: actorName,
        p_reason: reason,
    });

    if (error) {
        const errorText = String(error.message || '');
        const missingRpc = error.code === '42883' ||
            error.code === 'PGRST202' ||
            errorText.includes('remove_inventory_record_v2');
        if (missingRpc) {
            throw new Error('재고 데이터 삭제 기능이 서버에 배포되지 않았습니다. 관리자에게 문의해 주세요.');
        }
        if (!isInventoryRecordNotFoundError(error)) {
            console.error('[Inventory] V2 record removal error:', error);
        }
        throw error;
    }

    return parseRemovalResult(data, targets);
};

export const inventoryService = {
    /** Get all inventory items for the current lab (includes cabinet_items) */
    async getItems(): Promise<InventoryItem[]> {
        const { currentLabId } = useLabStore.getState();
        const getCabinetRelation = (
            relation: CabinetItemRowWithCabinet['cabinets']
        ): { name: string | null; lab_id: string | null } | null => {
            if (!relation) return null;
            return Array.isArray(relation) ? (relation[0] || null) : relation;
        };
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
                id, inventory_item_id, name, brand, product_number, cas_no, capacity, expiry_date, notes, created_at,
                cabinet_id, shelf_id, template, width, remaining_percent,
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
        const cabinetRows = (cabData || []) as CabinetItemRowWithCabinet[];
        const linkedCabinetRowByInventoryId = new Map<string, CabinetItemRowWithCabinet>(
            cabinetRows
                .filter((row): row is CabinetItemRowWithCabinet & { inventory_item_id: string } => Boolean(row.inventory_item_id))
                .map((row) => [row.inventory_item_id, row])
        );

        for (const item of inventoryItems) {
            if (item.storage_type !== 'cabinet') continue;
            const linkedCabinetRow = linkedCabinetRowByInventoryId.get(item.id);
            if (!linkedCabinetRow) continue;
            item.shelf_id = linkedCabinetRow.shelf_id || null;
            item.placement_template = linkedCabinetRow.template || null;
            item.placement_width = Number.isFinite(Number(linkedCabinetRow.width))
                ? Number(linkedCabinetRow.width)
                : null;
        }

        const inventoryItemIdSet = new Set(inventoryItems.map((item) => item.id));
        const exactLinkedInventoryIds = new Set(
            cabinetRows
                .map((row) => row.inventory_item_id)
                .filter((id): id is string => Boolean(id && inventoryItemIdSet.has(id)))
        );
        const legacyLinkedCountByKey = new Map<string, number>();

        for (const item of inventoryItems) {
            if (item.storage_type !== 'cabinet') continue;
            if (exactLinkedInventoryIds.has(item.id)) continue;

            const key = buildCabinetItemKey({
                cabinetId: item.cabinet_id,
                name: item.name,
                brand: item.brand,
                productNumber: item.product_number,
                capacity: item.capacity,
                casNumber: item.cas_number,
            });
            legacyLinkedCountByKey.set(key, (legacyLinkedCountByKey.get(key) || 0) + 1);
        }

        const cabinetItems: InventoryItem[] = cabinetRows
            .filter((ci) => {
                if (ci.inventory_item_id && inventoryItemIdSet.has(ci.inventory_item_id)) {
                    return false;
                }

                const key = buildCabinetItemKey({
                    cabinetId: ci.cabinet_id,
                    name: ci.name,
                    brand: ci.brand,
                    productNumber: ci.product_number,
                    capacity: ci.capacity,
                    casNumber: ci.cas_no,
                });
                const remainingLinked = legacyLinkedCountByKey.get(key) || 0;
                if (remainingLinked <= 0) return true;
                legacyLinkedCountByKey.set(key, remainingLinked - 1);
                return false;
            })
            .map((ci) => ({
                id: ci.id,
                lab_id: getCabinetRelation(ci.cabinets)?.lab_id || null,
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
                remaining_percent: ci.remaining_percent ?? null,
                created_at: ci.created_at,
                updated_at: ci.created_at,
                cabinet_name: getCabinetRelation(ci.cabinets)?.name || undefined,
                storage_location_name: undefined,
                storage_location_icon: undefined,
                linked_inventory_item_id: ci.inventory_item_id ?? null,
                placement_template: ci.template || null,
                placement_width: Number.isFinite(Number(ci.width)) ? Number(ci.width) : null,
                _source: 'cabinet_item',
            }));

        // Resolve shelf levels for cabinet_items (shelf_id -> level)
        const shelfIds = Array.from(new Set(
            [...inventoryItems, ...cabinetItems]
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
                for (const item of [...inventoryItems, ...cabinetItems]) {
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
        const actorName = await getCurrentUserDisplayName(currentLabId);

        const payload = {
            p_name: input.name,
            p_storage_type: input.storage_type,
            p_brand: input.brand || null,
            p_product_number: input.product_number || null,
            p_cas_number: input.cas_number || null,
            p_quantity: input.quantity ?? 1,
            p_capacity: input.capacity || null,
            p_cabinet_id: input.storage_type === 'cabinet' ? (input.cabinet_id || null) : null,
            p_storage_location_id: input.storage_type === 'other' ? (input.storage_location_id || null) : null,
            p_product_id: input.product_id || null,
            p_expiry_date: input.expiry_date || null,
            p_memo: input.memo || null,
            p_remaining_percent: input.remaining_percent ?? null,
            p_lab_id: currentLabId || null,
            p_actor_user_id: userData.user?.id || null,
            p_actor_name: actorName || null,
        };

        const { data, error } = await supabase.rpc('create_inventory_item_atomic', payload);

        if (error) {
            console.error('[Inventory] atomic create error:', error);
            return null;
        }

        return data as unknown as InventoryItem;
    },

    /** Update an inventory item */
    async updateItem(id: string, updates: Partial<CreateInventoryInput>, source: InventorySource = 'inventory'): Promise<void> {
        const { currentLabId } = useLabStore.getState();
        const actorName = await getCurrentUserDisplayName(currentLabId);

        const payloadRecord: Record<string, unknown> = {};

        if (source === 'cabinet_item') {
            if (updates.name !== undefined) payloadRecord.name = updates.name.trim();
            if (updates.brand !== undefined) payloadRecord.brand = updates.brand || null;
            if (updates.product_number !== undefined) payloadRecord.product_number = updates.product_number || null;
            if (updates.cas_number !== undefined) payloadRecord.cas_no = updates.cas_number || null;
            if (updates.capacity !== undefined) payloadRecord.capacity = updates.capacity || null;
            if (updates.expiry_date !== undefined) payloadRecord.expiry_date = updates.expiry_date || null;
            if (updates.memo !== undefined) payloadRecord.notes = updates.memo || null;
            if (updates.remaining_percent !== undefined) payloadRecord.remaining_percent = updates.remaining_percent ?? null;
        } else {
            if (updates.name !== undefined) payloadRecord.name = updates.name.trim();
            if (updates.brand !== undefined) payloadRecord.brand = updates.brand || null;
            if (updates.product_number !== undefined) payloadRecord.product_number = updates.product_number || null;
            if (updates.cas_number !== undefined) payloadRecord.cas_number = updates.cas_number || null;
            if (updates.quantity !== undefined) payloadRecord.quantity = Math.max(1, updates.quantity);
            if (updates.capacity !== undefined) payloadRecord.capacity = updates.capacity || null;
            if (updates.product_id !== undefined) payloadRecord.product_id = updates.product_id || null;
            if (updates.expiry_date !== undefined) payloadRecord.expiry_date = updates.expiry_date || null;
            if (updates.memo !== undefined) payloadRecord.memo = updates.memo || null;
            if (updates.remaining_percent !== undefined) payloadRecord.remaining_percent = updates.remaining_percent ?? null;

            if (updates.storage_type !== undefined) {
                payloadRecord.storage_type = updates.storage_type;
                payloadRecord.cabinet_id = updates.storage_type === 'cabinet' ? (updates.cabinet_id || null) : null;
                payloadRecord.storage_location_id = updates.storage_type === 'other' ? (updates.storage_location_id || null) : null;
            } else {
                if (updates.cabinet_id !== undefined) payloadRecord.cabinet_id = updates.cabinet_id || null;
                if (updates.storage_location_id !== undefined) payloadRecord.storage_location_id = updates.storage_location_id || null;
            }
        }

        if (Object.keys(payloadRecord).length === 0) return;

        const payload = {
            p_item_id: id,
            p_item_source: source,
            p_updates: payloadRecord,
            p_actor_name: actorName || null,
        };

        const { error } = await supabase.rpc('update_inventory_item_atomic', payload);
        if (error) {
            console.error('[Inventory] atomic update error:', error);
            throw error;
        }
    },

    async syncLinkedCabinetItemFromInventory(input: {
        inventoryItemId: string;
        cabinetId?: string | null;
        updates: Partial<CreateInventoryInput>;
    }): Promise<boolean> {
        const linkedCabinetItemId = await findLinkedCabinetItemIdByInventoryId(
            input.inventoryItemId,
            input.cabinetId
        );
        if (!linkedCabinetItemId) return false;

        const cabinetUpdates: Partial<CreateInventoryInput> = {};
        if (input.updates.name !== undefined) cabinetUpdates.name = input.updates.name;
        if (input.updates.brand !== undefined) cabinetUpdates.brand = input.updates.brand;
        if (input.updates.product_number !== undefined) cabinetUpdates.product_number = input.updates.product_number;
        if (input.updates.cas_number !== undefined) cabinetUpdates.cas_number = input.updates.cas_number;
        if (input.updates.capacity !== undefined) cabinetUpdates.capacity = input.updates.capacity;
        if (input.updates.expiry_date !== undefined) cabinetUpdates.expiry_date = input.updates.expiry_date;
        if (input.updates.memo !== undefined) cabinetUpdates.memo = input.updates.memo;
        if (input.updates.remaining_percent !== undefined) cabinetUpdates.remaining_percent = input.updates.remaining_percent;

        await inventoryService.updateItem(linkedCabinetItemId, cabinetUpdates, 'cabinet_item');
        return true;
    },

    async setCabinetItemInventoryLink(cabinetItemId: string, inventoryItemId: string | null): Promise<void> {
        const { error } = await supabase
            .from('cabinet_items')
            .update({ inventory_item_id: inventoryItemId })
            .eq('id', cabinetItemId);

        if (error) throw error;
    },

    async syncLinkedCabinetCas(input: LinkedCabinetCasSyncInput): Promise<void> {
        if (!input.cabinetId) return;

        const normalizedName = normalizeLinkedText(input.name);
        if (!normalizedName) return;

        const normalizedBrand = normalizeLinkedText(input.brand);
        const normalizedProductNumber = normalizeLinkedText(input.productNumber);
        const normalizedCapacity = normalizeLinkedText(input.capacity);
        const normalizedPreviousCas = normalizeLinkedCas(input.previousCasNumber);
        const nextCasNumber = input.nextCasNumber?.trim() || '';

        const metadataMatches = (row: {
            name?: string | null;
            brand?: string | null;
            product_number?: string | null;
            capacity?: string | null;
        }) => (
            normalizeLinkedText(row.name) === normalizedName
            && normalizeLinkedText(row.brand) === normalizedBrand
            && normalizeLinkedText(row.product_number) === normalizedProductNumber
            && normalizeLinkedText(row.capacity) === normalizedCapacity
        );

        if (input.source === 'inventory') {
            if (input.sourceId) {
                const linkedCabinetItemId = await findLinkedCabinetItemIdByInventoryId(
                    input.sourceId,
                    input.cabinetId
                );
                if (linkedCabinetItemId) {
                    await inventoryService.updateItem(linkedCabinetItemId, { cas_number: nextCasNumber }, 'cabinet_item');
                    return;
                }
            }

            const { data, error } = await supabase
                .from('cabinet_items')
                .select('id, name, brand, product_number, capacity, cas_no')
                .eq('cabinet_id', input.cabinetId)
                .is('inventory_item_id', null)
                .eq('name', input.name);

            if (error) throw error;

            const rows = (data || []) as Array<{
                id: string;
                name: string | null;
                brand: string | null;
                product_number: string | null;
                capacity: string | null;
                cas_no: string | null;
            }>;

            const strongMatches = rows.filter((row) =>
                metadataMatches(row)
                && normalizeLinkedCas(row.cas_no) === normalizedPreviousCas
                && row.id !== input.sourceId
            );
            const softMatches = rows.filter((row) =>
                metadataMatches(row)
                && row.id !== input.sourceId
            );
            const targetRows = strongMatches.length > 0 ? strongMatches : (softMatches.length === 1 ? softMatches : []);

            for (const row of targetRows) {
                await inventoryService.updateItem(row.id, { cas_number: nextCasNumber }, 'cabinet_item');
            }
            return;
        }

        if (input.linkedInventoryItemId) {
            await inventoryService.updateItem(input.linkedInventoryItemId, { cas_number: nextCasNumber }, 'inventory');
            return;
        }

        const linkedInventoryIds = await getLinkedInventoryIdsForCabinet(input.cabinetId);
        const { data, error } = await supabase
            .from('inventory')
            .select('id, name, brand, product_number, capacity, cas_number')
            .eq('cabinet_id', input.cabinetId)
            .eq('storage_type', 'cabinet')
            .eq('name', input.name);

        if (error) throw error;

        const rows = (data || []) as Array<{
            id: string;
            name: string | null;
            brand: string | null;
            product_number: string | null;
            capacity: string | null;
            cas_number: string | null;
        }>;

        const strongMatches = rows.filter((row) =>
            metadataMatches(row)
            && normalizeLinkedCas(row.cas_number) === normalizedPreviousCas
            && !linkedInventoryIds.has(row.id)
            && row.id !== input.sourceId
        );
        const softMatches = rows.filter((row) =>
            metadataMatches(row)
            && !linkedInventoryIds.has(row.id)
            && row.id !== input.sourceId
        );
        const targetRows = strongMatches.length > 0 ? strongMatches : (softMatches.length === 1 ? softMatches : []);

        for (const row of targetRows) {
            await inventoryService.updateItem(row.id, { cas_number: nextCasNumber }, 'inventory');
        }
    },

    async updateItemCasWithLinkedSync(item: InventoryItem, nextCasNumber?: string | null): Promise<void> {
        const casToSave = nextCasNumber?.trim() || '';
        await inventoryService.updateItem(item.id, { cas_number: casToSave }, item._source || 'inventory');

        if ((item.storage_type === 'cabinet' || item._source === 'cabinet_item') && item.cabinet_id) {
            await inventoryService.syncLinkedCabinetCas({
                source: item._source || 'inventory',
                sourceId: item.id,
                cabinetId: item.cabinet_id,
                linkedInventoryItemId: item.linked_inventory_item_id,
                name: item.name,
                brand: item.brand,
                productNumber: item.product_number,
                capacity: item.capacity,
                previousCasNumber: item.cas_number,
                nextCasNumber: casToSave,
            });
        }
    },

    /**
     * Remove one incorrectly registered database record. This is not a physical
     * waste-disposal action and therefore never creates a waste_logs row.
     */
    async deleteItem(item: InventoryItem): Promise<void> {
        await inventoryService.deleteItems([item]);
    },

    /** Remove 1..100 records in one all-or-nothing database transaction. */
    async deleteItems(items: InventoryItem[]): Promise<InventoryRemovalResult> {
        const { currentLabId } = useLabStore.getState();
        const actorName = await getCurrentUserDisplayName(currentLabId);
        const targets = items.map((item): InventoryRemovalTarget => ({
            item_id: item.id,
            item_source: item._source || 'inventory',
        }));

        return removeInventoryRecords(
            targets,
            currentLabId || null,
            actorName || null,
        );
    },

    /** Move 1..100 inventory/cabinet records in one all-or-nothing transaction. */
    async moveRecords(input: {
        targets: InventoryMoveTarget[];
        destination: InventoryMoveDestination;
        requestId: string;
    }): Promise<InventoryMoveReceipt> {
        if (input.targets.length < 1 || input.targets.length > 100) {
            throw new Error('Inventory moves must contain between 1 and 100 targets.');
        }
        if (!UUID_PATTERN.test(input.requestId)) {
            throw new Error('requestId must be a valid UUID.');
        }
        const destinationId = input.destination.storage_type === 'cabinet'
            ? input.destination.cabinet_id
            : input.destination.storage_location_id;
        if (!UUID_PATTERN.test(destinationId)) {
            throw new Error('The inventory move destination must be a valid UUID.');
        }

        const seen = new Set<string>();
        for (const target of input.targets) {
            const key = `${target.item_source}:${target.item_id}`;
            if (!UUID_PATTERN.test(target.item_id) || seen.has(key)) {
                throw new Error('Inventory move targets must have unique valid UUIDs.');
            }
            seen.add(key);

            if (input.destination.storage_type === 'other') {
                if (target.item_source !== 'inventory' || target.placement !== undefined) {
                    throw new Error('Only inventory records without placement data can move to other storage.');
                }
                continue;
            }

            const placement = target.placement;
            if (!placement ||
                !UUID_PATTERN.test(placement.shelf_id) ||
                !['A', 'B', 'C', 'D'].includes(placement.template) ||
                !Number.isFinite(placement.width) ||
                !Number.isFinite(placement.position) ||
                !Number.isFinite(placement.depth_position) ||
                placement.width <= 0 ||
                placement.width > 100 ||
                placement.position < 0 ||
                placement.position + placement.width > 100 ||
                placement.depth_position < 0 ||
                placement.depth_position > 100) {
                throw new Error('Every cabinet move target requires valid placement geometry.');
            }
        }

        const { data, error } = await supabase.rpc('move_inventory_records_v2', {
            p_targets: input.targets,
            p_destination: input.destination,
            p_request_id: input.requestId,
        });
        if (error) {
            const errorText = String(error.message || '');
            const missingRpc = error.code === '42883' ||
                error.code === 'PGRST202' ||
                errorText.includes('move_inventory_records_v2');
            if (missingRpc) {
                throw new Error('재고 일괄 이동 기능이 서버에 배포되지 않았습니다. 관리자에게 문의해 주세요.');
            }
            throw error;
        }

        return parseInventoryMoveReceipt(data, input);
    },

    /**
     * Record one fully used unit (or one empty container) without creating a
     * physical waste log. The server derives actor, lab and linked inventory
     * scope, then decrements or removes the linked rows atomically.
     */
    async recordUsageCompletion(input: {
        cabinetItemId: string;
        requestId: string;
        completionKind: InventoryUsageCompletionKind;
    }): Promise<InventoryUsageCompletionReceipt> {
        if (!UUID_PATTERN.test(input.cabinetItemId)) {
            throw new Error('cabinetItemId must be a valid UUID.');
        }
        if (!UUID_PATTERN.test(input.requestId)) {
            throw new Error('requestId must be a valid UUID.');
        }
        if (input.completionKind !== 'used' && input.completionKind !== 'empty_container') {
            throw new Error('completionKind must be used or empty_container.');
        }

        const { data, error } = await supabase.rpc('record_inventory_usage_completion_v2', {
            p_cabinet_item_id: input.cabinetItemId,
            p_request_id: input.requestId,
            p_completion_kind: input.completionKind,
        });

        if (error) {
            const errorText = String(error.message || '');
            const missingRpc = error.code === '42883' ||
                error.code === 'PGRST202' ||
                errorText.includes('record_inventory_usage_completion_v2');
            if (missingRpc) {
                throw new Error('사용 완료 처리 기능이 서버에 배포되지 않았습니다. 관리자에게 문의해 주세요.');
            }
            throw error;
        }

        return parseUsageCompletionReceipt(data, input);
    },

    /**
     * Called from cabinet 3D view when a reagent is removed.
     * Cleans up any linked inventory row.
     */
    async deleteLinkedInventoryByCabinetItemId(input: {
        cabinetId: string;
        cabinetItemId?: string | null;
        linkedInventoryItemId?: string | null;
        itemName: string;
        reasonKey?: DisposalReasonKey;
    }): Promise<void> {
        if (!input.cabinetId) return;

        const { currentLabId } = useLabStore.getState();
        const actorName = await getCurrentUserDisplayName(currentLabId);
        const reason = CABINET_RECORD_REMOVAL_REASONS[input.reasonKey || 'other'];
        const removeExactRecord = async (target: InventoryRemovalTarget): Promise<boolean> => {
            try {
                await removeInventoryRecords(
                    [target],
                    currentLabId || null,
                    actorName || null,
                    reason,
                );
                return true;
            } catch (error) {
                // The cabinet save path may already have removed the placement.
                // Only an explicit server-side not-found result is safe to ignore.
                if (isInventoryRecordNotFoundError(error)) return false;
                throw error;
            }
        };

        // ReagentEditPanel calls this before removing/saving the cabinet item, so
        // the placement ID is the most precise target. The RPC also removes its
        // linked inventory row in the same transaction.
        if (input.cabinetItemId) {
            const removed = await removeExactRecord({
                item_id: input.cabinetItemId,
                item_source: 'cabinet_item',
            });
            if (removed) return;
        }

        // Older callers may already have removed the cabinet placement. In that
        // case, remove the exact linked inventory ID through the same guarded RPC.
        if (input.linkedInventoryItemId) {
            await removeExactRecord({
                item_id: input.linkedInventoryItemId,
                item_source: 'inventory',
            });
            return;
        }

        // Legacy placements may not carry a link ID. Never choose an arbitrary
        // same-name row: resolve only a unique record in the requested cabinet.
        const { data: cabinetMatches, error: cabinetMatchError } = await supabase
            .from('cabinet_items')
            .select('id')
            .eq('cabinet_id', input.cabinetId)
            .eq('name', input.itemName)
            .limit(2);
        if (cabinetMatchError) throw cabinetMatchError;

        const cabinetRows = (cabinetMatches || []) as Array<{ id: string }>;
        if (cabinetRows.length > 1) {
            throw new Error('같은 이름의 시약이 여러 개라 삭제 대상을 안전하게 식별할 수 없습니다.');
        }
        if (cabinetRows.length === 1) {
            await removeExactRecord({
                item_id: cabinetRows[0].id,
                item_source: 'cabinet_item',
            });
            return;
        }

        const { data: inventoryMatches, error: inventoryMatchError } = await supabase
            .from('inventory')
            .select('id')
            .eq('cabinet_id', input.cabinetId)
            .eq('storage_type', 'cabinet')
            .eq('name', input.itemName)
            .limit(2);
        if (inventoryMatchError) throw inventoryMatchError;

        const inventoryRows = (inventoryMatches || []) as Array<{ id: string }>;
        if (inventoryRows.length > 1) {
            throw new Error('같은 이름의 재고가 여러 개라 삭제 대상을 안전하게 식별할 수 없습니다.');
        }
        if (inventoryRows.length === 1) {
            await removeExactRecord({
                item_id: inventoryRows[0].id,
                item_source: 'inventory',
            });
        }
    },
    /**
     * Called from cabinet view when "Clear All" is performed.
     * Deletes all linked inventory rows for the entire cabinet at once.
     */
    async clearCabinetInventory(cabinetId: string, _items: { name: string; brand?: string; casNo?: string; quantity?: number; capacity?: string }[]): Promise<void> {
        if (!cabinetId) return;
        void _items; // Kept for caller compatibility; database deletion is ID/scope based.

        // FridgeView currently saves the empty cabinet before this cleanup, so
        // cabinet_items may already be gone. Resolve the remaining linked inventory
        // IDs first, then remove all of them in one server transaction.
        const { data, error } = await supabase
            .from('inventory')
            .select('id')
            .eq('cabinet_id', cabinetId)
            .eq('storage_type', 'cabinet')
            .limit(MAX_ATOMIC_REMOVAL_ITEMS + 1);
        if (error) throw error;

        const targets = ((data || []) as Array<{ id: string }>).map(
            (row): InventoryRemovalTarget => ({
                item_id: row.id,
                item_source: 'inventory',
            })
        );
        if (targets.length === 0) return;
        if (targets.length > MAX_ATOMIC_REMOVAL_ITEMS) {
            throw new Error('시약장 연결 재고가 100개를 초과해 전체 삭제할 수 없습니다. 어떤 항목도 삭제되지 않았습니다.');
        }

        const { currentLabId } = useLabStore.getState();
        const actorName = await getCurrentUserDisplayName(currentLabId);
        await removeInventoryRecords(
            targets,
            currentLabId || null,
            actorName || null,
            'Clear cabinet inventory records',
        );
    },
};
