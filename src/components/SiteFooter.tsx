import { OPERATOR_CONTACT_EMAIL } from '../config/operator';

const copyByLanguage = {
  ko: {
    links: [
      { href: '/privacy', label: '개인정보처리방침', strong: true },
      { href: '/terms', label: '이용약관' },
      { href: '/cookies', label: '쿠키 및 저장소 안내' },
    ],
    operator: '운영: 버릴랩 (사업자 등록 전 개인 운영 서비스)',
    contact: '문의',
    pricing: '현재 모든 기능 무료 · 결제 없음',
  },
  en: {
    links: [
      { href: '/privacy', label: 'Privacy Policy', strong: true },
      { href: '/terms', label: 'Terms of Service' },
      { href: '/cookies', label: 'Cookies & Storage' },
    ],
    operator: 'Operated by BurilLab (individually operated; business registration pending)',
    contact: 'Contact',
    pricing: 'All features currently free · no payments',
  },
} as const;

export function SiteFooter({ language }: { language: 'ko' | 'en' }) {
  const copy = copyByLanguage[language];

  return (
    <footer className="border-t border-slate-200 bg-slate-50 text-slate-600">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-sm lg:px-8">
        <nav aria-label={language === 'ko' ? '정책 및 약관' : 'Policies'} className="flex flex-wrap gap-x-5 gap-y-2">
          {copy.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`underline-offset-2 hover:text-blue-700 hover:underline ${'strong' in link ? 'font-semibold text-slate-900' : ''}`}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="grid gap-1 text-xs leading-5">
          <p>{copy.operator}</p>
          <p>
            {copy.contact}:{' '}
            <a href={`mailto:${OPERATOR_CONTACT_EMAIL}`} className="underline underline-offset-2 hover:text-blue-700">
              {OPERATOR_CONTACT_EMAIL}
            </a>
          </p>
          <p>{copy.pricing}</p>
          <p>&copy; 2026 BurilLab. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
