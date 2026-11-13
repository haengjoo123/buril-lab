import { INSPECTION_ITEM_IDS, INSPECTION_SECTIONS, type InspectionSectionId } from './checklist';

/** ok = 양호, bad = 불량, na = 해당 없음. */
export type InspectionResult = 'ok' | 'bad' | 'na';
export type InspectionResults = Record<string, InspectionResult>;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The inspection day is the calendar day in Korea, whatever the device's time zone. */
export function kstDateString(now: number = Date.now()): string {
    return new Date(now + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** `days` calendar days ending today (KST), newest first. */
export function recentKstDates(days: number, now: number = Date.now()): string[] {
    return Array.from({ length: Math.max(0, days) }, (_, index) => kstDateString(now - index * DAY_MS));
}

export function isInspectionResult(value: unknown): value is InspectionResult {
    return value === 'ok' || value === 'bad' || value === 'na';
}

/** Keeps only known results; anything else in stored JSON is dropped. */
export function normalizeInspectionResults(value: unknown): InspectionResults {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const results: InspectionResults = {};
    for (const [key, result] of Object.entries(value as Record<string, unknown>)) {
        if (isInspectionResult(result)) results[key] = result;
    }
    return results;
}

export interface InspectionProgress {
    total: number;
    answered: number;
    issues: number;
    /** Ids of the current checklist that have no result yet, in checklist order. */
    missing: string[];
    complete: boolean;
}

export function summarizeInspection(results: InspectionResults): InspectionProgress {
    const missing = INSPECTION_ITEM_IDS.filter((id) => !isInspectionResult(results[id]));
    const issues = INSPECTION_ITEM_IDS.filter((id) => results[id] === 'bad').length;
    return {
        total: INSPECTION_ITEM_IDS.length,
        answered: INSPECTION_ITEM_IDS.length - missing.length,
        issues,
        missing,
        complete: missing.length === 0,
    };
}

/** Sets every item of a section to one result (for example a lab with no gas marks the section N/A). */
export function setSectionResult(
    results: InspectionResults,
    sectionId: InspectionSectionId,
    result: InspectionResult,
): InspectionResults {
    const section = INSPECTION_SECTIONS.find((candidate) => candidate.id === sectionId);
    if (!section) return results;
    const next = { ...results };
    for (const item of section.items) next[item.id] = result;
    return next;
}

/** Marks every unanswered item as satisfactory, leaving answers already given untouched. */
export function fillUnansweredAsOk(results: InspectionResults): InspectionResults {
    const next = { ...results };
    for (const id of INSPECTION_ITEM_IDS) {
        if (!isInspectionResult(next[id])) next[id] = 'ok';
    }
    return next;
}

export interface InspectionDay {
    date: string;
    status: 'done' | 'issues' | 'missing';
    issueCount: number;
}

/** One entry per requested date, so days without a record show as missing. */
export function buildInspectionDays(
    dates: readonly string[],
    records: ReadonlyArray<{ inspectionDate: string; issueCount: number }>,
): InspectionDay[] {
    const byDate = new Map(records.map((record) => [record.inspectionDate, record]));
    return dates.map((date) => {
        const record = byDate.get(date);
        if (!record) return { date, status: 'missing', issueCount: 0 };
        return { date, status: record.issueCount > 0 ? 'issues' : 'done', issueCount: record.issueCount };
    });
}
