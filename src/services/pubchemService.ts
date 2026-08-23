/**
 * PubChem GHS lookup service.
 *
 * Transient upstream failures are deliberately not cached. Successful data,
 * confirmed misses, and a genuine absence of GHS data have separate TTLs.
 */

import { supabase } from './supabaseClient';
import { normalizeCasNumber } from '../utils/casNumber';
import { isChemicalEnrichmentEnabled } from '../config/featureFlags';
import { enrichChemical } from './chemicalEnrichmentService';

export type PubChemGHSStatus =
    | 'success'
    | 'not_found'
    | 'no_ghs'
    | 'transient_error'
    | 'invalid_cas';

export interface PubChemGHSResult {
    cid: number;
    name: string;
    hCodes: string[];
    pictograms: string[];
    signalWord: string | null;
    isAcidic: boolean;
    isBasic: boolean;
    success: boolean;
    status: PubChemGHSStatus;
    error?: string;
}

export interface LookupGHSOptions {
    labId?: string | null;
}

export interface ChemicalGHSIdentityInput {
    name?: string;
    casNumber?: string;
    molecularFormula?: string;
    pubchemCid?: number;
    standardInchiKey?: string;
}

export interface IdentifiedPubChemGHSResult extends PubChemGHSResult {
    casNumber?: string;
}

interface ServerGhsCacheScope {
    scopeType: 'lab' | 'user';
    scopeId: string;
}

interface ServerGhsCacheRow {
    result: unknown;
    result_version?: number | null;
    cache_status?: string | null;
    fetched_at?: string | null;
    expires_at?: string | null;
}

type CacheableGhsStatus = Exclude<PubChemGHSStatus, 'transient_error' | 'invalid_cas'>;

interface GhsCacheEntry {
    schemaVersion: 2;
    status: CacheableGhsStatus;
    result: PubChemGHSResult;
    fetchedAt: number;
    expiresAt: number;
}

const SUCCESS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NOT_FOUND_CACHE_TTL_MS = 5 * 60 * 1000;
const NO_GHS_CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_FETCH_ATTEMPTS = 3;
const CACHE_SCHEMA_VERSION = 2 as const;
const SERVER_CACHE_RESULT_VERSION = 2;
const PERSISTED_CACHE_PREFIX = 'buril:pubchem-ghs:v2:';
const LEGACY_PERSISTED_CACHE_PREFIX = 'buril:pubchem-ghs:v1:';

const cache = new Map<string, GhsCacheEntry>();
const serverCacheWriteKeys = new Set<string>();
let hasLoggedServerCacheReadError = false;
let hasLoggedServerCacheWriteError = false;
let hasPurgedLegacyPersistentCache = false;

const PUG_REST_BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
const PUG_VIEW_BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug_view';

function getPersistentCache(): Storage | null {
    if (typeof window === 'undefined') return null;

    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function asStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
}

function isPubChemGHSStatus(value: unknown): value is PubChemGHSStatus {
    return value === 'success'
        || value === 'not_found'
        || value === 'no_ghs'
        || value === 'transient_error'
        || value === 'invalid_cas';
}

function isCacheableStatus(status: PubChemGHSStatus): status is CacheableGhsStatus {
    return status === 'success' || status === 'not_found' || status === 'no_ghs';
}

function normalizeCachedResult(value: unknown): PubChemGHSResult | null {
    if (!value || typeof value !== 'object') return null;

    const candidate = value as Partial<PubChemGHSResult>;
    if (typeof candidate.success !== 'boolean' || !isPubChemGHSStatus(candidate.status)) return null;

    return {
        cid: typeof candidate.cid === 'number' ? candidate.cid : 0,
        name: typeof candidate.name === 'string' ? candidate.name : '',
        hCodes: asStringArray(candidate.hCodes),
        pictograms: asStringArray(candidate.pictograms),
        signalWord: typeof candidate.signalWord === 'string' ? candidate.signalWord : null,
        isAcidic: Boolean(candidate.isAcidic),
        isBasic: Boolean(candidate.isBasic),
        success: candidate.success,
        status: candidate.status,
        error: typeof candidate.error === 'string' ? candidate.error : undefined,
    };
}

function getCacheTtlMs(status: CacheableGhsStatus): number {
    if (status === 'not_found') return NOT_FOUND_CACHE_TTL_MS;
    if (status === 'no_ghs') return NO_GHS_CACHE_TTL_MS;
    return SUCCESS_CACHE_TTL_MS;
}

