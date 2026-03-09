import { useTranslation } from 'react-i18next';
import { Search, ClipboardList, Box, Package, ShieldAlert } from 'lucide-react';
import type { AppTab } from '../hooks/useAppUiState';

interface BottomTabNavProps {
  activeTab: AppTab;
  isAdmin: boolean;
  onTabClick: (tab: AppTab) => void;
}

export function BottomTabNav({ activeTab, isAdmin, onTabClick }: BottomTabNavProps) {
  const { t } = useTranslation();

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-800 flex z-30">
      <button
        onClick={() => onTabClick('search')}
        className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${activeTab === 'search'
          ? 'text-blue-600 dark:text-blue-400'
          : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
      >
        <Search className="w-5 h-5" />
        {t('tab_search')}
      </button>
      <button
        onClick={() => onTabClick('logs')}
        className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${activeTab === 'logs'
          ? 'text-blue-600 dark:text-blue-400'
          : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
      >
        <ClipboardList className="w-5 h-5" />
        {t('tab_logs')}
      </button>
      <button
        onClick={() => onTabClick('cabinet')}
        className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${activeTab === 'cabinet'
          ? 'text-blue-600 dark:text-blue-400'
          : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
      >
        <Box className="w-5 h-5" />
        {t('tab_cabinet')}
      </button>
      <button
        onClick={() => onTabClick('inventory')}
        className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${activeTab === 'inventory'
          ? 'text-blue-600 dark:text-blue-400'
          : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
          }`}
      >
        <Package className="w-5 h-5" />
        {t('tab_inventory')}
      </button>
      {isAdmin && (
        <button
          onClick={() => onTabClick('admin')}
          className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${activeTab === 'admin'
            ? 'text-red-600 dark:text-red-400'
            : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
            }`}
        >
          <ShieldAlert className="w-5 h-5" />
          {t('tab_audit')}
        </button>
      )}
    </nav>
  );
}
