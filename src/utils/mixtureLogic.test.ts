import { describe, expect, it } from 'vitest';
import type { CartItem, DisposalCategory, SolutionContext } from '../types';
import { analyzeMixture } from './mixtureLogic';

function createCartItem(
    category: DisposalCategory,
    overrides: {
        name?: string;
        formula?: string;
        solutionContext?: SolutionContext;
    } = {},
): CartItem {
    return {
        chemical: {
            id: `${overrides.name ?? category}-${category}`,
            name: overrides.name ?? category,
            casNumber: 'n/a',
            molecularFormula: overrides.formula ?? '',
        },
        category,
        binColor: 'bg-gray-400',
        label: `label_${category.toLowerCase()}`,
        reason: `reason_${category.toLowerCase()}`,
        isSafe: category !== 'UNKNOWN',
        solutionContext: overrides.solutionContext,
    };
}

const aqueousContext: SolutionContext = {
    physicalForm: 'aqueous',
    solventClass: 'aqueous',
    solventName: 'Water/Aqueous',
    solventResolution: 'preset',
    isSolventVerified: true,
};

const dcmContext: SolutionContext = {
    physicalForm: 'organic_solvent',
    solventClass: 'organic_halogen',
    solventName: 'DCM/Chloroform',
    solventPreset: 'dcm_chloroform',
    solventResolution: 'preset',
    isSolventVerified: true,
};

const ethanolContext: SolutionContext = {
    physicalForm: 'organic_solvent',
    solventClass: 'organic_non_halogen',
    solventName: 'EtOH/MeOH',
    solventPreset: 'etoh_meoh',
    solventResolution: 'preset',
    isSolventVerified: true,
};

const unknownMatrixContext: SolutionContext = {
    physicalForm: 'mixed_or_unknown',
    solventClass: 'mixed_or_unknown',
    solventResolution: 'unresolved',
    isSolventVerified: false,
};

describe('analyzeMixture solution context overlay', () => {
    it('keeps acid classification for aqueous acid waste', () => {
        const result = analyzeMixture([
            createCartItem('ACID', {
                name: 'Hydrochloric acid',
                formula: 'HCl',
                solutionContext: aqueousContext,
            }),
        ]);

        expect(result.category).toBe('ACID');
        expect(result.basis).toBe('solution');
        expect(result.label).toBe('mix_label_acid');
    });

    it('routes a neutral reagent in DCM to halogenated organic waste with pure-basis advisory', () => {
        const result = analyzeMixture([
            createCartItem('NEUTRAL', {
                name: 'Sodium chloride',
                formula: 'NaCl',
                solutionContext: dcmContext,
            }),
        ]);

        expect(result.category).toBe('ORGANIC_HALOGEN');
        expect(result.basis).toBe('solution');
        expect(result.baseLabel).toBe('label_neutral');
        expect(result.contextWarnings).toContain('mix_context_warning_solvent_override');
    });

    it('does not downgrade heavy-metal waste to non-halogen organic solvent waste', () => {
        const result = analyzeMixture([
            createCartItem('HEAVY_METAL', {
                name: 'Copper sulfate',
                formula: 'CuSO4',
                solutionContext: ethanolContext,
            }),
        ]);

        expect(result.category).toBe('HEAVY_METAL');
        expect(result.basis).toBe('solution');
        expect(result.contextWarnings).toContain('mix_context_warning_hazard_with_solvent');
    });

    it('keeps cyanide priority for aqueous cyanide waste', () => {
        const result = analyzeMixture([
            createCartItem('CYANIDE', {
                name: 'Potassium cyanide',
                formula: 'KCN',
                solutionContext: aqueousContext,
            }),
        ]);

        expect(result.category).toBe('CYANIDE');
        expect(result.label).toBe('label_cyanide');
        expect(result.isSafe).toBe(false);
    });

    it('flags aqueous organic solutes for review instead of ordinary aqueous disposal', () => {
        const result = analyzeMixture([
            createCartItem('ORGANIC_NON_HALOGEN', {
                name: 'Glucose',
                formula: 'C6H12O6',
                solutionContext: aqueousContext,
            }),
        ]);

        expect(result.category).toBe('UNKNOWN');
        expect(result.label).toBe('mix_label_aqueous_organic_check');
        expect(result.isSafe).toBe(false);
    });

    it('uses unknown-matrix review and shows neat/solid basis when the solvent is unknown', () => {
        const result = analyzeMixture([
            createCartItem('ACID', {
                name: 'Hydrochloric acid',
                formula: 'HCl',
                solutionContext: unknownMatrixContext,
            }),
        ]);

        expect(result.category).toBe('UNKNOWN');
        expect(result.basis).toBe('unknown_matrix');
        expect(result.baseLabel).toBe('mix_label_acid');
        expect(result.contextWarnings).toContain('mix_context_warning_unknown_matrix');
    });

    it('preserves legacy cart behavior when no solution context exists', () => {
        const result = analyzeMixture([
            createCartItem('ORGANIC_NON_HALOGEN', {
                name: 'Acetone',
                formula: 'C3H6O',
            }),
        ]);

        expect(result.category).toBe('ORGANIC_NON_HALOGEN');
        expect(result.basis).toBe('pure');
        expect(result.baseLabel).toBeUndefined();
    });
});
