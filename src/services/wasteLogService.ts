/**
 * Waste Log Service
 * CRUD operations for waste disposal records in Supabase
 */

import { supabase } from './supabaseClient';
import type { CartItem, WasteLog } from '../types';

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

    const { data, error } = await supabase
        .from('waste_logs')
        .insert({
            user_id: userId,
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

/**
 * Fetch waste disposal records (newest first)
 */
export async function fetchWasteLogs(
    limit: number = 20,
    offset: number = 0
): Promise<{ logs: WasteLog[]; count: number }> {
    const { data, error, count } = await supabase
        .from('waste_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
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
