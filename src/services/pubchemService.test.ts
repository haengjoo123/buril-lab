import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabaseClient', () => ({
    supabase: {
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
        },
    },
}));

import { clearPubChemCache, lookupGHSByCASLegacy as lookupGHSByCAS } from './pubchemService';

const fetchMock = vi.fn();

function jsonResponse(data: unknown, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: vi.fn().mockResolvedValue(data),
    };
}

function ghsResponse() {
    return jsonResponse({
        Record: {
            RecordTitle: 'Acetone',
            Section: [{
                TOCHeading: 'GHS Classification',
                Information: [
                    {
                        Name: 'GHS Hazard Statements',
                        Value: { StringWithMarkup: [{ String: 'H225 Highly flammable liquid and vapor' }] },
                    },
                    {
                        Name: 'Signal',
                        Value: { StringWithMarkup: [{ String: 'Danger' }] },
                    },
                ],
            }],
        },
    });
}

describe('lookupGHSByCAS cache policy', () => {
    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
        clearPubChemCache();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('does not cache transient PubChem failures', async () => {
        fetchMock.mockRejectedValue(new Error('offline'));

        const failed = await lookupGHSByCAS('67-64-1');

        expect(failed.status).toBe('transient_error');
        expect(failed.success).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(3);

        fetchMock
            .mockResolvedValueOnce(jsonResponse({ IdentifierList: { CID: [180] } }))
            .mockResolvedValueOnce(ghsResponse());

        const retried = await lookupGHSByCAS('67-64-1');

        expect(retried.status).toBe('success');
        expect(retried.hCodes).toEqual(['H225']);
        expect(fetchMock).toHaveBeenCalledTimes(5);
    });

    it('reuses a successful result from memory within its TTL', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ IdentifierList: { CID: [180] } }))
            .mockResolvedValueOnce(ghsResponse());

        const first = await lookupGHSByCAS('67-64-1');
        const second = await lookupGHSByCAS('67-64-1');

        expect(first.status).toBe('success');
        expect(second).toEqual(first);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not treat an empty GHS response as a successful safe result', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ IdentifierList: { CID: [180] } }))
            .mockResolvedValueOnce(jsonResponse({ Record: { RecordTitle: 'Acetone', Section: [] } }));

        const result = await lookupGHSByCAS('67-64-1');

        expect(result.status).toBe('no_ghs');
        expect(result.success).toBe(false);
    });
});
