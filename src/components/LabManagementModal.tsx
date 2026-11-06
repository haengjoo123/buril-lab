/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect, useId, useMemo, useRef } from 'react';
import { X, Search, Plus, Check, Loader2, AlertCircle, Users, Settings, Lock, LockOpen, LogOut, Ellipsis } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LAB_MEMBERSHIP_LIMIT, isLabMembershipLimitError, labService } from '../services/labService';
import { supabase } from '../services/supabaseClient';
import { useLabStore } from '../store/useLabStore';
import type { Lab } from '../store/useLabStore';
import {
    LAB_JOIN_PASSWORD_MAX_LENGTH,
    LAB_JOIN_PASSWORD_MIN_LENGTH,
    labPasswordIssueFromError,
    type LabPasswordPolicyIssue,
    validateLabJoinPassword,
} from '../utils/labPasswordPolicy';
import { DELETION_UI_ENABLED } from '../config/deletion';
import { useAdaptiveDialog } from '../hooks/useAdaptiveDialog';
import { AppSelect } from './AppSelect';
import { CustomDialog } from './CustomDialog';
import { LabInviteButton } from './LabInviteButton';
import { LabRoleBadge } from './LabRoleBadge';
import { resolveLabFormDefaults } from './labFormDefaults';
import type { LabJoinTarget } from './labInvite';

type LabWithPassword = Lab & { has_password?: boolean };
type LabMemberRow = Awaited<ReturnType<typeof labService.getLabMembers>>[number];
type ModalView = 'menu' | 'create' | 'search' | 'members' | 'settings';
type CreateField = 'name' | 'nickname' | 'institutionName' | 'institutionType' | 'researchField';
type PendingDialog =
    | { kind: 'leave'; labId: string; labName: string }
    | { kind: 'kick'; userId: string }
    | { kind: 'deleteQueued' };

export type LabEnteredKind = 'created' | 'joined';
export interface EnteredLab {
    id: string;
    name: string;
    institutionName?: string | null;
}

interface LabManagementModalProps {
    onClose: () => void;
    /** Open straight on a view (e.g. `create` from the header lab menu). */
    initialView?: 'menu' | 'create';
    /** From an invite link: open the join search for this lab with it preselected. */
    joinTarget?: LabJoinTarget | null;
    /** Called after the user is switched into a lab they just created or joined. */
    onLabEntered?: (lab: EnteredLab, kind: LabEnteredKind) => void;
}

const INPUT_BASE = 'w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-800 focus:ring-2 outline-none text-slate-900 dark:text-slate-100';
const INPUT_OK = 'border-slate-300 dark:border-slate-600 focus:ring-blue-500';
const INPUT_INVALID = 'border-red-500 dark:border-red-500 ring-2 ring-red-500/60 focus:ring-red-500';
const SELECT_BUTTON = 'w-full bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-slate-100 min-h-[42px] px-3 py-2 rounded-lg';
const SAVED_FEEDBACK_MS = 1500;

