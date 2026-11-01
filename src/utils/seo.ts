export const SITE_ORIGIN = 'https://burillab.com';

export type SeoLanguage = 'ko' | 'en';

type RouteCopy = { title: string; description: string };

export type DocumentMeta = {
  title: string;
  description: string | null;
  canonical: string | null;
  indexable: boolean;
};

// Only these routes are meant for search engines; every other route is an
// authenticated or task-specific app screen and is marked noindex.
const PUBLIC_ROUTES: Record<string, Record<SeoLanguage, RouteCopy>> = {
  '/': {
    ko: {
      title: '버릴랩 | 연구실 폐시약 폐기 기준 검색·시약 재고 관리',
      description:
        '시약명이나 CAS 번호로 폐시약 폐기 기준과 GHS 주의사항을 확인하고, 3D 시약장·재고·폐기 기록을 한곳에서 관리하는 연구실 안전 관리 서비스입니다.',
    },
    en: {
      title: 'Buril Lab | Lab Chemical Waste Disposal Lookup & Reagent Inventory',
      description:
        'Look up disposal guidance and GHS precautions by reagent name or CAS number, then manage 3D cabinets, inventory, and disposal records for your lab in one place.',
    },
  },
  '/privacy': {
    ko: { title: '개인정보처리방침 | 버릴랩', description: '버릴랩이 수집하는 정보와 이용·보관·삭제 방법을 안내합니다.' },
    en: { title: 'Privacy Policy | Buril Lab', description: 'What information Buril Lab collects and how it is used, retained, and deleted.' },
  },
  '/terms': {
    ko: { title: '이용약관 | 버릴랩', description: '버릴랩 서비스 이용 조건, 요금·환불, 안전 정보의 성격과 책임 범위를 안내합니다.' },
    en: { title: 'Terms of Service | Buril Lab', description: 'Conditions for using Buril Lab, fees and refunds, the nature of safety information, and liability.' },
  },
  '/cookies': {
    ko: { title: '쿠키 및 브라우저 저장소 안내 | 버릴랩', description: '버릴랩이 브라우저에 저장하는 정보와 거부 방법을 안내합니다.' },
    en: { title: 'Cookies & Browser Storage | Buril Lab', description: 'What Buril Lab stores in your browser and how to remove it.' },
  },
};

export type LegalDocumentKind = 'terms' | 'cookies';

function normalizePathname(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export function getLegalDocumentKind(pathname: string): LegalDocumentKind | null {
  const normalized = normalizePathname(pathname);
  if (normalized === '/terms') return 'terms';
  if (normalized === '/cookies') return 'cookies';
  return null;
}

export function getDocumentMeta(pathname: string, language: SeoLanguage, appTitle: string): DocumentMeta {
  const normalized = normalizePathname(pathname);
  const route = PUBLIC_ROUTES[normalized];
  if (!route) {
    return { title: appTitle, description: null, canonical: null, indexable: false };
  }
  const copy = route[language];
  return {
    title: copy.title,
    description: copy.description,
    canonical: `${SITE_ORIGIN}${normalized === '/' ? '/' : normalized}`,
    indexable: true,
  };
}

function upsertHeadElement(selector: string, create: () => HTMLElement): HTMLElement {
  const existing = document.head.querySelector<HTMLElement>(selector);
  if (existing) return existing;
  const element = create();
  document.head.appendChild(element);
  return element;
}

function setMetaContent(name: string, content: string | null) {
  const selector = `meta[name="${name}"]`;
  if (content === null) {
    document.head.querySelector(selector)?.remove();
    return;
  }
  const meta = upsertHeadElement(selector, () => {
    const element = document.createElement('meta');
    element.setAttribute('name', name);
    return element;
  });
  meta.setAttribute('content', content);
}

export function applyDocumentMeta(meta: DocumentMeta) {
  document.title = meta.title;
  if (meta.description) setMetaContent('description', meta.description);
  setMetaContent('robots', meta.indexable ? null : 'noindex');

  if (meta.canonical) {
    const link = upsertHeadElement('link[rel="canonical"]', () => {
      const element = document.createElement('link');
      element.setAttribute('rel', 'canonical');
      return element;
    });
    link.setAttribute('href', meta.canonical);
  } else {
    document.head.querySelector('link[rel="canonical"]')?.remove();
  }
}
