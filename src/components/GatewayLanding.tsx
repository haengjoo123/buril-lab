import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
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

type GatewayCopy = {
  brand: string;
  nav: {
    strengths: string;
    flow: string;
    center: string;
  };
  actions: {
    login: string;
    signOut: string;
    startApp: string;
    viewCenter: string;
    goCenter: string;
    goLabApp: string;
    refresh: string;
    exportReport: string;
  };
  hero: {
    titleTop: string;
    titleBottom: string;
    body: string;
    previewLabel: string;
    previewBody: string;
  };
  strengths: Array<{ title: string; body: string; Icon: LucideIcon }>;
  flow: {
    heading: string;
    body: string;
    items: Array<{ title: string; body: string; image: string; alt: string }>;
  };
  center: {
    eyebrow: string;
    heading: string;
    body: string;
    institution: string;
    domain: string;
    stats: Array<{ label: string; value: string; tone: string }>;
    tabs: string[];
    activeTab: string;
    accountRole: string;
    labHeatmapTitle: string;
    labHeatmapBody: string;
    actionRequest: string;
    reviewTitle: string;
    reviewNeeded: string;
    riskDetailEyebrow: string;
    riskDetailTitle: string;
    riskHeaders: [string, string, string];
    riskStatuses: string[];
    reportTitle: string;
    reportBody: string;
    checklist: string[];
    labs: Array<{ name: string; score: number; risks: number; due: number }>;
    riskItems: Array<{ name: string; lab: string; due: string; tone: string }>;
  };
  labels: {
    search: string;
    disposalGuide: string;
  };
};

