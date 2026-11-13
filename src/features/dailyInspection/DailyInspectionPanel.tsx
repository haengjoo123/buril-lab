import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ClipboardCheck, Loader2 } from 'lucide-react';
import {
    MAX_INSPECTION_NOTE_LENGTH,
    fetchRecentDailyInspections,
    saveDailyInspection,
    toDailyInspectionError,
    type DailyInspectionRecord,
} from '../../services/dailyInspectionService';
import { INSPECTION_SECTIONS } from './checklist';
import { inspectionCopy, inspectionErrorMessage, inspectionResultLabel } from './copy';
import {
    buildInspectionDays,
    fillUnansweredAsOk,
    kstDateString,
    recentKstDates,
    setSectionResult,
    summarizeInspection,
    type InspectionResult,
    type InspectionResults,
} from './inspectionSummary';

interface DailyInspectionPanelProps {
    /** Null in the personal space, where inspections are not recorded. */
    labId: string | null;
    language: string;
    /** Records already at hand (a fixture or a parent that loaded them); skips the first fetch. */
    initialRecords?: DailyInspectionRecord[];
}

const HISTORY_DAYS = 14;
const RESULT_ORDER: InspectionResult[] = ['ok', 'bad', 'na'];

// One segmented control per item: the group carries the border, the chosen answer is filled.
const resultButtonClass = (result: InspectionResult, selected: boolean): string => {
    const base = 'min-h-9 flex-1 rounded-md px-3 text-sm font-medium transition-colors disabled:opacity-60 sm:flex-none';
    if (!selected) {
        return `${base} text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700`;
    }
    if (result === 'bad') return `${base} bg-red-600 text-white dark:bg-red-500`;
    if (result === 'na') return `${base} bg-slate-600 text-white dark:bg-slate-500`;
    return `${base} bg-emerald-600 text-white dark:bg-emerald-500`;
};

type LoadState =
    | { status: 'loading' }
    | { status: 'failed' }
    | { status: 'ready'; records: DailyInspectionRecord[] };

