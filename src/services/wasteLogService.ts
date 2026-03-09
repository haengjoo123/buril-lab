/**
 * Waste Log Service
 * CRUD operations for waste disposal records in Supabase
 */

import { supabase } from './supabaseClient';
import type { CartItem, WasteLog } from '../types';
import { useLabStore } from '../store/useLabStore';

interface SaveWasteLogParams {
    chemicals: CartItem[];
    disposal_category: string;
    total_volume_ml?: number;
    handler_name?: string;
    memo?: string;
}

/**
 * Save a waste disposal record to Supabase
 */
export async function saveWasteLog(params: SaveWasteLogParams): Promise<WasteLog> {
    // Get current user ID from session for RLS
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;

    if (!userId) {
        throw new Error('User must be authenticated to save waste logs');
    }

    const { currentLabId } = useLabStore.getState();

    const { data, error } = await supabase
        .from('waste_logs')
        .insert({
            user_id: userId,
            lab_id: currentLabId || null,
            chemicals: params.chemicals,
            disposal_category: params.disposal_category,
            total_volume_ml: params.total_volume_ml || null,
            handler_name: params.handler_name?.trim() || null,
            memo: params.memo?.trim() || null,
        })
        .select()
        .single();

    if (error) {
        console.error('Failed to save waste log:', error);
        throw error;
    }

    return data as WasteLog;
}

/** 정렬 기준 */
export type WasteLogSortBy = 'created_at' | 'disposal_category' | 'handler_name';

/** 검색/정렬 파라미터 */
export interface FetchWasteLogsParams {
    limit?: number;
    offset?: number;
    search?: string;
    sortBy?: WasteLogSortBy;
    sortOrder?: 'asc' | 'desc';
    createdAfter?: string;
    createdBefore?: string;
}

/**
 * Fetch waste disposal records with optional search and sort
 */
export async function fetchWasteLogs(
    limit: number = 20,
    offset: number = 0,
    params?: Partial<FetchWasteLogsParams>
): Promise<{ logs: WasteLog[]; count: number }> {
    const { currentLabId } = useLabStore.getState();
    const search = params?.search?.trim();
    const sortBy = params?.sortBy ?? 'created_at';
    const sortOrder = params?.sortOrder ?? 'desc';
    const createdAfter = params?.createdAfter;
    const createdBefore = params?.createdBefore;

    let query = supabase
        .from('waste_logs')
        .select('*', { count: 'exact' });

    if (currentLabId) {
        query = query.eq('lab_id', currentLabId);
    } else {
        query = query.is('lab_id', null);
    }

    // 검색: 분류, 처리자, 메모에서 검색 (대소문자 무시)
    if (search && search.length > 0) {
        // PostgreSQL ilike에서 %, _는 와일드카드이므로 이스케이프
        const escaped = search.replace(/[%_\\]/g, '\\$&');
        const pattern = `%${escaped}%`;
        query = query.or(
            `disposal_category.ilike.${pattern},handler_name.ilike.${pattern},memo.ilike.${pattern}`
        );
    }

    if (createdAfter) {
        query = query.gte('created_at', createdAfter);
    }

    if (createdBefore) {
        query = query.lte('created_at', createdBefore);
    }

    const { data, error, count } = await query
        .order(sortBy, { ascending: sortOrder === 'asc', nullsFirst: false })
        .range(offset, offset + limit - 1);

    if (error) {
        console.error('Failed to fetch waste logs:', error);
        throw error;
    }

    return {
        logs: (data || []) as WasteLog[],
        count: count || 0,
    };
}

/**
 * Delete a single waste disposal record
 */
export async function deleteWasteLog(id: string): Promise<void> {
    const { error } = await supabase
        .from('waste_logs')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Failed to delete waste log:', error);
        throw error;
    }
}
