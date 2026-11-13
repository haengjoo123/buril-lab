import { describe, expect, it } from 'vitest';
import { SDS_MAX_BYTES, matchSdsDocuments, normalizeSdsRow, sdsKeyFrom, toSdsError, validateSdsFile, type SdsDocument } from '../../services/inventorySdsService';

const doc = (overrides: Partial<SdsDocument>): SdsDocument => ({
    id: 'd', labId: null, casNumber: null, brand: null, productNumber: null, fileName: 'sds.pdf', objectPath: 'u-x/d.pdf',
    mimeType: 'application/pdf', sizeBytes: 10, revisionDate: null, uploadedBy: null, createdAt: '2026-11-14T00:00:00Z', ...overrides,
});

describe('matchSdsDocuments', () => {
    const documents = [
        doc({ id: 'cas', casNumber: '67-64-1' }),
        doc({ id: 'sigma', productNumber: '179124', brand: 'Sigma-Aldrich' }),
        doc({ id: 'nobrand', productNumber: 'A-100' }),
    ];

    it('matches by CAS number, or by product number when the brands agree', () => {
        expect(matchSdsDocuments(documents, { casNumber: ' 67-64-1 ' }).map((d) => d.id)).toEqual(['cas']);
        expect(matchSdsDocuments(documents, { productNumber: '179124', brand: 'sigma-aldrich' }).map((d) => d.id)).toEqual(['sigma']);
        expect(matchSdsDocuments(documents, { productNumber: '179124', brand: 'Duksan' })).toEqual([]);
        expect(matchSdsDocuments(documents, { productNumber: '179124' }).map((d) => d.id)).toEqual(['sigma']);
        expect(matchSdsDocuments(documents, { productNumber: 'a-100', brand: 'Daejung' }).map((d) => d.id)).toEqual(['nobrand']);
        expect(matchSdsDocuments(documents, {})).toEqual([]);
    });
});

describe('SDS input checks', () => {
    it('accepts PDF and images up to 20 MB', () => {
        expect(() => validateSdsFile({ type: 'application/pdf', size: SDS_MAX_BYTES })).not.toThrow();
        expect(() => validateSdsFile({ type: 'image/jpeg', size: 10 })).not.toThrow();
        expect(() => validateSdsFile({ type: 'application/pdf', size: SDS_MAX_BYTES + 1 })).toThrow('20 MB');
        expect(() => validateSdsFile({ type: 'application/msword', size: 10 })).toThrow('PDF');
    });

    it('needs a valid CAS number or a product number', () => {
        expect(sdsKeyFrom({ casNumber: ' 67-64-1 ', brand: ' Sigma ' })).toEqual({ casNumber: '67-64-1', brand: 'Sigma', productNumber: null });
        expect(sdsKeyFrom({ casNumber: 'not-a-cas', productNumber: 'P-1' })).toEqual({ casNumber: null, brand: null, productNumber: 'P-1' });
        expect(() => sdsKeyFrom({ casNumber: 'not-a-cas' })).toThrow();
        expect(() => sdsKeyFrom({})).toThrow();
    });

    it('maps database errors and rows', () => {
        expect(toSdsError({ message: 'INVENTORY_SDS_ADMIN_REQUIRED' }).code).toBe('admin_required');
        expect(toSdsError({ message: 'INVENTORY_SDS_ACCESS_DENIED' }).code).toBe('access_denied');
        expect(toSdsError({ message: 'INVENTORY_SDS_INVALID_INPUT' }).code).toBe('missing_key');
        expect(toSdsError(new Error('offline')).code).toBe('unknown');
        expect(normalizeSdsRow({ id: 'a', object_path: 'x/a.pdf', size_bytes: '42', cas_number: '' })).toMatchObject({ sizeBytes: 42, casNumber: null });
        expect(() => normalizeSdsRow({ id: 'a' })).toThrow();
    });
});
