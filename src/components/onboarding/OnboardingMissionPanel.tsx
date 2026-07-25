import { useEffect, useMemo, useRef } from 'react';
import {
    ArrowRight,
    Boxes,
    CheckCircle2,
    ClipboardCheck,
    Eye,
    FlaskConical,
    Package,
    Search,
    X,
} from 'lucide-react';
import resultGuideImage from '../../assets/gateway/buril-result-guide.png';
import cabinetImage from '../../assets/gateway/buril-3d-cabinet.png';
import inventoryImage from '../../assets/gateway/buril-waste-logs.png';
import type { AppTab } from '../../hooks/useAppUiState';
import {
    ONBOARDING_MISSION_ORDER,
    type OnboardingMissionKey,
    useOnboardingStore,
} from '../../store/useOnboardingStore';
import { analyticsService } from '../../services/analyticsService';
import { MobileOnboardingSheet } from './MobileOnboardingSheet';
import { OnboardingSpotlight } from './OnboardingSpotlight';

interface OnboardingMissionPanelProps {
    activeTab: AppTab;
    cartCount: number;
    hasSearchResult: boolean;
    isNativeApp: boolean;
    onRunSampleSearch: () => void;
    onOpenScanner: () => void;
    onNavigateTab: (tab: AppTab) => void;
}

interface MissionCopy {
    eyebrow: string;
    title: string;
    description: string;
    primaryAction: string;
    secondaryAction?: string;
    doneLabel: string;
    imageAlt: string;
}

const missionIconByKey = {
    search: Search,
    disposal: FlaskConical,
    cabinet: Boxes,
    inventory: Package,
} satisfies Record<OnboardingMissionKey, typeof Search>;

const missionToneByKey = {
    search: 'blue',
    disposal: 'sky',
    cabinet: 'indigo',
    inventory: 'emerald',
} satisfies Record<OnboardingMissionKey, 'blue' | 'sky' | 'indigo' | 'emerald'>;

const missionImageByKey = {
    search: resultGuideImage,
    disposal: resultGuideImage,
    cabinet: cabinetImage,
    inventory: inventoryImage,
} satisfies Record<OnboardingMissionKey, string>;

