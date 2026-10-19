// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '../locales/translations';
import type { WasteComponent } from '../types';
import type { ChemicalRegulationLookup } from '../utils/chemicalRegulations';

const fetchChemicalRegulations = vi.fn<(cas: string) => Promise<ChemicalRegulationLookup>>();
vi.mock('../services/chemicalRegulationService', () => ({
    fetchChemicalRegulations: (cas: string) => fetchChemicalRegulations(cas),
}));

import { WasteComponentRegulationChips } from './WasteComponentRegulationChips';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const i18n = createInstance();
await i18n.init({ lng: 'ko', resources: {
    ko: { translation: translations.ko }, en: { translation: translations.en },
} });

const hcl = (overrides: Partial<WasteComponent>): WasteComponent => ({
    cartLineId: 'line-1',
    chemical: { id: 'hcl', name: 'Hydrochloric acid', casNumber: '7647-01-0', molecularFormula: 'HCl', molecularWeight: 36.46 },
    ...overrides,
} as WasteComponent);

async function render(component: WasteComponent) {
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
        root.render(<I18nextProvider i18n={i18n}><WasteComponentRegulationChips component={component} /></I18nextProvider>);
    });
    return { text: container.textContent ?? '', html: container.innerHTML, unmount: () => act(() => root.unmount()) };
}

describe('WasteComponentRegulationChips', () => {
    afterEach(() => fetchChemicalRegulations.mockReset());

    const found: ChemicalRegulationLookup = {
        status: 'found',
        record: {
            casNumber: '7647-01-0',
            entries: [
                { category: 'accident_preparedness', typeName: '사고대비물질', contentThreshold: '염화 수소 및 이를 10% 이상 함유한 혼합물' },
                { category: 'existing', typeName: '기존화학물질' },
            ],
        },
    };

    it('marks a neat product as applying, judged as supplied', async () => {
        fetchChemicalRegulations.mockResolvedValue(found);
        const { text, unmount } = await render(hcl({ materialForm: 'neat' }));
        expect(text).toContain('사고대비물질 해당');
        expect(text).toContain('제품 그대로 기준');
        expect(text).not.toContain('기존화학물질');
        unmount();
    });

    it('marks a dilute solution as below the threshold with a converted estimate', async () => {
        fetchChemicalRegulations.mockResolvedValue(found);
        const { text, unmount } = await render(hcl({ materialForm: 'solution', concentration: { value: 1, unit: 'M' } }));
        expect(text).toContain('사고대비물질 기준 미만');
        expect(text).toContain('환산 추정');
        unmount();
    });

    it('asks for a concentration when a solution has none', async () => {
        fetchChemicalRegulations.mockResolvedValue(found);
        const { text, unmount } = await render(hcl({ materialForm: 'solution' }));
        expect(text).toContain('사고대비물질 · 농도 입력 시 판정');
        unmount();
    });

    it('renders nothing when the lookup is unavailable or there is no hazardous class', async () => {
        fetchChemicalRegulations.mockResolvedValue({ status: 'unavailable' });
        const unavailable = await render(hcl({ materialForm: 'neat' }));
        expect(unavailable.html).toBe('');
        unavailable.unmount();

        fetchChemicalRegulations.mockResolvedValue({ status: 'found', record: { casNumber: '67-64-1', entries: [{ category: 'existing', typeName: '기존화학물질' }] } });
        const none = await render(hcl({ materialForm: 'neat' }));
        expect(none.html).toBe('');
        none.unmount();
    });
});
