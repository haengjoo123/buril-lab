import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { labService } from '../../services/labService';
import { useLabStore } from '../../store/useLabStore';
import { supabase } from '../../services/supabaseClient';
import { Loader2, ShieldCheck, UserMinus, Crown } from 'lucide-react';
import { AppSelect } from '../../components/AppSelect';

interface LabMemberRow {
    user_id: string;
    role: string;
    joined_at: string;
    email: string;
    nickname?: string;
}

type UpdatingState = { type: 'role' | 'transfer' | 'remove'; userId: string } | null;

export const MemberManagementPanel: React.FC = () => {
    const { t, i18n } = useTranslation();
    const currentLabId = useLabStore((s) => s.currentLabId);
    const myLabs = useLabStore((s) => s.myLabs);
    const setMyLabs = useLabStore((s) => s.setMyLabs);

    const [members, setMembers] = useState<LabMemberRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updating, setUpdating] = useState<UpdatingState>(null);
    const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
    const [confirmTransfer, setConfirmTransfer] = useState<LabMemberRow | null>(null);
    const [confirmRemove, setConfirmRemove] = useState<LabMemberRow | null>(null);

    const [currentUserId, setCurrentUserId] = useState<string | null>(null);

    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => {
            setCurrentUserId(data.user?.id ?? null);
        });
    }, []);

    const loadMembers = useCallback(() => {
        if (!currentLabId) return;
        setIsLoading(true);
        setError(null);
        labService.getLabMembers(currentLabId)
            .then(setMembers)
            .catch(() => setError(t('admin_members_error')))
            .finally(() => setIsLoading(false));
    }, [currentLabId, t]);

    useEffect(() => { loadMembers(); }, [loadMembers]);

    const showToast = (msg: string, ok: boolean) => {
        setToast({ msg, ok });
        setTimeout(() => setToast(null), 3000);
    };

    const handleRoleChange = async (member: LabMemberRow, newRole: string) => {
        if (!currentLabId) return;
        setUpdating({ type: 'role', userId: member.user_id });
        try {
            await labService.updateMemberRole(currentLabId, member.user_id, newRole);
            showToast(t('admin_role_change_success'), true);
            loadMembers();
        } catch {
            showToast(t('admin_role_change_error'), false);
        } finally {
            setUpdating(null);
        }
    };

    const handleTransferConfirm = async () => {
        if (!currentLabId || !confirmTransfer) return;
        setUpdating({ type: 'transfer', userId: confirmTransfer.user_id });
        setConfirmTransfer(null);
        try {
            await labService.transferAdmin(currentLabId, confirmTransfer.user_id);
            showToast(t('admin_transfer_success'), true);
            // Refresh lab store so the role/tab reflects new state
            const updatedLabs = await labService.getMyLabs();
            setMyLabs(updatedLabs);
            loadMembers();
        } catch {
            showToast(t('admin_transfer_error'), false);
        } finally {
            setUpdating(null);
        }
    };

    const handleRemoveConfirm = async () => {
        if (!currentLabId || !confirmRemove) return;
        setUpdating({ type: 'remove', userId: confirmRemove.user_id });
        setConfirmRemove(null);
        try {
            await labService.removeMember(currentLabId, confirmRemove.user_id);
            showToast(t('admin_remove_success'), true);
            loadMembers();
        } catch {
            showToast(t('admin_remove_error'), false);
        } finally {
            setUpdating(null);
        }
    };

    const currentRole = myLabs.find((m) => m.lab_id === currentLabId)?.role;
    const isAdmin = currentRole === 'admin';

    const roleLabel = (role: string) => {
        if (role === 'admin') return t('member_role_admin');
        if (role === 'researcher') return t('member_role_researcher');
        if (role === 'student') return t('member_role_student');
        return role;
    };

    const roleColor = (role: string) => {
        if (role === 'admin') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
        if (role === 'researcher') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
        return 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
    };

    const roleOptions = [
        { value: 'researcher', label: t('member_role_researcher') },
        { value: 'student', label: t('member_role_student') },
    ];

    const locale = i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US';

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-8">
                <Loader2 className="w-7 h-7 text-blue-500 animate-spin" />
            </div>
        );
    }

    if (error) {
        return <div className="p-5 text-sm text-red-500">{error}</div>;
    }

    return (
        <div className="p-5 flex flex-col gap-4" style={{ paddingBottom: '100px' }}>
            {/* Toast */}
            {toast && (
                <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg transition-all ${toast.ok ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
                    {toast.msg}
                </div>
            )}

            {/* Header */}
            <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-500" />
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('admin_members_title')}</h2>
                <span className="ml-auto text-xs text-slate-400">{members.length}명</span>
            </div>

            {/* Member List */}
            <div className="flex flex-col gap-3">
                {members.length === 0 && (
                    <div className="text-sm text-slate-400 text-center py-8">{t('admin_members_empty')}</div>
                )}
                {members.map((member) => {
                    const isSelf = member.user_id === currentUserId;
                    const isMemberAdmin = member.role === 'admin';
                    const isWorking = updating?.userId === member.user_id;
                    const displayName = member.nickname || member.email;

                    return (
                        <div
                            key={member.user_id}
                            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 flex flex-col gap-3"
                        >
                            {/* Top row: name + role badge */}
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex flex-col gap-0.5 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {isMemberAdmin && <Crown className="w-4 h-4 text-amber-500 flex-shrink-0" />}
                                        <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">{displayName}</span>
                                        {isSelf && (
                                            <span className="text-xs text-slate-400">{t('member_you_label')}</span>
                                        )}
                                    </div>
                                    {member.nickname && (
                                        <span className="text-xs text-slate-400 truncate">{member.email}</span>
                                    )}
                                    <span className="text-xs text-slate-400">
                                        {t('member_joined_at')}: {new Date(member.joined_at).toLocaleDateString(locale)}
                                    </span>
                                </div>
                                <span className={`px-2 py-0.5 rounded-full text-xs font-bold flex-shrink-0 ${roleColor(member.role)}`}>
                                    {roleLabel(member.role)}
                                </span>
                            </div>

                            {/* Action row — only admin can act, cannot act on self or other admin */}
                            {isAdmin && !isSelf && !isMemberAdmin && (
                                <div className="flex items-center gap-2 flex-wrap">
                                    {/* Role change select */}
                                    <div className="flex-1 min-w-[120px]">
                                        <AppSelect
                                            value={member.role}
                                            onChange={(val) => handleRoleChange(member, val)}
                                            options={roleOptions}
                                            buttonClassName="bg-slate-50 dark:bg-slate-900 text-xs h-8"
                                            disabled={isWorking}
                                        />
                                    </div>

                                    {/* Transfer admin button */}
                                    <button
                                        onClick={() => setConfirmTransfer(member)}
                                        disabled={isWorking}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 dark:hover:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs font-medium transition-colors disabled:opacity-50"
                                    >
                                        {isWorking && updating?.type === 'transfer'
                                            ? <Loader2 className="w-3 h-3 animate-spin" />
                                            : <Crown className="w-3 h-3" />
                                        }
                                        {t('admin_transfer_btn')}
                                    </button>

                                    {/* Remove button */}
                                    <button
                                        onClick={() => setConfirmRemove(member)}
                                        disabled={isWorking}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 text-xs font-medium transition-colors disabled:opacity-50"
                                    >
                                        {isWorking && updating?.type === 'remove'
                                            ? <Loader2 className="w-3 h-3 animate-spin" />
                                            : <UserMinus className="w-3 h-3" />
                                        }
                                        {t('admin_remove_btn')}
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Transfer Confirm Dialog */}
            {confirmTransfer && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl flex flex-col gap-4">
                        <div className="flex items-center gap-2">
                            <Crown className="w-5 h-5 text-amber-500" />
                            <h3 className="font-bold text-slate-900 dark:text-white text-base">{t('admin_transfer_btn')}</h3>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-300">
                            {t('admin_transfer_confirm', { email: confirmTransfer.nickname || confirmTransfer.email })}
                        </p>
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setConfirmTransfer(null)}
                                className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                            >
                                {t('btn_cancel')}
                            </button>
                            <button
                                onClick={handleTransferConfirm}
                                className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-500 hover:bg-amber-600 text-white transition-colors"
                            >
                                {t('btn_confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Remove Confirm Dialog */}
            {confirmRemove && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl flex flex-col gap-4">
                        <div className="flex items-center gap-2">
                            <UserMinus className="w-5 h-5 text-red-500" />
                            <h3 className="font-bold text-slate-900 dark:text-white text-base">{t('admin_remove_btn')}</h3>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-300">
                            {t('admin_remove_confirm', { email: confirmRemove.nickname || confirmRemove.email })}
                        </p>
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setConfirmRemove(null)}
                                className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                            >
                                {t('btn_cancel')}
                            </button>
                            <button
                                onClick={handleRemoveConfirm}
                                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500 hover:bg-red-600 text-white transition-colors"
                            >
                                {t('btn_confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
