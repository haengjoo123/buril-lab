import { supabase } from './supabaseClient';
import { useLabStore } from '../store/useLabStore';

export interface AuditLog {
    id: string;
    created_at: string;
    actor_user_id: string | null;
    actor_name: string | null;
    lab_id: string | null;
    entity_type: string;
    entity_id: string;
    action: string;
    location_context: string | null;
    before_data: Record<string, any> | null;
    after_data: Record<string, any> | null;
    diff_data: Record<string, { from: any; to: any }> | null;
    source: string;
    request_id: string | null;
}

export const auditService = {
    /** Generate generic audit logs for an entity or lab */
    async getLogs(filters?: {
        entity_type?: string;
        entity_id?: string;
        lab_id?: string;
        limit?: number;
    }): Promise<AuditLog[]> {
        const { currentLabId } = useLabStore.getState();
        const targetLabId = filters?.lab_id || currentLabId;

        let query = supabase.from('audit_logs').select('*');

        if (targetLabId) {
            query = query.eq('lab_id', targetLabId);
        } else {
            query = query.is('lab_id', null);
        }

        if (filters?.entity_type) query = query.eq('entity_type', filters.entity_type);
        if (filters?.entity_id) query = query.eq('entity_id', filters.entity_id);

        query = query.order('created_at', { ascending: false });

        if (filters?.limit) {
            query = query.limit(filters.limit);
        }

        const { data, error } = await query;
        if (error) {
            console.error('[AuditService] getLogs error:', error);
            throw error;
        }

        return data as AuditLog[];
    },

    /** Fetch audit logs by location_context (used for getting cabinet logs) */
    async getCabinetAuditLogs(cabinetId: string, limit = 50): Promise<AuditLog[]> {
        // Since we didn't always store cabinetId in a dedicated indexed column (we use entity_id for the item, and location_context for strings)
        // Let's rely on entity_type='cabinet_item' or entity_type='inventory' + before_data->>cabinet_id
        // For performance, getting logs for a specific cabinet can be done by sending an RPC or querying based on a known field.
        // Actually, we can fetch all lab logs and filter, or we can use an RPC.

        // The most robust is to use an RPC or just filter by lab_id and do client side filtering if the scale is small.
        // Let's create `get_cabinet_audit_logs_rpc` or just query audit_logs

        const { data, error } = await supabase
            // using contains might work if cabinet_id is in before_data JSON, but easier to just use an RPC
            .rpc('get_cabinet_audit_logs', { p_cabinet_id: cabinetId, p_limit: limit });

        if (error) {
            // fallback if missing
            if (error.code === '42883' || error.code === 'PGRST202') {
                console.warn('[AuditService] get_cabinet_audit_logs RPC not found');
                return [];
            }
            console.error('[AuditService] getCabinetAuditLogs error:', error);
            throw error;
        }

        return data as AuditLog[];
    }
};
