import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface OnboardingGuideCardProps {
    icon: ReactNode;
    title: string;
    description: string;
    points: string[];
    onDismiss: () => void;
    className?: string;
}

export function OnboardingGuideCard({
    icon,
    title,
    description,
    points,
    onDismiss,
    className = '',
}: OnboardingGuideCardProps) {
    const { t } = useTranslation();

    return (
        <section className={`rounded-2xl border border-blue-200/70 dark:border-blue-800/60 bg-blue-50/90 dark:bg-slate-800/95 shadow-sm ${className}`}>
            <div className="p-4 sm:p-5">
                <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm dark:bg-slate-900 dark:text-blue-400">
                        {icon}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                    {title}
                                </h3>
                                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                    {description}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={onDismiss}
                                className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-white/70 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                                aria-label={t('onboarding_close_guide')}
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <ul className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-200">
                            {points.map((point) => (
                                <li key={point} className="flex items-start gap-2">
                                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500 dark:bg-blue-400" />
                                    <span>{point}</span>
                                </li>
                            ))}
                        </ul>

                        <div className="mt-4 flex justify-end">
                            <button
                                type="button"
                                onClick={onDismiss}
                                className="rounded-xl bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                            >
                                {t('onboarding_acknowledge')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