function createCacheEntry(result: PubChemGHSResult, now = Date.now()): GhsCacheEntry | null {
    if (!isCacheableStatus(result.status)) return null;

    return {
        schemaVersion: CACHE_SCHEMA_VERSION,
        status: result.status,
        result,
        fetchedAt: now,
        expiresAt: now + getCacheTtlMs(result.status),
    };
}

function isFreshCacheEntry(entry: GhsCacheEntry | null | undefined): entry is GhsCacheEntry {
    return Boolean(
        entry
        && entry.schemaVersion === CACHE_SCHEMA_VERSION
        && isCacheableStatus(entry.status)
        && entry.result.status === entry.status
        && entry.expiresAt > Date.now()
    );
}

function purgeLegacyPersistentCache(): void {
    if (hasPurgedLegacyPersistentCache) return;
    hasPurgedLegacyPersistentCache = true;

    const storage = getPersistentCache();
    if (!storage) return;

    try {
        const legacyKeys: string[] = [];
        for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (key?.startsWith(LEGACY_PERSISTED_CACHE_PREFIX)) legacyKeys.push(key);
        }
        legacyKeys.forEach((key) => storage.removeItem(key));
    } catch {
        // Local cache cleanup is best effort.
    }
}

function readPersistedEntry(cas: string): GhsCacheEntry | null {
    const storage = getPersistentCache();
    if (!storage) return null;

    const key = `${PERSISTED_CACHE_PREFIX}${cas}`;

    try {
        const raw = storage.getItem(key);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as {
            schemaVersion?: number;
            status?: unknown;
            result?: unknown;
            fetchedAt?: number;
            expiresAt?: number;
        };
        const result = normalizeCachedResult(parsed.result);
        const status = parsed.status;
        const entry: GhsCacheEntry | null = result
            && isPubChemGHSStatus(status)
            && isCacheableStatus(status)
            && parsed.schemaVersion === CACHE_SCHEMA_VERSION
            && typeof parsed.fetchedAt === 'number'
            && typeof parsed.expiresAt === 'number'
            && result.status === status
            ? {
                schemaVersion: CACHE_SCHEMA_VERSION,
                status,
                result,
                fetchedAt: parsed.fetchedAt,
                expiresAt: parsed.expiresAt,
            }
            : null;

        if (!isFreshCacheEntry(entry)) {
            storage.removeItem(key);
            return null;
        }
        return entry;
    } catch {
        try {
            storage.removeItem(key);
        } catch {
            // Ignore malformed or inaccessible local cache entries.
        }
        return null;
    }
}

function writePersistedEntry(cas: string, entry: GhsCacheEntry): void {
    const storage = getPersistentCache();
    if (!storage) return;

    try {
        storage.setItem(`${PERSISTED_CACHE_PREFIX}${cas}`, JSON.stringify({
            schemaVersion: entry.schemaVersion,
            status: entry.status,
            fetchedAt: entry.fetchedAt,
            expiresAt: entry.expiresAt,
            result: entry.result,
        }));
    } catch {
        // Local cache is an optimization; failures should not block the UI.
    }
}

async function resolveServerCacheScope(options?: LookupGHSOptions): Promise<ServerGhsCacheScope | null> {
    const labId = options?.labId?.trim();
    if (labId) return { scopeType: 'lab', scopeId: labId };

    try {
        const { data, error } = await supabase.auth.getUser();
        if (error || !data.user?.id) return null;
        return { scopeType: 'user', scopeId: data.user.id };
    } catch {
        return null;
    }
}

function getServerCacheWriteKey(cas: string, scope: ServerGhsCacheScope): string {
    return `${scope.scopeType}:${scope.scopeId}:${cas}`;
}

