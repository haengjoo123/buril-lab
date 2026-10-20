// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { translations } from '../locales/translations';
import type { Chemical, WasteComponent, WasteConcentration, WasteMaterialForm } from '../types';
import { analyzeChemical } from '../utils/chemicalAnalyzer';
import { createWasteComponentFromAnalysis } from '../utils/wasteBatch';
import { FatalToxicityDilutionHint } from './FatalToxicityDilutionHint';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const i18n = createInstance();
await i18n.init({ lng: 'ko', resources: {
    ko: { translation: translations.ko }, en: { translation: translations.en },
} });

const CHEMICALS: Record<string, Chemical> = {
    sulfuric: {
        id: 'h2so4', name: 'Sulfuric acid', casNumber: '7664-93-9', molecularFormula: 'H2O4S',
        ghs: { signal: 'Danger', hazardStatements: ['H290', 'H314', 'H330', 'H350'] },
    },
    mercaptoethanol: {
        id: 'bme', name: '2-Mercaptoethanol', casNumber: '60-24-2', molecularFormula: 'C2H6OS',
        ghs: { signal: 'Danger', hazardStatements: ['H227', 'H301', 'H311', 'H318', 'H330', 'H400'] },
    },
    ethidium: {
        id: 'etbr', name: 'Ethidium bromide', casNumber: '1239-45-8', molecularFormula: 'C21H20BrN3',
        ghs: { signal: 'Danger', hazardStatements: ['H302', 'H315', 'H330', 'H341'] },
    },
    acetic: {
        id: 'acoh', name: 'Acetic acid', casNumber: '64-19-7', molecularFormula: 'C2H4O2',
        ghs: { signal: 'Danger', hazardStatements: ['H226', 'H314'] },
    },
};

const component = (key: string, materialForm?: WasteMaterialForm, concentration?: WasteConcentration): WasteComponent =>
    createWasteComponentFromAnalysis(analyzeChemical({ ...CHEMICALS[key] }), {
        cartLineId: key, identityConfidence: 'verified', ghsDataStatus: 'verified', materialForm, concentration,
    });

async function hintText(item: WasteComponent): Promise<string> {
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
        root.render(<I18nextProvider i18n={i18n}><FatalToxicityDilutionHint component={item} /></I18nextProvider>);
    });
    const text = container.textContent ?? '';
    act(() => root.unmount());
    return text;
}

describe('FatalToxicityDilutionHint', () => {
    it('asks for the concentration only where it changes the outcome', async () => {
        expect(await hintText(component('sulfuric'))).toBe('농도를 입력하면 10% 미만의 묽은 용액은 일반 산성 폐액으로 안내돼요.');
        expect(await hintText(component('mercaptoethanol'))).toBe('농도를 입력하면 1% 미만의 묽은 용액은 일반 폐액으로 안내돼요.');
        expect(await hintText(component('acetic'))).toBe('');
        expect(await hintText(component('ethidium'))).toBe('');
    });

    it('explains the outcome once a concentration or form is given', async () => {
        expect(await hintText(component('sulfuric', 'solution', { value: 1, unit: 'M' })))
            .toBe('기준 농도 10% 미만이라 일반 산성 폐액으로 안내해요.');
        expect(await hintText(component('sulfuric', 'solution', { value: 2, unit: 'M' })))
            .toBe('기준 농도 10% 이상이라 따로 모아 담당자에게 넘겨야 해요.');
        expect(await hintText(component('sulfuric', 'neat')))
            .toBe("원액은 따로 모아 넘겨야 해요. 묽힌 용액이면 '용액·혼합액'을 고르고 농도를 입력하세요.");
    });
});
