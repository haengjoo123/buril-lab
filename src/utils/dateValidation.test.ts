import { describe, expect, it } from 'vitest';
import { normalizeExpiryDate, parseCalendarDate } from './dateValidation';

describe('dateValidation', () => {
    it('rejects impossible calendar dates instead of allowing Date rollover', () => {
        expect(parseCalendarDate('2026-02-30')).toBeNull();
        expect(normalizeExpiryDate('not-a-date')).toBeNull();
    });

    it('normalizes supported external date formats to an ISO calendar date', () => {
        expect(normalizeExpiryDate('2026/8/7')).toBe('2026-08-07');
        expect(normalizeExpiryDate('31/12/2026')).toBe('2026-12-31');
        expect(normalizeExpiryDate('07.08.2026')).toBe('2026-08-07');
        expect(normalizeExpiryDate('August 7, 2026')).toBe('2026-08-07');
        expect(normalizeExpiryDate('2026-08-07T12:00:00Z')).toBe('2026-08-07');
    });
});
