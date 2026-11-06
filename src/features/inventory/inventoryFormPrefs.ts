export interface LastInventoryLocation {
    storage_type: 'cabinet' | 'other';
    cabinet_id?: string;
    storage_location_id?: string;
}

const storageKey = (labId: string | null | undefined) => `buril:inventory:last-location:${labId || 'personal'}`;

/** Where the user last stored something in this lab (the next registration starts there). */
export function readLastInventoryLocation(labId: string | null | undefined): LastInventoryLocation | null {
    try {
        const raw = globalThis.localStorage?.getItem(storageKey(labId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<LastInventoryLocation>;
        if (parsed.storage_type === 'cabinet' && typeof parsed.cabinet_id === 'string' && parsed.cabinet_id) {
            return { storage_type: 'cabinet', cabinet_id: parsed.cabinet_id };
        }
        if (parsed.storage_type === 'other' && typeof parsed.storage_location_id === 'string' && parsed.storage_location_id) {
            return { storage_type: 'other', storage_location_id: parsed.storage_location_id };
        }
    } catch {
        // Storage can be unavailable (private mode) or hold a stale shape; fall back to defaults.
    }
    return null;
}

export function writeLastInventoryLocation(labId: string | null | undefined, location: LastInventoryLocation): void {
    const value: LastInventoryLocation | null = location.storage_type === 'cabinet'
        ? (location.cabinet_id ? { storage_type: 'cabinet', cabinet_id: location.cabinet_id } : null)
        : (location.storage_location_id ? { storage_type: 'other', storage_location_id: location.storage_location_id } : null);
    if (!value) return;
    try {
        globalThis.localStorage?.setItem(storageKey(labId), JSON.stringify(value));
    } catch {
        // Ignore quota/private-mode failures; this is only a convenience default.
    }
}
