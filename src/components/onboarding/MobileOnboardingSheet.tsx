import { Camera, CheckCircle2, Eye, FlaskConical, Package, Search, X } from 'lucide-react';
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
    const shouldShowIntro = mission === 'search' && completedCount === 0 && !hasSearchResult;
    const isKorean = document.documentElement.lang === 'ko';
    const SecondaryIcon = mission === 'search' ? Camera : Eye;

    return (
        <div className="pointer-events-none fixed inset-0 z-[45] lg:hidden">
            {shouldShowIntro && (
                <div className="absolute inset-x-0 top-[4.75rem] px-5">
                    <div className="rounded-[1.75rem] border border-blue-100 bg-white/95 p-5 shadow-2xl shadow-slate-950/10 backdrop-blur dark:border-blue-900/50 dark:bg-slate-900/95">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-600 dark:text-blue-300">
                                    3 min lab setup
                                </p>
                                <h2 className="mt-2 text-2xl font-black leading-tight text-slate-950 dark:text-white">
                                    {isKorean ? '찾고, 판단하고, 기록까지 이어가요.' : 'Search, decide, and keep a record.'}
                                </h2>
                            </div>
                            <button
                                type="button"
                                onClick={onSkip}
                                className="pointer-events-auto rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                                aria-label={isKorean ? '온보딩 건너뛰기' : 'Skip onboarding'}
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="mt-5 grid grid-cols-3 gap-2">
                            {[
                                { icon: Search, label: isKorean ? '검색' : 'Search' },
                                { icon: FlaskConical, label: isKorean ? '판단' : 'Disposal' },
                                { icon: Package, label: isKorean ? '재고' : 'Inventory' },
                            ].map((item) => {
                                const Icon = item.icon;
                                return (
                                    <div key={item.label} className="rounded-2xl bg-slate-50 p-3 text-center dark:bg-slate-800">
                                        <Icon className="mx-auto h-5 w-5 text-blue-600 dark:text-blue-300" />
                                        <p className="mt-2 text-[11px] font-bold text-slate-600 dark:text-slate-300">{item.label}</p>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            <div className="absolute bottom-[calc(4rem+env(safe-area-inset-bottom))] left-1/2 w-full max-w-[430px] -translate-x-1/2 px-3 pb-3">
                <div className="pointer-events-auto max-h-[calc(100dvh-9rem)] overflow-y-auto rounded-[1.65rem] border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700 dark:bg-slate-900">
                    <div className="h-1 bg-slate-100 dark:bg-slate-800">
                        <div
                            className="h-full rounded-r-full bg-blue-600 transition-all duration-300 dark:bg-blue-400"
                            style={{ width: `${Math.max(8, progressPercent)}%` }}
                        />
                    </div>
                    <div className="p-4">
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
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-blue-600 dark:text-blue-300">
                                            {copy.eyebrow}
                                        </p>
                                        <h3 className="mt-1 text-lg font-black leading-tight text-slate-950 dark:text-white">{copy.title}</h3>
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
                                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{copy.description}</p>
                                <div className="mt-4 flex gap-2">
                                    {copy.secondaryAction && onSecondaryAction && (
                                        <button
                                            type="button"
                                            onClick={onSecondaryAction}
                                            className="inline-flex h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                                        >
                                            <SecondaryIcon className="h-4 w-4" />
                                            {copy.secondaryAction}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={onPrimaryAction}
                                        className="h-11 flex-[1.35] whitespace-nowrap rounded-xl bg-blue-600 px-4 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition-colors hover:bg-blue-700"
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
