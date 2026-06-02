import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardList,
  Database,
  Download,
  Layers3,
  LogOut,
  Search,
  ShieldCheck,
} from 'lucide-react';
import logo from '../assets/burillab_app_icon.png';
import searchScreenshot from '../assets/gateway/buril-search-history.png';
import resultScreenshot from '../assets/gateway/buril-result-guide.png';
import logsScreenshot from '../assets/gateway/buril-waste-logs.png';
import cabinet3dScreenshot from '../assets/gateway/buril-3d-cabinet.png';

interface GatewayLandingProps {
  isAuthenticated: boolean;
  userEmail?: string;
  onNavigateToApp: () => void;
  onNavigateToCenter: () => void;
  onLoginClick: () => void;
  onSignOut?: () => void;
}

const strengths: Array<{ title: string; body: string; Icon: LucideIcon }> = [
  {
    title: '검색하면 바로 폐기 기준까지',
    body: '시약명, CAS 번호, 제품명으로 찾고 GHS 주의사항과 폐기 방향을 한 화면에서 확인합니다.',
    Icon: Search,
  },
  {
    title: '3D 시약장으로 위치를 바로 봅니다',
    body: '칸별 보관 위치가 시각화되어 시약을 찾고 정리하는 시간이 줄어듭니다.',
    Icon: Layers3,
  },
  {
    title: '폐기 기록이 보고 자료가 됩니다',
    body: '처리자, 기간, 분류, 메모까지 쌓아 두고 필요할 때 바로 내보낼 수 있습니다.',
    Icon: ClipboardList,
  },
  {
    title: '센터 요청도 연구실 흐름 안에서 처리합니다',
    body: '센터에서 확인 요청이 오면 연구실은 필요한 답변만 남기면 됩니다. 승인 없이 자료가 열리지 않습니다.',
    Icon: ShieldCheck,
  },
];

const productFlow = [
  {
    title: '1. 시약 검색',
    body: '자주 찾는 시약과 CAS 번호를 빠르게 다시 불러옵니다.',
    image: searchScreenshot,
    alt: '버릴랩 시약 검색 실제 화면',
  },
  {
    title: '2. 폐기 기준 확인',
    body: '분류 기준, GHS 문구, 주의사항을 같은 화면에서 봅니다.',
    image: resultScreenshot,
    alt: '버릴랩 폐기 기준 결과 실제 화면',
  },
  {
    title: '3. 폐기 기록',
    body: '최근 7일, 30일, 90일 기록을 연구실 단위로 관리합니다.',
    image: logsScreenshot,
    alt: '버릴랩 폐기 기록 실제 화면',
  },
  {
    title: '4. 3D 시약장',
    body: '칸별 위치를 보면서 시약을 찾고 배치합니다.',
    image: cabinet3dScreenshot,
    alt: '버릴랩 3D 시약장 실제 화면',
  },
];

function GatewayButton({
  tone,
  children,
  onClick,
}: {
  tone: 'blue' | 'green' | 'light';
  children: ReactNode;
  onClick: () => void;
}) {
  const classes = {
    blue: 'bg-blue-700 text-white hover:bg-blue-800 shadow-blue-950/10',
    green: 'bg-emerald-700 text-white hover:bg-emerald-800 shadow-emerald-950/10',
    light: 'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 shadow-slate-950/5',
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-12 max-w-full items-center justify-center gap-2 rounded-lg px-5 text-sm font-medium shadow-lg transition-colors ${classes}`}
    >
      <span className="truncate">{children}</span>
      <ArrowRight className="h-4 w-4 shrink-0" />
    </button>
  );
}

function PhoneShot({
  image,
  alt,
  className = '',
}: {
  image: string;
  alt: string;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden rounded-[2rem] border-[7px] border-slate-950 bg-slate-950 shadow-2xl shadow-slate-950/18 ${className}`}>
      <img
        src={image}
        alt={alt}
        className="block h-full w-full rounded-[1.45rem] object-cover"
        draggable={false}
      />
    </div>
  );
}

function StrengthCard({ item }: { item: (typeof strengths)[number] }) {
  const Icon = item.Icon;

  return (
    <article className="min-w-0 border-l border-slate-200 pl-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-5 text-slate-950">{item.title}</h3>
          <p className="mt-1 text-sm font-normal leading-6 text-slate-600">{item.body}</p>
        </div>
      </div>
    </article>
  );
}

