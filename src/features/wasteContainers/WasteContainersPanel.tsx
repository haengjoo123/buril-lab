import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronRight, Loader2, MapPin, Plus } from 'lucide-react';
import {
    fetchWasteContainerTotals,
    fetchWasteContainers,
    type WasteContainer,
    type WasteContainerTotals,
} from '../../services/wasteContainerService';
import { wasteStreamDotClass, wasteStreamLabel } from '../../utils/wasteLabels';
import { sortContainers } from './containerSummary';
import { formatLabelDate } from './containerLabel';
import { containerCopy } from './copy';
import { ContainerFillBar } from './ContainerFillBar';
import { ContainerStatusChip } from './ContainerStatusChip';
import { ContainerFormDialog, type ContainerFormState } from './ContainerFormDialog';
import { WasteContainerDetail } from './WasteContainerDetail';

interface WasteContainersPanelProps {
    labId: string | null;
    labName: string | null;
    /** Lab admin, or the personal space owner. */
    canCollect: boolean;
    language: string;
    /** Container to open once the list has loaded (from a scanned QR link). */
    initialDetailId?: string | null;
    /** Called when `initialDetailId` is not among this space's containers. */
    onInitialDetailMissing?: () => void;
}

type FormState = ContainerFormState;
const EMPTY_TOTALS: WasteContainerTotals = { depositCount: 0, totalMl: 0, hasUnknownAmounts: false };

export const WasteContainersPanel: React.FC<WasteContainersPanelProps> = ({ labId, labName, canCollect, language, initialDetailId, onInitialDetailMissing }) => {
    const copy = containerCopy(language);
    const [containers, setContainers] = useState<WasteContainer[] | null>(null);
    const [totals, setTotals] = useState<Record<string, WasteContainerTotals>>({});
    const [includeCollected, setIncludeCollected] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const [form, setForm] = useState<FormState | null>(null);
    const [detailId, setDetailId] = useState<string | null>(null);
    // A container passed in by a scanned link, opened once the list arrives.
    const pendingInitialRef = useRef(initialDetailId ? initialDetailId.toLowerCase() : null);
    const onMissingRef = useRef(onInitialDetailMissing);
    useEffect(() => {
        onMissingRef.current = onInitialDetailMissing;
    });

    useEffect(() => {
        let cancelled = false;
        fetchWasteContainers({ includeCollected })
            .then(async (rows) => {
                const nextTotals = await fetchWasteContainerTotals(rows.map((row) => row.id));
                if (cancelled) return;
                setContainers(sortContainers(rows));
                setTotals(nextTotals);
                setError(null);
                const wanted = pendingInitialRef.current;
                if (wanted) {
                    const found = rows.find((row) => row.id.toLowerCase() === wanted);
                    if (found) {
                        pendingInitialRef.current = null;
                        setDetailId(found.id);
                    } else if (!includeCollected) {
                        // A collected container is hidden by default; look there before giving up.
                        setIncludeCollected(true);
                    } else {
                        pendingInitialRef.current = null;
                        onMissingRef.current?.();
                    }
                }
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
