import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Landmark, Loader2 } from 'lucide-react';
import { fetchChemicalRegulations } from '../services/chemicalRegulationService';
import {
    hazardousRegulationEntries,
    type ChemicalRegulationLookup,
} from '../utils/chemicalRegulations';
import { normalizeCasNumber } from '../utils/casNumber';

interface ChemicalRegulationPanelProps {
    casNumber?: string | null;
    className?: string;
}

/**
 * 화학물질관리법 classification for one CAS number. Renders nothing when the
 * lookup is unavailable, so a missing data.go.kr key never blocks the page.
 */
export const ChemicalRegulationPanel: React.FC<ChemicalRegulationPanelProps> = ({ casNumber, className = '' }) => {
    const { t } = useTranslation();
    const cas = normalizeCasNumber(casNumber);
    const [lookup, setLookup] = useState<{ cas: string; result: ChemicalRegulationLookup } | null>(null);

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
                <ul className="mt-3 space-y-2">
                    {hazardous.map((entry) => (
                        <li
                            key={`${entry.typeName}:${entry.uniqueNumber ?? ''}`}
                            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs dark:border-red-900/60 dark:bg-red-950/30"
                        >
                            <span className="font-bold text-red-700 dark:text-red-300">{entry.typeName}</span>
                            {entry.uniqueNumber && (
                                <span className="ml-1.5 font-mono text-red-600/80 dark:text-red-300/80">{entry.uniqueNumber}</span>
                            )}
                            {entry.contentThreshold && (
                                <p className="mt-1 text-slate-700 dark:text-slate-300">{entry.contentThreshold}</p>
                            )}
                            {entry.exception && (
                                <p className="mt-1 text-slate-500 dark:text-slate-400">{entry.exception}</p>
                            )}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                    {record ? t('regulation_none_hazardous') : t('regulation_not_found')}
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
