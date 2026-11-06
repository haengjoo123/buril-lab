import type { WasteLogRecord } from '../services/wasteLogService';
import type { WasteStreamCode } from '../types';

export type LogGroupMode = 'day' | 'week' | 'month';

export interface GroupedLogSection {
    key: string;
    mode: LogGroupMode;
    title: string;
    subtitle: string;
    logs: WasteLogRecord[];
    /** Records that still count. Corrected (voided) records stay listed but never count. */
    activeCount: number;
    totalVolumeMl: number;
    latestCreatedAt: number;
}

/** A record this recent, written by the current user, is treated as just recorded. */
export const JUST_RECORDED_WINDOW_MS = 60 * 1000;

const SHORT_STREAM_LABELS: Record<WasteStreamCode, { ko: string; en: string }> = {
    ACID_AQUEOUS: { ko: '산성', en: 'Acidic' },
    ALKALI_AQUEOUS: { ko: '알칼리', en: 'Alkaline' },
    ORGANIC_HALOGENATED: { ko: '할로겐', en: 'Halogenated' },
    ORGANIC_NON_HALOGENATED: { ko: '비할로겐', en: 'Non-halogenated' },
    HEAVY_METAL: { ko: '중금속', en: 'Heavy metal' },
    CYANIDE_SULFIDE: { ko: '시안·황화물', en: 'Cyanide/sulfide' },
    REACTIVE_OXIDIZER: { ko: '반응성', en: 'Reactive' },
    SOLID_CONTAMINATED: { ko: '오염 고체', en: 'Solid' },
    AQUEOUS_OTHER: { ko: '기타 수계', en: 'Other aqueous' },
    SPECIAL_REVIEW: { ko: '분리 보관', en: 'Isolate' },
};

/** Compact stream name for a list row; the row's color dot carries the rest. */
export function shortWasteStreamLabel(code: string | null | undefined, language: string): string | null {
    if (!code) return null;
    const label = SHORT_STREAM_LABELS[code as WasteStreamCode];
    if (!label) return null;
    return language.startsWith('ko') ? label.ko : label.en;
}

