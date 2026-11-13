/**
 * Daily lab safety inspections (연구실 일상점검).
 *
 * Reads go through an RLS-scoped select; the write is an RPC so the database
 * fixes the inspection day (Korean calendar day), counts the issues and keeps
 * one record per lab per day.
 */

import { supabase } from './supabaseClient';
import { CHECKLIST_VERSION } from '../features/dailyInspection/checklist';
import {
    kstDateString,
    normalizeInspectionResults,
    type InspectionResults,
} from '../features/dailyInspection/inspectionSummary';

export interface DailyInspectionRecord {
    id: string;
    labId: string;
    /** YYYY-MM-DD, the Korean calendar day. */
    inspectionDate: string;
    checklistVersion: string;
    results: InspectionResults;
    issueCount: number;
    note: string | null;
    inspectorName: string | null;
    updatedAt: string;
}

export type DailyInspectionErrorCode = 'access_denied' | 'invalid_input' | 'unknown';

export class DailyInspectionError extends Error {
    readonly code: DailyInspectionErrorCode;

    constructor(code: DailyInspectionErrorCode, message: string) {
        super(message);
        this.name = 'DailyInspectionError';
        this.code = code;
    }
}

export function toDailyInspectionError(error: unknown): DailyInspectionError {
    if (error instanceof DailyInspectionError) return error;
    const message = error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : String(error ?? '');
    const code: DailyInspectionErrorCode = message.includes('DAILY_INSPECTION_ACCESS_DENIED')
        ? 'access_denied'
        : message.includes('DAILY_INSPECTION_INVALID_INPUT') ? 'invalid_input' : 'unknown';
    return new DailyInspectionError(code, message || 'Daily inspection request failed.');
}

const COLUMNS = 'id,lab_id,inspection_date,checklist_version,results,issue_count,note,inspector_name,updated_at';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_INSPECTION_NOTE_LENGTH = 1000;

const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

export function normalizeDailyInspectionRow(row: unknown): DailyInspectionRecord {
    const record = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
    const id = text(record.id);
    const labId = text(record.lab_id);
    const inspectionDate = text(record.inspection_date)?.slice(0, 10);
    if (!id || !labId || !inspectionDate) throw new Error('The daily inspection row is incomplete.');
    const issueCount = Number(record.issue_count);
    return {
        id,
        labId,
        inspectionDate,
        checklistVersion: text(record.checklist_version) ?? '',
        results: normalizeInspectionResults(record.results),
        issueCount: Number.isFinite(issueCount) && issueCount > 0 ? Math.floor(issueCount) : 0,
        note: text(record.note),
        inspectorName: text(record.inspector_name),
        updatedAt: text(record.updated_at) ?? '',
    };
}

/** Inspections of the last `days` Korean calendar days, newest first. */
export async function fetchRecentDailyInspections(labId: string, days: number, now: number = Date.now()): Promise<DailyInspectionRecord[]> {
    if (!UUID_PATTERN.test(labId)) throw new Error('labId must be a UUID.');
    const span = Math.min(Math.max(Math.floor(days), 1), 92);
    const from = kstDateString(now - (span - 1) * 24 * 60 * 60 * 1000);
    const { data, error } = await supabase
        .from('lab_daily_inspections')
        .select(COLUMNS)
        .eq('lab_id', labId)
        .gte('inspection_date', from)
        .order('inspection_date', { ascending: false })
        .limit(span);
    if (error) throw toDailyInspectionError(error);
    return (data || []).map(normalizeDailyInspectionRow);
}

/** Records today's inspection; saving again the same day replaces it. */
export async function saveDailyInspection(labId: string, results: InspectionResults, note?: string | null): Promise<DailyInspectionRecord> {
    if (!UUID_PATTERN.test(labId)) throw new Error('labId must be a UUID.');
    const cleanedNote = (note ?? '').trim();
    if (cleanedNote.length > MAX_INSPECTION_NOTE_LENGTH) {
        throw new DailyInspectionError('invalid_input', 'The note is too long.');
    }
    const { data, error } = await supabase.rpc('save_lab_daily_inspection_v1', {
        p_lab_id: labId,
        p_checklist_version: CHECKLIST_VERSION,
        p_results: results,
        p_note: cleanedNote || null,
    });
    if (error) throw toDailyInspectionError(error);
    return normalizeDailyInspectionRow(Array.isArray(data) ? data[0] : data);
}
