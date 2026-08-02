import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('./supabaseClient', () => ({
    supabase: { rpc: mocks.rpc },
}));

import {
    activateSafetyCenterWastePolicyV2,
    getActiveWastePolicyV2,
    saveSafetyCenterWastePolicyDraftV2,
    upsertLabWasteStreamOverrideV2,
} from './wastePolicyService';

const CENTER_ID = '11111111-1111-4111-8111-111111111111';
const POLICY_ID = '22222222-2222-4222-8222-222222222222';

describe('getActiveWastePolicyV2', () => {
    beforeEach(() => mocks.rpc.mockReset());

    it('preserves policy hazard constraints and structured source references', async () => {
        mocks.rpc.mockResolvedValue({
            data: {
                systemPolicyVersionId: 'policy-1',
                resolvedStreams: [{
                    streamCode: 'ORGANIC_NON_HALOGENATED',
                    displayNameKo: '비할로겐 폐액',
                    displayNameEn: 'Non-halogenated waste',
                    containerLabel: '유기 폐액통 1',
                    location: '폐기물실 A',
                    isEnabled: false,
                    inheritedPhysical: {
                        containerLabel: '기관 유기 폐액통',
                        location: '기관 폐기물실',
                        handlerContact: '기관 안전팀',
                    },
                    labOverride: {
                        id: 'override-1',
                        containerLabel: null,
                        location: '연구실 폐기물실',
                        replacementLocation: null,
                        isDisabled: true,
                    },
                    allowedHazardFlags: ['FLAMMABLE', 'NOT_A_FLAG'],
                    blockedHazardFlags: ['OXIDIZER'],
                    sourceRefs: [{
                        title: '기관 폐액 SOP',
                        url: 'https://example.edu/sop',
                    }],
                }, {
                    streamCode: 'NOT_A_STREAM',
                    displayNameKo: 'Invalid',
                    displayNameEn: 'Invalid',
                }],
            },
            error: null,
        });

        const policy = await getActiveWastePolicyV2('lab-1');

        expect(mocks.rpc).toHaveBeenCalledWith('get_active_waste_policy_v2', {
            p_lab_id: 'lab-1',
        });
        expect(policy.resolvedStreams[0]).toMatchObject({
            allowedHazardFlags: ['FLAMMABLE'],
            blockedHazardFlags: ['OXIDIZER'],
            sourceRefs: [{
                title: '기관 폐액 SOP',
                url: 'https://example.edu/sop',
            }],
            isEnabled: false,
            inheritedPhysical: {
                containerLabel: '기관 유기 폐액통',
                location: '기관 폐기물실',
                handlerContact: '기관 안전팀',
            },
            labOverride: {
                id: 'override-1',
                location: '연구실 폐기물실',
                replacementLocation: null,
                isDisabled: true,
            },
        });
        expect(policy.resolvedStreams).toHaveLength(1);
    });

    it('normalizes a matching lab override receipt without sending safety-rule fields', async () => {
        mocks.rpc.mockResolvedValue({
            data: {
                id: 'override-1',
                labId: 'lab-1',
                streamCode: 'ORGANIC_NON_HALOGENATED',
                containerLabel: 'Organic waste 1',
                containerColor: '#336699',
                location: 'Waste room A',
                handlerContact: 'Safety office',
                replacementLocation: 'Annex waste room',
                isDisabled: true,
                updatedAt: '2026-08-02T00:00:00.000Z',
                reset: false,
            },
            error: null,
        });

        await expect(upsertLabWasteStreamOverrideV2({
            labId: 'lab-1',
            streamCode: 'ORGANIC_NON_HALOGENATED',
            containerLabel: '  Organic waste 1 ',
            containerColor: '#336699',
            location: ' Waste room A ',
            handlerContact: ' Safety office ',
            replacementLocation: ' Annex waste room ',
            isDisabled: true,
        })).resolves.toMatchObject({
            id: 'override-1',
            labId: 'lab-1',
            streamCode: 'ORGANIC_NON_HALOGENATED',
            reset: false,
        });

        expect(mocks.rpc).toHaveBeenCalledWith('upsert_lab_waste_stream_override_v2', {
            p_lab_id: 'lab-1',
            p_stream_code: 'ORGANIC_NON_HALOGENATED',
            p_container_label: 'Organic waste 1',
            p_container_color: '#336699',
            p_location: 'Waste room A',
            p_handler_contact: 'Safety office',
            p_replacement_location: 'Annex waste room',
            p_is_disabled: true,
        });
    });

    it('drops a replacement location when the local destination is active', async () => {
        mocks.rpc.mockResolvedValue({
            data: {
                id: 'override-2',
                labId: 'lab-1',
                streamCode: 'ORGANIC_NON_HALOGENATED',
                replacementLocation: null,
                isDisabled: false,
                reset: false,
            },
            error: null,
        });

        await upsertLabWasteStreamOverrideV2({
            labId: 'lab-1',
            streamCode: 'ORGANIC_NON_HALOGENATED',
            replacementLocation: 'Must not be persisted',
            isDisabled: false,
        });

        expect(mocks.rpc).toHaveBeenCalledWith('upsert_lab_waste_stream_override_v2', {
            p_lab_id: 'lab-1',
            p_stream_code: 'ORGANIC_NON_HALOGENATED',
            p_container_label: null,
            p_container_color: null,
            p_location: null,
            p_handler_contact: null,
            p_replacement_location: null,
            p_is_disabled: false,
        });
    });

    it('rejects a lab override receipt for a different scope or stream', async () => {
        mocks.rpc.mockResolvedValue({
            data: {
                labId: 'lab-2',
                streamCode: 'ACID_AQUEOUS',
                reset: false,
            },
            error: null,
        });

        await expect(upsertLabWasteStreamOverrideV2({
            labId: 'lab-1',
            streamCode: 'ORGANIC_NON_HALOGENATED',
        })).rejects.toThrow('invalid receipt');
    });

    it('creates a complete immutable safety-center policy draft through the RPC', async () => {
        mocks.rpc.mockResolvedValue({
            data: {
                id: POLICY_ID,
                centerId: CENTER_ID,
                policyKey: 'center-policy-key',
                versionLabel: '2026.08',
                status: 'draft',
                streamCount: 1,
                parentPolicyVersionId: '33333333-3333-4333-8333-333333333333',
            },
            error: null,
        });

        await expect(saveSafetyCenterWastePolicyDraftV2({
            centerId: CENTER_ID,
            versionLabel: ' 2026.08 ',
            name: ' 기관 폐액 정책 ',
            sourceRefs: [{ title: ' 기관 SOP ', url: ' https://example.edu/sop ' }],
            streams: [{
                streamCode: 'ORGANIC_NON_HALOGENATED',
                displayNameKo: '비할로겐 폐액',
                displayNameEn: 'Non-halogenated waste',
                containerLabel: ' 유기 폐액통 1 ',
                location: ' 폐기물실 A ',
                allowedHazardFlags: ['FLAMMABLE'],
                blockedHazardFlags: ['OXIDIZER'],
                prohibitions: [' 임의 중화 금지 '],
                labelRequirements: [' 성분명 '],
                isEnabled: true,
                sortOrder: 40,
            }],
        })).resolves.toMatchObject({
            id: POLICY_ID,
            centerId: CENTER_ID,
            status: 'draft',
            streamCount: 1,
        });

        expect(mocks.rpc).toHaveBeenCalledWith('save_safety_center_waste_policy_draft_v2', {
            p_center_id: CENTER_ID,
            p_version_label: '2026.08',
            p_name: '기관 폐액 정책',
            p_streams: [expect.objectContaining({
                streamCode: 'ORGANIC_NON_HALOGENATED',
                containerLabel: '유기 폐액통 1',
                location: '폐기물실 A',
                allowedHazardFlags: ['FLAMMABLE'],
                blockedHazardFlags: ['OXIDIZER'],
            })],
            p_source_refs: [{ title: '기관 SOP', url: 'https://example.edu/sop' }],
        });
    });

    it('activates only an exact validated safety-center policy receipt', async () => {
        mocks.rpc.mockResolvedValue({
            data: {
                id: POLICY_ID,
                policyKey: 'center-policy-key',
                scopeType: 'safety_center',
                status: 'active',
                activatedAt: '2026-08-02T00:00:00.000Z',
                activatedBy: '44444444-4444-4444-8444-444444444444',
            },
            error: null,
        });

        await expect(activateSafetyCenterWastePolicyV2(POLICY_ID)).resolves.toMatchObject({
            id: POLICY_ID,
            status: 'active',
            scopeType: 'safety_center',
        });
        expect(mocks.rpc).toHaveBeenCalledWith('activate_waste_policy_v2', {
            p_policy_version_id: POLICY_ID,
        });
    });
});
