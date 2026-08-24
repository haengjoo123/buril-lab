import { describe, expect, it } from 'vitest';
import { canCommitWasteLogListRequest } from './wasteLogRequestScope';

describe('waste-log request scope', () => {
    it('rejects a late response from the previous lab', () => {
        const oldRequest = { requestId: 7, labId: 'old-lab' };
        expect(canCommitWasteLogListRequest(oldRequest, 7, 'new-lab')).toBe(false);
    });

    it('rejects an older request in the same lab and accepts only the active one', () => {
        expect(canCommitWasteLogListRequest({ requestId: 6, labId: 'lab-a' }, 7, 'lab-a')).toBe(false);
        expect(canCommitWasteLogListRequest({ requestId: 7, labId: 'lab-a' }, 7, 'lab-a')).toBe(true);
    });
});
