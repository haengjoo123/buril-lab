/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from './supabaseClient';
import type { ShelfData, ReagentPlacement } from '../types/fridge';
import { v4 as uuidv4 } from 'uuid';
import { useLabStore } from '../store/useLabStore';
import { getCurrentUserDisplayName } from '../utils/userDisplayName';

const mapCabinetActionToAuditAction = (actionType: ActivityActionType): 'create' | 'update' | 'delete' => {
    if (actionType === 'add') return 'create';
    if (actionType === 'remove') return 'delete';
    return 'update';
};

export interface Cabinet {
    id: string;
    name: string;
    location?: string;
    image_url?: string;
    width: number;
    height: number;
    depth: number;
    created_at: string;
    user_id: string;
    lab_id?: string;
}

export const cabinetService = {
    async getCabinets(): Promise<Cabinet[]> {
        const { currentLabId } = useLabStore.getState();
        const query = supabase
            .from('cabinets')
            .select('*');

        if (currentLabId) {
            query.eq('lab_id', currentLabId);
        } else {
            query.is('lab_id', null);
        }

        const { data, error } = await query.order('created_at', { ascending: true });

        if (error) {
            console.error('Error fetching cabinets:', error);
            throw error;
        }
        return data || [];
    },

    async createCabinet(name: string, location?: string, width = 5, height = 9, depth = 2): Promise<Cabinet> {
        const { data: userData } = await supabase.auth.getUser();
        const { currentLabId } = useLabStore.getState();
        const insertData: any = {
            name,
            width,
            height,
            depth,
            user_id: userData.user?.id,
            lab_id: currentLabId || null
        };
        if (location !== undefined) {
            insertData.location = location;
        }

        const { data, error } = await supabase
            .from('cabinets')
            .insert(insertData)
            .select()
            .single();

        if (error) {
            console.error('Error creating cabinet:', error);
            throw error;
        }

        // Create default shelves
        const defaultShelves = [
            { id: uuidv4(), cabinet_id: data.id, level: 0, dividers: [] },
            { id: uuidv4(), cabinet_id: data.id, level: 1, dividers: [] },
            { id: uuidv4(), cabinet_id: data.id, level: 2, dividers: [] },
            { id: uuidv4(), cabinet_id: data.id, level: 3, dividers: [] },
        ];

        await supabase.from('cabinet_shelves').insert(defaultShelves);

        return data;
    },

    async updateCabinet(id: string, updates: { name?: string; location?: string; image_url?: string; width?: number; height?: number; depth?: number; }): Promise<void> {
        const { error } = await supabase
            .from('cabinets')
            .update(updates)
            .eq('id', id);

        if (error) {
            console.error('Error updating cabinet:', error);
            throw error;
        }
    },

    async uploadCabinetImage(cabinetId: string, file: File): Promise<string> {
        const fileExt = file.name.split('.').pop();
        const fileName = `${cabinetId}-${Math.random()}.${fileExt}`;
        const filePath = `${fileName}`;

        const { error: uploadError } = await supabase.storage
            .from('cabinets')
            .upload(filePath, file, { upsert: true });

        if (uploadError) {
            console.error('Error uploading cabinet image:', uploadError);
            throw uploadError;
        }

        const { data } = supabase.storage
            .from('cabinets')
            .getPublicUrl(filePath);

        const publicUrl = data.publicUrl;

        await this.updateCabinet(cabinetId, { image_url: publicUrl });
        return publicUrl;
    },

    async deleteCabinet(id: string): Promise<void> {
        const { error } = await supabase
            .from('cabinets')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Error deleting cabinet:', error);
            throw error;
        }
    },

    async getCabinetDetails(cabinetId: string): Promise<{ shelves: ShelfData[], cabinetName: string, width: number, height: number, depth: number }> {
        // Fetch cabinet details for name
        const { data: cabinetData, error: cabinetError } = await supabase
            .from('cabinets')
            .select('name, width, height, depth')
            .eq('id', cabinetId)
            .single();

        if (cabinetError) throw cabinetError;

        // Fetch shelves
        const { data: shelvesData, error: shelvesError } = await supabase
            .from('cabinet_shelves')
            .select('*')
            .eq('cabinet_id', cabinetId)
            .order('level', { ascending: true });

        if (shelvesError) throw shelvesError;

        // Fetch items
        const { data: itemsData, error: itemsError } = await supabase
            .from('cabinet_items')
            .select('*')
            .eq('cabinet_id', cabinetId);

        if (itemsError) throw itemsError;

        // Build ShelfData structure
        const shelves: ShelfData[] = (shelvesData || []).map(shelf => {
            const shelfItems = (itemsData || [])
                .filter(item => item.shelf_id === shelf.id)
                .map(item => ({
                    id: item.id,
                    shelfId: item.shelf_id,
                    reagentId: item.id,
                    template: item.template,
                    name: item.name,
                    width: Number(item.width),
                    position: Number(item.position),
                    depthPosition: Number(item.depth_position),
                    expiryDate: item.expiry_date || undefined,
                    capacity: item.capacity || undefined,
                    productNumber: item.product_number || undefined,
                    brand: item.brand || undefined,
                    notes: item.notes || undefined,
                    casNo: item.cas_no || undefined,
                    isAcidic: false,
                    isBasic: false,
                    hCodes: [],
                } as ReagentPlacement));

            return {
                id: shelf.id,
                level: shelf.level,
                dividers: typeof shelf.dividers === 'string' ? JSON.parse(shelf.dividers) : (shelf.dividers || []),
                items: shelfItems
            };
        });

        return {
            shelves,
            cabinetName: cabinetData?.name || '',
            width: cabinetData?.width ?? 5,
            height: cabinetData?.height ?? 9,
            depth: cabinetData?.depth ?? 2
        };
    },

    async saveCabinetState(cabinetId: string, shelves: ShelfData[]): Promise<void> {
        const newShelves = shelves.map(s => ({
            id: s.id,
            cabinet_id: cabinetId,
            level: s.level,
            dividers: s.dividers
        }));

        const { error: upsertShelvesError } = await supabase
            .from('cabinet_shelves')
            .upsert(newShelves);

        if (upsertShelvesError) {
            console.error('Error upserting shelves:', upsertShelvesError);
            throw upsertShelvesError;
        }

        const newItems = shelves.flatMap(s => s.items.map(i => ({
            id: i.id,
            cabinet_id: cabinetId,
            shelf_id: s.id,
            template: i.template,
            name: i.name,
            width: i.width,
            position: i.position,
            depth_position: i.depthPosition ?? 50,
            expiry_date: i.expiryDate || null,
            capacity: i.capacity || null,
            product_number: i.productNumber || null,
            brand: i.brand || null,
            notes: i.notes || null,
            cas_no: i.casNo || null
        })));

        if (newItems.length > 0) {
            const { error: upsertItemsError } = await supabase
                .from('cabinet_items')
                .upsert(newItems);

            if (upsertItemsError) {
                console.error('Error upserting items:', upsertItemsError);
                throw upsertItemsError;
            }
        }

        // Delete stale cabinet items using explicit ID diff (safer than raw "not in" filter strings)
        const desiredItemIds = new Set(shelves.flatMap(s => s.items).map(i => i.id));
        const { data: existingItems, error: fetchExistingItemsError } = await supabase
            .from('cabinet_items')
            .select('id')
            .eq('cabinet_id', cabinetId);
        if (fetchExistingItemsError) {
            console.error('Error fetching existing cabinet items:', fetchExistingItemsError);
            throw fetchExistingItemsError;
        }
        const staleItemIds = (existingItems || [])
            .map((row: { id: string }) => row.id)
            .filter((id) => !desiredItemIds.has(id));
        if (staleItemIds.length > 0) {
            const { error: deleteStaleItemsError } = await supabase
                .from('cabinet_items')
                .delete()
                .in('id', staleItemIds);
            if (deleteStaleItemsError) {
                console.error('Error deleting stale cabinet items:', deleteStaleItemsError);
                throw deleteStaleItemsError;
            }
        }

        const shelfIds = shelves.map(s => s.id);
        const desiredShelfIds = new Set(shelfIds);
        const { data: existingShelves, error: fetchExistingShelvesError } = await supabase
            .from('cabinet_shelves')
            .select('id')
            .eq('cabinet_id', cabinetId);
        if (fetchExistingShelvesError) {
            console.error('Error fetching existing cabinet shelves:', fetchExistingShelvesError);
            throw fetchExistingShelvesError;
        }
        const staleShelfIds = (existingShelves || [])
            .map((row: { id: string }) => row.id)
            .filter((id) => !desiredShelfIds.has(id));
        if (staleShelfIds.length > 0) {
            const { error: deleteStaleShelvesError } = await supabase
                .from('cabinet_shelves')
                .delete()
                .in('id', staleShelfIds);
            if (deleteStaleShelvesError) {
                console.error('Error deleting stale cabinet shelves:', deleteStaleShelvesError);
                throw deleteStaleShelvesError;
            }
        }
    },

    async logDisposal(cabinetId: string, itemName: string, reason: string, memo?: string): Promise<void> {
        const { data: userData } = await supabase.auth.getUser();
        const { error } = await supabase
            .from('cabinet_disposal_logs')
            .insert({
                cabinet_id: cabinetId,
                item_name: itemName,
                reason,
                memo: memo || null,
                disposed_by: userData.user?.id || null
            });

        if (error) {
            console.error('Error logging disposal:', error);
            throw error;
        }
    },

    async getDisposalLogs(cabinetId: string): Promise<DisposalLog[]> {
        const { data, error } = await supabase
            .rpc('get_cabinet_disposal_logs', { target_cabinet_id: cabinetId });

        if (error) {
            console.error('Error fetching disposal logs:', error);
            throw error;
        }
        return data || [];
    },

    /**
     * 시약 활동(등록/삭제/전체비우기)을 cabinet_activity_logs에 기록합니다.
     */
    async logActivity(
        cabinetId: string,
        actionType: ActivityActionType,
        itemName: string,
        reason?: string,
        memo?: string
    ): Promise<void> {
        const { currentLabId } = useLabStore.getState();
        const { data: userData } = await supabase.auth.getUser();
        const actorName = await getCurrentUserDisplayName(currentLabId);
        const { data: cabinetRow } = await supabase
            .from('cabinets')
            .select('lab_id')
            .eq('id', cabinetId)
            .maybeSingle();
        const targetLabId = cabinetRow?.lab_id || currentLabId || null;
        const { error } = await supabase
            .from('cabinet_activity_logs')
            .insert({
                cabinet_id: cabinetId,
                action_type: actionType,
                item_name: itemName,
                reason: reason || null,
                memo: memo || null,
                performed_by: userData.user?.id || null
            });

        if (error) {
            console.error('Error logging activity:', error);
            // 로그 실패는 silent — 실제 작업을 막으면 안 됨
        }

        // 감사로그는 admin 전역 조회 화면에서 확인되므로 별도로 남깁니다.
        const { error: auditError } = await supabase.rpc('insert_audit_log_rpc', {
            p_actor_user_id: userData.user?.id || null,
            p_actor_name: actorName || null,
            p_lab_id: targetLabId,
            p_entity_type: 'cabinet_activity',
            p_entity_id: cabinetId,
            p_action: mapCabinetActionToAuditAction(actionType),
            p_location_context: cabinetId,
            p_before_data: null,
            p_after_data: {
                action_type: actionType,
                item_name: itemName,
                reason: reason || null,
                memo: memo || null,
            },
            p_diff_data: null,
            p_source: 'ui',
            p_request_id: null,
        });

        if (auditError) {
            console.error('Error logging audit entry from cabinet activity:', auditError);
            const { error: fallbackAuditError } = await supabase
                .from('audit_logs')
                .insert({
                    actor_user_id: userData.user?.id || null,
                    actor_name: actorName || null,
                    lab_id: targetLabId,
                    entity_type: 'cabinet_activity',
                    entity_id: cabinetId,
                    action: mapCabinetActionToAuditAction(actionType),
                    location_context: cabinetId,
                    before_data: null,
                    after_data: {
                        action_type: actionType,
                        item_name: itemName,
                        reason: reason || null,
                        memo: memo || null,
                    },
                    diff_data: null,
                    source: 'ui',
                    request_id: null,
                });
            if (fallbackAuditError) {
                console.error('Error logging audit entry with fallback insert:', fallbackAuditError);
            }
        }
    },

    /**
     * cabinet_activity_logs에서 해당 시약장의 활동 이력을 가져옵니다.
     */
    async getActivityLogs(cabinetId: string): Promise<ActivityLog[]> {
        const { data, error } = await supabase
            .rpc('get_cabinet_activity_logs', { target_cabinet_id: cabinetId });

        if (error) {
            console.error('Error fetching activity logs:', error);
            throw error;
        }
        return data || [];
    },

    async searchCabinetItems(query: string): Promise<CabinetSearchResult[]> {
        if (!query.trim()) return [];

        const { currentLabId } = useLabStore.getState();
        const { data: userData } = await supabase.auth.getUser();

        // 1. Fetch accessible cabinets
        const cabinetsQuery = supabase.from('cabinets').select('id, name');
        if (currentLabId) {
            cabinetsQuery.eq('lab_id', currentLabId);
        } else if (userData.user?.id) {
            cabinetsQuery.eq('user_id', userData.user.id);
            cabinetsQuery.is('lab_id', null);
        } else {
            return []; // No access
        }

        const { data: cabinets, error: cabinetsError } = await cabinetsQuery;
        if (cabinetsError || !cabinets || cabinets.length === 0) return [];

        const cabinetIds = cabinets.map(c => c.id);
        const cabinetMap = new Map(cabinets.map(c => [c.id, c.name]));

        // 2. Fetch matching items
        const { data: items, error: itemsError } = await supabase
            .from('cabinet_items')
            .select(`
                id,
                name,
                cabinet_id,
                shelf_id,
                cabinet_shelves (
                    level
                )
            `)
            .in('cabinet_id', cabinetIds)
            .ilike('name', `%${query}%`);

        if (itemsError || !items) return [];

        // 3. Map to CabinetSearchResult
        return items.map((item: any) => ({
            itemId: item.id,
            itemName: item.name,
            cabinetId: item.cabinet_id,
            cabinetName: cabinetMap.get(item.cabinet_id) || 'Unknown Cabinet',
            shelfId: item.shelf_id,
            shelfLevel: item.cabinet_shelves?.level ?? 0
        }));
    }
};

export interface CabinetSearchResult {
    itemId: string;
    itemName: string;
    cabinetId: string;
    cabinetName: string;
    shelfId: string;
    shelfLevel: number;
}

export interface DisposalLog {
    id: string;
    cabinet_id: string;
    item_name: string;
    reason: string;
    memo?: string;
    disposed_by?: string;
    disposed_by_email?: string;
    disposed_by_nickname?: string;
    disposed_at: string;
}

export type ActivityActionType = 'add' | 'remove' | 'clear_all';

export interface ActivityLog {
    id: string;
    cabinet_id: string;
    action_type: ActivityActionType;
    item_name: string;
    reason?: string;
    memo?: string;
    performed_by?: string;
    performed_by_nickname?: string;
    performed_by_email?: string;
    performed_at: string;
}

