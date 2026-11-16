// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '../../../locales/translations';
import { useFridgeStore } from '../../../store/fridgeStore';
import type { ShelfData } from '../../../types/fridge';
import { CabinetFormDialog } from './CabinetFormDialog';
import { StorageCompatBanner } from './StorageCompatBanner';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const i18n = createInstance();
await i18n.init({ lng: 'ko', resources: { ko: { translation: translations.ko } } });

async function render(element: React.ReactElement) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>); });
    return {
        container,
        unmount: () => {
            act(() => root.unmount());
            container.remove();
        },
    };
}

const click = (element: Element | null | undefined) => act(() => { (element as HTMLElement).click(); });

describe('cabinet lock choice', () => {
    afterEach(() => vi.restoreAllMocks());

    it('is hidden unless the caller passes a lock value', async () => {
        const { container, unmount } = await render(
            <CabinetFormDialog isOpen onClose={() => {}} title="Edit" initialName="A" onConfirm={() => {}} />,
        );
        expect(container.textContent).not.toContain('잠금장치');
        unmount();
    });

    it('starts from the saved value and hands back the chosen one', async () => {
        const onConfirm = vi.fn();
        const { container, unmount } = await render(
            <CabinetFormDialog isOpen onClose={() => {}} title="Edit" initialName="A" initialLocked={null} onConfirm={onConfirm} />,
        );
        const radios = Array.from(container.querySelectorAll('[role="radio"]'));
        expect(radios.map((radio) => radio.textContent)).toEqual(['있음', '없음', '모름']);
        expect(radios.find((radio) => radio.getAttribute('aria-checked') === 'true')?.textContent).toBe('모름');

        await click(radios[1]);
        await click(Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('확인')));
        expect(onConfirm).toHaveBeenCalledWith('A', undefined, false);
        unmount();
    });
});

describe('storage banner single-reagent rows', () => {
    it('lists a reagent in a cabinet without a lock and offers no auto-arrange for it', async () => {
        useFridgeStore.setState({ shelves: [{ id: 'top', level: 0, items: [], dividers: [] } as unknown as ShelfData] });
        const onFocusIssue = vi.fn();
        const { container, unmount } = await render(
            <StorageCompatBanner
                warningMap={new Map()}
                reviewMap={new Map()}
                containmentMap={new Map([['top', [{ ruleId: 'locked_storage_required', itemId: 'toxic', itemName: '불화 소듐', messageKey: 'storage_locked_required' }]]])}
                onFocusIssue={onFocusIssue}
                onAutoArrange={() => {}}
            />,
        );
        await click(container.querySelector('button[aria-expanded]'));
        expect(container.textContent).toContain('불화 소듐 · 잠금 없는 시약장');
        expect(container.textContent).toContain('잠글 수 있는 시약장에 따로 보관');
        expect(container.textContent).not.toContain('↔');
        expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent?.includes('자동'))).toBe(false);

        await click(Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('잠금 없는 시약장')));
        expect(onFocusIssue).toHaveBeenCalledWith(['toxic']);
        unmount();
    });
});
