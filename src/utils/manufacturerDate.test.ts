import { describe, expect, it } from 'vitest';
import {
    getManufacturerDateLabelKey,
    hasManufacturerDate,
    normalizeManufacturerDateType,
} from './manufacturerDate';

describe('manufacturer date type helpers', () => {
    it('defaults an absent or invalid type to unlabeled', () => {
        expect(normalizeManufacturerDateType(undefined)).toBe('unlabeled');
        expect(normalizeManufacturerDateType('best_before')).toBe('unlabeled');
    });

    it('tracks both expiry and minimum shelf life dates', () => {
        expect(hasManufacturerDate('expiry')).toBe(true);
        expect(hasManufacturerDate('minimum_shelf_life')).toBe(true);
        expect(hasManufacturerDate('unlabeled')).toBe(false);
    });

    it('uses the display label that matches the saved type', () => {
        expect(getManufacturerDateLabelKey('minimum_shelf_life'))
            .toBe('manufacturer_date_type_minimum_shelf_life');
    });
});
