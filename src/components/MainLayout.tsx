import React, { useState } from 'react';
import { LogOut, Settings, ShoppingBag } from 'lucide-react';
import logo from '../assets/burillab_app_icon.png';
import { SettingsModal } from './SettingsModal';
import { useTranslation } from 'react-i18next';
import { LabContextSwitcher } from './LabContextSwitcher';
import { DesktopSideNav } from './DesktopSideNav';
import type { AppTab } from '../hooks/useAppUiState';

interface MainLayoutProps {
    children: React.ReactNode;
    bottomNav?: React.ReactNode;
    onLogoClick?: () => void;
    userEmail?: string;
    onSignOut?: () => void;
    hideLabSwitcher?: boolean;
    onLoginClick?: () => void;
    activeTab?: AppTab;
    isAdmin?: boolean;
    onTabClick?: (tab: AppTab) => void;
    cartCount?: number;
    onCartClick?: () => void;
}

export const MainLayout: React.FC<MainLayoutProps> = ({
    children,
    bottomNav,
    onLogoClick,
    userEmail,
    onSignOut,
    hideLabSwitcher,
    onLoginClick,
    activeTab = 'search',
    isAdmin = false,
    onTabClick,
    cartCount = 0,
    onCartClick,
}) => {
    const { t } = useTranslation();
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const hasCartItems = cartCount > 0;
    const cartBadgeText = cartCount > 99 ? '99+' : String(cartCount);

    return (
        <div className="fixed inset-0 bg-gray-100 font-sans text-slate-900 transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100">
            <div className="flex h-full justify-center lg:hidden">
                <div className="relative flex h-full w-full max-w-[430px] flex-col overflow-hidden bg-white shadow-xl transition-colors duration-300 dark:bg-slate-900">
                    <header className="sticky top-0 z-50 flex items-center gap-2 border-b border-gray-100 bg-white px-3 py-4 transition-colors duration-300 dark:border-slate-800 dark:bg-slate-900 sm:px-5">
                        <button
                            onClick={onLogoClick}
                            className="flex min-w-0 shrink-0 items-center gap-1.5 transition-opacity hover:opacity-80 sm:gap-2"
                        >
                            <div className="shrink-0 overflow-hidden rounded-lg">
                                <img src={logo} alt={t('app_logo_alt')} className="h-9 w-9 object-contain" />
                            </div>
                            <h1 className="max-w-[104px] truncate text-xl font-bold tracking-tight text-slate-800 dark:text-white">{t('app_title')}</h1>
                        </button>
                        <div className="flex min-w-0 flex-1 items-center justify-end gap-1 sm:gap-2">
                            {!hideLabSwitcher && <LabContextSwitcher />}
                            {onLoginClick && (
                                <button
                                    type="button"
                                    onClick={onLoginClick}
                                    className="px-1 text-sm font-semibold text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                                >
                                    {t('auth_login')}
                                </button>
                            )}
                            <button
                                onClick={() => setIsSettingsOpen(true)}
                                className="shrink-0 rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                                title={t('btn_settings')}
                            >
                                <Settings className="h-5 w-5 transition-transform hover:rotate-45" />
                            </button>
                            {userEmail && onSignOut && (
                                <button
                                    onClick={onSignOut}
                                    className="shrink-0 rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                                    title={t('auth_logout')}
                                >
                                    <LogOut className="h-5 w-5" />
                                </button>
                            )}
                        </div>
                    </header>

                    <main className="min-h-0 w-full flex-1 overflow-y-auto pb-16">
                        {children}
                    </main>

                    {bottomNav}
                </div>
            </div>

            <div className="hidden h-full w-full bg-slate-50 dark:bg-slate-950 lg:flex">
                {onTabClick && (
                    <DesktopSideNav
                        activeTab={activeTab}
                        isAdmin={isAdmin}
                        onTabClick={onTabClick}
                        userEmail={userEmail}
                        onSettingsClick={() => setIsSettingsOpen(true)}
                        onLogoClick={onLogoClick}
                    />
                )}

                <div className="flex min-w-0 flex-1 flex-col">
                    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 dark:border-slate-800 dark:bg-slate-950">
                        <div className="flex min-w-0 items-center gap-3">
                            {!hideLabSwitcher && <LabContextSwitcher />}
                        </div>
                        <div className="flex items-center gap-2">
                            {hasCartItems && onCartClick && (
                                <button
                                    type="button"
                                    onClick={onCartClick}
                                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-700 shadow-sm transition-colors hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-900/40"
                                    aria-label={`${t('cart_title')} ${cartBadgeText}`}
                                    title={t('cart_title')}
                                >
                                    <span className="relative flex h-5 w-5 items-center justify-center">
                                        <ShoppingBag className="h-5 w-5" />
                                        <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-blue-50 dark:ring-blue-950">
                                            {cartBadgeText}
                                        </span>
                                    </span>
                                    <span className="hidden xl:inline">{t('cart_title')}</span>
                                </button>
                            )}
                            {onLoginClick && (
                                <button
                                    type="button"
                                    onClick={onLoginClick}
                                    className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-900/40"
                                >
                                    {t('auth_login')}
                                </button>
                            )}
                            <button
                                onClick={() => setIsSettingsOpen(true)}
                                className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                                title={t('btn_settings')}
                            >
                                <Settings className="h-5 w-5" />
                            </button>
                            {userEmail && onSignOut && (
                                <button
                                    onClick={onSignOut}
                                    className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                                    title={t('auth_logout')}
                                >
                                    <LogOut className="h-5 w-5" />
                                </button>
                            )}
                        </div>
                    </header>

                    <main className="min-h-0 flex-1 overflow-y-auto">
                        {children}
                    </main>
                </div>
            </div>

            {isSettingsOpen && (
                <SettingsModal onClose={() => setIsSettingsOpen(false)} />
            )}
        </div>
    );
};