async function readServerCachedEntry(cas: string, scope: ServerGhsCacheScope | null): Promise<GhsCacheEntry | null> {
    if (!scope) return null;

    try {
        const { data, error } = await supabase
            .from('ghs_cas_cache')
            .select('result, result_version, cache_status, fetched_at, expires_at')
            .eq('scope_type', scope.scopeType)
            .eq('scope_id', scope.scopeId)
            .eq('cas_number', cas)
            .gt('expires_at', new Date().toISOString())
            .limit(1)
            .maybeSingle();

        if (error) {
            if (!hasLoggedServerCacheReadError) {
                console.warn('[PubChem] Supabase GHS cache read failed:', error.message);
                hasLoggedServerCacheReadError = true;
            }
            return null;
        }

        const row = data as ServerGhsCacheRow | null;
        if (!row || row.result_version !== SERVER_CACHE_RESULT_VERSION) return null;

        const status = row.cache_status;
        const fetchedAt = row.fetched_at ? Date.parse(row.fetched_at) : NaN;
        const expiresAt = row.expires_at ? Date.parse(row.expires_at) : NaN;
        const result = normalizeCachedResult(row.result);
        const entry: GhsCacheEntry | null = result
            && isPubChemGHSStatus(status)
            && isCacheableStatus(status)
            && result.status === status
            && Number.isFinite(fetchedAt)
            && Number.isFinite(expiresAt)
            ? {
                schemaVersion: CACHE_SCHEMA_VERSION,
                status,
                result,
                fetchedAt,
                expiresAt,
            }
            : null;

        if (!isFreshCacheEntry(entry)) return null;
        serverCacheWriteKeys.add(getServerCacheWriteKey(cas, scope));
        return entry;
    } catch (error) {
        if (!hasLoggedServerCacheReadError) {
            console.warn('[PubChem] Supabase GHS cache read failed:', error);
            hasLoggedServerCacheReadError = true;
        }
        return null;
    }
}

async function writeServerCachedEntry(
    cas: string,
    entry: GhsCacheEntry,
    scope: ServerGhsCacheScope | null,
): Promise<void> {
    if (!scope) return;

    const writeKey = getServerCacheWriteKey(cas, scope);
    if (serverCacheWriteKeys.has(writeKey)) return;

    try {
        const { error } = await supabase
            .from('ghs_cas_cache')
            .upsert({
                scope_type: scope.scopeType,
                scope_id: scope.scopeId,
                cas_number: cas,
                result: entry.result,
                result_version: SERVER_CACHE_RESULT_VERSION,
                cache_status: entry.status,
                fetched_at: new Date(entry.fetchedAt).toISOString(),
                expires_at: new Date(entry.expiresAt).toISOString(),
                source: 'pubchem',
            }, {
                onConflict: 'scope_type,scope_id,cas_number',
            });

        if (error) {
            if (!hasLoggedServerCacheWriteError) {
                console.warn('[PubChem] Supabase GHS cache write failed:', error.message);
                hasLoggedServerCacheWriteError = true;
            }
            return;
        }

        serverCacheWriteKeys.add(writeKey);
    } catch (error) {
        if (!hasLoggedServerCacheWriteError) {
            console.warn('[PubChem] Supabase GHS cache write failed:', error);
            hasLoggedServerCacheWriteError = true;
        }
    }
}

async function seedServerCachedEntryIfMissing(
    cas: string,
    entry: GhsCacheEntry,
    scope: ServerGhsCacheScope | null,
): Promise<void> {
    if (!scope) return;
    if (serverCacheWriteKeys.has(getServerCacheWriteKey(cas, scope))) return;

    const existingEntry = await readServerCachedEntry(cas, scope);
    if (existingEntry) return;

    await writeServerCachedEntry(cas, entry, scope);
}

function extractHCode(statement: string): string | null {
    const match = statement.match(/^(H\d{3}[A-Za-z]?)/);
    return match ? match[1] : null;
}

function detectAcidic(hCodes: string[], name: string): boolean {
    const acidHCodes = ['H290', 'H314'];
    const acidKeywords = /acid|sulfuric|hydrochloric|nitric|phosphoric|산/i;
    return (
        hCodes.some((code) => acidHCodes.includes(code)) && acidKeywords.test(name)
    ) || acidKeywords.test(name);
}

function detectBasic(name: string): boolean {
    const baseKeywords = /hydroxide|수산화|ammonia|암모니아|amine|아민/i;
    return baseKeywords.test(name);
}

