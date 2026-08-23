import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getPictogramCode } from '../data/ghsCodes';
import type {
    ChemicalEnrichmentResult,
    ChemicalHazardLookupStatus,
    GhsPictogramCode,
} from '../types';
import { normalizeCasNumber } from '../utils/casNumber';

export const INVENTORY_HAZARD_CACHE_VERSION = 3;
const MAX_PERSISTED_SNAPSHOTS = 1_000;

export type InventoryHazardSnapshotStatus = Exclude<ChemicalHazardLookupStatus, 'transient_error'>;

export interface InventoryHazardSnapshot {
    casNumber: string;
    status: InventoryHazardSnapshotStatus;
    hCodes: string[];
    pictogramCodes: GhsPictogramCode[];
    signalWord?: string;
    fetchedAt: string;
    expiresAt: string;
    enrichmentVersion: number;
    lastAccessedAt: string;
}

export interface InventoryHazardRuntimeState {
    status: 'loading' | 'refreshing' | 'error';
    requestToken: string;
    retryAfter?: number;
    error?: string;
}

interface SnapshotUpdate {
    key: string;
    snapshot: InventoryHazardSnapshot;
}

interface InventoryHazardState {
    snapshots: Record<string, InventoryHazardSnapshot>;
    runtimeByKey: Record<string, InventoryHazardRuntimeState>;
    upsertSnapshots: (updates: SnapshotUpdate[]) => void;
    touchSnapshots: (keys: string[]) => void;
    markRuntime: (keys: string[], runtime: InventoryHazardRuntimeState) => void;
    clearRuntime: (keys: string[], requestToken?: string) => void;
    retryNow: (key: string) => void;
    clearUser: (userId: string) => void;
}

const uniqueStrings = (values: readonly string[]) => Array.from(new Set(values.filter(Boolean)));

export function pruneInventoryHazardSnapshots(
    snapshots: Record<string, InventoryHazardSnapshot>,
): Record<string, InventoryHazardSnapshot> {
    const byUser = new Map<string, Array<[string, InventoryHazardSnapshot]>>();
    for (const entry of Object.entries(snapshots)) {
        const userKey = entry[0].split(':', 1)[0];
        const entries = byUser.get(userKey) || [];
        entries.push(entry);
        byUser.set(userKey, entries);
    }
    if (Array.from(byUser.values()).every((entries) => entries.length <= MAX_PERSISTED_SNAPSHOTS)) {
        return snapshots;
    }
    return Object.fromEntries(Array.from(byUser.values()).flatMap((entries) => (
        entries
            .sort((left, right) => Date.parse(right[1].lastAccessedAt) - Date.parse(left[1].lastAccessedAt))
            .slice(0, MAX_PERSISTED_SNAPSHOTS)
    )));
}

export function buildInventoryHazardScopeKey(
    userId: string | null | undefined,
    labId: string | null | undefined,
): string | null {
    const normalizedUserId = userId?.trim();
    if (!normalizedUserId) return null;
    return `${encodeURIComponent(normalizedUserId)}:${encodeURIComponent(labId?.trim() || 'personal')}`;
}

export function buildInventoryHazardEntryKey(
    userId: string | null | undefined,
    labId: string | null | undefined,
    casNumber: string | null | undefined,
): string | null {
    const scopeKey = buildInventoryHazardScopeKey(userId, labId);
    const normalizedCas = normalizeCasNumber(casNumber);
    return scopeKey && normalizedCas ? `${scopeKey}|${normalizedCas}` : null;
}

export function isInventoryHazardSnapshotFresh(
    snapshot: InventoryHazardSnapshot,
    now = Date.now(),
): boolean {
    return snapshot.enrichmentVersion >= INVENTORY_HAZARD_CACHE_VERSION
        && Date.parse(snapshot.expiresAt) > now;
}

