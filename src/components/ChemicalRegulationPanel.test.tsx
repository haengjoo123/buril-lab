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

async function render(casNumber: string | null, variant?: 'actions' | 'classes') {
    const container = document.createElement('div');
    // Attached so focus moves can be observed.
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(<I18nextProvider i18n={i18n}><ChemicalRegulationPanel casNumber={casNumber} variant={variant} /></I18nextProvider>);
    });
    return {
        container,
        unmount: () => {
            act(() => root.unmount());
            container.remove();
        },
    };
}

const FORMALDEHYDE: ChemicalRegulationLookup = {
    status: 'found',
    record: {
        casNumber: '50-00-0',
        keNumber: 'KE-17074',
        entries: [
            { category: 'restricted', typeName: '제한물질', uniqueNumber: '06-5-5', contentThreshold: '폼알데하이드 및 이를 1% 이상 함유한 혼합물', exception: '가구용 무늬목 용도 금지' },
            { category: 'human_eco_hazard', typeName: '인체등유해성물질', uniqueNumber: '97-1-345', contentThreshold: '인체급성유해성 : 1%', noticeDate: '2025-08-07', noticeInfo: '화학물질안전원고시 제2025-19호' },
            { category: 'existing', typeName: '기존화학물질', uniqueNumber: 'KE-17074' },
        ],
    },
};

const setInputValue = (input: HTMLInputElement, value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
});

