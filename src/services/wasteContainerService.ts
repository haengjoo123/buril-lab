/**
 * Physical waste containers (폐액통).
 *
 * Reads go through RLS-scoped selects; every write is an RPC so the database
 * enforces lab scope, the status lifecycle and unique open labels. Deposits are
 * linked by recordWasteHandlingV2({ containerId }) in the same transaction.
 */

import { supabase } from './supabaseClient';
import { useLabStore } from '../store/useLabStore';
import type { WasteHazardFlag, WasteStreamCode } from '../types';

export type WasteContainerStatus = 'active' | 'sealed' | 'collected';

export interface WasteContainer {
    id: string;
    labId: string | null;
    streamCode: WasteStreamCode;
    label: string;
    location: string | null;
    capacityMl: number | null;
    status: WasteContainerStatus;
    startedAt: string;
    sealedAt: string | null;
    collectedAt: string | null;
    collectionNote: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface WasteContainerDepositItem {
    lineNumber: number;
    chemicalName: string;
    casNumber: string | null;
    hazardFlags: WasteHazardFlag[];
    solutionVolumeMl: number | null;
}

export interface WasteContainerDeposit {
    id: string;
    createdAt: string;
    handlerName: string | null;
    memo: string | null;
    amountValue: number | null;
    amountUnit: 'mL' | 'mg' | null;
    amountIsApproximate: boolean;
    amountIsUnknown: boolean;
    voidedAt: string | null;
    items: WasteContainerDepositItem[];
}

export interface WasteContainerInput {
    label: string;
    location?: string | null;
    capacityMl?: number | null;
}

const CONTAINER_COLUMNS = [
    'id', 'lab_id', 'stream_code', 'label', 'location', 'capacity_ml', 'status',
    'started_at', 'sealed_at', 'collected_at', 'collection_note', 'created_at', 'updated_at',
].join(',');

/** Deposits fetched for one container; beyond this the detail and label say they are partial. */
export const MAX_CONTAINER_DEPOSITS = 1000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Database error codes raised by the container RPCs, mapped for the UI. */
export type WasteContainerErrorCode =
    | 'label_required'
    | 'label_in_use'
    | 'invalid_input'
    | 'not_active'
    | 'stream_mismatch'
    | 'already_recorded'
    | 'deposit_not_attachable'
    | 'collected'
    | 'invalid_transition'
    | 'admin_required'
    | 'access_denied'
    | 'not_found'
    | 'unknown';

export class WasteContainerError extends Error {
    readonly code: WasteContainerErrorCode;

