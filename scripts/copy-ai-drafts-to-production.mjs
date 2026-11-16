// Copies the AI reagent drafts (reagent_reference_drafts, reagent_alias_drafts) from
// Buril-Lab-Staging to Buril-Lab production. Ids are kept, so the copy can be re-run:
// rows that already exist in production are left untouched.
//
// Reads Staging only, writes only these two tables in production. Dry run unless --apply.
//
//   $env:STAGING_SUPABASE_URL = "https://qpgnomuqdcucjmxrunnw.supabase.co"
//   $env:STAGING_SUPABASE_SERVICE_ROLE_KEY = "..."
//   $env:PRODUCTION_SUPABASE_URL = "https://zafxzidbtbryiksemlwc.supabase.co"
//   $env:PRODUCTION_SUPABASE_SERVICE_ROLE_KEY = "..."
//   node scripts/copy-ai-drafts-to-production.mjs            (counts only)
//   node scripts/copy-ai-drafts-to-production.mjs --apply    (copies)
import { createClient } from '@supabase/supabase-js';

const STAGING_REF = 'qpgnomuqdcucjmxrunnw';
const PRODUCTION_REF = 'zafxzidbtbryiksemlwc';
const READ_PAGE = 1000;
const DRAFT_WRITE_BATCH = 100;
const ALIAS_WRITE_BATCH = 1000;
const apply = process.argv.includes('--apply');

function client(prefix, ref) {
    const url = process.env[`${prefix}_SUPABASE_URL`]?.trim() || '';
    const key = process.env[`${prefix}_SUPABASE_SERVICE_ROLE_KEY`]?.trim() || '';
    if (!url || !key) throw new Error(`Set ${prefix}_SUPABASE_URL and ${prefix}_SUPABASE_SERVICE_ROLE_KEY.`);
    if (new URL(url).hostname !== `${ref}.supabase.co`) throw new Error(`${prefix}_SUPABASE_URL must be ${ref}.supabase.co.`);
    return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

const staging = client('STAGING', STAGING_REF);
const production = client('PRODUCTION', PRODUCTION_REF);

async function readAll(table, columns) {
    const rows = [];
    for (let from = 0; ; from += READ_PAGE) {
        const { data, error } = await staging.from(table).select(columns).order('id').range(from, from + READ_PAGE - 1);
        if (error) throw new Error(`Reading Staging ${table} failed: ${error.message}`);
        rows.push(...data);
        if (data.length < READ_PAGE) return rows;
    }
}

async function count(db, table) {
    const { count: total, error } = await db.from(table).select('id', { count: 'exact', head: true });
    if (error) throw new Error(`Counting ${table} failed: ${error.message}`);
    return total;
}

async function write(table, rows, batchSize) {
    let written = 0;
    for (let index = 0; index < rows.length; index += batchSize) {
        const batch = rows.slice(index, index + batchSize);
        const { error } = await production.from(table).upsert(batch, { onConflict: 'id', ignoreDuplicates: true });
        if (error) throw new Error(`Writing production ${table} failed at row ${index}: ${error.message}`);
        written += batch.length;
        process.stdout.write(`\r${table}: ${written}/${rows.length}`);
    }
    process.stdout.write('\n');
}

// reviewed_by points at Staging users, which do not exist in production.
const drafts = (await readAll('reagent_reference_drafts', '*')).map((row) => ({ ...row, reviewed_by: null }));
const aliases = await readAll('reagent_alias_drafts', 'id, draft_id, alias, normalized_alias, kind, status, reject_reason, created_at');
console.log(`Staging: ${drafts.length} drafts, ${aliases.length} alias drafts.`);
console.log(`Production before: ${await count(production, 'reagent_reference_drafts')} drafts, ${await count(production, 'reagent_alias_drafts')} alias drafts.`);

if (!apply) {
    console.log('Dry run. Re-run with --apply to copy.');
} else {
    await write('reagent_reference_drafts', drafts, DRAFT_WRITE_BATCH);
    await write('reagent_alias_drafts', aliases, ALIAS_WRITE_BATCH);
    console.log(`Production after: ${await count(production, 'reagent_reference_drafts')} drafts, ${await count(production, 'reagent_alias_drafts')} alias drafts.`);
}
