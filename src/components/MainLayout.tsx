import React, { useState } from 'react';
import { FlaskConical, LogOut } from 'lucide-react';
import { SettingsModal } from './SettingsModal';
import { useTranslation } from 'react-i18next';

interface MainLayoutProps {
    children: React.ReactNode;
    onLogoClick?: () => void;
    userEmail?: string;
    onSignOut?: () => void;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children, onLogoClick, userEmail, onSignOut }) => {
    const { t } = useTranslation();
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    return (
        <div className="min-h-screen bg-gray-100 dark:bg-slate-950 flex justify-center items-center font-sans text-slate-900 dark:text-slate-100 transition-colors duration-300">
            {/* Mobile Container: Max width 430px (e.g., iPhone Pro Max width) */}
            <div className="w-full max-w-[430px] min-h-screen bg-white dark:bg-slate-900 shadow-xl relative flex flex-col overflow-hidden transition-colors duration-300">

                {/* Header */}
                <header className="px-5 py-4 flex items-center justify-between border-b border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10 transition-colors duration-300">
                    <button
                        onClick={onLogoClick}
                        className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                    >
                        <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
                            <FlaskConical className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                        </div>
                        <h1 className="text-xl font-bold tracking-tight text-slate-800 dark:text-white">{t('app_title')}</h1>
                    </button>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setIsSettingsOpen(true)}
                            className="text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                        >
                            {t('btn_settings')}
                        </button>
                        {userEmail && onSignOut && (
                            <button
                                onClick={onSignOut}
                                className="p-2 text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                                title={t('auth_logout')}
                            >
                                <LogOut className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </header>

                {/* Scrollable Content Area */}
                <main className="flex-1 overflow-y-auto w-full">
                    {children}
                </main>

                {/* Settings Modal */}
                {isSettingsOpen && (
                    <SettingsModal onClose={() => setIsSettingsOpen(false)} />
                )}
            </div>
        </div>
    );
};