    constructor(code: WasteContainerErrorCode, message: string) {
        super(message);
        this.name = 'WasteContainerError';
        this.code = code;
    }
}

const ERROR_PATTERNS: Array<[string, WasteContainerErrorCode]> = [
    ['WASTE_CONTAINER_LABEL_REQUIRED', 'label_required'],
    ['WASTE_CONTAINER_LABEL_IN_USE', 'label_in_use'],
    ['WASTE_CONTAINER_INVALID_INPUT', 'invalid_input'],
    ['WASTE_CONTAINER_NOT_ACTIVE', 'not_active'],
    ['WASTE_CONTAINER_STREAM_MISMATCH', 'stream_mismatch'],
    ['WASTE_CONTAINER_ALREADY_RECORDED', 'already_recorded'],
    ['WASTE_CONTAINER_LOG_VOIDED', 'deposit_not_attachable'],
    ['WASTE_CONTAINER_LOG_PREDATES_CONTAINER', 'deposit_not_attachable'],
    ['WASTE_CONTAINER_REQUIRES_READY_DEPOSIT', 'deposit_not_attachable'],
    ['WASTE_CONTAINER_COLLECTED', 'collected'],
    ['WASTE_CONTAINER_INVALID_TRANSITION', 'invalid_transition'],
    ['WASTE_CONTAINER_ADMIN_REQUIRED', 'admin_required'],
    ['WASTE_CONTAINER_ACCESS_DENIED', 'access_denied'],
    ['WASTE_CONTAINER_SCOPE_MISMATCH', 'access_denied'],
    ['WASTE_CONTAINER_NOT_FOUND', 'not_found'],
];

/** Maps database errors raised by the container RPCs to a stable UI code. Other errors stay 'unknown'. */
export function toWasteContainerError(error: unknown): WasteContainerError {
    if (error instanceof WasteContainerError) return error;
    const message = error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : String(error ?? '');
    const match = ERROR_PATTERNS.find(([pattern]) => message.includes(pattern));
    return new WasteContainerError(match ? match[1] : 'unknown', message || 'Waste container request failed.');
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function asStatus(value: unknown): WasteContainerStatus {
    return value === 'sealed' || value === 'collected' ? value : 'active';
}

export function normalizeWasteContainerRow(row: unknown): WasteContainer {
    const record = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
    const id = asString(record.id);
    const label = asString(record.label);
    const streamCode = asString(record.stream_code);
    if (!id || !label || !streamCode) {
        throw new Error('The waste container row is incomplete.');
    }
    return {
        id,
        labId: asString(record.lab_id),
        streamCode: streamCode as WasteStreamCode,
        label,
        location: asString(record.location),
        capacityMl: asNumber(record.capacity_ml),
        status: asStatus(record.status),
        startedAt: asString(record.started_at) ?? '',
        sealedAt: asString(record.sealed_at),
        collectedAt: asString(record.collected_at),
        collectionNote: asString(record.collection_note),
        createdAt: asString(record.created_at) ?? '',
        updatedAt: asString(record.updated_at) ?? '',
    };
}

function assertUuid(value: string, fieldName: string): void {
    if (!UUID_PATTERN.test(value)) {
        throw new Error(`${fieldName} must be a UUID.`);
    }
}

function cleanText(value: string | null | undefined, maxLength: number, fieldName: string): string | null {
    const trimmed = (value ?? '').replace(/\s+/g, ' ').trim();
    if (!trimmed) return null;
    if (trimmed.length > maxLength) {
        throw new Error(`${fieldName} must be ${maxLength} characters or fewer.`);
    }
    return trimmed;
}

function cleanCapacity(value: number | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) {
        throw new Error('Capacity must be between 0 and 1,000 L.');
    }
    return value;
}

function cleanInput(input: WasteContainerInput) {
    const label = cleanText(input.label, 80, 'Container name');
    if (!label) throw new WasteContainerError('label_required', 'A container name is required.');
    return {
        label,
        location: cleanText(input.location, 200, 'Location'),
        capacityMl: cleanCapacity(input.capacityMl),
    };
}

/** Containers in the current lab (or personal space), newest first. */
export async function fetchWasteContainers(options?: { includeCollected?: boolean }): Promise<WasteContainer[]> {
    const { currentLabId } = useLabStore.getState();
    let query = supabase.from('waste_containers').select(CONTAINER_COLUMNS);
    query = currentLabId ? query.eq('lab_id', currentLabId) : query.is('lab_id', null);
    if (!options?.includeCollected) {
        query = query.neq('status', 'collected');
    }
    const { data, error } = await query
        .order('started_at', { ascending: false })
        .limit(500);
    if (error) throw toWasteContainerError(error);
    return (data || []).map(normalizeWasteContainerRow);
}

/** Active containers that can receive a deposit of this stream in the current scope. */
export async function fetchActiveWasteContainersForStream(streamCode: WasteStreamCode): Promise<WasteContainer[]> {
    const { currentLabId } = useLabStore.getState();
    let query = supabase
        .from('waste_containers')
        .select(CONTAINER_COLUMNS)
        .eq('status', 'active')
        .eq('stream_code', streamCode);
    query = currentLabId ? query.eq('lab_id', currentLabId) : query.is('lab_id', null);
    const { data, error } = await query.order('started_at', { ascending: true }).limit(50);
    if (error) throw toWasteContainerError(error);
    return (data || []).map(normalizeWasteContainerRow);
}

function unwrapContainer(data: unknown): WasteContainer {
    const row = Array.isArray(data) ? data[0] : data;
    return normalizeWasteContainerRow(row);
}

export async function createWasteContainer(
    streamCode: WasteStreamCode,
    input: WasteContainerInput,
): Promise<WasteContainer> {
    const { currentLabId } = useLabStore.getState();
    const clean = cleanInput(input);
    const { data, error } = await supabase.rpc('create_waste_container_v1', {
        p_lab_id: currentLabId || null,
        p_stream_code: streamCode,
        p_label: clean.label,
        p_location: clean.location,
        p_capacity_ml: clean.capacityMl,
    });
    if (error) throw toWasteContainerError(error);
    return unwrapContainer(data);
}

export async function updateWasteContainer(id: string, input: WasteContainerInput): Promise<WasteContainer> {
    assertUuid(id, 'containerId');
    const clean = cleanInput(input);
    const { data, error } = await supabase.rpc('update_waste_container_v1', {
        p_container_id: id,
        p_label: clean.label,
        p_location: clean.location,
        p_capacity_ml: clean.capacityMl,
    });
    if (error) throw toWasteContainerError(error);
    return unwrapContainer(data);
}

export async function setWasteContainerStatus(
    id: string,
    status: WasteContainerStatus,
    note?: string | null,
): Promise<WasteContainer> {
    assertUuid(id, 'containerId');
    const { data, error } = await supabase.rpc('set_waste_container_status_v1', {
        p_container_id: id,
        p_status: status,
        p_note: cleanText(note, 500, 'Collection note'),
    });
    if (error) throw toWasteContainerError(error);
    return unwrapContainer(data);
}

function normalizeDepositRow(row: unknown): WasteContainerDeposit {
    const record = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
    const unit = record.normalized_amount_unit === 'mL' || record.normalized_amount_unit === 'mg'
        ? record.normalized_amount_unit
        : null;
    const items = Array.isArray(record.waste_log_items) ? record.waste_log_items : [];
    return {
        id: String(record.id || ''),
        createdAt: String(record.created_at || ''),
        handlerName: asString(record.handler_name),
        memo: asString(record.memo),
        amountValue: asNumber(record.normalized_amount_value),
        amountUnit: unit,
        amountIsApproximate: Boolean(record.amount_is_approximate),
        amountIsUnknown: Boolean(record.amount_is_unknown),
        voidedAt: asString(record.voided_at),
        items: items
            .map((item) => {
                const value = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
                return {
                    lineNumber: asNumber(value.line_number) ?? 0,
                    chemicalName: String(value.chemical_name || ''),
                    casNumber: asString(value.cas_number),
                    hazardFlags: Array.isArray(value.hazard_flags)
                        ? value.hazard_flags.filter((flag): flag is WasteHazardFlag => typeof flag === 'string')
                        : [],
                    solutionVolumeMl: asNumber(value.solution_volume_normalized_ml),
                };
            })
            .sort((a, b) => a.lineNumber - b.lineNumber),
    };
}

export interface WasteContainerDepositPage {
    deposits: WasteContainerDeposit[];
    /** More deposits exist than were fetched; totals from them are lower bounds. */
    truncated: boolean;
}

/** Deposits recorded into one container, oldest first (at most MAX_CONTAINER_DEPOSITS). */
export async function fetchWasteContainerDeposits(containerId: string): Promise<WasteContainerDepositPage> {
    assertUuid(containerId, 'containerId');
    const { data, error, count } = await supabase
        .from('waste_logs')
        .select([
            'id', 'created_at', 'handler_name', 'memo', 'normalized_amount_value', 'normalized_amount_unit',
            'amount_is_approximate', 'amount_is_unknown', 'voided_at',
            'waste_log_items(line_number,chemical_name,cas_number,hazard_flags,solution_volume_normalized_ml)',
        ].join(','), { count: 'exact' })
        .eq('container_id', containerId)
        .order('created_at', { ascending: true })
        .limit(MAX_CONTAINER_DEPOSITS);
    if (error) throw toWasteContainerError(error);
    const deposits = (data || []).map(normalizeDepositRow);
    return { deposits, truncated: typeof count === 'number' && count > deposits.length };
}

export interface WasteContainerTotals {
    depositCount: number;
    totalMl: number;
    hasUnknownAmounts: boolean;
}

/** Deposit counts and recorded mL per container, aggregated in the database (voided deposits excluded). */
export async function fetchWasteContainerTotals(containerIds: string[]): Promise<Record<string, WasteContainerTotals>> {
    const ids = Array.from(new Set(containerIds));
    ids.forEach((id) => assertUuid(id, 'containerId'));
    const totals: Record<string, WasteContainerTotals> = {};
    ids.forEach((id) => {
        totals[id] = { depositCount: 0, totalMl: 0, hasUnknownAmounts: false };
    });
    if (ids.length === 0) return totals;

    const { data, error } = await supabase.rpc('get_waste_container_totals_v1', { p_container_ids: ids });
    if (error) throw toWasteContainerError(error);

    for (const row of (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>) {
        const id = asString(row.container_id);
        if (!id || !totals[id]) continue;
        totals[id] = {
            depositCount: asNumber(row.deposit_count) ?? 0,
            totalMl: asNumber(row.total_ml) ?? 0,
            hasUnknownAmounts: Boolean(row.has_unknown_amounts),
        };
    }
    return totals;
}
