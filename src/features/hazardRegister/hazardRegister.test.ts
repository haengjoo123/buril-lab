import { describe, expect, it } from 'vitest';
import { buildRegisterRows, type RegisterItem } from './hazardRegister';
import { hazardRegisterCopy } from './copy';

const item = (overrides: Partial<RegisterItem>): RegisterItem => ({
    name: 'Acetone', casNumber: '67-64-1', brand: 'Daejung', quantity: 1, capacity: '1 L', location: 'Cabinet A',
    expiryDate: null, ghs: { hCodes: ['H319', 'H225', 'H225'], signalWord: 'Danger', pictograms: ['GHS07', 'GHS02'], classified: true },
    hazardGroups: ['인화성'], hasSds: false, ...overrides,
});

describe('prior hazard analysis list', () => {
    const copy = hazardRegisterCopy('ko');

    it('merges the same product at one location and keeps the earliest expiry', () => {
        const rows = buildRegisterRows([
            item({ quantity: 2, expiryDate: '2027-05-01' }),
            item({ quantity: 1, capacity: '4 L', expiryDate: '2027-01-01', hasSds: true }),
            item({ location: 'Fridge' }),
        ], copy.row);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            index: 1, location: 'Cabinet A', holding: '3 × 1 L, 4 L', expiryDate: '2027-01-01', sds: '보관',
            signalWord: '위험', pictograms: 'GHS02, GHS07',
        });
        expect(rows[0].hazardStatements.split('\n')).toEqual([
            expect.stringMatching(/^H225 /),
            expect.stringMatching(/^H319 /),
        ]);
        expect(rows[1]).toMatchObject({ index: 2, location: 'Fridge', holding: '1 × 1 L' });
    });

    it('flags rows a person still has to check', () => {
        const rows = buildRegisterRows([
            item({ name: 'Unknown mixture', casNumber: null, ghs: null }),
            item({ name: 'Water', casNumber: '7732-18-5', ghs: { hCodes: [], pictograms: [], classified: false } }),
            item({ name: 'Ethanol', casNumber: '64-17-5', ghs: null }),
        ], copy.row);
        expect(rows.map((row) => [row.name, row.ghsStatus])).toEqual([
            ['Ethanol', '조회 전(확인 필요)'],
            ['Unknown mixture', 'CAS 없음(확인 필요)'],
            ['Water', '분류 없음'],
        ]);
    });

    it('keeps English statements as bare codes and leaves the manual columns to the lab', () => {
        const en = hazardRegisterCopy('en');
        const [row] = buildRegisterRows([item({ ghs: { hCodes: ['H225'], signalWord: 'Warning', pictograms: [], classified: true } })], en.row);
        expect(row).toMatchObject({ hazardStatements: 'H225', signalWord: 'Warning' });
        expect(en.sheet.headers).toHaveLength(13);
        expect(copy.sheet.manualHeaders.length).toBeGreaterThan(0);
        expect(copy.sheet.guide.join(' ')).toContain('법정 서식을 대신하지 않습니다');
    });
});
