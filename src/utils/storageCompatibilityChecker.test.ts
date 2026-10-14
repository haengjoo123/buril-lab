import { describe, expect, it } from 'vitest';
import type { ReagentPlacement } from '../types/fridge';
import { getAutoPlacementBlockReason } from './storagePlacementGate';
import { checkCabinetCompatibility, checkShelfCompatibility, classifyStoragePlacement, classifyStorageGroups } from './storageCompatibilityChecker';

function createPlacement(overrides: Partial<ReagentPlacement> = {}): ReagentPlacement {
    return {
        id: 'placement-1',
        reagentId: 'reagent-1',
        name: 'Buffer Solution',
        position: 0,
        width: 8,
        template: 'A',
        shelfId: 'shelf-1',
        isAcidic: false,
        isBasic: false,
        hCodes: [],
        ...overrides,
    };
}

describe('separate cabinet compartments', () => {
    const flammable = createPlacement({ id: 'flammable', name: 'Acetone', position: 10, hCodes: ['H225'] });
    const oxidizer = createPlacement({ id: 'oxidizer', name: 'Hydrogen Peroxide', position: 70, hCodes: ['H272'] });

    it('clears cross-compartment warnings and restores them when the wall is removed', () => {
        expect(checkShelfCompatibility([flammable, oxidizer], [50])).toEqual([]);
        expect(checkShelfCompatibility([flammable, oxidizer], [])).toHaveLength(1);
        expect(checkCabinetCompatibility([{ id: 'shelf-1', items: [flammable, oxidizer], dividers: [50] }]).size).toBe(0);
    });

    it('still warns about incompatible items inside the same compartment', () => {
        expect(checkShelfCompatibility([flammable, { ...oxidizer, position: 25 }], [50])).toHaveLength(1);
    });

    it('handles multiple, unordered and duplicate walls', () => {
        const middleOxidizer = { ...oxidizer, position: 40 };
        expect(checkShelfCompatibility([flammable, middleOxidizer, { ...flammable, id: 'right', position: 80 }], [65, 30, 30])).toEqual([]);
    });

    it('does not let invalid wall positions suppress warnings', () => {
        expect(checkShelfCompatibility([flammable, oxidizer], [NaN, Infinity, -5, 0, 100, 110])).toHaveLength(1);
    });
});

describe('authoritative storage classification', () => {
    it.each(['Dichloromethane', 'DCM', 'Chloroform', 'DMSO'])('%s is not inferred as flammable from its name', (name) => {
        const classification = classifyStoragePlacement(createPlacement({ name }));

        expect(classification.groups).not.toContain('FLAMMABLE');
        expect(classification.candidateGroups).toContain('ORGANIC_SOLVENT');
        expect(classification.confidence).toBe('review');
        expect(classification.needsReview).toBe(true);
        expect(classifyStorageGroups(createPlacement({ name }))).not.toContain('FLAMMABLE');
    });

    it('does not infer organic peroxide from a generic peroxide mention in notes', () => {
        const classification = classifyStoragePlacement(createPlacement({
            name: 'Buffer Solution',
            notes: 'contains peroxide stabilizer',
        }));

        expect(classification.candidateGroups).toEqual([]);
        expect(classification.groups).toEqual(['GENERAL']);
    });

    it('keeps hydrogen peroxide as an oxidizer when H272 is authoritative', () => {
        const classification = classifyStoragePlacement(createPlacement({
            name: 'Hydrogen Peroxide',
            hCodes: ['H272'],
            casNo: '7722-84-1',
            ghsStatus: 'success',
        }));

        expect(classification.groups).toContain('OXIDIZER');
        expect(classification.groups).not.toContain('ORGANIC_PEROXIDE');
        expect(classification.candidateGroups).toEqual([]);
        expect(classification.needsReview).toBe(false);
    });

    it('accepts organic peroxide only from an authoritative H242 code', () => {
        const classification = classifyStoragePlacement(createPlacement({
            name: 'Benzoyl Peroxide',
            hCodes: ['H242'],
            casNo: '94-36-0',
            ghsStatus: 'success',
        }));

        expect(classification.groups).toEqual(['ORGANIC_PEROXIDE']);
        expect(classification.candidateGroups).toEqual(['OXIDIZER']);
        expect(classification.needsReview).toBe(false);
    });
});

describe('automatic storage placement gate', () => {
    it('requires CAS and verified GHS data', () => {
        expect(getAutoPlacementBlockReason(createPlacement({ name: 'Acetone' }))).toBe('missing_cas');
        expect(getAutoPlacementBlockReason(createPlacement({
            name: 'Acetone',
            casNo: '67-64-1',
        }))).toBe('ghs_unverified');
    });

    it('rejects verified lookups that have no storage H-code', () => {
        expect(getAutoPlacementBlockReason(createPlacement({
            name: 'Dichloromethane',
            casNo: '75-09-2',
            ghsStatus: 'success',
            hCodes: [],
        }))).toBe('ghs_without_storage_codes');
    });

    it('rejects verified lookups whose H-code is outside the storage mapping', () => {
        expect(getAutoPlacementBlockReason(createPlacement({
            name: 'Dichloromethane',
            casNo: '75-09-2',
            ghsStatus: 'success',
            hCodes: ['H315'],
        }))).toBe('storage_classification_review');
    });

    it('allows a verified flammable classification from H225', () => {
        expect(getAutoPlacementBlockReason(createPlacement({
            name: 'Acetone',
            casNo: '67-64-1',
            ghsStatus: 'success',
            hCodes: ['H225'],
        }))).toBeUndefined();
    });
});
