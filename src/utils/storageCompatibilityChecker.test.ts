import { describe, expect, it } from 'vitest';
import type { ReagentPlacement } from '../types/fridge';
import { getAutoPlacementBlockReason } from './storagePlacementGate';
import {
    buildCabinetCompatMarks,
    checkCabinetCompatibility,
    checkCabinetReviewConflicts,
    checkShelfCompatibility,
    checkShelfReviewConflicts,
    classifyStoragePlacement,
    classifyStorageGroups,
    getStorageRuleGroupLabelKeys,
} from './storageCompatibilityChecker';

describe('storage rule group labels', () => {
    it('names the two groups a rule pairs and refuses unknown ids', () => {
        expect(getStorageRuleGroupLabelKeys('store_flam_oxid')).toEqual(['storage_group_flammable', 'storage_group_oxidizer']);
        expect(getStorageRuleGroupLabelKeys('store_acid_cyanide')).toEqual(['storage_group_inorganic_acid', 'storage_group_cyanide']);
        expect(getStorageRuleGroupLabelKeys('not_a_rule')).toBeNull();
    });
});

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

describe('corrosive (H314) acid/base resolution', () => {
    const nitricAcid = createPlacement({
        id: 'nitric', name: 'Nitric acid', casNo: '7697-37-2', ghsStatus: 'success',
        hCodes: ['H272', 'H290', 'H314', 'H331'], isAcidic: true, position: 10,
    });
    const sodiumHydroxide = createPlacement({
        id: 'naoh', name: 'Sodium hydroxide', casNo: '1310-73-2', ghsStatus: 'success',
        hCodes: ['H290', 'H314'], isBasic: true, position: 30,
    });
    const toluene = createPlacement({
        id: 'toluene', name: 'Toluene', casNo: '108-88-3', ghsStatus: 'success',
        hCodes: ['H225', 'H304', 'H315', 'H336', 'H361d', 'H373'], position: 50,
    });

    it('classifies a hydroxide with H314 as a base, not an acid', () => {
        const groups = classifyStorageGroups(sodiumHydroxide);
        expect(groups).toContain('BASE');
        expect(groups).not.toContain('INORGANIC_ACID');
    });

    it.each([
        ['Ammonia solution 25%', false],
        ['Triethylamine', false],
        ['Calcium hydroxide Ca(OH)2', false],
        ['Unlabeled corrosive', true],
    ])('uses name or stored base signal for %s', (name, isBasic) => {
        const groups = classifyStorageGroups(createPlacement({ name, hCodes: ['H314'], isBasic, ghsStatus: 'success' }));
        expect(groups).toEqual(['BASE']);
    });

    it('keeps an H314 acid as an acid', () => {
        expect(classifyStorageGroups(createPlacement({ name: 'Hydrochloric acid', hCodes: ['H290', 'H314', 'H335'] })))
            .toEqual(['INORGANIC_ACID']);
        expect(classifyStorageGroups(createPlacement({ name: 'Unknown corrosive', hCodes: ['H314'] })))
            .toEqual(['INORGANIC_ACID']);
    });

    it('does not read 수산화 (hydroxide) as 수산 (oxalic acid) or trust the Korean acid flag', () => {
        const classification = classifyStoragePlacement(createPlacement({
            name: '수산화나트륨', hCodes: ['H290', 'H314'], isAcidic: true, isBasic: true, ghsStatus: 'success',
        }));
        expect(classification.groups).toEqual(['BASE']);
        expect(classification.candidateGroups).not.toContain('ORGANIC_ACID');
        expect(classification.candidateGroups).not.toContain('INORGANIC_ACID');
    });

    it('keeps both groups when acid and base evidence conflict', () => {
        expect(classifyStorageGroups(createPlacement({ name: 'Triethylamine HCl', hCodes: ['H314'] })))
            .toEqual(expect.arrayContaining(['INORGANIC_ACID', 'BASE']));
    });

    it('reports nitric acid next to NaOH as acid–base, not oxidizer–acid', () => {
        const warnings = checkShelfCompatibility([nitricAcid, sodiumHydroxide]);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatchObject({ ruleId: 'store_acid_base', severity: 'WARNING', messageKey: 'storage_acid_base' });
    });

    it('reports toluene next to NaOH as flammable–base, not flammable–acid', () => {
        const warnings = checkShelfCompatibility([toluene, sodiumHydroxide]);
        expect(warnings.map(w => w.ruleId)).toEqual(['store_flam_base']);
        expect(warnings[0].severity).toBe('WARNING');
    });

    it('reports one line per pair at its highest severity', () => {
        const warnings = checkShelfCompatibility([toluene, nitricAcid]);
        expect(warnings).toHaveLength(1);
        expect(warnings[0].severity).toBe('DANGER');
        expect(warnings[0].ruleIds).toEqual(expect.arrayContaining(['store_flam_oxid', 'store_flam_acid']));
        expect(warnings[0].messageKeys).toEqual(expect.arrayContaining(['storage_flam_oxidizer', 'storage_flam_acid']));
        expect(warnings[0].itemIds).toEqual(expect.arrayContaining(['toluene', 'nitric']));
    });

    it('merges same-named bottles into one line that still marks every bottle', () => {
        const secondToluene = { ...toluene, id: 'toluene-2', position: 70 };
        const warnings = checkShelfCompatibility([toluene, nitricAcid, secondToluene]);
        expect(warnings).toHaveLength(1);
        expect(warnings[0].itemIds).toEqual(expect.arrayContaining(['toluene', 'toluene-2', 'nitric']));
    });

    it('lists the three-bottle shelf without duplicate pairs, danger first', () => {
        const warnings = checkShelfCompatibility([toluene, nitricAcid, sodiumHydroxide]);
        expect(warnings.map(w => w.ruleId)).toEqual(['store_flam_oxid', 'store_acid_base', 'store_flam_base']);
    });
});

