import React, { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { remindersCopy } from './copy';
import { planReminders, type ReminderSettings } from './reminderPlan';
import {
    hasReminderPermission,
    readReminderSettings,
    remindersSupported,
    replaceReminders,
    requestReminderPermission,
    writeReminderSettings,
} from './reminderScheduler';

interface ReminderSettingsPanelProps {
    userId: string;
    labId: string | null;
    language: string;
    inspectionAvailable: boolean;
}

/** Per-device reminder switches shown in the settings dialog. */
export const ReminderSettingsPanel: React.FC<ReminderSettingsPanelProps> = ({ userId, labId, language, inspectionAvailable }) => {
    const copy = remindersCopy(language);
    const space = labId ?? 'personal';
    const supported = remindersSupported();
    const [settings, setSettings] = useState<ReminderSettings>(() => readReminderSettings(userId, space));
    const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
    const [scheduled, setScheduled] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!supported) return;
        let cancelled = false;
        hasReminderPermission()
            .then((granted) => {
                if (!cancelled) setPermission(granted ? 'granted' : 'unknown');
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [supported]);

    const apply = async (next: ReminderSettings) => {
        setSettings(next);
        writeReminderSettings(userId, space, next);
        if (!supported) return;
        setBusy(true);
        try {
            let granted = permission === 'granted';
            if (!granted && (next.expiry || next.dailyInspection)) {
                granted = await requestReminderPermission();
                setPermission(granted ? 'granted' : 'denied');
            }
            if (!granted) return;
            // Loaded on demand so the settings dialog stays light.
            const items = next.expiry ? await (await import('../../services/inventoryService')).inventoryService.getItems() : [];
            const planned = planReminders(
                items.map((item) => ({ id: item.id, name: item.name, expiryDate: item.expiry_date })),
                next,
                copy.reminder,
                { inspectionAvailable: inspectionAvailable && Boolean(labId) },
            );
            setScheduled(await replaceReminders(planned));
        } catch (error) {
            console.warn('Could not update reminders:', error);
        } finally {
            setBusy(false);
        }
    };

    const toggle = (label: string, help: string, checked: boolean, onChange: (value: boolean) => void) => (
        <label className="flex items-start justify-between gap-3 py-2">
            <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{label}</span>
                <span className="block break-keep text-xs text-slate-500 dark:text-slate-400">{help}</span>
            </span>
            <input
                type="checkbox"
                role="switch"
                checked={checked}
                disabled={!supported || busy}
                onChange={(event) => onChange(event.target.checked)}
                className="mt-1 h-5 w-5 shrink-0 accent-blue-600 disabled:opacity-50"
            />
        </label>
    );

    return (
        <section className="rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
            <h4 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-white">
                <Bell className="h-4 w-4" aria-hidden="true" />
                {copy.title}
            </h4>
            {!supported && <p className="mt-1 break-keep text-xs text-slate-500 dark:text-slate-400">{copy.webOnly}</p>}
            {toggle(copy.expiry, copy.expiryHelp, settings.expiry, (value) => void apply({ ...settings, expiry: value }))}
            {inspectionAvailable && labId && toggle(copy.inspection, copy.inspectionHelp, settings.dailyInspection, (value) => void apply({ ...settings, dailyInspection: value }))}
            {supported && permission === 'denied' && (
                <p className="mt-1 break-keep text-xs text-red-600 dark:text-red-400" role="alert">{copy.denied}</p>
            )}
            {supported && scheduled !== null && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400" role="status">{copy.scheduled(scheduled)}</p>}
            {supported && <p className="mt-1 break-keep text-xs text-slate-400 dark:text-slate-500">{copy.note}</p>}
        </section>
    );
};
