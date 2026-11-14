import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { ChemicalEnrichmentResult } from '../src/types';
import { enrichChemicalItem } from '../functions/api/chemicals/_pipeline';
import { CHEMICAL_ENRICHMENT_RESULT_VERSION, writeChemicalEnrichmentCache } from '../functions/api/chemicals/_cache';
import {
    classifyResult,
    isFinalOutcome,
    readProgress,
    runBackfill,
    selectBackfillTargets,
    type CachedEntry,
    type ProgressRecord,
} from './stagingEnrichmentBackfill';

const result = (overrides: {
    identity?: ChemicalEnrichmentResult['identity']['status'];
    hazard?: ChemicalEnrichmentResult['hazard']['status'];
    overall?: ChemicalEnrichmentResult['overallStatus'];
} = {}): ChemicalEnrichmentResult => ({
    requestId: 'x',
    overallStatus: overrides.overall ?? 'complete',
    identity: { status: overrides.identity ?? 'verified', pubchemCid: 180, equivalentPubchemCids: [180], evidence: [] },
    hazard: {
        status: overrides.hazard ?? 'classified',
        hCodes: ['H225'], hazardStatements: ['H225'], pictograms: [], hazardFlags: [], sources: [], fetchedAt: '2026-11-14T00:00:00.000Z',
    },
    referencePh: { status: 'not_requested' },
    phCatalog: { status: 'unmatched', candidateIds: [], catalogVersion: 'test' },
    enrichmentVersion: 3,
});

const NOW = new Date('2026-11-14T00:00:00.000Z');
const fresh: CachedEntry = { resultVersion: 3, expiresAt: '2026-11-20T00:00:00.000Z' };

describe('Staging enrichment backfill', () => {
    it('selects valid draft CAS numbers missing from the golden set and from the fresh cache', () => {
        const { targets, skipped } = selectBackfillTargets({
            draftCasNumbers: [
                '67-64-1',      // golden set
                '75-09-2',      // fresh current-version cache row
                '7732-18-5',    // expired cache row -> look up again
                '108-95-2',     // older result version -> look up again
                '50-00-0', '50-00-0', // duplicate
                '64-17-5',      // finished in an earlier run
                '123-45-6',     // bad checksum
                ' 71-43-2',     // not in normal form: the comparison could not match it later
                null,
            ],
            goldenCasNumbers: new Set(['67-64-1']),
            cached: new Map([
                ['75-09-2', fresh],
                ['7732-18-5', { resultVersion: 3, expiresAt: '2026-11-01T00:00:00.000Z' }],
                ['108-95-2', { resultVersion: 2, expiresAt: '2026-11-20T00:00:00.000Z' }],
            ]),
            currentVersion: 3,
            alreadyDone: new Set(['64-17-5']),
            now: NOW,
        });
        expect(targets).toEqual(['108-95-2', '50-00-0', '7732-18-5']);
        expect(skipped).toEqual({ invalidCas: ['123-45-6', ' 71-43-2'], inGoldenSet: 1, freshInCache: 1, alreadyDone: 1 });
    });

    it('classifies results the way the comparison will use them', () => {
        expect(classifyResult(result())).toBe('usable');
        expect(classifyResult(result({ hazard: 'not_classified' }))).toBe('usable');
        expect(classifyResult(result({ hazard: 'source_absent', overall: 'needs_review' }))).toBe('needs_review');
        expect(classifyResult(result({ identity: 'ambiguous', hazard: 'identity_ambiguous', overall: 'needs_review' }))).toBe('needs_review');
        expect(classifyResult(result({ identity: 'not_found', hazard: 'source_absent', overall: 'needs_review' }))).toBe('not_found');
        expect(classifyResult(result({ hazard: 'transient_error', overall: 'retryable' }))).toBe('transient');
        expect(isFinalOutcome('usable')).toBe(true);
        expect(isFinalOutcome('transient')).toBe(false);
    });

    it('paces lookups, retries transient failures with backoff and never writes a transient result', async () => {
        const sleeps: number[] = [];
        const writes: string[] = [];
        const records: ProgressRecord[] = [];
        const replies: Record<string, ChemicalEnrichmentResult[]> = {
            'a': [result({ hazard: 'transient_error', overall: 'retryable' }), result()],
            'b': [result({ hazard: 'transient_error', overall: 'retryable' }), result({ hazard: 'transient_error', overall: 'retryable' }), result({ hazard: 'transient_error', overall: 'retryable' })],
            'c': [result({ hazard: 'source_absent', overall: 'needs_review' })],
        };
        const calls: string[] = [];
        const stats = await runBackfill(['a', 'b', 'c', 'd', 'e'], {
            enrich: async (cas) => {
                calls.push(cas);
                if (cas === 'd') throw new Error('network down');
                return replies[cas]?.shift() ?? result();
            },
            write: async (cas) => { writes.push(cas); return cas !== 'e'; },
            sleep: async (ms) => { sleeps.push(ms); },
            record: (record) => records.push(record),
            now: () => NOW,
        }, { delayMs: 1500, maxRetries: 2, retryBaseMs: 5000 });

        expect(calls).toEqual(['a', 'a', 'b', 'b', 'b', 'c', 'd', 'e']);
        expect(sleeps).toEqual([5000, 1500, 5000, 15000, 1500, 1500, 1500]);
        expect(writes).toEqual(['a', 'c', 'e']);
        expect(records.map((record) => [record.cas, record.outcome])).toEqual([
            ['a', 'usable'], ['b', 'transient'], ['c', 'needs_review'], ['d', 'error'], ['e', 'write_failed'],
        ]);
        expect(stats).toEqual({ attempted: 5, usable: 1, needs_review: 1, not_found: 0, transient: 1, write_failed: 1, error: 1 });
    });

    it('resumes from the progress file, keeping the last record per CAS and skipping a torn line', () => {
        const progress = readProgress([
            JSON.stringify({ cas: 'a', outcome: 'transient', at: '1' }),
            JSON.stringify({ cas: 'a', outcome: 'usable', at: '2' }),
            JSON.stringify({ cas: 'b', outcome: 'error', at: '3' }),
            '{"cas":"c","outc',
        ].join('\n'));
        expect([...progress.keys()]).toEqual(['a', 'b']);
        expect(progress.get('a')?.outcome).toBe('usable');
    });
});

