import React, { useState, useEffect } from 'react';
import { useLabStore } from '../store/useLabStore';
import { labService } from '../services/labService';
import { ChevronDown, Users, User } from 'lucide-react';
import { LabManagementModal } from './LabManagementModal';
import { useTranslation } from 'react-i18next';

export const LabContextSwitcher: React.FC = () => {
    const { t } = useTranslation();
    const { currentLabId, setCurrentLabId, myLabs, setMyLabs } = useLabStore();
    const [isOpen, setIsOpen] = useState(false);
    const [isManageOpen, setIsManageOpen] = useState(false);

    useEffect(() => {
        labService.getMyLabs().then(setMyLabs).catch(console.error);
    }, [setMyLabs]);

    const currentLab = myLabs.find(m => m.lab_id === currentLabId)?.lab;

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 px-2 py-1.5 rounded-md transition-colors whitespace-nowrap overflow-hidden"
                title={t('lab_switcher_title')}
            >
                {currentLabId ? (
                    <div className="flex items-center gap-1.5 min-w-0">
                        <Users className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate max-w-[70px] sm:max-w-[150px] whitespace-nowrap">{currentLab?.name || 'Lab'}</span>
                    </div>
                ) : (
                    <div className="flex items-center gap-1.5 min-w-0">
                        <User className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate max-w-[85px] sm:max-w-none whitespace-nowrap">{t('lab_personal_space')}</span>
                    </div>
                )}
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
            </button>

            {isOpen && (
                <>
                    {/* Backdrop to close when clicking outside */}
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} title="Close menu"></div>

                    <div className="absolute top-full right-0 mt-1 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-100 dark:border-slate-700 py-2 z-50">
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
                                    <span className="truncate">{member.lab?.name || 'Unknown'}</span>
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