export const LabManagementModal: React.FC<LabManagementModalProps> = ({ onClose, initialView = 'menu', joinTarget = null, onLabEntered }) => {
    const { t, i18n } = useTranslation();
    const entryView: ModalView = joinTarget ? 'search' : initialView;
    const [view, setView] = useState<ModalView>(entryView);
    const { myLabs, setMyLabs, currentLabId, setCurrentLabId } = useLabStore();
    const formDefaults = useMemo(() => resolveLabFormDefaults(myLabs), [myLabs]);

    const [query, setQuery] = useState(joinTarget?.labName ?? '');
    const [searchedQuery, setSearchedQuery] = useState('');
    const [searchResults, setSearchResults] = useState<LabWithPassword[]>([]);
    const [members, setMembers] = useState<LabMemberRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [createName, setCreateName] = useState('');
    const [createPassword, setCreatePassword] = useState('');
    const [createNickname, setCreateNickname] = useState(() => formDefaults.nickname);
    const [createInstitutionName, setCreateInstitutionName] = useState(() => formDefaults.institutionName);
    const [createInstitutionType, setCreateInstitutionType] = useState(() => formDefaults.institutionType);
    const [createResearchField, setCreateResearchField] = useState('');
    const [invalidField, setInvalidField] = useState<CreateField | null>(null);

    // For joining a lab
    const [selectedLabId, setSelectedLabId] = useState<string | null>(null);
    const [joinPassword, setJoinPassword] = useState('');
    const [joinNickname, setJoinNickname] = useState(() => formDefaults.nickname);

    // For settings
    const [settingsName, setSettingsName] = useState('');
    const [settingsPassword, setSettingsPassword] = useState('');
    const [settingsRemovePassword, setSettingsRemovePassword] = useState(false);
    const [settingsInstitutionName, setSettingsInstitutionName] = useState('');
    const [settingsInstitutionType, setSettingsInstitutionType] = useState('');
    const [settingsResearchField, setSettingsResearchField] = useState('');
    const [settingsSaved, setSettingsSaved] = useState(false);
    const [deleteConfirmName, setDeleteConfirmName] = useState('');
    const [passwordState, setPasswordState] = useState<{ labId: string; hasPassword: boolean | null } | null>(null);

    const [isLeaving, setIsLeaving] = useState<string | null>(null); // labId being left
    const [openRowMenu, setOpenRowMenu] = useState<string | null>(null);
    const [pendingDialog, setPendingDialog] = useState<PendingDialog | null>(null);
    const [isDialogBusy, setIsDialogBusy] = useState(false);

    const dialogRef = useRef<HTMLDivElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const nicknameInputRef = useRef<HTMLInputElement>(null);
    const institutionInputRef = useRef<HTMLInputElement>(null);
    const institutionTypeRef = useRef<HTMLDivElement>(null);
    const researchFieldRef = useRef<HTMLDivElement>(null);
    const savedTimerRef = useRef<number | null>(null);
    const institutionListId = useId();

    const currentMembership = myLabs.find(m => m.lab_id === currentLabId);
    const currentRole = currentMembership?.role;
    const currentLabName = currentMembership?.lab?.name ?? '';
    const currentHasPassword = passwordState && passwordState.labId === currentLabId ? passwordState.hasPassword : null;
    const hasReachedLabLimit = myLabs.length >= LAB_MEMBERSHIP_LIMIT;
    const labLimitMessage = t('lab_mgmt_limit_reached', { max: LAB_MEMBERSHIP_LIMIT });
    const passwordIssueMessage = (issue: LabPasswordPolicyIssue) => t(`lab_mgmt_password_${issue}`, {
        min: LAB_JOIN_PASSWORD_MIN_LENGTH,
        max: LAB_JOIN_PASSWORD_MAX_LENGTH,
    });

    const goToMenu = () => {
        setView('menu');
        setSelectedLabId(null);
        setJoinPassword('');
        setError(null);
        setInvalidField(null);
        setSettingsSaved(false);
        setDeleteConfirmName('');
    };

    /** Back one level: sub-view → menu, or close when the modal was opened on this view. */
    const goBack = () => {
        if (view !== entryView) goToMenu();
        else onClose();
    };

    // Esc and Android back: close an open row menu first, then step back like the back buttons.
    useAdaptiveDialog(dialogRef, () => {
        if (openRowMenu) setOpenRowMenu(null);
        else goBack();
    });

    useEffect(() => () => {
        if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
    }, []);

    // No nickname in any lab yet: fall back to the account's profile name (local session, no request).
    useEffect(() => {
        if (formDefaults.nickname) return;
        let cancelled = false;
        void supabase.auth.getSession().then(({ data }) => {
            const metadata = data.session?.user?.user_metadata as { full_name?: string; name?: string } | undefined;
            const profileName = (metadata?.full_name || metadata?.name || '').trim();
            if (cancelled || !profileName) return;
            setCreateNickname(value => value || profileName);
            setJoinNickname(value => value || profileName);
        }).catch(() => undefined);
        return () => { cancelled = true; };
    }, []);

    // The admin's settings row shows whether a join password is actually set.
    useEffect(() => {
        if (view !== 'menu' || !currentLabId || currentRole !== 'admin' || !currentLabName) return;
        if (passwordState?.labId === currentLabId) return;
        let cancelled = false;
        const labId = currentLabId;
        labService.getLabHasPassword(labId, currentLabName)
            .then(hasPassword => { if (!cancelled) setPasswordState({ labId, hasPassword }); })
            .catch(() => { if (!cancelled) setPasswordState({ labId, hasPassword: null }); });
        return () => { cancelled = true; };
    }, [view, currentLabId, currentRole, currentLabName]);

    const runSearch = async (text: string, preselectLabId?: string) => {
        if (!text.trim()) return;
        setIsLoading(true);
        setError(null);
        try {
            const results = await labService.searchLabs(text);
            setSearchResults(results);
            setSearchedQuery(text);
            const preselected = preselectLabId
                ? results.find(lab => lab.id?.toLowerCase() === preselectLabId.toLowerCase())
                : undefined;
            setSelectedLabId(previous => preselected?.id
                ?? (results.length === 1 ? results[0].id : null)
                ?? (results.some(lab => lab.id === previous) ? previous : null));
        } catch (err: any) {
            setError(err.message || "Failed to search labs");
        } finally {
            setIsLoading(false);
        }
    };

    // Invite link: search for the lab right away and select it.
    useEffect(() => {
        if (joinTarget) void runSearch(joinTarget.labName, joinTarget.labId);
    }, []);

    const confirmLeaveLab = async (labId: string) => {
        setIsLeaving(labId);
        setIsDialogBusy(true);
        setError(null);
        try {
            await labService.leaveLab(labId);
            const updatedLabs = await labService.getMyLabs();
            setMyLabs(updatedLabs);
            setOpenRowMenu(null);
            if (currentLabId === labId) {
                setCurrentLabId(updatedLabs.length > 0 ? updatedLabs[0].lab_id : null);
            }
        } catch (err: any) {
            const msg = err.message || '';
            if (msg.includes('transfer admin') || msg.includes('Admin cannot leave')) {
                setError(t('lab_leave_error_admin'));
            } else {
                setError(t('lab_leave_error'));
            }
        } finally {
            setIsLeaving(null);
            setIsDialogBusy(false);
            setPendingDialog(null);
        }
    };

    const loadMembers = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await labService.getLabMembers(currentLabId!);
            setMembers(data);
        } catch (err: any) {
            setError(err.message || t('admin_members_error'));
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (view === 'members' && currentLabId) {
            loadMembers();
        }
    }, [view, currentLabId]);

    const handleRoleChange = async (userId: string, newRole: string) => {
        if (!currentLabId) return;
        setIsLoading(true);
        try {
            await labService.updateMemberRole(currentLabId, userId, newRole);
            await loadMembers(); // refresh
        } catch (err: any) {
            setError(err.message || t('admin_role_change_error'));
        } finally {
            setIsLoading(false);
        }
    };

    const confirmRemoveMember = async (userId: string) => {
        if (!currentLabId) return;
        setIsDialogBusy(true);
        setIsLoading(true);
        try {
            await labService.removeMember(currentLabId, userId);
            await loadMembers(); // refresh
        } catch (err: any) {
            setError(err.message || t('admin_remove_error'));
        } finally {
            setIsDialogBusy(false);
            setIsLoading(false);
            setPendingDialog(null);
        }
    };

    const handleSearch = async (e?: React.FormEvent) => {
        e?.preventDefault();
        await runSearch(query);
    };

    const missingCreateField = (): CreateField | null => {
        if (!createName.trim()) return 'name';
        if (!createNickname.trim()) return 'nickname';
        if (!createInstitutionName.trim()) return 'institutionName';
        if (!createInstitutionType) return 'institutionType';
        if (!createResearchField) return 'researchField';
        return null;
    };
    const isCreateComplete = missingCreateField() === null;

    const focusCreateField = (field: CreateField) => {
        const target: HTMLElement | null | undefined =
            field === 'name' ? nameInputRef.current
                : field === 'nickname' ? nicknameInputRef.current
                    : field === 'institutionName' ? institutionInputRef.current
                        : (field === 'institutionType' ? institutionTypeRef.current : researchFieldRef.current)?.querySelector('button');
        target?.focus();
        target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    };

    const clearInvalid = (field: CreateField) => {
        if (invalidField === field) setInvalidField(null);
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isLoading) return;
        if (hasReachedLabLimit) {
            setError(labLimitMessage);
            return;
        }
        const missing = missingCreateField();
        if (missing) {
            setInvalidField(missing);
            focusCreateField(missing);
            return;
        }
        const passwordIssue = validateLabJoinPassword(createName, createPassword);
        if (passwordIssue) {
            setError(passwordIssueMessage(passwordIssue));
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const newLab = await labService.createLab(
                createName,
                createPassword,
                createNickname,
                createInstitutionType.trim() ? createInstitutionType.trim() : undefined,
                createResearchField.trim() ? createResearchField.trim() : undefined,
                createInstitutionName.trim() ? createInstitutionName.trim() : undefined
            );
            // Switch into the new lab, then let the header confirm it.
            const updatedLabs = await labService.getMyLabs();
            setMyLabs(updatedLabs);
            setCurrentLabId(newLab.id);
            onLabEntered?.({
                id: newLab.id,
                name: newLab.name || createName.trim(),
                institutionName: newLab.institution_name ?? (createInstitutionName.trim() || null),
            }, 'created');
            onClose();
        } catch (err: any) {
            const passwordIssue = labPasswordIssueFromError(err);
            setError(passwordIssue
                ? passwordIssueMessage(passwordIssue)
                : isLabMembershipLimitError(err) ? labLimitMessage : (err.message || "Failed to create lab"));
        } finally {
            setIsLoading(false);
        }
    };

    const handleJoin = async () => {
        if (!selectedLabId || !joinNickname.trim()) return;
        if (hasReachedLabLimit) {
            setError(labLimitMessage);
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            await labService.joinLab(selectedLabId!, joinPassword, joinNickname);
            const updatedLabs = await labService.getMyLabs();
            setMyLabs(updatedLabs);
            setCurrentLabId(selectedLabId);
            const joined = searchResults.find(lab => lab.id === selectedLabId);
            onLabEntered?.({
                id: selectedLabId,
                name: joined?.name ?? updatedLabs.find(m => m.lab_id === selectedLabId)?.lab?.name ?? '',
                institutionName: joined?.institution_name ?? null,
            }, 'joined');
            onClose();
        } catch (err: any) {
            if (isLabMembershipLimitError(err)) {
                setError(labLimitMessage);
            } else if (err.code === '23505') {
                setError(t('lab_mgmt_already_joined'));
            } else {
                setError(err.message || t('lab_leave_error'));
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleUpdateSettings = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!currentLabId || !settingsName.trim()) return;
        if (!settingsRemovePassword && settingsPassword !== '') {
            const passwordIssue = validateLabJoinPassword(settingsName, settingsPassword);
            if (passwordIssue) {
                setError(passwordIssueMessage(passwordIssue));
                return;
            }
        }
        setIsLoading(true);
        setError(null);
        try {
            await labService.updateLab(currentLabId, {
                name: settingsName,
                institution_name: settingsInstitutionName.trim() ? settingsInstitutionName.trim() : null,
                institution_type: settingsInstitutionType.trim() ? settingsInstitutionType.trim() : null,
                research_field: settingsResearchField.trim() ? settingsResearchField.trim() : null
            });
            const passwordChanged = settingsRemovePassword || settingsPassword !== '';
            if (passwordChanged) {
                await labService.updateLabJoinPassword(
                    currentLabId,
                    settingsRemovePassword ? '' : settingsPassword
                );
                setPasswordState({ labId: currentLabId, hasPassword: !settingsRemovePassword });
                setSettingsPassword('');
                setSettingsRemovePassword(false);
            }
            const updatedLabs = await labService.getMyLabs();
            setMyLabs(updatedLabs);
            // Stay on the page; the save button itself confirms.
            setSettingsSaved(true);
            if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
            savedTimerRef.current = window.setTimeout(() => setSettingsSaved(false), SAVED_FEEDBACK_MS);
        } catch (err: any) {
            const passwordIssue = labPasswordIssueFromError(err);
            setError(passwordIssue ? passwordIssueMessage(passwordIssue) : (err.message || t('admin_role_change_error')));
        } finally {
            setIsLoading(false);
        }
    };

    const canRequestDeletion = Boolean(currentLabName.trim()) && deleteConfirmName.trim() === currentLabName.trim();

    const handleDeleteLab = async () => {
        if (!currentLabId || !canRequestDeletion) return;
        setIsLoading(true);
        setError(null);
        try {
            await labService.requestLabDeletion(currentLabId);
            setPendingDialog({ kind: 'deleteQueued' });
        } catch (err: any) {
            setError(err.message || t('admin_remove_error'));
        } finally {
            setIsLoading(false);
        }
    };

    const openSettings = () => {
        const lab = currentMembership?.lab;
        setSettingsName(lab?.name || '');
        setSettingsPassword('');
        setSettingsRemovePassword(false);
        setSettingsInstitutionName(lab?.institution_name || '');
        setSettingsInstitutionType(lab?.institution_type || '');
        setSettingsResearchField(lab?.research_field || '');
        setSettingsSaved(false);
        setDeleteConfirmName('');
        setError(null);
        setView('settings');
    };

    const instOptions = [
        { value: '', label: t('lab_mgmt_form_institution_type_placeholder') },
        { value: 'university', label: t('inst_uni') },
        { value: 'research_institute_gov', label: t('inst_gov') },
        { value: 'corporate_rd_large', label: t('inst_corp_large') },
        { value: 'corporate_rd_sme', label: t('inst_corp_sme') },
        { value: 'hospital_clinical', label: t('inst_hospital') },
        { value: 'school_edu', label: t('inst_edu') },
        { value: 'other', label: t('inst_other') }
    ];

    const fieldOptions = [
        { value: '', label: t('lab_mgmt_form_research_field_placeholder') },
        { value: 'biotech_lifescience', label: t('field_bio') },
        { value: 'chemistry_chemical_eng', label: t('field_chem') },
        { value: 'materials_science', label: t('field_material') },
        { value: 'battery_energy', label: t('field_battery') },
        { value: 'pharmaceutical', label: t('field_pharma') },
        { value: 'environmental_water', label: t('field_env') },
        { value: 'food_agriculture', label: t('field_food') },
        { value: 'medical_clinical', label: t('field_medical') },
        { value: 'physics_semiconductor', label: t('field_physics') },
        { value: 'other_field', label: t('field_other') }
    ];

    const getInstitutionTypeLabel = (institutionType?: string) => {
        switch (institutionType) {
            case 'university':
                return t('inst_uni');
            case 'research_institute_gov':
                return t('inst_gov');
            case 'corporate_rd_large':
                return t('inst_corp_large');
            case 'corporate_rd_sme':
                return t('inst_corp_sme');
            case 'hospital_clinical':
                return t('inst_hospital');
            case 'school_edu':
                return t('inst_edu');
            case 'other':
                return t('inst_other');
            default:
                return institutionType?.trim() || null;
        }
    };

    const inputClass = (field?: CreateField) => `${INPUT_BASE} ${field && invalidField === field ? INPUT_INVALID : INPUT_OK}`;
    const selectClass = (field: CreateField) => `${SELECT_BUTTON} ${invalidField === field ? 'border-red-500 dark:border-red-500 ring-2 ring-red-500/60' : ''}`;

    const dialogConfig = pendingDialog?.kind === 'leave'
        ? {
            type: 'confirm' as const,
            title: t('lab_leave_btn'),
            description: t('lab_leave_confirm', { name: pendingDialog.labName }),
            confirmText: t('lab_leave_btn'),
            isDestructive: true,
            onClose: () => setPendingDialog(null),
            onConfirm: () => { void confirmLeaveLab(pendingDialog.labId); },
        }
        : pendingDialog?.kind === 'kick'
            ? {
                type: 'confirm' as const,
                title: t('lab_mgmt_member_kick_btn'),
                description: t('lab_mgmt_member_kick_confirm'),
                confirmText: t('lab_mgmt_member_kick_btn'),
                isDestructive: true,
                onClose: () => setPendingDialog(null),
                onConfirm: () => { void confirmRemoveMember(pendingDialog.userId); },
            }
            : pendingDialog?.kind === 'deleteQueued'
                ? {
                    type: 'alert' as const,
                    title: t('lab_mgmt_delete_lab_btn'),
                    description: t('lab_mgmt_delete_queued'),
                    confirmText: undefined,
                    isDestructive: false,
                    onClose,
                    onConfirm: undefined,
                }
                : null;

    return (
        <>
        <div className="adaptive-overlay fixed inset-0 z-[100] flex items-center justify-center p-5 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="lab-management-title" className="w-full max-w-[380px] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] outline-none">

                <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center shrink-0">
                    <h3 id="lab-management-title" className="font-bold text-lg text-slate-800 dark:text-white">
                        {view === 'menu' && t('lab_mgmt_title')}
                        {view === 'create' && t('lab_mgmt_create_title')}
                        {view === 'search' && t('lab_mgmt_search_title')}
                        {view === 'members' && t('lab_mgmt_members_title')}
                        {view === 'settings' && t('lab_mgmt_settings_title')}
                    </h3>
                    <button onClick={onClose} aria-label={t('btn_close')} className="flex h-11 w-11 items-center justify-center hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full transition-colors">
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                <div className="p-5 overflow-y-auto w-full">
                    {error && (
                        <div role="alert" className="mb-4 flex items-center gap-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg text-sm">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            {error}
                        </div>
                    )}

                    {view === 'menu' && (
                        <div className="space-y-3">
                            {currentLabId && (
                                <button
                                    onClick={() => setView('members')}
                                    className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors border border-slate-200 dark:border-slate-700"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-lg">
                                            <Users className="w-5 h-5" />
                                        </div>
                                        <div className="text-left">
                                            <div className="font-semibold text-slate-800 dark:text-slate-200">{t('lab_mgmt_menu_members')}</div>
                                            <div className="text-xs text-slate-500 dark:text-slate-400">{t('lab_mgmt_menu_members_desc')}</div>
                                        </div>
                                    </div>
                                </button>
                            )}
                            {currentLabId && currentRole === 'admin' && (
                                <button
                                    onClick={openSettings}
                                    className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors border border-slate-200 dark:border-slate-700"
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        <div className="p-2 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg">
                                            <Settings className="w-5 h-5" />
                                        </div>
                                        <div className="min-w-0 text-left">
                                            <div className="font-semibold text-slate-800 dark:text-slate-200">{t('lab_mgmt_settings_title')}</div>
                                            <div className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                                                <span className="min-w-0 truncate">{currentLabName}</span>
                                                {currentHasPassword !== null && (
                                                    <span
                                                        role="img"
                                                        aria-label={t(currentHasPassword ? 'lab_password_on' : 'lab_password_off')}
                                                        title={t(currentHasPassword ? 'lab_password_on' : 'lab_password_off')}
                                                        className={`shrink-0 ${currentHasPassword ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}
                                                    >
                                                        {currentHasPassword
                                                            ? <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                                                            : <LockOpen className="h-3.5 w-3.5" aria-hidden="true" />}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            )}
                            {hasReachedLabLimit && (
                                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span>{labLimitMessage}</span>
                                </div>
                            )}
                            <button
                                onClick={() => { setError(null); setView('search'); }}
                                disabled={hasReachedLabLimit}
                                className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors border border-slate-200 dark:border-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg">
                                        <Search className="w-5 h-5" />
                                    </div>
                                    <div className="text-left">
                                        <div className="font-semibold text-slate-800 dark:text-slate-200">{t('lab_mgmt_menu_join')}</div>
                                        <div className="text-xs text-slate-500 dark:text-slate-400">{t('lab_mgmt_menu_join_desc')}</div>
                                    </div>
                                </div>
                            </button>
                            <button
                                onClick={() => { setError(null); setView('create'); }}
                                disabled={hasReachedLabLimit}
                                className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors border border-slate-200 dark:border-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-lg">
                                        <Plus className="w-5 h-5" />
                                    </div>
                                    <div className="text-left">
                                        <div className="font-semibold text-slate-800 dark:text-slate-200">{t('lab_mgmt_menu_create')}</div>
                                        <div className="text-xs text-slate-500 dark:text-slate-400">{t('lab_mgmt_menu_create_desc')}</div>
                                    </div>
                                </div>
                            </button>

                            <div className="mt-8">
                                <h4 className="font-semibold text-sm text-slate-500 mb-2 px-1">{t('lab_mgmt_joined_list')}</h4>
                                {myLabs.length === 0 ? (
                                    <div className="text-sm text-slate-400 italic px-1">{t('lab_no_joined')}</div>
                                ) : (
                                    <ul className="space-y-2">
                                        {myLabs.map(ml => {
                                            const isActive = ml.lab_id === currentLabId;
                                            const isMenuOpen = openRowMenu === ml.lab_id;
                                            return (
                                                <li
                                                    key={ml.lab_id}
                                                    className={`rounded-lg border transition-colors ${
                                                        isActive
                                                            ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-400 dark:border-blue-500'
                                                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/70 hover:border-slate-300 dark:hover:border-slate-700'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-1 pl-3">
                                                        <button
                                                            type="button"
                                                            onClick={() => { if (!isActive) setCurrentLabId(ml.lab_id); }}
                                                            aria-current={isActive ? 'true' : undefined}
                                                            className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left ${isActive ? 'cursor-default' : ''}`}
                                                        >
                                                            {isActive && (
                                                                <span className="flex-shrink-0 flex items-center gap-0.5 text-3xs font-bold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded">
                                                                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full inline-block" />
                                                                    {t('lab_mgmt_current_session')}
                                                                </span>
                                                            )}
                                                            <span className={`font-medium min-w-0 truncate ${isActive ? 'text-blue-800 dark:text-blue-200' : 'text-slate-700 dark:text-slate-200'}`}>
                                                                {ml.lab?.name}
                                                            </span>
                                                        </button>
                                                        <LabRoleBadge role={ml.role} />
                                                        <button
                                                            type="button"
                                                            onClick={() => setOpenRowMenu(isMenuOpen ? null : ml.lab_id)}
                                                            aria-label={t('lab_more_actions')}
                                                            aria-expanded={isMenuOpen}
                                                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                                                        >
                                                            <Ellipsis className="h-5 w-5" aria-hidden="true" />
                                                        </button>
                                                    </div>
                                                    {isMenuOpen && (
                                                        <div className="flex justify-end border-t border-slate-200/70 px-2 py-1.5 dark:border-slate-700/70">
                                                            <button
                                                                type="button"
                                                                onClick={() => setPendingDialog({ kind: 'leave', labId: ml.lab_id, labName: ml.lab?.name ?? '' })}
                                                                disabled={isLeaving === ml.lab_id}
                                                                className="flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/30"
                                                            >
                                                                {isLeaving === ml.lab_id
                                                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                                                    : <LogOut className="h-4 w-4" />}
                                                                {t('lab_leave_btn')}
                                                            </button>
                                                        </div>
                                                    )}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>
                        </div>
                    )}
                    {view === 'create' && (
                        <form onSubmit={handleCreate} noValidate className="space-y-4">
                            {hasReachedLabLimit && (
                                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span>{labLimitMessage}</span>
                                </div>
                            )}
                            <div>
                                <label htmlFor="lab-create-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('lab_mgmt_form_lab_name')}</label>
                                <input
                                    id="lab-create-name"
                                    ref={nameInputRef}
                                    type="text"
                                    value={createName}
                                    onChange={e => { setCreateName(e.target.value); clearInvalid('name'); }}
                                    placeholder={t('lab_mgmt_form_lab_name_placeholder')}
                                    className={inputClass('name')}
                                    aria-invalid={invalidField === 'name' || undefined}
                                    required
                                />
                            </div>
                            <div>
                                <label htmlFor="lab-create-nickname" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('lab_mgmt_form_nickname')}</label>
                                <input
                                    id="lab-create-nickname"
                                    ref={nicknameInputRef}
                                    type="text"
                                    value={createNickname}
                                    onChange={e => { setCreateNickname(e.target.value); clearInvalid('nickname'); }}
                                    placeholder={t('lab_mgmt_form_nickname_placeholder')}
                                    className={inputClass('nickname')}
                                    aria-invalid={invalidField === 'nickname' || undefined}
                                    autoComplete="nickname"
                                    required
                                />
                            </div>
                            <div>
                                <label htmlFor="lab-create-institution" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('cmp_lab_institution_name', '소속 기관명')}</label>
                                <input
                                    id="lab-create-institution"
                                    ref={institutionInputRef}
                                    type="text"
                                    value={createInstitutionName}
                                    onChange={e => { setCreateInstitutionName(e.target.value); clearInvalid('institutionName'); }}
                                    placeholder={t('cmp_lab_institution_placeholder', '예: 릴랩대학교')}
                                    className={inputClass('institutionName')}
                                    aria-invalid={invalidField === 'institutionName' || undefined}
                                    list={formDefaults.institutionNames.length > 0 ? institutionListId : undefined}
                                    autoComplete="organization"
                                    required
                                />
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                    {t('cmp_lab_institution_hint_create', '통합 안전관리센터 연결 후보를 식별하는 기준입니다.')}
                                </p>
                            </div>
                            <div ref={institutionTypeRef}>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('lab_mgmt_form_institution_type')}</label>
                                <AppSelect
                                    value={createInstitutionType}
                                    onChange={value => { setCreateInstitutionType(value); clearInvalid('institutionType'); }}
                                    options={instOptions}
                                    className="w-full"
                                    ariaLabel={t('lab_mgmt_form_institution_type')}
                                    buttonClassName={selectClass('institutionType')}
                                />
                            </div>
                            <div ref={researchFieldRef}>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('lab_mgmt_form_research_field')}</label>
                                <AppSelect
                                    value={createResearchField}
                                    onChange={value => { setCreateResearchField(value); clearInvalid('researchField'); }}
                                    options={fieldOptions}
                                    className="w-full"
                                    ariaLabel={t('lab_mgmt_form_research_field')}
                                    buttonClassName={selectClass('researchField')}
                                />
                            </div>
                            <div>
                                <label htmlFor="lab-create-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('lab_mgmt_form_password_opt')}</label>
                                <input
                                    id="lab-create-password"
                                    type="password"
                                    value={createPassword}
                                    onChange={e => setCreatePassword(e.target.value)}
                                    placeholder={t('lab_mgmt_form_password_placeholder')}
                                    className={inputClass()}
                                    autoComplete="new-password"
                                    minLength={createPassword ? LAB_JOIN_PASSWORD_MIN_LENGTH : undefined}
                                    maxLength={LAB_JOIN_PASSWORD_MAX_LENGTH}
                                />
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                    {t('lab_mgmt_password_help', {
                                        min: LAB_JOIN_PASSWORD_MIN_LENGTH,
                                        max: LAB_JOIN_PASSWORD_MAX_LENGTH,
                                    })}
                                </p>
                            </div>
                            <div className="flex gap-2 pt-4 pb-4">
                                <button type="button" onClick={goBack} className="flex-1 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg font-medium hover:bg-slate-200 transition-colors">
                                    {t('btn_cancel')}
                                </button>
                                {/* aria-disabled (not disabled) so a tap on an incomplete form points at the missing field. */}
                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    aria-disabled={hasReachedLabLimit || !isCreateComplete}
                                    className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 aria-disabled:opacity-50 aria-disabled:hover:bg-blue-600 flex justify-center items-center"
                                >
                                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : t('lab_mgmt_btn_create')}
                                </button>
                            </div>
                        </form>
                    )}

                    {view === 'search' && (
                        <div className="space-y-4">
                            {hasReachedLabLimit && (
                                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span>{labLimitMessage}</span>
                                </div>
                            )}
                            <form onSubmit={handleSearch} className="relative flex gap-2">
                                <div className="relative flex-1">
                                    <input
                                        type="text"
                                        value={query}
                                        onChange={e => setQuery(e.target.value)}
                                        placeholder={t('lab_mgmt_search_placeholder')}
                                        className="w-full pl-10 pr-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-slate-100"
                                    />
                                    <Search className="absolute left-3 top-2.5 w-5 h-5 text-slate-400" />
                                </div>
                                <button
                                    type="submit"
                                    disabled={isLoading || !query.trim()}
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-1"
                                >
                                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : t('lab_mgmt_search_btn')}
                                </button>
                            </form>

                            {searchResults.length > 0 && (
                                <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                                    {searchResults.map(lab => {
                                        const institutionTypeLabel = getInstitutionTypeLabel(lab.institution_type);
                                        const institutionName = lab.institution_name?.trim();
                                        const isSelected = selectedLabId === lab.id;

                                        return (
                                            <button
                                                type="button"
                                                key={lab.id}
                                                aria-pressed={isSelected}
                                                className={`w-full text-left p-3 rounded-lg border cursor-pointer transition-colors ${isSelected ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 bg-white dark:bg-slate-900/50'}`}
                                                onClick={() => setSelectedLabId(lab.id)}
                                            >
                                                <div className="flex justify-between items-start gap-3">
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            {lab.has_password && <Lock className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />}
                                                            <span className="font-medium text-slate-800 dark:text-slate-200 break-words">{lab.name}</span>
                                                        </div>
                                                        {(institutionName || institutionTypeLabel) && (
                                                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 break-words">
                                                                {institutionName && <span className="font-medium text-slate-600 dark:text-slate-300">{institutionName}</span>}
                                                                {institutionName && institutionTypeLabel && ' · '}
                                                                {institutionTypeLabel}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {isSelected && <Check className="w-5 h-5 shrink-0 text-blue-600 dark:text-blue-400" />}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            {selectedLabId && (
                                <div className="animate-in fade-in slide-in-from-bottom-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                                    <p className="text-3xs text-slate-500 mb-4 px-1 italic">
                                        * {t('lab_mgmt_role_approval_info', { defaultValue: '가입 후 관리자가 최종적인 역할을 지정합니다.' })}
                                    </p>
                                    <div className="mb-4">
                                        <label htmlFor="lab-join-nickname" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('lab_mgmt_form_nickname')}</label>
                                        <input
                                            id="lab-join-nickname"
                                            type="text"
                                            value={joinNickname}
                                            onChange={e => setJoinNickname(e.target.value)}
                                            placeholder={t('lab_mgmt_form_nickname_placeholder')}
                                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-slate-100"
                                            autoComplete="nickname"
                                            required
                                        />
                                    </div>
                                    <div className="mb-4">
                                        <label htmlFor="lab-join-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('lab_mgmt_form_password_if_set')}</label>
                                        <input
                                            id="lab-join-password"
                                            type="password"
                                            value={joinPassword}
                                            onChange={e => setJoinPassword(e.target.value)}
                                            placeholder={t('lab_mgmt_form_password_join_placeholder')}
                                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-slate-100"
                                            autoComplete="new-password"
                                        />
                                    </div>
                                    <button
                                        onClick={handleJoin}
                                        disabled={isLoading || hasReachedLabLimit || !joinNickname.trim()}
                                        className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex justify-center items-center"
                                    >
                                        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : t('lab_mgmt_btn_join')}
                                    </button>
                                </div>
                            )}

                            {searchResults.length === 0 && searchedQuery && !isLoading && (
                                <div className="text-center py-8 text-slate-500 dark:text-slate-400 text-sm">
                                    {t('lab_mgmt_search_no_results')}
                                </div>
                            )}

                            <div className="pt-2">
                                <button type="button" onClick={goBack} className="w-full py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg font-medium hover:bg-slate-200 transition-colors">
                                    {t('lab_mgmt_btn_back')}
                                </button>
                            </div>
                        </div>
                    )}

                    {view === 'members' && (
                        <div className="space-y-4">
                            {isLoading && members.length === 0 ? (
                                <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
                            ) : members.length === 0 ? (
                                <div className="text-center py-8 text-slate-500">{t('admin_members_empty')}</div>
                            ) : (
                                <>
                                    {members.length > 1 && currentLabId && (
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-xs text-slate-400">{t('cmp_member_count', { count: members.length, defaultValue: '{{count}}명' })}</span>
                                            <LabInviteButton variant="compact" labId={currentLabId} labName={currentLabName} institutionName={currentMembership?.lab?.institution_name} />
                                        </div>
                                    )}
                                    <ul className="space-y-3">
                                        {members.map(member => (
                                            <li key={member.user_id} className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                                                <div className="flex justify-between items-start gap-2 mb-2">
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                                                            {member.nickname || member.email || t('cmp_lab_unknown_user', '알 수 없는 사용자')}
                                                        </span>
                                                        {member.nickname && member.email && (
                                                            <span className="text-xs text-slate-400 dark:text-slate-500 truncate">
                                                                {member.email}
                                                            </span>
                                                        )}
                                                        <span className="text-xs text-slate-500 mt-0.5">{t('member_joined_label')}: {new Date(member.joined_at).toLocaleDateString(i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US')}</span>
                                                    </div>
                                                    <LabRoleBadge role={member.role} />
                                                </div>

                                                {currentRole === 'admin' && member.role !== 'admin' && ( // Admins can't demote themselves easily here to avoid 0 admins scenario
                                                    <div className="flex gap-2 mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                                                        <AppSelect
                                                            value={member.role}
                                                            onChange={(value) => handleRoleChange(member.user_id, value)}
                                                            disabled={isLoading}
                                                            size="sm"
                                                            className="flex-1"
                                                            options={[
                                                                { value: 'pi', label: t('lab_mgmt_role_pi') },
                                                                { value: 'postdoc', label: t('lab_mgmt_role_postdoc') },
                                                                { value: 'graduate', label: t('lab_mgmt_role_graduate') },
                                                                { value: 'undergrad', label: t('lab_mgmt_role_undergrad') },
                                                                // admin 승급은 transfer_admin으로만 가능 (이중 admin 방지)
                                                            ]}
                                                            buttonClassName="flex-1 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300"
                                                        />
                                                        <button
                                                            onClick={() => setPendingDialog({ kind: 'kick', userId: member.user_id })}
                                                            disabled={isLoading}
                                                            className="text-xs px-3 py-1 bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-900/20 dark:hover:bg-red-900/40 dark:text-red-400 rounded transition-colors"
                                                        >
                                                            {t('lab_mgmt_member_kick_btn')}
                                                        </button>
                                                    </div>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                    {members.length <= 1 && currentLabId && (
                                        <LabInviteButton labId={currentLabId} labName={currentLabName} institutionName={currentMembership?.lab?.institution_name} />
                                    )}
                                </>
                            )}
                            <div className="pt-2 sticky bottom-0 bg-white dark:bg-slate-900 pb-1 -mx-1 px-1 mt-2 border-t border-slate-100 dark:border-slate-800">
                                <button type="button" onClick={goBack} className="w-full mt-2 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg font-medium hover:bg-slate-200 transition-colors">
                                    {t('lab_mgmt_btn_back')}
                                </button>
                            </div>
                        </div>
                    )}

                    {view === 'settings' && (
                        <form onSubmit={handleUpdateSettings} className="space-y-4">
                            <div>
                                <label htmlFor="lab-settings-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('lab_mgmt_form_lab_name')}</label>
                                <input
                                    id="lab-settings-name"
                                    type="text"
                                    value={settingsName}
                                    onChange={e => setSettingsName(e.target.value)}
                                    placeholder={t('lab_mgmt_form_lab_name')}
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-slate-100"
                                    required
                                />
                            </div>
                            <div>
                                <label htmlFor="lab-settings-institution" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('cmp_lab_institution_name', '소속 기관명')}</label>
                                <input
                                    id="lab-settings-institution"
                                    type="text"
                                    value={settingsInstitutionName}
                                    onChange={e => setSettingsInstitutionName(e.target.value)}
                                    placeholder={t('cmp_lab_institution_placeholder', '예: 릴랩대학교')}
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-slate-100"
                                    list={formDefaults.institutionNames.length > 0 ? institutionListId : undefined}
                                    autoComplete="organization"
                                    required
                                />
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                    {t('cmp_lab_institution_hint_edit', '같은 기관의 승인된 통합센터에서 연결 요청 후보로 찾을 때 사용됩니다.')}
                                </p>
                            </div>
                            <div>
                                <label htmlFor="lab-settings-password" className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    {t('lab_mgmt_form_password')}
                                    {currentHasPassword !== null && (
                                        <span
                                            role="img"
                                            aria-label={t(currentHasPassword ? 'lab_password_on' : 'lab_password_off')}
                                            title={t(currentHasPassword ? 'lab_password_on' : 'lab_password_off')}
                                            className={currentHasPassword ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}
                                        >
                                            {currentHasPassword
                                                ? <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                                                : <LockOpen className="h-3.5 w-3.5" aria-hidden="true" />}
                                        </span>
                                    )}
                                </label>
                                {currentMembership?.lab?.join_password_needs_change && (
                                    <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
                                        {t('lab_mgmt_password_replacement_required')}
                                    </div>
                                )}
                                <input
                                    id="lab-settings-password"
                                    type="password"
                                    value={settingsPassword}
                                    onChange={e => setSettingsPassword(e.target.value)}
                                    placeholder={t('lab_mgmt_form_password_update_placeholder', {
                                        defaultValue: i18n.language.startsWith('ko') ? '새 비밀번호를 입력하면 변경됩니다.' : 'Enter a new password to change it.'
                                    })}
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-slate-100 disabled:opacity-60"
                                    autoComplete="new-password"
                                    disabled={settingsRemovePassword}
                                    minLength={settingsPassword ? LAB_JOIN_PASSWORD_MIN_LENGTH : undefined}
                                    maxLength={LAB_JOIN_PASSWORD_MAX_LENGTH}
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    {t('lab_mgmt_form_password_update_info', {
                                        defaultValue: i18n.language.startsWith('ko') ? '현재 비밀번호는 표시되지 않습니다. 비워두면 변경하지 않습니다.' : 'The current password is not shown. Leave blank to keep it unchanged.'
                                    })}
                                </p>
                                {currentHasPassword !== false && (
                                    <label className="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                                        <input
                                            type="checkbox"
                                            checked={settingsRemovePassword}
                                            onChange={e => {
                                                setSettingsRemovePassword(e.target.checked);
                                                if (e.target.checked) setSettingsPassword('');
                                            }}
                                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        {t('lab_mgmt_form_password_remove', {
                                            defaultValue: i18n.language.startsWith('ko') ? '입장 비밀번호 제거' : 'Remove join password'
                                        })}
                                    </label>
                                )}
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('lab_mgmt_form_institution_type')}</label>
                                <AppSelect
                                    value={settingsInstitutionType}
                                    onChange={setSettingsInstitutionType}
                                    options={instOptions}
                                    className="w-full"
                                    ariaLabel={t('lab_mgmt_form_institution_type')}
                                    buttonClassName={SELECT_BUTTON}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('lab_mgmt_form_research_field')}</label>
                                <AppSelect
                                    value={settingsResearchField}
                                    onChange={setSettingsResearchField}
                                    options={fieldOptions}
                                    className="w-full"
                                    ariaLabel={t('lab_mgmt_form_research_field')}
                                    buttonClassName={SELECT_BUTTON}
                                />
                            </div>
                            <div className="flex gap-2 pt-4">
                                <button type="button" onClick={goBack} className="flex-1 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg font-medium hover:bg-slate-200 transition-colors">
                                    {t('btn_cancel')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={isLoading || !settingsName.trim() || !settingsInstitutionName.trim() || !settingsInstitutionType || !settingsResearchField}
                                    aria-live="polite"
                                    className={`flex-1 py-2 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex justify-center items-center gap-1.5 ${settingsSaved ? 'bg-emerald-600 hover:bg-emerald-600' : 'bg-blue-600 hover:bg-blue-700'}`}
                                >
                                    {isLoading
                                        ? <Loader2 className="w-5 h-5 animate-spin" />
                                        : settingsSaved
                                            ? <><Check className="h-4 w-4" aria-hidden="true" />{t('lab_mgmt_saved')}</>
                                            : t('lab_mgmt_btn_save')}
                                </button>
                            </div>

                            {DELETION_UI_ENABLED && <div className="mt-8 pt-6 border-t border-red-100 dark:border-red-900/30">
                                <h4 className="text-sm font-medium text-red-600 dark:text-red-400 mb-2">{t('lab_mgmt_danger_zone')}</h4>
                                <div className="p-4 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-100 dark:border-red-900/30 flex flex-col gap-3">
                                    <div className="text-sm text-red-700 dark:text-red-300">
                                        {t('lab_mgmt_danger_zone_desc')}
                                    </div>
                                    <input
                                        type="text"
                                        value={deleteConfirmName}
                                        onChange={e => setDeleteConfirmName(e.target.value)}
                                        placeholder={currentLabName}
                                        aria-label={t('lab_mgmt_delete_confirm_2', { name: currentLabName })}
                                        autoComplete="off"
                                        className="w-full px-3 py-2 border border-red-200 dark:border-red-800 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-red-500 outline-none text-slate-900 dark:text-slate-100 placeholder:text-red-300 dark:placeholder:text-red-800"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => { void handleDeleteLab(); }}
                                        disabled={isLoading || !canRequestDeletion}
                                        className="w-full py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors disabled:bg-white disabled:text-red-400 disabled:border disabled:border-red-200 dark:disabled:bg-slate-800 dark:disabled:border-red-900 disabled:cursor-not-allowed"
                                    >
                                        {t('lab_mgmt_delete_lab_btn')}
                                    </button>
                                </div>
                            </div>}
                        </form>
                    )}

                </div>
            </div>
        </div>
        {formDefaults.institutionNames.length > 0 && (
            <datalist id={institutionListId}>
                {formDefaults.institutionNames.map(name => <option key={name} value={name} />)}
            </datalist>
        )}
        {dialogConfig && (
            <CustomDialog
                isOpen
                type={dialogConfig.type}
                title={dialogConfig.title}
                description={dialogConfig.description}
                confirmText={dialogConfig.confirmText}
                isDestructive={dialogConfig.isDestructive}
                isConfirmLoading={isDialogBusy}
                preventCloseWhileLoading
                onClose={dialogConfig.onClose}
                onConfirm={dialogConfig.onConfirm}
            />
        )}
        </>
    );
};
