/**
 * Fills Buril-Lab-Staging's chemical_enrichment_cache for the AI draft CAS numbers so the
 * offline AI-draft waste comparison has verified PubChem/KOSHA evidence to work from.
 *
 * Only the selection, pacing, retry and progress bookkeeping live here. The lookup and the
 * cache write are injected and, in the runner, are the app's own `enrichChemicalItem` and
 * `writeChemicalEnrichmentCache`, so the cached rows are exactly what the app would store.
 * AI draft values are never sent anywhere: the only input is the CAS number.
 */
import type { ChemicalEnrichmentResult } from '../src/types';
import { normalizeCasNumber } from '../src/utils/casNumber';

export interface CachedEntry {
    resultVersion: number;
    expiresAt: string;
}

export interface TargetSelection {
    targets: string[];
    skipped: {
        invalidCas: string[];
        inGoldenSet: number;
        freshInCache: number;
        alreadyDone: number;
    };
}

/**
 * CAS numbers worth looking up: valid, not covered by the golden set (which takes priority
 * in the comparison), without a fresh current-version cache row, and not finished in an
 * earlier run.
 */
export function selectBackfillTargets(input: {
    draftCasNumbers: readonly (string | null | undefined)[];
    goldenCasNumbers: ReadonlySet<string>;
    cached: ReadonlyMap<string, CachedEntry>;
    currentVersion: number;
    alreadyDone?: ReadonlySet<string>;
    now?: Date;
}): TargetSelection {
    const now = (input.now ?? new Date()).getTime();
    const skipped: TargetSelection['skipped'] = { invalidCas: [], inGoldenSet: 0, freshInCache: 0, alreadyDone: 0 };
    const targets = new Set<string>();
    const seen = new Set<string>();
    for (const raw of input.draftCasNumbers) {
        if (!raw) continue;
        const cas = normalizeCasNumber(raw);
        // The comparison looks the cache up by the draft's CAS as stored, so only a CAS that is
        // already in normal form can be matched later.
        if (!cas || cas !== raw) { skipped.invalidCas.push(raw); continue; }
        if (seen.has(cas)) continue;
        seen.add(cas);
        if (input.goldenCasNumbers.has(cas)) { skipped.inGoldenSet += 1; continue; }
        const entry = input.cached.get(cas);
        if (entry && entry.resultVersion >= input.currentVersion && Date.parse(entry.expiresAt) > now) {
            skipped.freshInCache += 1;
            continue;
        }
        if (input.alreadyDone?.has(cas)) { skipped.alreadyDone += 1; continue; }
        targets.add(cas);
    }
    return { targets: [...targets].sort(), skipped };
}

export type BackfillOutcome =
    | 'usable'          // verified identity + classified/not_classified: the comparison can use it
    | 'needs_review'    // cached, but the comparison will not use it (ambiguous, source absent, ...)
    | 'not_found'       // PubChem has no record for the CAS (cached briefly by the app's TTL)
    | 'transient'       // upstream failed after retries; nothing written
    | 'write_failed'
    | 'error';

export interface ProgressRecord {
    cas: string;
    outcome: BackfillOutcome;
    hazardStatus?: string;
    identityStatus?: string;
    pubchemCid?: number;
    detail?: string;
    at: string;
}

export function classifyResult(result: ChemicalEnrichmentResult): Exclude<BackfillOutcome, 'write_failed' | 'error'> {
    if (result.overallStatus === 'retryable' || result.hazard.status === 'transient_error') return 'transient';
    if (result.identity.status === 'not_found') return 'not_found';
    if (result.identity.status === 'verified'
        && (result.hazard.status === 'classified' || result.hazard.status === 'not_classified')) return 'usable';
    return 'needs_review';
}

/** A finished CAS is not looked up again on resume; transient and failed ones are. */
export const isFinalOutcome = (outcome: BackfillOutcome) => outcome !== 'transient' && outcome !== 'write_failed' && outcome !== 'error';

export interface BackfillDeps {
    enrich(cas: string): Promise<ChemicalEnrichmentResult>;
    /** Resolves false when the row could not be written. */
    write(cas: string, result: ChemicalEnrichmentResult): Promise<boolean>;
    sleep(ms: number): Promise<void>;
    record(progress: ProgressRecord): void;
    now?: () => Date;
    log?: (line: string) => void;
}

export interface BackfillOptions {
    /** Pause between CAS numbers. One CAS costs several PubChem requests. */
    delayMs: number;
    /** Extra attempts for a transient upstream failure. */
    maxRetries: number;
    /** Backoff before retry n (1-based) is retryBaseMs * 3^(n-1). */
    retryBaseMs: number;
}

export type BackfillStats = Record<BackfillOutcome, number> & { attempted: number };

export async function runBackfill(targets: readonly string[], deps: BackfillDeps, options: BackfillOptions): Promise<BackfillStats> {
    const stats: BackfillStats = { attempted: 0, usable: 0, needs_review: 0, not_found: 0, transient: 0, write_failed: 0, error: 0 };
    const now = deps.now ?? (() => new Date());
    for (const [index, cas] of targets.entries()) {
        if (index > 0) await deps.sleep(options.delayMs);
        stats.attempted += 1;
        let record: ProgressRecord;
        try {
            let result = await deps.enrich(cas);
            for (let retry = 1; classifyResult(result) === 'transient' && retry <= options.maxRetries; retry += 1) {
                await deps.sleep(options.retryBaseMs * 3 ** (retry - 1));
                result = await deps.enrich(cas);
            }
            const outcome = classifyResult(result);
            const written = outcome === 'transient' ? true : await deps.write(cas, result);
            record = {
                cas,
                outcome: written ? outcome : 'write_failed',
                hazardStatus: result.hazard.status,
                identityStatus: result.identity.status,
                ...(result.identity.pubchemCid ? { pubchemCid: result.identity.pubchemCid } : {}),
                at: now().toISOString(),
            };
        } catch (error) {
            record = { cas, outcome: 'error', detail: error instanceof Error ? error.message : String(error), at: now().toISOString() };
        }
        stats[record.outcome] += 1;
        deps.record(record);
        deps.log?.(`[${index + 1}/${targets.length}] ${cas} ${record.outcome}${record.hazardStatus ? ` (${record.hazardStatus})` : ''}`);
    }
    return stats;
}

/** Parse the JSONL progress file; the last record for a CAS wins. */
export function readProgress(text: string): Map<string, ProgressRecord> {
    const records = new Map<string, ProgressRecord>();
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
            const record = JSON.parse(line) as ProgressRecord;
            if (record.cas) records.set(record.cas, record);
        } catch {
            // A run killed mid-write can leave a partial last line.
        }
    }
    return records;
}
