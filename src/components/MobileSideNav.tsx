import { useEffect, useRef, type RefObject } from 'react';
import { Building2, ClipboardList, History, Package, Rows3, Search, Settings, X, FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import logo from '../assets/burillab_app_icon.png';
import type { AppTab } from '../hooks/useAppUiState';
import { isLabToolsEnabled } from '../config/featureFlags';

interface MobileSideNavProps {
  activeTab: AppTab;
  isAdmin: boolean;
  adminAttentionCount: number;
  userEmail?: string;
  recentSearches: string[];
  onTabClick: (tab: AppTab) => void;
  onRecentSearchClick?: (term: string) => void;
  onRemoveRecentSearch?: (term: string) => void;
  onSettingsClick: () => void;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

export function MobileSideNav({ activeTab, isAdmin, adminAttentionCount, userEmail, recentSearches,
  onTabClick, onRecentSearchClick, onRemoveRecentSearch, onSettingsClick, onClose, triggerRef }: MobileSideNavProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const returnFocus = triggerRef.current;
    dialog?.showModal();
    const back = (event: Event) => { event.preventDefault(); onClose(); };
    const resize = () => { if (window.innerWidth >= 600) onClose(); };
    window.addEventListener('buril:adaptive-back', back);
    window.addEventListener('resize', resize);
    return () => {
      dialog?.close();
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
      window.removeEventListener('buril:adaptive-back', back);
      window.removeEventListener('resize', resize);
    };
  }, [onClose, triggerRef]);
  const items = [
    { tab: 'search' as const, label: t('tab_search'), icon: Search },
    { tab: 'logs' as const, label: t('tab_logs'), icon: ClipboardList },
    { tab: 'cabinet' as const, label: t('tab_cabinet'), icon: Rows3 },
    { tab: 'inventory' as const, label: t('tab_inventory'), icon: Package },
    ...((isLabToolsEnabled) ? [{tab: 'tools' as const, label: t('tab_tools'), icon: FlaskConical}] : []),
    ...(isAdmin ? [{ tab: 'admin' as const, label: t('tab_audit'), icon: Building2 }] : []),
  ];
  return <dialog ref={dialogRef} id="mobile-navigation" aria-modal="true" aria-label={t('nav_menu')}
    className="mobile-side-nav bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100"
    onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="flex h-full min-h-0 flex-col" onClick={event => event.stopPropagation()}>
      <div className="flex min-h-16 shrink-0 items-center justify-between px-5">
        <div className="flex items-center gap-2.5"><img src={logo} alt="" className="h-8 w-8" /><span className="text-xl font-semibold tracking-tight">{t('app_title')}</span></div>
        <button type="button" autoFocus onClick={onClose} aria-label={t('nav_close_menu')} className="flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={22} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        <nav aria-label={t('nav_menu')} className="flex flex-col gap-1 py-4">
          {items.map(({ tab, label, icon: Icon }) => <button key={tab} type="button"
            onClick={() => { onClose(); onTabClick(tab); }} data-onboarding-target={`nav-${tab}`}
            aria-current={activeTab === tab ? 'page' : undefined}
            className={`flex min-h-12 items-center gap-4 rounded-full px-5 text-left text-base transition-colors ${activeTab === tab ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-200' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
            <Icon size={21} className="shrink-0" /><span className="flex-1">{label}</span>
            {tab === 'admin' && adminAttentionCount > 0 && <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white"><span aria-hidden="true">{adminAttentionCount > 9 ? '9+' : adminAttentionCount}</span><span className="sr-only">{t('nav_admin_attention', { count: adminAttentionCount })}</span></span>}
          </button>)}
        </nav>
        {onRecentSearchClick && recentSearches.length > 0 && <section className="mt-5">
          <h2 className="px-5 pb-3 text-xs font-medium text-slate-500 dark:text-slate-400">{t('guide_example')}</h2>
          <ul>{recentSearches.map(term => <li key={term} className="flex min-w-0 items-center">
            <button type="button" onClick={() => { onClose(); onRecentSearchClick(term); }} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"><History size={17} className="shrink-0 text-slate-400" /><span className="truncate">{term}</span></button>
            {onRemoveRecentSearch && <button type="button" onClick={() => onRemoveRecentSearch(term)} aria-label={`${t('search_remove_history')}: ${term}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={15} /></button>}
          </li>)}</ul>
        </section>}
      </div>
      <button type="button" onClick={() => { onClose(); onSettingsClick(); }} className="mx-3 mb-3 flex min-h-16 shrink-0 items-center gap-3 rounded-2xl px-4 text-left hover:bg-slate-100 dark:hover:bg-slate-800">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-200">{(userEmail || t('app_title')).slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{userEmail || t('app_title')}</span><span className="block text-xs text-slate-500">{t('btn_settings')}</span></span><Settings size={21} className="shrink-0 text-slate-500" />
      </button>
    </div>
  </dialog>;
}
