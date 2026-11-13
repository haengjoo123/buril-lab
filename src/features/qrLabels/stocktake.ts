/**
 * Stocktake (재고 실사): compare what is recorded at one storage location with
 * the labels actually found there.
 *
 * Pure state so the screen stays thin and the rules are testable. Nothing is
 * written to the inventory: a bottle recorded elsewhere is reported, not moved.
 */
export interface StocktakeItem {
    id: string;
    name: string;
    casNumber: string | null;
    /** Stable key of the recorded location, e.g. `cabinet:<id>` or `location:<id>`. */
    locationKey: string;
    locationLabel: string;
}

export type StocktakeVia = 'scan' | 'manual';

export interface StocktakeConfirmation {
    via: StocktakeVia;
    at: string;
}

export interface StocktakeState {
    locationKey: string;
    confirmations: Record<string, StocktakeConfirmation>;
    /** Ids scanned that are not in the current space's inventory. */
    unknownIds: string[];
}

export type StocktakeStatus = 'confirmed' | 'missing' | 'elsewhere';

export interface StocktakeRow {
    item: StocktakeItem;
    status: StocktakeStatus;
    confirmation: StocktakeConfirmation | null;
}

export interface StocktakeSummary {
    rows: StocktakeRow[];
    expected: number;
    confirmed: number;
    missing: number;
    elsewhere: number;
    unknown: number;
}

export function locationKeyOf(item: {
    storage_type?: string | null;
    cabinet_id?: string | null;
    storage_location_id?: string | null;
}): string {
    if (item.storage_type === 'cabinet' && item.cabinet_id) return `cabinet:${item.cabinet_id}`;
    if (item.storage_location_id) return `location:${item.storage_location_id}`;
    return 'other';
}

export function startStocktake(locationKey: string): StocktakeState {
    return { locationKey, confirmations: {}, unknownIds: [] };
}

/** Records a scanned id. Unknown ids are kept once so the screen can report them. */
export function recordScan(
    state: StocktakeState,
    id: string,
    items: readonly StocktakeItem[],
    at: Date = new Date(),
): { state: StocktakeState; item: StocktakeItem | null } {
    const normalized = id.toLowerCase();
    const item = items.find((candidate) => candidate.id.toLowerCase() === normalized) ?? null;
    if (!item) {
        if (state.unknownIds.includes(normalized)) return { state, item: null };
        return { state: { ...state, unknownIds: [...state.unknownIds, normalized] }, item: null };
    }
    if (state.confirmations[item.id]) return { state, item };
    return {
        state: { ...state, confirmations: { ...state.confirmations, [item.id]: { via: 'scan', at: at.toISOString() } } },
        item,
    };
}

export function setManualConfirmation(state: StocktakeState, id: string, confirmed: boolean, at: Date = new Date()): StocktakeState {
    const confirmations = { ...state.confirmations };
    if (confirmed) confirmations[id] = confirmations[id] ?? { via: 'manual', at: at.toISOString() };
    else delete confirmations[id];
    return { ...state, confirmations };
}

/** Recorded items first (missing before confirmed), then bottles found here but recorded elsewhere. */
export function summarizeStocktake(state: StocktakeState, items: readonly StocktakeItem[]): StocktakeSummary {
    const expectedRows: StocktakeRow[] = items
        .filter((item) => item.locationKey === state.locationKey)
        .map((item) => {
            const confirmation = state.confirmations[item.id] ?? null;
            return { item, status: confirmation ? 'confirmed' : 'missing', confirmation };
        });
    const elsewhereRows: StocktakeRow[] = items
        .filter((item) => item.locationKey !== state.locationKey && state.confirmations[item.id])
        .map((item) => ({ item, status: 'elsewhere', confirmation: state.confirmations[item.id] }));
    const order: Record<StocktakeStatus, number> = { missing: 0, elsewhere: 1, confirmed: 2 };
    const rows = [...expectedRows, ...elsewhereRows].sort((left, right) => (
        order[left.status] - order[right.status] || left.item.name.localeCompare(right.item.name)
    ));
    return {
        rows,
        expected: expectedRows.length,
        confirmed: expectedRows.filter((row) => row.status === 'confirmed').length,
        missing: expectedRows.filter((row) => row.status === 'missing').length,
        elsewhere: elsewhereRows.length,
        unknown: state.unknownIds.length,
    };
}
