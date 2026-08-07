export interface CalendarDate {
    year: number;
    month: number;
    day: number;
}

const ISO_DATE_TIME_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})T/;
const YEAR_FIRST_DATE_PATTERN = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const YEAR_LAST_DATE_PATTERN = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;

function createCalendarDate(year: number, month: number, day: number): CalendarDate | null {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;

    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (
        candidate.getUTCFullYear() !== year
        || candidate.getUTCMonth() !== month - 1
        || candidate.getUTCDate() !== day
    ) {
        return null;
    }

    return { year, month, day };
}

/** Parse a date into calendar parts without allowing JavaScript date rollover. */
export function parseCalendarDate(value?: string | null): CalendarDate | null {
    if (typeof value !== 'string') return null;

    const normalized = value.normalize('NFKC').trim();
    if (!normalized) return null;

    const isoDateTimeMatch = normalized.match(ISO_DATE_TIME_PATTERN);
    if (isoDateTimeMatch) {
        if (Number.isNaN(Date.parse(normalized))) return null;
        return createCalendarDate(
            Number(isoDateTimeMatch[1]),
            Number(isoDateTimeMatch[2]),
            Number(isoDateTimeMatch[3]),
        );
    }

    const yearFirstMatch = normalized.match(YEAR_FIRST_DATE_PATTERN);
    if (yearFirstMatch) {
        return createCalendarDate(
            Number(yearFirstMatch[1]),
            Number(yearFirstMatch[2]),
            Number(yearFirstMatch[3]),
        );
    }

    const yearLastMatch = normalized.match(YEAR_LAST_DATE_PATTERN);
    if (!yearLastMatch) {
        // Keep support for external sources that use a month name, while
        // avoiding JavaScript's permissive numeric rollover behavior above.
        if (!/[A-Za-z]/.test(normalized)) return null;
        const fallback = new Date(normalized);
        if (Number.isNaN(fallback.getTime())) return null;
        return createCalendarDate(
            fallback.getFullYear(),
            fallback.getMonth() + 1,
            fallback.getDate(),
        );
    }

    const first = Number(yearLastMatch[1]);
    const second = Number(yearLastMatch[2]);
    const year = Number(yearLastMatch[3]);

    // Resolve only unambiguous day/month order where possible. Ambiguous
    // slash/dash dates keep MM/DD/YYYY behavior, while dotted dates use the
    // common DD.MM.YYYY convention. YYYY.MM.DD is handled above.
    const separator = normalized.includes('.') ? '.' : normalized.includes('/') ? '/' : '-';
    const month = first > 12
        ? second
        : second > 12
            ? first
            : separator === '.'
                ? second
                : first;
    const day = first > 12
        ? first
        : second > 12
            ? second
            : separator === '.'
                ? first
                : second;

    return createCalendarDate(year, month, day);
}

export function normalizeExpiryDate(value?: string | null): string | null {
    const parsed = parseCalendarDate(value);
    if (!parsed) return null;

    return `${String(parsed.year).padStart(4, '0')}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`;
}

export function calendarDateToUtcMs(value: CalendarDate): number {
    return Date.UTC(value.year, value.month - 1, value.day);
}
