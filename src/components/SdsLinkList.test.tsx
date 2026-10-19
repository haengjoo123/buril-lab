import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { translations } from '../locales/translations';
import { SdsLinkList } from './SdsLinkList';

const i18n = createInstance();
await i18n.init({ lng: 'ko', resources: {
    ko: { translation: translations.ko }, en: { translation: translations.en },
} });
const render = (element: React.ReactNode) => renderToStaticMarkup(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>);

describe('SdsLinkList', () => {
    it('lists every tier with its query, opening each link in a new tab', () => {
        const html = render(<SdsLinkList brand="Sigma" productNumber="179124-1L" casNumber="67-64-1" />);

        expect(html).toContain('SDS (물질안전보건자료)');
        expect(html).toContain('Sigma-Aldrich · 제조사 제품 페이지');
        expect(html).toContain('제품번호 179124');
        expect(html).toContain('Sigma-Aldrich · 제조사 SDS 검색');
        expect(html).toContain('KOSHA · KOSHA 공공 MSDS (참고용)');
        expect(html.match(/target="_blank"/g)).toHaveLength(3);
        expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(3);
        expect(html).not.toContain('공공 자료만 표시합니다');
    });

    it('warns when only the public reference is available', () => {
        const html = render(<SdsLinkList brand="cmos" casNumber="67-64-1" />);
        expect(html).toContain('공공 자료만 표시합니다');
    });

    it('asks for identifiers when nothing resolves', () => {
        expect(render(<SdsLinkList />)).toContain('브랜드, 제품번호, CAS 번호를 입력하면');
    });

    it('renders one link to the best match in compact mode', () => {
        const html = render(<SdsLinkList variant="compact" brand="DUKSAN REAGENTS" casNumber="67-64-1" />);
        expect(html.match(/<a /g)).toHaveLength(1);
        expect(html).toContain('href="https://duksan.kr/page/03/msds.php?keyword=67-64-1"');
    });

    it('renders nothing in compact mode without a link', () => {
        expect(render(<SdsLinkList variant="compact" brand="cmos" />)).toBe('');
    });

    it('links every CAS-searchable manufacturer by name in manufacturers mode', () => {
        const html = render(<SdsLinkList variant="manufacturers" brand="TCI" productNumber="A0001" casNumber="67-64-1" />);

        expect(html).toContain('제조사에서 찾기');
        expect(html).toContain('CAS 67-64-1');
        expect(html.indexOf('Sigma-Aldrich')).toBeLessThan(html.indexOf('덕산약품'));
        expect(html.indexOf('덕산약품')).toBeLessThan(html.indexOf('대정화금'));
        expect(html.indexOf('대정화금')).toBeLessThan(html.indexOf('삼전순약'));
        expect(html).not.toContain('tcichemicals');
        expect(html.match(/<a /g)).toHaveLength(4);
        expect(html.match(/target="_blank"/g)).toHaveLength(4);
        expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(4);
    });

    it('renders nothing in manufacturers mode without a valid CAS number', () => {
        expect(render(<SdsLinkList variant="manufacturers" />)).toBe('');
        expect(render(<SdsLinkList variant="manufacturers" casNumber="not-a-cas" />)).toBe('');
    });
});
