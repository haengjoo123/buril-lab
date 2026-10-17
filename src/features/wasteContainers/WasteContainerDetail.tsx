import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Archive, FileText, Loader2, Lock, MapPin, Pencil, RotateCcw } from 'lucide-react';
import {
    MAX_CONTAINER_DEPOSITS,
    fetchWasteContainerDeposits,
    fetchWasteContainerTotals,
    setWasteContainerStatus,
    toWasteContainerError,
    type WasteContainer,
    type WasteContainerDepositPage,
    type WasteContainerStatus,
    type WasteContainerTotals,
} from '../../services/wasteContainerService';
import { getActiveWastePolicyV2 } from '../../services/wastePolicyService';
import { hazardFlagLabel, wasteStreamDotClass, wasteStreamLabel } from '../../utils/wasteLabels';
import { formatMassMg, formatVolumeMl, summarizeContainer, withDatabaseTotals } from './containerSummary';
import { buildContainerLabelModel, downloadContainerLabelPdf, formatLabelDate } from './containerLabel';
import { containerCopy, containerErrorMessage, containerStatusLabel } from './copy';
import { ContainerFillBar } from './ContainerFillBar';
import { ContainerDialog, dialogInput, dialogPrimaryButton, dialogSecondaryButton } from './ContainerDialog';
import { ContainerStatusChip } from './ContainerStatusChip';

interface WasteContainerDetailProps {
    container: WasteContainer;
    labId: string | null;
    labName: string | null;
    /** Lab admins (or the owner of a personal container) may mark it collected. */
    canCollect: boolean;
    language: string;
    onClose: () => void;
    onEdit: (container: WasteContainer) => void;
    onChanged: (container: WasteContainer) => void;
}

const statusButton = 'inline-flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