function pictogramName(url: string): string {
    const map: Record<string, string> = {
        GHS01: 'Exploding Bomb',
        GHS02: 'Flame',
        GHS03: 'Flame Over Circle',
        GHS04: 'Gas Cylinder',
        GHS05: 'Corrosive',
        GHS06: 'Skull and Crossbones',
        GHS07: 'Exclamation Mark',
        GHS08: 'Health Hazard',
        GHS09: 'Environment',
    };
    const match = url.match(/(GHS\d{2})/);
    return match ? map[match[1]] || match[1] : url;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findGHSInformation(sections: any[]): any[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = [];

    for (const section of sections) {
        if (section.TOCHeading === 'GHS Classification' && Array.isArray(section.Information)) {
            results.push(...section.Information);
        }
        if (Array.isArray(section.Section)) {
            results.push(...findGHSInformation(section.Section));
        }
    }

    return results;
}

type PubChemFetchOutcome<T> =
    | { kind: 'ok'; data: T }
    | { kind: 'not_found' }
    | { kind: 'transient_error'; error: string };

async function waitBeforeRetry(attempt: number): Promise<void> {
    const baseDelay = 300 * (2 ** attempt);
    const jitter = Math.floor(Math.random() * 150);
    await new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, baseDelay + jitter);
    });
}

async function fetchPubChemJson<T>(url: string): Promise<PubChemFetchOutcome<T>> {
    let lastError = 'PubChem request failed';

    for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt += 1) {
        const controller = new AbortController();
        const timeoutId = globalThis.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        try {
            const response = await fetch(url, { signal: controller.signal });

            if (response.status === 404) return { kind: 'not_found' };

            if (!response.ok) {
                lastError = `PubChem HTTP ${response.status}`;
                const shouldRetry = response.status === 408 || response.status === 429 || response.status >= 500;
                if (!shouldRetry || attempt === MAX_FETCH_ATTEMPTS - 1) {
                    return { kind: 'transient_error', error: lastError };
                }
                await waitBeforeRetry(attempt);
                continue;
            }

            try {
                return { kind: 'ok', data: await response.json() as T };
            } catch (error) {
                lastError = error instanceof Error ? error.message : 'Invalid PubChem JSON response';
                if (attempt === MAX_FETCH_ATTEMPTS - 1) {
                    return { kind: 'transient_error', error: lastError };
                }
                await waitBeforeRetry(attempt);
            }
        } catch (error) {
            lastError = error instanceof Error ? error.message : 'PubChem network request failed';
            if (attempt === MAX_FETCH_ATTEMPTS - 1) {
                return { kind: 'transient_error', error: lastError };
            }
            await waitBeforeRetry(attempt);
        } finally {
            globalThis.clearTimeout(timeoutId);
        }
    }

    return { kind: 'transient_error', error: lastError };
}

async function casToCid(cas: string): Promise<PubChemFetchOutcome<number>> {
    const url = `${PUG_REST_BASE}/compound/name/${encodeURIComponent(cas)}/cids/JSON`;
    const outcome = await fetchPubChemJson<{ IdentifierList?: { CID?: unknown } }>(url);
    if (outcome.kind !== 'ok') return outcome;

    const cids = outcome.data?.IdentifierList?.CID;
    if (Array.isArray(cids) && typeof cids[0] === 'number') {
        return { kind: 'ok', data: cids[0] };
    }
    return { kind: 'not_found' };
}

interface GhsPayload {
    hCodes: string[];
    pictograms: string[];
    signalWord: string | null;
    name: string;
}

type GhsFetchOutcome =
    | { kind: 'success'; data: GhsPayload }
    | { kind: 'no_ghs'; name?: string }
    | { kind: 'transient_error'; error: string };

