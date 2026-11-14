// Compares the AI reagent drafts on Buril-Lab-Staging with the app's waste decision engine.
// Offline report for the advisor; never writes to the database and never changes the engine.
//
//   STAGING_SUPABASE_URL=https://qpgnomuqdcucjmxrunnw.supabase.co \
//   STAGING_SUPABASE_SERVICE_ROLE_KEY=... node scripts/compare-ai-draft-waste.mjs
//   node scripts/compare-ai-draft-waste.mjs --input drafts.json [--cache enrichment-cache.json]
//     (existing exports; without --cache the cache is read from Staging when the keys are set)
//
// Evidence: the golden set first, then Staging's chemical_enrichment_cache (`cas:<CAS>`, read only).
// Output: output/ai-draft-waste-comparison/{mismatches,held,no-verified-evidence}.csv, summary.json,
//         plus drafts.json / enrichment-cache.json when they were exported here.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const STAGING_REF = 'qpgnomuqdcucjmxrunnw';
const PAGE_SIZE = 500;
const CACHE_KEY_CHUNK = 100;
const outputDirectory = path.join(process.cwd(), 'output', 'ai-draft-waste-comparison');

function hasStagingKeys() {
    return Boolean(process.env.STAGING_SUPABASE_URL?.trim() && process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function stagingClient() {
    const url = process.env.STAGING_SUPABASE_URL?.trim() || '';
    const key = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
    if (!url || !key) throw new Error('Set STAGING_SUPABASE_URL and STAGING_SUPABASE_SERVICE_ROLE_KEY, or pass --input.');
    if (new URL(url).hostname !== `${STAGING_REF}.supabase.co`) {
        throw new Error(`This report reads Buril-Lab-Staging only (${STAGING_REF}).`);
    }
    return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function fetchDrafts(client) {
    const drafts = [];
    for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await client
            .from('reagent_reference_drafts')
            .select('id, name_ko, name_en, cas_number, waste_matrix, lab_waste_category, hazard_flags, verify_overall, record->waste->>reasoning')
            .order('source_reagent_id')
            .range(from, from + PAGE_SIZE - 1);
        if (error) throw new Error(`Draft export failed: ${error.message}`);
        for (const row of data) {
            drafts.push({
                id: row.id,
                nameKo: row.name_ko,
                nameEn: row.name_en,
                casNumber: row.cas_number,
                wasteMatrix: row.waste_matrix,
                labWasteCategory: row.lab_waste_category,
                hazardFlags: row.hazard_flags ?? [],
                reasoning: row.reasoning ?? null,
                verifyOverall: row.verify_overall,
            });
        }
        if (data.length < PAGE_SIZE) break;
    }
    return drafts;
}

/** Latest result_version per CAS from the server enrichment cache. Read only; expired rows are kept and dated. */
async function fetchEnrichmentCache(client, casNumbers) {
    const byCas = {};
    const versions = {};
    for (let index = 0; index < casNumbers.length; index += CACHE_KEY_CHUNK) {
        const keys = casNumbers.slice(index, index + CACHE_KEY_CHUNK).map((cas) => `cas:${cas}`);
        const { data, error } = await client
            .from('chemical_enrichment_cache')
            .select('lookup_key, result_version, result, fetched_at')
            .in('lookup_key', keys);
        if (error) throw new Error(`Enrichment cache export failed: ${error.message}`);
        for (const row of data) {
            const cas = row.lookup_key.slice('cas:'.length);
            if ((versions[cas] ?? -1) >= row.result_version) continue;
            versions[cas] = row.result_version;
            byCas[cas] = { ...row.result, cacheFetchedAt: row.fetched_at, cacheResultVersion: row.result_version };
        }
    }
    return byCas;
}

const argValue = (flag) => {
    const index = process.argv.indexOf(flag);
    return index !== -1 && process.argv[index + 1] ? path.resolve(process.argv[index + 1]) : undefined;
};

let inputPath = argValue('--input');
let cachePath = argValue('--cache');
const client = !inputPath || (!cachePath && hasStagingKeys()) ? stagingClient() : null;
mkdirSync(outputDirectory, { recursive: true });
if (!inputPath) {
    const drafts = await fetchDrafts(client);
    inputPath = path.join(outputDirectory, 'drafts.json');
    writeFileSync(inputPath, `${JSON.stringify(drafts)}\n`);
    console.log(`Exported ${drafts.length} drafts from Staging.`);
}
if (!cachePath && client) {
    const drafts = JSON.parse(readFileSync(inputPath, 'utf8'));
    const casNumbers = [...new Set(drafts.map((draft) => draft.casNumber).filter(Boolean))];
    const cache = await fetchEnrichmentCache(client, casNumbers);
    cachePath = path.join(outputDirectory, 'enrichment-cache.json');
    writeFileSync(cachePath, `${JSON.stringify(cache)}\n`);
    console.log(`Read ${Object.keys(cache).length} of ${casNumbers.length} draft CAS numbers from the enrichment cache.`);
}
if (!cachePath) console.log('No enrichment cache given; comparing against the golden set only.');

const vitestEntrypoint = path.join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');
const result = spawnSync(process.execPath, [vitestEntrypoint, 'run', 'scripts/ai-draft-waste-comparison.test.ts', '--reporter=dot'], {
    cwd: process.cwd(),
    env: {
        ...process.env,
        AI_DRAFT_WASTE_INPUT: inputPath,
        AI_DRAFT_WASTE_OUTPUT: outputDirectory,
        ...(cachePath ? { AI_DRAFT_WASTE_CACHE: cachePath } : {}),
    },
    stdio: 'inherit',
});
process.exitCode = result.status ?? 1;
