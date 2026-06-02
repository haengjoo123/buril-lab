import { Suspense, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ArrowLeft, Building2, Inbox, LayoutDashboard, Loader2, LogOut, UserCircle } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import logo from '../../assets/burillab_app_icon.png'
import { FeedbackInboxView } from '../admin/FeedbackInboxView'
import { SafetyCenterApprovalsView } from './SafetyCenterApprovalsView'

type OpsSection = 'overview' | 'centers' | 'feedback'

interface OpsConsoleViewProps {
  userEmail?: string
  onSignOut?: () => void
  onExitToApp: () => void
}

const OPS_NAV_ITEMS: Array<{ section: OpsSection; label: string; path: string; Icon: LucideIcon }> = [
  { section: 'overview', label: '운영 홈', path: '/ops', Icon: LayoutDashboard },
  { section: 'centers', label: '센터 승인', path: '/ops/centers', Icon: Building2 },
  { section: 'feedback', label: '개선 제안', path: '/ops/feedback', Icon: Inbox },
]

function getOpsSection(pathname: string): OpsSection {
  if (pathname.startsWith('/ops/centers')) return 'centers'
  if (pathname.startsWith('/ops/feedback')) return 'feedback'
  return 'overview'
}

function getTitle(section: OpsSection): string {
  if (section === 'centers') return '센터 승인'
  if (section === 'feedback') return '개선 제안'
  return '운영 홈'
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
  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-blue-700">Buril Lab Operations</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950">운영자가 처리할 일을 한곳에 모읍니다</h1>
        <p className="mt-3 max-w-2xl text-sm font-normal leading-6 text-slate-600">
          기관 안전관리센터 승인, 앱 개선 제안 확인처럼 버릴랩 운영자가 직접 판단해야 하는 업무를 이 콘솔에서 처리합니다.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <WorkCard
          title="기관 센터 승인"
          body="기관 안전관리센터 개설 요청을 확인하고 승인 또는 거절합니다."
          Icon={Building2}
          onClick={() => navigate('/ops/centers')}
        />
        <WorkCard
          title="개선 제안 Inbox"
          body="사용자가 남긴 버그 제보와 개선 아이디어를 확인하고 처리 상태를 바꿉니다."
          Icon={Inbox}
          onClick={() => navigate('/ops/feedback')}
        />
      </div>
    </div>
  )
}

function renderSection(section: OpsSection, navigate: (path: string) => void): ReactNode {
  if (section === 'centers') return <SafetyCenterApprovalsView />
  if (section === 'feedback') return <FeedbackInboxView />
  return <OpsOverview navigate={navigate} />
}

export function OpsConsoleView({ userEmail, onSignOut, onExitToApp }: OpsConsoleViewProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const activeSection = getOpsSection(location.pathname)

  return (
    <div className="fixed inset-0 bg-slate-100 text-slate-950">
      <div className="flex h-full min-h-0">
        <aside className="hidden h-full w-64 shrink-0 flex-col bg-slate-950 text-white lg:flex">
          <div className="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 px-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white p-1 shadow-sm">
              <img src={logo} alt="버릴랩" className="h-full w-full object-contain" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">운영자 콘솔</p>
              <p className="text-xs font-normal text-slate-300">Buril Lab Ops</p>
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
                  <span className="truncate">{item.label}</span>
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
              버릴랩으로 이동
            </button>
            <div className="mt-4 rounded-lg bg-white/8 p-3 ring-1 ring-white/10">
              <div className="flex items-center gap-2 text-sm font-medium">
                <UserCircle className="h-4 w-4" />
                운영자
              </div>
              <p className="mt-2 truncate text-xs font-normal text-slate-300">
                {userEmail ?? 'operator@burillab.local'}
              </p>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-6">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-slate-950">{getTitle(activeSection)}</h1>
              <p className="hidden truncate text-xs font-normal text-slate-500 sm:block">
                버릴랩 운영자가 처리해야 할 항목을 관리합니다.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 sm:flex">
                <UserCircle className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="max-w-[13rem] truncate text-xs font-medium text-slate-600">
                  {userEmail ?? '운영자'}
                </span>
              </div>
              {onSignOut && (
                <button
                  type="button"
                  onClick={onSignOut}
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600"
                  aria-label="로그아웃"
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
                  {item.label}
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
