/**
 * What expiry reminders and lab tool alerts share on a device: one local
 * notification plugin, one id space and one allowance of pending
 * notifications.
 *
 * iOS keeps at most 64 pending local notifications per app and silently drops
 * the rest, so the shares below must not add up to more than that. Change one
 * share only together with the others (reminders.test.ts checks the sum).
 */
export const NOTIFICATION_BUDGET = {
    iosPendingLimit: 64,
    /** One-off expiry reminders; the soonest win. */
    expiryReminders: 30,
    /** The daily inspection reminder repeats, so it takes one slot. */
    inspectionReminders: 1,
    /** Timers, alarms, calendar reminders and culture timers. */
    tools: 33,
    /** Android has no such limit, so tools keep the 60 they always had there. */
    toolsAndroid: 60,
} as const;

/** Pending tool notifications allowed on a platform (`Capacitor.getPlatform()`). */
export function toolNotificationBudget(platform: string): number {
    return platform === 'android' ? NOTIFICATION_BUDGET.toolsAndroid : NOTIFICATION_BUDGET.tools;
}

/** A stable 31-bit notification id for a key, as the plugin needs an integer. */
export function notificationId(key: string): number {
    let hash = 0;
    for (const character of key) hash = (Math.imul(31, hash) + character.charCodeAt(0)) | 0;
    return ((hash >>> 0) % 2000000000) + 1;
}