function getCopy(isKorean: boolean): Record<OnboardingMissionKey, MissionCopy> {
    if (isKorean) {
        return {
            search: {
                eyebrow: 'Mission 1 / 4',
                title: '시약을 검색해 첫 판단까지 가기',
                description: '예시 시약으로 바로 검색하거나 직접 입력해 보세요. 결과가 뜨는 순간 폐기 분류와 MSDS 흐름을 확인할 수 있습니다.',
                primaryAction: 'Acetone 검색',
                secondaryAction: '스캔 시작',
                doneLabel: '검색 결과 확인',
                imageAlt: '폐기 판단 결과 예시',
            },
            disposal: {
                eyebrow: 'Mission 2 / 4',
                title: 'MSDS와 위험정보를 보고 리스트에 담기',
                description: '결과 카드에서 MSDS, GHS, 폐기 분류를 확인한 뒤 리스트에 담아 기록 흐름으로 이어가세요.',
                primaryAction: '담기 버튼 찾기',
                secondaryAction: 'MSDS 보기',
                doneLabel: '폐기 리스트 담기',
                imageAlt: 'MSDS와 폐기 가이드 예시',
            },
            cabinet: {
                eyebrow: 'Mission 3 / 4',
                title: '시약장 화면에서 공간 흐름 이해하기',
                description: '시약장은 보기, 편집, 배치 모드로 나뉩니다. 실제 보관 공간처럼 위치와 호환성을 확인하는 흐름입니다.',
                primaryAction: '시약장으로 이동',
                doneLabel: '시약장 진입',
                imageAlt: '3D 시약장 예시',
            },
            inventory: {
                eyebrow: 'Mission 4 / 4',
                title: '재고 탭에서 운영 도구 확인하기',
                description: '재고에서는 검색, CSV 등록, 일괄 이동을 처리합니다. 실제 변경은 명시적으로 실행할 때만 일어납니다.',
                primaryAction: '재고로 이동',
                doneLabel: '재고 허브 확인',
                imageAlt: '기록과 재고 운영 예시',
            },
        };
    }

    return {
        search: {
            eyebrow: 'Mission 1 / 4',
            title: 'Search a reagent and reach the first decision',
            description: 'Try the sample reagent or type your own. The result card shows the disposal category and MSDS flow.',
            primaryAction: 'Try Acetone',
            secondaryAction: 'Scan label',
            doneLabel: 'Search result viewed',
            imageAlt: 'Example disposal result',
        },
        disposal: {
            eyebrow: 'Mission 2 / 4',
            title: 'Review safety details and add it to the list',
            description: 'Check MSDS, GHS, and the disposal category, then add the item to continue toward record keeping.',
            primaryAction: 'Find add button',
            secondaryAction: 'Open MSDS',
            doneLabel: 'Added to disposal list',
            imageAlt: 'MSDS and disposal guide example',
        },
        cabinet: {
            eyebrow: 'Mission 3 / 4',
            title: 'Understand the cabinet workspace',
            description: 'Cabinets split viewing, editing, and placement so a virtual layout behaves like real lab storage.',
            primaryAction: 'Go to cabinet',
            doneLabel: 'Cabinet opened',
            imageAlt: '3D cabinet example',
        },
        inventory: {
            eyebrow: 'Mission 4 / 4',
            title: 'Find the inventory operations hub',
            description: 'Inventory handles search, CSV registration, and bulk moves. Changes only happen after explicit actions.',
            primaryAction: 'Go to inventory',
            doneLabel: 'Inventory hub viewed',
            imageAlt: 'Inventory operations example',
        },
    };
}

function getSpotlightSelector(mission: OnboardingMissionKey, activeTab: AppTab, hasSearchResult: boolean): string | undefined {
    if (mission === 'search') return '[data-onboarding-target="search-box"]';
    if (mission === 'disposal') {
        return hasSearchResult ? '[data-onboarding-target="add-to-list-button"]' : '[data-onboarding-target="search-box"]';
    }
    if (mission === 'cabinet') {
        return activeTab === 'cabinet'
            ? '[data-onboarding-target="cabinet-mode-switcher"], [data-onboarding-target="cabinet-list-header"]'
            : '[data-onboarding-target="nav-cabinet"]';
    }
    if (mission === 'inventory') {
        return activeTab === 'inventory'
            ? '[data-onboarding-target="inventory-tools"]'
            : '[data-onboarding-target="nav-inventory"]';
    }
    return undefined;
}

function getPlatform(isNativeApp: boolean) {
    return isNativeApp ? 'native' : 'web';
}

function clickTarget(selector: string): boolean {
    const target = document.querySelector<HTMLElement>(selector);
    if (!target) return false;

    target?.click();
    target?.focus();
    return true;
}

