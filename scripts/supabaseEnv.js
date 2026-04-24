export function getSupabaseScriptConfig() {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY before running this script.');
    }

    return { supabaseUrl, supabaseAnonKey };
}
