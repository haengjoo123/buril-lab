import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronRight, Loader2, MapPin, Plus } from 'lucide-react';
import type { WasteStreamCode } from '../../types';
import {
    createWasteContainer,
    fetchWasteContainerTotals,
    fetchWasteContainers,
    toWasteContainerError,
    updateWasteContainer,
    type WasteContainer,
    type WasteContainerTotals,
} from '../../services/wasteContainerService';
import { WASTE_STREAM_LABELS, wasteStreamDotClass, wasteStreamLabel } from '../../utils/wasteLabels';
import { sortContainers } from './containerSummary';
import { formatLabelDate } from './containerLabel';
import { containerCopy, containerErrorMessage } from './copy';
import { ContainerFillBar } from './ContainerFillBar';
import { ContainerStatusChip } from './ContainerStatusChip';
import { ContainerDialog, dialogInput, dialogPrimaryButton, dialogSecondaryButton } from './ContainerDialog';
import { WasteContainerDetail } from './WasteContainerDetail';

interface WasteContainersPanelProps {
    labId: string | null;
    labName: string | null;
    /** Lab admin, or the personal space owner. */
    canCollect: boolean;
    language: string;
}

type FormState =
    | { mode: 'create' }
    | { mode: 'edit'; container: WasteContainer };

const STREAM_OPTIONS = Object.keys(WASTE_STREAM_LABELS) as WasteStreamCode[];
const EMPTY_TOTALS: WasteContainerTotals = { depositCount: 0, totalMl: 0, hasUnknownAmounts: false };

