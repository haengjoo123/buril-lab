import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, Check, ChevronDown, Loader2, MapPin, Save, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WasteStreamCode } from '../types';
import {
    getActiveWastePolicyV2,
    upsertLabWasteStreamOverrideV2,
    type ActiveWastePolicy,
} from '../services/wastePolicyService';
import {
    getWastePolicySourceLabelKey,
    getWasteStreamEffectiveLocation,
    getWasteStreamOverrideState,
    WASTE_STREAM_STATE_LABEL_KEYS,
    type WasteStreamOverrideState,
} from './wastePolicyStreamState';

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

/** How long the save/reset buttons show their confirmation state. */
const DONE_FEEDBACK_MS = 1500;

const STATE_CHIP_CLASSES: Record<WasteStreamOverrideState, string> = {
    default: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    modified: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
    disabled: 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
};

export const WastePolicySettingsPanel: React.FC<WastePolicySettingsPanelProps> = ({ labId, onBack }) => {
    const { t, i18n } = useTranslation();
    const [policy, setPolicy] = useState<ActiveWastePolicy | null>(null);
    const [selectedCode, setSelectedCode] = useState<WasteStreamCode | ''>('');
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [justDone, setJustDone] = useState<'save' | 'reset' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const selectedStream = useMemo(
        () => policy?.resolvedStreams.find(({ streamCode }) => streamCode === selectedCode),
        [policy, selectedCode],
    );

    useEffect(() => {
        if (!justDone) return;
        const timer = window.setTimeout(() => setJustDone(null), DONE_FEEDBACK_MS);
        return () => window.clearTimeout(timer);
    }, [justDone]);

    const fillFromStream = (streamCode: WasteStreamCode | '', activePolicy: ActiveWastePolicy) => {
        const stream = activePolicy.resolvedStreams.find((item) => item.streamCode === streamCode);
        const override = stream?.labOverride;
        setSelectedCode(stream ? streamCode : '');
        setForm(override ? {
            containerLabel: override.containerLabel ?? '',
            containerColor: override.containerColor ?? '',
            location: override.location ?? '',
            handlerContact: override.handlerContact ?? '',
            replacementLocation: override.replacementLocation ?? '',
            isDisabled: override.isDisabled,
        } : EMPTY_FORM);
    };

    const toggleStream = (streamCode: WasteStreamCode) => {
        if (!policy) return;
        setJustDone(null);
        setMessage(null);
        setError(null);
        fillFromStream(streamCode === selectedCode ? '' : streamCode, policy);
    };

    // The form stays mounted while refetching after a save, so only the first
    // load shows a spinner and the scroll position is kept.
    const loadPolicy = async (preferredCode?: WasteStreamCode) => {
        setLoading(true);
        setError(null);
        try {
            const result = await getActiveWastePolicyV2(labId);
            setPolicy(result);
            const nextCode = preferredCode && result.resolvedStreams.some(({ streamCode }) => streamCode === preferredCode)
                ? preferredCode
                : result.resolvedStreams.length === 1
                    ? result.resolvedStreams[0].streamCode
                    : '';
            fillFromStream(nextCode, result);
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
        setJustDone(null);
    };

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!selectedCode || saving) return;
        setSaving(true);
        setError(null);
        setMessage(null);
        setJustDone(null);
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
            setJustDone('save');
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
        setJustDone(null);
        try {
            await upsertLabWasteStreamOverrideV2({ labId, streamCode: selectedCode });
            await loadPolicy(selectedCode);
            setMessage(t('waste_policy_reset_done'));
            setJustDone('reset');
        } catch (resetError) {
            setError(resetError instanceof Error ? resetError.message : t('waste_policy_save_error'));
        } finally {
            setSaving(false);
        }
    };

    const errorAlert = error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-100">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
        </div>
    );

    const selectedState = selectedStream ? getWasteStreamOverrideState(selectedStream) : 'default';
    const sourceLabelKey = getWastePolicySourceLabelKey(selectedStream?.policyScope);

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

            {!selectedStream && errorAlert}
            <div aria-live="polite" className="sr-only">{message}</div>

            {loading && !policy ? (
                <div className="flex min-h-40 items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-600" aria-label={t('loading')} />
                </div>
            ) : policy?.resolvedStreams.length ? (
                <ul
                    aria-label={t('waste_policy_stream')}
                    className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900"
                >
                    {policy.resolvedStreams.map((stream) => {
                        const isOpen = stream.streamCode === selectedCode;
                        const state = getWasteStreamOverrideState(stream);
                        const location = getWasteStreamEffectiveLocation(stream);
                        const panelId = `waste-policy-stream-${stream.streamCode}`;
                        return (
                            <li key={stream.streamCode}>
                                <button
                                    type="button"
                                    onClick={() => toggleStream(stream.streamCode)}
                                    aria-expanded={isOpen}
                                    aria-controls={panelId}
                                    className={`flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                                        isOpen ? 'bg-slate-50 dark:bg-slate-800/70' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                    }`}
                                >
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-semibold text-slate-900 dark:text-white">
                                            {i18n.language.startsWith('ko') ? stream.displayNameKo : stream.displayNameEn}
                                        </span>
                                        {location && (
                                            <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                                <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                                                <span className="truncate">{location}</span>
                                            </span>
                                        )}
                                    </span>
                                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATE_CHIP_CLASSES[state]}`}>
                                        {t(WASTE_STREAM_STATE_LABEL_KEYS[state])}
                                    </span>
                                    <ChevronDown
                                        className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                                        aria-hidden="true"
                                    />
                                </button>

                                {isOpen && (
                                    <form
                                        id={panelId}
                                        onSubmit={save}
                                        className="space-y-4 border-t border-slate-100 px-4 pb-4 pt-3 dark:border-slate-800"
                                    >
                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                            {t('waste_policy_inherited_from', {
                                                source: sourceLabelKey ? t(sourceLabelKey) : stream.policyScope,
                                            })}
                                        </p>

                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                                            {t('waste_policy_container_label_optional')}
                                            <input
                                                value={form.containerLabel}
                                                onChange={(event) => updateField('containerLabel', event.target.value)}
                                                placeholder={stream.inheritedPhysical.containerLabel || undefined}
                                                className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900"
                                            />
                                        </label>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                                            {t('waste_policy_container_color')}
                                            <input
                                                value={form.containerColor}
                                                onChange={(event) => updateField('containerColor', event.target.value)}
                                                placeholder={stream.inheritedPhysical.containerColor || t('waste_policy_color_placeholder')}
                                                className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900"
                                            />
                                        </label>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                                            <span className="flex items-center gap-1"><MapPin className="h-4 w-4" aria-hidden="true" />{t('waste_policy_location')}</span>
                                            <input
                                                value={form.location}
                                                onChange={(event) => updateField('location', event.target.value)}
                                                placeholder={stream.inheritedPhysical.location || t('waste_policy_location_placeholder')}
                                                className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900"
                                            />
                                        </label>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                                            {t('waste_policy_handler_contact')}
                                            <input
                                                value={form.handlerContact}
                                                onChange={(event) => updateField('handlerContact', event.target.value)}
                                                placeholder={stream.inheritedPhysical.handlerContact || undefined}
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
                                                        setJustDone(null);
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

                                        {errorAlert}

                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                type="button"
                                                onClick={reset}
                                                disabled={saving || (selectedState === 'default' && justDone !== 'reset')}
                                                className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 px-2 text-sm font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
                                            >
                                                {justDone === 'reset'
                                                    ? <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                                                    : <Undo2 className="h-4 w-4" aria-hidden="true" />}
                                                <span className="truncate">
                                                    {justDone === 'reset' ? t('waste_policy_reset_short') : t('waste_policy_reset')}
                                                </span>
                                            </button>
                                            <button
                                                type="submit"
                                                disabled={saving}
                                                className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-2 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
                                                    justDone === 'save' ? 'bg-emerald-600' : 'bg-blue-600 hover:bg-blue-700'
                                                }`}
                                            >
                                                {saving
                                                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                                    : justDone === 'save'
                                                        ? <Check className="h-4 w-4" aria-hidden="true" />
                                                        : <Save className="h-4 w-4" aria-hidden="true" />}
                                                {justDone === 'save' ? t('waste_policy_saved_short') : t('lab_mgmt_btn_save')}
                                            </button>
                                        </div>
                                    </form>
                                )}
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <p className="rounded-xl bg-orange-50 p-3 text-sm text-orange-900 dark:bg-orange-950/40 dark:text-orange-100">
                    {t('waste_policy_no_streams')}
                </p>
            )}
        </div>
    );
};
