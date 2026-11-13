/**
 * Reagent purchase requests of a lab (approved by the lab admin) and the
 * recent usage counts behind the low-stock forecast. Everything goes through
 * RPCs; the table itself is not readable by clients.
 */
import { supabase } from './supabaseClient';
import type { UsageCount } from '../features/purchaseRequests/stockForecast';

export type PurchaseRequestStatus = 'requested' | 'approved' | 'rejected' | 'ordered' | 'received' | 'cancelled';
export type PurchaseRequestAction = Exclude<PurchaseRequestStatus, 'requested'>;

export const OPEN_PURCHASE_STATUSES: readonly PurchaseRequestStatus[] = ['requested', 'approved', 'ordered'];

export interface PurchaseRequest {
    id: string;
    labId: string;
    itemName: string;
    brand: string | null;
    productNumber: string | null;
    casNumber: string | null;
    quantity: number;
    packageSize: string | null;
    note: string | null;
    sourceInventoryId: string | null;
    status: PurchaseRequestStatus;
    requestedBy: string | null;
    requesterName: string | null;
    decidedBy: string | null;
    deciderName: string | null;
    decidedAt: string | null;
    decisionNote: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface NewPurchaseRequest {
    itemName: string;
    quantity: number;
    brand?: string | null;
    productNumber?: string | null;
    casNumber?: string | null;
    packageSize?: string | null;
    note?: string | null;
    sourceInventoryId?: string | null;
}

export type PurchaseErrorCode = 'access_denied' | 'admin_required' | 'invalid_input' | 'invalid_transition' | 'unknown';

export class PurchaseRequestError extends Error {
    readonly code: PurchaseErrorCode;
    constructor(code: PurchaseErrorCode, message: string) {
        super(message);
        this.name = 'PurchaseRequestError';
        this.code = code;
    }
}

export function toPurchaseError(error: unknown): PurchaseRequestError {
    if (error instanceof PurchaseRequestError) return error;
    const message = error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : String(error ?? '');
    const code: PurchaseErrorCode = message.includes('PURCHASE_REQUEST_ADMIN_REQUIRED') ? 'admin_required'
        : message.includes('PURCHASE_REQUEST_ACCESS_DENIED') ? 'access_denied'
            : message.includes('PURCHASE_REQUEST_INVALID_TRANSITION') ? 'invalid_transition'
                : message.includes('PURCHASE_REQUEST_INVALID_INPUT') ? 'invalid_input' : 'unknown';
    return new PurchaseRequestError(code, message || 'Purchase request failed.');
}

const STATUSES = new Set<PurchaseRequestStatus>(['requested', 'approved', 'rejected', 'ordered', 'received', 'cancelled']);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

export function normalizePurchaseRequest(row: unknown): PurchaseRequest {
    const record = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
    const id = text(record.id);
    const labId = text(record.lab_id);
    const itemName = text(record.item_name);
    if (!id || !labId || !itemName) throw new Error('The purchase request row is incomplete.');
    const status = STATUSES.has(record.status as PurchaseRequestStatus) ? record.status as PurchaseRequestStatus : 'requested';
    return {
        id,
        labId,
        itemName,
        brand: text(record.brand),
        productNumber: text(record.product_number),
        casNumber: text(record.cas_number),
        quantity: Math.max(1, Number(record.quantity) || 1),
        packageSize: text(record.package_size),
        note: text(record.note),
        sourceInventoryId: text(record.source_inventory_id),
        status,
        requestedBy: text(record.requested_by),
        requesterName: text(record.requester_name),
        decidedBy: text(record.decided_by),
        deciderName: text(record.decider_name),
        decidedAt: text(record.decided_at),
        decisionNote: text(record.decision_note),
        createdAt: text(record.created_at) ?? '',
        updatedAt: text(record.updated_at) ?? '',
    };
}

export function isOpenPurchaseRequest(request: Pick<PurchaseRequest, 'status'>): boolean {
    return OPEN_PURCHASE_STATUSES.includes(request.status);
}

const CAS_PATTERN = /^[0-9]{2,7}-[0-9]{2}-[0-9]$/;
const blank = (value: string | null | undefined): string | null => value?.trim() || null;

export async function listPurchaseRequests(labId: string, closedDays = 60): Promise<PurchaseRequest[]> {
    const { data, error } = await supabase.rpc('list_inventory_purchase_requests_v1', { p_lab_id: labId, p_closed_days: closedDays });
    if (error) throw toPurchaseError(error);
    return (Array.isArray(data) ? data : []).map(normalizePurchaseRequest);
}

export async function createPurchaseRequest(labId: string, input: NewPurchaseRequest): Promise<PurchaseRequest> {
    const itemName = input.itemName.trim();
    const quantity = Math.floor(input.quantity);
    if (!itemName || !(quantity >= 1 && quantity <= 999)) {
        throw new PurchaseRequestError('invalid_input', 'A name and a quantity between 1 and 999 are required.');
    }
    const cas = blank(input.casNumber);
    const { data, error } = await supabase.rpc('create_inventory_purchase_request_v1', {
        p_lab_id: labId,
        p_item_name: itemName.slice(0, 200),
        p_quantity: quantity,
        p_brand: blank(input.brand)?.slice(0, 120) ?? null,
        p_product_number: blank(input.productNumber)?.slice(0, 120) ?? null,
        // A malformed CAS number is dropped rather than failing the whole request.
        p_cas_number: cas && CAS_PATTERN.test(cas) ? cas : null,
        p_package_size: blank(input.packageSize)?.slice(0, 60) ?? null,
        p_note: blank(input.note)?.slice(0, 500) ?? null,
        p_source_inventory_id: input.sourceInventoryId ?? null,
    });
    if (error) throw toPurchaseError(error);
    return normalizePurchaseRequest(data);
}

export async function updatePurchaseRequest(id: string, status: PurchaseRequestAction, note?: string | null): Promise<PurchaseRequest> {
    const { data, error } = await supabase.rpc('update_inventory_purchase_request_v1', {
        p_id: id,
        p_status: status,
        p_note: blank(note)?.slice(0, 500) ?? null,
    });
    if (error) throw toPurchaseError(error);
    return normalizePurchaseRequest(data);
}

/** Bottles used up per inventory row in the last `days` days; labId null = personal inventory. */
export async function fetchUsageCounts(labId: string | null, days = 180): Promise<Map<string, UsageCount>> {
    const { data, error } = await supabase.rpc('get_inventory_usage_counts_v1', { p_lab_id: labId, p_days: days });
    if (error) throw toPurchaseError(error);
    const counts = new Map<string, UsageCount>();
    for (const row of (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>) {
        const id = text(row.inventory_item_id);
        if (!id) continue;
        counts.set(id, { usedCount: Number(row.used_count) || 0, lastUsedAt: text(row.last_used_at) });
    }
    return counts;
}
