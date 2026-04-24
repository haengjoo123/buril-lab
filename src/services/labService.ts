/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from './supabaseClient';
import type { Lab, LabMember } from '../store/useLabStore';

export const LAB_MEMBERSHIP_LIMIT = 3;
export const LAB_MEMBERSHIP_LIMIT_ERROR = `계정당 최대 ${LAB_MEMBERSHIP_LIMIT}곳의 연구실에만 가입할 수 있습니다. 관리자 연구실도 포함됩니다.`;

const LAB_MEMBERSHIP_LIMIT_DB_CODE = 'max_lab_memberships_exceeded';

export const isLabMembershipLimitError = (error: unknown): boolean => {
    if (!error) return false;
    const message = typeof error === 'string'
        ? error
        : [
            (error as any).message,
            (error as any).details,
            (error as any).hint,
            (error as any).error
        ].filter(Boolean).join('\n');

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

export const labService = {
    async createLab(name: string, password?: string, nickname?: string, institutionType?: string, researchField?: string): Promise<Lab> {
        const { data, error } = await supabase.rpc('create_lab_secure', {
            p_name: name,
            p_password: password || null,
            p_nickname: nickname || null,
            p_institution_type: institutionType || null,
            p_research_field: researchField || null
        });

        if (error) {
            throwIfLabMembershipLimitError(error);
            throw error;
        }
        if (!data.success) {
            throwIfLabMembershipLimitError(data.error);
            throw new Error(data.error || "연구실 생성에 실패했습니다.");
        }

        // Fetch the created lab details
        const { data: labData, error: fetchError } = await supabase
            .from('labs')
            .select('id, name, created_by, created_at, institution_type, research_field')
            .eq('id', data.lab_id)
            .single();

        if (fetchError) throw fetchError;
        return labData as Lab;
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
        const { data: memberData, error: memberError } = await supabase
            .from('lab_members')
            .select('*, labs(id, name, created_by, created_at, institution_type, research_field)')
            .eq('lab_id', labId)
            .eq('user_id', userData.user.id)
            .single();

        if (memberError) throw memberError;
        return memberData as LabMember;
    },

    async getMyLabs(): Promise<LabMember[]> {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) return [];

        const { data, error } = await supabase
            .from('lab_members')
            .select(`
                *,
                lab:labs(id, name, created_by, created_at, institution_type, research_field)
            `)
            .eq('user_id', userData.user.id);

        if (error) throw error;
        return data as LabMember[];
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
            institution_type?: string | null;
            research_field?: string | null;
        }
    ): Promise<void> {
        const { error } = await supabase
            .from('labs')
            .update(updates)
            .eq('id', labId);

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
