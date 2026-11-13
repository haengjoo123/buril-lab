import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { CameraOff, CheckCircle2, CircleDashed, Download, MapPin, ScanLine, X } from 'lucide-react';
import { qrCopy } from './copy';
import { parseQrLink, spaceFor } from './qrPayload';
import { useQrScan } from './useQrScan';
import {
    recordScan,
    setManualConfirmation,
    startStocktake,
    summarizeStocktake,
    type StocktakeItem,
    type StocktakeState,
} from './stocktake';

export interface StocktakeLocationOption {
    key: string;
    label: string;
}

interface StocktakeDialogProps {
    items: StocktakeItem[];
    locations: StocktakeLocationOption[];
    labId: string | null;
    language: string;
    onClose: () => void;
}

const formatTime = (value: string): string => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const StocktakeDialog: React.FC<StocktakeDialogProps> = ({ items, locations, labId, language, onClose }) => {
    const copy = qrCopy(language);
    const webcamRef = useRef<Webcam>(null);
    // Count records per location so the busiest one is preselected and every option shows its size.
    const countByLocation = useMemo(() => {
        const counts = new Map<string, number>();
        items.forEach((item) => counts.set(item.locationKey, (counts.get(item.locationKey) ?? 0) + 1));
        return counts;
    }, [items]);
    const [locationKey, setLocationKey] = useState(() => locations.reduce<StocktakeLocationOption | null>(
        (best, option) => (!best || (countByLocation.get(option.key) ?? 0) > (countByLocation.get(best.key) ?? 0) ? option : best),
        null,
    )?.key ?? '');
    const [state, setState] = useState<StocktakeState | null>(null);
    const [cameraOff, setCameraOff] = useState(false);
    const [lastScan, setLastScan] = useState<string | null>(null);
    const [exportError, setExportError] = useState<string | null>(null);
    const space = spaceFor(labId);

    const stateRef = useRef(state);
    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    const onText = useCallback((text: string) => {
        const target = parseQrLink(text, [window.location.origin]);
        const current = stateRef.current;
        if (!target || target.kind !== 'inventory' || !current) return;
        // A label from another space is never matched against this space's records.
        const id = target.space === space ? target.id : `other:${target.id}`;
        const result = recordScan(current, id, items);
        stateRef.current = result.state;
        setState(result.state);
        setLastScan(result.item ? result.item.name : null);
    }, [items, space]);

    useQrScan(() => webcamRef.current?.video, Boolean(state) && !cameraOff, onText);

    const summary = useMemo(() => (state ? summarizeStocktake(state, items) : null), [items, state]);
    const locationLabel = locations.find((option) => option.key === state?.locationKey)?.label ?? '';

    const exportResult = async () => {
        if (!summary) return;
        setExportError(null);
        try {
            const { downloadRowsAsXlsx } = await import('../../utils/excelFiles');
            const [statusHeader, nameHeader, casHeader, recordedHeader, hereHeader, viaHeader, atHeader] = copy.columns;
            const statusText = { confirmed: copy.stocktakeConfirmed, missing: copy.stocktakeMissing, elsewhere: copy.stocktakeElsewhere };
            const rows = summary.rows.map((row) => ({
                [statusHeader]: statusText[row.status],
                [nameHeader]: row.item.name,
                [casHeader]: row.item.casNumber ?? '',
                [recordedHeader]: row.item.locationLabel,
                [hereHeader]: locationLabel,
                [viaHeader]: row.confirmation ? (row.confirmation.via === 'scan' ? copy.viaScan : copy.viaManual) : '',
                [atHeader]: row.confirmation ? new Date(row.confirmation.at).toLocaleString() : '',
            }));
            const stamp = new Date().toISOString().slice(0, 10);
            await downloadRowsAsXlsx(rows, copy.sheetName, `buril-stocktake-${stamp}.xlsx`);
        } catch (error) {
            console.error('Failed to export the stocktake:', error);
            setExportError(copy.stocktakeExportFailed);
        }
    };

    return (
        <div className="fixed inset-0 z-[90] flex items-stretch justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center sm:p-4">
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="stocktake-title"
                className="flex h-full w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900 sm:h-auto sm:max-h-[92vh] sm:rounded-2xl"
            >
                <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                    <div className="min-w-0">
                        <h2 id="stocktake-title" className="text-base font-bold text-slate-900 dark:text-slate-100">{copy.stocktakeTitle}</h2>
                        {state && (
                            <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-600 dark:text-slate-300">
                                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                <span className="truncate">{locationLabel}</span>
                            </p>
                        )}
                    </div>
                    <button type="button" onClick={onClose} aria-label={copy.close} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                        <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                </header>

                {!state ? (
                    <div className="space-y-4 overflow-y-auto p-4">
                        <p className="break-keep text-sm text-slate-600 dark:text-slate-300">{copy.stocktakeIntro}</p>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                            <span>{copy.stocktakeLocation}</span>
                            <select
                                value={locationKey}
                                onChange={(event) => setLocationKey(event.target.value)}
                                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                            >
                                {locations.length === 0 && <option value="">{copy.stocktakeChoose}</option>}
                                {locations.map((option) => (
                                    <option key={option.key} value={option.key}>{`${option.label} (${countByLocation.get(option.key) ?? 0})`}</option>
                                ))}
                            </select>
                        </label>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            {copy.stocktakeExpected(items.filter((item) => item.locationKey === locationKey).length)}
                        </p>
                        <button
                            type="button"
                            disabled={!locationKey}
                            onClick={() => setState(startStocktake(locationKey))}
                            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                            <ScanLine className="h-4 w-4" aria-hidden="true" />
                            {copy.stocktakeStart}
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="relative mx-4 mt-4 aspect-[4/3] max-h-[34vh] overflow-hidden rounded-xl bg-black">
                            {cameraOff ? (
                                <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-white/80">
                                    <CameraOff className="h-8 w-8" aria-hidden="true" />
                                    {copy.stocktakeCameraOff}
                                </div>
                            ) : (
                                <Webcam
                                    audio={false}
                                    ref={webcamRef}
                                    videoConstraints={{ facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } }}
                                    onUserMediaError={() => setCameraOff(true)}
                                    className="h-full w-full object-cover"
                                />
                            )}
                            {lastScan && (
                                <p className="absolute inset-x-2 bottom-2 rounded-lg bg-emerald-600/90 px-3 py-1.5 text-sm font-semibold text-white" role="status">
                                    {copy.stocktakeLastScan(lastScan)}
                                </p>
                            )}
                        </div>
                        {summary && (
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-3 text-sm">
                                <span className="font-bold text-slate-900 dark:text-slate-100">{copy.stocktakeProgress(summary.confirmed, summary.expected)}</span>
                                {summary.elsewhere > 0 && <span className="text-amber-700 dark:text-amber-300">{copy.stocktakeElsewhere} {summary.elsewhere}</span>}
                                {summary.unknown > 0 && <span className="text-slate-500 dark:text-slate-400">{copy.stocktakeUnknown} {summary.unknown}</span>}
                            </div>
                        )}
                        <p className="px-4 pt-1 text-xs text-slate-500 dark:text-slate-400">{copy.stocktakeNoLabel}</p>
                        <ul className="mt-2 min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto px-4 dark:divide-slate-800">
                            {summary && summary.rows.length === 0 && (
                                <li className="py-4 text-sm text-slate-500 dark:text-slate-400">{copy.stocktakeEmpty}</li>
                            )}
                            {summary?.rows.map((row) => (
                                <li key={row.item.id} className="flex items-center gap-3 py-2.5">
                                    {row.status === 'missing'
                                        ? <CircleDashed className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
                                        : <CheckCircle2 className={`h-5 w-5 shrink-0 ${row.status === 'elsewhere' ? 'text-amber-500' : 'text-emerald-600'}`} aria-hidden="true" />}
                                    <span className="min-w-0 flex-1">
                                        <span className="block break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{row.item.name}</span>
                                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                                            {row.status === 'elsewhere'
                                                ? `${copy.stocktakeElsewhere} · ${row.item.locationLabel}`
                                                : row.status === 'confirmed'
                                                    ? `${copy.stocktakeConfirmed} · ${row.confirmation?.via === 'scan' ? copy.viaScan : copy.viaManual} · ${row.confirmation ? formatTime(row.confirmation.at) : ''}`
                                                    : copy.stocktakeMissing}
                                        </span>
                                    </span>
                                    {row.status === 'missing' ? (
                                        <button
                                            type="button"
                                            onClick={() => setState((current) => (current ? setManualConfirmation(current, row.item.id, true) : current))}
                                            className="min-h-10 shrink-0 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                        >
                                            {copy.stocktakeMarkFound}
                                        </button>
                                    ) : row.confirmation?.via === 'manual' && (
                                        <button
                                            type="button"
                                            onClick={() => setState((current) => (current ? setManualConfirmation(current, row.item.id, false) : current))}
                                            className="min-h-10 shrink-0 rounded-lg px-3 text-xs font-semibold text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800"
                                        >
                                            {copy.stocktakeUndo}
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
                            {exportError && <p className="mr-auto text-sm text-red-600 dark:text-red-400" role="alert">{exportError}</p>}
                            <button
                                type="button"
                                onClick={() => void exportResult()}
                                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                            >
                                <Download className="h-4 w-4" aria-hidden="true" />
                                {copy.stocktakeExport}
                            </button>
                            <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700">
                                {copy.stocktakeFinish}
                            </button>
                        </footer>
                    </>
                )}
            </section>
        </div>
    );
};
