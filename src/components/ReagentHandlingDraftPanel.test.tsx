// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '../locales/translations';
import type { ReagentHandlingDraftLookup } from '../utils/reagentHandlingDraft';

const fetchReagentHandlingDraft = vi.fn<(cas?: string | null, name?: string | null) => Promise<ReagentHandlingDraftLookup>>();
vi.mock('../services/reagentHandlingDraftService', () => ({
    fetchReagentHandlingDraft: (cas?: string | null, name?: string | null) => fetchReagentHandlingDraft(cas, name),
}));

import { ReagentHandlingDraftPanel } from './ReagentHandlingDraftPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const i18n = createInstance();
await i18n.init({ lng: 'ko', resources: { ko: { translation: translations.ko }, en: { translation: translations.en } } });

async function render(props: { casNumber?: string | null; name?: string | null }) {
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
        root.render(<I18nextProvider i18n={i18n}><ReagentHandlingDraftPanel {...props} /></I18nextProvider>);
    });
    return { container, unmount: () => act(() => root.unmount()) };
}

describe('ReagentHandlingDraftPanel', () => {
    afterEach(() => fetchReagentHandlingDraft.mockReset());

    it('labels unreviewed AI text as a draft in its own section', async () => {
        fetchReagentHandlingDraft.mockResolvedValue({ status: 'found', draft: {
            name: '디클로로메탄', reviewStatus: 'unreviewed',
            handling: { ppe: ['PVA 장갑'], firstAid: { inhalation: '신선한 공기', noteToPhysician: 'COHb 반복 측정' }, spillSmall: '흡착패드' },
            storage: { temp: '실온', lightSensitive: true },
        } });
        const view = await render({ casNumber: '75-09-2' });
        const text = view.container.textContent || '';
        expect(text).toContain('취급 요약');
        expect(text).toContain('AI 초안 · 검토 전');
        expect(text).toContain('PVA 장갑');
        expect(text).toContain('의료진 전달사항');
        expect(text).toContain('빛 차단');
        expect(text).not.toContain('검토됨');
        expect(fetchReagentHandlingDraft).toHaveBeenCalledWith('75-09-2', undefined);
        view.unmount();
    });

    it('shows the reviewed badge for a verified draft', async () => {
        fetchReagentHandlingDraft.mockResolvedValue({ status: 'found', draft: {
            name: 'x', reviewStatus: 'verified', handling: { keyCautions: ['주의'] }, storage: {},
        } });
        const view = await render({ name: '염화메틸렌' });
        expect(view.container.textContent).toContain('검토됨');
        expect(view.container.textContent).not.toContain('AI 초안 · 검토 전');
        view.unmount();
    });

    it('renders nothing without a single matching draft', async () => {
        fetchReagentHandlingDraft.mockResolvedValue({ status: 'not_found' });
        const view = await render({ casNumber: '9036-19-5' });
        expect(view.container.innerHTML).toBe('');
        view.unmount();
    });
});
