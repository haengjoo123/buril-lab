import type { ReagentGhsStatus, ReagentPlacement } from '../../types/fridge';
import { classifyStoragePlacement, requiresLockedStorage } from '../../utils/storageCompatibilityChecker';
import { kstDateString } from './inspectionSummary';

/**
 * Lab-level signals the daily inspection and the admin overview both read.
 * Pure functions here; the loader that fetches their inputs is in
 * services/labSafetySignalService.ts.
 */

export interface LabCabinetLockInput {
    id: string;
    name: string;
    /** null when not recorded (or before the cabinets.locked migration). */
    locked: boolean | null;
}

export interface LabCabinetItemInput {
    cabinetId: string;
    name: string;
    hCodes: string[];
    casNo: string | null;
    ghsStatus?: ReagentGhsStatus;
}

export interface CabinetLockGroup {
    cabinetId: string;
    cabinetName: string;
    /** Reagents in this cabinet that belong behind a lock. */
    count: number;
}

export interface CabinetLockSummary {
    /** Cabinets recorded as having no lock that hold such reagents. */
    unlocked: CabinetLockGroup[];
    /** Cabinets whose lock is not recorded yet but that hold such reagents. */
    unset: CabinetLockGroup[];
}

function asPlacement(item: LabCabinetItemInput, index: number): ReagentPlacement {
    return {
        id: `${item.cabinetId}:${index}`,
        reagentId: `${item.cabinetId}:${index}`,
        name: item.name,
        position: 0,
        width: 0,
        template: 'A',
        shelfId: '',
        isAcidic: false,
        isBasic: false,
        hCodes: item.hCodes,
        ghsStatus: item.ghsStatus,
        casNo: item.casNo ?? '',
    };
}

/** Groups lock-requiring reagents by cabinet; cabinets with a lock are left out. */
export function summarizeCabinetLocks(
    cabinets: readonly LabCabinetLockInput[],
    items: readonly LabCabinetItemInput[],
    isRegulatedLockRequired: (casNo: string | null) => boolean = () => false,
): CabinetLockSummary {
    const counts = new Map<string, number>();
    items.forEach((item, index) => {
        const placement = asPlacement(item, index);
        const needsLock = requiresLockedStorage({
            groups: classifyStoragePlacement(placement).groups,
            hCodes: item.hCodes,
            regulatedLockRequired: isRegulatedLockRequired(item.casNo),
        });
        if (needsLock) counts.set(item.cabinetId, (counts.get(item.cabinetId) ?? 0) + 1);
    });

    const summary: CabinetLockSummary = { unlocked: [], unset: [] };
    for (const cabinet of cabinets) {
        const count = counts.get(cabinet.id) ?? 0;
        if (count === 0 || cabinet.locked === true) continue;
        (cabinet.locked === false ? summary.unlocked : summary.unset).push({ cabinetId: cabinet.id, cabinetName: cabinet.name, count });
    }
    const byCount = (a: CabinetLockGroup, b: CabinetLockGroup) => b.count - a.count || a.cabinetName.localeCompare(b.cabinetName);
    summary.unlocked.sort(byCount);
    summary.unset.sort(byCount);
    return summary;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Window the admin card looks back over. */
export const INSPECTION_LOOKBACK_DAYS = 7;
/** Weekdays without a record in the window before the admin card appears. */
export const MISSING_WEEKDAYS_THRESHOLD = 2;

/**
 * Weekdays (Mon-Fri, KST) in the last 7 days, today excluded, that have no
 * inspection record, newest first. Weekends are left out: labs inspect before
 * research activity, and a missed weekend is not a reliable signal.
 */
export function missingInspectionWeekdays(
    records: ReadonlyArray<{ inspectionDate: string }>,
    now: number = Date.now(),
): string[] {
    const recorded = new Set(records.map((record) => record.inspectionDate));
    const missing: string[] = [];
    for (let offset = 1; offset <= INSPECTION_LOOKBACK_DAYS; offset += 1) {
        const date = kstDateString(now - offset * DAY_MS);
        const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
        if (weekday === 0 || weekday === 6) continue;
        if (!recorded.has(date)) missing.push(date);
    }
    return missing;
}

export type InspectionHintTarget =
    | { kind: 'cabinet'; cabinetId: string }
    | { kind: 'containers' };

export interface InspectionHint {
    count: number;
    /** What the count is about, already in the user's language. */
    text: string;
    target: InspectionHintTarget;
}

export interface InspectionHintCopy {
    lockMissing: (count: number) => string;
    lockUnset: (count: number) => string;
    containers: (count: number) => string;
}

/**
 * One quiet line under the checklist items that lab data can speak to. Items
 * without data get nothing, and the inspector still chooses every answer.
 */
export function buildInspectionHints(
    sources: { cabinetLocks?: CabinetLockSummary | null; containerAttentionCount?: number | null },
    copy: InspectionHintCopy,
): Partial<Record<string, InspectionHint>> {
    const hints: Partial<Record<string, InspectionHint>> = {};
    const locks = sources.cabinetLocks;
    if (locks && locks.unlocked.length > 0) {
        const count = locks.unlocked.reduce((sum, group) => sum + group.count, 0);
        hints.chemical_toxic = { count, text: copy.lockMissing(count), target: { kind: 'cabinet', cabinetId: locks.unlocked[0].cabinetId } };
    } else if (locks && locks.unset.length > 0) {
        hints.chemical_toxic = {
            count: locks.unset.length,
            text: copy.lockUnset(locks.unset.length),
            target: { kind: 'cabinet', cabinetId: locks.unset[0].cabinetId },
        };
    }
    const containers = sources.containerAttentionCount ?? 0;
    if (containers > 0) {
        hints.chemical_waste = { count: containers, text: copy.containers(containers), target: { kind: 'containers' } };
    }
    return hints;
}
