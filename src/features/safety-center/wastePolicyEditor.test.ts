import { describe, expect, it } from 'vitest';
import type { ActiveWastePolicy } from '../../services/wastePolicyService';
import {
  createWastePolicyEditorDraft,
  validateWastePolicyEditorDraft,
  WASTE_POLICY_STREAMS,
} from './wastePolicyEditor';

describe('waste policy editor', () => {
  it('fills every stable stream while preserving the system policy as the first base', () => {
    const systemPolicy: ActiveWastePolicy = {
      resolvedStreams: [{
        streamCode: 'ORGANIC_NON_HALOGENATED',
        displayNameKo: '기관 기본 유기계',
        displayNameEn: 'Base organic',
        containerLabel: '유기계 폐액통',
        location: 'B동 1층',
        allowedHazardFlags: ['FLAMMABLE'],
        blockedHazardFlags: ['OXIDIZER'],
        prohibitions: ['산화제 혼합 금지'],
        labelRequirements: ['주요 성분'],
        sourceRefs: [{ title: '기본 지침', url: 'https://example.edu/sop' }],
        isEnabled: true,
        sortOrder: 3,
        inheritedPhysical: {
          containerLabel: '유기계 폐액통',
          containerColor: null,
          location: 'B동 1층',
          handlerContact: null,
        },
        labOverride: null,
      }],
    };

    const draft = createWastePolicyEditorDraft(null, systemPolicy, new Date(2026, 7, 2, 9, 5));

    expect(draft.streams).toHaveLength(WASTE_POLICY_STREAMS.length);
    expect(new Set(draft.streams.map(({ streamCode }) => streamCode)).size).toBe(10);
    expect(draft.versionLabel).toBe('institution-20260802-0905');
    expect(draft.streams.find(({ streamCode }) => streamCode === 'ORGANIC_NON_HALOGENATED')).toMatchObject({
      containerLabel: '유기계 폐액통',
      location: 'B동 1층',
      isEnabled: true,
    });
    expect(draft.streams.find(({ streamCode }) => streamCode === 'ACID_AQUEOUS')?.isEnabled).toBe(false);
  });

  it('does not require local container metadata and rejects non-https evidence and SOP links', () => {
    const draft = createWastePolicyEditorDraft(null, null, new Date(2026, 7, 2, 9, 5));
    draft.sourceRefs = [{ title: '기관 지침', url: 'http://example.edu/sop' }];
    draft.streams[0] = {
      ...draft.streams[0],
      isEnabled: true,
      containerLabel: '',
      location: '',
      sopUrl: 'javascript:alert(1)',
    };

    const result = validateWastePolicyEditorDraft(draft);

    expect(result.fieldErrors['sourceRefs.0.url']).toContain('https://');
    expect(result.fieldErrors['streams.ACID_AQUEOUS.containerLabel']).toBeUndefined();
    expect(result.fieldErrors['streams.ACID_AQUEOUS.location']).toBeUndefined();
    expect(result.fieldErrors['streams.ACID_AQUEOUS.sopUrl']).toContain('https://');
  });

  it('does not allow a policy with every stream disabled', () => {
    const draft = createWastePolicyEditorDraft(null, null);
    const result = validateWastePolicyEditorDraft(draft);

    expect(result.errors).toContain('사용할 폐액 분류를 하나 이상 활성화해 주세요.');
  });
});
