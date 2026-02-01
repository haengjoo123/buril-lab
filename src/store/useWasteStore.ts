import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CartItem } from '../types';

interface WasteState {
    cart: CartItem[];
    addToCart: (result: CartItem) => void;
    removeFromCart: (id: string) => void;
    clearCart: () => void;

    // Search History State
    recentSearches: string[];
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
            addSearchHistory: (query) => set((state) => {
                const normalized = query.trim();
                if (!normalized) return state; // Block empty strings
                // Remove existing if present to move to top, limit to 5
                const filtered = state.recentSearches.filter(q => q !== normalized);
                return { recentSearches: [normalized, ...filtered].slice(0, 5) };
            }),
            removeSearchHistory: (query) => set((state) => ({
                recentSearches: state.recentSearches.filter(q => q !== query)
            })),
            clearSearchHistory: () => set({ recentSearches: [] }),
        }),
        {
            name: 'buril-waste-store',
            partialize: (state) => ({ cart: state.cart, recentSearches: state.recentSearches }), // Persist cart and history
        }
    )
)
