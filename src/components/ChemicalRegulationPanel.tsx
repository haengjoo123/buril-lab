import React, { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Landmark } from 'lucide-react';
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
 * Hazardous 화학물질관리법 classes for one CAS number, each with a plain
 * description and a status that an optional solution concentration decides.
 * Renders nothing while loading, when the lookup is unavailable, or when the
 * substance has no hazardous class, so the page only shows what needs action.
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

    const result = cas && lookup?.cas === cas ? lookup.result : null;
    const hazardous = result?.status === 'found' ? hazardousRegulationEntries(result.record) : [];
    if (hazardous.length === 0) return null;

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
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                    <Landmark className="h-4 w-4 text-slate-500" aria-hidden="true" />
                    {t('regulation_title')}
                </h4>
                {hasThresholds && (
                    <label htmlFor={inputId} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                        {t('regulation_concentration_label')}
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
                            className="min-h-9 w-20 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        />
                        %
                    </label>
                )}
            </div>

            <ul className="mt-2 space-y-1.5">
                {hazardous.map((entry) => {
                    const applicability = evaluateRegulationApplicability(entry, concentration);
                    const below = applicability.status === 'below';
                    const descriptionKey = DESCRIPTION_KEYS[entry.category];
                    return (
                        <li
                            key={`${entry.typeName}:${entry.uniqueNumber ?? ''}`}
                            className={`rounded-lg px-3 py-2 text-xs ${below
                                ? 'bg-slate-50 dark:bg-slate-800/50'
                                : 'bg-red-50 dark:bg-red-950/30'}`}
                        >
                            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                                <span className={`font-bold ${below ? 'text-slate-600 dark:text-slate-300' : 'text-red-700 dark:text-red-300'}`}>
                                    {entry.typeName}
                                </span>
                                <span className={`text-[11px] font-semibold ${below ? 'text-slate-500 dark:text-slate-400' : 'text-red-700 dark:text-red-200'}`}>
                                    {statusLabel(applicability)}
                                </span>
                            </div>
                            {descriptionKey && (
                                <p className="mt-0.5 text-slate-600 dark:text-slate-300">{t(descriptionKey)}</p>
                            )}
                        </li>
                    );
                })}
            </ul>

            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{t('regulation_disposal_note')}</p>
        </div>
    );
};