// ---- Live run: only when scripts/backfill-staging-enrichment-cache.mjs turns it on. ----
const STAGING_REF = 'qpgnomuqdcucjmxrunnw';
const PAGE_SIZE = 500;
const CACHE_KEY_CHUNK = 100;
const mode = process.env.STAGING_ENRICHMENT_BACKFILL;
const runDescribe = mode === 'run' || mode === 'dry-run' ? describe : describe.skip;

runDescribe('Staging enrichment backfill run', () => {
    it('fills the Staging enrichment cache for the AI draft CAS numbers', async () => {
        const url = process.env.STAGING_SUPABASE_URL?.trim() || '';
        const key = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
        const outputDirectory = process.env.STAGING_ENRICHMENT_BACKFILL_OUTPUT || '';
        expect(new URL(url).hostname).toBe(`${STAGING_REF}.supabase.co`);
        expect(key).not.toBe('');
        expect(outputDirectory).not.toBe('');
        const limit = Number(process.env.STAGING_ENRICHMENT_BACKFILL_LIMIT ?? Infinity);
        const delayMs = Number(process.env.STAGING_ENRICHMENT_BACKFILL_DELAY_MS ?? 1500);
        const koshaKey = process.env.KOSHA_API_KEY?.trim() || '';
        const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

        const draftCasNumbers: (string | null)[] = [];
        for (let from = 0; ; from += PAGE_SIZE) {
            const { data, error } = await client.from('reagent_reference_drafts')
                .select('cas_number').order('source_reagent_id').range(from, from + PAGE_SIZE - 1);
            if (error) throw new Error(`Draft read failed: ${error.message}`);
            draftCasNumbers.push(...data.map((row) => row.cas_number as string | null));
            if (data.length < PAGE_SIZE) break;
        }
        const distinctCas = [...new Set(draftCasNumbers.filter((cas): cas is string => Boolean(cas)))];
        const cached = new Map<string, CachedEntry>();
        for (let index = 0; index < distinctCas.length; index += CACHE_KEY_CHUNK) {
            const { data, error } = await client.from('chemical_enrichment_cache')
                .select('lookup_key, result_version, expires_at')
                .in('lookup_key', distinctCas.slice(index, index + CACHE_KEY_CHUNK).map((cas) => `cas:${cas}`));
            if (error) throw new Error(`Cache read failed: ${error.message}`);
            for (const row of data) {
                const cas = String(row.lookup_key).slice('cas:'.length);
                const existing = cached.get(cas);
                if (!existing || existing.resultVersion < row.result_version) {
                    cached.set(cas, { resultVersion: row.result_version, expiresAt: row.expires_at });
                }
            }
        }

        const goldenCasNumbers = new Set((JSON.parse(readFileSync(
            path.resolve(process.cwd(), 'data', 'waste-golden-set-v2', 'materials.json'), 'utf8',
        )) as Array<{ casNumber: string }>).map((row) => row.casNumber));
        mkdirSync(outputDirectory, { recursive: true });
        const progressPath = path.join(outputDirectory, 'progress.jsonl');
        const progress = existsSync(progressPath) ? readProgress(readFileSync(progressPath, 'utf8')) : new Map();
        const alreadyDone = new Set([...progress.values()].filter((record) => isFinalOutcome(record.outcome)).map((record) => record.cas));
        const selection = selectBackfillTargets({
            draftCasNumbers, goldenCasNumbers, cached, currentVersion: CHEMICAL_ENRICHMENT_RESULT_VERSION, alreadyDone,
        });
        const targets = selection.targets.slice(0, limit);
        writeFileSync(path.join(outputDirectory, 'targets.json'), `${JSON.stringify({ ...selection, targets }, null, 2)}\n`);
        console.log(JSON.stringify({
            mode,
            drafts: draftCasNumbers.length,
            distinctDraftCas: distinctCas.length,
            targets: targets.length,
            remainingAfterLimit: selection.targets.length - targets.length,
            skipped: { ...selection.skipped, invalidCas: selection.skipped.invalidCas.length },
            koshaKey: koshaKey ? 'set' : 'missing: a CAS with no PubChem GHS stays unresolved and is not cached',
            estimatedMinutes: Math.ceil((targets.length * (delayMs + 2500)) / 60000),
        }, null, 2));
        if (mode === 'dry-run') return;

        const cacheEnv = { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key };
        // The app's cache writer logs instead of throwing; watch for that log to count failed writes.
        const write = async (cas: string, enrichment: ChemicalEnrichmentResult) => {
            const originalWarn = console.warn;
            let failed = false;
            console.warn = (...args: unknown[]) => {
                if (String(args[0]).includes('chemical cache write failed')) failed = true;
                originalWarn(...args);
            };
            try {
                await writeChemicalEnrichmentCache(cacheEnv, { requestId: cas, casNumber: cas }, enrichment);
            } finally {
                console.warn = originalWarn;
            }
            return !failed;
        };
        const stats = await runBackfill(targets, {
            enrich: (cas) => enrichChemicalItem({ requestId: cas, casNumber: cas }, { KOSHA_API_KEY: koshaKey || undefined }),
            write,
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            record: (record) => appendFileSync(progressPath, `${JSON.stringify(record)}\n`),
            log: (line) => console.log(line),
        }, {
            delayMs,
            // Without a KOSHA key a CAS with no PubChem GHS always comes back transient; one retry
            // rides out a PubChem hiccup without spending more requests on it.
            maxRetries: koshaKey ? 2 : 1,
            retryBaseMs: 5000,
        });
        writeFileSync(path.join(outputDirectory, 'summary.json'), `${JSON.stringify({ finishedAt: new Date().toISOString(), stats }, null, 2)}\n`);
        console.log(JSON.stringify(stats, null, 2));
        expect(stats.attempted).toBe(targets.length);
    });
});
