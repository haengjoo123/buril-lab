import { useTranslation } from 'react-i18next';
import { Search, ClipboardList, Rows3, Package, Building2, FlaskConical } from 'lucide-react';
import { isLabToolsEnabled } from '../config/featureFlags';
import type { AppTab } from '../hooks/useAppUiState';

interface BottomTabNavProps {
  activeTab: AppTab;
  isAdmin: boolean;
  onTabClick: (tab: AppTab) => void;
  /** Red "확인할 일" count shown on the admin tab (admins only). */
  adminAttentionCount?: number;
}

/** Badge text on the admin tab: two characters at most so it never widens the tab. */
function formatAdminAttentionBadge(count: number): string {
  return count > 9 ? '9+' : String(count);
}

interface NavItem {
  tab: AppTab;
  label: string;
  icon: typeof Search;
  tone?: 'blue' | 'red';
  onboardingTarget?: string;
}

export function BottomTabNav({ activeTab, isAdmin, onTabClick, adminAttentionCount = 0 }: BottomTabNavProps) {
  const { t } = useTranslation();
  const attentionCount = isAdmin && adminAttentionCount > 0 ? adminAttentionCount : 0;

  const items: NavItem[] = [
    { tab: 'search', label: t('tab_search'), icon: Search, onboardingTarget: 'nav-search' },
    { tab: 'logs', label: t('tab_logs'), icon: ClipboardList, onboardingTarget: 'nav-logs' },
    // Shelves for the cabinet so it no longer looks like the inventory package icon.
    { tab: 'cabinet', label: t('tab_cabinet'), icon: Rows3, onboardingTarget: 'nav-cabinet' },
    { tab: 'inventory', label: t('tab_inventory'), icon: Package, onboardingTarget: 'nav-inventory' },
    ...(isLabToolsEnabled ? [{ tab: 'tools' as const, label: t('tab_tools'), icon: FlaskConical }] : []),
    ...(isAdmin ? [{ tab: 'admin' as const, label: t('tab_audit'), icon: Building2, tone: 'red' as const }] : []),
  ];

  return (
    <nav className="adaptive-bottom-nav z-30 flex w-full shrink-0 border-t border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {items.map(({ tab, label, icon: Icon, tone = 'blue', onboardingTarget }) => {
        const isActive = activeTab === tab;
        const activeText = tone === 'red' ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400';
        const activePill = tone === 'red' ? 'bg-red-50 dark:bg-red-500/15' : 'bg-blue-50 dark:bg-blue-500/15';
        const badgeCount = tab === 'admin' ? attentionCount : 0;
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onTabClick(tab)}
            data-onboarding-target={onboardingTarget}
            aria-current={isActive ? 'page' : undefined}
            className={`group flex min-w-0 flex-1 flex-col items-center gap-1 py-2 text-xs transition-colors ${isActive
              ? `${activeText} font-semibold`
              : 'font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
          >
            <span
              aria-hidden="true"
              className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${isActive ? activePill : 'group-hover:bg-slate-100 dark:group-hover:bg-slate-800'}`}
            >
              <span className="relative flex">
                <Icon className="h-5 w-5" strokeWidth={isActive ? 2.25 : 2} />
                {badgeCount > 0 && (
                  <span aria-hidden="true" className="absolute -right-2 -top-1.5 h-4 min-w-4 rounded-full bg-red-600 px-1 text-center text-3xs font-bold leading-4 text-white ring-2 ring-white dark:bg-red-500 dark:ring-slate-900">
                    {formatAdminAttentionBadge(badgeCount)}
                  </span>
                )}
              </span>
            </span>
            <span className="max-w-full truncate px-1">{label}</span>
            {badgeCount > 0 && <span className="sr-only">{t('nav_admin_attention', { count: badgeCount })}</span>}
          </button>
        );
      })}
    </nav>
  );
}
