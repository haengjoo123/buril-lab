import { describe, expect, it } from 'vitest';
import { estimateTotalVolumeMl, parseCapacityMeasurement } from './capacityParser';

describe('capacityParser', () => {
    it('treats comma-separated thousands as a grouped amount', () => {
        expect(parseCapacityMeasurement('1,000 mL')).toMatchObject({
            numericValue: 1_000,
            unit: 'mL',
            volumeMl: 1_000,
        });
    });

    it('expands multiplicative package labels before applying inventory quantity', () => {
        expect(parseCapacityMeasurement('2 x 500 mL')).toMatchObject({
            numericValue: 1_000,
            unit: 'mL',
            volumeMl: 1_000,
        });
        expect(estimateTotalVolumeMl('2 x 500 mL', 3)).toBe(3_000);
    });

    it('rejects negative, zero, partial, and non-finite measurements', () => {
        for (const value of ['-500 mL', '2 x -500 mL', '0 mL', 'about 500 mL', '500 mL bottle']) {
            expect(parseCapacityMeasurement(value).numericValue, value).toBeNull();
        }
        expect(estimateTotalVolumeMl('500 mL', -1)).toBeNull();
        expect(estimateTotalVolumeMl('500 mL', Number.NaN)).toBeNull();
    });

    it('normalizes mass as well as volume for the cart suggestion path', () => {
        expect(parseCapacityMeasurement('2 x 1.5 kg')).toMatchObject({
            numericValue: 3,
            unit: 'kg',
            massMg: 3_000_000,
            volumeMl: null,
        });
    });
});
