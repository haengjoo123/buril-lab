import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, ShoppingCart, X } from 'lucide-react';
import {
    createPurchaseRequest,
    fetchUsageCounts,
    isOpenPurchaseRequest,
    listPurchaseRequests,
    toPurchaseError,
    updatePurchaseRequest,
    type NewPurchaseRequest,
    type PurchaseRequest,
    type PurchaseRequestAction,
} from '../../services/purchaseRequestService';
import { purchaseCopy } from './copy';
import { adminActionsFor } from './purchaseFlow';
import { forecastStock, USAGE_WINDOW_DAYS, type ForecastItem, type StockForecast, type UsageCount } from './stockForecast';

interface PurchaseRequestsDialogProps {
    items: readonly ForecastItem[];
    labId: string | null;
    userId: string | null;
    isAdmin: boolean;
    language: string;
    onClose: () => void;
}

type Draft = { itemName: string; quantity: string; packageSize: string; brand: string; productNumber: string; casNumber: string; note: string; sourceInventoryId: string | null; suggested: number | null };

const EMPTY_DRAFT: Draft = { itemName: '', quantity: '1', packageSize: '', brand: '', productNumber: '', casNumber: '', note: '', sourceInventoryId: null, suggested: null };

const STATUS_TONE: Record<PurchaseRequest['status'], string> = {
    requested: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    approved: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
    ordered: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
    received: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    rejected: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
    cancelled: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
};

const formatDate = (value: string, language: string): string => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(language.startsWith('en') ? 'en-US' : 'ko-KR', { month: 'short', day: 'numeric' });
};

const inputClass = 'min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';

