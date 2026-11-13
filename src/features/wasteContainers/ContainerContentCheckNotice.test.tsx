import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContainerContentCheckNotice } from './ContainerContentCheckNotice';
import type { ContainerContentCheck } from './useContainerContentCheck';
import type { ContainerContentWarning } from './containerContentCheck';

const render = (check: ContainerContentCheck, language = 'ko') =>
    renderToStaticMarkup(<ContainerContentCheckNotice check={check} language={language} />);

const danger: ContainerContentWarning = {
    severity: 'DANGER', ruleId: 'oxidizer_flammable', incoming: 'Hydrogen peroxide', inContainer: 'Acetone',
};
const caution: ContainerContentWarning = {
    severity: 'WARNING', ruleId: 'corrosive_cyanide_sulfide', incoming: 'Sodium cyanide', inContainer: 'Sulfuric acid',
};

describe('ContainerContentCheckNotice', () => {
    it('renders nothing when the check is off or the container has no recorded contents', () => {
        expect(render({ status: 'off' })).toBe('');
        expect(render({ status: 'ready', warnings: [], recordedCount: 0, truncated: false })).toBe('');
    });

    it('says the comparison did not happen when the records could not be read', () => {
        const html = render({ status: 'unavailable' });
        expect(html).toContain('대조하지 못했습니다');
        expect(html).not.toContain('위험 조합은 없습니다');
    });

    it('never presents an empty result as safe', () => {
        const html = render({ status: 'ready', warnings: [], recordedCount: 3, truncated: false });
        expect(html).toContain('성분 3종과 알려진 위험 조합은 없습니다');
        expect(html).toContain('안전을 보증하지 않습니다');
        expect(html).not.toContain('role="alert"');
    });

    it('raises an alert naming both substances and the reason for a danger', () => {
        const html = render({ status: 'ready', warnings: [danger, caution], recordedCount: 2, truncated: false });
        expect(html).toContain('role="alert"');
        expect(html).toContain('붓지 마세요');
        expect(html).toContain('지금 넣는 Hydrogen peroxide ↔ 통에 기록된 Acetone');
        expect(html).toContain('산화제와 인화성 물질이 만나면');
        expect(html).toContain('border-red-300');
    });

    it('uses the caution tone when there is no danger, and notes a partial comparison', () => {
        const html = render({ status: 'ready', warnings: [caution], recordedCount: 1, truncated: true }, 'en');
        expect(html).toContain('before pouring');
        expect(html).not.toContain('Do not pour');
        expect(html).toContain('only part of them was compared');
        expect(html).toContain('border-amber-200');
    });

    it('lists at most four pairs and counts the rest', () => {
        const warnings = Array.from({ length: 6 }, (_, index) => ({ ...danger, inContainer: `Solvent ${index}` }));
        const html = render({ status: 'ready', warnings, recordedCount: 6, truncated: false });
        expect(html.match(/<li/g)).toHaveLength(4);
        expect(html).toContain('외 2건');
    });
});
