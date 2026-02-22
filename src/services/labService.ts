import { supabase } from './supabaseClient';
import type { Lab, LabMember } from '../store/useLabStore';

export const labService = {
    async createLab(name: string, password?: string): Promise<Lab> {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) throw new Error("Not authenticated");

        // 1. Create Lab
        const { data: labData, error: labError } = await supabase
            .from('labs')
            .insert({
                name,
                created_by: userData.user.id,
                join_password: password || null
            })
            .select()
            .single();

        if (labError) throw labError;

        // 2. Add creator as admin
        const { error: memberError } = await supabase
            .from('lab_members')
            .insert({
                lab_id: labData.id,
                user_id: userData.user.id,
                role: 'admin'
            });

        if (memberError) throw memberError;

        return labData as Lab;
    },

    async joinLab(labId: string, role: string = 'researcher', password?: string): Promise<LabMember> {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) throw new Error("Not authenticated");

        const { error } = await supabase.rpc('join_lab_with_password', {
            target_lab_id: labId,
            joining_user_id: userData.user.id,
            requested_role: role,
            provided_password: password || null
        });

        if (error) {
            if (error.message.includes('User is already a member')) {
                const err: any = new Error("이미 이 연구실에 가입되어 있습니다.");
                err.code = '23505'; // keep backward compatibility with existing UI error handling
                throw err;
            }
            throw new Error(error.message === 'Incorrect password' ? '비밀번호가 올바르지 않습니다.' : error.message);
        }

        // Fetch the newly created member to return
        const { data: memberData, error: memberError } = await supabase
            .from('lab_members')
            .select('*, labs(*)')
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
                lab:labs(*)
            `)
            .eq('user_id', userData.user.id);

        if (error) throw error;
        return data as LabMember[];
    },

    async searchLabs(query: string): Promise<Lab[]> {
        if (!query.trim()) return [];
        const { data, error } = await supabase
            .from('labs')
            .select('*')
            .ilike('name', `%${query}%`)
            .limit(10);

        if (error) throw error;
        return data as Lab[];
    },

    async getLabMembers(labId: string): Promise<{ user_id: string; role: string; joined_at: string; email: string }[]> {
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

    async updateLab(labId: string, updates: { name?: string; join_password?: string }): Promise<void> {
        const { error } = await supabase
            .from('labs')
            .update(updates)
            .eq('id', labId);

        if (error) throw error;
    },

    async deleteLab(labId: string): Promise<void> {
        const { error } = await supabase
            .from('labs')
            .delete()
            .eq('id', labId);

        if (error) throw error;
    }
};
