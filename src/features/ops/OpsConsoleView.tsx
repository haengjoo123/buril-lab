import { Suspense, useLayoutEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { LucideIcon } from 'lucide-react'
import { ArrowLeft, BarChart3, Building2, Inbox, LayoutDashboard, Loader2, LogOut, UserCircle } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import logo from '../../assets/burillab_app_icon.png'
import { FeedbackInboxView } from '../admin/FeedbackInboxView'
import { OpsAnalyticsView } from './OpsAnalyticsView'
import { OpsHomeView } from './OpsHomeView'
import { buildOpsNavCounts, formatBadgeCount } from './opsHomeTasks'
import { SafetyCenterApprovalsView } from './SafetyCenterApprovalsView'
import { useOpsConsoleData, type OpsConsoleData, type OpsConsoleSection } from './useOpsConsoleData'

type OpsSection = OpsConsoleSection

interface OpsConsoleViewProps {
  userEmail?: string
  onSignOut?: () => void
  onExitToApp: () => void
}

type OpsBadgeSource = 'centers' | 'feedback'

const OPS_NAV_ITEMS: Array<{
  section: OpsSection
  labelKey: string
  path: string
  Icon: LucideIcon
  /** Count shown on the item: pending center requests or new feedback. */
  badge?: { source: OpsBadgeSource; srKey: string }
}> = [
  { section: 'overview', labelKey: 'ops_console_nav_overview', path: '/ops', Icon: LayoutDashboard },
  { section: 'analytics', labelKey: 'ops_console_nav_analytics', path: '/ops/analytics', Icon: BarChart3 },
  {
    section: 'centers', labelKey: 'ops_console_nav_centers', path: '/ops/centers', Icon: Building2,
    badge: { source: 'centers', srKey: 'ops_console_nav_badge_centers' },
  },
  {
    section: 'feedback', labelKey: 'ops_console_nav_feedback', path: '/ops/feedback', Icon: Inbox,
    badge: { source: 'feedback', srKey: 'ops_console_nav_badge_feedback' },
  },
]

function getOpsSection(pathname: string): OpsSection {
  if (pathname.startsWith('/ops/analytics')) return 'analytics'
  if (pathname.startsWith('/ops/centers')) return 'centers'
  if (pathname.startsWith('/ops/feedback')) return 'feedback'
  return 'overview'
}

function getTitleKey(section: OpsSection): string {
  if (section === 'analytics') return 'ops_console_title_analytics'
  if (section === 'centers') return 'ops_console_nav_centers'
  if (section === 'feedback') return 'ops_console_nav_feedback'
  return 'ops_console_nav_overview'
}

function getDescriptionKey(section: OpsSection): string {
  if (section === 'analytics') return 'ops_console_desc_analytics'
  if (section === 'centers') return 'ops_console_desc_centers'
  if (section === 'feedback') return 'ops_console_desc_feedback'
  return 'ops_console_desc_overview'
}

function OpsFallback() {
  return (
    <div className="flex min-h-[18rem] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
    </div>
  )
}

function renderSection(
  section: OpsSection,
  navigate: (path: string) => void,
  consoleData: OpsConsoleData,
): ReactNode {
  if (section === 'analytics') return <OpsAnalyticsView />
  // Both screens hand their list to the console, so the badges follow each approval or status change.
  if (section === 'centers') return <SafetyCenterApprovalsView onItemsChange={consoleData.replaceCenters} />
  if (section === 'feedback') return <FeedbackInboxView onItemsChange={consoleData.replaceFeedback} />
  return <OpsHomeView data={consoleData} onNavigate={navigate} />
}

/**
 * The console is light only: its screens carry no dark: classes, and shared components (dialogs,
 * selects, toasts) would otherwise turn dark under the app's `html.dark`. The class is lifted while
 * the console is open and put back on the way out, where the app's theme hook takes over again.
 */
function useLightOnlyDocument() {
  useLayoutEffect(() => {
    const root = document.documentElement
    const wasDark = root.classList.contains('dark')
    root.classList.remove('dark')
    return () => {
      if (wasDark) root.classList.add('dark')
    }
  }, [])
}

export function OpsConsoleView({ userEmail, onSignOut, onExitToApp }: OpsConsoleViewProps) {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const activeSection = getOpsSection(location.pathname)
  useLightOnlyDocument()
  // Loaded once here so the home and the navigation badges share three calls per reload.
  const consoleData = useOpsConsoleData(activeSection, {
    reviewsOpen: activeSection === 'analytics' && new URLSearchParams(location.search).get('tab') === 'reviews',
  })
  const navCounts = buildOpsNavCounts({ centers: consoleData.centers.data, feedback: consoleData.feedback.data })
  const badgeLabels: Record<OpsBadgeSource, string | null> = {
    centers: formatBadgeCount(navCounts.centers),
    feedback: formatBadgeCount(navCounts.feedback),
  }
  const navItems = OPS_NAV_ITEMS.map((item) => {
    const label = t(item.labelKey)
    const badgeLabel = item.badge ? badgeLabels[item.badge.source] : null
    return {
      ...item,
      label,
      badgeLabel,
      // The badge itself is hidden from screen readers; the count is part of the button's name.
      accessibleName: item.badge && badgeLabel ? `${label}, ${t(item.badge.srKey, { value: badgeLabel })}` : undefined,
    }
  })

  return (
    <div className="fixed inset-0 bg-slate-100 text-slate-950">
      <div className="flex h-full min-h-0">
        <aside className="hidden h-full w-64 shrink-0 flex-col bg-slate-950 text-white lg:flex">
          <div className="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 px-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white p-1 shadow-sm">
              <img src={logo} alt={t('ops_console_logo_alt')} className="h-full w-full object-contain" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">{t('ops_console_name')}</p>
              <p className="text-xs font-normal text-slate-300">{t('ops_console_tagline')}</p>
            </div>
          </div>

          <nav className="flex flex-1 flex-col gap-1.5 px-3 py-5">
            {navItems.map((item) => {
              const Icon = item.Icon
              const isActive = activeSection === item.section

              return (
                <button
                  key={item.section}
                  type="button"
                  onClick={() => navigate(item.path)}
                  className={[
                    'flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-white text-slate-950 shadow-sm'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white',
                  ].join(' ')}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={item.accessibleName}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                  {item.badgeLabel && (
                    <span
                      aria-hidden="true"
                      className="ml-auto shrink-0 rounded-full bg-amber-400 px-2 py-0.5 text-2xs font-semibold tabular-nums text-slate-950"
                    >
                      {item.badgeLabel}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>

          <div className="border-t border-white/10 p-4">
            <button
              type="button"
              onClick={onExitToApp}
              className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="h-5 w-5" />
              {t('ops_console_exit_to_app')}
            </button>
            <div className="mt-4 rounded-lg bg-white/8 p-3 ring-1 ring-white/10">
              <div className="flex items-center gap-2 text-sm font-medium">
                <UserCircle className="h-4 w-4" />
                {t('ops_console_operator')}
              </div>
              <p className="mt-2 truncate text-xs font-normal text-slate-300">
                {userEmail ?? t('ops_console_operator_account')}
              </p>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-6">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-slate-950">{t(getTitleKey(activeSection))}</h1>
              <p className="hidden truncate text-xs font-normal text-slate-500 sm:block">
                {t(getDescriptionKey(activeSection))}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 sm:flex">
                <UserCircle className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="max-w-[13rem] truncate text-xs font-medium text-slate-600">
                  {userEmail ?? t('ops_console_operator')}
                </span>
              </div>
              {onSignOut && (
                <button
                  type="button"
                  onClick={onSignOut}
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600"
                  aria-label={t('ops_console_sign_out')}
                >
                  <LogOut className="h-5 w-5" />
                </button>
              )}
            </div>
          </header>

          <nav className="flex gap-2 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2 lg:hidden">
            {navItems.map((item) => {
              const Icon = item.Icon
              const isActive = activeSection === item.section

              return (
                <button
                  key={item.section}
                  type="button"
                  onClick={() => navigate(item.path)}
                  className={[
                    'flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-medium transition-colors',
                    isActive ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100',
                  ].join(' ')}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={item.accessibleName}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                  {item.badgeLabel && (
                    <span
                      aria-hidden="true"
                      className="rounded-full bg-amber-400 px-1.5 text-2xs font-semibold tabular-nums text-slate-950"
                    >
                      {item.badgeLabel}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>

          <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50">
            <Suspense fallback={<OpsFallback />}>
              {renderSection(activeSection, navigate, consoleData)}
            </Suspense>
          </main>
        </div>
      </div>
    </div>
  )
}
