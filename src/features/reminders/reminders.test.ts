import { describe, expect, it } from 'vitest';
import { remindersCopy } from './copy';
import { NOTIFICATION_BUDGET, notificationId, toolNotificationBudget } from './deviceNotifications';
import { DEFAULT_REMINDER_SETTINGS, MAX_EXPIRY_REMINDERS, kstMorning, localTimeForKstHour, normalizeReminderSettings, planReminders } from './reminderPlan';

const copy = remindersCopy('ko').reminder;
// 2026-11-13 12:00 KST
const NOW = Date.UTC(2026, 10, 13, 3);

describe('reminder planning', () => {
    it('reminds at 09:00 Korea time on the lead days, skipping times already past', () => {
        const planned = planReminders(
            [{ id: 'a', name: 'Acetone', expiryDate: '2026-11-20' }],
            { ...DEFAULT_REMINDER_SETTINGS, expiry: true },
            copy,
            { now: NOW },
        );
        // 30 days before is already past; 7 days before (11-13 09:00) is past too; only the expiry day remains.
        expect(planned.map((reminder) => [reminder.title, new Date(reminder.at!).toISOString()])).toEqual([
            ['오늘 유효기한이 끝나는 시약이 있습니다', '2026-11-20T00:00:00.000Z'],
        ]);
        expect(kstMorning('2026-12-01')).toBe(Date.UTC(2026, 11, 1, 0));
        expect(kstMorning('bad')).toBeNull();
    });

    it('groups bottles due the same morning into one reminder', () => {
        const items = ['C', 'A', 'B', 'D'].map((name, index) => ({ id: String(index), name, expiryDate: '2027-01-10' }));
        const planned = planReminders(items, { expiry: true, leadDays: [7], dailyInspection: false }, copy, { now: NOW });
        expect(planned).toHaveLength(1);
        expect(planned[0]).toMatchObject({ title: '유효기한 7일 전인 시약이 있습니다', body: 'A, B, C 외 1개' });
    });

    it('keeps only the soonest reminders and ignores items without a date', () => {
        const items = Array.from({ length: 50 }, (_, index) => ({
            id: String(index),
            name: `R${index}`,
            expiryDate: new Date(Date.UTC(2027, 0, 1 + index)).toISOString().slice(0, 10),
        }));
        items.push({ id: 'x', name: 'Undated', expiryDate: null as unknown as string });
        const planned = planReminders(items, { expiry: true, leadDays: [0], dailyInspection: false }, copy, { now: NOW });
        expect(planned).toHaveLength(MAX_EXPIRY_REMINDERS);
        expect(planned[0].body).toBe('R0');
    });

    it('adds the daily inspection reminder only in a lab with the feature available', () => {
        const settings = { expiry: false, leadDays: [0], dailyInspection: true };
        expect(planReminders([], settings, copy, { now: NOW, inspectionAvailable: false })).toEqual([]);
        expect(planReminders([], settings, copy, { now: NOW, inspectionAvailable: true })).toEqual([
            expect.objectContaining({ key: 'inspection:daily', at: null, dailyAtKstHour: 9 }),
        ]);
        expect(planReminders([{ id: 'a', name: 'A', expiryDate: '2027-01-01' }], DEFAULT_REMINDER_SETTINGS, copy, { now: NOW })).toEqual([]);
    });

    it('leaves room for lab tool alerts within the 64 notifications iOS keeps pending', () => {
        const { iosPendingLimit, expiryReminders, inspectionReminders, tools } = NOTIFICATION_BUDGET;
        expect(iosPendingLimit).toBe(64);
        expect(expiryReminders + inspectionReminders + tools).toBeLessThanOrEqual(64);
        expect(toolNotificationBudget('ios')).toBe(tools);
        expect(MAX_EXPIRY_REMINDERS).toBe(expiryReminders);
        // With every reminder switched on and more bottles than fit, the plan stays within its share.
        const items = Array.from({ length: 80 }, (_, index) => ({
            id: String(index),
            name: `R${index}`,
            expiryDate: new Date(Date.UTC(2027, 0, 1 + index)).toISOString().slice(0, 10),
        }));
        const planned = planReminders(items, { expiry: true, leadDays: [7, 0], dailyInspection: true }, copy, { now: NOW, inspectionAvailable: true });
        expect(planned).toHaveLength(expiryReminders + inspectionReminders);
        expect(planned.length + toolNotificationBudget('ios')).toBeLessThanOrEqual(64);
        // Both features draw notification ids from the same hash; reminders keep theirs apart with a prefix.
        expect(notificationId('reminder:inspection:daily')).toBe(notificationId('reminder:inspection:daily'));
        expect(notificationId('reminder:inspection:daily')).not.toBe(notificationId('inspection:daily'));
    });

    it('cleans stored settings and converts the Korean hour to device time', () => {
        expect(normalizeReminderSettings({ expiry: true, leadDays: [7, 7, -1, 400, 30, 1.5] })).toEqual({ expiry: true, leadDays: [30, 7], dailyInspection: false });
        expect(normalizeReminderSettings('junk')).toEqual(DEFAULT_REMINDER_SETTINGS);
        const utc = new Date('2026-11-13T00:00:00Z');
        const offset = -utc.getTimezoneOffset();
        const expected = ((9 * 60 - 540 + offset) % 1440 + 1440) % 1440;
        expect(localTimeForKstHour(9, utc)).toEqual({ hour: Math.floor(expected / 60), minute: expected % 60 });
    });
});
