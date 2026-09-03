/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect } from 'react';
import { X, Search, Plus, Check, Loader2, AlertCircle, Users, Settings, Lock, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LAB_MEMBERSHIP_LIMIT, isLabMembershipLimitError, labService } from '../services/labService';
import { useLabStore } from '../store/useLabStore';
import type { Lab } from '../store/useLabStore';
import {
    LAB_JOIN_PASSWORD_MAX_LENGTH,
    LAB_JOIN_PASSWORD_MIN_LENGTH,
    labPasswordIssueFromError,
    type LabPasswordPolicyIssue,
    validateLabJoinPassword,
} from '../utils/labPasswordPolicy';

type LabWithPassword = Lab & { has_password?: boolean };
import { AppSelect } from './AppSelect';

interface LabManagementModalProps {
    onClose: () => void;
}

export const LabManagementModal: React.FC<LabManagementModalProps> = ({ onClose }) => {
    const { t, i18n } = useTranslation();
    const [view, setView] = useState<'menu' | 'create' | 'search' | 'members' | 'settings'>('menu');
    const [query, setQuery] = useState('');
    const [searchResults, setSearchResults] = useState<LabWithPassword[]>([]);
    const [members, setMembers] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [createName, setCreateName] = useState('');
    const [createPassword, setCreatePassword] = useState('');
    const [createNickname, setCreateNickname] = useState('');
    const [createInstitutionName, setCreateInstitutionName] = useState('');
    const [createInstitutionType, setCreateInstitutionType] = useState('');
    const [createResearchField, setCreateResearchField] = useState('');

    // For joining a lab
    const [selectedLabId, setSelectedLabId] = useState<string | null>(null);
    const [joinPassword, setJoinPassword] = useState('');
    const [joinNickname, setJoinNickname] = useState('');

    // For settings
    const [settingsName, setSettingsName] = useState('');
    const [settingsPassword, setSettingsPassword] = useState('');
    const [settingsRemovePassword, setSettingsRemovePassword] = useState(false);
    const [settingsInstitutionName, setSettingsInstitutionName] = useState('');
    const [settingsInstitutionType, setSettingsInstitutionType] = useState('');
    const [settingsResearchField, setSettingsResearchField] = useState('');

    const [isLeaving, setIsLeaving] = useState<string | null>(null); // labId being left

    const { myLabs, setMyLabs, currentLabId, setCurrentLabId } = useLabStore();

    const currentMembership = myLabs.find(m => m.lab_id === currentLabId);
    const currentRole = currentMembership?.role;
    const hasReachedLabLimit = myLabs.length >= LAB_MEMBERSHIP_LIMIT;
    const labLimitMessage = t('lab_mgmt_limit_reached', { max: LAB_MEMBERSHIP_LIMIT });
    const passwordIssueMessage = (issue: LabPasswordPolicyIssue) => t(`lab_mgmt_password_${issue}`, {
        min: LAB_JOIN_PASSWORD_MIN_LENGTH,
        max: LAB_JOIN_PASSWORD_MAX_LENGTH,
    });

    const handleLeaveLab = async (labId: string, labName: string) => {
        if (!window.confirm(t('lab_leave_confirm', { name: labName }))) return;
        setIsLeaving(labId);
        setError(null);
        try {
            await labService.leaveLab(labId);
            const updatedLabs = await labService.getMyLabs();
            setMyLabs(updatedLabs);
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

    const handleRemoveMember = async (userId: string) => {
        if (!currentLabId || !window.confirm(t('lab_mgmt_member_kick_confirm'))) return;
        setIsLoading(true);
        try {
            await labService.removeMember(currentLabId, userId);
            await loadMembers(); // refresh
        } catch (err: any) {
            setError(err.message || t('admin_remove_error'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleSearch = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!query.trim()) return;
        setIsLoading(true);
        setError(null);
        try {
            const results = await labService.searchLabs(query);
            setSearchResults(results);
        } catch (err: any) {
            setError(err.message || "Failed to search labs");
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!createName.trim() || !createNickname.trim() || !createInstitutionName.trim() || !createInstitutionType || !createResearchField) return;
        const passwordIssue = validateLabJoinPassword(createName, createPassword);
        if (passwordIssue) {
            setError(passwordIssueMessage(passwordIssue));
            return;
        }
        if (hasReachedLabLimit) {
            setError(labLimitMessage);
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
            // update state
            const updatedLabs = await labService.getMyLabs();
            setMyLabs(updatedLabs);
            setCurrentLabId(newLab.id);
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
            if (settingsRemovePassword || settingsPassword !== '') {
                await labService.updateLabJoinPassword(
                    currentLabId,
                    settingsRemovePassword ? '' : settingsPassword
                );
            }
            const updatedLabs = await labService.getMyLabs();
            setMyLabs(updatedLabs);
            alert(t('lab_mgmt_settings_saved'));
            setView('menu');
        } catch (err: any) {
            const passwordIssue = labPasswordIssueFromError(err);
            setError(passwordIssue ? passwordIssueMessage(passwordIssue) : (err.message || t('admin_role_change_error')));
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteLab = async () => {
        if (!currentLabId) return;
        const confirm1 = window.confirm(t('lab_mgmt_delete_confirm_1', { name: settingsName }));
        if (!confirm1) return;

        const confirm2 = window.prompt(t('lab_mgmt_delete_confirm_2', { name: settingsName }));
        if (confirm2 !== settingsName) {
            alert(t('lab_mgmt_delete_mismatch'));
            return;
        }

        setIsLoading(true);
        setError(null);
        try {
            await labService.deleteLab(currentLabId);
            const updatedLabs = await labService.getMyLabs();
            setMyLabs(updatedLabs);
            setCurrentLabId(null);
            alert(t('lab_mgmt_delete_success'));
            onClose();
        } catch (err: any) {
            setError(err.message || t('admin_remove_error'));
            setIsLoading(false);
        }
    };

    const openSettings = () => {
        const lab = myLabs.find(m => m.lab_id === currentLabId)?.lab;
        setSettingsName(lab?.name || '');
        setSettingsPassword('');
        setSettingsRemovePassword(false);
        setSettingsInstitutionName(lab?.institution_name || '');
        setSettingsInstitutionType(lab?.institution_type || '');
        setSettingsResearchField(lab?.research_field || '');
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

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-5 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div role="dialog" aria-modal="true" aria-labelledby="lab-management-title" className="w-full max-w-[380px] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">

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
                        <div className="mb-4 flex items-center gap-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg text-sm">
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
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg">
                                            <Settings className="w-5 h-5" />
                                        </div>
                                        <div className="text-left">
                                            <div className="font-semibold text-slate-800 dark:text-slate-200">{t('lab_mgmt_settings_title')}</div>
                                            <div className="text-xs text-slate-500 dark:text-slate-400">{t('lab_mgmt_form_password_help')}</div>
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
                                onClick={() => setView('search')}
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
                                onClick={() => setView('create')}
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
                                            return (
                                                <li
                                                    key={ml.lab_id}
                                                    onClick={() => !isActive && setCurrentLabId(ml.lab_id)}
                                                    className={`flex justify-between items-center p-3 rounded-lg border gap-2 transition-colors ${
                                                        isActive
                                                            ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-400 dark:border-blue-500'
                                                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/70 hover:border-slate-300 dark:hover:border-slate-700'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        {isActive && (
                                                            <span className="flex-shrink-0 flex items-center gap-0.5 text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded">
                                                                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full inline-block" />
                                                                {t('lab_mgmt_current_session')}
                                                            </span>
                                                        )}
                                                        <span className={`font-medium min-w-0 truncate ${isActive ? 'text-blue-800 dark:text-blue-200' : 'text-slate-700 dark:text-slate-200'}`}>
                                                            {ml.lab?.name}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 flex-shrink-0">
                                                        <span className={`text-xs px-2 py-1 rounded font-medium ${
                                                            ml.role === 'admin' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
                                                            ml.role === 'pi' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                                                            'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                                        }`}>
                                                            {t(`member_role_${ml.role}`, { defaultValue: ml.role })}
                                                        </span>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleLeaveLab(ml.lab_id, ml.lab?.name ?? ''); }}
                                                            disabled={isLeaving === ml.lab_id}
                                                            className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 transition-colors disabled:opacity-50"
                                                        >
                                                            {isLeaving === ml.lab_id
                                                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                                                : <LogOut className="w-3 h-3" />
                                                            }
                                                            {t('lab_leave_btn')}
                                                        </button>
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>
                        </div>
                    )}
                    {view === 'create' && (
                        <form onSubmit={handleCreate} className="space-y-4">
                            {hasReachedLabLimit && (
                                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span>{labLimitMessage}</span>
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('lab_mgmt_form_lab_name')}</label>
                                <input
                                    type="text"
                                    value={createName}
                                    onChange={e => setCreateName(e.target.value)}
                                    placeholder={t('lab_mgmt_form_lab_name_placeholder')}
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-slate-100"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('lab_mgmt_form_nickname')}</label>
                                <input
                                    type="text"
                                    value={createNickname}
                                    onChange={e => setCreateNickname(e.target.value)}
                                    placeholder={t('lab_mgmt_form_nickname_placeholder')}
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-slate-100"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">소속 기관명</label>
                                <input
                                    type="text"
                                    value={createInstitutionName}
                                    onChange={e => setCreateInstitutionName(e.target.value)}
                                    placeholder="예: 릴랩대학교"
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-slate-100"
                                    required
                                />
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                    통합 안전관리센터 연결 후보를 식별하는 기준입니다.
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('lab_mgmt_form_institution_type')}</label>
                                <AppSelect
                                    value={createInstitutionType}
                                    onChange={setCreateInstitutionType}
                                    options={instOptions}
                                    className="w-full"
                                    buttonClassName="w-full bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-slate-100 min-h-[42px] px-3 py-2 rounded-lg"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('lab_mgmt_form_research_field')}</label>
                                <AppSelect
                                    value={createResearchField}
                                    onChange={setCreateResearchField}
                                    options={fieldOptions}
                                    className="w-full"
                                    buttonClassName="w-full bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-slate-100 min-h-[42px] px-3 py-2 rounded-lg"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('lab_mgmt_form_password_opt')}</label>
                                <input
                                    type="password"
                                    value={createPassword}
                                    onChange={e => setCreatePassword(e.target.value)}
                                    placeholder={t('lab_mgmt_form_password_placeholder')}
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-slate-100"
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
                                <button type="button" onClick={() => setView('menu')} className="flex-1 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg font-medium hover:bg-slate-200 transition-colors">
                                    {t('btn_cancel')}
                                </button>
                                <button type="submit" disabled={isLoading || hasReachedLabLimit || !createName.trim() || !createNickname.trim() || !createInstitutionName.trim() || !createInstitutionType || !createResearchField} className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex justify-center items-center">
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

                                        return (
                                            <div
                                                key={lab.id}
                                                className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedLabId === lab.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 bg-white dark:bg-slate-900/50'}`}
                                                onClick={() => setSelectedLabId(lab.id)}
                                            >
                                                <div className="flex justify-between items-start gap-3">
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            {lab.has_password && <Lock className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />}
                                                            <span className="font-medium text-slate-800 dark:text-slate-200 break-words">{lab.name}</span>
                                                        </div>
                                                        {institutionTypeLabel && (
                                                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                                {institutionTypeLabel}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {selectedLabId === lab.id && <Check className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {selectedLabId && (
                                <div className="animate-in fade-in slide-in-from-bottom-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                                    <p className="text-[10px] text-slate-500 mb-4 px-1 italic">
                                        * {t('lab_mgmt_role_approval_info', { defaultValue: '가입 후 관리자가 최종적인 역할을 지정합니다.' })}
                                    </p>
                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('lab_mgmt_form_nickname')}</label>
                                        <input
                                            type="text"
                                            value={joinNickname}
                                            onChange={e => setJoinNickname(e.target.value)}
                                            placeholder={t('lab_mgmt_form_nickname_placeholder')}
                                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-slate-100"
                                            required
                                        />
                                    </div>
                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('lab_mgmt_form_password_if_set')}</label>
                                        <input
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

                            {searchResults.length === 0 && query && !isLoading && (
                                <div className="text-center py-8 text-slate-500 dark:text-slate-400 text-sm">
                                    {t('lab_mgmt_search_no_results')}
                                </div>
                            )}

                            <div className="pt-2">
                                <button type="button" onClick={() => { setView('menu'); setSelectedLabId(null); setJoinPassword(''); setJoinNickname(''); }} className="w-full py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg font-medium hover:bg-slate-200 transition-colors">
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
                                <ul className="space-y-3">
                                    {members.map(member => (
                                        <li key={member.user_id} className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                                            <div className="flex justify-between items-start gap-2 mb-2">
                                                <div className="flex flex-col min-w-0">
                                                    <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                                                        {member.nickname || member.email || '알 수 없는 사용자'}
                                                    </span>
                                                    {member.nickname && member.email && (
                                                        <span className="text-xs text-slate-400 dark:text-slate-500 truncate">
                                                            {member.email}
                                                        </span>
                                                    )}
                                                    <span className="text-xs text-slate-500 mt-0.5">{t('member_joined_label')}: {new Date(member.joined_at).toLocaleDateString(i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US')}</span>
                                                </div>
                                                <span className={`flex-shrink-0 text-xs px-2 py-1 rounded font-medium ${
                                                    member.role === 'admin' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' :
                                                    member.role === 'pi' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' :
                                                    'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                                                }`}>
                                                    {member.role === 'admin' ? 'ADMIN' : t(`member_role_${member.role}`)}
                                                </span>
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
                                                        onClick={() => handleRemoveMember(member.user_id)}
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
                            )}
                            <div className="pt-2 sticky bottom-0 bg-white dark:bg-slate-900 pb-1 -mx-1 px-1 mt-2 border-t border-slate-100 dark:border-slate-800">
                                <button type="button" onClick={() => setView('menu')} className="w-full mt-2 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg font-medium hover:bg-slate-200 transition-colors">
                                    {t('lab_mgmt_btn_back')}
                                </button>
                            </div>
                        </div>
                    )}

                    {view === 'settings' && (
                        <form onSubmit={handleUpdateSettings} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('lab_mgmt_form_lab_name')}</label>
                                <input
                                    type="text"
                                    value={settingsName}
                                    onChange={e => setSettingsName(e.target.value)}
                                    placeholder={t('lab_mgmt_form_lab_name')}
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-slate-100"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">소속 기관명</label>
                                <input
                                    type="text"
                                    value={settingsInstitutionName}
                                    onChange={e => setSettingsInstitutionName(e.target.value)}
                                    placeholder="예: 릴랩대학교"
                                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-blue-500 outline-none text-slate-900 dark:text-slate-100"
                                    required
                                />
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                    같은 기관의 승인된 통합센터에서 연결 요청 후보로 찾을 때 사용됩니다.
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('lab_mgmt_form_password')}</label>
                                {currentMembership?.lab?.join_password_needs_change && (
                                    <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
                                        {t('lab_mgmt_password_replacement_required')}
                                    </div>
                                )}
                                <input
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
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('lab_mgmt_form_institution_type')}</label>
                                <AppSelect
                                    value={settingsInstitutionType}
                                    onChange={setSettingsInstitutionType}
                                    options={instOptions}
                                    className="w-full"
                                    buttonClassName="w-full bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-slate-100 min-h-[42px] px-3 py-2 rounded-lg"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('lab_mgmt_form_research_field')}</label>
                                <AppSelect
                                    value={settingsResearchField}
                                    onChange={setSettingsResearchField}
                                    options={fieldOptions}
                                    className="w-full"
                                    buttonClassName="w-full bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-slate-100 min-h-[42px] px-3 py-2 rounded-lg"
                                />
                            </div>
                            <div className="flex gap-2 pt-4">
                                <button type="button" onClick={() => setView('menu')} className="flex-1 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg font-medium hover:bg-slate-200 transition-colors">
                                    {t('btn_cancel')}
                                </button>
                                <button type="submit" disabled={isLoading || !settingsName.trim() || !settingsInstitutionName.trim() || !settingsInstitutionType || !settingsResearchField} className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex justify-center items-center">
                                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : t('lab_mgmt_btn_save')}
                                </button>
                            </div>

                            <div className="mt-8 pt-6 border-t border-red-100 dark:border-red-900/30">
                                <h4 className="text-sm font-medium text-red-600 dark:text-red-400 mb-2">{t('lab_mgmt_danger_zone')}</h4>
                                <div className="p-4 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-100 dark:border-red-900/30 flex flex-col gap-3">
                                    <div className="text-sm text-red-700 dark:text-red-300">
                                        {t('lab_mgmt_danger_zone_desc')}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleDeleteLab}
                                        disabled={isLoading}
                                        className="w-full py-2 bg-white dark:bg-slate-800 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg font-medium hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                                    >
                                        {t('lab_mgmt_delete_lab_btn')}
                                    </button>
                                </div>
                            </div>
                        </form>
                    )}

                </div>
            </div>
        </div>
    );
};
