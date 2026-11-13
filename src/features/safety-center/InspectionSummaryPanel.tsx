import React, { useEffect, useState } from 'react';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { safetyCenterService } from '../../services/safetyCenterService';
import { inspectionCopy } from '../dailyInspection/copy';
import type { SafetyCenterInspectionSummary } from './types';

interface InspectionSummaryPanelProps {
    centerId: string;
    language: string;
}

const PERIOD_DAYS = 30;

type PanelState =
    | { status: 'loading' }
    | { status: 'failed' }
    | { status: 'ready'; rows: SafetyCenterInspectionSummary[] };

/** Per-lab daily inspection counts for the labs a center may summarize. Item results stay in the lab. */
export const InspectionSummaryPanel: React.FC<InspectionSummaryPanelProps> = ({ centerId, language }) => {
    const copy = inspectionCopy(language);
    const [loaded, setLoaded] = useState<{ centerId: string; state: PanelState } | null>(null);

    useEffect(() => {
        let cancelled = false;
        safetyCenterService.getInspectionSummary(centerId, PERIOD_DAYS)
            .then((rows) => {
                if (!cancelled) setLoaded({ centerId, state: { status: 'ready', rows } });
            })
            .catch((error) => {
                console.error('Failed to load the inspection summary:', error);
                if (!cancelled) setLoaded({ centerId, state: { status: 'failed' } });
            });
        return () => {
            cancelled = true;
        };
    }, [centerId]);

    const state: PanelState = loaded?.centerId === centerId ? loaded.state : { status: 'loading' };

    return (
        <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                {copy.centerTitle}
            </h3>
            <p className="mt-1 break-keep text-xs text-slate-500 dark:text-slate-400">{copy.centerHelp(PERIOD_DAYS)}</p>

            {state.status === 'loading' && (
                <p className="mt-3 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400" role="status">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {copy.centerLoading}
                </p>
            )}
            {state.status === 'failed' && (
                <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">{copy.centerFailed}</p>
            )}
            {state.status === 'ready' && state.rows.length === 0 && (
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{copy.centerEmpty}</p>
            )}
            {state.status === 'ready' && state.rows.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[28rem] text-left text-sm">
                        <thead className="text-xs text-slate-500 dark:text-slate-400">
                            <tr>
                                <th scope="col" className="py-2 pr-3 font-semibold">{copy.centerLab}</th>
                                <th scope="col" className="py-2 pr-3 font-semibold">{copy.centerDays}</th>
                                <th scope="col" className="py-2 pr-3 font-semibold">{copy.centerIssueDays}</th>
                                <th scope="col" className="py-2 font-semibold">{copy.centerLast}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {state.rows.map((row) => {
                                const inspected = Number(row.inspected_days) || 0;
                                const issueDays = Number(row.issue_days) || 0;
                                const period = Number(row.period_days) || PERIOD_DAYS;
                                return (
                                    <tr key={row.lab_id}>
                                        <th scope="row" className="break-words py-2 pr-3 font-medium text-slate-900 dark:text-slate-100">{row.lab_name}</th>
                                        <td className="py-2 pr-3 tabular-nums text-slate-700 dark:text-slate-200">
                                            {inspected} / {period}
                                        </td>
                                        <td className={`py-2 pr-3 tabular-nums ${issueDays > 0 ? 'font-semibold text-red-700 dark:text-red-300' : 'text-slate-700 dark:text-slate-200'}`}>
                                            {issueDays}
                                        </td>
                                        <td className="py-2 tabular-nums text-slate-700 dark:text-slate-200">
                                            {row.last_inspection_date ? String(row.last_inspection_date).slice(0, 10) : copy.centerNever}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
};
