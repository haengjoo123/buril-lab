/* eslint-disable @typescript-eslint/no-explicit-any */
import i18n from '../locales/i18n';
import { supabase } from './supabaseClient';
import { InternalApiError, postJson } from './internalApi';
import type { Lab, LabMember } from '../store/useLabStore';

export const LAB_MEMBERSHIP_LIMIT = 3;
export const LAB_MEMBERSHIP_LIMIT_ERROR = `계정당 최대 ${LAB_MEMBERSHIP_LIMIT}곳의 연구실에만 가입할 수 있습니다. 관리자 연구실도 포함됩니다.`;

const LAB_MEMBERSHIP_LIMIT_DB_CODE = 'max_lab_memberships_exceeded';
const LAB_SELECT = 'id, name, created_by, created_at, institution_type, research_field';
const LAB_SELECT_WITH_INSTITUTION_NAME = `id, name, created_by, created_at, institution_name, institution_type, research_field`;
const LAB_SELECT_WITH_PASSWORD_POLICY = `${LAB_SELECT_WITH_INSTITUTION_NAME}, join_password_needs_change`;
const LAB_MEMBER_SELECT = `
                *,
                lab:labs(${LAB_SELECT})
            `;
const LAB_MEMBER_SELECT_WITH_INSTITUTION_NAME = `
                *,
                lab:labs(${LAB_SELECT_WITH_INSTITUTION_NAME})
            `;
const LAB_MEMBER_SELECT_WITH_PASSWORD_POLICY = `
                *,
                lab:labs(${LAB_SELECT_WITH_PASSWORD_POLICY})
            `;

const getErrorText = (error: unknown): string => {
    if (!error) return '';
    if (typeof error === 'string') return error;
    return [
        (error as any).message,
        (error as any).details,
        (error as any).hint,
        (error as any).error
    ].filter(Boolean).join('\n');
};

export const isLabMembershipLimitError = (error: unknown): boolean => {
    if (!error) return false;
    const message = getErrorText(error);

    return (error as { code?: unknown }).code === LAB_MEMBERSHIP_LIMIT_DB_CODE
        || message.includes(LAB_MEMBERSHIP_LIMIT_DB_CODE)
        || message.includes(LAB_MEMBERSHIP_LIMIT_ERROR)
        || message.includes(`maximum of ${LAB_MEMBERSHIP_LIMIT} labs`)
        || message.includes(`up to ${LAB_MEMBERSHIP_LIMIT} labs`);
};

const throwIfLabMembershipLimitError = (error: unknown) => {
    if (isLabMembershipLimitError(error)) {
        throw new Error(LAB_MEMBERSHIP_LIMIT_ERROR);
    }
};

const isMissingInstitutionNameColumnError = (error: unknown): boolean => {
    const message = getErrorText(error);
    return ((error as any)?.code === '42703' || message.includes('column'))
        && message.includes('institution_name');
};

const isMissingPasswordPolicyColumnError = (error: unknown): boolean => {
    const message = getErrorText(error);
    return ((error as any)?.code === '42703' || message.includes('column'))
        && message.includes('join_password_needs_change');
};

const isMissingInstitutionNameRpcArgumentError = (error: unknown): boolean => {
    const message = getErrorText(error);
    return message.includes('create_lab_secure')
        && message.includes('p_institution_name')
        && (message.includes('Could not find the function') || (error as any)?.code === 'PGRST202');
};

const fetchLabById = async (labId: string): Promise<Lab> => {
    const { data: policyData, error: policyError } = await supabase
        .from('labs')
        .select(LAB_SELECT_WITH_PASSWORD_POLICY)
        .eq('id', labId)
        .single();

    if (!policyError) return policyData as Lab;
    if (!isMissingPasswordPolicyColumnError(policyError)) {
        if (!isMissingInstitutionNameColumnError(policyError)) throw policyError;
    }

    const { data, error } = await supabase
        .from('labs')
        .select(LAB_SELECT_WITH_INSTITUTION_NAME)
        .eq('id', labId)
        .single();

    if (!error) return data as Lab;
    if (!isMissingInstitutionNameColumnError(error)) throw error;

    const { data: fallbackData, error: fallbackError } = await supabase
        .from('labs')
        .select(LAB_SELECT)
        .eq('id', labId)
        .single();

    if (fallbackError) throw fallbackError;
    return fallbackData as Lab;
};

