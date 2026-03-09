import { supabase } from './supabaseClient';

export interface SearchHistoryEntry {
    id: string;
    user_id: string;
    query: string;
    searched_at: string;
}

export const searchHistoryService = {
    async getRecentSearches(limit: number = 5): Promise<string[]> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return [];

        const { data, error } = await supabase
            .from('user_search_history')
            .select('query')
            .eq('user_id', user.id)
            .order('searched_at', { ascending: false })
            .limit(limit * 2); // Fetch more in case of duplicates

        if (error) {
            console.error('Error fetching search history:', error);
            return [];
        }

        // Deduplicate queries while maintaining order
        const uniqueQueries: string[] = [];
        for (const row of data || []) {
            if (!uniqueQueries.includes(row.query)) {
                uniqueQueries.push(row.query);
                if (uniqueQueries.length === limit) break;
            }
        }
        return uniqueQueries;
    },

    async addSearch(query: string) {
        const normalized = query.trim();
        if (!normalized) return;

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Use RPC or simply insert. We'll rely on fetching order (time) to resolve sorting.
        const { error } = await supabase
            .from('user_search_history')
            .insert({
                user_id: user.id,
                query: normalized,
            });

        if (error) {
            console.error('Error adding search history:', error);
        }
    },

    async removeSearch(query: string) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { error } = await supabase
            .from('user_search_history')
            .delete()
            .eq('user_id', user.id)
            .eq('query', query);

        if (error) {
            console.error('Error removing search history:', error);
        }
    },

    async clearHistory() {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { error } = await supabase
            .from('user_search_history')
            .delete()
            .eq('user_id', user.id);

        if (error) {
            console.error('Error clearing search history:', error);
        }
    }
};
