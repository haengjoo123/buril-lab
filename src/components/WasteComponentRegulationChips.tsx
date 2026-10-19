import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Landmark } from 'lucide-react';
import type { WasteComponent } from '../types';
import { fetchChemicalRegulations } from '../services/chemicalRegulationService';
import { normalizeCasNumber } from '../utils/casNumber';
import type { ChemicalRegulationLookup } from '../utils/chemicalRegulations';
import { evaluateComponentRegulations, regulationConcentrationForComponent } from '../utils/wasteComponentRegulation';

/**
 * Legal classes (화학물질관리법) of one batch component, judged at its form and
 * concentration. Renders nothing when the substance has no hazardous class or
 * the lookup is unavailable.
 */
export const WasteComponentRegulationChips: React.FC<{ component: WasteComponent }> = ({ component }) => {
    const { t } = useTranslation();
    const cas = normalizeCasNumber(component.chemical.casNumber);
    const [lookup, setLookup] = useState<{ cas: string; result: ChemicalRegulationLookup } | null>(null);

    useEffect(() => {
        if (!cas) return;
        let cancelled = false;
        void fetchChemicalRegulations(cas).then((result) => {
            if (!cancelled) setLookup({ cas, result });
        });
        return () => { cancelled = true; };
    }, [cas]);

    const result = cas && lookup?.cas === cas ? lookup.result : null;
    if (result?.status !== 'found') return null;
    const evaluations = evaluateComponentRegulations(component, result.record);
    if (evaluations.length === 0) return null;
    const concentration = regulationConcentrationForComponent(component);

    return (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            <Landmark className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-label={t('regulation_title')} />
            {evaluations.map(({ entry, applicability }) => {
                const applies = applicability.status === 'applies' || applicability.status === 'always';
                const below = applicability.status === 'below';
                const statusKey = applies
                    ? 'waste_regulation_chip_applies'
                    : below
                        ? 'waste_regulation_chip_below'
                        : 'waste_regulation_chip_unknown';
                return (
                    <span
                        key={`${entry.typeName}:${entry.uniqueNumber ?? ''}`}
                        className={`rounded-full px-2 py-0.5 font-semibold ${applies
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200'
                            : below
                                ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'}`}
                    >
                        {t(statusKey, { name: entry.typeName })}
                    </span>
                );
            })}
            {concentration && (concentration.approximate || concentration.source === 'as_supplied') && (
                <span className="text-slate-500 dark:text-slate-400">
                    {t(concentration.source === 'as_supplied'
                        ? 'waste_regulation_basis_as_supplied'
                        : 'waste_regulation_basis_approximate')}
                </span>
            )}
        </div>
    );
};
