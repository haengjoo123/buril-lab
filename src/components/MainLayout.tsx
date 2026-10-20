import React, { useState } from 'react';
import { LogOut, Settings, ShoppingBag } from 'lucide-react';
import logo from '../assets/burillab_app_icon.png';
import { SettingsModal } from './SettingsModal';
import { useTranslation } from 'react-i18next';
import { LabContextSwitcher } from './LabContextSwitcher';
import { DesktopSideNav } from './DesktopSideNav';
import { AdaptiveContentContext, useAdaptiveLayout } from '../hooks/useAdaptiveLayout';
import { intersectRegion, navigationMode, resolvePaneGeometry } from '../utils/adaptiveLayout';
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

    const { viewport, visibleViewport, segments, activeRegion, bounds: contentBounds, attachContainer } = useAdaptiveLayout();
    const navWidth = viewport.width < 600 ? 0 : viewport.width < 1200 ? 72 : 224;
    const canSpan = resolvePaneGeometry({ ...viewport, x: navWidth, width: viewport.width - navWidth }, segments).twoPane;
    const layoutRegion = segments.length > 1 && !canSpan ? activeRegion : viewport;
    const region = intersectRegion(layoutRegion, visibleViewport);
    const mode = navigationMode(layoutRegion.width);
    const firstSegment = segments[0];
    const headerWidth = segments.length > 1 && canSpan
        ? firstSegment.width - navWidth : undefined;

    return (
        <div className="adaptive-shell fixed bg-gray-100 font-sans text-slate-900 dark:bg-slate-950 dark:text-slate-100"
            data-navigation={mode} style={{ left: region.x, top: region.y, width: region.width || '100%', height: region.height || '100dvh' }}>
            {onTabClick && <DesktopSideNav activeTab={activeTab} isAdmin={isAdmin} onTabClick={onTabClick}
                userEmail={userEmail} onSettingsClick={() => setIsSettingsOpen(true)} onLogoClick={onLogoClick} />}
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-slate-900">
                <div style={{ width: headerWidth }} className="shrink-0 min-w-0">
                    <header className="adaptive-header flex min-h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-950">
                        <div className="flex min-w-0 items-center gap-2">
                            {mode === 'bottom' && <button onClick={onLogoClick} aria-label={t('app_title')} className="shrink-0 min-h-11 min-w-11"><img src={logo} alt={t('app_logo_alt')} className="h-9 w-9 rounded-lg" /></button>}
                            {!hideLabSwitcher && <LabContextSwitcher />}
                        </div>
                        <div className="flex items-center gap-2">
                            {hasCartItems && onCartClick && (
                                <button
                                    type="button"
                                    onClick={onCartClick}
                                    className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-700 shadow-sm transition-colors hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-900/40"
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
                                className="rounded-lg min-h-11 min-w-11 p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                                title={t('btn_settings')}
                            >
                                <Settings className="h-5 w-5" />
                            </button>
                            {userEmail && onSignOut && (
                                <button
                                    onClick={onSignOut}
                                    className="rounded-lg min-h-11 min-w-11 p-2 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                                    title={t('auth_logout')}
                                >
                                    <LogOut className="h-5 w-5" />
                                </button>
                            )}
                        </div>
                    </header>

                </div>
                <div ref={attachContainer} className="adaptive-content relative min-h-0 min-w-0 flex-1 overflow-hidden">
                    <AdaptiveContentContext.Provider value={contentBounds}>
                        <main className="h-full min-h-0 min-w-0 overflow-y-auto">{children}</main>
                    </AdaptiveContentContext.Provider>
                </div>
                {bottomNav}
            </div>
            {isSettingsOpen && <SettingsModal isAuthenticated={Boolean(userEmail)} onClose={() => setIsSettingsOpen(false)} />}
        </div>
    );
};
