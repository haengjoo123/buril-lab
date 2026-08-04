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
