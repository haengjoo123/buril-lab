import type { ReactNode } from 'react';
import { ArrowLeft, Bell, Building2, LogOut, Menu, UserCircle } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import logo from '../../assets/burillab_app_icon.png';
import {
  getSafetyCenterSectionFromPath,
  SAFETY_CENTER_NAV_ITEMS,
} from './safetyCenterNavigation';

interface SafetyCenterShellProps {
  children: ReactNode;
  userEmail?: string;
  onSignOut?: () => void;
  onExitToLab: () => void;
}

function getHeaderTitle(section: ReturnType<typeof getSafetyCenterSectionFromPath>): string {
  if (section === 'dashboard') return '기관 통합 대시보드';
  return SAFETY_CENTER_NAV_ITEMS.find((item) => item.section === section)?.label ?? '통합 안전관리센터';
}

export function SafetyCenterShell({
  children,
  userEmail,
  onSignOut,
  onExitToLab,
}: SafetyCenterShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const activeSection = getSafetyCenterSectionFromPath(location.pathname);
  const headerTitle = getHeaderTitle(activeSection);

  return (
    <div className="fixed inset-0 bg-slate-100 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <div className="flex h-full min-h-0">
        <aside className="hidden h-full w-64 shrink-0 flex-col bg-[linear-gradient(180deg,#064e3b_0%,#022c22_100%)] text-white lg:flex">
          <div className="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 px-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white p-1 shadow-sm ring-1 ring-white/20">
              <img src={logo} alt="버릴랩" className="h-full w-full object-contain" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-medium">통합 안전관리센터</p>
              <p className="text-xs font-normal text-emerald-100/75">Buril Lab Center</p>
            </div>
          </div>

          <nav className="flex flex-1 flex-col gap-1.5 px-3 py-5">
            {SAFETY_CENTER_NAV_ITEMS.map((item) => {
              const Icon = item.Icon;
              const isActive = activeSection === item.section;

              return (
                <button
                  key={item.section}
                  type="button"
                  onClick={() => navigate(item.path)}
                  className={[
                    'flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-white text-emerald-950 shadow-sm'
                      : 'text-emerald-50/85 hover:bg-white/10 hover:text-white',
                  ].join(' ')}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="border-t border-white/10 p-4">
            <button
              type="button"
              onClick={onExitToLab}
              className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-emerald-50/85 transition-colors hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="h-5 w-5" />
              버릴랩으로 이동
            </button>
            <div className="mt-4 rounded-lg bg-white/8 p-3 ring-1 ring-white/10">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Building2 className="h-4 w-4" />
                기관 담당자
              </div>
              <p className="mt-2 truncate text-xs font-normal text-emerald-100/75">
                {userEmail ?? 'safety@burillab.local'}
              </p>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-950 lg:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 lg:hidden">
                <Menu className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-medium tracking-tight text-slate-950 dark:text-white lg:text-xl">
                  {headerTitle}
                </h1>
                <p className="hidden truncate text-xs font-normal text-slate-500 sm:block">
                  승인된 연구실 데이터만 연결해 기관 위험 흐름을 관리합니다.
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500"
                aria-label="알림"
              >
                <Bell className="h-4 w-4" />
              </button>
              <div className="hidden min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900 sm:flex">
                <UserCircle className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="max-w-[13rem] truncate text-xs font-medium text-slate-600 dark:text-slate-300">
                  {userEmail ?? '기관 담당자'}
                </span>
              </div>
              {onSignOut && (
                <button
                  type="button"
                  onClick={onSignOut}
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                  aria-label="로그아웃"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              )}
            </div>
          </header>

          <nav className="flex gap-2 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-950 lg:hidden">
            {SAFETY_CENTER_NAV_ITEMS.map((item) => {
              const Icon = item.Icon;
              const isActive = activeSection === item.section;

              return (
                <button
                  key={item.section}
                  type="button"
                  onClick={() => navigate(item.path)}
                  className={[
                    'flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-medium transition-colors',
                    isActive
                      ? 'bg-emerald-700 text-white'
                      : 'bg-slate-50 text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800',
                  ].join(' ')}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <main className="min-h-0 flex-1 overflow-hidden">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