export function getWasteChemicalName(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const component = value as Record<string, unknown>;
    const nestedChemical = component.chemical && typeof component.chemical === 'object'
        ? component.chemical as Record<string, unknown>
        : null;
    const candidate = nestedChemical?.name || component.chemicalName || component.chemical_name || component.name;
    return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

/** Distinct component names in recorded order (V2 `chemicalName`, legacy `chemical.name`). */
export function getWasteChemicalNames(components: readonly unknown[] | null | undefined): string[] {
    const names: string[] = [];
    for (const component of components ?? []) {
        const name = getWasteChemicalName(component);
        if (name && !names.includes(name)) names.push(name);
    }
    return names;
}

/** "Acetone + Methanol" and how many further names were left out of the text. */
export function summarizeChemicalNames(
    names: readonly string[],
    maxVisible: number,
): { text: string; extra: number } {
    const visible = names.slice(0, Math.max(1, maxVisible));
    return { text: visible.join(' + '), extra: names.length - visible.length };
}

/** Newest active record by this user created within the just-recorded window. */
export function findJustRecordedLogId(
    logs: readonly WasteLogRecord[],
    userId: string | null | undefined,
    now: number = Date.now(),
): string | null {
    let newest: { id: string; createdAt: number } | null = null;
    for (const log of logs) {
        if (log.voided_at) continue;
        if (userId && log.user_id && log.user_id !== userId) continue;
        const createdAt = new Date(log.created_at).getTime();
        // Absolute age tolerates a client clock that runs behind the server.
        if (!Number.isFinite(createdAt) || Math.abs(now - createdAt) > JUST_RECORDED_WINDOW_MS) continue;
        if (!newest || createdAt > newest.createdAt) newest = { id: log.id, createdAt };
    }
    return newest?.id ?? null;
}

export function getMostRecentSectionKey(sections: readonly GroupedLogSection[]): string | null {
    let latest: GroupedLogSection | null = null;
    for (const section of sections) {
        if (!latest || section.latestCreatedAt > latest.latestCreatedAt) latest = section;
    }
    return latest?.key ?? null;
}

export function formatVolumeMl(value: number, language: string): string {
    const rounded = Math.round(value * 10) / 10;
    return `${rounded.toLocaleString(language.startsWith('ko') ? 'ko-KR' : 'en-US')} mL`;
}

export function groupWasteLogsByAge(
    logs: WasteLogRecord[],
    sortOrder: 'asc' | 'desc',
    t: (key: string, options?: Record<string, unknown>) => string,
    lang: string,
    now: number = Date.now(),
): GroupedLogSection[] {
    const sections = new Map<string, GroupedLogSection>();

    for (const log of logs) {
        const createdAt = new Date(log.created_at);
        const ageInDays = Math.floor((now - createdAt.getTime()) / (24 * 60 * 60 * 1000));
        const mode: LogGroupMode = ageInDays <= 7 ? 'day' : ageInDays <= 90 ? 'week' : 'month';
        const bucketDate = mode === 'day'
            ? startOfDay(createdAt)
            : mode === 'week'
                ? startOfWeek(createdAt)
                : startOfMonth(createdAt);
        const key = `${mode}:${bucketDate.toISOString()}`;

        const counts = !log.voided_at;
        const volumeMl = counts ? sumLogVolume(log) : 0;
        const current = sections.get(key);
        if (current) {
            current.logs.push(log);
            if (counts) {
                current.activeCount += 1;
                current.totalVolumeMl += volumeMl;
            }
            current.latestCreatedAt = Math.max(current.latestCreatedAt, createdAt.getTime());
            continue;
        }

        sections.set(key, {
            key,
            mode,
            title: formatGroupTitle(mode, bucketDate, lang),
            subtitle: '',
            logs: [log],
            activeCount: counts ? 1 : 0,
            totalVolumeMl: volumeMl,
            latestCreatedAt: createdAt.getTime(),
        });
    }

    const grouped = Array.from(sections.values()).map(section => ({
        ...section,
        subtitle: formatGroupSubtitle(
            section.mode,
            getGroupBaseDate(section.key),
            new Date(section.latestCreatedAt),
            section.activeCount,
            t,
            lang
        ),
        logs: [...section.logs].sort((a, b) => {
            const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            return sortOrder === 'asc' ? diff : -diff;
        }),
    }));

    return grouped.sort((a, b) => {
        const diff = a.latestCreatedAt - b.latestCreatedAt;
        return sortOrder === 'asc' ? diff : -diff;
    });
}

function sumLogVolume(log: WasteLogRecord): number {
    if (typeof log.total_volume_ml === 'number' && !Number.isNaN(log.total_volume_ml)) {
        return log.total_volume_ml;
    }

    return log.chemicals.reduce((sum, chemical) => {
        if (!chemical.volume) {
            return sum;
        }

        const parsed = parseFloat(chemical.volume.replace(/[^0-9.]/g, ''));
        return Number.isNaN(parsed) ? sum : sum + parsed;
    }, 0);
}

function formatGroupTitle(mode: LogGroupMode, baseDate: Date, lang: string): string {
    const locale = lang.startsWith('ko') ? 'ko-KR' : 'en-US';
    if (mode === 'day') {
        return baseDate.toLocaleDateString(locale, {
            month: 'long',
            day: 'numeric',
            weekday: 'short',
        });
    }

    if (mode === 'week') {
        const endDate = new Date(baseDate);
        endDate.setDate(baseDate.getDate() + 6);
        return `${baseDate.toLocaleDateString(locale, {
            month: 'numeric',
            day: 'numeric',
        })} - ${endDate.toLocaleDateString(locale, {
            month: 'numeric',
            day: 'numeric',
        })}`;
    }

    return baseDate.toLocaleDateString(locale, {
        year: 'numeric',
        month: 'long',
    });
}

function formatGroupSubtitle(
    mode: LogGroupMode,
    baseDate: Date,
    latestDate: Date,
    count: number,
    t: (key: string, options?: Record<string, unknown>) => string,
    lang: string
): string {
    const locale = lang.startsWith('ko') ? 'ko-KR' : 'en-US';
    if (mode === 'day') {
        return t('log_group_day_count', { count });
    }

    if (mode === 'week') {
        return t('log_group_week_summary', {
            count,
            latest: latestDate.toLocaleDateString(locale),
        });
    }

    return t('log_group_month_summary', {
        count,
        month: baseDate.toLocaleDateString(locale, {
            year: 'numeric',
            month: 'long',
        }),
    });
}

function getGroupBaseDate(sectionKey: string): Date {
    const iso = sectionKey.slice(sectionKey.indexOf(':') + 1);
    return new Date(iso);
}

function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date): Date {
    const start = startOfDay(date);
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    return start;
}

function startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}