async function cidToGHS(cid: number): Promise<GhsFetchOutcome> {
    const url = `${PUG_VIEW_BASE}/data/compound/${cid}/JSON?heading=GHS+Classification`;
    const outcome = await fetchPubChemJson<{
        Record?: {
            RecordTitle?: unknown;
            Section?: unknown;
        };
    }>(url);

    if (outcome.kind === 'transient_error') return outcome;
    if (outcome.kind === 'not_found') return { kind: 'no_ghs' };

    try {
        const result: GhsPayload = {
            hCodes: [],
            pictograms: [],
            signalWord: null,
            name: typeof outcome.data.Record?.RecordTitle === 'string'
                ? outcome.data.Record.RecordTitle
                : '',
        };
        const safetySections = outcome.data.Record?.Section;
        if (!Array.isArray(safetySections)) return { kind: 'no_ghs', name: result.name };

        const ghsInfo = findGHSInformation(safetySections);
        for (const info of ghsInfo) {
            if (info.Name === 'GHS Hazard Statements') {
                const strings = info.Value?.StringWithMarkup;
                if (Array.isArray(strings)) {
                    for (const item of strings) {
                        const code = extractHCode(typeof item.String === 'string' ? item.String : '');
                        if (code && !result.hCodes.includes(code)) result.hCodes.push(code);
                    }
                }
            }

            if (info.Name === 'Pictogram(s)') {
                const strings = info.Value?.StringWithMarkup;
                if (Array.isArray(strings)) {
                    for (const item of strings) {
                        const markups = item.Markup;
                        if (Array.isArray(markups)) {
                            for (const markup of markups) {
                                if (markup.Type === 'Icon' && typeof markup.URL === 'string') {
                                    const name = pictogramName(markup.URL);
                                    if (!result.pictograms.includes(name)) result.pictograms.push(name);
                                }
                            }
                        }
                    }
                }
            }

            if (info.Name === 'Signal') {
                const strings = info.Value?.StringWithMarkup;
                if (Array.isArray(strings) && typeof strings[0]?.String === 'string') {
                    result.signalWord = strings[0].String;
                }
            }
        }

        if (ghsInfo.length === 0 || (
            result.hCodes.length === 0
            && result.pictograms.length === 0
            && !result.signalWord
        )) {
            return { kind: 'no_ghs', name: result.name };
        }

        return { kind: 'success', data: result };
    } catch (error) {
        return {
            kind: 'transient_error',
            error: error instanceof Error ? error.message : 'Invalid PubChem GHS response',
        };
    }
}

function createResult(
    status: PubChemGHSStatus,
    fields: Partial<Pick<PubChemGHSResult, 'cid' | 'name' | 'hCodes' | 'pictograms' | 'signalWord' | 'isAcidic' | 'isBasic'>> = {},
    error?: string,
): PubChemGHSResult {
    return {
        cid: fields.cid ?? 0,
        name: fields.name ?? '',
        hCodes: fields.hCodes ?? [],
        pictograms: fields.pictograms ?? [],
        signalWord: fields.signalWord ?? null,
        isAcidic: fields.isAcidic ?? false,
        isBasic: fields.isBasic ?? false,
        success: status === 'success',
        status,
        error,
    };
}

function storeCacheEntry(cas: string, result: PubChemGHSResult): GhsCacheEntry | null {
    const entry = createCacheEntry(result);
    if (entry) cache.set(cas, entry);
    return entry;
}

export async function lookupGHSByCASLegacy(casNumber: string, options?: LookupGHSOptions): Promise<PubChemGHSResult> {
    purgeLegacyPersistentCache();

    const cas = normalizeCasNumber(casNumber);
    if (!cas) return createResult('invalid_cas', {}, `Invalid CAS format: "${casNumber}"`);

    const serverScope = await resolveServerCacheScope(options);

    const memoryEntry = cache.get(cas);
    if (isFreshCacheEntry(memoryEntry)) {
        void seedServerCachedEntryIfMissing(cas, memoryEntry, serverScope);
        return memoryEntry.result;
    }
    if (memoryEntry) cache.delete(cas);

    const persistedEntry = readPersistedEntry(cas);
    if (persistedEntry) {
        cache.set(cas, persistedEntry);
        void seedServerCachedEntryIfMissing(cas, persistedEntry, serverScope);
        return persistedEntry.result;
    }

    const serverEntry = await readServerCachedEntry(cas, serverScope);
    if (serverEntry) {
        cache.set(cas, serverEntry);
        writePersistedEntry(cas, serverEntry);
        return serverEntry.result;
    }

    const cidOutcome = await casToCid(cas);
    if (cidOutcome.kind === 'not_found') {
        const result = createResult('not_found', {}, `CAS "${cas}" not found in PubChem`);
        const entry = storeCacheEntry(cas, result);
        if (entry) {
            writePersistedEntry(cas, entry);
            await writeServerCachedEntry(cas, entry, serverScope);
        }
        return result;
    }
    if (cidOutcome.kind === 'transient_error') {
        return createResult('transient_error', {}, `PubChem lookup temporarily unavailable: ${cidOutcome.error}`);
    }

    const ghsOutcome = await cidToGHS(cidOutcome.data);
    if (ghsOutcome.kind === 'transient_error') {
        return createResult(
            'transient_error',
            { cid: cidOutcome.data },
            `PubChem GHS lookup temporarily unavailable: ${ghsOutcome.error}`,
        );
    }
    if (ghsOutcome.kind === 'no_ghs') {
        const result = createResult('no_ghs', { cid: cidOutcome.data, name: ghsOutcome.name });
        const entry = storeCacheEntry(cas, result);
        if (entry) {
            writePersistedEntry(cas, entry);
            await writeServerCachedEntry(cas, entry, serverScope);
        }
        return result;
    }

    const result = createResult('success', {
        cid: cidOutcome.data,
        name: ghsOutcome.data.name,
        hCodes: ghsOutcome.data.hCodes,
        pictograms: ghsOutcome.data.pictograms,
        signalWord: ghsOutcome.data.signalWord,
        isAcidic: detectAcidic(ghsOutcome.data.hCodes, ghsOutcome.data.name),
        isBasic: detectBasic(ghsOutcome.data.name),
    });
    const entry = storeCacheEntry(cas, result);
    if (entry) {
        writePersistedEntry(cas, entry);
        await writeServerCachedEntry(cas, entry, serverScope);
    }

    console.log(`[PubChem] ${cas} -> CID:${cidOutcome.data} | H-codes: [${result.hCodes.join(', ')}] | ${result.name}`);
    return result;
}

