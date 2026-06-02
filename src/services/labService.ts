/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from './supabaseClient';
import type { Lab, LabMember } from '../store/useLabStore';

export const LAB_MEMBERSHIP_LIMIT = 3;
export const LAB_MEMBERSHIP_LIMIT_ERROR = `계정당 최대 ${LAB_MEMBERSHIP_LIMIT}곳의 연구실에만 가입할 수 있습니다. 관리자 연구실도 포함됩니다.`;

const LAB_MEMBERSHIP_LIMIT_DB_CODE = 'max_lab_memberships_exceeded';
const LAB_SELECT = 'id, name, created_by, created_at, institution_type, research_field';
const LAB_SELECT_WITH_INSTITUTION_NAME = `id, name, created_by, created_at, institution_name, institution_type, research_field`;
const LAB_MEMBER_SELECT = `
                *,
                lab:labs(${LAB_SELECT})
            `;
const LAB_MEMBER_SELECT_WITH_INSTITUTION_NAME = `
                *,
                lab:labs(${LAB_SELECT_WITH_INSTITUTION_NAME})
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

    return message.includes(LAB_MEMBERSHIP_LIMIT_DB_CODE)
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

const isMissingInstitutionNameRpcArgumentError = (error: unknown): boolean => {
    const message = getErrorText(error);
    return message.includes('create_lab_secure')
        && message.includes('p_institution_name')
        && (message.includes('Could not find the function') || (error as any)?.code === 'PGRST202');
};

const fetchLabById = async (labId: string): Promise<Lab> => {
    const { data, error } = await supabase
        .from('labs')
        .select(LAB_SELECT_WITH_INSTITUTION_NAME)
        .eq('id', labId)
        .single();

    if (error && isMissingInstitutionNameColumnError(error)) {
        const { data: fallbackData, error: fallbackError } = await supabase
            .from('labs')
            .select(LAB_SELECT)
            .eq('id', labId)
            .single();

        if (fallbackError) throw fallbackError;
        return fallbackData as Lab;
    }

    if (error) throw error;
    return data as Lab;
};

const fetchMyLabMemberships = async (userId: string): Promise<LabMember[]> => {
    const { data, error } = await supabase
        .from('lab_members')
        .select(LAB_MEMBER_SELECT_WITH_INSTITUTION_NAME)
        .eq('user_id', userId);

    if (error && isMissingInstitutionNameColumnError(error)) {
        const { data: fallbackData, error: fallbackError } = await supabase
            .from('lab_members')
            .select(LAB_MEMBER_SELECT)
            .eq('user_id', userId);

        if (fallbackError) throw fallbackError;
        return fallbackData as LabMember[];
    }

    if (error) throw error;
    return data as LabMember[];
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
            p_password: password || null,
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
            throw new Error(data.error || "연구실 생성에 실패했습니다.");
        }

        return fetchLabById(data.lab_id);
    },

    async joinLab(labId: string, password?: string, nickname?: string): Promise<LabMember> {
        const { data, error } = await supabase.rpc('join_lab', {
            p_lab_id: labId,
            p_password: password ?? '',
            p_nickname: nickname || null
        });

        if (error) {
            throwIfLabMembershipLimitError(error);
            throw error;
        }
        
        if (!data.success) {
            throwIfLabMembershipLimitError(data.error);
            if (data.error === 'Already a member') {
                const err: any = new Error("이미 이 연구실에 가입되어 있습니다.");
                err.code = '23505'; 
                throw err;
            }
            if (data.error === 'Incorrect password') {
                throw new Error('비밀번호가 올바르지 않습니다.');
            }
            throw new Error(data.error || "가입에 실패했습니다.");
        }

        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) throw new Error("가입 후 사용자 정보를 불러올 수 없습니다.");

        // Fetch the newly created member to return
        let { data: memberData, error: memberError } = await supabase
            .from('lab_members')
            .select(LAB_MEMBER_SELECT_WITH_INSTITUTION_NAME)
            .eq('lab_id', labId)
            .eq('user_id', userData.user.id)
            .single();

        if (memberError && isMissingInstitutionNameColumnError(memberError)) {
            ({ data: memberData, error: memberError } = await supabase
                .from('lab_members')
                .select(LAB_MEMBER_SELECT)
                .eq('lab_id', labId)
                .eq('user_id', userData.user.id)
                .single());
        }

        if (memberError) throw memberError;
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
            p_password: password.trim() ? password.trim() : null,
        });

        if (error) throw error;
        if (data && data.success === false) {
            throw new Error(data.error || 'Failed to update lab password');
        }
    },

    async deleteLab(labId: string): Promise<void> {
        const { error } = await supabase
            .from('labs')
            .delete()
            .eq('id', labId);

        if (error) throw error;
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
