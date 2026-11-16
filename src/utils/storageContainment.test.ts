import { describe, expect, it } from 'vitest';
import type { ReagentPlacement } from '../types/fridge';
import {
    buildCabinetCompatMarks,
    checkCabinetContainment,
    classifyStoragePlacement,
    requiresLockedStorage,
} from './storageCompatibilityChecker';

const placement = (overrides: Partial<ReagentPlacement>): ReagentPlacement => ({
    id: 'item',
    reagentId: 'reagent',
    name: 'Reagent',
    position: 0,
    width: 8,
    template: 'A',
    shelfId: 'shelf-1',
    isAcidic: false,
    isBasic: false,
    hCodes: [],
    ...overrides,
});

const toxic = placement({ id: 'toxic', name: 'Sodium fluoroacetate', hCodes: ['H300'], ghsStatus: 'success' });
const carcinogen = placement({ id: 'carcinogen', name: 'Benzene', hCodes: ['H225', 'H350'], ghsStatus: 'success' });
const solvent = placement({ id: 'solvent', name: 'Acetone', hCodes: ['H225'], ghsStatus: 'success', casNo: '67-64-1' });
const guessedCyanide = placement({ id: 'guess', name: 'Potassium cyanide solution' });

const lockRequired = (item: ReagentPlacement, regulatedLockRequired = false) => requiresLockedStorage({
    groups: classifyStoragePlacement(item).groups,
    hCodes: item.hCodes,
    regulatedLockRequired,
});

describe('requiresLockedStorage', () => {
    it('asks for a lock for trusted acutely toxic groups and category 1 carcinogens', () => {
        expect(lockRequired(toxic)).toBe(true);
        expect(lockRequired(carcinogen)).toBe(true);
        expect(lockRequired(placement({ hCodes: ['H350i'] }))).toBe(true);
        expect(lockRequired(placement({ hCodes: ['H351'] }))).toBe(false);
    });

    it('does not act on name guesses, and follows the 화관법 duty when given', () => {
        expect(lockRequired(guessedCyanide)).toBe(false);
        expect(lockRequired(solvent)).toBe(false);
        expect(lockRequired(solvent, true)).toBe(true);
    });
});

describe('checkCabinetContainment', () => {
    const shelves = [
        { id: 'top', items: [toxic, solvent] },
        { id: 'bottom', items: [carcinogen, guessedCyanide] },
    ];

    it('stays quiet unless the cabinet is recorded as having no lock', () => {
        expect(checkCabinetContainment(shelves, null).size).toBe(0);
        expect(checkCabinetContainment(shelves, undefined).size).toBe(0);
        expect(checkCabinetContainment(shelves, true).size).toBe(0);
    });

    it('lists each reagent that belongs behind a lock, per shelf', () => {
        const findings = checkCabinetContainment(shelves, false);
        expect(findings.get('top')?.map((finding) => finding.itemId)).toEqual(['toxic']);
        expect(findings.get('bottom')?.map((finding) => finding.itemId)).toEqual(['carcinogen']);
        expect(findings.get('top')?.[0]).toMatchObject({
            ruleId: 'locked_storage_required', itemName: 'Sodium fluoroacetate', messageKey: 'storage_locked_required',
        });

        const withRegulation = checkCabinetContainment(shelves, false, (item) => item.casNo === '67-64-1');
        expect(withRegulation.get('top')?.map((finding) => finding.itemId)).toEqual(['toxic', 'solvent']);
    });

    it('marks those bottles as warnings without hiding a danger pair', () => {
        const containment = checkCabinetContainment(shelves, false);
        const marks = buildCabinetCompatMarks(new Map([['top', [{
            severity: 'DANGER', ruleId: 'r', itemA: 'x', itemB: 'y', messageKey: 'm', ruleIds: ['r'], messageKeys: ['m'], itemIds: ['toxic', 'other'],
        }]]]), new Map(), containment);
        expect(marks.get('toxic')).toBe('danger');
        expect(marks.get('carcinogen')).toBe('warning');
        expect(marks.has('solvent')).toBe(false);
    });
});
