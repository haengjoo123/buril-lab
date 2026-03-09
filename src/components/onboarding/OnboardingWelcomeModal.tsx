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
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/70 p-5 backdrop-blur-sm">
            <div className="w-full max-w-[420px] overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
                <div className="border-b border-slate-100 bg-gradient-to-br from-blue-50 via-white to-emerald-50 p-6 dark:border-slate-800 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">
                                {t('onboarding_welcome_badge')}
                            </p>
                            <h2 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
                                {t('onboarding_welcome_title')}
                            </h2>
                            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                {t('onboarding_welcome_desc')}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={skipOnboarding}
                            className="rounded-xl px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-white/80 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        >
                            {t('onboarding_skip_all')}
                        </button>
                    </div>
                </div>

                <div className="p-6">
                    <div className="flex items-start gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">
                            <StepIcon className="h-6 w-6" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                                {t('onboarding_step_counter', {
                                    current: stepIndex + 1,
                                    total: steps.length,
                                })}
                            </p>
                            <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                                {step.title}
                            </h3>
                            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                {step.description}
                            </p>
                        </div>
                    </div>

                    <ul className="mt-5 space-y-3 rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/80">
                        {step.points.map((point) => (
                            <li key={point} className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200">
                                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500 dark:bg-blue-400" />
                                <span>{point}</span>
                            </li>
                        ))}
                    </ul>

                    <div className="mt-5 flex items-center justify-center gap-2">
                        {steps.map((item, index) => (
                            <span
                                key={item.title}
                                className={`h-2 rounded-full transition-all ${index === stepIndex
                                    ? 'w-6 bg-blue-600 dark:bg-blue-400'
                                    : 'w-2 bg-slate-200 dark:bg-slate-700'
                                    }`}
                            />
                        ))}
                    </div>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4 dark:border-slate-800 dark:bg-slate-950/70">
                    <button
                        type="button"
                        onClick={() => setStepIndex((prev) => Math.max(prev - 1, 0))}
                        disabled={stepIndex === 0}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        {t('onboarding_prev')}
                    </button>

                    {isLastStep ? (
                        <button
                            type="button"
                            onClick={completeWelcome}
                            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                        >
                            {t('onboarding_finish')}
                            <ArrowRight className="h-4 w-4" />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setStepIndex((prev) => Math.min(prev + 1, steps.length - 1))}
                            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
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
