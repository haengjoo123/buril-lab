/**
 * Supabase Client
 * Initializes and exports the Supabase client for use in the application
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    const errorMsg = 'Supabase credentials not found in environment variables';
    if (import.meta.env.PROD) {
        throw new Error(errorMsg);
    } else {
        console.warn(errorMsg);
    }
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

export default supabase;