describe('needs-review conflicts when GHS data is missing', () => {
    const unverified = (id: string, name: string, position: number) => createPlacement({
        id, name, position, ghsStatus: 'transient_error', hCodes: [],
    });
    const nitricAcid = unverified('nitric', 'Nitric acid', 10);
    const sodiumHydroxide = unverified('naoh', 'Sodium hydroxide', 30);
    const toluene = unverified('toluene', 'Toluene', 50);

    it('never turns name candidates into confirmed warnings', () => {
        expect(checkShelfCompatibility([nitricAcid, sodiumHydroxide, toluene])).toEqual([]);
    });

    it('keeps conflicting candidates visible for review', () => {
        const conflicts = checkShelfReviewConflicts([nitricAcid, sodiumHydroxide, toluene]);
        const pairs = conflicts.map(conflict => [...conflict.itemIds].sort().join('+'));
        expect(pairs).toEqual(expect.arrayContaining(['naoh+nitric', 'nitric+toluene', 'naoh+toluene']));

        const shelves = [{ id: 'shelf-1', items: [nitricAcid, sodiumHydroxide, toluene], dividers: [] }];
        const marks = buildCabinetCompatMarks(checkCabinetCompatibility(shelves), checkCabinetReviewConflicts(shelves));
        expect([...marks.values()]).toEqual(['review', 'review', 'review']);
    });

    it('respects compartment walls for review conflicts too', () => {
        expect(checkShelfReviewConflicts([nitricAcid, { ...sodiumHydroxide, position: 70 }], [50])).toEqual([]);
    });

    it('leaves pairs with a confirmed warning to that warning', () => {
        const verifiedToluene = createPlacement({ id: 'toluene', name: 'Toluene', hCodes: ['H225'], ghsStatus: 'success', position: 50 });
        const verifiedNitric = createPlacement({ id: 'nitric', name: 'Nitric acid', hCodes: ['H272', 'H314'], ghsStatus: 'success', position: 10 });
        expect(checkShelfReviewConflicts([verifiedToluene, verifiedNitric])).toEqual([]);

        const shelves = [{ id: 'shelf-1', items: [verifiedToluene, verifiedNitric, sodiumHydroxide], dividers: [] }];
        const marks = buildCabinetCompatMarks(checkCabinetCompatibility(shelves), checkCabinetReviewConflicts(shelves));
        expect(marks.get('toluene')).toBe('danger');
        expect(marks.get('nitric')).toBe('danger');
        expect(marks.get('naoh')).toBe('review');
    });

    it('does not presume flammability for a solvent whose GHS data was verified', () => {
        const dcm = createPlacement({ id: 'dcm', name: 'Dichloromethane', hCodes: ['H315', 'H351'], ghsStatus: 'success', position: 10 });
        const hcl = createPlacement({ id: 'hcl', name: 'Hydrochloric acid', hCodes: ['H290', 'H314'], ghsStatus: 'success', position: 30 });
        expect(checkShelfReviewConflicts([dcm, hcl])).toEqual([]);
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
