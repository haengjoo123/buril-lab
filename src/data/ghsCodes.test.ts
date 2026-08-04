import { describe, expect, it } from 'vitest';
import { formatGhsStatementList } from './ghsCodes';

describe('formatGhsStatementList', () => {
    it('deduplicates concentration variants and translates H-codes for Korean display', () => {
        expect(formatGhsStatementList([
            'H300: Fatal if swallowed',
            'H300 (99.8%): Fatal if swallowed',
            'H314: Causes severe skin burns and eye damage',
        ], 'ko')).toEqual([
            'H300: 삼키면 치명적임',
            'H314: 피부에 심각한 화상과 눈에 손상을 일으킴',
        ]);
    });

    it('extracts every unique H-code from an aggregated statement', () => {
        expect(formatGhsStatementList([
            'H300: Fatal if swallowed · H310: Fatal in contact with skin · H300 (99.8%): duplicate',
        ], 'ko')).toEqual([
            'H300: 삼키면 치명적임',
            'H310: 피부와 접촉하면 치명적임',
        ]);
    });

    it('keeps unique source wording for English display', () => {
        expect(formatGhsStatementList([
            'H300: Fatal if swallowed',
            'H300: Fatal if swallowed',
        ], 'en')).toEqual(['H300: Fatal if swallowed']);
    });
});
