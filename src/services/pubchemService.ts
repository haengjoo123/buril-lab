/**
 * PubChem GHS Lookup Service
 * ═══════════════════════════
 * Fetches GHS hazard classification (H-codes, pictograms, signal word)
 * from PubChem's PUG REST / PUG View APIs using a CAS number.
 *
 * Flow: CAS Number → PubChem CID → GHS Classification → H-codes
 *
 * Rate limit: max 5 requests/second (PubChem policy)
 * Results are cached in-memory to avoid redundant API calls.
 */

import { supabase } from './supabaseClient';
import { normalizeCasNumber } from '../utils/casNumber';

// ═══════════════════════════════════════
// Types
// ═══════════════════════════════════════

export interface PubChemGHSResult {
    cid: number;
    name: string;
    hCodes: string[];            // e.g. ["H225", "H319", "H336"]
    pictograms: string[];        // e.g. ["Flame", "Exclamation Mark"]
    signalWord: string | null;   // "Danger" | "Warning" | null
    isAcidic: boolean;
    isBasic: boolean;
    success: boolean;
    error?: string;
}

export interface LookupGHSOptions {
    labId?: string | null;
}

interface ServerGhsCacheScope {
    scopeType: 'lab' | 'user';
    scopeId: string;
}

interface ServerGhsCacheRow {
    result: unknown;
    result_version?: number | null;
}

// ═══════════════════════════════════════
// In-memory Cache
// ═══════════════════════════════════════

const cache = new Map<string, PubChemGHSResult>();
const PERSISTED_CACHE_PREFIX = 'buril:pubchem-ghs:v1:';
const SERVER_CACHE_RESULT_VERSION = 1;
const serverCacheWriteKeys = new Set<string>();
let hasLoggedServerCacheReadError = false;
let hasLoggedServerCacheWriteError = false;

