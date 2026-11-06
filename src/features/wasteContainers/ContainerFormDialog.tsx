import React, { useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { WasteStreamCode } from '../../types';
import {
    createWasteContainer,
    toWasteContainerError,
    updateWasteContainer,
    type WasteContainer,
} from '../../services/wasteContainerService';
import { WASTE_STREAM_LABELS, wasteStreamLabel } from '../../utils/wasteLabels';
import { containerCopy, containerErrorMessage } from './copy';
import { ContainerDialog, dialogInput, dialogPrimaryButton, dialogSecondaryButton } from './ContainerDialog';

export type ContainerFormState =
    /** A create started from a deposit can fix the stream and suggest a name. */
    | { mode: 'create'; streamCode?: WasteStreamCode; label?: string; lockStream?: boolean }
    | { mode: 'edit'; container: WasteContainer };

const STREAM_OPTIONS = Object.keys(WASTE_STREAM_LABELS) as WasteStreamCode[];

interface ContainerFormDialogProps {
    state: ContainerFormState;
    language: string;
    onClose: () => void;
    onSaved: (container: WasteContainer) => void;
}

/** Create or edit a container. Shared by the containers panel and the deposit picker. */
export const ContainerFormDialog: React.FC<ContainerFormDialogProps> = ({ state, language, onClose, onSaved }) => {
    const copy = containerCopy(language);
    const editing = state.mode === 'edit' ? state.container : null;
    const creating = state.mode === 'create' ? state : null;
    const streamLocked = Boolean(editing) || Boolean(creating?.lockStream);
    const [streamCode, setStreamCode] = useState<WasteStreamCode>(
        editing?.streamCode ?? creating?.streamCode ?? 'ORGANIC_NON_HALOGENATED',
    );
    const [label, setLabel] = useState(editing?.label ?? creating?.label ?? '');
    const [location, setLocation] = useState(editing?.location ?? '');
    const [capacityL, setCapacityL] = useState(editing?.capacityMl ? String(editing.capacityMl / 1000) : '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const capacityValue = capacityL.trim() ? Number(capacityL.replace(',', '.')) : null;
    const capacityInvalid = capacityValue !== null && (!Number.isFinite(capacityValue) || capacityValue <= 0 || capacityValue > 1000);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (saving || capacityInvalid || !label.trim()) return;
        setSaving(true);
        setError(null);
        const input = {
            label,
            location,
            capacityMl: capacityValue === null ? null : Math.round(capacityValue * 1_000_000) / 1000,
        };
        try {
            const saved = editing
                ? await updateWasteContainer(editing.id, input)
                : await createWasteContainer(streamCode, input);
            onSaved(saved);
        } catch (saveError) {
            setError(containerErrorMessage(toWasteContainerError(saveError).code, language));
        } finally {
            setSaving(false);
        }
    };

    const fieldLabel = 'flex flex-col gap-1.5 text-sm text-slate-700 dark:text-slate-300';

    return (
        <ContainerDialog
            as="form"
            onSubmit={submit}
            titleId="waste-container-form-title"
            title={editing ? copy.editTitle : copy.addTitle}
            subtitle={editing ? undefined : copy.addDesc}
            closeLabel={copy.close}
            onClose={onClose}
            footer={(
                <>
                    <button type="button" onClick={onClose} className={dialogSecondaryButton}>{copy.cancel}</button>
                    <button type="submit" disabled={saving || !label.trim() || capacityInvalid} className={dialogPrimaryButton}>
                        {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                        {copy.save}
                    </button>
                </>
            )}
        >
            <div className="space-y-3">
                <label className={fieldLabel}>
                    <span>{copy.formStream}</span>
                    <select
                        value={streamCode}
                        onChange={(event) => setStreamCode(event.target.value as WasteStreamCode)}
                        disabled={streamLocked}
                        className={dialogInput}
                    >
                        {STREAM_OPTIONS.map((code) => (
                            <option key={code} value={code}>{wasteStreamLabel(code, language)}</option>
                        ))}
                    </select>
                    {editing && <span className="break-keep text-xs text-slate-500 dark:text-slate-400">{copy.formStreamLocked}</span>}
                </label>
                <label className={fieldLabel}>
                    <span>{copy.formLabel}</span>
                    <input
                        data-autofocus
                        value={label}
                        onChange={(event) => setLabel(event.target.value)}
                        maxLength={80}
                        required
                        placeholder={copy.formLabelPlaceholder}
                        className={dialogInput}
                    />
                </label>
                <label className={fieldLabel}>
                    <span>{copy.formLocation}</span>
                    <input
                        value={location}
                        onChange={(event) => setLocation(event.target.value)}
                        maxLength={200}
                        placeholder={copy.formLocationPlaceholder}
                        className={dialogInput}
                    />
                </label>
                <label className={fieldLabel}>
                    <span>{copy.formCapacity}</span>
                    <input
                        value={capacityL}
                        onChange={(event) => setCapacityL(event.target.value)}
                        inputMode="decimal"
                        placeholder="20"
                        aria-invalid={capacityInvalid}
                        className={`${dialogInput} ${capacityInvalid ? 'border-red-400 focus:ring-red-400/50' : ''}`}
                    />
                    {capacityInvalid && <span className="break-keep text-xs text-red-600 dark:text-red-400">{copy.formCapacityInvalid}</span>}
                </label>
                {error && (
                    <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900/30 dark:bg-red-900/20 dark:text-red-400">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="break-keep">{error}</span>
                    </div>
                )}
            </div>
        </ContainerDialog>
    );
};