export async function lookupGHSByIdentity(
    input: ChemicalGHSIdentityInput,
    options?: LookupGHSOptions,
): Promise<IdentifiedPubChemGHSResult> {
    const cas = normalizeCasNumber(input.casNumber);
    if (!isChemicalEnrichmentEnabled) {
        return cas
            ? { ...(await lookupGHSByCASLegacy(cas, options)), casNumber: cas }
            : { ...createResult('invalid_cas', {}, 'A valid CAS is required by the legacy lookup.'), casNumber: undefined };
    }
    try {
        const result = await enrichChemical(
            {
                requestId: `ghs:${cas || input.standardInchiKey || input.pubchemCid || input.name || 'unknown'}`,
                ...(input.name ? { name: input.name } : {}),
                ...(cas ? { casNumber: cas } : {}),
                ...(input.molecularFormula ? { molecularFormula: input.molecularFormula } : {}),
                ...(input.pubchemCid ? { pubchemCid: input.pubchemCid } : {}),
                ...(input.standardInchiKey ? { standardInchiKey: input.standardInchiKey } : {}),
            },
            { labId: options?.labId },
        );
        if (result.identity.status === 'not_found') {
            return { ...createResult('not_found', {}, 'Chemical identity was not found.'), casNumber: undefined };
        }
        if (result.hazard.status === 'transient_error') {
            return {
                ...createResult('transient_error', { cid: result.identity.pubchemCid }, 'Automatic hazard lookup is retrying.'),
                casNumber: result.identity.casNumber,
            };
        }
        if (
            (result.hazard.status === 'source_absent' || result.hazard.status === 'identity_ambiguous')
            && result.hazard.hCodes.length === 0
            && result.hazard.pictograms.length === 0
        ) {
            return {
                ...createResult('no_ghs', {
                    cid: result.identity.pubchemCid,
                    name: result.identity.canonicalName,
                }),
                casNumber: result.identity.casNumber,
            };
        }
        return {
            ...createResult('success', {
                cid: result.identity.pubchemCid,
                name: result.identity.canonicalName,
                hCodes: result.hazard.hCodes,
                pictograms: result.hazard.pictograms,
                signalWord: result.hazard.signalWord || null,
                isAcidic: detectAcidic(result.hazard.hCodes, result.identity.canonicalName || ''),
                isBasic: detectBasic(result.identity.canonicalName || ''),
            }),
            casNumber: result.identity.casNumber,
        };
    } catch (error) {
        return {
            ...createResult(
                'transient_error',
                {},
                error instanceof Error ? error.message : 'Automatic hazard lookup is temporarily unavailable.',
            ),
            casNumber: cas || undefined,
        };
    }
}

export async function lookupGHSByCAS(casNumber: string, options?: LookupGHSOptions): Promise<PubChemGHSResult> {
    const cas = normalizeCasNumber(casNumber);
    if (!cas) return createResult('invalid_cas', {}, `Invalid CAS format: "${casNumber}"`);
    return lookupGHSByIdentity({ casNumber: cas }, options);
}

export function clearPubChemCache(): void {
    cache.clear();
    serverCacheWriteKeys.clear();
}
