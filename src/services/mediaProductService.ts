/**
 * Media Product Service
 * Handles searching for media products from Supabase
 */

import { supabase } from './supabaseClient';

export interface MediaProduct {
    id: string;
    brand: string | null;
    product_name: string | null;
    product_numbers: string[] | null;
    thumbnail_url: string | null;
    url_slug: string | null;
}

export type SortOption = 'relevance' | 'name_asc' | 'name_desc' | 'brand_asc' | 'brand_desc';

export interface SearchOptions {
    query: string;
    limit?: number;
    brandFilter?: string;
    sortBy?: SortOption;
    exactProductNumber?: boolean;
}

export interface SearchResult {
    products: MediaProduct[];
    brands: string[];  // Unique brands in results for filter UI
    totalCount: number;
}

/**
 * Get list of all unique brands
 */
export async function getAllBrands(): Promise<string[]> {
    try {
        const { data, error } = await supabase
            .from('products')
            .select('brand')
            .not('brand', 'is', null)
            .order('brand');

        if (error) {
            console.error('[MediaProduct] Get brands error:', error);
            return [];
        }

        // Extract unique brands
        const uniqueBrands = [...new Set(data?.map(d => d.brand).filter(Boolean) as string[])];
        return uniqueBrands;
    } catch (error) {
        console.error('[MediaProduct] Get brands failed:', error);
        return [];
    }
}

/**
 * Enhanced search with filtering and sorting
 */
export async function searchMediaProductsAdvanced(options: SearchOptions): Promise<SearchResult> {
    const { query, limit = 20, brandFilter, sortBy = 'relevance', exactProductNumber = false } = options;

    if (!query.trim()) {
        return { products: [], brands: [], totalCount: 0 };
    }

    const searchTerm = query.trim();

    try {
        // If exact product number search
        if (exactProductNumber || /^[A-Za-z0-9\-]+$/.test(searchTerm)) {
            const { data: numberResults, error: numberError } = await supabase
                .from('products')
                .select('*')
                .contains('product_numbers', [searchTerm.toUpperCase()])
                .limit(limit);

            if (!numberError && numberResults && numberResults.length > 0) {
                const brands = [...new Set(numberResults.map(p => p.brand).filter(Boolean) as string[])];
                return { products: numberResults, brands, totalCount: numberResults.length };
            }
        }

        // Build query
        let queryBuilder = supabase.from('products').select('*', { count: 'exact' });

        // Search condition
        queryBuilder = queryBuilder.or(
            `product_name.ilike.%${searchTerm}%,brand.ilike.%${searchTerm}%`
        );

        // Brand filter
        if (brandFilter && brandFilter !== 'all') {
            queryBuilder = queryBuilder.eq('brand', brandFilter);
        }

        // Sorting
        switch (sortBy) {
            case 'name_asc':
                queryBuilder = queryBuilder.order('product_name', { ascending: true });
                break;
            case 'name_desc':
                queryBuilder = queryBuilder.order('product_name', { ascending: false });
                break;
            case 'brand_asc':
                queryBuilder = queryBuilder.order('brand', { ascending: true });
                break;
            case 'brand_desc':
                queryBuilder = queryBuilder.order('brand', { ascending: false });
                break;
            default:
                // relevance - no specific order, Supabase returns by match
                break;
        }

        queryBuilder = queryBuilder.limit(limit);

        const { data, error, count } = await queryBuilder;

        if (error) {
            console.error('[MediaProduct] Advanced search error:', error);
            return { products: [], brands: [], totalCount: 0 };
        }

        // Extract unique brands from results
        const brands = [...new Set(data?.map(p => p.brand).filter(Boolean) as string[])];

        return {
            products: data || [],
            brands,
            totalCount: count || 0
        };
    } catch (error) {
        console.error('[MediaProduct] Advanced search failed:', error);
        return { products: [], brands: [], totalCount: 0 };
    }
}

/**
 * Simple search (backward compatible)
 */
export async function searchMediaProducts(query: string, limit: number = 10): Promise<MediaProduct[]> {
    const result = await searchMediaProductsAdvanced({ query, limit });
    return result.products;
}

/**
 * Search by exact product number
 */
export async function searchByProductNumber(productNumber: string): Promise<MediaProduct | null> {
    if (!productNumber.trim()) {
        return null;
    }

    try {
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .contains('product_numbers', [productNumber.trim().toUpperCase()])
            .limit(1);

        if (error) {
            console.error('[MediaProduct] Product number search error:', error);
            return null;
        }

        return data && data.length > 0 ? data[0] : null;
    } catch (error) {
        console.error('[MediaProduct] Search by product number failed:', error);
        return null;
    }
}
