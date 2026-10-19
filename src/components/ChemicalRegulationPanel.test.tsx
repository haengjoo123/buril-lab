// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '../locales/translations';
import type { ChemicalRegulationLookup } from '../utils/chemicalRegulations';

const fetchChemicalRegulations = vi.fn<(cas: string) => Promise<ChemicalRegulationLookup>>();
vi.mock('../services/chemicalRegulationService', () => ({
    fetchChemicalRegulations: (cas: string) => fetchChemicalRegulations(cas),
}));

import { ChemicalRegulationPanel } from './ChemicalRegulationPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const i18n = createInstance();
await i18n.init({ lng: 'ko', resources: {
    ko: { translation: translations.ko }, en: { translation: translations.en },
} });

async function render(casNumber: string | null) {
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
        root.render(<I18nextProvider i18n={i18n}><ChemicalRegulationPanel casNumber={casNumber} /></I18nextProvider>);
    });
    return { container, unmount: () => act(() => root.unmount()) };
}

describe('ChemicalRegulationPanel', () => {
    afterEach(() => fetchChemicalRegulations.mockReset());

    it('shows only hazardous class names, descriptions and status, dropping low-value detail', async () => {
        fetchChemicalRegulations.mockResolvedValue({
            status: 'found',
            record: {
                casNumber: '50-00-0',
                keNumber: 'KE-17074',
                entries: [
                    { category: 'restricted', typeName: '제한물질', uniqueNumber: '06-5-5', contentThreshold: '폼알데하이드 및 이를 1% 이상 함유한 혼합물', exception: '가구용 무늬목 용도 금지' },
                    { category: 'human_eco_hazard', typeName: '인체등유해성물질', uniqueNumber: '97-1-345', contentThreshold: '인체급성유해성 : 1%' },
                    { category: 'existing', typeName: '기존화학물질', uniqueNumber: 'KE-17074' },
                ],
            },
        });

        const { container, unmount } = await render('50-00-0');
        const text = container.textContent || '';

        expect(fetchChemicalRegulations).toHaveBeenCalledWith('50-00-0');
        expect(text).toContain('법적 분류 (화학물질관리법)');
        expect(text).toContain('제한물질');
        expect(text).toContain('특정 용도로는 쓸 수 없도록 제한된 물질이에요.');
        expect(text).toContain('인체등유해성물질');
        expect(text).toContain('인체급성유해성 1% 이상이면 해당');
        // Unique numbers, raw content rules, restricted uses, KE number and the source line are dropped.
        for (const dropped of ['06-5-5', '97-1-345', '함유한 혼합물', '가구용 무늬목', 'KE-17074', '기존화학물질', '출처']) {
            expect(text).not.toContain(dropped);
        }
        unmount();
    });

    it('explains each class and decides applicability from an entered concentration', async () => {
        fetchChemicalRegulations.mockResolvedValue({
            status: 'found',
            record: {
                casNumber: '7647-01-0',
                entries: [
                    { category: 'accident_preparedness', typeName: '사고대비물질', uniqueNumber: '42', contentThreshold: '염화 수소 및 이를 10% 이상 함유한 혼합물' },
                    { category: 'human_eco_hazard', typeName: '인체등유해성물질', uniqueNumber: '97-1-203', contentThreshold: '인체급성유해성 : 10%' },
                ],
            },
        });

        const { container, unmount } = await render('7647-01-0');
        expect(container.textContent).toContain('화학사고 위험이 커서 보관·취급을 특별히 관리해야 하는 물질이에요.');
        expect(container.textContent).toContain('10% 이상이면 해당');
        expect(container.textContent).toContain('인체급성유해성 10% 이상이면 해당');
        expect(container.textContent).toContain('기준 미만이어도 하수구 배출이 가능하다는 뜻은 아니에요.');

        const input = container.querySelector('input[type="number"]') as HTMLInputElement;
        const setValue = (value: string) => act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });

        await setValue('3.6');
        expect(container.textContent?.match(/기준 미만 · 해당 안 됨/g)).toHaveLength(2);

        await setValue('35');
        expect(container.textContent).toContain('해당 (인체급성유해성 10%)');
        expect(container.textContent).not.toContain('기준 미만 · 해당 안 됨');
        unmount();
    });

    it('marks a class without a concentration rule as always applicable and hides the input', async () => {
        fetchChemicalRegulations.mockResolvedValue({
            status: 'found',
            record: { casNumber: '1-2-3', entries: [{ category: 'banned', typeName: '금지물질', uniqueNumber: '1' }] },
        });

        const { container, unmount } = await render('50-00-0');
        expect(container.textContent).toContain('농도와 관계없이 해당');
        expect(container.querySelector('input')).toBeNull();
        unmount();
    });

    it('renders nothing for a substance without a hazardous class', async () => {
        fetchChemicalRegulations.mockResolvedValue({
            status: 'found',
            record: { casNumber: '67-64-1', keNumber: 'KE-29367', entries: [{ category: 'existing', typeName: '기존화학물질' }] },
        });

        const { container, unmount } = await render('67-64-1');
        expect(fetchChemicalRegulations).toHaveBeenCalledWith('67-64-1');
        expect(container.innerHTML).toBe('');
        unmount();
    });

    it('renders nothing for a CAS number the source does not know', async () => {
        fetchChemicalRegulations.mockResolvedValue({ status: 'not_found' });

        const { container, unmount } = await render('67-64-1');
        expect(container.innerHTML).toBe('');
        unmount();
    });

    it('renders nothing when the lookup is unavailable', async () => {
        fetchChemicalRegulations.mockResolvedValue({ status: 'unavailable' });

        const { container, unmount } = await render('67-64-1');
        expect(container.innerHTML).toBe('');
        unmount();
    });

    it('skips the lookup for an invalid CAS number', async () => {
        const { container, unmount } = await render('67-64-2');
        expect(fetchChemicalRegulations).not.toHaveBeenCalled();
        expect(container.innerHTML).toBe('');
        unmount();
    });
});
