export type InventoryRemainingStage = 1 | 2 | 3 | 4;

export interface InventoryRemainingLevel {
    stage: InventoryRemainingStage;
    /** Value saved when the level is picked. */
    value: number;
    /** Idle chip colors. */
    color: string;
    /** Selected chip colors. */
    active: string;
}

/** The four remaining levels shared by the edit form and the quick-update bar. */
export const INVENTORY_REMAINING_LEVELS: readonly InventoryRemainingLevel[] = [
    { stage: 1, value: 5, color: 'bg-red-50 text-red-600 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800', active: 'bg-red-600 text-white border-red-600 dark:bg-red-600 dark:text-white' },
    { stage: 2, value: 30, color: 'bg-orange-50 text-orange-600 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-800', active: 'bg-orange-500 text-white border-orange-500 dark:bg-orange-500 dark:text-white' },
    { stage: 3, value: 60, color: 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800', active: 'bg-blue-600 text-white border-blue-600 dark:bg-blue-600 dark:text-white' },
    { stage: 4, value: 100, color: 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800', active: 'bg-emerald-600 text-white border-emerald-600 dark:bg-emerald-600 dark:text-white' },
];

export function getInventoryRemainingStage(percent?: number | null): InventoryRemainingStage {
    const value = percent ?? 100;
    if (value <= 10) return 1;
    if (value <= 30) return 2;
    if (value <= 70) return 3;
    return 4;
}

/** Only low levels deserve a badge; a full (default) bottle needs no label. */
export function isInventoryRemainingLow(percent?: number | null): boolean {
    return getInventoryRemainingStage(percent) <= 2;
}