export const WasteContainerDetail: React.FC<WasteContainerDetailProps> = ({
    container,
    labId,
    labName,
    canCollect,
    language,
    onClose,
    onEdit,
    onChanged,
}) => {
    const copy = containerCopy(language);
    const [page, setPage] = useState<WasteContainerDepositPage | null>(null);
    const [totals, setTotals] = useState<WasteContainerTotals | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [busy, setBusy] = useState<WasteContainerStatus | 'print' | null>(null);
    const [collectOpen, setCollectOpen] = useState(false);
    const [collectNote, setCollectNote] = useState('');

    useEffect(() => {
        let cancelled = false;
        Promise.all([fetchWasteContainerDeposits(container.id), fetchWasteContainerTotals([container.id])])
            .then(([nextPage, nextTotals]) => {
                if (cancelled) return;
                setPage(nextPage);
                setTotals(nextTotals[container.id] ?? null);
            })
            .catch((error) => {
                console.error('Failed to load container deposits:', error);
                if (!cancelled) setLoadError(copy.loadFailed);
            });
        return () => {
            cancelled = true;
        };
    }, [container.id, copy.loadFailed]);

    const summary = useMemo(
        () => (page ? withDatabaseTotals(summarizeContainer(container, page.deposits), container.capacityMl, totals) : null),
        [container, page, totals],
    );

    const changeStatus = async (status: WasteContainerStatus) => {
        setBusy(status);
        setActionError(null);
        try {
            const updated = await setWasteContainerStatus(container.id, status, status === 'collected' ? collectNote : null);
            setCollectOpen(false);
            onChanged(updated);
        } catch (error) {
            setActionError(containerErrorMessage(toWasteContainerError(error).code, language));
        } finally {
            setBusy(null);
        }
    };

    const printLabel = async () => {
        if (!summary) return;
        setBusy('print');
        setActionError(null);
        try {
            let handlerContact: string | null = null;
            let prohibitions: string[] = [];
            try {
                const policy = await getActiveWastePolicyV2(labId);
                const stream = policy.resolvedStreams.find((item) => item.streamCode === container.streamCode);
                handlerContact = stream?.handlerContact ?? null;
                prohibitions = stream?.prohibitions ?? [];
            } catch (error) {
                // The record still prints with its default precautions.
                console.warn('Waste policy unavailable for the contents record:', error);
            }
            const model = buildContainerLabelModel(container, summary, {
                language,
                labName,
                handlerContact,
                prohibitions,
                printedAt: new Date(),
                partialContents: page?.truncated ?? false,
            });
            await downloadContainerLabelPdf(model);
        } catch (error) {
            console.error('Failed to create the contents record:', error);
            setActionError(copy.printFailed);
        } finally {
            setBusy(null);
        }
    };

    const statusHelp = container.status === 'active'
        ? copy.statusActiveHelp
        : container.status === 'sealed' ? copy.statusSealedHelp : copy.statusCollectedHelp;

    return (
        <ContainerDialog
            titleId="waste-container-detail-title"
            widthClass="max-w-2xl"
            closeLabel={copy.close}
            onClose={onClose}
            title={(
                <span className="flex min-w-0 items-center gap-2">
                    <span className={`h-3 w-3 shrink-0 rounded-full ${wasteStreamDotClass(container.streamCode)}`} aria-hidden="true" />
                    <span className="min-w-0 break-words">{container.label}</span>
                    <ContainerStatusChip status={container.status} language={language} />
                </span>
            )}
            subtitle={(
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>{wasteStreamLabel(container.streamCode, language)}</span>
                    {container.location && (
                        <span className="inline-flex items-center gap-1">
                            • <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{container.location}
                        </span>
                    )}
                    <span className="whitespace-nowrap">• {copy.started} {formatLabelDate(container.startedAt)}</span>
                </span>
            )}
            footer={(
                <>
                    {container.status !== 'collected' && (
                        <button type="button" onClick={() => onEdit(container)} disabled={busy !== null} className={dialogSecondaryButton}>
                            <Pencil className="h-4 w-4" aria-hidden="true" />{copy.edit}
                        </button>
                    )}
                    <button type="button" onClick={printLabel} disabled={!summary || busy !== null} className={dialogPrimaryButton}>
                        {busy === 'print'
                            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            : <FileText className="h-4 w-4" aria-hidden="true" />}
                        {busy === 'print' ? copy.printing : copy.printLabel}
                    </button>
                </>
            )}
        >
            <div className="space-y-5">
                {loadError && (
                    <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900/30 dark:bg-red-900/20 dark:text-red-400">
                        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />{loadError}
                    </div>
                )}
                {!summary && !loadError && (
                    <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-blue-500" aria-hidden="true" /></div>
                )}
                {summary && (
                    <>
                        <section className="rounded-xl border border-gray-100 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                            <ContainerFillBar
                                totalMl={summary.totalMl}
                                capacityMl={container.capacityMl}
                                hasUnknownAmounts={summary.hasUnknownAmounts}
                                language={language}
                            />
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                                <span className="whitespace-nowrap">{copy.deposits(summary.depositCount)}</span>
                                {summary.totalMg > 0 && <span className="whitespace-nowrap">• {formatMassMg(summary.totalMg)}</span>}
                            </div>
                            {summary.hasUnknownAmounts && (
                                <p className="mt-2 break-keep text-xs text-amber-700 dark:text-amber-300">{copy.unknownAmountNote}</p>
                            )}
                            {summary.hazardFlags.length > 0 && (
                                <ul className="mt-3 flex flex-wrap gap-1.5">
                                    {summary.hazardFlags.map((flag) => (
                                        <li key={flag} className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-700 ring-1 ring-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:ring-orange-900/60">
                                            {hazardFlagLabel(flag, language)}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        <section className="rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 dark:border-blue-900/40 dark:bg-blue-950/20">
                            <h4 className="text-sm font-medium text-slate-700 dark:text-slate-200">
                                {copy.statusTitle} · {containerStatusLabel(container.status, language)}
                            </h4>
                            <p className="mt-1 break-keep text-sm text-slate-600 dark:text-slate-300">{statusHelp}</p>

                            {container.status !== 'collected' && !collectOpen && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {container.status === 'active' && (
                                        <button
                                            type="button"
                                            onClick={() => changeStatus('sealed')}
                                            disabled={busy !== null}
                                            className={`${statusButton} border-amber-200 bg-white text-amber-700 hover:bg-amber-50 dark:border-amber-900/60 dark:bg-slate-800 dark:text-amber-300`}
                                        >
                                            {busy === 'sealed' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
                                            {copy.seal}
                                        </button>
                                    )}
                                    {container.status === 'sealed' && (
                                        <button
                                            type="button"
                                            onClick={() => changeStatus('active')}
                                            disabled={busy !== null}
                                            className={`${statusButton} border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300`}
                                        >
                                            {busy === 'active' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
                                            {copy.reopen}
                                        </button>
                                    )}
                                    {canCollect && (
                                        <button
                                            type="button"
                                            onClick={() => setCollectOpen(true)}
                                            disabled={busy !== null}
                                            className={`${statusButton} border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300`}
                                        >
                                            <Archive className="h-4 w-4" aria-hidden="true" />{copy.collect}
                                        </button>
                                    )}
                                </div>
                            )}
                            {container.status !== 'collected' && !canCollect && (
                                <p className="mt-2 break-keep text-xs text-slate-500 dark:text-slate-400">{copy.collectAdminOnly}</p>
                            )}

                            {collectOpen && (
                                <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                                    <p className="break-keep text-sm font-medium text-slate-800 dark:text-slate-100">{copy.collectConfirm}</p>
                                    <label className="mt-3 flex flex-col gap-1.5 text-sm text-slate-700 dark:text-slate-300">
                                        <span>{copy.collectNote}</span>
                                        <input
                                            value={collectNote}
                                            onChange={(event) => setCollectNote(event.target.value)}
                                            maxLength={500}
                                            placeholder={copy.collectNotePlaceholder}
                                            className={dialogInput}
                                        />
                                    </label>
                                    <div className="mt-3 flex gap-2">
                                        <button type="button" onClick={() => setCollectOpen(false)} disabled={busy !== null} className={dialogSecondaryButton}>
                                            {copy.cancel}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => changeStatus('collected')}
                                            disabled={busy !== null}
                                            className="inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900"
                                        >
                                            {busy === 'collected' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                                            {copy.collect}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </section>

                        <section>
                            <h4 className="text-sm font-bold text-slate-900 dark:text-white">{copy.contents}</h4>
                            {page?.truncated && (
                                <p className="mt-1 break-keep text-xs text-amber-700 dark:text-amber-300">{copy.truncatedNote(MAX_CONTAINER_DEPOSITS)}</p>
                            )}
                            {summary.components.length === 0 ? (
                                <p className="mt-2 break-keep text-sm text-slate-500 dark:text-slate-400">{copy.noDeposits}</p>
                            ) : (
                                <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-xl border border-gray-100 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
                                    {summary.components.map((component) => (
                                        <li key={component.key} className="flex items-start justify-between gap-3 px-3 py-2.5">
                                            <div className="min-w-0">
                                                <p className="break-words text-sm font-semibold text-slate-800 dark:text-slate-200">{component.chemicalName}</p>
                                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                                    {component.casNumber ? `CAS ${component.casNumber} • ` : ''}{copy.deposits(component.depositCount)}
                                                </p>
                                            </div>
                                            <span className="shrink-0 whitespace-nowrap text-sm font-semibold text-slate-800 dark:text-slate-200">
                                                {component.recordedVolumeMl !== null ? formatVolumeMl(component.recordedVolumeMl) : '-'}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        {page && page.deposits.length > 0 && (
                            <section>
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white">{copy.history}</h4>
                                <ol className="mt-2 space-y-2">
                                    {[...page.deposits].reverse().map((deposit) => (
                                        <li
                                            key={deposit.id}
                                            className={`rounded-xl border bg-white px-3 py-2.5 dark:bg-slate-800 ${deposit.voidedAt
                                                ? 'border-slate-300 opacity-80 dark:border-slate-600'
                                                : 'border-gray-100 dark:border-slate-700'}`}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <p className="min-w-0 break-words text-sm font-semibold text-slate-800 dark:text-slate-200">
                                                    {deposit.items.map((item) => item.chemicalName).filter(Boolean).join(', ') || '-'}
                                                </p>
                                                <span className="shrink-0 whitespace-nowrap text-xs text-slate-400 dark:text-slate-500">{formatLabelDate(deposit.createdAt)}</span>
                                            </div>
                                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                                                <span className="whitespace-nowrap">
                                                    {deposit.amountIsUnknown || deposit.amountValue === null
                                                        ? copy.amountUnknown
                                                        : `${deposit.amountUnit === 'mg' ? formatMassMg(deposit.amountValue) : formatVolumeMl(deposit.amountValue)}${deposit.amountIsApproximate ? ` (${copy.approximate})` : ''}`}
                                                </span>
                                                {deposit.handlerName && <span className="min-w-0 break-words">• {deposit.handlerName}</span>}
                                                {deposit.voidedAt && (
                                                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/60">
                                                        {copy.voided}
                                                    </span>
                                                )}
                                            </div>
                                        </li>
                                    ))}
                                </ol>
                            </section>
                        )}
                    </>
                )}


                {actionError && (
                    <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900/30 dark:bg-red-900/20 dark:text-red-400">
                        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="break-keep">{actionError}</span>
                    </div>
                )}
            </div>
        </ContainerDialog>
    );
};
