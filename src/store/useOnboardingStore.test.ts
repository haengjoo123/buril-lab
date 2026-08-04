import { beforeEach, describe, expect, it } from 'vitest';
import {
    ONBOARDING_VERSION,
    useOnboardingStore,
} from './useOnboardingStore';

function resetStore() {
    useOnboardingStore.setState({
        version: ONBOARDING_VERSION,
        hasCompletedWelcome: false,
        hasSkippedOnboarding: false,
        seenGuides: {},
        isWelcomeOpen: false,
        currentMission: 'search',
        completedMissions: {},
        dismissedHints: {},
        hasCompletedMissionOnboarding: false,
        activeUserId: null,
        users: {},
    });
}

describe('useOnboardingStore', () => {
    beforeEach(() => {
        resetStore();
    });

    it('opens mission onboarding from the first incomplete mission', () => {
        useOnboardingStore.getState().markMissionCompleted('search');
        useOnboardingStore.getState().openWelcome();

        const state = useOnboardingStore.getState();
        expect(state.isWelcomeOpen).toBe(true);
        expect(state.currentMission).toBe('disposal');
    });

    it('advances through mission completion without marking the flow finished', () => {
        useOnboardingStore.getState().openWelcome();
        useOnboardingStore.getState().markMissionCompleted('search');
        useOnboardingStore.getState().markMissionCompleted('disposal');

        const state = useOnboardingStore.getState();
        expect(state.completedMissions.search).toBe(true);
        expect(state.completedMissions.disposal).toBe(true);
        expect(state.currentMission).toBe('cabinet');
        expect(state.hasCompletedMissionOnboarding).toBe(false);
    });

    it('finishes and closes onboarding as soon as the final mission is completed', () => {
        useOnboardingStore.getState().setActiveUser('user-a');
        useOnboardingStore.getState().openWelcome();
        useOnboardingStore.getState().markMissionCompleted('search');
        useOnboardingStore.getState().markMissionCompleted('disposal');
        useOnboardingStore.getState().markMissionCompleted('cabinet');
        useOnboardingStore.getState().markMissionCompleted('inventory');

        const state = useOnboardingStore.getState();
        expect(state.hasCompletedWelcome).toBe(true);
        expect(state.hasCompletedMissionOnboarding).toBe(true);
        expect(state.isWelcomeOpen).toBe(false);
        expect(state.users['user-a']?.hasCompletedMissionOnboarding).toBe(true);
    });

    it('repairs a legacy all-missions-complete state that is still open', () => {
        useOnboardingStore.setState({
            completedMissions: {
                search: true,
                disposal: true,
                cabinet: true,
                inventory: true,
            },
            hasCompletedWelcome: false,
            hasCompletedMissionOnboarding: false,
            isWelcomeOpen: true,
        });

        useOnboardingStore.getState().syncVersion();

        const state = useOnboardingStore.getState();
        expect(state.hasCompletedMissionOnboarding).toBe(true);
        expect(state.isWelcomeOpen).toBe(false);
    });

    it('finishes onboarding and suppresses legacy guide cards', () => {
        useOnboardingStore.getState().finishOnboarding();

        const state = useOnboardingStore.getState();
        expect(state.hasCompletedWelcome).toBe(true);
        expect(state.hasCompletedMissionOnboarding).toBe(true);
        expect(state.isWelcomeOpen).toBe(false);
        expect(state.seenGuides.search).toBe(true);
        expect(state.seenGuides.inventory).toBe(true);
    });

    it('resets replay state for settings replay', () => {
        useOnboardingStore.getState().setActiveUser('user-a');
        useOnboardingStore.getState().finishOnboarding();

        useOnboardingStore.getState().setActiveUser('user-b');
        useOnboardingStore.getState().finishOnboarding();
        useOnboardingStore.getState().resetOnboarding();

        const state = useOnboardingStore.getState();
        expect(state.isWelcomeOpen).toBe(true);
        expect(state.hasCompletedMissionOnboarding).toBe(false);
        expect(state.hasSkippedOnboarding).toBe(false);
        expect(state.currentMission).toBe('search');
        expect(state.completedMissions).toEqual({});
        expect(state.activeUserId).toBe('user-b');

        useOnboardingStore.getState().setActiveUser('user-a');
        expect(useOnboardingStore.getState().hasCompletedMissionOnboarding).toBe(true);
    });

    it('keeps onboarding state separated by user id', () => {
        useOnboardingStore.getState().setActiveUser('user-a');
        useOnboardingStore.getState().finishOnboarding();

        useOnboardingStore.getState().setActiveUser('user-b');
        expect(useOnboardingStore.getState().hasCompletedMissionOnboarding).toBe(false);

        useOnboardingStore.getState().setActiveUser('user-a');
        expect(useOnboardingStore.getState().hasCompletedMissionOnboarding).toBe(true);
    });

    it('applies remote onboarding progress for the active user', () => {
        useOnboardingStore.getState().setActiveUser('user-a');
        useOnboardingStore.getState().applyRemoteOnboardingProgress('user-a', {
            completedMissions: {
                search: true,
                disposal: true,
                cabinet: true,
                inventory: true,
            },
        });

        const state = useOnboardingStore.getState();
        expect(state.hasCompletedMissionOnboarding).toBe(true);
        expect(state.hasCompletedWelcome).toBe(true);
        expect(state.seenGuides.search).toBe(true);
    });

    it('applies remote skipped state without leaking to another user', () => {
        useOnboardingStore.getState().setActiveUser('user-a');
        useOnboardingStore.getState().applyRemoteOnboardingProgress('user-a', {
            hasSkippedOnboarding: true,
        });

        expect(useOnboardingStore.getState().hasSkippedOnboarding).toBe(true);

        useOnboardingStore.getState().setActiveUser('user-b');
        expect(useOnboardingStore.getState().hasSkippedOnboarding).toBe(false);
    });
});
