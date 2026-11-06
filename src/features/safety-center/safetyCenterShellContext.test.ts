import { describe, expect, it } from 'vitest';
import { getSafetyCenterShellMode } from './safetyCenterShellContext';

describe('getSafetyCenterShellMode', () => {
  it('stays in loading until the first center lookup settles', () => {
    expect(getSafetyCenterShellMode({ hasLoadedCenters: false, centerStatus: 'approved' })).toBe('loading');
  });

  it('shows the application form when the user has no center', () => {
    expect(getSafetyCenterShellMode({ hasLoadedCenters: true, centerStatus: null })).toBe('apply');
    expect(getSafetyCenterShellMode({ hasLoadedCenters: true, centerStatus: undefined })).toBe('apply');
  });

  it('keeps section navigation hidden until the center is approved', () => {
    expect(getSafetyCenterShellMode({ hasLoadedCenters: true, centerStatus: 'pending' })).toBe('pending');
    expect(getSafetyCenterShellMode({ hasLoadedCenters: true, centerStatus: 'rejected' })).toBe('pending');
    expect(getSafetyCenterShellMode({ hasLoadedCenters: true, centerStatus: 'approved' })).toBe('active');
  });
});
