/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from './supabaseClient';
import type { ShelfData, ReagentPlacement } from '../types/fridge';
import { normalizeTemplateFromDb } from '../utils/normalizeTemplateFromDb';
import { v4 as uuidv4 } from 'uuid';
import { useLabStore } from '../store/useLabStore';
import { optimizeCabinetImage } from '../utils/cabinetImageOptimization';
import { postBytes, postJson } from './internalApi';

export interface Cabinet {
    id: string;
    name: string;
    location?: string;
    image_url?: string;
    image_path?: string;
    width: number;
    height: number;
    depth: number;
    created_at: string;
    user_id: string;
    lab_id?: string;
}

export interface CabinetDimensions {
    width: number;
    height: number;
    depth: number;
}

const serializeCabinetShelves = (shelves: ShelfData[]) => shelves.map((shelf) => ({
    id: shelf.id,
    level: shelf.level,
    dividers: shelf.dividers,
    items: shelf.items.map((item) => ({
        id: item.id,
        template: item.template,
        name: item.name,
        width: item.width,
        position: item.position,
        depth_position: item.depthPosition ?? 50,
        expiry_date: item.expiryDate || null,
        manufacturer_date_type: item.manufacturerDateType || 'unlabeled',
        received_date: item.receivedDate || null,
        opened_date: item.openedDate || null,
        capacity: item.capacity || null,
        product_number: item.productNumber || null,
        brand: item.brand || null,
        notes: item.notes || null,
        cas_no: item.casNo || null,
        h_codes: item.hCodes || [],
        ghs_status: item.ghsStatus || null,
        ghs_checked_at: item.ghsCheckedAt || null,
        inventory_item_id: item.linkedInventoryItemId || null,
        remaining_percent: item.remaining_percent ?? null,
    })),
}));

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
        const cabinets = (data || []) as Cabinet[];
        const privateIds = cabinets.filter((cabinet) => Boolean(cabinet.image_path)).map((cabinet) => cabinet.id);
        if (privateIds.length === 0) return cabinets;
        // Never fall back to a stored public URL after image_path exists. A
        // temporary signing failure hides the photo instead of reopening the
        // legacy public path.
        const privateCabinets = cabinets.map((cabinet) => cabinet.image_path
            ? { ...cabinet, image_url: undefined } : cabinet);
        try {
            const result = await postJson<{ success: true; urls: Record<string, string | null> }>(
                '/api/cabinets/image-urls', { cabinetIds: privateIds },
            );
            if (result?.success !== true || !result.urls || typeof result.urls !== 'object'
                || Array.isArray(result.urls) || Object.keys(result.urls).length !== privateIds.length
                || privateIds.some((id) => !(id in result.urls)
                    || !(result.urls[id] === null || typeof result.urls[id] === 'string'))) {
                throw new Error('Invalid private cabinet image response');
            }
            return privateCabinets.map((cabinet) => cabinet.image_path
                ? { ...cabinet, image_url: result.urls[cabinet.id] || undefined } : cabinet);
        } catch {
            console.error('Private cabinet image URLs are temporarily unavailable');
            return privateCabinets;
        }
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

    async updateCabinet(id: string, updates: { name?: string; location?: string; width?: number; height?: number; depth?: number; }): Promise<void> {
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
        // Canvas re-encoding strips EXIF/GPS metadata and makes the stored file
        // bounded for the daily private-storage recovery copy. The source file is
        // never uploaded to Storage.
        const optimized = await optimizeCabinetImage(file);
        const result = await postBytes<{
            success: true;
            imageUrl: string | null;
            referencedCount: number;
            warning: boolean;
            urlUnavailable: boolean;
        }>(`/api/cabinets/${cabinetId}/image`, optimized.file, 'image/webp');
        if (result?.success !== true || !(result.imageUrl === null || typeof result.imageUrl === 'string')) {
            throw new Error('Invalid private cabinet image response');
        }
        return result.imageUrl || '';
    },

    async removeCabinetImage(cabinetId: string): Promise<void> {
        const result = await postJson<{ success: true; imageUrl: null }>(
            `/api/cabinets/${cabinetId}/image`, { action: 'remove' },
        );
        if (result?.success !== true || result.imageUrl !== null) {
            throw new Error('Invalid private cabinet image removal response');
        }
    },

    async deleteCabinet(id: string): Promise<void> {
        // The database refuses deletion while a private image is still live.
        // Detaching first preserves its ownership and seven-day retention row.
        await this.removeCabinetImage(id);
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
                    reagentId: item.inventory_item_id || item.id,
                    linkedInventoryItemId: item.inventory_item_id || undefined,
                    template: normalizeTemplateFromDb(item.template),
                    name: item.name,
                    width: Number(item.width),
                    position: Number(item.position),
                    depthPosition: Number(item.depth_position),
                    expiryDate: item.expiry_date || undefined,
                    manufacturerDateType: item.manufacturer_date_type || 'unlabeled',
                    receivedDate: item.received_date || undefined,
                    openedDate: item.opened_date || undefined,
                    capacity: item.capacity || undefined,
                    productNumber: item.product_number || undefined,
                    brand: item.brand || undefined,
                    notes: item.notes || undefined,
                    casNo: item.cas_no || undefined,
                    hCodes: Array.isArray(item.h_codes)
                        ? item.h_codes.filter((code: unknown): code is string => typeof code === 'string')
                        : [],
                    ghsStatus: item.ghs_status || undefined,
                    ghsCheckedAt: item.ghs_checked_at || undefined,
                    remaining_percent: item.remaining_percent ?? undefined,
                    isAcidic: false,
                    isBasic: false,
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

    async saveCabinetState(
        cabinetId: string,
        shelves: ShelfData[],
        dimensions: CabinetDimensions
    ): Promise<void> {
        const { error } = await supabase.rpc('save_cabinet_state_with_dates', {
            p_cabinet_id: cabinetId,
            p_shelves: serializeCabinetShelves(shelves),
            p_width: dimensions.width,
            p_height: dimensions.height,
            p_depth: dimensions.depth,
        });

        if (error) {
            console.error('Error saving cabinet state atomically:', error);
            throw error;
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
        const { error } = await supabase
            .rpc('record_cabinet_activity_v2', {
                p_cabinet_id: cabinetId,
                p_action_type: actionType,
                p_item_name: itemName,
                p_reason: reason || null,
                p_memo: memo || null,
                p_request_id: uuidv4(),
            });

        if (error) {
            // Keep the existing best-effort UI behavior. The database function
            // guarantees there is never an activity row without its audit row.
            console.error('Error logging atomic cabinet activity:', { code: error.code || null });
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

export type ActivityActionType = 'add' | 'remove' | 'clear_all' | 'update';

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