const fetchMyLabMemberships = async (userId: string): Promise<LabMember[]> => {
    const { data: policyData, error: policyError } = await supabase
        .from('lab_members')
        .select(LAB_MEMBER_SELECT_WITH_PASSWORD_POLICY)
        .eq('user_id', userId);

    if (!policyError) return policyData as LabMember[];
    if (!isMissingPasswordPolicyColumnError(policyError)) {
        if (!isMissingInstitutionNameColumnError(policyError)) throw policyError;
    }

    const { data, error } = await supabase
        .from('lab_members')
        .select(LAB_MEMBER_SELECT_WITH_INSTITUTION_NAME)
        .eq('user_id', userId);

    if (!error) return data as LabMember[];
    if (!isMissingInstitutionNameColumnError(error)) throw error;

    const { data: fallbackData, error: fallbackError } = await supabase
        .from('lab_members')
        .select(LAB_MEMBER_SELECT)
        .eq('user_id', userId);

    if (fallbackError) throw fallbackError;
    return fallbackData as LabMember[];
};

export const labService = {
    async createLab(
        name: string,
        password?: string,
        nickname?: string,
        institutionType?: string,
        researchField?: string,
        institutionName?: string
    ): Promise<Lab> {
        const createLabParams = {
            p_name: name,
            p_password: password === '' || password === undefined ? null : password,
            p_nickname: nickname || null,
            p_institution_type: institutionType || null,
            p_research_field: researchField || null
        };
        const createLabParamsWithInstitutionName = {
            ...createLabParams,
            p_institution_name: institutionName || null
        };

        let { data, error } = await supabase.rpc('create_lab_secure', createLabParamsWithInstitutionName);

        if (error && isMissingInstitutionNameRpcArgumentError(error)) {
            ({ data, error } = await supabase.rpc('create_lab_secure', createLabParams));
        }

        if (error) {
            throwIfLabMembershipLimitError(error);
            throw error;
        }
        if (!data.success) {
            throwIfLabMembershipLimitError(data.error);
            throw new Error(data.error || i18n.t('msc_lab_create_failed'));
        }

        return fetchLabById(data.lab_id);
    },

    async joinLab(labId: string, password?: string, nickname?: string): Promise<LabMember> {
        const normalizedLabId = labId.toLowerCase();
        try {
            const result = await postJson<{ success: true; labId: string }>('/api/labs/join', {
                labId: normalizedLabId,
                password: password ?? '',
                ...(nickname ? { nickname } : {}),
            }, { signal: AbortSignal.timeout(12_000) });
            if (result.success !== true || result.labId !== normalizedLabId) {
                throw new Error('Invalid join response');
            }
        } catch (error) {
            // Never retry via join_lab: doing so would bypass a server lock or
            // repeat a membership that committed before a network interruption.
            if (error instanceof InternalApiError) {
                let message = i18n.t('msc_lab_join_unavailable');
                let code = error.code;
                if (error.code === 'already_member') {
                    message = i18n.t('msc_lab_already_member');
                    code = '23505'; // Existing duplicate-membership UI contract.
                } else if (error.code === 'incorrect_password') {
                    message = i18n.t('msc_lab_wrong_password');
                } else if (error.code === 'lab_not_found') {
                    message = i18n.t('msc_lab_not_found');
                } else if (isLabMembershipLimitError(error)) {
                    message = LAB_MEMBERSHIP_LIMIT_ERROR;
                } else if (error.status === 401) {
                    message = i18n.t('msc_lab_session_expired');
                } else if (error.status === 429) {
                    const wait = error.retryAfterSeconds
                        ? i18n.t('msc_lab_wait_minutes', { minutes: Math.ceil(error.retryAfterSeconds / 60) }) : i18n.t('msc_lab_wait_moment');
                    message = i18n.t('msc_lab_join_locked', { wait });
                }
                throw new InternalApiError(message, error.status, code, error.retryAfterSeconds);
            }
            throw new Error(i18n.t('msc_lab_join_unverified'));
        }

        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) throw new Error(i18n.t('msc_lab_user_load_failed'));

        // Fetch the newly created member to return
        let { data: memberData, error: memberError } = await supabase
            .from('lab_members')
            .select(LAB_MEMBER_SELECT_WITH_INSTITUTION_NAME)
            .eq('lab_id', normalizedLabId)
            .eq('user_id', userData.user.id)
            .single();

        if (memberError && isMissingInstitutionNameColumnError(memberError)) {
            ({ data: memberData, error: memberError } = await supabase
                .from('lab_members')
                .select(LAB_MEMBER_SELECT)
                .eq('lab_id', normalizedLabId)
                .eq('user_id', userData.user.id)
                .single());
        }

        if (memberError || !memberData || memberData.lab_id !== normalizedLabId || memberData.user_id !== userData.user.id) {
            throw new Error(i18n.t('msc_lab_info_load_failed'));
        }
        return memberData as LabMember;
    },

    async getMyLabs(): Promise<LabMember[]> {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) return [];

        return fetchMyLabMemberships(userData.user.id);
    },

    async searchLabs(query: string): Promise<(Lab & { has_password?: boolean })[]> {
        if (!query.trim()) return [];
        const { data, error } = await supabase.rpc('search_labs', { search_query: query });
        if (error) throw error;
        return (data ?? []) as (Lab & { has_password?: boolean })[];
    },

    async getLabMembers(labId: string): Promise<{ user_id: string; role: string; joined_at: string; email: string; nickname?: string }[]> {
        const { data, error } = await supabase.rpc('get_lab_members', { target_lab_id: labId });
        if (error) throw error;
        return data || [];
    },

    async updateMemberRole(labId: string, userId: string, newRole: string): Promise<void> {
        const { error } = await supabase.rpc('update_lab_member_role', {
            target_lab_id: labId,
            target_user_id: userId,
            new_role: newRole
        });
        if (error) throw error;
    },

    async removeMember(labId: string, userId: string): Promise<void> {
        const { error } = await supabase.rpc('remove_lab_member', {
            target_lab_id: labId,
            target_user_id: userId
        });
        if (error) throw error;
    },

    async updateLab(
        labId: string,
        updates: {
            name?: string;
            institution_name?: string | null;
            institution_type?: string | null;
            research_field?: string | null;
        }
    ): Promise<void> {
        const { error } = await supabase
            .from('labs')
            .update(updates)
            .eq('id', labId);

        if (error && isMissingInstitutionNameColumnError(error) && 'institution_name' in updates) {
            const fallbackUpdates = { ...updates };
            delete fallbackUpdates.institution_name;

            if (Object.keys(fallbackUpdates).length === 0) return;

            const { error: fallbackError } = await supabase
                .from('labs')
                .update(fallbackUpdates)
                .eq('id', labId);

            if (fallbackError) throw fallbackError;
            return;
        }

        if (error) throw error;
    },

    async updateLabJoinPassword(labId: string, password: string): Promise<void> {
        const { data, error } = await supabase.rpc('set_lab_join_password', {
            target_lab_id: labId,
            p_password: password === '' ? null : password,
        });

        if (error) throw error;
        if (data && data.success === false) {
            throw new Error(data.error || 'Failed to update lab password');
        }
    },

    async requestLabDeletion(labId: string): Promise<{ jobId: string; status: string }> {
        const queued = await postJson<{ success: boolean; jobId: string; status: string }>(
            '/api/labs/delete',
            { labId, requestId: crypto.randomUUID() },
        );
        if (!queued || typeof queued !== 'object'
            || queued.success !== true
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(queued.jobId)
            || !['pending', 'running', 'retry_wait'].includes(queued.status)) {
            throw new Error('The deletion request could not be verified.');
        }
        return { jobId: queued.jobId, status: queued.status };
    },

    async transferAdmin(labId: string, newAdminUserId: string): Promise<void> {
        const { error } = await supabase.rpc('transfer_admin', {
            target_lab_id: labId,
            new_admin_user_id: newAdminUserId,
        });
        if (error) throw error;
    },

    async leaveLab(labId: string): Promise<void> {
        const { error } = await supabase.rpc('leave_lab', {
            target_lab_id: labId,
        });
        if (error) throw error;
    },
};