function ScreenshotTile({
  image,
  alt,
  label,
  className = '',
}: {
  image: string;
  alt: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-950/10 ${className}`}>
      <div className="flex h-9 items-center px-3 text-xs font-semibold text-slate-700">
        <span className="truncate">{label}</span>
      </div>
      <img
        src={image}
        alt={alt}
        className="block aspect-[430/560] w-full object-cover object-top"
        draggable={false}
      />
    </div>
  );
}

function HeroPreview() {
  return (
    <div className="relative mx-auto h-[33rem] w-full max-w-[26rem] overflow-hidden sm:h-[39rem] sm:max-w-[39rem] lg:h-[39rem] lg:max-w-[41rem]">
      <div className="absolute inset-x-4 bottom-7 top-7 rounded-[2rem] border border-blue-100 bg-[linear-gradient(135deg,#eff6ff_0%,#ffffff_48%,#ecfdf5_100%)] shadow-2xl shadow-blue-950/10" />
      <div className="absolute left-3 top-16 w-[45%] sm:left-5 sm:top-20">
        <ScreenshotTile
          image={searchScreenshot}
          alt="버릴랩 검색 기록 실제 스크린샷"
          label="시약 검색"
        />
      </div>
      <div className="absolute bottom-12 left-8 w-[44%] sm:bottom-16 sm:left-14">
        <ScreenshotTile
          image={resultScreenshot}
          alt="버릴랩 폐기 기준 결과 실제 스크린샷"
          label="폐기 기준"
        />
      </div>
      <div className="absolute right-3 top-5 w-[54%] sm:right-7 sm:top-6 sm:w-[48%] lg:right-10 lg:top-5 lg:w-[43%]">
        <PhoneShot
          image={cabinet3dScreenshot}
          alt="버릴랩 3D 시약장 실제 스크린샷"
          className="aspect-[430/932]"
        />
      </div>
      <div className="absolute bottom-7 right-5 max-w-[12rem] rounded-xl border border-blue-100 bg-white/95 px-4 py-3 shadow-lg shadow-slate-950/8 sm:bottom-10 sm:right-9">
        <p className="text-xs font-semibold text-blue-700">버릴랩 3D 시약장</p>
        <p className="mt-1 text-sm font-medium leading-5 text-slate-800">
          보관 위치까지 한눈에 확인합니다.
        </p>
      </div>
    </div>
  );
}

const centerStats = [
  { label: '연결 연구실', value: '8', tone: 'bg-blue-50 text-blue-700' },
  { label: '고위험 재고', value: '14', tone: 'bg-red-50 text-red-600' },
  { label: '만료 임박', value: '23', tone: 'bg-amber-50 text-amber-600' },
  { label: '미응답 요청', value: '5', tone: 'bg-violet-50 text-violet-600' },
];

const centerLabs = [
  { name: '화학공정 연구실', score: 82, risks: 6, due: 3 },
  { name: '나노소재 분석실', score: 64, risks: 4, due: 2 },
  { name: '환경안전 실험실', score: 38, risks: 2, due: 1 },
];

const centerRiskItems = [
  { name: 'Diethyl ether', lab: '화학공정 연구실', due: '2일', tone: 'text-red-600 bg-red-50' },
  { name: 'Benzene', lab: '나노소재 분석실', due: '5일', tone: 'text-amber-700 bg-amber-50' },
  { name: 'Hydrochloric acid', lab: '환경안전 실험실', due: '7일', tone: 'text-amber-700 bg-amber-50' },
];

function CenterDashboardPreview() {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-950/8">
      <div className="flex h-9 items-center gap-1.5 border-b border-slate-100 px-3">
        <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
      </div>
      <div className="grid min-h-[31rem] min-w-0 bg-white text-slate-950 md:grid-cols-[8.75rem_minmax(0,1fr)]">
        <aside className="hidden min-w-0 border-r border-slate-100 bg-slate-50 p-4 md:block">
          <div className="flex items-center gap-2">
            <img src={logo} alt="" className="h-6 w-6 rounded-md" />
            <span className="text-sm font-semibold">버릴랩</span>
          </div>
          <div className="mt-8 grid gap-2 text-sm font-medium text-slate-500">
            {['검색', '기록', '시약장', '재고'].map((item) => (
              <div key={item} className="rounded-lg px-3 py-2">{item}</div>
            ))}
            <div className="rounded-lg bg-emerald-700 px-3 py-2 text-white">통합센터</div>
          </div>
          <div className="mt-24 rounded-lg bg-white p-3 text-xs font-medium text-slate-500 ring-1 ring-slate-100">
            <p className="text-slate-900">기관 담당자</p>
            <p className="mt-1 truncate">center@rillab.ac.kr</p>
          </div>
        </aside>

        <div className="min-w-0 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-emerald-700">통합 안전관리센터</p>
              <h3 className="mt-1 text-2xl font-semibold text-slate-950 [word-break:keep-all]">
                릴랩대학교 안전관리센터
              </h3>
              <p className="mt-1 text-sm font-medium text-slate-500">릴랩대학교 · rillab.ac.kr · 승인됨</p>
            </div>
            <button type="button" className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700">
              새로고침
            </button>
          </div>

          <div className="mt-5 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {centerStats.map((stat) => (
              <div key={stat.label} className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm font-medium text-slate-500">{stat.label}</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-3xl font-semibold text-slate-950">{stat.value}</span>
                  <span className={`h-9 w-9 rounded-lg ${stat.tone}`} />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_16rem]">
            <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-base font-semibold text-slate-950">연구실별 위험 heatmap</h4>
                  <p className="mt-1 text-sm font-medium text-slate-500">위험 점수가 높은 연구실부터 표시합니다.</p>
                </div>
                <span className="rounded-lg bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">조치 요청</span>
              </div>
              <div className="mt-4 grid gap-3">
                {centerLabs.map((lab) => (
                  <div key={lab.name} className="grid min-w-0 grid-cols-[minmax(0,1fr)_6rem_3rem_3rem] items-center gap-3 text-sm font-medium text-slate-600">
                    <span className="truncate text-slate-800">{lab.name}</span>
                    <span className="h-2 rounded-full bg-slate-100">
                      <span
                        className="block h-2 rounded-full bg-red-500"
                        style={{ width: `${lab.score}%` }}
                      />
                    </span>
                    <span>{lab.risks}</span>
                    <span>{lab.due}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h4 className="text-base font-semibold text-slate-950">우선 확인 항목</h4>
              <div className="mt-3 grid gap-3">
                {centerRiskItems.map((item) => (
                  <div key={item.name} className="rounded-lg border border-slate-100 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-semibold text-slate-950">{item.name}</p>
                      <span className="shrink-0 text-xs font-semibold text-red-500">{item.due}</span>
                    </div>
                    <p className="mt-1 truncate text-sm font-medium text-slate-500">{item.lab}</p>
                    <span className={`mt-2 inline-flex rounded-md px-2 py-1 text-xs font-semibold ${item.tone}`}>
                      확인 필요
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CenterRiskPreview() {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-emerald-700">릴랩대학교</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-950">위험 상세</h3>
        </div>
        <span className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Excel / PDF</span>
      </div>
      <div className="mt-4 grid gap-2 text-xs font-medium text-slate-600">
        {[
          ['시약명', '연구실', '상태'],
          ['Diethyl ether', '화학공정 연구실', '만료 임박'],
          ['Benzene', '나노소재 분석실', '고위험'],
          ['Acetonitrile', '환경안전 실험실', 'CAS 확인'],
        ].map((row, index) => (
          <div
            key={row.join('-')}
            className={`grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4.5rem] gap-3 rounded-lg px-3 py-2 ${
              index === 0 ? 'bg-slate-50 text-slate-500' : 'border border-slate-100 bg-white'
            }`}
          >
            {row.map((cell) => (
              <span key={cell} className="truncate">{cell}</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function GatewayLanding({
  isAuthenticated,
  userEmail,
  onNavigateToApp,
  onNavigateToCenter,
  onLoginClick,
  onSignOut,
}: GatewayLandingProps) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-white text-slate-950">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 lg:px-8">
          <button type="button" onClick={onNavigateToApp} className="flex min-w-0 items-center gap-3">
            <img src={logo} alt="버릴랩" className="h-10 w-10 shrink-0 rounded-lg object-contain" />
            <span className="truncate text-xl font-semibold tracking-tight">버릴랩</span>
          </button>
          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex">
            <a href="#buril" className="transition-colors hover:text-blue-700">버릴랩의 강점</a>
            <a href="#flow" className="transition-colors hover:text-blue-700">실제 사용 화면</a>
            <a href="#center" className="transition-colors hover:text-emerald-700">통합센터</a>
          </nav>
          <div className="flex min-w-0 items-center gap-2">
            {isAuthenticated ? (
              <>
                <span className="hidden max-w-[12rem] truncate text-xs font-medium text-slate-500 sm:inline">{userEmail}</span>
                {onSignOut && (
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600"
                    aria-label="로그아웃"
                  >
                    <LogOut className="h-5 w-5" />
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={onLoginClick}
                className="h-10 shrink-0 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                로그인
              </button>
            )}
          </div>
        </div>
      </header>

      <main>
        <section id="buril" className="border-b border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)]">
          <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:px-8">
            <div className="flex min-w-0 flex-col justify-center">
              <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-normal text-slate-950 [word-break:keep-all] md:text-5xl lg:text-[3.15rem]">
                연구실 폐시약 처리,
                <span className="block">검색부터 기록까지 버릴랩에서.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg font-normal leading-8 text-slate-600 [word-break:keep-all]">
                시약명만 입력하면 폐기 기준과 GHS 주의사항을 확인하고,
                3D 시약장·재고·폐기 기록까지 한 흐름으로 남길 수 있습니다.
              </p>
              <div className="mt-8 flex max-w-full flex-col gap-3 sm:flex-row">
                <GatewayButton tone="blue" onClick={onNavigateToApp}>버릴랩 시작하기</GatewayButton>
                <GatewayButton tone="light" onClick={onNavigateToCenter}>통합센터 보기</GatewayButton>
              </div>
              <div className="mt-10 grid min-w-0 gap-5 sm:grid-cols-2">
                {strengths.map((item) => (
                  <StrengthCard key={item.title} item={item} />
                ))}
              </div>
            </div>

            <div className="relative min-w-0 lg:-mr-4">
              <HeroPreview />
            </div>
          </div>
        </section>

        <section id="flow" className="bg-white">
          <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8 lg:py-16">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
              <div className="min-w-0">
                <h2 className="text-3xl font-semibold leading-tight tracking-normal text-slate-950 [word-break:keep-all] lg:text-4xl">
                  검색하고, 확인하고, 바로 기록합니다
                </h2>
                <p className="mt-5 text-base font-normal leading-7 text-slate-600 [word-break:keep-all]">
                  시약을 찾는 순간부터 폐기 기준 확인, 3D 시약장 위치 확인, 폐기 기록까지 이어집니다.
                  필요한 화면이 가까이 있어 바쁜 연구실에서도 기록이 빠지지 않습니다.
                </p>
              </div>
              <div className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-4">
                {productFlow.map((item) => (
                  <article key={item.title} className="min-w-0">
                    <div className="mx-auto max-w-[16rem]">
                      <PhoneShot image={item.image} alt={item.alt} className="aspect-[430/932]" />
                    </div>
                    <h3 className="mt-4 text-base font-semibold text-slate-950">{item.title}</h3>
                    <p className="mt-2 text-sm font-normal leading-6 text-slate-600">{item.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="center" className="border-t border-slate-200 bg-slate-50">
          <div className="mx-auto grid max-w-7xl gap-8 px-5 py-14 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:px-8 lg:py-16">
            <div className="min-w-0">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-700 text-white">
                <Building2 className="h-6 w-6" />
              </div>
              <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-normal text-slate-950 [word-break:keep-all]">
                센터 담당자는 놓치기 쉬운 위험 신호를 먼저 봅니다
              </h2>
              <p className="mt-4 text-base font-normal leading-7 text-slate-600 [word-break:keep-all]">
                연결된 연구실의 만료 임박, 고위험 재고, 미응답 요청을 모아 보여줍니다.
                어떤 연구실에 먼저 연락해야 할지 빠르게 정할 수 있습니다.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
                <GatewayButton tone="green" onClick={onNavigateToCenter}>통합센터로 이동</GatewayButton>
                <GatewayButton tone="blue" onClick={onNavigateToApp}>연구실 앱으로 이동</GatewayButton>
              </div>
              <div className="mt-8 grid gap-3">
                {[
                  '승인된 연구실 현황만 한 화면에 모으기',
                  '만료 임박·고위험 재고 먼저 확인',
                  '확인 요청을 보내고 답변까지 보관',
                  '월간 리포트와 점검 자료 내보내기',
                ].map((text) => (
                  <div key={text} className="flex items-center gap-3 text-sm font-medium text-slate-700">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                    <span>{text}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid min-w-0 gap-5">
              <CenterDashboardPreview />
              <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,0.78fr)]">
                <CenterRiskPreview />
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                    <Database className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-slate-950">보고서 준비 시간을 줄입니다</h3>
                  <p className="mt-2 text-sm font-normal leading-6 text-slate-600">
                    월간 점검 때 필요한 위험 재고, 폐기 기록, 요청 이력을 골라 내보낼 수 있어
                    자료를 다시 모으는 시간을 줄입니다.
                  </p>
                  <div className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700">
                    <Download className="h-4 w-4 text-emerald-700" />
                    리포트 내보내기
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
