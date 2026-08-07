import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getExpiryStatus } from './expiryStatus';

describe('expiryStatus', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 7, 7, 12, 0, 0));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not classify an invalid date as healthy', () => {
        expect(getExpiryStatus('2026-02-30')).toBeNull();
        expect(getExpiryStatus('not-a-date')).toBeNull();
    });

    it('computes days from the validated calendar date', () => {
        expect(getExpiryStatus('2026-08-08')).toMatchObject({
            level: 'critical',
            daysLeft: 1,
        });
    });
});