/** Records today's daily lab safety inspection and shows recent days. */
export const DailyInspectionPanel: React.FC<DailyInspectionPanelProps> = ({ labId, language, initialRecords }) => {
    const copy = inspectionCopy(language);
    const isKorean = language.startsWith('ko');
    const initialToday = initialRecords?.find((record) => record.inspectionDate === kstDateString()) ?? null;
    const [load, setLoad] = useState<LoadState>(initialRecords ? { status: 'ready', records: initialRecords } : { status: 'loading' });
    const [reloadToken, setReloadToken] = useState(0);
    const [results, setResults] = useState<InspectionResults>(initialToday?.results ?? {});
    const [note, setNote] = useState(initialToday?.note ?? '');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
    const today = kstDateString();

    useEffect(() => {
        if (!labId || (initialRecords && reloadToken === 0)) return;
        let cancelled = false;
        fetchRecentDailyInspections(labId, HISTORY_DAYS)
            .then((records) => {
                if (cancelled) return;
                setLoad({ status: 'ready', records });
                // Start from today's record when one exists, so a second save edits it.
                const current = records.find((record) => record.inspectionDate === kstDateString());
                setResults(current?.results ?? {});
                setNote(current?.note ?? '');
            })
            .catch((error) => {
                console.error('Failed to load daily inspections:', error);
                if (!cancelled) setLoad({ status: 'failed' });
            });
        return () => {
            cancelled = true;
        };
    }, [initialRecords, labId, reloadToken]);

    const retry = useCallback(() => {
        setLoad({ status: 'loading' });
        setReloadToken((value) => value + 1);
    }, []);

    const progress = useMemo(() => summarizeInspection(results), [results]);
    const records = load.status === 'ready' ? load.records : null;
    const todayRecord = records?.find((record) => record.inspectionDate === today) ?? null;
    const days = useMemo(
        () => (records ? buildInspectionDays(recentKstDates(HISTORY_DAYS), records) : []),
        [records],
    );
    const recordedDays = days.filter((day) => day.status !== 'missing').length;

    if (!labId) {
        return (
            <p className="break-keep rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {copy.labOnly}
            </p>
        );
    }

    const setItem = (id: string, result: InspectionResult) => {
        setMessage(null);
        setResults((current) => ({ ...current, [id]: result }));
    };

    const save = async () => {
        if (!progress.complete || saving) return;
        setSaving(true);
        setMessage(null);
        try {
            const saved = await saveDailyInspection(labId, results, note);
            setLoad((current) => (current.status === 'ready'
                ? { status: 'ready', records: [saved, ...current.records.filter((record) => record.inspectionDate !== saved.inspectionDate)] }
                : { status: 'ready', records: [saved] }));
            setResults(saved.results);
            setNote(saved.note ?? '');
            setMessage({ tone: 'ok', text: copy.saved });
        } catch (error) {
            setMessage({ tone: 'error', text: inspectionErrorMessage(toDailyInspectionError(error).code, language) });
        } finally {
            setSaving(false);
        }
    };

    if (load.status === 'loading') {
        return (
            <p className="flex items-center gap-2 p-4 text-sm text-slate-500 dark:text-slate-400" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {copy.loading}
            </p>
        );
    }

    if (load.status === 'failed') {
        return (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100" role="alert">
                <p className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    {copy.loadFailed}
                </p>
                <button
                    type="button"
                    onClick={retry}
                    className="mt-2 inline-flex min-h-10 items-center rounded-xl border border-amber-300 bg-white px-3 text-sm font-medium text-amber-800 hover:bg-amber-50 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200"
                >
                    {copy.retry}
                </button>
            </div>
        );
    }

    const todayStatus = !todayRecord
        ? copy.todayMissing
        : todayRecord.issueCount > 0 ? copy.todayIssues(todayRecord.issueCount) : copy.todayDone(todayRecord.inspectorName);

    return (
        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white dark:border-slate-700 dark:bg-slate-800">
            <section className="p-4">
                <h3 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
                    <ClipboardCheck className="h-5 w-5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
                    {copy.title}
                </h3>
                <p className="mt-1 break-keep text-sm text-slate-600 dark:text-slate-300">{copy.intro}</p>
                <p
                    className={`mt-3 flex items-center gap-2 text-sm font-semibold ${!todayRecord
                        ? 'text-amber-700 dark:text-amber-300'
                        : todayRecord.issueCount > 0 ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}
                    role="status"
                >
                    {todayRecord && todayRecord.issueCount === 0
                        ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                        : <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />}
                    <span className="break-keep">{todayStatus}</span>
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        {copy.historyTitle(HISTORY_DAYS)} · {copy.historyRate(recordedDays, HISTORY_DAYS)}
                    </p>
                    {/* A quiet strip of recent days, oldest first; each dot names its date and result. */}
                    <ol className="flex items-center gap-1" aria-label={copy.historyTitle(HISTORY_DAYS)}>
                        {[...days].reverse().map((day) => {
                            const label = day.status === 'missing'
                                ? copy.historyMissing
                                : day.status === 'issues' ? `${copy.historyIssues} (${day.issueCount})` : copy.historyDone;
                            const tone = day.status === 'missing'
                                ? 'bg-slate-200 dark:bg-slate-600'
                                : day.status === 'issues' ? 'bg-red-500' : 'bg-emerald-500';
                            return (
                                <li key={day.date} title={`${day.date} · ${label}`} className={`h-2.5 w-2.5 rounded-full ${tone}`}>
                                    <span className="sr-only">{`${day.date} ${label}`}</span>
                                </li>
                            );
                        })}
                    </ol>
                </div>
            </section>

            {INSPECTION_SECTIONS.map((section) => (
                <section key={section.id} className="border-t border-slate-100 px-4 py-3 dark:border-slate-700">
                    <div className="flex items-center justify-between gap-2">
                        <h4 className="break-keep text-sm font-bold text-slate-900 dark:text-slate-100">{isKorean ? section.ko : section.en}</h4>
                        <button
                            type="button"
                            disabled={saving}
                            onClick={() => {
                                setMessage(null);
                                setResults((current) => setSectionResult(current, section.id, 'na'));
                            }}
                            className="min-h-10 shrink-0 whitespace-nowrap rounded-lg px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-60 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                        >
                            {copy.sectionNa}
                        </button>
                    </div>
                    <ul className="divide-y divide-slate-100 dark:divide-slate-700/70">
                        {section.items.map((item) => {
                            const text = isKorean ? item.ko : item.en;
                            return (
                                <li key={item.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                                    <span id={`inspection-${item.id}`} className="min-w-0 break-keep text-sm text-slate-800 dark:text-slate-200">{text}</span>
                                    <div
                                        className="flex shrink-0 gap-0.5 rounded-lg border border-slate-200 p-0.5 dark:border-slate-600"
                                        role="radiogroup"
                                        aria-labelledby={`inspection-${item.id}`}
                                    >
                                        {RESULT_ORDER.map((result) => {
                                            const selected = results[item.id] === result;
                                            return (
                                                <button
                                                    key={result}
                                                    type="button"
                                                    role="radio"
                                                    aria-checked={selected}
                                                    disabled={saving}
                                                    onClick={() => setItem(item.id, result)}
                                                    className={resultButtonClass(result, selected)}
                                                >
                                                    {inspectionResultLabel(result, language)}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            ))}

            <section className="border-t border-slate-100 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                    <span>{copy.note}</span>
                    <textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        maxLength={MAX_INSPECTION_NOTE_LENGTH}
                        rows={3}
                        disabled={saving}
                        placeholder={copy.notePlaceholder}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                    />
                </label>

                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
                        <span className="tabular-nums">{copy.progress(progress.answered, progress.total)}</span>
                        {progress.issues > 0 && <span className="font-semibold text-red-700 dark:text-red-300">{copy.issues(progress.issues)}</span>}
                        {!progress.complete && <span className="text-amber-700 dark:text-amber-300">{copy.incomplete(progress.missing.length)}</span>}
                    </p>
                    <div className="flex gap-2 sm:shrink-0">
                        {!progress.complete && (
                            <button
                                type="button"
                                disabled={saving}
                                onClick={() => {
                                    setMessage(null);
                                    setResults((current) => fillUnansweredAsOk(current));
                                }}
                                className="inline-flex min-h-11 flex-1 items-center justify-center whitespace-nowrap rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 sm:flex-none"
                            >
                                {copy.fillOk}
                            </button>
                        )}
                        <button
                            type="button"
                            disabled={!progress.complete || saving}
                            onClick={() => void save()}
                            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-blue-600 px-5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
                        >
                            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                            {saving ? copy.saving : todayRecord ? copy.update : copy.save}
                        </button>
                    </div>
                </div>

                {message && (
                    <p
                        className={`mt-3 text-sm font-medium ${message.tone === 'ok' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}
                        role={message.tone === 'ok' ? 'status' : 'alert'}
                    >
                        {message.text}
                    </p>
                )}
                <p className="mt-3 break-keep text-xs text-slate-500 dark:text-slate-400">{copy.legalNote}</p>
            </section>
        </div>
    );
};
