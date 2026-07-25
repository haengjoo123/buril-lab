import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export type OnboardingGuideKey =
    | 'search'
    | 'logs'
    | 'cabinetList'
    | 'cabinetDetail'
    | 'inventory';

export type OnboardingMissionKey =
    | 'search'
    | 'disposal'
    | 'cabinet'
    | 'inventory';

export type OnboardingHintKey =
    | 'mobileIntro'
    | 'searchBox'
    | 'resultCard'
    | 'cabinetModes'
    | 'inventoryTools';

export const ONBOARDING_VERSION = 2;

export const ONBOARDING_MISSION_ORDER: OnboardingMissionKey[] = [
    'search',
    'disposal',
    'cabinet',
    'inventory',
];

const ALL_GUIDES_SEEN: SeenGuides = {
    search: true,
    logs: true,
    cabinetList: true,
    cabinetDetail: true,
    inventory: true,
};

const noopStorage: StateStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
};

function getOnboardingStorage(): StateStorage {
    if (typeof window === 'undefined') return noopStorage;

    try {
        return window.localStorage;
    } catch {
        return noopStorage;
    }
}

type SeenGuides = Partial<Record<OnboardingGuideKey, boolean>>;
type CompletedMissions = Partial<Record<OnboardingMissionKey, boolean>>;
type DismissedHints = Partial<Record<OnboardingHintKey, boolean>>;

type PersistedOnboardingSnapshot = {
    version: number;
    hasCompletedWelcome: boolean;
    hasSkippedOnboarding: boolean;
    seenGuides: SeenGuides;
    currentMission: OnboardingMissionKey;
    completedMissions: CompletedMissions;
    dismissedHints: DismissedHints;
    hasCompletedMissionOnboarding: boolean;
};

export interface OnboardingRemoteProgress {
    completedMissions?: CompletedMissions;
    hasSkippedOnboarding?: boolean;
    hasCompletedMissionOnboarding?: boolean;
}

interface OnboardingState {
    version: number;
    hasCompletedWelcome: boolean;
    hasSkippedOnboarding: boolean;
    seenGuides: SeenGuides;
    isWelcomeOpen: boolean;
    activeUserId: string | null;
    users: Record<string, PersistedOnboardingSnapshot>;
    currentMission: OnboardingMissionKey;
    completedMissions: CompletedMissions;
    dismissedHints: DismissedHints;
    hasCompletedMissionOnboarding: boolean;
    syncVersion: () => void;
    setActiveUser: (userId: string | null) => void;
    applyRemoteOnboardingProgress: (userId: string, progress: OnboardingRemoteProgress) => void;
    openWelcome: () => void;
    completeWelcome: () => void;
    finishOnboarding: () => void;
    skipOnboarding: () => void;
    resetOnboarding: () => void;
    markGuideSeen: (key: OnboardingGuideKey) => void;
    setCurrentMission: (key: OnboardingMissionKey) => void;
    markMissionCompleted: (key: OnboardingMissionKey) => void;
    dismissHint: (key: OnboardingHintKey) => void;
}

function getNextIncompleteMission(completedMissions: CompletedMissions): OnboardingMissionKey {
    return ONBOARDING_MISSION_ORDER.find((mission) => !completedMissions[mission]) ?? 'inventory';
}

function createInitialSnapshot(): PersistedOnboardingSnapshot {
    return {
        version: ONBOARDING_VERSION,
        hasCompletedWelcome: false,
        hasSkippedOnboarding: false,
        seenGuides: {},
        currentMission: 'search',
        completedMissions: {},
        dismissedHints: {},
        hasCompletedMissionOnboarding: false,
    };
}

function createInitialState(): Pick<
    OnboardingState,
    | keyof PersistedOnboardingSnapshot
    | 'isWelcomeOpen'
    | 'activeUserId'
    | 'users'
> {
    return {
        ...createInitialSnapshot(),
        isWelcomeOpen: false,
        activeUserId: null,
        users: {},
    };
}

function normalizeSnapshot(snapshot?: Partial<PersistedOnboardingSnapshot>): PersistedOnboardingSnapshot {
    if (!snapshot || snapshot.version !== ONBOARDING_VERSION) {
        return createInitialSnapshot();
    }

    return {
        ...createInitialSnapshot(),
        ...snapshot,
        seenGuides: snapshot.seenGuides || {},
        completedMissions: snapshot.completedMissions || {},
        dismissedHints: snapshot.dismissedHints || {},
        currentMission: snapshot.currentMission || getNextIncompleteMission(snapshot.completedMissions || {}),
    };
}

function toSnapshot(state: OnboardingState): PersistedOnboardingSnapshot {
    return {
        version: state.version,
        hasCompletedWelcome: state.hasCompletedWelcome,
        hasSkippedOnboarding: state.hasSkippedOnboarding,
        seenGuides: state.seenGuides,
        currentMission: state.currentMission,
        completedMissions: state.completedMissions,
        dismissedHints: state.dismissedHints,
        hasCompletedMissionOnboarding: state.hasCompletedMissionOnboarding,
    };
}

