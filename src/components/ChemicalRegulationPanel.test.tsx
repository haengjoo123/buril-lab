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

    it('lists hazardous classes with thresholds and exceptions, hiding inventory-only classes', async () => {
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
        expect(text).toContain('제한물질06-5-5');
        expect(text).toContain('가구용 무늬목 용도 금지');
        expect(text).toContain('인체등유해성물질97-1-345');
        expect(text).toContain('인체급성유해성 : 1%');
        expect(text).not.toContain('기존화학물질KE');
        expect(text).toContain('기존화학물질 번호 KE-17074');
        unmount();
    });

    it('says when a known substance has no hazardous class', async () => {
        fetchChemicalRegulations.mockResolvedValue({
            status: 'found',
            record: { casNumber: '67-64-1', keNumber: 'KE-29367', entries: [{ category: 'existing', typeName: '기존화학물질' }] },
        });

        const { container, unmount } = await render('67-64-1');
        expect(container.textContent).toContain('유해화학물질(인체등유해성·허가·제한·금지·사고대비물질)로 분류되어 있지 않습니다.');
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
