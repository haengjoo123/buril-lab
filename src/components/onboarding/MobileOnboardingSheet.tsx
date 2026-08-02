import { Camera, CheckCircle2, Eye, X } from 'lucide-react';
import type { OnboardingMissionKey } from '../../store/useOnboardingStore';

interface MissionCopy {
    eyebrow: string;
    title: string;
    description: string;
    primaryAction: string;
    secondaryAction?: string;
}

interface MobileOnboardingSheetProps {
    mission: OnboardingMissionKey;
    copy: MissionCopy;
    completedCount: number;
    totalCount: number;
    isAllComplete: boolean;
    hasSearchResult: boolean;
    onPrimaryAction: () => void;
    onSecondaryAction?: () => void;
    onFinish: () => void;
    onSkip: () => void;
}

export function MobileOnboardingSheet({
    mission,
    copy,
    completedCount,
    totalCount,
    isAllComplete,
    hasSearchResult,
    onPrimaryAction,
    onSecondaryAction,
    onFinish,
    onSkip,
}: MobileOnboardingSheetProps) {
    const progressPercent = Math.round((completedCount / totalCount) * 100);
    const isKorean = document.documentElement.lang === 'ko';
    const SecondaryIcon = mission === 'search' ? Camera : Eye;
    const shouldDockAtTop = mission === 'disposal' && hasSearchResult;

    return (
        <div className="pointer-events-none fixed inset-0 z-[45] lg:hidden">
            <div
                className={`absolute left-1/2 w-full max-w-[430px] -translate-x-1/2 px-3 ${shouldDockAtTop
                    ? 'top-[calc(4rem+env(safe-area-inset-top))] pt-2'
                    : 'bottom-[calc(4rem+env(safe-area-inset-bottom))] pb-2'
                    }`}
            >
                <div className="pointer-events-auto max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-[1.4rem] border border-slate-200 bg-white shadow-xl shadow-slate-950/15 dark:border-slate-700 dark:bg-slate-900">
                    <div className="h-1 bg-slate-100 dark:bg-slate-800">
                        <div
                            className="h-full rounded-r-full bg-blue-600 transition-all duration-300 dark:bg-blue-400"
                            style={{ width: `${Math.max(8, progressPercent)}%` }}
                        />
                    </div>
                    <div className="p-3.5 sm:p-4">
                        {isAllComplete ? (
                            <div className="text-center">
                                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
                                    <CheckCircle2 className="h-6 w-6" />
                                </div>
                                <h3 className="mt-3 text-lg font-black text-slate-950 dark:text-white">
                                    {isKorean ? '셋업을 마쳤어요' : 'Setup complete'}
                                </h3>
                                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                    {isKorean
                                        ? '폐기 판단 흐름과 시약장, 재고 업무 위치를 모두 확인했습니다.'
                                        : 'You have seen the safety decision flow and where cabinet and inventory work live.'}
                                </p>
                                <button
                                    type="button"
                                    onClick={onFinish}
                                    className="mt-4 h-11 w-full rounded-xl bg-slate-950 text-sm font-black text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
                                >
                                    {isKorean ? '작업 시작하기' : 'Start working'}
                                </button>
                            </div>
                        ) : (
                            <>
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-blue-600 dark:text-blue-300 sm:text-[11px] sm:tracking-[0.16em]">
                                            {copy.eyebrow}
                                            <span className="text-slate-400 dark:text-slate-500"> · 3 min setup</span>
                                        </p>
                                        <h3 className="mt-1 text-base font-black leading-tight text-slate-950 dark:text-white sm:text-lg">{copy.title}</h3>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={onSkip}
                                        className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                                        aria-label={isKorean ? '온보딩 건너뛰기' : 'Skip onboarding'}
                                    >
                                        <X className="h-5 w-5" />
                                    </button>
                                </div>
                                <p className="mt-1.5 line-clamp-2 text-[13px] leading-5 text-slate-600 dark:text-slate-300 sm:mt-2 sm:text-sm sm:leading-6">{copy.description}</p>
                                <div className="mt-3 flex gap-2 sm:mt-4">
                                    {copy.secondaryAction && onSecondaryAction && (
                                        <button
                                            type="button"
                                            onClick={onSecondaryAction}
                                            className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 sm:h-11 sm:text-sm"
                                        >
                                            <SecondaryIcon className="h-4 w-4" />
                                            {copy.secondaryAction}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={onPrimaryAction}
                                        className="h-10 min-w-0 flex-[1.35] whitespace-nowrap rounded-xl bg-blue-600 px-3 text-[13px] font-black text-white shadow-lg shadow-blue-600/20 transition-colors hover:bg-blue-700 sm:h-11 sm:px-4 sm:text-sm"
                                    >
                                        {copy.primaryAction}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