function isMissionFlowComplete(completedMissions: CompletedMissions): boolean {
    return ONBOARDING_MISSION_ORDER.every((mission) => completedMissions[mission]);
}

export const useOnboardingStore = create<OnboardingState>()(
    persist(
        (set, get) => ({
            ...createInitialState(),
            syncVersion: () => {
                if (get().version === ONBOARDING_VERSION) return;
                set(createInitialState());
            },
            setActiveUser: (userId) =>
                set((state) => {
                    if (state.activeUserId === userId) {
                        return state;
                    }

                    const users = { ...state.users };
                    if (state.activeUserId) {
                        users[state.activeUserId] = toSnapshot(state);
                    }

                    const nextSnapshot = userId ? normalizeSnapshot(users[userId]) : createInitialSnapshot();

                    return {
                        ...nextSnapshot,
                        activeUserId: userId,
                        users,
                        isWelcomeOpen: false,
                    };
                }),
            applyRemoteOnboardingProgress: (userId, progress) =>
                set((state) => {
                    const users = { ...state.users };
                    const baseSnapshot = normalizeSnapshot(
                        state.activeUserId === userId ? toSnapshot(state) : users[userId]
                    );
                    const completedMissions = {
                        ...baseSnapshot.completedMissions,
                        ...(progress.completedMissions || {}),
                    };
                    const hasCompletedMissionOnboarding =
                        progress.hasCompletedMissionOnboarding ||
                        baseSnapshot.hasCompletedMissionOnboarding ||
                        isMissionFlowComplete(completedMissions);
                    const hasSkippedOnboarding =
                        !hasCompletedMissionOnboarding &&
                        (progress.hasSkippedOnboarding || baseSnapshot.hasSkippedOnboarding);

                    const nextSnapshot: PersistedOnboardingSnapshot = {
                        ...baseSnapshot,
                        completedMissions,
                        currentMission: getNextIncompleteMission(completedMissions),
                        hasCompletedWelcome: baseSnapshot.hasCompletedWelcome || hasCompletedMissionOnboarding,
                        hasCompletedMissionOnboarding,
                        hasSkippedOnboarding,
                        seenGuides: hasCompletedMissionOnboarding ? ALL_GUIDES_SEEN : baseSnapshot.seenGuides,
                    };

                    users[userId] = nextSnapshot;

                    if (state.activeUserId !== userId) {
                        return { users };
                    }

                    return {
                        ...nextSnapshot,
                        users,
                        isWelcomeOpen: hasCompletedMissionOnboarding || hasSkippedOnboarding ? false : state.isWelcomeOpen,
                    };
                }),
            openWelcome: () =>
                set((state) => ({
                    isWelcomeOpen: true,
                    hasSkippedOnboarding: false,
                    currentMission: getNextIncompleteMission(state.completedMissions),
                })),
            completeWelcome: () => get().finishOnboarding(),
            finishOnboarding: () =>
                set({
                    hasCompletedWelcome: true,
                    hasCompletedMissionOnboarding: true,
                    hasSkippedOnboarding: false,
                    seenGuides: ALL_GUIDES_SEEN,
                    isWelcomeOpen: false,
                }),
            skipOnboarding: () =>
                set({
                    hasCompletedWelcome: false,
                    hasCompletedMissionOnboarding: false,
                    hasSkippedOnboarding: true,
                    isWelcomeOpen: false,
                }),
            resetOnboarding: () =>
                set((state) => {
                    const nextSnapshot = createInitialSnapshot();
                    const users = { ...state.users };

                    if (state.activeUserId) {
                        users[state.activeUserId] = nextSnapshot;
                    }

                    return {
                        ...nextSnapshot,
                        activeUserId: state.activeUserId,
                        users,
                        isWelcomeOpen: true,
                    };
                }),
            markGuideSeen: (key) =>
                set((state) => ({
                    seenGuides: {
                        ...state.seenGuides,
                        [key]: true,
                    },
                })),
            setCurrentMission: (key) =>
                set({
                    currentMission: key,
                    isWelcomeOpen: true,
                    hasSkippedOnboarding: false,
                }),
            markMissionCompleted: (key) =>
                set((state) => {
                    if (state.completedMissions[key]) {
                        return state;
                    }

                    const completedMissions = {
                        ...state.completedMissions,
                        [key]: true,
                    };

                    return {
                        completedMissions,
                        currentMission: getNextIncompleteMission(completedMissions),
                    };
                }),
            dismissHint: (key) =>
                set((state) => ({
                    dismissedHints: {
                        ...state.dismissedHints,
                        [key]: true,
                    },
                })),
        }),
        {
            name: 'buril-onboarding-store',
            storage: createJSONStorage(getOnboardingStorage),
            partialize: (state) => ({
                version: state.version,
                hasCompletedWelcome: state.hasCompletedWelcome,
                hasSkippedOnboarding: state.hasSkippedOnboarding,
                seenGuides: state.seenGuides,
                activeUserId: state.activeUserId,
                users: state.users,
                currentMission: state.currentMission,
                completedMissions: state.completedMissions,
                dismissedHints: state.dismissedHints,
                hasCompletedMissionOnboarding: state.hasCompletedMissionOnboarding,
            }),
        }
    )
);