describe('ChemicalRegulationPanel actions variant', () => {
    afterEach(() => fetchChemicalRegulations.mockReset());

    it('leads with what to do and folds the legal detail into the basis section', async () => {
        fetchChemicalRegulations.mockResolvedValue(FORMALDEHYDE);
        const { container, unmount } = await render('50-00-0', 'actions');
        const details = container.querySelector('details')!;
        const summaryArea = Array.from(container.firstElementChild!.children)
            .filter((child) => child !== details)
            .map((child) => child.textContent)
            .join(' ');

        expect(summaryArea).toContain('화관법 · 취급할 일');
        expect(summaryArea).toContain('제한된 용도로는 쓸 수 없어요.');
        expect(summaryArea).toContain('잠글 수 있는 시약장에 보관하세요.');
        expect(summaryArea).toContain('덜어 쓰는 용기에도 물질명과 경고표시를 붙이세요.');
        expect(summaryArea).toContain('1% 이상일 때');
        expect(summaryArea).toContain('농도 입력해서 확인');
        // Class chips stay visible; numbers, exceptions and notices do not.
        expect(summaryArea).toContain('제한물질');
        expect(summaryArea).toContain('인체등유해성물질');
        for (const folded of ['06-5-5', '가구용 무늬목', '제2025-19호', '화학물질관리법 제16조', '기존화학물질']) {
            expect(summaryArea).not.toContain(folded);
        }

        expect(details.open).toBe(false);
        const basis = details.textContent || '';
        expect(basis).toContain('분류 근거 보기');
        expect(basis).toContain('고유번호 06-5-5');
        expect(basis).toContain('예외: 가구용 무늬목 용도 금지');
        expect(basis).toContain('화학물질안전원고시 제2025-19호 · 2025-08-07');
        expect(basis).toContain('화학물질관리법 제16조');
        expect(basis).toContain('2026-11-16 원문 확인');
        expect(basis).not.toContain('기존화학물질');
        unmount();
    });

    it('opens the basis section at the concentration input and settles the conditional duties', async () => {
        fetchChemicalRegulations.mockResolvedValue(FORMALDEHYDE);
        const { container, unmount } = await render('50-00-0', 'actions');
        const button = Array.from(container.querySelectorAll('button')).find((element) => element.textContent === '농도 입력해서 확인')!;
        await act(async () => { button.click(); });

        const details = container.querySelector('details')!;
        const input = container.querySelector('input[type="number"]') as HTMLInputElement;
        expect(details.open).toBe(true);
        expect(document.activeElement).toBe(input);

        await setInputValue(input, '0.5');
        expect(container.textContent).toContain('입력한 농도에서는 해당하는 분류가 없어요.');
        expect(container.textContent).not.toContain('덜어 쓰는 용기에도');

        await setInputValue(input, '37');
        expect(container.textContent).toContain('덜어 쓰는 용기에도 물질명과 경고표시를 붙이세요.');
        expect(container.textContent).not.toContain('1% 이상일 때');
        expect(container.textContent).not.toContain('농도 입력해서 확인');
        unmount();
    });

    it('shows definite duties without a concentration prompt and no input when no class has a rule', async () => {
        fetchChemicalRegulations.mockResolvedValue({
            status: 'found',
            record: { casNumber: '1-2-3', entries: [{ category: 'accident_preparedness', typeName: '사고대비물질' }] },
        });
        const { container, unmount } = await render('50-00-0', 'actions');
        expect(container.textContent).toContain('반응할 수 있는 물질과 섞어 두지 말고 칸을 나눠 보관하세요.');
        expect(container.textContent).not.toContain('잠글 수 있는');
        expect(container.textContent).not.toContain('농도 입력해서 확인');
        expect(container.querySelector('input')).toBeNull();
        unmount();
    });

    it('states a shared concentration condition once, and per line only when the lines differ', async () => {
        fetchChemicalRegulations.mockResolvedValue({
            status: 'found',
            record: { casNumber: '1-2-3', entries: [
                { category: 'restricted', typeName: '제한물질', contentThreshold: '이를 1% 이상 함유한 혼합물' },
                { category: 'human_eco_hazard', typeName: '인체등유해성물질', contentThreshold: '인체급성유해성 : 1%, 인체만성유해성 : 0.1%' },
            ] },
        });
        const shared = await render('50-00-0', 'actions');
        const sharedLines = Array.from(shared.container.querySelectorAll('li')).map((li) => li.textContent || '');
        expect(shared.container.textContent).toContain('농도 0.1~1% 이상일 때 해당돼요.');
        expect(sharedLines.some((line) => line.includes('이상일 때'))).toBe(false);
        shared.unmount();

        fetchChemicalRegulations.mockResolvedValue({
            status: 'found',
            record: { casNumber: '1-2-3', entries: [
                { category: 'accident_preparedness', typeName: '사고대비물질' },
                { category: 'human_eco_hazard', typeName: '인체등유해성물질', contentThreshold: '인체급성유해성 : 10%' },
            ] },
        });
        const mixed = await render('7647-01-0', 'actions');
        const lockedLine = Array.from(mixed.container.querySelectorAll('li')).find((li) => li.textContent?.includes('잠글 수 있는'));
        expect(lockedLine?.textContent).toContain('10% 이상일 때');
        expect(mixed.container.textContent).not.toContain('해당돼요.');
        expect(mixed.container.textContent).toContain('농도 입력해서 확인');
        mixed.unmount();
    });

    it('still renders nothing without a hazardous class', async () => {
        fetchChemicalRegulations.mockResolvedValue({
            status: 'found',
            record: { casNumber: '67-64-1', entries: [{ category: 'existing', typeName: '기존화학물질' }] },
        });
        const { container, unmount } = await render('67-64-1', 'actions');
        expect(container.innerHTML).toBe('');
        unmount();
    });

    it('speaks English when the app does', async () => {
        fetchChemicalRegulations.mockResolvedValue(FORMALDEHYDE);
        await act(async () => { await i18n.changeLanguage('en'); });
        try {
            const { container, unmount } = await render('50-00-0', 'actions');
            expect(container.textContent).toContain('Chemicals Control Act · what to do');
            expect(container.textContent).toContain('Label any container you decant it into');
            expect(container.textContent).toContain('at 1% or more');
            unmount();
        } finally {
            await act(async () => { await i18n.changeLanguage('ko'); });
        }
    });
});

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
