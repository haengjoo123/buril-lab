import { describe, expect, it } from 'vitest';
import type { DisposalCategory } from '../types';
import { wasteCategorySymbols } from './wasteCategorySymbolConfig';

const categories: DisposalCategory[] = [
    'ACID',
    'ALKALI',
    'NEUTRAL',
    'ORGANIC_HALOGEN',
    'ORGANIC_NON_HALOGEN',
    'HEAVY_METAL',
    'CYANIDE',
    'REACTIVE',
    'SOLID_WASTE',
    'SPECIAL_HAZARD',
    'UNKNOWN',
];

describe('wasteCategorySymbols', () => {
    it('provides a distinct visual symbol for every material category', () => {
        const keys = categories.map((category) => wasteCategorySymbols[category].key);
        const icons = categories.map((category) => wasteCategorySymbols[category].Icon);

        expect(new Set(keys).size).toBe(categories.length);
        expect(new Set(icons).size).toBe(categories.length);
        expect(Object.keys(wasteCategorySymbols)).toHaveLength(categories.length);
    });
});
