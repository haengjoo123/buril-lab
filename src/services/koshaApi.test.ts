import { describe, expect, it } from 'vitest';
import { parseKoshaPhDetail } from './koshaApi';

describe('parseKoshaPhDetail', () => {
    it('reads plain and explicitly labeled reference pH values', () => {
        expect(parseKoshaPhDetail('7')).toBe(7);
        expect(parseKoshaPhDetail('pH: 3.5 at 20 °C')).toBe(3.5);
    });

    it('does not mistake temperature or concentration for pH', () => {
        expect(parseKoshaPhDetail('20 ℃에서 3.5 (1% 수용액)')).toBe(3.5);
        expect(parseKoshaPhDetail('20 ℃')).toBeUndefined();
        expect(parseKoshaPhDetail('1% solution')).toBeUndefined();
    });

    it('rejects out-of-range and ambiguous values', () => {
        expect(parseKoshaPhDetail('pH 20')).toBeUndefined();
        expect(parseKoshaPhDetail('2.5 또는 7.0')).toBeUndefined();
        expect(parseKoshaPhDetail('자료없음')).toBeUndefined();
    });
});