export const WasteContainersPanel: React.FC<WasteContainersPanelProps> = ({ labId, labName, canCollect, language }) => {
    const copy = containerCopy(language);
    const [containers, setContainers] = useState<WasteContainer[] | null>(null);
    const [totals, setTotals] = useState<Record<string, WasteContainerTotals>>({});
    const [includeCollected, setIncludeCollected] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const [form, setForm] = useState<FormState | null>(null);
    const [detailId, setDetailId] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchWasteContainers({ includeCollected })
            .then(async (rows) => {
                const nextTotals = await fetchWasteContainerTotals(rows.map((row) => row.id));
                if (cancelled) return;
                setContainers(sortContainers(rows));
                setTotals(nextTotals);
                setError(null);
            })
            .catch((loadError) => {
                console.error('Failed to load waste containers:', loadError);
                if (!cancelled) setError(copy.loadFailed);
            });
        return () => {
            cancelled = true;
        };
    }, [includeCollected, reloadToken, copy.loadFailed]);

    const reload = useCallback(() => setReloadToken((value) => value + 1), []);
    const closeForm = () => setForm(null);
    const closeDetail = () => setDetailId(null);
    const detail = useMemo(
        () => containers?.find((container) => container.id === detailId) ?? null,
        [containers, detailId],
    );

    const handleChanged = useCallback((updated: WasteContainer) => {
        setContainers((current) => {
            if (!current) return current;
            const exists = current.some((container) => container.id === updated.id);
            return sortContainers(exists
                ? current.map((container) => (container.id === updated.id ? updated : container))
                : [updated, ...current]);
        });
        reload();
    }, [reload]);

    return (
        <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm text-slate-700 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-slate-200">
                <div className="font-medium">{copy.infoTitle}</div>
                <div className="mt-1 break-keep text-slate-600 dark:text-slate-300">{copy.infoBody}</div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex min-h-10 items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <input
                        type="checkbox"
                        checked={includeCollected}
                        onChange={(event) => setIncludeCollected(event.target.checked)}
                        className="h-4 w-4 rounded border-slate-300"
                    />
                    <span className="whitespace-nowrap">{copy.showCollected}</span>
                </label>
                <button
                    type="button"
                    onClick={() => setForm({ mode: 'create' })}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                >
                    <Plus className="h-4 w-4" aria-hidden="true" />{copy.add}
                </button>
            </div>

            {error && (
                <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900/30 dark:bg-red-900/20 dark:text-red-400">
                    <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />{error}
                </div>
            )}

            {!containers && !error && (
                <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-blue-500" aria-hidden="true" /></div>
            )}

            {containers && containers.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center dark:border-slate-700">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{copy.listEmpty}</p>
                    <p className="mx-auto mt-1 max-w-sm break-keep text-sm text-slate-500 dark:text-slate-400">{copy.listEmptyHint}</p>
                </div>
            )}

            {containers && containers.length > 0 && (
                <ul className="grid gap-3 md:grid-cols-2">
                    {containers.map((container) => {
                        const total = totals[container.id] ?? EMPTY_TOTALS;
                        return (
                            <li key={container.id}>
                                <button
                                    type="button"
                                    onClick={() => setDetailId(container.id)}
                                    className={`flex h-full w-full items-start gap-3 overflow-hidden rounded-xl border bg-white p-4 text-left shadow-sm transition-colors hover:bg-gray-50 dark:bg-slate-800 dark:hover:bg-slate-750 ${container.status === 'collected'
                                        ? 'border-slate-300 opacity-80 dark:border-slate-600'
                                        : 'border-gray-100 dark:border-slate-700'}`}
                                >
                                    <span className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${wasteStreamDotClass(container.streamCode)}`} aria-hidden="true" />
                                    <span className="flex min-w-0 flex-1 flex-col gap-2">
                                        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                            <span className="min-w-0 break-words text-sm font-semibold leading-5 text-slate-800 dark:text-slate-200">
                                                {container.label}
                                            </span>
                                            <ContainerStatusChip status={container.status} language={language} />
                                        </span>
                                        <span className="text-xs text-slate-500 dark:text-slate-400">
                                            {wasteStreamLabel(container.streamCode, language)}
                                        </span>
                                        <ContainerFillBar
                                            totalMl={total.totalMl}
                                            capacityMl={container.capacityMl}
                                            hasUnknownAmounts={total.hasUnknownAmounts}
                                            language={language}
                                            compact
                                        />
                                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                                            <span className="whitespace-nowrap">{copy.deposits(total.depositCount)}</span>
                                            <span className="whitespace-nowrap">• {copy.started} {formatLabelDate(container.startedAt)}</span>
                                            {container.location && (
                                                <span className="inline-flex min-w-0 items-center gap-1">
                                                    • <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                                                    <span className="min-w-0 truncate">{container.location}</span>
                                                </span>
                                            )}
                                        </span>
                                    </span>
                                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}

            {form && (
                <ContainerFormDialog
                    state={form}
                    language={language}
                    onClose={closeForm}
                    onSaved={(saved) => {
                        setForm(null);
                        handleChanged(saved);
                        setDetailId(saved.id);
                    }}
                />
            )}

            {detail && !form && (
                <WasteContainerDetail
                    key={`${detail.id}:${detail.updatedAt}`}
                    container={detail}
                    labId={labId}
                    labName={labName}
                    canCollect={canCollect}
                    language={language}
                    onClose={closeDetail}
                    onEdit={(container) => setForm({ mode: 'edit', container })}
                    onChanged={handleChanged}
                />
            )}
        </div>
    );
};

interface ContainerFormDialogProps {
    state: FormState;
    language: string;
    onClose: () => void;
    onSaved: (container: WasteContainer) => void;
}

const ContainerFormDialog: React.FC<ContainerFormDialogProps> = ({ state, language, onClose, onSaved }) => {
    const copy = containerCopy(language);
    const editing = state.mode === 'edit' ? state.container : null;
    const [streamCode, setStreamCode] = useState<WasteStreamCode>(editing?.streamCode ?? 'ORGANIC_NON_HALOGENATED');
    const [label, setLabel] = useState(editing?.label ?? '');
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
                        disabled={Boolean(editing)}
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
