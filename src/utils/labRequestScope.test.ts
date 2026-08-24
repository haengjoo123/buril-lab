import { describe, expect, it } from 'vitest';
import { canCommitLabRequest, type LabRequestToken } from './labRequestScope';

describe('lab request scope', () => {
  const oldRequest: LabRequestToken = { generation: 4, labId: 'old-lab' };

  it('accepts only the active generation for the active lab', () => {
    expect(canCommitLabRequest(oldRequest, 4, 'old-lab')).toBe(true);
    expect(canCommitLabRequest(oldRequest, 5, 'old-lab')).toBe(false);
    expect(canCommitLabRequest(oldRequest, 4, 'new-lab')).toBe(false);
  });

  it('rejects a late old-lab response even if a later request reused its generation number', () => {
    expect(canCommitLabRequest(oldRequest, 4, 'new-lab')).toBe(false);
  });
});
