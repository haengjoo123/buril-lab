/**
 * 현재 로그인 사용자의 표시 이름(닉네임) 조회
 * lab_members 닉네임 우선, 없으면 이메일 사용
 */
import { supabase } from '../services/supabaseClient';
import { useLabStore } from '../store/useLabStore';

export async function getCurrentUserDisplayName(labId?: string | null): Promise<string | null> {
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    // 1) 전달된 labId 우선, 없으면 현재 선택된 연구실 기준으로 조회
    const targetLabId = labId || useLabStore.getState().currentLabId || null;
    if (targetLabId) {
        const { data: member } = await supabase
            .from('lab_members')
            .select('nickname')
            .eq('lab_id', targetLabId)
            .eq('user_id', user.id)
            .maybeSingle();
        if (member?.nickname?.trim()) return member.nickname.trim();
    }

    // 2) 특정 lab에서 못 찾으면, 사용자의 연구실 닉네임 중 첫 값을 사용
    const { data: anyMember } = await supabase
        .from('lab_members')
        .select('nickname')
        .eq('user_id', user.id)
        .not('nickname', 'is', null)
        .limit(1)
        .maybeSingle();
    if (anyMember?.nickname?.trim()) {
        return anyMember.nickname.trim();
    }

    return user.user_metadata?.full_name || user.user_metadata?.name || user.email || null;
}
