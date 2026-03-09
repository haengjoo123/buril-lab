import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type OnboardingGuideKey =
    | 'search'
    | 'logs'
    | 'cabinetList'
    | 'cabinetDetail'
    | 'inventory';

const ONBOARDING_VERSION = 1;

type SeenGuides = Partial<Record<OnboardingGuideKey, boolean>>;

interface OnboardingState {
    version: number;
    hasCompletedWelcome: boolean;
    hasSkippedOnboarding: boolean;
    seenGuides: SeenGuides;
    isWelcomeOpen: boolean;
    syncVersion: () => void;
    openWelcome: () => void;
    completeWelcome: () => void;
    skipOnboarding: () => void;
    resetOnboarding: () => void;
    markGuideSeen: (key: OnboardingGuideKey) => void;
}

export const useOnboardingStore = create<OnboardingState>()(
    persist(
        (set, get) => ({
            version: ONBOARDING_VERSION,
            hasCompletedWelcome: false,
            hasSkippedOnboarding: false,
            seenGuides: {},
            isWelcomeOpen: false,
            syncVersion: () => {
                if (get().version === ONBOARDING_VERSION) return;

                set({
                    version: ONBOARDING_VERSION,
                    hasCompletedWelcome: false,
                    hasSkippedOnboarding: false,
                    seenGuides: {},
                    isWelcomeOpen: false,
                });
            },
            openWelcome: () => set({ isWelcomeOpen: true }),
            completeWelcome: () =>
                set({
                    hasCompletedWelcome: true,
                    hasSkippedOnboarding: false,
                    isWelcomeOpen: false,
                }),
            skipOnboarding: () =>
                set({
                    hasCompletedWelcome: false,
                    hasSkippedOnboarding: true,
                    isWelcomeOpen: false,
                }),
            resetOnboarding: () =>
                set({
                    version: ONBOARDING_VERSION,
                    hasCompletedWelcome: false,
                    hasSkippedOnboarding: false,
                    seenGuides: {},
                    isWelcomeOpen: true,
                }),
            markGuideSeen: (key) =>
                set((state) => ({
                    seenGuides: {
                        ...state.seenGuides,
                        [key]: true,
                    },
                })),
        }),
        {
            name: 'buril-onboarding-store',
            partialize: (state) => ({
                version: state.version,
                hasCompletedWelcome: state.hasCompletedWelcome,
                hasSkippedOnboarding: state.hasSkippedOnboarding,
                seenGuides: state.seenGuides,
            }),
        }
    )
);
