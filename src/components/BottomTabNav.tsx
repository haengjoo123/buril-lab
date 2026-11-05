import { useTranslation } from 'react-i18next';
import { Search, ClipboardList, Rows3, Package, Building2 } from 'lucide-react';
import type { AppTab } from '../hooks/useAppUiState';

interface BottomTabNavProps {
  activeTab: AppTab;
  isAdmin: boolean;
  onTabClick: (tab: AppTab) => void;
}

interface NavItem {
  tab: AppTab;
  label: string;
  icon: typeof Search;
  tone?: 'blue' | 'red';
  onboardingTarget?: string;
}

export function BottomTabNav({ activeTab, isAdmin, onTabClick }: BottomTabNavProps) {
  const { t } = useTranslation();

  const items: NavItem[] = [
    { tab: 'search', label: t('tab_search'), icon: Search, onboardingTarget: 'nav-search' },
    { tab: 'logs', label: t('tab_logs'), icon: ClipboardList, onboardingTarget: 'nav-logs' },
    // Shelves for the cabinet so it no longer looks like the inventory package icon.
    { tab: 'cabinet', label: t('tab_cabinet'), icon: Rows3, onboardingTarget: 'nav-cabinet' },
    { tab: 'inventory', label: t('tab_inventory'), icon: Package, onboardingTarget: 'nav-inventory' },
    ...(isAdmin ? [{ tab: 'admin' as const, label: t('tab_audit'), icon: Building2, tone: 'red' as const }] : []),
  ];

  return (
    <nav className="adaptive-bottom-nav z-30 flex w-full shrink-0 border-t border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {items.map(({ tab, label, icon: Icon, tone = 'blue', onboardingTarget }) => {
        const isActive = activeTab === tab;
        const activeText = tone === 'red' ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400';
        const activePill = tone === 'red' ? 'bg-red-50 dark:bg-red-500/15' : 'bg-blue-50 dark:bg-blue-500/15';
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
              <Icon className="h-5 w-5" strokeWidth={isActive ? 2.25 : 2} />
            </span>
            <span className="max-w-full truncate px-1">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
