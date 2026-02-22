import { supabase } from './supabaseClient';
import type { ShelfData, ReagentPlacement } from '../types/fridge';
import { v4 as uuidv4 } from 'uuid';
import { useLabStore } from '../store/useLabStore';

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

    async updateCabinet(id: string, updates: { name?: string; location?: string; image_url?: string }): Promise<void> {
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

    async getCabinetDetails(cabinetId: string): Promise<{ shelves: ShelfData[], cabinetName: string }> {
        // Fetch cabinet details for name
        const { data: cabinetData, error: cabinetError } = await supabase
            .from('cabinets')
            .select('name')
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
                    template: item.template,
                    name: item.name,
                    width: Number(item.width),
                    position: Number(item.position),
                    depthPosition: Number(item.depth_position),
                    expiryDate: item.expiry_date || undefined,
                    capacity: item.capacity || undefined
                } as ReagentPlacement));

            return {
                id: shelf.id,
                level: shelf.level,
                dividers: typeof shelf.dividers === 'string' ? JSON.parse(shelf.dividers) : (shelf.dividers || []),
                items: shelfItems
            };
        });

        return { shelves, cabinetName: cabinetData?.name || '' };
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

        const currentItemIds = shelves.flatMap(s => s.items).map(i => i.id);
        if (currentItemIds.length > 0) {
            await supabase
                .from('cabinet_items')
                .delete()
                .eq('cabinet_id', cabinetId)
                .not('id', 'in', `(${currentItemIds.join(',')})`);
        } else {
            await supabase
                .from('cabinet_items')
                .delete()
                .eq('cabinet_id', cabinetId);
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
            capacity: i.capacity || null
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

        const shelfIds = shelves.map(s => s.id);
        if (shelfIds.length > 0) {
            await supabase
                .from('cabinet_shelves')
                .delete()
                .eq('cabinet_id', cabinetId)
                .not('id', 'in', `(${shelfIds.join(',')})`);
        } else {
            await supabase
                .from('cabinet_shelves')
                .delete()
                .eq('cabinet_id', cabinetId);
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
            .from('cabinet_disposal_logs')
            .select('*')
            .eq('cabinet_id', cabinetId)
            .order('disposed_at', { ascending: false });

        if (error) {
            console.error('Error fetching disposal logs:', error);
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
    disposed_at: string;
}

