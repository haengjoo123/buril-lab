import { Capacitor } from '@capacitor/core';
import { notificationId } from '../tools/notifications';
import { localTimeForKstHour, normalizeReminderSettings, type PlannedReminder, type ReminderSettings } from './reminderPlan';

const STORAGE_PREFIX = 'buril-reminders:v1:';

/** Reminders are only delivered by the native app; the web build keeps the in-app badges. */
export function remindersSupported(): boolean {
    return Capacitor.isNativePlatform();
}

const storageKey = (userId: string, space: string) => `${STORAGE_PREFIX}${userId}:${space}`;

export function readReminderSettings(userId: string, space: string): ReminderSettings {
    try {
        const raw = localStorage.getItem(storageKey(userId, space));
        return normalizeReminderSettings(raw ? JSON.parse(raw) : null);
    } catch {
        return normalizeReminderSettings(null);
    }
}

export function writeReminderSettings(userId: string, space: string, settings: ReminderSettings): void {
    try {
        localStorage.setItem(storageKey(userId, space), JSON.stringify(settings));
    } catch {
        // A blocked storage only means the choice is not remembered on this device.
    }
}

export async function requestReminderPermission(): Promise<boolean> {
    if (!remindersSupported()) return false;
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const result = await LocalNotifications.requestPermissions();
    return result.display === 'granted';
}

export async function hasReminderPermission(): Promise<boolean> {
    if (!remindersSupported()) return false;
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    return (await LocalNotifications.checkPermissions()).display === 'granted';
}

/**
 * Replaces this app's reminders with the planned ones. Lab tool timers are
 * marked differently and are left alone.
 */
export async function replaceReminders(planned: readonly PlannedReminder[]): Promise<number> {
    if (!remindersSupported()) return 0;
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    if ((await LocalNotifications.checkPermissions()).display !== 'granted') return 0;
    const pending = await LocalNotifications.getPending();
    const ours = pending.notifications.filter((notification) => notification.extra?.burilReminder === true);
    if (ours.length) await LocalNotifications.cancel({ notifications: ours.map((notification) => ({ id: notification.id })) });
    if (planned.length === 0) return 0;
    await LocalNotifications.schedule({
        notifications: planned.map((reminder) => ({
            id: notificationId(`reminder:${reminder.key}`),
            title: reminder.title,
            body: reminder.body,
            schedule: reminder.at !== null
                ? { at: new Date(reminder.at), allowWhileIdle: true }
                : { on: localTimeForKstHour(reminder.dailyAtKstHour ?? 9), repeats: true, allowWhileIdle: true },
            extra: { burilReminder: true },
        })),
    });
    return planned.length;
}
