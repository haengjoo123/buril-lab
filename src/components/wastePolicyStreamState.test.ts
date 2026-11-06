import { describe, expect, it } from 'vitest';
import type { ResolvedWasteStream } from '../services/wastePolicyService';
import {
    getWastePolicySourceLabelKey,
    getWasteStreamEffectiveLocation,
    getWasteStreamOverrideState,
} from './wastePolicyStreamState';

type StreamState = Pick<ResolvedWasteStream, 'labOverride' | 'inheritedPhysical'>;

const stream = (overrides: Partial<StreamState> = {}): StreamState => ({
    inheritedPhysical: { location: 'B동 폐기물 보관실' },
    labOverride: null,
    ...overrides,
});

describe('getWasteStreamOverrideState', () => {
    it('reports inherited streams as default', () => {
        expect(getWasteStreamOverrideState(stream())).toBe('default');
        expect(getWasteStreamOverrideState(stream({
            labOverride: { isDisabled: false, location: '   ', containerLabel: null },
        }))).toBe('default');
    });

    it('reports lab-entered values as modified', () => {
        expect(getWasteStreamOverrideState(stream({
            labOverride: { isDisabled: false, location: '3층 실험실 후드 옆' },
        }))).toBe('modified');
    });

    it('reports an unavailable container as disabled even with other values', () => {
        expect(getWasteStreamOverrideState(stream({
            labOverride: { isDisabled: true, location: '3층', replacementLocation: null },
        }))).toBe('disabled');
    });
});

describe('getWasteStreamEffectiveLocation', () => {
    it('shows the lab location first, then the inherited one', () => {
        expect(getWasteStreamEffectiveLocation(stream())).toBe('B동 폐기물 보관실');
        expect(getWasteStreamEffectiveLocation(stream({
            labOverride: { isDisabled: false, location: ' 3층 후드 옆 ' },
        }))).toBe('3층 후드 옆');
    });

    it('shows the replacement location for a disabled container, or nothing', () => {
        expect(getWasteStreamEffectiveLocation(stream({
            labOverride: { isDisabled: true, replacementLocation: '별관 1번 선반' },
        }))).toBe('별관 1번 선반');
        expect(getWasteStreamEffectiveLocation(stream({
            labOverride: { isDisabled: true, replacementLocation: null },
        }))).toBeNull();
    });
});

describe('getWastePolicySourceLabelKey', () => {
    it('maps policy scopes to readable label keys instead of raw enums', () => {
        expect(getWastePolicySourceLabelKey('system')).toBe('waste_policy_source_system');
        expect(getWastePolicySourceLabelKey(undefined)).toBe('waste_policy_source_system');
        expect(getWastePolicySourceLabelKey('institution')).toBe('waste_policy_source_institution');
        expect(getWastePolicySourceLabelKey('lab')).toBe('waste_policy_source_lab');
        expect(getWastePolicySourceLabelKey('regional')).toBeNull();
    });
});
