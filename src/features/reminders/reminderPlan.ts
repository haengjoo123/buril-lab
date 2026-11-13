/**
 * Device reminders (local notifications) for expiring reagents and the daily
 * lab inspection. Pure planning so the schedule is testable; the scheduler
 * hands the result to the native notification plugin.
 *
 * Reminders fire at 09:00 Korea time. iOS keeps at most 64 pending local
 * notifications per app and lab tool timers use part of that, so the number
 * of expiry reminders is capped and the soonest win.
 */
export interface ReminderSettings {
    expiry: boolean;
    /** Days before the expiry date to remind; 0 is the expiry day itself. */
    leadDays: number[];
    dailyInspection: boolean;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
    expiry: false,
    leadDays: [30, 7, 0],
    dailyInspection: false,
};

export const MAX_EXPIRY_REMINDERS = 30;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const REMIND_HOUR_KST = 9;

export interface ExpiringItem {
    id: string;
    name: string;
    /** YYYY-MM-DD */
    expiryDate: string | null;
}

export interface PlannedReminder {
    key: string;
    title: string;
    body: string;
    /** Epoch ms for a one-off reminder; null for the daily repeating one. */
    at: number | null;
    /** Daily repeat at this Korean hour (converted to the device's local hour by the scheduler). */
    dailyAtKstHour?: number;
}

export interface ReminderCopy {
    expiryTitle: (days: number) => string;
    expiryBody: (names: string[], more: number) => string;
    inspectionTitle: string;
    inspectionBody: string;
}

/** 09:00 KST on a YYYY-MM-DD date, as epoch ms. */
export function kstMorning(date: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) return null;
    const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), REMIND_HOUR_KST) - KST_OFFSET_MS;
    return Number.isNaN(utc) ? null : utc;
}

export function normalizeReminderSettings(value: unknown): ReminderSettings {
    const record = (value && typeof value === 'object' ? value : {}) as Partial<ReminderSettings>;
    const leadDays = Array.isArray(record.leadDays)
        ? [...new Set(record.leadDays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 365))].sort((a, b) => b - a)
        : DEFAULT_REMINDER_SETTINGS.leadDays;
    return {
        expiry: record.expiry === true,
        leadDays: leadDays.length > 0 ? leadDays : DEFAULT_REMINDER_SETTINGS.leadDays,
        dailyInspection: record.dailyInspection === true,
    };
}

/**
 * One reminder per (date, lead) with every item due that day grouped into it,
 * so ten bottles expiring on the same day make one notification, not ten.
 */
export function planReminders(
    items: readonly ExpiringItem[],
    settings: ReminderSettings,
    copy: ReminderCopy,
    options: { now?: number; inspectionAvailable?: boolean } = {},
): PlannedReminder[] {
    const now = options.now ?? Date.now();
    const planned: PlannedReminder[] = [];

    if (settings.expiry) {
        const groups = new Map<string, { at: number; days: number; names: string[] }>();
        for (const item of items) {
            if (!item.expiryDate) continue;
            const expiry = kstMorning(item.expiryDate.slice(0, 10));
            if (expiry === null) continue;
            for (const days of settings.leadDays) {
                const at = expiry - days * DAY_MS;
                if (at <= now) continue;
                const key = `${at}:${days}`;
                const group = groups.get(key) ?? { at, days, names: [] };
                group.names.push(item.name.trim() || '-');
                groups.set(key, group);
            }
        }
        [...groups.values()]
            .sort((left, right) => left.at - right.at || left.days - right.days)
            .slice(0, MAX_EXPIRY_REMINDERS)
            .forEach((group) => {
                const shown = [...group.names].sort().slice(0, 3);
                planned.push({
                    key: `expiry:${group.at}:${group.days}`,
                    title: copy.expiryTitle(group.days),
                    body: copy.expiryBody(shown, group.names.length - shown.length),
                    at: group.at,
                });
            });
    }

    if (settings.dailyInspection && options.inspectionAvailable) {
        planned.push({
            key: 'inspection:daily',
            title: copy.inspectionTitle,
            body: copy.inspectionBody,
            at: null,
            dailyAtKstHour: REMIND_HOUR_KST,
        });
    }
    return planned;
}

/** Device-local hour and minute for a Korean hour, for a repeating schedule. */
export function localTimeForKstHour(kstHour: number, now: Date = new Date()): { hour: number; minute: number } {
    const offsetMinutes = -now.getTimezoneOffset();
    const minutes = (((kstHour * 60 - 9 * 60 + offsetMinutes) % 1440) + 1440) % 1440;
    return { hour: Math.floor(minutes / 60), minute: minutes % 60 };
}
