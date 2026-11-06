import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { labService } from '../../services/labService';
import { useLabStore } from '../../store/useLabStore';
import { supabase } from '../../services/supabaseClient';
import { Loader2, ShieldCheck, UserMinus, Crown, X } from 'lucide-react';
import { AppSelect } from '../../components/AppSelect';
import { CustomDialog } from '../../components/CustomDialog';
import { LabInviteButton } from '../../components/LabInviteButton';
import { LabRoleBadge } from '../../components/LabRoleBadge';
import { useActionToast } from '../../components/admin/ActionToast';
import { applyHeldMemberOrder, isNewLabMember, sortLabMembers } from './labMemberSort';

interface LabMemberRow {
    user_id: string;
    role: string;
    joined_at: string;
    email: string;
    nickname?: string;
}

type UpdatingState = { type: 'role' | 'transfer' | 'remove'; userId: string } | null;

/** How long a role change can be undone. */
const ROLE_UNDO_MS = 5000;
/** ?filter=new (from the overview's "역할 확인"): new members highlighted, with bulk role assignment. */
const NEW_MEMBER_FILTER = 'new';

export const MemberManagementPanel: React.FC = () => {
    const { t, i18n } = useTranslation();
    const currentLabId = useLabStore((s) => s.currentLabId);
    const myLabs = useLabStore((s) => s.myLabs);
    const setMyLabs = useLabStore((s) => s.setMyLabs);
    const { showToast, toastElement } = useActionToast();
    const [searchParams, setSearchParams] = useSearchParams();
    const isNewMemberFilter = searchParams.get('filter') === NEW_MEMBER_FILTER;

    const [members, setMembers] = useState<LabMemberRow[]>([]);
    // When the list was loaded: the reference point for the "새 멤버" (joined within 14 days) chip.
    const [loadedAt, setLoadedAt] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updating, setUpdating] = useState<UpdatingState>(null);
    // Row order kept while a role change is in flight or its undo toast is visible.
    const [heldOrder, setHeldOrder] = useState<string[] | null>(null);
    const [confirmTransfer, setConfirmTransfer] = useState<LabMemberRow | null>(null);
    const [confirmRemove, setConfirmRemove] = useState<LabMemberRow | null>(null);
    // Bulk role assignment for new members (only under ?filter=new).
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [bulkRole, setBulkRole] = useState('');
    const [isBulkConfirmOpen, setIsBulkConfirmOpen] = useState(false);
    const [isBulkApplying, setIsBulkApplying] = useState(false);
    // After a bulk apply clears the selection, the bar (and its 적용 button) is gone: land on the notice.
    const newMemberNoticeRef = useRef<HTMLParagraphElement>(null);
    const [noticeFocusRequest, setNoticeFocusRequest] = useState(0);

    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    // A role change or its undo finishing after a lab switch must not touch the new lab's list.
    const labIdRef = useRef(currentLabId);
    // Only the latest member list load may commit (a slow load for the previous lab must not land).
    const loadSeqRef = useRef(0);

    useEffect(() => {
        labIdRef.current = currentLabId;
    }, [currentLabId]);

    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => {
            setCurrentUserId(data.user?.id ?? null);
        });
    }, []);

    const loadMembers = useCallback(() => {
        if (!currentLabId) return;
        loadSeqRef.current += 1;
        const seq = loadSeqRef.current;
        const isCurrentLoad = () => loadSeqRef.current === seq;
        setIsLoading(true);
        setError(null);
        labService.getLabMembers(currentLabId)
            .then(data => {
                if (!isCurrentLoad()) return;
                setMembers(data);
                setLoadedAt(Date.now());
            })
            .catch(() => {
                if (isCurrentLoad()) setError(t('admin_members_error'));
            })
            .finally(() => {
                if (isCurrentLoad()) setIsLoading(false);
            });
    }, [currentLabId, t]);

    useEffect(() => { loadMembers(); }, [loadMembers]);

    // A passive effect: runs after the confirm dialog's own focus restore, which finds no 적용 button.
    useEffect(() => {
        if (noticeFocusRequest > 0) newMemberNoticeRef.current?.focus();
    }, [noticeFocusRequest]);

    const sortedMembers = useMemo(() => sortLabMembers(members, loadedAt), [members, loadedAt]);
    // Re-sort only once the role toast is gone, so rows don't jump under the user's finger.
    const isOrderHeld = toastElement !== null || updating?.type === 'role' || isBulkApplying;
    const visibleMembers = isOrderHeld ? applyHeldMemberOrder(sortedMembers, heldOrder) : sortedMembers;

    const setMemberRole = (userId: string, role: string) => {
        setMembers((current) => current.map((row) => (row.user_id === userId ? { ...row, role } : row)));
    };

    const undoRoleChange = async (labId: string, userId: string, previousRole: string) => {
        try {
            await labService.updateMemberRole(labId, userId, previousRole);
            if (labIdRef.current === labId) setMemberRole(userId, previousRole);
            showToast(t('admin_role_change_undone'), { tone: 'info' });
        } catch {
            showToast(t('admin_role_change_error'), { tone: 'error' });
        }
    };

    const handleRoleChange = async (member: LabMemberRow, newRole: string) => {
        const labId = currentLabId;
        if (!labId || newRole === member.role) return;
        const previousRole = member.role;
        setHeldOrder(visibleMembers.map((row) => row.user_id));
        setUpdating({ type: 'role', userId: member.user_id });
        try {
            await labService.updateMemberRole(labId, member.user_id, newRole);
            if (labIdRef.current !== labId) return;
            setMemberRole(member.user_id, newRole);
            showToast(t('admin_role_change_success'), {
                durationMs: ROLE_UNDO_MS,
                onUndo: () => undoRoleChange(labId, member.user_id, previousRole),
            });
        } catch {
            showToast(t('admin_role_change_error'), { tone: 'error' });
        } finally {
            setUpdating(null);
        }
    };

    const clearNewMemberFilter = () => {
        setSelectedIds([]);
        setSearchParams((current) => {
            const next = new URLSearchParams(current);
            next.delete('filter');
            return next;
        }, { replace: true });
    };

    const toggleSelected = (userId: string) => {
        setSelectedIds((current) => (
            current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
        ));
    };

    /** One confirmation, then one call per member in order; the toast reports what worked. */
    const handleBulkRoleConfirm = async (targetIds: string[]) => {
        const labId = currentLabId;
        const role = bulkRole;
        if (!labId || !role || targetIds.length === 0) return;
        // Members already in that role need no call; they count as done.
        const targets = members.filter((member) => targetIds.includes(member.user_id) && member.role !== role);
        const alreadyDone = targetIds.length - targets.length;
        setHeldOrder(visibleMembers.map((row) => row.user_id));
        setIsBulkApplying(true);
        const succeeded: string[] = [];
        const failed: string[] = [];
        for (const member of targets) {
            try {
                await labService.updateMemberRole(labId, member.user_id, role);
                succeeded.push(member.user_id);
            } catch {
                failed.push(member.user_id);
            }
        }
        if (labIdRef.current === labId) {
            setMembers((current) => current.map((row) => (succeeded.includes(row.user_id) ? { ...row, role } : row)));
            // Failed rows stay selected so the admin can try again (focus returns to 적용).
            setSelectedIds(failed);
            if (failed.length === 0) setNoticeFocusRequest((count) => count + 1);
        }
        setIsBulkApplying(false);
        setIsBulkConfirmOpen(false);
        const doneCount = succeeded.length + alreadyDone;
        if (failed.length === 0) {
            showToast(t('admin_bulk_role_success', { count: doneCount }));
        } else {
            showToast(t('admin_bulk_role_partial', { success: doneCount, failed: failed.length }), { tone: 'error' });
        }
    };

    const handleTransferConfirm = async () => {
        const labId = currentLabId;
        if (!labId || !confirmTransfer) return;
        const target = confirmTransfer;
        setHeldOrder(null);
        setUpdating({ type: 'transfer', userId: target.user_id });
        try {
            await labService.transferAdmin(labId, target.user_id);
        } catch {
            setConfirmTransfer(null);
            setUpdating(null);
            showToast(t('admin_transfer_error'), { tone: 'error' });
            return;
        }
        setConfirmTransfer(null);
        setUpdating(null);
        showToast(t('admin_transfer_success'));
        // Refresh lab store so the role/tab reflects new state
        try {
            const updatedLabs = await labService.getMyLabs();
            setMyLabs(updatedLabs);
        } catch (refreshError) {
            console.error(refreshError);
            // The transfer itself succeeded (the server made us PI): reflect that locally so admin
            // actions disappear instead of failing one by one.
            setMyLabs(useLabStore.getState().myLabs.map((membership) => (
                membership.lab_id === labId ? { ...membership, role: 'pi' as const } : membership
            )));
        }
        loadMembers();
    };

    const handleRemoveConfirm = async () => {
        if (!currentLabId || !confirmRemove) return;
        const target = confirmRemove;
        setHeldOrder(null);
        setUpdating({ type: 'remove', userId: target.user_id });
        try {
            await labService.removeMember(currentLabId, target.user_id);
            showToast(t('admin_remove_success'));
            loadMembers();
        } catch {
            showToast(t('admin_remove_error'), { tone: 'error' });
        } finally {
            setConfirmRemove(null);
            setUpdating(null);
        }
    };

    const currentMembership = myLabs.find((m) => m.lab_id === currentLabId);
    const currentRole = currentMembership?.role;
    const isAdmin = currentRole === 'admin';
    const currentLabName = currentMembership?.lab?.name ?? '';
    const currentInstitutionName = currentMembership?.lab?.institution_name;

    const roleOptions = [
        { value: 'pi', label: t('member_role_pi') },
        { value: 'postdoc', label: t('member_role_postdoc') },
        { value: 'graduate', label: t('member_role_graduate') },
        { value: 'undergrad', label: t('member_role_undergrad') },
        // Everyone joins as student ("연구원"): a normal role, not "unassigned".
        { value: 'student', label: t('member_role_student') },
    ];

    const locale = i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US';

    const isSelectableNewMember = (member: LabMemberRow) => (
        isAdmin && member.user_id !== currentUserId && member.role !== 'admin' && isNewLabMember(member, loadedAt)
    );
    const newMemberCount = members.filter((member) => isNewLabMember(member, loadedAt)).length;
    const selectableNewMemberIds = members.filter(isSelectableNewMember).map((member) => member.user_id);
    const showBulkSelection = isNewMemberFilter && selectableNewMemberIds.length > 0;
    const activeSelectedIds = showBulkSelection ? selectedIds.filter((id) => selectableNewMemberIds.includes(id)) : [];
    const allNewSelected = selectableNewMemberIds.length > 0 && activeSelectedIds.length === selectableNewMemberIds.length;
    const bulkRoleLabel = roleOptions.find((option) => option.value === bulkRole)?.label ?? '';

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-8">
                <Loader2 className="w-7 h-7 text-blue-500 animate-spin" />
                {toastElement}
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-5 text-sm text-red-500">
                {error}
                {toastElement}
            </div>
        );
    }

    return (
        <div className="p-5 flex flex-col gap-4" style={{ paddingBottom: '100px' }}>
            {toastElement}

            {/* Header */}
            <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-500" />
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t('admin_members_title')}</h2>
                <span className="ml-auto text-xs text-slate-400">{t('cmp_member_count', { count: members.length, defaultValue: '{{count}}명' })}</span>
                {members.length > 1 && currentLabId && currentLabName && (
                    <LabInviteButton variant="compact" labId={currentLabId} labName={currentLabName} institutionName={currentInstitutionName} />
                )}
            </div>

            {isNewMemberFilter && (
                <div className="flex flex-wrap items-center gap-x-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100">
                    <p ref={newMemberNoticeRef} tabIndex={-1} className="min-w-0 flex-1 py-2 outline-none">
                        {newMemberCount > 0
                            ? t('admin_members_new_filter_notice', { count: newMemberCount })
                            : t('admin_members_new_filter_empty')}
                    </p>
                    {showBulkSelection && (
                        <button
                            type="button"
                            onClick={() => setSelectedIds(allNewSelected ? [] : selectableNewMemberIds)}
                            disabled={isBulkApplying}
                            className="inline-flex min-h-11 items-center rounded-lg px-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
                        >
                            {allNewSelected ? t('admin_members_unselect_new') : t('admin_members_select_new')}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={clearNewMemberFilter}
                        disabled={isBulkApplying}
                        className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 dark:text-emerald-200 dark:hover:bg-emerald-900/40"
                    >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('admin_members_show_all')}
                    </button>
                </div>
            )}

            {/* Member List */}
            <div className="flex flex-col gap-3">
                {members.length === 0 && (
                    <div className="text-sm text-slate-400 text-center py-8">{t('admin_members_empty')}</div>
                )}
                {visibleMembers.map((member) => {
                    const isSelf = member.user_id === currentUserId;
                    const isMemberAdmin = member.role === 'admin';
                    const isWorking = updating?.userId === member.user_id;
                    const displayName = member.nickname || member.email;
                    const isNewMember = isNewLabMember(member, loadedAt);
                    const isHighlighted = isNewMemberFilter && isNewMember;
                    const canSelect = showBulkSelection && isSelectableNewMember(member);
                    const isSelected = canSelect && activeSelectedIds.includes(member.user_id);

                    return (
                        <div
                            key={member.user_id}
                            className={`bg-white dark:bg-slate-800 border rounded-xl p-4 flex flex-col gap-3 ${isHighlighted
                                ? 'border-emerald-300 ring-1 ring-emerald-200 dark:border-emerald-700 dark:ring-emerald-900/60'
                                : 'border-slate-200 dark:border-slate-700'}`}
                        >
                            {/* Top row: name + role badge */}
                            <div className="flex items-start justify-between gap-2">
                                {canSelect && (
                                    <label className="-my-2.5 -ml-2.5 flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center">
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleSelected(member.user_id)}
                                            disabled={isBulkApplying}
                                            aria-label={t('admin_members_select_aria', { name: displayName })}
                                            className="h-5 w-5 cursor-pointer rounded border-slate-300 accent-emerald-600 dark:border-slate-600"
                                        />
                                    </label>
                                )}
                                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {isMemberAdmin && <Crown className="w-4 h-4 text-amber-500 flex-shrink-0" />}
                                        <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">{displayName}</span>
                                        {isSelf && (
                                            <span className="text-xs text-slate-400">{t('member_you_label')}</span>
                                        )}
                                        {isNewMember && (
                                            <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                                                {t('admin_member_new_chip')}
                                            </span>
                                        )}
                                    </div>
                                    {member.nickname && (
                                        <span className="text-xs text-slate-400 truncate">{member.email}</span>
                                    )}
                                    <span className="text-xs text-slate-400">
                                        {t('member_joined_at')}: {new Date(member.joined_at).toLocaleDateString(locale)}
                                    </span>
                                </div>
                                <LabRoleBadge role={member.role} />
                            </div>

                            {/* Action row — only admin can act, cannot act on self or other admin */}
                            {isAdmin && !isSelf && !isMemberAdmin && (
                                <div className="flex flex-col sm:flex-row items-center gap-2">
                                    {/* Role change select */}
                                    <div className="w-full sm:flex-1 sm:min-w-[120px]">
                                        <AppSelect
                                            value={member.role}
                                            onChange={(val) => void handleRoleChange(member, val)}
                                            options={roleOptions}
                                            ariaLabel={t('admin_role_select_aria', { name: displayName })}
                                            buttonClassName="bg-slate-50 dark:bg-slate-900 text-xs h-9 w-full"
                                            disabled={isWorking || isBulkApplying}
                                        />
                                    </div>

                                    {/* Action buttons - full width on mobile, auto width on larger screens */}
                                    <div className="flex items-center gap-2 w-full sm:w-auto">
                                        <button
                                            onClick={() => setConfirmTransfer(member)}
                                            disabled={isWorking || isBulkApplying}
                                            className="flex-1 sm:flex-none flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 dark:hover:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs font-semibold transition-colors disabled:opacity-50 border border-amber-100 dark:border-amber-900/30 whitespace-nowrap"
                                        >
                                            {isWorking && updating?.type === 'transfer'
                                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                : <Crown className="w-3.5 h-3.5" />
                                            }
                                            {t('admin_transfer_btn')}
                                        </button>

                                        <button
                                            onClick={() => setConfirmRemove(member)}
                                            disabled={isWorking || isBulkApplying}
                                            className="flex-1 sm:flex-none flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 text-xs font-semibold transition-colors disabled:opacity-50 border border-red-100 dark:border-red-900/30 whitespace-nowrap"
                                        >
                                            {isWorking && updating?.type === 'remove'
                                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                : <UserMinus className="w-3.5 h-3.5" />
                                            }
                                            {t('admin_remove_btn')}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
                {/* Alone in the lab: the next useful step is bringing teammates in. */}
                {members.length <= 1 && currentLabId && currentLabName && (
                    <LabInviteButton labId={currentLabId} labName={currentLabName} institutionName={currentInstitutionName} />
                )}
            </div>

            {/* Bulk role bar: stays at the bottom of the scroll area while new members are selected. */}
            {activeSelectedIds.length > 0 && (
                <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
                    <span className="whitespace-nowrap px-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {t('admin_bulk_role_selected', { count: activeSelectedIds.length })}
                    </span>
                    <div className="min-w-[8.5rem] flex-1">
                        <AppSelect
                            value={bulkRole}
                            onChange={setBulkRole}
                            options={roleOptions}
                            placeholder={t('admin_bulk_role_placeholder')}
                            ariaLabel={t('admin_bulk_role_placeholder')}
                            disabled={isBulkApplying}
                            buttonClassName="bg-slate-50 dark:bg-slate-800 text-sm min-h-11 w-full"
                            // The bar sits at the bottom edge: open the list upwards.
                            menuClassName="!top-auto !bottom-full !mt-0 mb-2"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsBulkConfirmOpen(true)}
                        disabled={!bulkRole || isBulkApplying}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                    >
                        {isBulkApplying && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                        {t('admin_bulk_role_apply')}
                    </button>
                </div>
            )}

            <CustomDialog
                isOpen={isBulkConfirmOpen}
                onClose={() => setIsBulkConfirmOpen(false)}
                type="confirm"
                title={t('admin_bulk_role_confirm_title')}
                description={t('admin_bulk_role_confirm_body', { count: activeSelectedIds.length, role: bulkRoleLabel })}
                confirmText={t('admin_bulk_role_apply')}
                onConfirm={() => void handleBulkRoleConfirm(activeSelectedIds)}
                isConfirmLoading={isBulkApplying}
                preventCloseWhileLoading
            />

            {/* Transfer: the current admin becomes PI and cannot take it back alone. */}
            <CustomDialog
                isOpen={confirmTransfer !== null}
                onClose={() => setConfirmTransfer(null)}
                type="confirm"
                title={t('admin_transfer_btn')}
                description={confirmTransfer ? t('admin_transfer_confirm', { email: confirmTransfer.nickname || confirmTransfer.email }) : undefined}
                confirmText={t('admin_transfer_btn')}
                onConfirm={() => void handleTransferConfirm()}
                isDestructive
                isConfirmLoading={updating?.type === 'transfer'}
                preventCloseWhileLoading
            />

            <CustomDialog
                isOpen={confirmRemove !== null}
                onClose={() => setConfirmRemove(null)}
                type="confirm"
                title={t('admin_remove_btn')}
                description={confirmRemove ? t('admin_remove_confirm', { email: confirmRemove.nickname || confirmRemove.email }) : undefined}
                confirmText={t('admin_remove_btn')}
                onConfirm={() => void handleRemoveConfirm()}
                isDestructive
                isConfirmLoading={updating?.type === 'remove'}
                preventCloseWhileLoading
            />
        </div>
    );
};
