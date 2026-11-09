import { ChevronDown, ExternalLink, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DisposalGuideResult } from '../services/aiDisposalGuideService';
import { getDisposalGuideChecks, isStandardLabelRequirement } from './disposalGuidePresentation';

interface DisposalGuidePanelProps {
    result: DisposalGuideResult;
    componentNames: string;
    amount: string;
    hazards: string[];
    hazardsNeedReview: boolean;
}

export function DisposalGuidePanel({ result, componentNames, amount, hazards, hazardsNeedReview }: DisposalGuidePanelProps) {
    const { t } = useTranslation();
    const canDeposit = result.decisionStatus === 'ready' && result.destination.depositAllowed;
    const checks = getDisposalGuideChecks(result);
    const labelRequirements = result.destination.labelInstructions.filter((item) => !isStandardLabelRequirement(item));
    const showSummary = Boolean(result.summary.trim()) && (
        result.availability !== 'unavailable' || result.summary.trim() !== t('waste_ai_unavailable').trim()
    );

    return (
        <div className="min-w-0 space-y-5 text-sm leading-relaxed text-slate-700 [overflow-wrap:anywhere] dark:text-slate-200">
            {result.availability === 'unavailable' && (
                <p role="status" className="rounded-xl bg-slate-100 p-3 dark:bg-slate-900">{t('waste_ai_unavailable')}</p>
            )}
            {!canDeposit && showSummary && (
                <p className="rounded-xl border border-orange-200 bg-orange-50 p-3 font-semibold text-orange-950 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-100">{result.summary}</p>
            )}
            {canDeposit && (
                <section className="rounded-xl border border-slate-200 p-3 dark:border-slate-800 wide:p-4" aria-label={t('waste_ai_destination')}>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t('waste_destination')}</p>
                    <p className="mt-1 text-base font-bold text-slate-950 dark:text-white">{result.destination.name}</p>
                    <p className="mt-1 flex items-start gap-1.5 text-slate-500 dark:text-slate-400">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="min-w-0">{result.destination.location || t('waste_ai_location_unregistered')}</span>
                    </p>
                    <h4 className="mt-4 border-t border-slate-200 pt-3 font-bold text-slate-950 dark:border-slate-800 dark:text-white">{t('waste_ai_label_title')}</h4>
                    <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
                        <dt className="text-slate-500 dark:text-slate-400">{t('waste_label_component_names')}</dt>
                        <dd>{componentNames || t('waste_label_value_not_entered')}</dd>
                        <dt className="text-slate-500 dark:text-slate-400">{t('waste_label_total_amount')}</dt>
                        <dd>{amount}</dd>
                        <dt className="text-slate-500 dark:text-slate-400">{t('waste_label_main_hazards')}</dt>
                        <dd>{hazards.length > 0 ? hazards.join(', ') : t(hazardsNeedReview ? 'waste_label_hazards_need_review' : 'waste_label_no_known_hazards')}</dd>
                    </dl>
                    {labelRequirements.length > 0 && (
                        <div className="mt-3">
                            <p className="font-semibold">{t('waste_label_additional_requirements')}</p>
                            <ul className="mt-1 list-disc space-y-1 pl-5">
                                {labelRequirements.map((item) => <li key={item}>{item}</li>)}
                            </ul>
                        </div>
                    )}
                </section>
            )}
            {checks.length > 0 && (
                <section aria-label={t('waste_ai_checks')}>
                    <h4 className="font-bold text-slate-950 dark:text-white">{t('waste_ai_checks')}</h4>
                    <ol className="mt-2 space-y-3">
                        {checks.map((step, index) => (
                            <li key={step} className="flex items-start gap-2.5">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">{index + 1}</span>
                                <span className="min-w-0 flex-1">{step}</span>
                            </li>
                        ))}
                    </ol>
                </section>
            )}
            {result.prohibitions.length > 0 && (
                <section className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-orange-950 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-100" aria-label={t('waste_ai_prohibitions')}>
                    <h4 className="font-bold">{t('waste_ai_prohibitions')}</h4>
                    <ul className="mt-2 list-disc space-y-2 pl-5">
                        {result.prohibitions.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                </section>
            )}
            {((canDeposit && showSummary) || result.evidence.length > 0) && (
                <details className="group border-t border-slate-200 dark:border-slate-800">
                    <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
                        {t('waste_ai_explanation')}
                        <ChevronDown className="h-4 w-4 shrink-0 group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    {canDeposit && showSummary && <p className="mt-1">{result.summary}</p>}
                    {result.evidence.length > 0 && (
                        <div className="mt-3">
                            <h4 className="font-semibold">{t('waste_ai_evidence')}</h4>
                            <ul className="mt-1 space-y-2">
                                {result.evidence.map((evidence) => (
                                    <li key={evidence.id}>
                                        {evidence.reference?.startsWith('https://') ? (
                                            <a href={evidence.reference} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 underline">
                                                {evidence.title}<ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                                            </a>
                                        ) : evidence.title}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </details>
            )}
        </div>
    );
}
