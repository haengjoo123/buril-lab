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

    // Same switch as the dark mode row above it in the settings.
    const toggle = (label: string, help: string, checked: boolean, onChange: (value: boolean) => void) => (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            disabled={!supported || busy}
            onClick={() => onChange(!checked)}
            className="flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
        >
            <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{label}</span>
                <span className="mt-0.5 block break-keep text-xs text-slate-500 dark:text-slate-400">{help}</span>
            </span>
            <span className={`flex h-5 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors ${checked ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'}`} aria-hidden="true">
                <span className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
            </span>
        </button>
    );

    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/60 sm:p-4">
            <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm dark:bg-slate-900 dark:text-slate-300">
                    <Bell className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{copy.title}</h4>
                    {!supported && <p className="mt-0.5 break-keep text-xs text-slate-500 dark:text-slate-400">{copy.webOnly}</p>}
                    <div className="mt-1 divide-y divide-slate-200/70 dark:divide-slate-700/70">
                        {toggle(copy.expiry, copy.expiryHelp, settings.expiry, (value) => void apply({ ...settings, expiry: value }))}
                        {inspectionAvailable && labId && toggle(copy.inspection, copy.inspectionHelp, settings.dailyInspection, (value) => void apply({ ...settings, dailyInspection: value }))}
                    </div>
                    {supported && permission === 'denied' && (
                        <p className="mt-1 break-keep text-xs text-red-600 dark:text-red-400" role="alert">{copy.denied}</p>
                    )}
                    {supported && scheduled !== null && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400" role="status">{copy.scheduled(scheduled)}</p>}
                    {supported && <p className="mt-1 break-keep text-xs text-slate-400 dark:text-slate-500">{copy.note}</p>}
                </div>
            </div>
        </section>
    );
};
