import { useEffect } from 'react';
import { inventoryService } from '../../services/inventoryService';
import { remindersCopy } from './copy';
import { planReminders } from './reminderPlan';
import { readReminderSettings, remindersSupported, replaceReminders } from './reminderScheduler';

/**
 * Reschedules this device's reminders from the latest inventory whenever the
 * signed-in user or space changes (which includes every app start). Does
 * nothing on the web or when every reminder is off.
 */
export function useReminderSync(options: {
    enabled: boolean;
    userId: string | null;
    labId: string | null;
    language: string;
    inspectionAvailable: boolean;
}): void {
    const { enabled, userId, labId, language, inspectionAvailable } = options;

    useEffect(() => {
        if (!enabled || !userId || !remindersSupported()) return;
        const settings = readReminderSettings(userId, labId ?? 'personal');
        let cancelled = false;
        const run = async () => {
            const wantsExpiry = settings.expiry;
            const items = wantsExpiry ? await inventoryService.getItems() : [];
            if (cancelled) return;
            const planned = planReminders(
                items.map((item) => ({ id: item.id, name: item.name, expiryDate: item.expiry_date })),
                settings,
                remindersCopy(language).reminder,
                { inspectionAvailable: inspectionAvailable && Boolean(labId) },
            );
            await replaceReminders(planned);
        };
        run().catch((error) => console.warn('Could not reschedule reminders:', error));
        return () => {
            cancelled = true;
        };
    }, [enabled, inspectionAvailable, labId, language, userId]);
}