function getPersistentCache(): Storage | null {
    if (typeof window === 'undefined') return null;

    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeCachedResult(value: unknown): PubChemGHSResult | null {
    if (!value || typeof value !== 'object') return null;

    const candidate = value as Partial<PubChemGHSResult>;
    if (typeof candidate.success !== 'boolean') return null;

    return {
        cid: typeof candidate.cid === 'number' ? candidate.cid : 0,
        name: typeof candidate.name === 'string' ? candidate.name : '',
        hCodes: asStringArray(candidate.hCodes),
        pictograms: asStringArray(candidate.pictograms),
        signalWord: typeof candidate.signalWord === 'string' ? candidate.signalWord : null,
        isAcidic: Boolean(candidate.isAcidic),
        isBasic: Boolean(candidate.isBasic),
        success: candidate.success,
        error: typeof candidate.error === 'string' ? candidate.error : undefined,
    };
}

function readPersistedResult(cas: string): PubChemGHSResult | null {
    const storage = getPersistentCache();
    if (!storage) return null;

    try {
        const raw = storage.getItem(`${PERSISTED_CACHE_PREFIX}${cas}`);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as { result?: unknown };
        return normalizeCachedResult(parsed.result);
    } catch {
        return null;
    }
}

function writePersistedResult(cas: string, result: PubChemGHSResult): void {
    const storage = getPersistentCache();
    if (!storage) return;

    try {
        storage.setItem(`${PERSISTED_CACHE_PREFIX}${cas}`, JSON.stringify({
            cachedAt: new Date().toISOString(),
            result,
        }));
    } catch {
        // Local cache is an optimization; failures should not block the UI.
    }
}

async function resolveServerCacheScope(options?: LookupGHSOptions): Promise<ServerGhsCacheScope | null> {
    const labId = options?.labId?.trim();
    if (labId) {
        return { scopeType: 'lab', scopeId: labId };
    }

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

async function readServerCachedResult(cas: string, scope: ServerGhsCacheScope | null): Promise<PubChemGHSResult | null> {
    if (!scope) return null;

    try {
        const { data, error } = await supabase
            .from('ghs_cas_cache')
            .select('result, result_version')
            .eq('scope_type', scope.scopeType)
            .eq('scope_id', scope.scopeId)
            .eq('cas_number', cas)
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

        const result = normalizeCachedResult(row.result);
        if (result) {
            serverCacheWriteKeys.add(getServerCacheWriteKey(cas, scope));
        }
        return result;
    } catch (error) {
        if (!hasLoggedServerCacheReadError) {
            console.warn('[PubChem] Supabase GHS cache read failed:', error);
            hasLoggedServerCacheReadError = true;
        }
        return null;
    }
}

async function writeServerCachedResult(
    cas: string,
    result: PubChemGHSResult,
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
                result,
                result_version: SERVER_CACHE_RESULT_VERSION,
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

async function seedServerCachedResultIfMissing(
    cas: string,
    result: PubChemGHSResult,
    scope: ServerGhsCacheScope | null,
): Promise<void> {
    if (!scope) return;
    if (serverCacheWriteKeys.has(getServerCacheWriteKey(cas, scope))) return;

    const existingResult = await readServerCachedResult(cas, scope);
    if (existingResult) return;

    await writeServerCachedResult(cas, result, scope);
}

// ═══════════════════════════════════════
// API Base URLs
// ═══════════════════════════════════════

const PUG_REST_BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
const PUG_VIEW_BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug_view';

// ═══════════════════════════════════════
// Helpers
// ═══════════════════════════════════════

/**
 * Extract H-code from a hazard statement string.
 * e.g. "H302: Harmful if swallowed [Warning Acute toxicity, oral]" → "H302"
 */
function extractHCode(statement: string): string | null {
    const match = statement.match(/^(H\d{3}[A-Za-z]?)/);
    return match ? match[1] : null;
}

/**
 * Determine if a chemical is acidic based on H-codes and name
 */
function detectAcidic(hCodes: string[], name: string): boolean {
    // H-codes for corrosive substances + acid keywords
    const acidHCodes = ['H290', 'H314'];
    const acidKeywords = /acid|sulfuric|hydrochloric|nitric|phosphoric|산$/i;
    return (
        hCodes.some(c => acidHCodes.includes(c)) && acidKeywords.test(name)
    ) || acidKeywords.test(name);
}

/**
 * Determine if a chemical is basic based on name
 */
function detectBasic(name: string): boolean {
    const baseKeywords = /hydroxide|수산화|ammonia|암모니아|amine|아민/i;
    return baseKeywords.test(name);
}

/**
 * Map pictogram URL to friendly name
 */
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

// ═══════════════════════════════════════
// Main API Functions
// ═══════════════════════════════════════

/**
 * Step 1: CAS → PubChem CID
 */
async function casToCid(cas: string): Promise<number | null> {
    const url = `${PUG_REST_BASE}/compound/name/${encodeURIComponent(cas)}/cids/JSON`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.warn(`[PubChem] CAS→CID failed for ${cas}: HTTP ${res.status}`);
            return null;
        }
        const data = await res.json();
        const cids = data?.IdentifierList?.CID;
        if (Array.isArray(cids) && cids.length > 0) {
            return cids[0];
        }
        return null;
    } catch (err) {
        console.error(`[PubChem] CAS→CID error for ${cas}:`, err);
        return null;
    }
}

/**
 * Step 2: CID → GHS Classification
 */
async function cidToGHS(cid: number): Promise<{
    hCodes: string[];
    pictograms: string[];
    signalWord: string | null;
    name: string;
}> {
    const url = `${PUG_VIEW_BASE}/data/compound/${cid}/JSON?heading=GHS+Classification`;

    const result = {
        hCodes: [] as string[],
        pictograms: [] as string[],
        signalWord: null as string | null,
        name: '',
    };

    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.warn(`[PubChem] CID→GHS failed for ${cid}: HTTP ${res.status}`);
            return result;
        }

        const data = await res.json();
        result.name = data?.Record?.RecordTitle || '';

        // Navigate: Record → Section[0] → Section[0] → Section[0] → Information[]
        const safetySections = data?.Record?.Section;
        if (!Array.isArray(safetySections)) return result;

        // Find GHS Classification section recursively
        const ghsInfo = findGHSInformation(safetySections);

        for (const info of ghsInfo) {
            if (info.Name === 'GHS Hazard Statements') {
                // Extract H-codes from strings
                const strings = info.Value?.StringWithMarkup;
                if (Array.isArray(strings)) {
                    for (const item of strings) {
                        const code = extractHCode(item.String || '');
                        if (code && !result.hCodes.includes(code)) {
                            result.hCodes.push(code);
                        }
                    }
                }
            }

            if (info.Name === 'Pictogram(s)') {
                const strings = info.Value?.StringWithMarkup;
                if (Array.isArray(strings)) {
                    for (const item of strings) {
                        const markups = item.Markup;
                        if (Array.isArray(markups)) {
                            for (const m of markups) {
                                if (m.Type === 'Icon' && m.URL) {
                                    const name = pictogramName(m.URL);
                                    if (!result.pictograms.includes(name)) {
                                        result.pictograms.push(name);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (info.Name === 'Signal') {
                const strings = info.Value?.StringWithMarkup;
                if (Array.isArray(strings) && strings[0]?.String) {
                    result.signalWord = strings[0].String;
                }
            }
        }

        return result;
    } catch (err) {
        console.error(`[PubChem] CID→GHS error for ${cid}:`, err);
        return result;
    }
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

// ═══════════════════════════════════════
// Public API
// ═══════════════════════════════════════

/**
 * Look up GHS hazard classification by CAS number.
 * Results are cached in-memory.
 *
 * @param casNumber - CAS Registry Number (e.g. "67-64-1" for acetone)
 * @returns GHS classification data including H-codes
 */
export async function lookupGHSByCAS(casNumber: string, options?: LookupGHSOptions): Promise<PubChemGHSResult> {
    // Normalize
    const cas = normalizeCasNumber(casNumber);
    if (!cas) {
        return {
            cid: 0,
            name: '',
            hCodes: [],
            pictograms: [],
            signalWord: null,
            isAcidic: false,
            isBasic: false,
            success: false,
            error: `Invalid CAS format: "${casNumber}"`,
        };
    }

    const serverScope = await resolveServerCacheScope(options);

    // Check cache
    if (cache.has(cas)) {
        const cachedResult = cache.get(cas)!;
        void seedServerCachedResultIfMissing(cas, cachedResult, serverScope);
        return cachedResult;
    }

    const persistedResult = readPersistedResult(cas);
    if (persistedResult) {
        cache.set(cas, persistedResult);
        void seedServerCachedResultIfMissing(cas, persistedResult, serverScope);
        return persistedResult;
    }

    const serverResult = await readServerCachedResult(cas, serverScope);
    if (serverResult) {
        cache.set(cas, serverResult);
        writePersistedResult(cas, serverResult);
        return serverResult;
    }

    // Step 1: CAS → CID
    const cid = await casToCid(cas);
    if (!cid) {
        const failResult: PubChemGHSResult = {
            cid: 0,
            name: '',
            hCodes: [],
            pictograms: [],
            signalWord: null,
            isAcidic: false,
            isBasic: false,
            success: false,
            error: `CAS "${cas}" not found in PubChem`,
        };
        cache.set(cas, failResult);
        writePersistedResult(cas, failResult);
        await writeServerCachedResult(cas, failResult, serverScope);
        return failResult;
    }

    // Step 2: CID → GHS
    const ghs = await cidToGHS(cid);

    const result: PubChemGHSResult = {
        cid,
        name: ghs.name,
        hCodes: ghs.hCodes,
        pictograms: ghs.pictograms,
        signalWord: ghs.signalWord,
        isAcidic: detectAcidic(ghs.hCodes, ghs.name),
        isBasic: detectBasic(ghs.name),
        success: true,
    };

    // Cache the result
    cache.set(cas, result);
    writePersistedResult(cas, result);
    await writeServerCachedResult(cas, result, serverScope);

    console.log(`[PubChem] ${cas} → CID:${cid} | H-codes: [${result.hCodes.join(', ')}] | ${result.name}`);

    return result;
}

/**
 * Clear the in-memory cache (for testing or memory management)
 */
export function clearPubChemCache(): void {
    cache.clear();
}
