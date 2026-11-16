import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Landmark } from 'lucide-react';
import { isRegulationActionsEnabled } from '../config/featureFlags';
import { fetchChemicalRegulations } from '../services/chemicalRegulationService';
import {
    evaluateRegulationApplicability,
    hazardousRegulationEntries,
    type ChemicalRegulationCategory,
    type ChemicalRegulationEntry,
    type ChemicalRegulationLookup,
    type RegulationApplicability,
    type RegulationThreshold,
} from '../utils/chemicalRegulations';
import { normalizeCasNumber } from '../utils/casNumber';
import { obligationsForEntries, type RegulationObligation } from '../utils/regulationObligations';

type PanelVariant = 'actions' | 'classes';

interface ChemicalRegulationPanelProps {
    casNumber?: string | null;
    className?: string;
    /** Defaults to the release flag; tests pass it explicitly. */
    variant?: PanelVariant;
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

/** Classes that limit whether the substance may be used at all get the strongest tone. */
const USE_LIMITING_CATEGORIES: ReadonlySet<ChemicalRegulationCategory> = new Set(['banned', 'restricted', 'permitted']);

const formatThresholds = (thresholds: RegulationThreshold[]) =>
    thresholds.map((threshold) => (threshold.label ? `${threshold.label} ${threshold.percent}%` : `${threshold.percent}%`)).join(' · ');

function parseConcentration(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

const entryKey = (entry: ChemicalRegulationEntry) => `${entry.typeName}:${entry.uniqueNumber ?? ''}`;

/**
 * Hazardous 화학물질관리법 classes for one CAS number. Renders nothing while
 * loading, when the lookup is unavailable, or when the substance has no
 * hazardous class, so the page only shows what needs action.
 *
 * The `actions` variant leads with what the lab has to do and folds the class
 * names, thresholds, exceptions and legal sources into "근거 보기"; the
 * `classes` variant is the original class list.
 */
export const ChemicalRegulationPanel: React.FC<ChemicalRegulationPanelProps> = ({
    casNumber,
    className = '',
    variant = isRegulationActionsEnabled ? 'actions' : 'classes',
}) => {
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

    const Body = variant === 'actions' ? RegulationActions : RegulationClassList;
    return (
        <Body
            entries={hazardous}
            className={className}
            concentrationInput={concentrationInput}
            onConcentrationInput={setConcentrationInput}
        />
    );
};

interface BodyProps {
    entries: ChemicalRegulationEntry[];
    className: string;
    concentrationInput: string;
    onConcentrationInput: (value: string) => void;
}

function useStatusLabel() {
    const { t } = useTranslation();
    return (applicability: RegulationApplicability) => {
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
}

const ConcentrationInput: React.FC<{
    id: string;
    value: string;
    onChange: (value: string) => void;
    inputRef?: React.Ref<HTMLInputElement>;
}> = ({ id, value, onChange, inputRef }) => {
    const { t } = useTranslation();
    return (
        <label htmlFor={id} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            {t('regulation_concentration_label')}
            <input
                ref={inputRef}
                id={id}
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="any"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={t('regulation_concentration_placeholder')}
                className="min-h-9 w-20 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            %
        </label>
    );
};

/** The original layout: one red row per class with its status and description. */
const RegulationClassList: React.FC<BodyProps> = ({ entries, className, concentrationInput, onConcentrationInput }) => {
    const { t } = useTranslation();
    const inputId = useId();
    const statusLabel = useStatusLabel();
    const concentration = parseConcentration(concentrationInput);
    const hasThresholds = entries.some((entry) => evaluateRegulationApplicability(entry).status !== 'always');

    return (
        <div className={`rounded-lg border border-slate-200 p-3 text-left dark:border-slate-800 ${className}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                    <Landmark className="h-4 w-4 text-slate-500" aria-hidden="true" />
                    {t('regulation_title')}
                </h4>
                {hasThresholds && (
                    <ConcentrationInput id={inputId} value={concentrationInput} onChange={onConcentrationInput} />
                )}
            </div>

            <ul className="mt-2 space-y-1.5">
                {entries.map((entry) => {
                    const applicability = evaluateRegulationApplicability(entry, concentration);
                    const below = applicability.status === 'below';
                    const descriptionKey = DESCRIPTION_KEYS[entry.category];
                    return (
                        <li
                            key={entryKey(entry)}
                            className={`rounded-lg px-3 py-2 text-xs ${below
                                ? 'bg-slate-50 dark:bg-slate-800/50'
                                : 'bg-red-50 dark:bg-red-950/30'}`}
                        >
                            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                                <span className={`font-bold ${below ? 'text-slate-600 dark:text-slate-300' : 'text-red-700 dark:text-red-300'}`}>
                                    {entry.typeName}
                                </span>
                                <span className={`text-2xs font-semibold ${below ? 'text-slate-500 dark:text-slate-400' : 'text-red-700 dark:text-red-200'}`}>
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

            <p className="mt-2 text-2xs text-slate-500 dark:text-slate-400">{t('regulation_disposal_note')}</p>
        </div>
    );
};

const chipTone = (category: ChemicalRegulationCategory, below: boolean) => {
    if (below) return 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400';
    if (USE_LIMITING_CATEGORIES.has(category)) return 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300';
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200';
};

/** Action-first layout: what to do, with the legal basis folded away. */
const RegulationActions: React.FC<BodyProps> = ({ entries, className, concentrationInput, onConcentrationInput }) => {
    const { t, i18n } = useTranslation();
    const inputId = useId();
    const detailsRef = useRef<HTMLDetailsElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const statusLabel = useStatusLabel();
    const language = i18n.language?.startsWith('en') ? 'en' : 'ko';

    const concentration = parseConcentration(concentrationInput);
    const applicabilities = entries.map((entry) => ({ entry, applicability: evaluateRegulationApplicability(entry, concentration) }));
    const hasThresholds = applicabilities.some(({ entry }) => evaluateRegulationApplicability(entry).status !== 'always');
    const obligations = obligationsForEntries(entries, concentration);
    const allBelow = applicabilities.every(({ applicability }) => applicability.status === 'below');
    const conditionalPercents = Array.from(new Set(obligations.flatMap((obligation) => (
        obligation.condition.kind === 'concentration' ? [obligation.condition.lowestPercent] : []
    )))).sort((a, b) => a - b);
    // When every line waits on the same unknown concentration, say so once instead of on each line.
    const allConditional = obligations.length > 0 && conditionalPercents.length > 0
        && obligations.every((obligation) => obligation.condition.kind === 'concentration');

    const chips = Array.from(new Map(applicabilities.map(({ entry, applicability }) => [
        entry.typeName,
        { entry, below: applicability.status === 'below' },
    ])).values());

    // A class whose duties we have not confirmed against the legal text still
    // gets its plain description, so the card never goes silent about it.
    const coveredCategories = new Set(obligations.flatMap((obligation) => obligation.categories));
    const uncoveredDescriptions = Array.from(new Set(applicabilities
        .filter(({ entry, applicability }) => applicability.status !== 'below' && !coveredCategories.has(entry.category))
        .map(({ entry }) => DESCRIPTION_KEYS[entry.category])
        .filter((key): key is string => Boolean(key))));

    const openConcentration = () => {
        if (detailsRef.current) detailsRef.current.open = true;
        inputRef.current?.focus();
    };

    const sources = Array.from(new Map(obligations.map((obligation) => [obligation.source.citation, obligation.source])).values());

    return (
        <div className={`rounded-lg border border-slate-200 p-3 text-left dark:border-slate-800 ${className}`}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <h4 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                    <Landmark className="h-4 w-4 text-slate-500" aria-hidden="true" />
                    {t('regulation_actions_title')}
                </h4>
                <ul className="flex flex-wrap gap-1" aria-label={t('regulation_actions_classes')}>
                    {chips.map(({ entry, below }) => (
                        <li
                            key={entry.typeName}
                            className={`rounded-full border px-2 py-0.5 text-2xs font-semibold ${chipTone(entry.category, below)} ${below ? 'line-through' : ''}`}
                        >
                            {entry.typeName}
                        </li>
                    ))}
                </ul>
            </div>

            {allBelow ? (
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{t('regulation_actions_none_at_concentration')}</p>
            ) : (
                <>
                    <ul className="mt-2 space-y-1">
                        {obligations.map((obligation) => (
                            <ObligationLine
                                key={obligation.id}
                                obligation={obligation}
                                language={language}
                                showCondition={!allConditional}
                            />
                        ))}
                        {uncoveredDescriptions.map((key) => (
                            <li key={key} className="flex gap-2 text-xs text-slate-700 dark:text-slate-200">
                                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" aria-hidden="true" />
                                <span>{t(key)}</span>
                            </li>
                        ))}
                    </ul>
                    {conditionalPercents.length > 0 && (
                        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                            {allConditional && `${t('regulation_actions_condition_all', { threshold: formatPercentRange(conditionalPercents) })} `}
                            <button
                                type="button"
                                onClick={openConcentration}
                                className="font-semibold text-slate-600 underline underline-offset-2 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                            >
                                {t('regulation_actions_enter_concentration')}
                            </button>
                        </p>
                    )}
                </>
            )}

            <details ref={detailsRef} className="group mt-2">
                <summary className="cursor-pointer select-none text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                    {t('regulation_actions_basis')}
                </summary>
                <div className="mt-2 space-y-2 border-t border-slate-100 pt-2 text-xs dark:border-slate-800">
                    {hasThresholds && (
                        <ConcentrationInput id={inputId} value={concentrationInput} onChange={onConcentrationInput} inputRef={inputRef} />
                    )}
                    <ul className="space-y-1.5">
                        {applicabilities.map(({ entry, applicability }) => (
                            <li key={entryKey(entry)} className="text-slate-600 dark:text-slate-300">
                                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                                    <span className="font-semibold text-slate-800 dark:text-slate-100">
                                        {entry.typeName}
                                        {entry.uniqueNumber && (
                                            <span className="ml-1 font-normal text-slate-500 dark:text-slate-400">
                                                {t('regulation_actions_unique_number', { number: entry.uniqueNumber })}
                                            </span>
                                        )}
                                    </span>
                                    <span className="text-2xs font-semibold text-slate-500 dark:text-slate-400">{statusLabel(applicability)}</span>
                                </div>
                                {entry.exception && (
                                    <p className="mt-0.5">{`${t('regulation_actions_exception')}: ${entry.exception}`}</p>
                                )}
                                {(entry.noticeDate || entry.noticeInfo) && (
                                    <p className="mt-0.5 text-2xs text-slate-500 dark:text-slate-400">
                                        {[entry.noticeInfo, entry.noticeDate].filter(Boolean).join(' · ')}
                                    </p>
                                )}
                            </li>
                        ))}
                    </ul>
                    {sources.length > 0 && (
                        <div className="text-2xs text-slate-500 dark:text-slate-400">
                            <p className="font-semibold">{t('regulation_actions_sources')}</p>
                            <ul className="mt-0.5 space-y-0.5">
                                {sources.map((source) => (
                                    <li key={source.citation}>
                                        {source.url ? (
                                            <a href={source.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-slate-700 dark:hover:text-slate-200">
                                                {source.citation}
                                            </a>
                                        ) : source.citation}
                                        {` · ${t('regulation_actions_checked', { date: source.checkedAt })}`}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <p className="text-2xs text-slate-500 dark:text-slate-400">{t('regulation_disposal_note')}</p>
                </div>
            </details>
        </div>
    );
};

const formatPercentRange = (percents: number[]) => (
    percents.length === 1 ? `${percents[0]}%` : `${percents[0]}~${percents[percents.length - 1]}%`
);

const ObligationLine: React.FC<{
    obligation: RegulationObligation;
    language: 'ko' | 'en';
    showCondition: boolean;
}> = ({ obligation, language, showCondition }) => {
    const { t } = useTranslation();
    const conditional = obligation.condition.kind === 'concentration';
    return (
        <li className="flex gap-2 text-xs text-slate-800 dark:text-slate-100">
            <span
                className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${conditional ? 'bg-slate-300 dark:bg-slate-600' : 'bg-amber-500'}`}
                aria-hidden="true"
            />
            <span className={conditional ? 'text-slate-600 dark:text-slate-300' : ''}>
                {obligation.text[language]}
                {showCondition && obligation.condition.kind === 'concentration' && (
                    <span className="text-slate-500 dark:text-slate-400">
                        {` · ${t('regulation_actions_condition', { threshold: `${obligation.condition.lowestPercent}%` })}`}
                    </span>
                )}
            </span>
        </li>
    );
};
