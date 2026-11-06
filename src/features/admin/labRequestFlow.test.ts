import { describe, expect, it } from 'vitest';
import { canLabCloseRequest, nextLabRequestStatus, type LabRequestLinkState } from './labRequestFlow';

const CENTER = 'center-1';
const OTHER_CENTER = 'center-2';

const link = (overrides: Partial<LabRequestLinkState> = {}): LabRequestLinkState => ({
  center_id: CENTER,
  link_status: 'approved',
  center_status: 'approved',
  ...overrides,
});

describe('nextLabRequestStatus', () => {
  it('lets the lab start and then reply, and stops there: the center closes the request', () => {
    expect(nextLabRequestStatus('open')).toBe('in_progress');
    expect(nextLabRequestStatus('in_progress')).toBe('submitted');
    expect(nextLabRequestStatus('submitted')).toBeNull();
    expect(nextLabRequestStatus('resolved')).toBeNull();
  });
});

describe('canLabCloseRequest', () => {
  const request = { status: 'submitted' as const, center_id: CENTER };

  it('leaves closing to the center while it is linked and approved', () => {
    expect(canLabCloseRequest(request, [link()])).toBe(false);
    expect(canLabCloseRequest({ ...request, status: 'open' }, [link(), link({ center_id: OTHER_CENTER, link_status: 'revoked' })])).toBe(false);
  });

  it('lets the lab close a request the center can no longer see', () => {
    expect(canLabCloseRequest(request, [link({ link_status: 'revoked' })])).toBe(true);
    expect(canLabCloseRequest(request, [link({ link_status: 'requested' })])).toBe(true);
    expect(canLabCloseRequest(request, [link({ link_status: 'rejected' })])).toBe(true);
    expect(canLabCloseRequest(request, [link({ center_status: 'rejected' })])).toBe(true);
    expect(canLabCloseRequest(request, [link({ center_status: 'pending' })])).toBe(true);
    expect(canLabCloseRequest(request, [])).toBe(true);
    expect(canLabCloseRequest(request, [link({ center_id: OTHER_CENTER })])).toBe(true);
  });

  it('offers nothing without the links (not an admin) or for a closed request', () => {
    expect(canLabCloseRequest(request, null)).toBe(false);
    expect(canLabCloseRequest({ ...request, status: 'resolved' }, [])).toBe(false);
  });
});
