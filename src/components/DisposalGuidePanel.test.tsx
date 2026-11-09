import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { translations } from '../locales/translations';
import { buildStructuredDisposalGuide } from '../../functions/api/ai/disposal-guide';
import { DisposalGuidePanel } from './DisposalGuidePanel';
import { getDisposalGuideChecks } from './disposalGuidePresentation';

const i18n = createInstance();
await i18n.init({ lng: 'ko', resources: { ko: { translation: translations.ko }, en: { translation: translations.en } } });

const result = buildStructuredDisposalGuide({
    chemicals: [{ name: 'Acetone', category: 'ORGANIC_NON_HALOGEN' }],
    decision: { decisionStatus: 'ready', streamCode: 'ORGANIC_NON_HALOGENATED', allowedActions: ['container_deposit'] },
    policy: { stream: {
        streamCode: 'ORGANIC_NON_HALOGENATED', name: '비할로겐 유기 폐액통', location: '폐기물 보관실 A열',
        labelInstructions: ['성분명', '주요 위험', '대략적인 양 또는 양 모름', '수거일 기재'],
        evidence: [{ id: 'policy', sourceType: 'policy', title: '기관 지침', reference: 'https://example.com/sop' }],
    } },
});
const render = (guide = result) => load(renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
        <DisposalGuidePanel result={guide} componentNames="Acetone, Ethanol" amount="약 300 mL" hazards={['인화성']} hazardsNeedReview={false} />
    </I18nextProvider>,
));

describe('disposal guide presentation', () => {
    it('shows actual destination and label values instead of numbered label field names', () => {
        const $ = render();
        const destination = $('section[aria-label="처리 위치와 라벨"]');
        for (const text of ['비할로겐 유기 폐액통', '폐기물 보관실 A열', 'Acetone, Ethanol', '약 300 mL', '인화성', '수거일 기재']) {
            expect(destination.text()).toContain(text);
        }
        expect($('ol').text()).not.toContain('라벨:');
        expect($('ol').text()).not.toContain('사용하세요.');
        for (const text of ['보안경', '뚜껑', '2차 운반 용기', '기록']) expect($('ol').text()).toContain(text);
        expect($('section[aria-label="절대 하면 안 되는 행동"]').text()).toContain('배수구·싱크대');
        expect($('details').attr('open')).toBeUndefined();
        expect($('details').text()).toContain(result.summary);
        expect($('details a').attr('href')).toBe('https://example.com/sop');
    });

    it('preserves destination-specific cautions rather than removing them as duplicates', () => {
        const caution = '비할로겐 유기 폐액통을 사용하세요. 누출이 있으면 접근하지 마세요.';
        const checks = getDisposalGuideChecks({ ...result, steps: [...result.steps, caution, caution] });
        expect(checks.filter((step) => step === caution)).toHaveLength(1);
    });

    it.each(['blocked', 'needs_input'] as const)('keeps %s warnings visible and withholds the deposit/label panel', (decisionStatus) => {
        const summary = '일반 폐액통에 입고하지 말고 담당자에게 확인하세요.';
        // Even contradictory depositAllowed metadata must never render a deposit destination.
        const guide = { ...result, decisionStatus, summary };
        const $ = render(guide);
        expect($('section[aria-label="처리 위치와 라벨"]').length).toBe(0);
        expect($('details').text()).not.toContain(summary);
        expect($('p').text()).toContain(summary);
        expect(getDisposalGuideChecks(guide)).toEqual(guide.steps);
    });

    it('shows unavailable and missing-location states without inventing a location', () => {
        const $ = render({ ...result, availability: 'unavailable', destination: { ...result.destination, location: null } });
        expect($('[role="status"]').text()).toBe(translations.ko.waste_ai_unavailable);
        expect($('section[aria-label="처리 위치와 라벨"]').text()).toContain('위치 미등록');
    });

    it('renders English section labels', async () => {
        await i18n.changeLanguage('en');
        try {
            const $ = render();
            for (const text of ['Label contents', 'Handling steps', 'Explanation and evidence']) expect($.text()).toContain(text);
        } finally {
            await i18n.changeLanguage('ko');
        }
    });
});
