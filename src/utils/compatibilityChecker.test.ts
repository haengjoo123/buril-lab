import { describe, expect, it } from 'vitest';
import type { CartItem, DisposalCategory } from '../types';
import { checkCompatibility } from './compatibilityChecker';

function item(
    name: string,
    formula: string,
    category: DisposalCategory,
    options: {
        hCodes?: string[];
        ph?: number;
        solubility?: string;
        isOrganic?: boolean;
    } = {},
): CartItem {
    return {
        chemical: {
            id: name,
            name,
            casNumber: 'n/a',
            molecularFormula: formula,
            properties: {
                isOrganic: options.isOrganic ?? false,
                isHalogenated: false,
                ph: options.ph,
            },
            physicalProperties: { solubility: options.solubility },
            ghs: options.hCodes
                ? { signal: 'Danger', hazardStatements: options.hCodes }
                : undefined,
        },
        category,
        binColor: 'bg-gray-400',
        label: category,
        reason: category,
        isSafe: category !== 'UNKNOWN',
    };
}

describe('checkCompatibility V2 safety corrections', () => {
    it('detects acid + sodium cyanide without requiring a pH value', () => {
        const warnings = checkCompatibility([
            item('Hydrochloric acid', 'HCl', 'ACID'),
            item('Sodium cyanide', 'NaCN', 'CYANIDE'),
        ]);

        expect(warnings).toEqual(expect.arrayContaining([
            expect.objectContaining({ severity: 'DANGER', ruleId: 'acid_cyanide' }),
        ]));
    });

    it('does not mistake sodium cyanide for elemental sodium metal', () => {
        const warnings = checkCompatibility([
            item('Hydrochloric acid', 'HCl', 'ACID'),
            item('Sodium cyanide', 'NaCN', 'CYANIDE'),
        ]);

        expect(warnings.some(({ ruleId }) => ruleId === 'acid_metal')).toBe(false);
    });

    it('does not mistake Korean sodium-cyanide labels for elemental sodium', () => {
        const warnings = checkCompatibility([
            item('염산', 'HCl', 'ACID'),
            item('시안화나트륨', 'NaCN', 'CYANIDE'),
        ]);

        expect(warnings.some(({ ruleId }) => ruleId === 'acid_cyanide')).toBe(true);
        expect(warnings.some(({ ruleId }) => ruleId === 'acid_metal')).toBe(false);
    });

    it('still detects actual elemental sodium as a reactive metal', () => {
        const warnings = checkCompatibility([
            item('Hydrochloric acid', 'HCl', 'ACID'),
            item('Sodium metal', 'Na', 'REACTIVE'),
        ]);

        expect(warnings).toEqual(expect.arrayContaining([
            expect.objectContaining({ severity: 'WARNING', ruleId: 'acid_metal' }),
        ]));
    });

    it('does not parse "insoluble in water" as an aqueous material', () => {
        const warnings = checkCompatibility([
            item('Calcium carbide', 'CaC2', 'REACTIVE', { hCodes: ['H260'] }),
            item('Hydrocarbon oil', 'C10H22', 'ORGANIC_NON_HALOGEN', {
                solubility: 'insoluble in water',
                isOrganic: true,
            }),
        ]);

        expect(warnings.some(({ ruleId }) => ruleId === 'water_reactive')).toBe(false);
    });

    it('does not treat water solubility as proof that the current batch is aqueous', () => {
        const warnings = checkCompatibility([
            item('Calcium carbide', 'CaC2', 'REACTIVE', { hCodes: ['H260'] }),
            item('Water-soluble salt', 'NaCl', 'NEUTRAL', {
                solubility: 'soluble in water',
            }),
        ], { matrix: 'organic_non_halogenated' });

        expect(warnings.some(({ ruleId }) => ruleId === 'water_reactive')).toBe(false);
    });

    it('detects a water-reactive material when the batch matrix is confirmed aqueous', () => {
        const warnings = checkCompatibility([
            item('Calcium carbide', 'CaC2', 'REACTIVE', { hCodes: ['H260'] }),
            item('Water-soluble salt', 'NaCl', 'NEUTRAL', {
                solubility: 'soluble in water',
            }),
        ], { matrix: 'aqueous' });

        expect(warnings).toEqual(expect.arrayContaining([
            expect.objectContaining({ severity: 'DANGER', ruleId: 'water_reactive' }),
        ]));
    });
});
