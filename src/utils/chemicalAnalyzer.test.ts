import { describe, expect, it } from 'vitest';
import type { Chemical } from '../types';
import { analyzeChemical } from './chemicalAnalyzer';

const chemicalWithReferencePh = (referencePh: number): Chemical => ({
    id: `reference-${referencePh}`,
    name: 'Reference-only inorganic material',
    casNumber: '7732-18-5',
    molecularFormula: 'NaCl',
    properties: {
        isOrganic: false,
        isHalogenated: false,
        referencePh,
        phSource: 'kosha_reference',
    },
});

describe('analyzeChemical reference pH handling', () => {
    it.each([3, 7, 11])(
        'does not classify an otherwise unresolved material from reference pH %s',
        (referencePh) => {
            expect(analyzeChemical(chemicalWithReferencePh(referencePh)).category).toBe('UNKNOWN');
        },
    );
});

describe('analyzeChemical independent hazard detection', () => {
    it('preserves heavy-metal and reactive/oxidizer evidence despite legacy precedence', () => {
        const result = analyzeChemical({
            id: 'silver-nitrate',
            name: 'Silver nitrate',
            casNumber: '7761-88-8',
            molecularFormula: 'AgNO3',
            ghs: {
                signal: 'Danger',
                hazardStatements: ['H272: May intensify fire; oxidizer'],
            },
        });

        expect(result.category).toBe('REACTIVE');
        expect(result.hazardProfile?.flags).toEqual(expect.arrayContaining([
            'HEAVY_METAL',
            'OXIDIZER',
            'REACTIVE',
        ]));
        expect(result.hazardProfile?.evidence).toEqual(expect.arrayContaining([
            expect.objectContaining({
                flag: 'HEAVY_METAL',
                source: 'formula_element',
                value: 'Ag',
                confidence: 'confirmed',
            }),
            expect.objectContaining({
                flag: 'OXIDIZER',
                source: 'h_code',
                value: 'H272',
                confidence: 'confirmed',
            }),
        ]));
    });

    it('keeps a name-only reactive signal inferred while formula evidence stays confirmed', () => {
        const result = analyzeChemical({
            id: 'silver-nitrate-name-fallback',
            name: 'Silver nitrate',
            casNumber: '7761-88-8',
            molecularFormula: 'AgNO3',
        });

        expect(result.hazardProfile?.evidence).toEqual(expect.arrayContaining([
            expect.objectContaining({
                flag: 'REACTIVE',
                source: 'name_pattern',
                confidence: 'inferred',
            }),
            expect.objectContaining({
                flag: 'HEAVY_METAL',
                source: 'formula_element',
                confidence: 'confirmed',
            }),
        ]));
    });
});

describe('analyzeChemical high-risk review classification', () => {
    it('treats a P-list CAS match as a review signal rather than a Korean legal classification', () => {
        const result = analyzeChemical({
            id: 'acrolein',
            name: 'Acrolein',
            casNumber: '107-02-8',
            molecularFormula: 'C3H4O',
        });

        expect(result.category).toBe('SPECIAL_HAZARD');
        expect(result.reason).toBe('reason_us_rcra_p_list_match');
        expect(result.isSafe).toBe(false);
    });

    it('keeps fatal acute-toxicity evidence distinct from a P-list CAS match', () => {
        const result = analyzeChemical({
            id: 'acute-toxin-test',
            name: 'Acute toxin test material',
            casNumber: '123-45-6',
            molecularFormula: 'C2H6O',
            ghs: {
                signal: 'Danger',
                hazardStatements: ['H300: Fatal if swallowed'],
            },
        });

        expect(result.category).toBe('SPECIAL_HAZARD');
        expect(result.reason).toBe('reason_fatal_acute_toxicity');
        expect(result.isSafe).toBe(false);
    });
});