export const PurchaseRequestsDialog: React.FC<PurchaseRequestsDialogProps> = ({ items, labId, userId, isAdmin, language, onClose }) => {
    const copy = purchaseCopy(language);
    const closeRef = useRef<HTMLButtonElement>(null);
    const [usage, setUsage] = useState<Map<string, UsageCount> | null>(null);
    const [usageFailed, setUsageFailed] = useState(false);
    const [requests, setRequests] = useState<PurchaseRequest[] | null>(null);
    const [requestsFailed, setRequestsFailed] = useState(false);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [notes, setNotes] = useState<Record<string, string>>({});
    const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
    const [showClosed, setShowClosed] = useState(false);

    useEffect(() => {
        closeRef.current?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    useEffect(() => {
        let cancelled = false;
        fetchUsageCounts(labId, USAGE_WINDOW_DAYS)
            .then((counts) => {
                if (!cancelled) setUsage(counts);
            })
            .catch((error) => {
                console.warn('Could not load usage counts:', error);
                if (cancelled) return;
                setUsageFailed(true);
                setUsage(new Map());
            });
        return () => {
            cancelled = true;
        };
    }, [labId]);

    const loadRequests = useCallback(() => {
        if (!labId) return () => undefined;
        let cancelled = false;
        listPurchaseRequests(labId)
            .then((rows) => {
                if (cancelled) return;
                setRequests(rows);
                setRequestsFailed(false);
            })
            .catch((error) => {
                console.warn('Could not load purchase requests:', error);
                if (!cancelled) setRequestsFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [labId]);

    useEffect(() => loadRequests(), [loadRequests]);

    const forecasts = useMemo(() => (usage ? forecastStock(items, usage) : []), [items, usage]);
    const openSources = useMemo(() => new Set(
        (requests ?? []).filter(isOpenPurchaseRequest).map((request) => request.sourceInventoryId).filter((id): id is string => Boolean(id)),
    ), [requests]);
    const openRequests = (requests ?? []).filter(isOpenPurchaseRequest);
    const closedRequests = (requests ?? []).filter((request) => !isOpenPurchaseRequest(request));

    const startDraft = (forecast?: StockForecast) => {
        setMessage(null);
        setDraft(forecast ? {
            itemName: forecast.name,
            quantity: String(forecast.suggestedQuantity),
            packageSize: forecast.capacity ?? '',
            brand: forecast.brand ?? '',
            productNumber: forecast.productNumber ?? '',
            casNumber: forecast.casNumber ?? '',
            note: '',
            sourceInventoryId: forecast.itemIds[0] ?? null,
            suggested: forecast.usedInWindow > 0 ? forecast.suggestedQuantity : null,
        } : EMPTY_DRAFT);
    };

    const submitDraft = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!draft || !labId) return;
        const input: NewPurchaseRequest = {
            itemName: draft.itemName,
            quantity: Number(draft.quantity),
            packageSize: draft.packageSize,
            brand: draft.brand,
            productNumber: draft.productNumber,
            casNumber: draft.casNumber,
            note: draft.note,
            sourceInventoryId: draft.sourceInventoryId,
        };
        setBusyId('draft');
        try {
            const saved = await createPurchaseRequest(labId, input);
            setRequests((current) => [saved, ...(current ?? []).filter((request) => request.id !== saved.id)]);
            setDraft(null);
            setMessage({ tone: 'ok', text: copy.saved });
        } catch (error) {
            setMessage({ tone: 'error', text: copy.errors[toPurchaseError(error).code] });
        } finally {
            setBusyId(null);
        }
    };

    const act = async (request: PurchaseRequest, status: PurchaseRequestAction) => {
        setBusyId(request.id);
        setMessage(null);
        try {
            const saved = await updatePurchaseRequest(request.id, status, notes[request.id]);
            setRequests((current) => (current ?? []).map((row) => (row.id === saved.id ? saved : row)));
            setNotes((current) => ({ ...current, [request.id]: '' }));
        } catch (error) {
            const code = toPurchaseError(error).code;
            setMessage({ tone: 'error', text: copy.errors[code] });
            if (code === 'invalid_transition') loadRequests();
        } finally {
            setBusyId(null);
        }
    };

    const actionLabel: Record<PurchaseRequestAction, string> = {
        approved: copy.approve,
        rejected: copy.reject,
        ordered: copy.markOrdered,
        received: copy.markReceived,
        cancelled: copy.cancel,
    };

    const renderRequest = (request: PurchaseRequest) => {
        const actions = isAdmin
            ? adminActionsFor(request.status)
            : request.status === 'requested' && request.requestedBy === userId ? ['cancelled' as const] : [];
        const detail = [request.packageSize, request.brand, request.productNumber, request.casNumber].filter(Boolean).join(' · ');
        return (
            <li key={request.id} className="px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <p className="break-words text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {request.itemName} <span className="font-normal text-slate-500 dark:text-slate-400">× {request.quantity}</span>
                        </p>
                        {detail && <p className="mt-0.5 break-words text-xs text-slate-500 dark:text-slate-400">{detail}</p>}
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {copy.requestedBy(request.requesterName ?? '—', formatDate(request.createdAt, language))}
                        </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[request.status]}`}>{copy.status[request.status]}</span>
                </div>
                {request.note && <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-300">{request.note}</p>}
                {(request.decisionNote || (request.deciderName && request.status !== 'requested')) && (
                    <p className="mt-2 break-words text-xs text-slate-600 dark:text-slate-300">
                        {request.deciderName && <span className="font-medium">{copy.decidedBy(request.deciderName)}</span>}
                        {request.decisionNote && <span>{request.deciderName ? ' — ' : ''}{request.decisionNote}</span>}
                    </p>
                )}
                {request.status === 'received' && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{copy.receivedHint}</p>}
                {actions.length > 0 && (
                    // The admin's note and the buttons share a row where there is room.
                    <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center">
                        {isAdmin && request.status === 'requested' && (
                            <input
                                value={notes[request.id] ?? ''}
                                onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                                maxLength={500}
                                placeholder={copy.decisionNotePlaceholder}
                                aria-label={copy.decisionNotePlaceholder}
                                className={`${inputClass} sm:min-w-0 sm:flex-1`}
                            />
                        )}
                        <div className="flex gap-2 sm:ml-auto sm:shrink-0">
                            {actions.map((status, index) => (
                                <button
                                    key={status}
                                    type="button"
                                    disabled={busyId !== null}
                                    onClick={() => void act(request, status)}
                                    className={index === 0 && status !== 'cancelled'
                                        ? 'inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 sm:flex-none'
                                        : 'inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800 sm:flex-none'}
                                >
                                    {busyId === request.id && index === 0 && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                                    {actionLabel[status]}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </li>
        );
    };

    const field = (key: keyof Omit<Draft, 'sourceInventoryId' | 'suggested'>, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
            {label}
            <input
                {...props}
                value={draft?.[key] ?? ''}
                onChange={(event) => setDraft((current) => (current ? { ...current, [key]: event.target.value } : current))}
                className={inputClass}
            />
        </label>
    );

    return (
        <div className="fixed inset-0 z-[90] flex items-stretch justify-center bg-slate-900/40 backdrop-blur-sm sm:items-center sm:p-4">
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="purchase-requests-title"
                className="flex h-full w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900 sm:h-auto sm:max-h-[92vh] sm:rounded-2xl"
            >
                <header className="flex items-center justify-between gap-3 border-b border-slate-200 py-2 pl-4 pr-2 dark:border-slate-700">
                    <h2 id="purchase-requests-title" className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
                        <ShoppingCart className="h-5 w-5 text-blue-600" aria-hidden="true" />
                        {draft ? copy.formTitle : copy.title}
                    </h2>
                    <button ref={closeRef} type="button" onClick={onClose} aria-label={copy.close}
                        className="flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                        <X className="h-5 w-5" />
                    </button>
                </header>

                <div className="flex-1 overflow-y-auto px-4 py-4">
                    {message && (
                        <p role={message.tone === 'error' ? 'alert' : 'status'}
                            className={`mb-3 rounded-xl px-3 py-2 text-sm ${message.tone === 'error' ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'}`}>
                            {message.text}
                        </p>
                    )}

                    {draft ? (
                        <form onSubmit={(event) => void submitDraft(event)} className="flex flex-col gap-3">
                            {field('itemName', copy.formName, { required: true, maxLength: 200 })}
                            <div className="grid gap-3 sm:grid-cols-2">
                                {field('quantity', copy.formQuantity, { required: true, type: 'number', min: 1, max: 999, inputMode: 'numeric' })}
                                {field('packageSize', copy.formPackage, { maxLength: 60 })}
                            </div>
                            {draft.suggested !== null && <p className="text-xs text-slate-500 dark:text-slate-400">{copy.formSuggested(draft.suggested)}</p>}
                            <div className="grid gap-3 sm:grid-cols-2">
                                {field('brand', copy.formBrand, { maxLength: 120 })}
                                {field('productNumber', copy.formProductNumber, { maxLength: 120 })}
                            </div>
                            {field('casNumber', copy.formCas, { maxLength: 20, inputMode: 'numeric' })}
                            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                                {copy.formNote}
                                <textarea
                                    value={draft.note}
                                    maxLength={500}
                                    rows={3}
                                    onChange={(event) => setDraft((current) => (current ? { ...current, note: event.target.value } : current))}
                                    className={`${inputClass} py-2`}
                                />
                            </label>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{copy.formAdminNote}</p>
                            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                                <button type="button" onClick={() => setDraft(null)}
                                    className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
                                    {copy.formCancel}
                                </button>
                                <button type="submit" disabled={busyId === 'draft'}
                                    className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-blue-600 px-5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                                    {busyId === 'draft' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                                    {copy.formSubmit}
                                </button>
                            </div>
                        </form>
                    ) : (
                        <>
                            <section aria-labelledby="purchase-forecast-title">
                                <h3 id="purchase-forecast-title" className="text-sm font-bold text-slate-900 dark:text-slate-100">{copy.forecastTitle}</h3>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{copy.forecastHint}</p>
                                {usageFailed && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{copy.forecastUsageFailed}</p>}
                                {!usage ? (
                                    <p className="mt-3 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{copy.forecastLoading}</p>
                                ) : forecasts.length === 0 ? (
                                    <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{copy.forecastEmpty}</p>
                                ) : (
                                    <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
                                        {forecasts.map((forecast) => {
                                            const alreadyRequested = forecast.itemIds.some((id) => openSources.has(id));
                                            return (
                                                <li key={forecast.key} className="flex items-center justify-between gap-3 px-3 py-3">
                                                    <div className="min-w-0">
                                                        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                                                            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${forecast.level === 'low' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'}`}>
                                                                {forecast.level === 'low' ? copy.levelLow : copy.levelSoon}
                                                            </span>
                                                            <span className="break-words">{forecast.name}</span>
                                                        </p>
                                                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                                            {[
                                                                copy.onHand(forecast.bottles, forecast.onHand),
                                                                forecast.reason === 'last_bottle' && forecast.lastBottlePercent !== null ? copy.lastBottle(forecast.lastBottlePercent) : forecast.daysLeft !== null ? copy.daysLeft(forecast.daysLeft) : null,
                                                                forecast.usedInWindow > 0 ? copy.usedRecently(forecast.usedInWindow) : null,
                                                            ].filter(Boolean).join(' · ')}
                                                        </p>
                                                    </div>
                                                    {labId && (alreadyRequested ? (
                                                        <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{copy.requested}</span>
                                                    ) : (
                                                        <button type="button" onClick={() => startDraft(forecast)} disabled={requests === null && !requestsFailed}
                                                            className="min-h-10 shrink-0 whitespace-nowrap rounded-lg px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-950">
                                                            {copy.request}
                                                        </button>
                                                    ))}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </section>

                            <section aria-labelledby="purchase-list-title" className="mt-6">
                                <div className="flex items-center justify-between gap-2">
                                    <h3 id="purchase-list-title" className="text-sm font-bold text-slate-900 dark:text-slate-100">{copy.requestsTitle}</h3>
                                    {labId && (
                                        <button type="button" onClick={() => startDraft()}
                                            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950">
                                            <Plus className="h-4 w-4" aria-hidden="true" />
                                            {copy.newRequest}
                                        </button>
                                    )}
                                </div>
                                {!labId ? (
                                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{copy.personalOnly}</p>
                                ) : requestsFailed && requests === null ? (
                                    <p className="mt-2 flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
                                        {copy.requestsFailed}
                                        <button type="button" onClick={() => loadRequests()} className="min-h-11 rounded-lg px-2 font-semibold underline">{copy.retry}</button>
                                    </p>
                                ) : requests === null ? (
                                    <p className="mt-2 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /></p>
                                ) : requests.length === 0 ? (
                                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{copy.requestsEmpty}</p>
                                ) : (
                                    <>
                                        {openRequests.length > 0 && <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">{openRequests.map(renderRequest)}</ul>}
                                        {closedRequests.length > 0 && (
                                            <>
                                                <button type="button" onClick={() => setShowClosed((value) => !value)}
                                                    className="mt-2 min-h-11 rounded-lg px-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                                                    {showClosed ? copy.hideClosed : copy.showClosed(closedRequests.length)}
                                                </button>
                                                {showClosed && <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">{closedRequests.map(renderRequest)}</ul>}
                                            </>
                                        )}
                                    </>
                                )}
                            </section>
                        </>
                    )}
                </div>
            </section>
        </div>
    );
};
