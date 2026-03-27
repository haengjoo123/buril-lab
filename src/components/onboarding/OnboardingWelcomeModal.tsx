import { useMemo, useState } from 'react';
import {
    ArrowLeft,
    ArrowRight,
    Archive,
    Boxes,
    FlaskConical,
    Search,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useOnboardingStore } from '../../store/useOnboardingStore';

export function OnboardingWelcomeModal() {
    const { t } = useTranslation();
    const completeWelcome = useOnboardingStore((state) => state.completeWelcome);
    const skipOnboarding = useOnboardingStore((state) => state.skipOnboarding);
    const [stepIndex, setStepIndex] = useState(0);

    const steps = useMemo(
        () => [
            {
                icon: FlaskConical,
                title: t('onboarding_welcome_step_1_title'),
                description: t('onboarding_welcome_step_1_desc'),
                points: [
                    t('onboarding_welcome_step_1_point_1'),
                    t('onboarding_welcome_step_1_point_2'),
                    t('onboarding_welcome_step_1_point_3'),
                ],
            },
            {
                icon: Search,
                title: t('onboarding_welcome_step_2_title'),
                description: t('onboarding_welcome_step_2_desc'),
                points: [
                    t('onboarding_welcome_step_2_point_1'),
                    t('onboarding_welcome_step_2_point_2'),
                    t('onboarding_welcome_step_2_point_3'),
                ],
            },
            {
                icon: Archive,
                title: t('onboarding_welcome_step_3_title'),
                description: t('onboarding_welcome_step_3_desc'),
                points: [
                    t('onboarding_welcome_step_3_point_1'),
                    t('onboarding_welcome_step_3_point_2'),
                    t('onboarding_welcome_step_3_point_3'),
                ],
            },
            {
                icon: Boxes,
                title: t('onboarding_welcome_step_4_title'),
                description: t('onboarding_welcome_step_4_desc'),
                points: [
                    t('onboarding_welcome_step_4_point_1'),
                    t('onboarding_welcome_step_4_point_2'),
                    t('onboarding_welcome_step_4_point_3'),
                ],
            },
        ],
        [t]
    );

    const step = steps[stepIndex];
    const StepIcon = step.icon;
    const isLastStep = stepIndex === steps.length - 1;

    return (
        <div className="fixed inset-0 z-[110] flex flex-col items-center justify-center bg-slate-950/70 p-4 transition-all duration-300 backdrop-blur-sm overflow-y-auto cursor-default sm:p-6">
            <div className="relative my-auto w-full max-w-[420px] overflow-hidden rounded-[2rem] bg-white shadow-2xl transition-all dark:bg-slate-900 ring-1 ring-black/5 dark:ring-white/10 flex flex-col max-h-[90vh]">
                <div className="shrink-0 border-b border-slate-100 bg-gradient-to-br from-blue-50 via-white to-emerald-50 p-5 dark:border-slate-800 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 sm:p-6">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">
                                {t('onboarding_welcome_badge')}
                            </p>
                            <h2 className="mt-1.5 text-xl font-bold leading-tight text-slate-900 dark:text-white sm:text-2xl">
                                {t('onboarding_welcome_title')}
                            </h2>
                            <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300 sm:text-sm">
                                {t('onboarding_welcome_desc')}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={skipOnboarding}
                            className="shrink-0 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition-all hover:bg-white/80 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        >
                            {t('onboarding_skip_all')}
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800 p-5 sm:p-6">
                    <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300 sm:h-12 sm:w-12">
                            <StepIcon className="h-5 w-5 sm:h-6 sm:w-6" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                                {t('onboarding_step_counter', {
                                    current: stepIndex + 1,
                                    total: steps.length,
                                })}
                            </p>
                            <h3 className="mt-1 text-base font-bold text-slate-900 dark:text-white sm:text-lg">
                                {step.title}
                            </h3>
                            <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300 sm:text-sm sm:leading-6">
                                {step.description}
                            </p>
                        </div>
                    </div>

                    <ul className="mt-5 space-y-2.5 rounded-2xl bg-slate-50/50 p-4 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800/50">
                        {step.points.map((point) => (
                            <li key={point} className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-200 sm:text-sm">
                                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500 dark:bg-blue-400" />
                                <span className="leading-relaxed">{point}</span>
                            </li>
                        ))}
                    </ul>

                    <div className="mt-6 flex items-center justify-center gap-2">
                        {steps.map((item, index) => (
                            <span
                                key={item.title}
                                className={`h-1.5 rounded-full transition-all duration-300 ${index === stepIndex
                                    ? 'w-6 bg-blue-600 dark:bg-blue-400'
                                    : 'w-1.5 bg-slate-200 dark:bg-slate-700'
                                    }`}
                            />
                        ))}
                    </div>
                </div>

                <div className="shrink-0 flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/80 px-5 py-4 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/70 sm:px-6">
                    <button
                        type="button"
                        onClick={() => setStepIndex((prev) => Math.max(prev - 1, 0))}
                        disabled={stepIndex === 0}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 transition-all hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 sm:text-sm"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        {t('onboarding_prev')}
                    </button>

                    {isLastStep ? (
                        <button
                            type="button"
                            onClick={completeWelcome}
                            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-700 active:scale-95 sm:text-sm"
                        >
                            {t('onboarding_finish')}
                            <ArrowRight className="h-4 w-4" />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setStepIndex((prev) => Math.min(prev + 1, steps.length - 1))}
                            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-slate-900/10 transition-all hover:bg-slate-800 active:scale-95 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white sm:text-sm"
                        >
                            {t('onboarding_next')}
                            <ArrowRight className="h-4 w-4" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
