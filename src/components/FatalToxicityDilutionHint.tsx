import React from 'react';
import { useTranslation } from 'react-i18next';
import type { WasteComponent } from '../types';
import { assessFatalToxicityDilution, dilutedCategory } from '../utils/fatalToxicityDilution';

/**
 * One line under the concentration field, shown only where the concentration
 * changes the outcome: a fatal acute-toxicity substance that has a legal
 * dilution limit. Everything else renders nothing.
 */
export const FatalToxicityDilutionHint: React.FC<{ component: WasteComponent }> = ({ component }) => {
    const { t } = useTranslation();
    const dilution = assessFatalToxicityDilution(component);
    if (dilution.status === 'not_applicable' || dilution.status === 'no_limit') return null;

    const held = dilution.status === 'at_or_above' || dilution.status === 'not_solution';
    const messageKey = dilution.status === 'below'
        ? 'waste_fatal_dilution_below'
        : dilution.status === 'at_or_above'
            ? 'waste_fatal_dilution_at_or_above'
            : dilution.status === 'not_solution'
                ? 'waste_fatal_dilution_neat'
                : 'waste_fatal_dilution_prompt';
    const stream = t(dilutedCategory(component) === 'ACID'
        ? 'waste_fatal_dilution_stream_acid'
        : 'waste_fatal_dilution_stream_general');

    return (
        <p
            role="status"
            className={`rounded-lg px-3 py-2 text-xs font-medium leading-relaxed ${held
                ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100'
                : 'bg-blue-50 text-blue-900 dark:bg-blue-950/40 dark:text-blue-100'}`}
        >
            {t(messageKey, {
                limit: dilution.limit.percent,
                stream,
                solution: t('waste_material_form_solution'),
            })}
        </p>
    );
};