export function createInventoryHazardSnapshot(
    casNumber: string,
    result: ChemicalEnrichmentResult,
    now = new Date(),
): InventoryHazardSnapshot | null {
    const normalizedCas = normalizeCasNumber(casNumber);
    const status = result.hazard.status;
    if (!normalizedCas || status === 'transient_error') return null;

    const fetchedAtMs = Date.parse(result.hazard.fetchedAt);
    const fetchedAt = Number.isFinite(fetchedAtMs) ? new Date(fetchedAtMs) : now;
    const ttlMs = status === 'classified' || status === 'not_classified'
        ? 7 * 24 * 60 * 60 * 1_000
        : 60 * 60 * 1_000;
    const suppliedExpiryMs = result.hazard.expiresAt ? Date.parse(result.hazard.expiresAt) : Number.NaN;
    const expiresAt = Number.isFinite(suppliedExpiryMs)
        ? new Date(suppliedExpiryMs)
        : new Date(fetchedAt.getTime() + ttlMs);
    const pictogramCodes = result.hazard.pictograms
        .map(getPictogramCode)
        .filter((code): code is GhsPictogramCode => Boolean(code));

    return {
        casNumber: normalizedCas,
        status,
        hCodes: uniqueStrings(result.hazard.hCodes),
        pictogramCodes: Array.from(new Set(pictogramCodes)),
        ...(result.hazard.signalWord ? { signalWord: result.hazard.signalWord } : {}),
        fetchedAt: fetchedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        enrichmentVersion: result.enrichmentVersion,
        lastAccessedAt: now.toISOString(),
    };
}

export const useInventoryHazardStore = create<InventoryHazardState>()(
    persist(
        (set) => ({
            snapshots: {},
            runtimeByKey: {},
            upsertSnapshots: (updates) => set((state) => {
                if (updates.length === 0) return state;
                const snapshots = { ...state.snapshots };
                for (const update of updates) snapshots[update.key] = update.snapshot;
                return { snapshots: pruneInventoryHazardSnapshots(snapshots) };
            }),
            touchSnapshots: (keys) => set((state) => {
                const now = new Date().toISOString();
                const snapshots = { ...state.snapshots };
                let changed = false;
                for (const key of new Set(keys)) {
                    const snapshot = snapshots[key];
                    if (!snapshot) continue;
                    snapshots[key] = { ...snapshot, lastAccessedAt: now };
                    changed = true;
                }
                return changed ? { snapshots } : state;
            }),
            markRuntime: (keys, runtime) => set((state) => {
                const runtimeByKey = { ...state.runtimeByKey };
                for (const key of new Set(keys)) runtimeByKey[key] = runtime;
                return { runtimeByKey };
            }),
            clearRuntime: (keys, requestToken) => set((state) => {
                const runtimeByKey = { ...state.runtimeByKey };
                let changed = false;
                for (const key of new Set(keys)) {
                    const existing = runtimeByKey[key];
                    if (!existing || (requestToken && existing.requestToken !== requestToken)) continue;
                    delete runtimeByKey[key];
                    changed = true;
                }
                return changed ? { runtimeByKey } : state;
            }),
            retryNow: (key) => set((state) => {
                if (!state.runtimeByKey[key]) return state;
                const runtimeByKey = { ...state.runtimeByKey };
                delete runtimeByKey[key];
                return { runtimeByKey };
            }),
            clearUser: (userId) => set((state) => {
                const prefix = `${encodeURIComponent(userId.trim())}:`;
                const snapshots = Object.fromEntries(
                    Object.entries(state.snapshots).filter(([key]) => !key.startsWith(prefix)),
                );
                const runtimeByKey = Object.fromEntries(
                    Object.entries(state.runtimeByKey).filter(([key]) => !key.startsWith(prefix)),
                );
                return { snapshots, runtimeByKey };
            }),
        }),
        {
            name: 'buril-inventory-hazard-cache-v1',
            version: 1,
            partialize: (state) => ({ snapshots: state.snapshots }),
        },
    ),
);
