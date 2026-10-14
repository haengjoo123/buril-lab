import { Suspense, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { LucideIcon } from 'lucide-react'
import { ArrowLeft, BarChart3, Building2, Inbox, LayoutDashboard, Loader2, LogOut, UserCircle } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import logo from '../../assets/burillab_app_icon.png'
import { FeedbackInboxView } from '../admin/FeedbackInboxView'
import { OpsAnalyticsView } from './OpsAnalyticsView'
import { SafetyCenterApprovalsView } from './SafetyCenterApprovalsView'

type OpsSection = 'overview' | 'analytics' | 'centers' | 'feedback'

interface OpsConsoleViewProps {
  userEmail?: string
  onSignOut?: () => void
  onExitToApp: () => void
}

const OPS_NAV_ITEMS: Array<{ section: OpsSection; labelKey: string; path: string; Icon: LucideIcon }> = [
  { section: 'overview', labelKey: 'ops_console_nav_overview', path: '/ops', Icon: LayoutDashboard },
  { section: 'analytics', labelKey: 'ops_console_nav_analytics', path: '/ops/analytics', Icon: BarChart3 },
  { section: 'centers', labelKey: 'ops_console_nav_centers', path: '/ops/centers', Icon: Building2 },
  { section: 'feedback', labelKey: 'ops_console_nav_feedback', path: '/ops/feedback', Icon: Inbox },
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

function WorkCard({
  title,
  body,
  Icon,
  onClick,
}: {
  title: string
  body: string
  Icon: LucideIcon
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50/40"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
        <Icon className="h-5 w-5" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-slate-950">{title}</h2>
      <p className="mt-2 text-sm font-normal leading-6 text-slate-600">{body}</p>
    </button>
  )
}

function OpsOverview({ navigate }: { navigate: (path: string) => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-blue-700">Buril Lab Operations</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">{t('ops_console_overview_heading')}</h1>
        <p className="mt-3 max-w-2xl text-sm font-normal leading-6 text-slate-600">
          {t('ops_console_overview_body')}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <WorkCard
          title={t('ops_console_title_analytics')}
          body={t('ops_console_card_analytics_body')}
          Icon={BarChart3}
          onClick={() => navigate('/ops/analytics')}
        />
        <WorkCard
          title={t('ops_console_card_centers_title')}
          body={t('ops_console_card_centers_body')}
          Icon={Building2}
          onClick={() => navigate('/ops/centers')}
        />
        <WorkCard
          title={t('ops_console_card_feedback_title')}
          body={t('ops_console_card_feedback_body')}
          Icon={Inbox}
          onClick={() => navigate('/ops/feedback')}
        />
      </div>
    </div>
  )
}

function renderSection(section: OpsSection, navigate: (path: string) => void): ReactNode {
  if (section === 'analytics') return <OpsAnalyticsView />
  if (section === 'centers') return <SafetyCenterApprovalsView />
  if (section === 'feedback') return <FeedbackInboxView />
  return <OpsOverview navigate={navigate} />
}

export function OpsConsoleView({ userEmail, onSignOut, onExitToApp }: OpsConsoleViewProps) {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const activeSection = getOpsSection(location.pathname)

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
            {OPS_NAV_ITEMS.map((item) => {
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
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="truncate">{t(item.labelKey)}</span>
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
            {OPS_NAV_ITEMS.map((item) => {
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
                >
                  <Icon className="h-4 w-4" />
                  {t(item.labelKey)}
                </button>
              )
            })}
          </nav>

          <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50">
            <Suspense fallback={<OpsFallback />}>
              {renderSection(activeSection, navigate)}
            </Suspense>
          </main>
        </div>
      </div>
    </div>
  )
}
