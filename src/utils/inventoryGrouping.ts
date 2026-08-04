import { normalizeCasNumber } from './casNumber';

export type InventoryIdentityInput = {
    id: string;
    name: string;
    cas_number?: string | null;
};

export type InventoryIdentityKind = 'valid_cas' | 'name_only' | 'invalid_cas' | 'unidentified';

export type InventoryIdentityResolution = {
    groupKey: string;
    kind: InventoryIdentityKind;
    normalizedCas: string | null;
    normalizedName: string;
};

export function normalizeInventoryIdentityName(value?: string | null): string {
    return (value || '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('en-US');
}

export function resolveInventoryIdentity(item: InventoryIdentityInput): InventoryIdentityResolution {
    const rawCas = item.cas_number?.normalize('NFKC').trim() || '';
    const normalizedCas = normalizeCasNumber(rawCas);
    const normalizedName = normalizeInventoryIdentityName(item.name);

    if (normalizedCas) {
        return {
            groupKey: `cas:${normalizedCas}`,
            kind: 'valid_cas',
            normalizedCas,
            normalizedName,
        };
    }

    if (rawCas) {
        return {
            groupKey: `review:${item.id}`,
            kind: 'invalid_cas',
            normalizedCas: null,
            normalizedName,
        };
    }

    if (normalizedName) {
        return {
            groupKey: `name-only:${normalizedName}`,
            kind: 'name_only',
            normalizedCas: null,
            normalizedName,
        };
    }

    return {
        groupKey: `review:${item.id}`,
        kind: 'unidentified',
        normalizedCas: null,
        normalizedName: '',
    };
}

export function partitionInventoryItemsByIdentity<T extends InventoryIdentityInput>(items: T[]): T[][] {
    const groups = new Map<string, T[]>();

    for (const item of items) {
        const { groupKey } = resolveInventoryIdentity(item);
        const group = groups.get(groupKey);
        if (group) {
            group.push(item);
        } else {
            groups.set(groupKey, [item]);
        }
    }

    return Array.from(groups.values());
}

export function findInventoryIdentityConflictItemIds<T extends InventoryIdentityInput>(items: T[]): Set<string> {
    const conflictIds = new Set<string>();
    const validCasEntriesByName = new Map<string, Array<{ id: string; cas: string }>>();

    for (const item of items) {
        const resolution = resolveInventoryIdentity(item);

        if (resolution.kind === 'invalid_cas' || resolution.kind === 'unidentified') {
            conflictIds.add(item.id);
        }

        if (resolution.kind !== 'valid_cas' || !resolution.normalizedName || !resolution.normalizedCas) {
            continue;
        }

        const entries = validCasEntriesByName.get(resolution.normalizedName);
        const entry = { id: item.id, cas: resolution.normalizedCas };
        if (entries) {
            entries.push(entry);
        } else {
            validCasEntriesByName.set(resolution.normalizedName, [entry]);
        }
    }

    for (const entries of validCasEntriesByName.values()) {
        if (new Set(entries.map(({ cas }) => cas)).size <= 1) continue;
        entries.forEach(({ id }) => conflictIds.add(id));
    }

    return conflictIds;
}