export function OnboardingMissionPanel({
    activeTab,
    cartCount,
    hasSearchResult,
    isNativeApp,
    onRunSampleSearch,
    onOpenScanner,
    onNavigateTab,
}: OnboardingMissionPanelProps) {
    const currentMission = useOnboardingStore((state) => state.currentMission);
    const completedMissions = useOnboardingStore((state) => state.completedMissions);
    const finishOnboarding = useOnboardingStore((state) => state.finishOnboarding);
    const skipOnboarding = useOnboardingStore((state) => state.skipOnboarding);

    const isKorean = document.documentElement.lang === 'ko';
    const copyByMission = useMemo(() => getCopy(isKorean), [isKorean]);
    const missionCopy = useMemo(() => {
        const copy = copyByMission[currentMission];
        if (currentMission !== 'disposal' || hasSearchResult) return copy;

        return {
            ...copy,
            description: isKorean
                ? '먼저 예시 시약을 검색해 결과 카드를 열어 주세요. 카드에서 MSDS와 폐기 분류를 확인한 뒤 리스트에 담을 수 있습니다.'
                : 'Search the sample reagent first to open its result card. You can then review MSDS and disposal guidance before adding it.',
            primaryAction: isKorean ? 'Acetone 다시 검색' : 'Search Acetone first',
            secondaryAction: undefined,
        };
    }, [copyByMission, currentMission, hasSearchResult, isKorean]);
    const completedCount = ONBOARDING_MISSION_ORDER.filter((mission) => completedMissions[mission]).length;
    const totalCount = ONBOARDING_MISSION_ORDER.length;
    const isAllComplete = completedCount === totalCount;
    const spotlightSelector = getSpotlightSelector(currentMission, activeTab, hasSearchResult);
    const platform = getPlatform(isNativeApp);
    const trackedShownMissionsRef = useRef<Set<OnboardingMissionKey>>(new Set());

    useEffect(() => {
        if (trackedShownMissionsRef.current.has(currentMission)) return;
        trackedShownMissionsRef.current.add(currentMission);

        void analyticsService.trackOnboardingEvent({
            eventType: 'shown',
            stepKey: currentMission,
            sourceScreen: activeTab,
            platform,
            metadata: {
                cart_count: cartCount,
            },
        });
    }, [activeTab, cartCount, currentMission, platform]);

    const handlePrimaryAction = () => {
        if (isAllComplete) {
            finishOnboarding();
            return;
        }

        if (currentMission === 'search') {
            onRunSampleSearch();
            return;
        }

        if (currentMission === 'disposal') {
            if (!hasSearchResult || !clickTarget('[data-onboarding-target="add-to-list-button"]')) {
                onRunSampleSearch();
            }
            return;
        }

        if (currentMission === 'cabinet') {
            onNavigateTab('cabinet');
            return;
        }

        onNavigateTab('inventory');
    };

    const handleSecondaryAction = () => {
        if (currentMission === 'search') {
            onOpenScanner();
            return;
        }

        if (currentMission === 'disposal') {
            clickTarget('[data-onboarding-target="msds-button"]');
        }
    };

    const handleSkip = () => {
        skipOnboarding();
        void analyticsService.trackOnboardingEvent({
            eventType: 'skipped',
            stepKey: currentMission,
            sourceScreen: activeTab,
            platform,
            metadata: {
                completed_count: completedCount,
            },
        });
    };

    const handleFinish = () => {
        finishOnboarding();
    };

    return (
        <>
            <OnboardingSpotlight
                selector={spotlightSelector}
                title={missionCopy.title}
                description={missionCopy.description}
            />

            <aside className="pointer-events-auto fixed bottom-6 right-6 top-20 z-[45] hidden w-[370px] flex-col rounded-[1.75rem] border border-slate-200 bg-white shadow-2xl shadow-slate-950/15 dark:border-slate-800 dark:bg-slate-900 lg:flex">
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
                    <div>
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-600 dark:text-blue-300">
                            Live onboarding
                        </p>
                        <h2 className="mt-1 text-2xl font-black leading-tight text-slate-950 dark:text-white">
                            {isKorean ? '3분 연구실 셋업' : '3-minute lab setup'}
                        </h2>
                    </div>
                    {!isAllComplete && (
                        <button
                            type="button"
                            onClick={handleSkip}
                            className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            aria-label={isKorean ? '온보딩 건너뛰기' : 'Skip onboarding'}
                        >
                            <X className="h-5 w-5" />
                        </button>
                    )}
                </div>

                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
                    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
                        <img
                            src={missionImageByKey[currentMission]}
                            alt={missionCopy.imageAlt}
                            className="h-32 w-full object-cover object-top"
                        />
                    </div>

                    <div className="mt-5">
                        <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
                            <span>{completedCount} / {totalCount}</span>
                            <span>{Math.round((completedCount / totalCount) * 100)}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                            <div
                                className="h-full rounded-full bg-blue-600 transition-all duration-300 dark:bg-blue-400"
                                style={{ width: `${Math.max(8, (completedCount / totalCount) * 100)}%` }}
                            />
                        </div>
                    </div>

                    <ol className="order-4 mt-5 space-y-2">
                        {ONBOARDING_MISSION_ORDER.map((mission) => {
                            const Icon = missionIconByKey[mission];
                            const isComplete = Boolean(completedMissions[mission]);
                            const isCurrent = currentMission === mission && !isAllComplete;
                            const tone = missionToneByKey[mission];

                            return (
                                <li
                                    key={mission}
                                    className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors ${isCurrent
                                        ? 'border-blue-200 bg-blue-50 dark:border-blue-900/60 dark:bg-blue-950/30'
                                        : 'border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900'
                                        }`}
                                >
                                    <span
                                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${isComplete
                                            ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300'
                                            : tone === 'emerald'
                                                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300'
                                                : 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300'
                                            }`}
                                    >
                                        {isComplete ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                                            {copyByMission[mission].doneLabel}
                                        </p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                            {isComplete ? (isKorean ? '완료' : 'Done') : isCurrent ? (isKorean ? '진행 중' : 'In progress') : (isKorean ? '대기' : 'Queued')}
                                        </p>
                                    </div>
                                </li>
                            );
                        })}
                    </ol>

                    <div className="order-3 mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-4 dark:border-blue-900/60 dark:bg-blue-950/25">
                        {isAllComplete ? (
                            <>
                                <div className="flex items-center gap-3">
                                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                        <ClipboardCheck className="h-6 w-6" />
                                    </div>
                                    <div>
                                        <h3 className="text-base font-black text-slate-950 dark:text-white">
                                            {isKorean ? '셋업을 마쳤어요' : 'Setup complete'}
                                        </h3>
                                        <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
                                            {isKorean
                                                ? '검색, 폐기 판단, 시약장, 재고 흐름을 모두 확인했습니다.'
                                                : 'You have seen search, disposal, cabinet, and inventory flows.'}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleFinish}
                                    className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-black text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
                                >
                                    {isKorean ? '작업 시작하기' : 'Start working'}
                                    <ArrowRight className="h-4 w-4" />
                                </button>
                            </>
                        ) : (
                            <>
                                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-blue-600 dark:text-blue-300">
                                    {missionCopy.eyebrow}
                                </p>
                                <h3 className="mt-1 text-lg font-black leading-tight text-slate-950 dark:text-white">
                                    {missionCopy.title}
                                </h3>
                                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                    {missionCopy.description}
                                </p>
                                <div className="mt-4 flex gap-2">
                                    {missionCopy.secondaryAction && (
                                        <button
                                            type="button"
                                            onClick={handleSecondaryAction}
                                            className="inline-flex h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-blue-200 bg-white px-3 text-sm font-bold text-blue-700 transition-colors hover:bg-blue-50 dark:border-blue-900/60 dark:bg-slate-900 dark:text-blue-300 dark:hover:bg-blue-950/40"
                                        >
                                            <Eye className="h-4 w-4" />
                                            {missionCopy.secondaryAction}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={handlePrimaryAction}
                                        className="inline-flex h-11 flex-[1.45] items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-blue-600 px-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition-colors hover:bg-blue-700"
                                    >
                                        {missionCopy.primaryAction}
                                        <ArrowRight className="h-4 w-4" />
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </aside>

            <MobileOnboardingSheet
                mission={currentMission}
                copy={missionCopy}
                completedCount={completedCount}
                totalCount={totalCount}
                isAllComplete={isAllComplete}
                hasSearchResult={hasSearchResult}
                onPrimaryAction={handlePrimaryAction}
                onSecondaryAction={missionCopy.secondaryAction ? handleSecondaryAction : undefined}
                onFinish={handleFinish}
                onSkip={handleSkip}
            />
        </>
    );
}
