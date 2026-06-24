export function getSupabaseScriptConfig() {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
        throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.');
    }

    return { supabaseUrl, supabaseServiceRoleKey };
}
