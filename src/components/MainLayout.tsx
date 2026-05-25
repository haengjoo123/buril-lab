import React, { useState } from 'react';
import { LogOut, Settings } from 'lucide-react';
import logo from '../assets/burillab_app_icon.png';
import { SettingsModal } from './SettingsModal';
import { useTranslation } from 'react-i18next';
import { LabContextSwitcher } from './LabContextSwitcher';

interface MainLayoutProps {
    children: React.ReactNode;
    bottomNav?: React.ReactNode;
    onLogoClick?: () => void;
    userEmail?: string;
    onSignOut?: () => void;
    /** 비로그인 시 연구실 전환 UI 숨김 */
    hideLabSwitcher?: boolean;
    onLoginClick?: () => void;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
    children,
    bottomNav,
    onLogoClick,
    userEmail,
    onSignOut,
    hideLabSwitcher,
    onLoginClick,
}) => {
    const { t } = useTranslation();
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    return (
        <div className="fixed inset-0 bg-gray-100 dark:bg-slate-950 flex justify-center font-sans text-slate-900 dark:text-slate-100 transition-colors duration-300">
            {/* Mobile Container: Max width 430px (e.g., iPhone Pro Max width) */}
            <div className="w-full max-w-[430px] h-full bg-white dark:bg-slate-900 shadow-xl relative flex flex-col overflow-hidden transition-colors duration-300">

                {/* Header */}
                <header className="px-3 sm:px-5 py-4 flex items-center gap-2 border-b border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-50 transition-colors duration-300">
                    <button
                        onClick={onLogoClick}
                        className="flex items-center gap-1.5 sm:gap-2 hover:opacity-80 transition-opacity min-w-0 shrink-0"
                    >
                        <div className="shrink-0 overflow-hidden rounded-lg">
                            <img src={logo} alt={t('app_logo_alt')} className="w-9 h-9 object-contain" />
                        </div>
                        <h1 className="text-xl font-bold tracking-tight text-slate-800 dark:text-white truncate max-w-[104px]">{t('app_title')}</h1>
                    </button>
                    <div className="flex flex-1 items-center justify-end gap-1 sm:gap-2 min-w-0">
                        {!hideLabSwitcher && <LabContextSwitcher />}
                        {onLoginClick && (
                            <button
                                type="button"
                                onClick={onLoginClick}
                                className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors px-1"
                            >
                                {t('auth_login')}
                            </button>
                        )}
                        <button
                            onClick={() => setIsSettingsOpen(true)}
                            className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors shrink-0 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                            title={t('btn_settings')}
                        >
                            <Settings className="w-5 h-5 transition-transform hover:rotate-45" />
                        </button>
                        {userEmail && onSignOut && (
                            <button
                                onClick={onSignOut}
                                className="p-2 text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0"
                                title={t('auth_logout')}
                            >
                                <LogOut className="w-5 h-5" />
                            </button>
                        )}
                    </div>
                </header>

                {/* Scrollable Content Area - pb-16: fixed 하단 바 높이만큼 하단 패딩 */}
                <main className="flex-1 overflow-y-auto w-full min-h-0 pb-16">
                    {children}
                </main>

                {/* Bottom Nav - 스크롤 영역 밖, 뷰포트 하단 고정 */}
                {bottomNav}

                {/* Settings Modal */}
                {isSettingsOpen && (
                    <SettingsModal onClose={() => setIsSettingsOpen(false)} />
                )}
            </div>
        </div>
    );
};
