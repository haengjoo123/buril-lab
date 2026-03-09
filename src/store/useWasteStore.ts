import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CartItem } from '../types';
import { searchHistoryService } from '../services/searchHistoryService';

interface WasteState {
    cart: CartItem[];
    addToCart: (result: CartItem) => void;
    removeFromCart: (id: string) => void;
    clearCart: () => void;

    // Search History State
    recentSearches: string[];
    loadSearchHistory: () => Promise<void>;
    addSearchHistory: (query: string) => void;
    removeSearchHistory: (query: string) => void;
    clearSearchHistory: () => void;
}

export const useWasteStore = create<WasteState>()(
    persist(
        (set) => ({
            cart: [],
            addToCart: (result) => set((state) => {
                // Avoid duplicates based on Chemical ID
                if (state.cart.some(item => item.chemical.id === result.chemical.id)) {
                    return state;
                }
                return { cart: [...state.cart, result] };
            }),
            removeFromCart: (id) => set((state) => ({
                cart: state.cart.filter((item) => item.chemical.id !== id)
            })),
            clearCart: () => set({ cart: [] }),

            recentSearches: [],
            loadSearchHistory: async () => {
                const history = await searchHistoryService.getRecentSearches(5);
                set({ recentSearches: history });
            },
            addSearchHistory: (query) => {
                const normalized = query.trim();
                if (!normalized) return;

                set((state) => {
                    const filtered = state.recentSearches.filter(q => q !== normalized);
                    return { recentSearches: [normalized, ...filtered].slice(0, 5) };
                });

                searchHistoryService.addSearch(normalized).catch(console.error);
            },
            removeSearchHistory: (query) => {
                set((state) => ({
                    recentSearches: state.recentSearches.filter(q => q !== query)
                }));
                searchHistoryService.removeSearch(query).catch(console.error);
            },
            clearSearchHistory: () => {
                set({ recentSearches: [] });
                searchHistoryService.clearHistory().catch(console.error);
            },
        }),
        {
            name: 'buril-waste-store',
            partialize: (state) => ({ cart: state.cart }), // Only persist cart locally
        }
    )
)