const copyByLanguage: Record<'ko' | 'en', GatewayCopy> = {
  ko: {
    brand: '버릴랩',
    nav: {
      strengths: '버릴랩의 강점',
      flow: '실제 사용 화면',
      center: '통합센터',
    },
    actions: {
      login: '로그인',
      signOut: '로그아웃',
      startApp: '버릴랩 시작하기',
      viewCenter: '통합센터 보기',
      goCenter: '통합센터로 이동',
      goLabApp: '연구실 앱으로 이동',
      refresh: '새로고침',
      exportReport: '리포트 내보내기',
    },
    hero: {
      titleTop: '연구실 폐시약 처리,',
      titleBottom: '검색부터 기록까지 버릴랩에서',
      body: '시약명만 입력하면 폐기 기준과 GHS 주의사항을 확인하고, 3D 시약장과 재고, 폐기 기록까지 한 흐름으로 관리할 수 있습니다.',
      previewLabel: '버릴랩 3D 시약장',
      previewBody: '보관 위치까지 한눈에 확인합니다.',
    },
    strengths: [
      {
        title: '검색하면 바로 폐기 기준까지',
        body: '시약명, CAS 번호, 제품명으로 찾고 GHS 주의사항과 폐기 방향을 한 화면에서 확인합니다.',
        Icon: Search,
      },
      {
        title: '3D 시약장으로 위치를 바로 봅니다',
        body: '칸별 보관 위치가 시각화되어 시약을 찾고 정리하는 시간을 줄여줍니다.',
        Icon: Layers3,
      },
      {
        title: '폐기 기록이 보고 자료가 됩니다',
        body: '처리자, 기간, 분류, 메모까지 남겨 두고 필요한 때 바로 내보낼 수 있습니다.',
        Icon: ClipboardList,
      },
      {
        title: '센터 요청도 연구실 흐름 안에서',
        body: '센터에서 확인 요청을 보내면 연구실은 필요한 항목만 챙기면 됩니다. 승인 없이 자료가 흐트러지지 않습니다.',
        Icon: ShieldCheck,
      },
    ],
    flow: {
      heading: '검색하고, 확인하고, 바로 기록합니다',
      body: '시약을 찾는 시간부터 폐기 기준 확인, 3D 시약장 위치 확인, 폐기 기록까지 이어집니다. 필요한 화면이 가까이 있어 바쁜 연구실에서도 기록을 놓치지 않습니다.',
      items: [
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
      ],
    },
    center: {
      eyebrow: '통합 안전관리센터',
      heading: '센터 담당자는 놓치기 쉬운 위험 신호를 먼저 봅니다',
      body: '연결된 연구실의 만료 임박, 고위험 재고, 미응답 요청을 모아 보여줍니다. 어떤 연구실에 먼저 연락해야 할지 빠르게 판단할 수 있습니다.',
      institution: '리로대학교 안전관리센터',
      domain: '리로대학교 · rillab.ac.kr · 승인됨',
      stats: [
        { label: '연결 연구실', value: '8', tone: 'bg-blue-50 text-blue-700' },
        { label: '고위험 재고', value: '14', tone: 'bg-red-50 text-red-600' },
        { label: '만료 임박', value: '23', tone: 'bg-amber-50 text-amber-600' },
        { label: '미응답 요청', value: '5', tone: 'bg-violet-50 text-violet-600' },
      ],
      tabs: ['검색', '기록', '시약장', '재고'],
      activeTab: '통합센터',
      accountRole: '기관 담당자',
      labHeatmapTitle: '연구실별 위험 heatmap',
      labHeatmapBody: '위험 점수가 높은 연구실부터 표시합니다.',
      actionRequest: '조치 요청',
      reviewTitle: '우선 확인 항목',
      reviewNeeded: '확인 필요',
      riskDetailEyebrow: '리로대학교',
      riskDetailTitle: '위험 상세',
      riskHeaders: ['시약명', '연구실', '상태'],
      riskStatuses: ['만료 임박', '고위험', 'CAS 확인'],
      reportTitle: '보고서 준비 시간을 줄입니다',
      reportBody: '월간 점검 때 필요한 위험 재고, 폐기 기록, 요청 이력을 골라 내보낼 수 있어 자료를 다시 모으는 시간을 줄입니다.',
      checklist: [
        '승인된 연구실 현황만 한 화면에 모으기',
        '만료 임박과 고위험 재고 먼저 확인',
        '확인 요청을 보내고 응답까지 보기',
        '월간 리포트용 점검 자료 내보내기',
      ],
      labs: [
        { name: '화학공정 연구실', score: 82, risks: 6, due: 3 },
        { name: '나노소재 분석실', score: 64, risks: 4, due: 2 },
        { name: '환경안전 실험실', score: 38, risks: 2, due: 1 },
      ],
      riskItems: [
        { name: 'Diethyl ether', lab: '화학공정 연구실', due: '2일', tone: 'text-red-600 bg-red-50' },
        { name: 'Benzene', lab: '나노소재 분석실', due: '5일', tone: 'text-amber-700 bg-amber-50' },
        { name: 'Hydrochloric acid', lab: '환경안전 실험실', due: '7일', tone: 'text-amber-700 bg-amber-50' },
      ],
    },
    labels: {
      search: '시약 검색',
      disposalGuide: '폐기 기준',
    },
  },
  en: {
    brand: 'Buril Lab',
    nav: {
      strengths: 'Why Buril Lab',
      flow: 'Product Screens',
      center: 'Safety Center',
    },
    actions: {
      login: 'Log in',
      signOut: 'Log out',
      startApp: 'Start Buril Lab',
      viewCenter: 'View Safety Center',
      goCenter: 'Go to Safety Center',
      goLabApp: 'Go to Lab App',
      refresh: 'Refresh',
      exportReport: 'Export report',
    },
    hero: {
      titleTop: 'Lab chemical waste,',
      titleBottom: 'from search to records in Buril Lab',
      body: 'Enter a reagent name to check disposal guidance and GHS precautions, then manage 3D cabinet locations, inventory, and disposal records in one flow.',
      previewLabel: 'Buril Lab 3D Cabinet',
      previewBody: 'Check storage locations at a glance.',
    },
    strengths: [
      {
        title: 'Search once, reach disposal guidance',
        body: 'Find reagents by name, CAS number, or product name, then review GHS precautions and disposal direction on one screen.',
        Icon: Search,
      },
      {
        title: 'See locations in a 3D cabinet',
        body: 'Visual shelf placement makes it faster to find, arrange, and verify reagents.',
        Icon: Layers3,
      },
      {
        title: 'Turn disposal logs into reports',
        body: 'Keep handler, period, category, and memo history ready for export when the lab needs documentation.',
        Icon: ClipboardList,
      },
      {
        title: 'Center requests fit the lab workflow',
        body: 'When a safety center sends a review request, labs can respond with only the items that need attention.',
        Icon: ShieldCheck,
      },
    ],
    flow: {
      heading: 'Search, verify, and log in one pass',
      body: 'Buril Lab connects reagent lookup, disposal guidance, 3D cabinet placement, and disposal records. The right screen stays close, so busy labs can keep accurate records without extra steps.',
      items: [
        {
          title: '1. Reagent search',
          body: 'Quickly reopen frequently used reagents and CAS numbers.',
          image: searchScreenshot,
          alt: 'Actual Buril Lab reagent search screen',
        },
        {
          title: '2. Disposal guidance',
          body: 'Review category basis, GHS phrases, and precautions together.',
          image: resultScreenshot,
          alt: 'Actual Buril Lab disposal guidance result screen',
        },
        {
          title: '3. Disposal records',
          body: 'Manage 7-day, 30-day, and 90-day records by lab.',
          image: logsScreenshot,
          alt: 'Actual Buril Lab disposal record screen',
        },
        {
          title: '4. 3D cabinet',
          body: 'Find and place reagents with shelf-level location context.',
          image: cabinet3dScreenshot,
          alt: 'Actual Buril Lab 3D cabinet screen',
        },
      ],
    },
    center: {
      eyebrow: 'Integrated Safety Center',
      heading: 'Safety managers see hidden risk signals first',
      body: 'Bring together expiring reagents, high-risk inventory, and unanswered requests across connected labs. Decide which lab needs attention first, faster.',
      institution: 'Rillo University Safety Center',
      domain: 'Rillo University · rillab.ac.kr · Approved',
      stats: [
        { label: 'Connected labs', value: '8', tone: 'bg-blue-50 text-blue-700' },
        { label: 'High-risk stock', value: '14', tone: 'bg-red-50 text-red-600' },
        { label: 'Expiring soon', value: '23', tone: 'bg-amber-50 text-amber-600' },
        { label: 'Open requests', value: '5', tone: 'bg-violet-50 text-violet-600' },
      ],
      tabs: ['Search', 'Logs', 'Cabinets', 'Inventory'],
      activeTab: 'Safety Center',
      accountRole: 'Institution manager',
      labHeatmapTitle: 'Lab risk heatmap',
      labHeatmapBody: 'Labs with higher risk scores appear first.',
      actionRequest: 'Request action',
      reviewTitle: 'Priority review items',
      reviewNeeded: 'Needs review',
      riskDetailEyebrow: 'Rillo University',
      riskDetailTitle: 'Risk detail',
      riskHeaders: ['Reagent', 'Lab', 'Status'],
      riskStatuses: ['Expiring soon', 'High risk', 'CAS check'],
      reportTitle: 'Spend less time preparing reports',
      reportBody: 'Export the high-risk inventory, disposal records, and request history needed for monthly reviews without rebuilding the data by hand.',
      checklist: [
        'Gather approved lab status in one screen',
        'Review expiring and high-risk stock first',
        'Send review requests and track responses',
        'Export monthly inspection material',
      ],
      labs: [
        { name: 'Chemical Process Lab', score: 82, risks: 6, due: 3 },
        { name: 'Nanomaterials Analysis Lab', score: 64, risks: 4, due: 2 },
        { name: 'Environmental Safety Lab', score: 38, risks: 2, due: 1 },
      ],
      riskItems: [
        { name: 'Diethyl ether', lab: 'Chemical Process Lab', due: '2d', tone: 'text-red-600 bg-red-50' },
        { name: 'Benzene', lab: 'Nanomaterials Analysis Lab', due: '5d', tone: 'text-amber-700 bg-amber-50' },
        { name: 'Hydrochloric acid', lab: 'Environmental Safety Lab', due: '7d', tone: 'text-amber-700 bg-amber-50' },
      ],
    },
    labels: {
      search: 'Reagent Search',
      disposalGuide: 'Disposal Guide',
    },
  },
};

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

