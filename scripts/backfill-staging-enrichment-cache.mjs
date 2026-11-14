// Fills Buril-Lab-Staging's chemical_enrichment_cache for the AI draft CAS numbers, using the
// app's own PubChem/KOSHA pipeline (enrichChemicalItem) and cache writer
// (writeChemicalEnrichmentCache). Staging only; any other Supabase host is refused.
//
//   STAGING_SUPABASE_URL=https://qpgnomuqdcucjmxrunnw.supabase.co \
//   STAGING_SUPABASE_SERVICE_ROLE_KEY=... [KOSHA_API_KEY=...] \
//   node scripts/backfill-staging-enrichment-cache.mjs [--dry-run] [--limit N] [--delay-ms 1500]
//
// --dry-run   reads Staging and lists the CAS numbers it would look up; no external lookup, no write.
// Progress goes to output/staging-enrichment-backfill/progress.jsonl, so a stopped run resumes
// where it left off. Afterwards run scripts/compare-ai-draft-waste.mjs again.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const STAGING_REF = 'qpgnomuqdcucjmxrunnw';

const numberArg = (name) => {
    const index = process.argv.indexOf(name);
    if (index === -1) return undefined;
    const value = Number(process.argv[index + 1]);
    if (!Number.isInteger(value) || value < 0) throw new Error(`${name} needs a non-negative integer.`);
    return String(value);
};

const url = process.env.STAGING_SUPABASE_URL?.trim() || '';
const key = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
if (!url || !key) throw new Error('Set STAGING_SUPABASE_URL and STAGING_SUPABASE_SERVICE_ROLE_KEY.');
if (new URL(url).hostname !== `${STAGING_REF}.supabase.co`) {
    throw new Error(`This backfill writes to Buril-Lab-Staging only (${STAGING_REF}).`);
}

const limit = numberArg('--limit');
const delayMs = numberArg('--delay-ms');
const vitestEntrypoint = path.join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');
const result = spawnSync(process.execPath, [
    vitestEntrypoint, 'run', 'scripts/staging-enrichment-backfill.test.ts',
    '--testTimeout=0', '--reporter=dot', '--silent=false',
], {
    cwd: process.cwd(),
    env: {
        ...process.env,
        STAGING_ENRICHMENT_BACKFILL: process.argv.includes('--dry-run') ? 'dry-run' : 'run',
        STAGING_ENRICHMENT_BACKFILL_OUTPUT: path.join(process.cwd(), 'output', 'staging-enrichment-backfill'),
        ...(limit ? { STAGING_ENRICHMENT_BACKFILL_LIMIT: limit } : {}),
        ...(delayMs ? { STAGING_ENRICHMENT_BACKFILL_DELAY_MS: delayMs } : {}),
    },
    stdio: 'inherit',
});
process.exitCode = result.status ?? 1;
