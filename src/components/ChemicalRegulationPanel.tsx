import React, { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Landmark, Loader2 } from 'lucide-react';
import { fetchChemicalRegulations } from '../services/chemicalRegulationService';
import {
    evaluateRegulationApplicability,
    hazardousRegulationEntries,
    type ChemicalRegulationCategory,
    type ChemicalRegulationLookup,
    type RegulationApplicability,
    type RegulationThreshold,
} from '../utils/chemicalRegulations';
import { normalizeCasNumber } from '../utils/casNumber';

interface ChemicalRegulationPanelProps {
    casNumber?: string | null;
    className?: string;
}

const DESCRIPTION_KEYS: Partial<Record<ChemicalRegulationCategory, string>> = {
    banned: 'regulation_desc_banned',
    restricted: 'regulation_desc_restricted',
    permitted: 'regulation_desc_permitted',
    accident_preparedness: 'regulation_desc_accident_preparedness',
    human_eco_hazard: 'regulation_desc_hazard',
    toxic: 'regulation_desc_hazard',
    acute_toxic: 'regulation_desc_hazard',
    chronic_toxic: 'regulation_desc_hazard',
    eco_toxic: 'regulation_desc_hazard',
};

const formatThresholds = (thresholds: RegulationThreshold[]) =>
    thresholds.map((threshold) => (threshold.label ? `${threshold.label} ${threshold.percent}%` : `${threshold.percent}%`)).join(' · ');

function parseConcentration(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

/**
 * 화학물질관리법 classification for one CAS number, explained in plain
 * language and checked against an optional solution concentration. Renders
 * nothing when the lookup is unavailable, so a missing data.go.kr key never
 * blocks the page.
 */
export const ChemicalRegulationPanel: React.FC<ChemicalRegulationPanelProps> = ({ casNumber, className = '' }) => {
    const { t } = useTranslation();
    const inputId = useId();
    const cas = normalizeCasNumber(casNumber);
    const [lookup, setLookup] = useState<{ cas: string; result: ChemicalRegulationLookup } | null>(null);
    const [concentrationInput, setConcentrationInput] = useState('');

    useEffect(() => {
        if (!cas) return;
        let cancelled = false;
        void fetchChemicalRegulations(cas).then((result) => {
            if (!cancelled) setLookup({ cas, result });
        });
        return () => { cancelled = true; };
    }, [cas]);

    if (!cas) return null;
    const result = lookup?.cas === cas ? lookup.result : null;
    if (result?.status === 'unavailable') return null;

    const record = result?.status === 'found' ? result.record : null;
    const hazardous = record ? hazardousRegulationEntries(record) : [];
    const concentration = parseConcentration(concentrationInput);
    const hasThresholds = hazardous.some((entry) => evaluateRegulationApplicability(entry).status !== 'always');

    const statusLabel = (applicability: RegulationApplicability) => {
        switch (applicability.status) {
            case 'always':
                return t('regulation_status_always');
            case 'unknown':
                return t('regulation_status_unknown', { thresholds: formatThresholds(applicability.thresholds) });
            case 'applies':
                return applicability.matched.some((threshold) => threshold.label)
                    ? t('regulation_status_applies_labels', { labels: formatThresholds(applicability.matched) })
                    : t('regulation_status_applies');
            case 'below':
                return t('regulation_status_below');
        }
    };

    return (
        <div className={`rounded-lg border border-slate-200 p-3 text-left dark:border-slate-800 ${className}`}>
            <h4 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                <Landmark className="h-4 w-4 text-slate-500" aria-hidden="true" />
                {t('regulation_title')}
            </h4>

            {!result ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    {t('regulation_loading')}
                </p>
            ) : hazardous.length > 0 ? (
                <>
                    {hasThresholds && (
                        <div className="mt-3">
                            <label htmlFor={inputId} className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                                {t('regulation_concentration_label')}
                            </label>
                            <div className="mt-1 flex items-center gap-1.5">
                                <input
                                    id={inputId}
                                    type="number"
                                    inputMode="decimal"
                                    min={0}
                                    max={100}
                                    step="any"
                                    value={concentrationInput}
                                    onChange={(event) => setConcentrationInput(event.target.value)}
                                    placeholder={t('regulation_concentration_placeholder')}
                                    className="min-h-11 w-28 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                />
                                <span className="text-sm text-slate-500 dark:text-slate-400">%</span>
                            </div>
                            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{t('regulation_concentration_help')}</p>
                        </div>
                    )}

                    <ul className="mt-3 space-y-2">
                        {hazardous.map((entry) => {
                            const applicability = evaluateRegulationApplicability(entry, concentration);
                            const below = applicability.status === 'below';
                            const descriptionKey = DESCRIPTION_KEYS[entry.category];
                            return (
                                <li
                                    key={`${entry.typeName}:${entry.uniqueNumber ?? ''}`}
                                    className={`rounded-lg border px-3 py-2 text-xs ${below
                                        ? 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50'
                                        : 'border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30'}`}
                                >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span>
                                            <span className={`font-bold ${below ? 'text-slate-600 dark:text-slate-300' : 'text-red-700 dark:text-red-300'}`}>
                                                {entry.typeName}
                                            </span>
                                            {entry.uniqueNumber && (
                                                <span className="ml-1.5 font-mono text-slate-500 dark:text-slate-400">{entry.uniqueNumber}</span>
                                            )}
                                        </span>
                                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${below
                                            ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200'
                                            : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200'}`}
                                        >
                                            {statusLabel(applicability)}
                                        </span>
                                    </div>
                                    {descriptionKey && (
                                        <p className="mt-1 text-slate-800 dark:text-slate-200">{t(descriptionKey)}</p>
                                    )}
                                    {entry.contentThreshold && (
                                        <p className="mt-1 text-slate-500 dark:text-slate-400">{entry.contentThreshold}</p>
                                    )}
                                    {entry.exception && (
                                        <p className="mt-1 text-slate-500 dark:text-slate-400">{entry.exception}</p>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </>
            ) : (
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                    {record ? t('regulation_none_hazardous') : t('regulation_not_found')}
                </p>
            )}

            {result && (
                <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
                    {t('regulation_disposal_note')}
                </p>
            )}
            {record?.keNumber && (
                <p className="mt-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    {t('regulation_ke_number', { value: record.keNumber })}
                </p>
            )}
            {result && result.status !== 'not_found' && (
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{t('regulation_source_note')}</p>
            )}
        </div>
    );
};
