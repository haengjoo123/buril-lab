import { describe, expect, it, vi } from 'vitest';

const getJsonMock = vi.hoisted(() => vi.fn());

vi.mock('./internalApi', () => ({ getJson: getJsonMock }));

import { fetchKoshaMsds, parseKoshaPhDetail } from './koshaApi';

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

describe('fetchKoshaMsds policy boundary', () => {
    it('uses the .2 policy cache key and bypasses browser caching', async () => {
        getJsonMock.mockResolvedValueOnce({
            mode: 'link_only',
            officialUrl: 'https://msds.kosha.or.kr/MSDSInfo/kcic/msdssearchMsds.do',
            sections: [],
            missingSections: [],
        });

        await expect(fetchKoshaMsds(321)).resolves.toMatchObject({ mode: 'link_only' });
        expect(getJsonMock).toHaveBeenCalledWith(
            '/api/kosha/msds?chemId=000321&policy=20260824.2',
            { cache: 'no-store' },
        );
    });
});
