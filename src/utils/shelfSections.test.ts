import { describe, expect, it } from 'vitest';
import { getShelfSectionByIndex, getShelfSectionCount, getShelfSections } from './shelfSections';

describe('shelfSections', () => {
    it('creates left-to-right sections from dividers', () => {
        expect(getShelfSections([30, 70])).toEqual([
            { index: 1, start: 0, end: 30 },
            { index: 2, start: 30, end: 70 },
            { index: 3, start: 70, end: 100 },
        ]);
    });

    it('normalizes invalid, duplicate, and unsorted divider values', () => {
        expect(getShelfSections([80, 20, 20, -5, 120, Number.NaN])).toEqual([
            { index: 1, start: 0, end: 20 },
            { index: 2, start: 20, end: 80 },
            { index: 3, start: 80, end: 100 },
        ]);
    });

    it('supports JSON-encoded divider values from the database', () => {
        expect(getShelfSectionCount('[25,50,75]')).toBe(4);
        expect(getShelfSectionByIndex('[25,50,75]', 3)).toEqual({ index: 3, start: 50, end: 75 });
    });
});
