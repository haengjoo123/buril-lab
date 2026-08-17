import React, { useState, useEffect } from 'react';
import { useLabStore } from '../store/useLabStore';
import { labService } from '../services/labService';
import { ChevronDown, Users, User } from 'lucide-react';
import { LabManagementModal } from './LabManagementModal';
import { useTranslation } from 'react-i18next';

interface LabContextSwitcherProps {
    variant?: 'header' | 'sidebar';
    userEmail?: string;
}

export const LabContextSwitcher: React.FC<LabContextSwitcherProps> = ({ variant = 'header', userEmail }) => {
    const { t } = useTranslation();
    const { currentLabId, setCurrentLabId, myLabs, setMyLabs } = useLabStore();
    const [isOpen, setIsOpen] = useState(false);
    const [isManageOpen, setIsManageOpen] = useState(false);
    const isSidebar = variant === 'sidebar';

    useEffect(() => {
        labService.getMyLabs().then(setMyLabs).catch(console.error);
    }, [setMyLabs]);

    const currentLab = myLabs.find(m => m.lab_id === currentLabId)?.lab;

    const currentLabel = currentLabId
        ? currentLab?.name || t('lab_default_name')
        : t('lab_personal_space');

    return (
        <div className={isSidebar
            ? 'relative min-w-0 w-full'
            : 'relative min-w-0 max-w-[128px] lg:w-72 lg:max-w-72 xl:w-80 xl:max-w-80 2xl:w-96 2xl:max-w-96'}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={isSidebar
                    ? 'flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-left transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'
                    : 'flex max-w-full items-center gap-1 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 px-2 py-1.5 rounded-md transition-colors whitespace-nowrap overflow-hidden lg:w-full'}
                title={t('lab_switcher_title')}
            >
                {isSidebar ? (
                    <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t('lab_switcher_title')}</div>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {currentLabId ? <Users className="h-3.5 w-3.5 shrink-0" /> : <User className="h-3.5 w-3.5 shrink-0" />}
                            <span className="min-w-0 truncate">{userEmail || currentLabel}</span>
                        </div>
                    </div>
                ) : currentLabId ? (
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate whitespace-nowrap">{currentLabel}</span>
                    </div>
                ) : (
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <User className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate whitespace-nowrap">{currentLabel}</span>
                    </div>
                )}
                <ChevronDown className={isSidebar ? 'h-4 w-4 shrink-0 text-slate-400' : 'w-3.5 h-3.5 shrink-0'} />
            </button>

            {isOpen && (
                <>
                    {/* Backdrop to close when clicking outside */}
                    <button
                        type="button"
                        className="fixed inset-0 z-40"
                        onClick={() => setIsOpen(false)}
                        aria-label={t('common_close_menu')}
                    />

                    <div className={`${isSidebar ? 'absolute bottom-full left-0 mb-2 w-full min-w-56' : 'absolute top-full right-0 mt-1 w-56 lg:left-0 lg:right-auto lg:w-full lg:min-w-64'} bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-100 dark:border-slate-700 py-2 z-50`}>
                        <div className="px-3 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                            {t('lab_my_space')}
                        </div>
                        <button
                            onClick={() => { setCurrentLabId(null); setIsOpen(false); }}
                            className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${!currentLabId ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 font-bold' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
                        >
                            <User className="w-4 h-4" /> {t('lab_personal_space')}
                        </button>

                        <div className="px-3 mt-2 mb-1 text-xs font-semibold text-slate-400 uppercase tracking-wider flex justify-between items-center">
                            {t('lab_list')}
                        </div>
                        {myLabs.length === 0 ? (
                            <div className="px-4 py-2 text-sm text-slate-400 italic">{t('lab_no_joined')}</div>
                        ) : (
                            myLabs.map(member => (
                                <button
                                    key={member.lab_id}
                                    onClick={() => { setCurrentLabId(member.lab_id); setIsOpen(false); }}
                                    className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${currentLabId === member.lab_id ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 font-bold' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
                                >
                                    <Users className="w-4 h-4 shrink-0" />
                                    <span className="truncate">{member.lab?.name || t('common_unknown')}</span>
                                    <span className="text-xs text-slate-400 shrink-0 capitalize">({t(`member_role_${member.role}`)})</span>
                                </button>
                            ))
                        )}

                        <div className="border-t border-slate-100 dark:border-slate-700 mt-2 mx-2 pt-2">
                            <button
                                onClick={() => { setIsOpen(false); setIsManageOpen(true); }}
                                className="w-full text-left px-2 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-md transition-colors font-medium flex items-center justify-center gap-2"
                            >
                                <Users className="w-4 h-4" /> {t('lab_manage_join')}
                            </button>
                        </div>
                    </div>
                </>
            )}

            {isManageOpen && (
                <LabManagementModal onClose={() => setIsManageOpen(false)} />
            )}
        </div>
    );
};
