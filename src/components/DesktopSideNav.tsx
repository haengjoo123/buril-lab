import { Building2, ClipboardList, Moon, Package, Rows3, Search, Settings, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import logo from '../assets/burillab_app_icon.png';
import type { AppTab } from '../hooks/useAppUiState';
import { useThemeMode } from '../hooks/useThemeMode';

interface DesktopSideNavProps {
  activeTab: AppTab;
  isAdmin: boolean;
  onTabClick: (tab: AppTab) => void;
  userEmail?: string;
  onSettingsClick: () => void;
  onLogoClick?: () => void;
  /** Red "확인할 일" count shown on the admin item (admins only). */
  adminAttentionCount?: number;
}

type NavTone = 'blue' | 'emerald' | 'red';

const navItemClasses = (isActive: boolean, tone: NavTone = 'blue') => {
  const activeTone = {
    blue: 'bg-blue-600 text-white shadow-sm shadow-blue-950/15',
    emerald: 'bg-emerald-600 text-white shadow-sm shadow-emerald-950/15',
    red: 'bg-red-600 text-white shadow-sm shadow-red-950/15',
  }[tone];

  return [
    'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-all',
    isActive
      ? activeTone
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
  ].join(' ');
};

export function DesktopSideNav({
  activeTab,
  isAdmin,
  onTabClick,
  userEmail,
  onSettingsClick,
  onLogoClick,
  adminAttentionCount = 0,
}: DesktopSideNavProps) {
  const { t } = useTranslation();
  const { isDarkMode, toggleThemeMode } = useThemeMode();
  const attentionCount = isAdmin && adminAttentionCount > 0 ? adminAttentionCount : 0;

  const navItems: Array<{
    tab: AppTab;
    label: string;
    icon: typeof Search;
    tone?: NavTone;
    visible?: boolean;
  }> = [
    { tab: 'search', label: t('tab_search'), icon: Search },
    { tab: 'logs', label: t('tab_logs'), icon: ClipboardList },
    { tab: 'cabinet', label: t('tab_cabinet'), icon: Rows3 },
    { tab: 'inventory', label: t('tab_inventory'), icon: Package, tone: 'emerald' },
    // Same icon and accent as the admin tab in the mobile bottom nav.
    { tab: 'admin', label: t('tab_audit'), icon: Building2, tone: 'red', visible: isAdmin },
  ];

  return (
    <aside className="adaptive-side-nav h-full w-56 shrink-0 border-r border-slate-200 bg-white text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 flex flex-col">
      <div className="flex h-16 shrink-0 items-center border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-950">
        <button
          type="button"
          onClick={onLogoClick}
          className="flex h-11 w-full items-center gap-3 rounded-lg px-1 text-left text-slate-950 transition-colors hover:bg-slate-100 dark:text-white dark:hover:bg-slate-800"
        >
          <img src={logo} alt={t('app_logo_alt')} className="h-9 w-9 shrink-0 rounded-lg object-contain" />
          <span className="truncate text-xl font-bold tracking-tight">{t('app_title')}</span>
        </button>
      </div>

      <nav className="mt-6 flex flex-col gap-1.5 px-3">
        {navItems.filter((item) => item.visible !== false).map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.tab;
          const badgeCount = item.tab === 'admin' ? attentionCount : 0;
          return (
            <button
              key={item.tab}
              type="button"
              onClick={() => onTabClick(item.tab)}
              data-onboarding-target={`nav-${item.tab}`}
              className={navItemClasses(isActive, item.tone)}
              aria-current={isActive ? 'page' : undefined}
            >
              {badgeCount > 0 ? (
                // On the icon, so the rail (labels under icons) shows it too.
                <span className="relative flex shrink-0">
                  <Icon className="h-5 w-5 shrink-0" />
                  <span
                    aria-hidden="true"
                    className={`absolute -right-2 -top-1.5 h-4 min-w-4 rounded-full px-1 text-center text-3xs font-bold leading-4 ring-2 ${isActive
                      ? 'bg-white text-red-700 ring-red-600'
                      : 'bg-red-600 text-white ring-white dark:bg-red-500 dark:ring-slate-950'
                      }`}
                  >
                    {badgeCount > 9 ? '9+' : badgeCount}
                  </span>
                </span>
              ) : (
                <Icon className="h-5 w-5 shrink-0" />
              )}
              <span className="truncate">{item.label}</span>
              {badgeCount > 0 && <span className="sr-only">{t('nav_admin_attention', { count: badgeCount })}</span>}
            </button>
          );
        })}
      </nav>

      <div className="mx-3 mb-5 mt-auto flex flex-col gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        <button
          type="button"
          onClick={onSettingsClick}
          className={navItemClasses(false)}
        >
          <Settings className="h-5 w-5 shrink-0" />
          <span>{t('btn_settings')}</span>
        </button>
        <button
          type="button"
          onClick={toggleThemeMode}
          className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold text-slate-600 transition-all hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          aria-pressed={isDarkMode}
        >
          {isDarkMode ? <Sun className="h-5 w-5 shrink-0" /> : <Moon className="h-5 w-5 shrink-0" />}
          <span className="min-w-0 flex-1 text-left">{t('theme_dark_mode')}</span>
          <span className={`flex h-5 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors ${isDarkMode ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'}`}>
            <span className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${isDarkMode ? 'translate-x-5' : 'translate-x-0'}`} />
          </span>
        </button>
        {userEmail && (
          <div className="mt-2">
            <p className="truncate px-3 text-xs text-slate-500" title={userEmail}>{userEmail}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