function StrengthCard({ item }: { item: GatewayCopy['strengths'][number] }) {
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

function HeroPreview({ copy }: { copy: GatewayCopy }) {
  return (
    <div className="relative mx-auto h-[33rem] w-full max-w-[26rem] overflow-hidden sm:h-[39rem] sm:max-w-[39rem] lg:h-[39rem] lg:max-w-[41rem]">
      <div className="absolute inset-x-4 bottom-7 top-7 rounded-[2rem] border border-blue-100 bg-[linear-gradient(135deg,#eff6ff_0%,#ffffff_48%,#ecfdf5_100%)] shadow-2xl shadow-blue-950/10" />
      <div className="absolute left-3 top-16 w-[45%] sm:left-5 sm:top-20">
        <ScreenshotTile image={searchScreenshot} alt={copy.flow.items[0].alt} label={copy.labels.search} />
      </div>
      <div className="absolute bottom-12 left-8 w-[44%] sm:bottom-16 sm:left-14">
        <ScreenshotTile image={resultScreenshot} alt={copy.flow.items[1].alt} label={copy.labels.disposalGuide} />
      </div>
      <div className="absolute right-3 top-5 w-[54%] sm:right-7 sm:top-6 sm:w-[48%] lg:right-10 lg:top-5 lg:w-[43%]">
        <PhoneShot image={cabinet3dScreenshot} alt={copy.flow.items[3].alt} className="aspect-[430/932]" />
      </div>
      <div className="absolute bottom-7 right-5 max-w-[12rem] rounded-xl border border-blue-100 bg-white/95 px-4 py-3 shadow-lg shadow-slate-950/8 sm:bottom-10 sm:right-9">
        <p className="text-xs font-semibold text-blue-700">{copy.hero.previewLabel}</p>
        <p className="mt-1 text-sm font-medium leading-5 text-slate-800">{copy.hero.previewBody}</p>
      </div>
    </div>
  );
}

function CenterDashboardPreview({ copy }: { copy: GatewayCopy }) {
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
            <span className="text-sm font-semibold">{copy.brand}</span>
          </div>
          <div className="mt-8 grid gap-2 text-sm font-medium text-slate-500">
            {copy.center.tabs.map((item) => (
              <div key={item} className="rounded-lg px-3 py-2">{item}</div>
            ))}
            <div className="rounded-lg bg-emerald-700 px-3 py-2 text-white">{copy.center.activeTab}</div>
          </div>
          <div className="mt-24 rounded-lg bg-white p-3 text-xs font-medium text-slate-500 ring-1 ring-slate-100">
            <p className="text-slate-900">{copy.center.accountRole}</p>
            <p className="mt-1 truncate">center@rillab.ac.kr</p>
          </div>
        </aside>

        <div className="min-w-0 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-emerald-700">{copy.center.eyebrow}</p>
              <h3 className="mt-1 text-2xl font-semibold text-slate-950 [word-break:keep-all]">
                {copy.center.institution}
              </h3>
              <p className="mt-1 text-sm font-medium text-slate-500">{copy.center.domain}</p>
            </div>
            <button type="button" className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700">
              {copy.actions.refresh}
            </button>
          </div>

          <div className="mt-5 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {copy.center.stats.map((stat) => (
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
                  <h4 className="text-base font-semibold text-slate-950">{copy.center.labHeatmapTitle}</h4>
                  <p className="mt-1 text-sm font-medium text-slate-500">{copy.center.labHeatmapBody}</p>
                </div>
                <span className="rounded-lg bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">{copy.center.actionRequest}</span>
              </div>
              <div className="mt-4 grid gap-3">
                {copy.center.labs.map((lab) => (
                  <div key={lab.name} className="grid min-w-0 grid-cols-[minmax(0,1fr)_6rem_3rem_3rem] items-center gap-3 text-sm font-medium text-slate-600">
                    <span className="truncate text-slate-800">{lab.name}</span>
                    <span className="h-2 rounded-full bg-slate-100">
                      <span className="block h-2 rounded-full bg-red-500" style={{ width: `${lab.score}%` }} />
                    </span>
                    <span>{lab.risks}</span>
                    <span>{lab.due}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h4 className="text-base font-semibold text-slate-950">{copy.center.reviewTitle}</h4>
              <div className="mt-3 grid gap-3">
                {copy.center.riskItems.map((item) => (
                  <div key={item.name} className="rounded-lg border border-slate-100 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-semibold text-slate-950">{item.name}</p>
                      <span className="shrink-0 text-xs font-semibold text-red-500">{item.due}</span>
                    </div>
                    <p className="mt-1 truncate text-sm font-medium text-slate-500">{item.lab}</p>
                    <span className={`mt-2 inline-flex rounded-md px-2 py-1 text-xs font-semibold ${item.tone}`}>
                      {copy.center.reviewNeeded}
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

function CenterRiskPreview({ copy }: { copy: GatewayCopy }) {
  const rows = [
    copy.center.riskHeaders,
    ['Diethyl ether', copy.center.labs[0].name, copy.center.riskStatuses[0]],
    ['Benzene', copy.center.labs[1].name, copy.center.riskStatuses[1]],
    ['Acetonitrile', copy.center.labs[2].name, copy.center.riskStatuses[2]],
  ];

  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-emerald-700">{copy.center.riskDetailEyebrow}</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-950">{copy.center.riskDetailTitle}</h3>
        </div>
        <span className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Excel / PDF</span>
      </div>
      <div className="mt-4 grid gap-2 text-xs font-medium text-slate-600">
        {rows.map((row, index) => (
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
  const { i18n } = useTranslation();
  const language = (i18n.resolvedLanguage ?? i18n.language).startsWith('ko') ? 'ko' : 'en';
  const copy = copyByLanguage[language];

  return (
    <div className="min-h-screen overflow-x-hidden bg-white text-slate-950">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 lg:px-8">
          <button type="button" onClick={onNavigateToApp} className="flex min-w-0 items-center gap-3">
            <img src={logo} alt={copy.brand} className="h-10 w-10 shrink-0 rounded-lg object-contain" />
            <span className="truncate text-xl font-semibold tracking-tight">{copy.brand}</span>
          </button>
          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex">
            <a href="#buril" className="transition-colors hover:text-blue-700">{copy.nav.strengths}</a>
            <a href="#flow" className="transition-colors hover:text-blue-700">{copy.nav.flow}</a>
            <a href="#center" className="transition-colors hover:text-emerald-700">{copy.nav.center}</a>
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
                    aria-label={copy.actions.signOut}
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
                {copy.actions.login}
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
                {copy.hero.titleTop}
                <span className="block">{copy.hero.titleBottom}</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg font-normal leading-8 text-slate-600 [word-break:keep-all]">
                {copy.hero.body}
              </p>
              <div className="mt-8 flex max-w-full flex-col gap-3 sm:flex-row">
                <GatewayButton tone="blue" onClick={onNavigateToApp}>{copy.actions.startApp}</GatewayButton>
                <GatewayButton tone="light" onClick={onNavigateToCenter}>{copy.actions.viewCenter}</GatewayButton>
              </div>
              <div className="mt-10 grid min-w-0 gap-5 sm:grid-cols-2">
                {copy.strengths.map((item) => (
                  <StrengthCard key={item.title} item={item} />
                ))}
              </div>
            </div>

            <div className="relative min-w-0 lg:-mr-4">
              <HeroPreview copy={copy} />
            </div>
          </div>
        </section>

        <section id="flow" className="bg-white">
          <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8 lg:py-16">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
              <div className="min-w-0">
                <h2 className="text-3xl font-semibold leading-tight tracking-normal text-slate-950 [word-break:keep-all] lg:text-4xl">
                  {copy.flow.heading}
                </h2>
                <p className="mt-5 text-base font-normal leading-7 text-slate-600 [word-break:keep-all]">
                  {copy.flow.body}
                </p>
              </div>
              <div className="grid min-w-0 gap-5 sm:grid-cols-2 xl:grid-cols-4">
                {copy.flow.items.map((item) => (
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
                {copy.center.heading}
              </h2>
              <p className="mt-4 text-base font-normal leading-7 text-slate-600 [word-break:keep-all]">
                {copy.center.body}
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
                <GatewayButton tone="green" onClick={onNavigateToCenter}>{copy.actions.goCenter}</GatewayButton>
                <GatewayButton tone="blue" onClick={onNavigateToApp}>{copy.actions.goLabApp}</GatewayButton>
              </div>
              <div className="mt-8 grid gap-3">
                {copy.center.checklist.map((text) => (
                  <div key={text} className="flex items-center gap-3 text-sm font-medium text-slate-700">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                    <span>{text}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid min-w-0 gap-5">
              <CenterDashboardPreview copy={copy} />
              <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,0.78fr)]">
                <CenterRiskPreview copy={copy} />
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                    <Database className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-slate-950">{copy.center.reportTitle}</h3>
                  <p className="mt-2 text-sm font-normal leading-6 text-slate-600">{copy.center.reportBody}</p>
                  <div className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700">
                    <Download className="h-4 w-4 text-emerald-700" />
                    {copy.actions.exportReport}
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
