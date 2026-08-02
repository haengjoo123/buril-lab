import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, Loader2, MapPin, Save, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WasteStreamCode } from '../types';
import {
    getActiveWastePolicyV2,
    upsertLabWasteStreamOverrideV2,
    type ActiveWastePolicy,
} from '../services/wastePolicyService';
import { AppSelect } from './AppSelect';

interface WastePolicySettingsPanelProps {
    labId: string;
    onBack?: () => void;
}

interface FormState {
    containerLabel: string;
    containerColor: string;
    location: string;
    handlerContact: string;
    replacementLocation: string;
    isDisabled: boolean;
}

const EMPTY_FORM: FormState = {
    containerLabel: '',
    containerColor: '',
    location: '',
    handlerContact: '',
    replacementLocation: '',
    isDisabled: false,
};

export const WastePolicySettingsPanel: React.FC<WastePolicySettingsPanelProps> = ({ labId, onBack }) => {
    const { t, i18n } = useTranslation();
    const [policy, setPolicy] = useState<ActiveWastePolicy | null>(null);
    const [selectedCode, setSelectedCode] = useState<WasteStreamCode | ''>('');
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const selectedStream = useMemo(
        () => policy?.resolvedStreams.find(({ streamCode }) => streamCode === selectedCode),
        [policy, selectedCode],
    );

    const fillFromStream = (streamCode: WasteStreamCode, activePolicy: ActiveWastePolicy) => {
        const stream = activePolicy.resolvedStreams.find((item) => item.streamCode === streamCode);
        const override = stream?.labOverride;
        setSelectedCode(streamCode);
        setForm(override ? {
            containerLabel: override.containerLabel ?? '',
            containerColor: override.containerColor ?? '',
            location: override.location ?? '',
            handlerContact: override.handlerContact ?? '',
            replacementLocation: override.replacementLocation ?? '',
            isDisabled: override.isDisabled,
        } : EMPTY_FORM);
    };

    const loadPolicy = async (preferredCode?: WasteStreamCode) => {
        setLoading(true);
        setError(null);
        try {
            const result = await getActiveWastePolicyV2(labId);
            setPolicy(result);
            const nextCode = preferredCode && result.resolvedStreams.some(({ streamCode }) => streamCode === preferredCode)
                ? preferredCode
                : result.resolvedStreams[0]?.streamCode;
            if (nextCode) fillFromStream(nextCode, result);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : t('waste_policy_load_error'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadPolicy();
        // The lab id is immutable for the lifetime of this panel.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [labId]);

    const updateField = (field: keyof FormState, value: string) => {
        setForm((current) => ({ ...current, [field]: value }));
        setMessage(null);
    };

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!selectedCode || saving) return;
        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            await upsertLabWasteStreamOverrideV2({
                labId,
                streamCode: selectedCode,
                containerLabel: form.containerLabel,
                containerColor: form.containerColor,
                location: form.location,
                handlerContact: form.handlerContact,
                replacementLocation: form.isDisabled ? form.replacementLocation : null,
                isDisabled: form.isDisabled,
            });
            await loadPolicy(selectedCode);
            setMessage(t('waste_policy_saved'));
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : t('waste_policy_save_error'));
        } finally {
            setSaving(false);
        }
    };

    const reset = async () => {
        if (!selectedCode || saving || !window.confirm(t('waste_policy_reset_confirm'))) return;
        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            await upsertLabWasteStreamOverrideV2({ labId, streamCode: selectedCode });
            await loadPolicy(selectedCode);
            setMessage(t('waste_policy_reset_done'));
        } catch (resetError) {
            setError(resetError instanceof Error ? resetError.message : t('waste_policy_save_error'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            {onBack && (
                <button
                    type="button"
                    onClick={onBack}
                    className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    {t('lab_mgmt_btn_back')}
                </button>
            )}

            <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm leading-relaxed text-blue-950 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-100">
                {t('waste_policy_lab_scope_notice')}
            </div>

            {error && (
                <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-100">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{error}</span>
                </div>
            )}
            <div aria-live="polite" className="text-sm font-medium text-blue-700 dark:text-blue-300">{message}</div>

            {loading ? (
                <div className="flex min-h-40 items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600" aria-label={t('loading')} />
                </div>
            ) : policy?.resolvedStreams.length ? (
                <form onSubmit={save} className="space-y-4">
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                            {t('waste_policy_stream')}
                        </label>
                        <AppSelect
                            value={selectedCode}
                            onChange={(value) => fillFromStream(value as WasteStreamCode, policy)}
                            options={policy.resolvedStreams.map((stream) => ({
                                value: stream.streamCode,
                                label: i18n.language.startsWith('ko') ? stream.displayNameKo : stream.displayNameEn,
                            }))}
                            ariaLabel={t('waste_policy_stream')}
                            className="mt-1 w-full"
                            buttonClassName="!min-h-12 !rounded-xl !border-slate-300 !bg-white !px-4 dark:!border-slate-700 dark:!bg-slate-900"
                            menuClassName="w-full"
                        />
                    </div>

                    {selectedStream && (
                        <>
                            <p className="text-xs text-slate-500">
                                {t('waste_policy_inherited_from', { source: selectedStream.policyScope ?? 'system' })}
                            </p>
                            <section
                                aria-labelledby="waste-policy-inherited-title"
                                className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60"
                            >
                                <h3 id="waste-policy-inherited-title" className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                    {t('waste_policy_inherited_physical')}
                                </h3>
                                <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                                    {t('waste_policy_inherited_physical_help')}
                                </p>
                                <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                                    {([
                                        ['waste_policy_container_label', selectedStream.inheritedPhysical.containerLabel],
                                        ['waste_policy_container_color', selectedStream.inheritedPhysical.containerColor],
                                        ['waste_policy_location', selectedStream.inheritedPhysical.location],
                                        ['waste_policy_handler_contact', selectedStream.inheritedPhysical.handlerContact],
                                    ] as const).map(([labelKey, value]) => (
                                        <div key={labelKey} className="rounded-lg bg-white px-3 py-2 dark:bg-slate-900">
                                            <dt className="text-slate-500 dark:text-slate-400">{t(labelKey)}</dt>
                                            <dd className="mt-0.5 font-medium text-slate-800 dark:text-slate-100">
                                                {value || t('waste_policy_not_configured')}
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                            </section>
                        </>
                    )}

                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                        {t('waste_policy_container_label_optional')}
                        <input
                            value={form.containerLabel}
                            onChange={(event) => updateField('containerLabel', event.target.value)}
                            placeholder={selectedStream?.inheritedPhysical.containerLabel || undefined}
                            className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900"
                        />
                    </label>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                        {t('waste_policy_container_color')}
                        <input
                            value={form.containerColor}
                            onChange={(event) => updateField('containerColor', event.target.value)}
                            placeholder={selectedStream?.inheritedPhysical.containerColor || t('waste_policy_color_placeholder')}
                            className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900"
                        />
                    </label>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                        <span className="flex items-center gap-1"><MapPin className="h-4 w-4" aria-hidden="true" />{t('waste_policy_location')}</span>
                        <input
                            value={form.location}
                            onChange={(event) => updateField('location', event.target.value)}
                            placeholder={selectedStream?.inheritedPhysical.location || t('waste_policy_location_placeholder')}
                            className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900"
                        />
                    </label>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                        {t('waste_policy_handler_contact')}
                        <input
                            value={form.handlerContact}
                            onChange={(event) => updateField('handlerContact', event.target.value)}
                            placeholder={selectedStream?.inheritedPhysical.handlerContact || undefined}
                            className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900"
                        />
                    </label>
                    <fieldset className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                        <legend className="px-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                            {t('waste_policy_availability')}
                        </legend>
                        <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                            <input
                                type="checkbox"
                                checked={form.isDisabled}
                                onChange={(event) => {
                                    setForm((current) => ({
                                        ...current,
                                        isDisabled: event.target.checked,
                                        replacementLocation: event.target.checked
                                            ? current.replacementLocation
                                            : '',
                                    }));
                                    setMessage(null);
                                }}
                                className="h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            {t('waste_policy_container_disabled')}
                        </label>
                        <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                            {t('waste_policy_container_disabled_help')}
                        </p>
                        {form.isDisabled && (
                            <label className="mt-3 block text-sm font-medium text-slate-700 dark:text-slate-200">
                                {t('waste_policy_replacement_location')}
                                <input
                                    value={form.replacementLocation}
                                    onChange={(event) => updateField('replacementLocation', event.target.value)}
                                    placeholder={t('waste_policy_replacement_location_placeholder')}
                                    className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900"
                                />
                                <span className="mt-1 block text-xs font-normal leading-relaxed text-slate-500 dark:text-slate-400">
                                    {form.replacementLocation.trim()
                                        ? t('waste_policy_replacement_active_help')
                                        : t('waste_policy_disabled_no_replacement_help')}
                                </span>
                            </label>
                        )}
                    </fieldset>
                    <p className="text-xs leading-relaxed text-slate-500">{t('waste_policy_no_safety_override')}</p>

                    <div className="grid grid-cols-2 gap-2 pt-2">
                        <button
                            type="button"
                            onClick={reset}
                            disabled={saving}
                            className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
                        >
                            <Undo2 className="h-4 w-4" aria-hidden="true" />{t('waste_policy_reset')}
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 font-semibold text-white disabled:opacity-50"
                        >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                            {t('lab_mgmt_btn_save')}
                        </button>
                    </div>
                </form>
            ) : (
                <p className="rounded-xl bg-orange-50 p-3 text-sm text-orange-900 dark:bg-orange-950/40 dark:text-orange-100">
                    {t('waste_policy_no_streams')}
                </p>
            )}
        </div>
    );
};
