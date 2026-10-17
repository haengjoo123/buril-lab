// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { WasteContainer } from '../../services/wasteContainerService';
import { summarizeContainer } from './containerSummary';
import { buildContainerLabelModel, LABEL_MAX_COMPONENTS, renderContainerLabelElement } from './containerLabel';

const container: WasteContainer = {
    id: '11111111-1111-4111-8111-111111111111',
    labId: '22222222-2222-4222-8222-222222222222',
    streamCode: 'ORGANIC_NON_HALOGENATED',
    label: '유기-1',
    location: 'B동 202호 후드 옆',
    capacityMl: 20000,
    status: 'active',
    startedAt: '2026-10-01T09:00:00+09:00',
    sealedAt: null,
    collectedAt: null,
    collectionNote: null,
    createdAt: '2026-10-01T09:00:00+09:00',
    updatedAt: '2026-10-01T09:00:00+09:00',
};

const summary = summarizeContainer(container, [{
    id: 'd1', createdAt: '2026-10-02T00:00:00.000Z', handlerName: null, memo: null,
    amountValue: 5000, amountUnit: 'mL', amountIsApproximate: true, amountIsUnknown: false, voidedAt: null,
    items: [{ lineNumber: 1, chemicalName: 'Acetone', casNumber: '67-64-1', hazardFlags: ['FLAMMABLE'], solutionVolumeMl: 5000 }],
}]);

describe('buildContainerLabelModel', () => {
    it('fills the Korean label from records, policy contact and prohibitions', () => {
        const model = buildContainerLabelModel(container, summary, {
            language: 'ko',
            labName: '식품공학연구실',
            handlerContact: '안전관리팀 055-000-0000',
            prohibitions: ['산성 폐액과 혼합 금지', '다른 분류의 폐액이나 미확인 물질과 섞지 마세요.'],
            printedAt: new Date(2026, 9, 17),
        });

        expect(model.heading).toBe('폐액통 내용 기록표');
        expect(model.footer).toContain('법정 지정폐기물 보관 표지를 대신하지 않으므로');
        expect(model.streamName).toBe('비할로겐 유기 폐액');
        expect(model.rows).toEqual(expect.arrayContaining([
            { label: '보관 위치', value: 'B동 202호 후드 옆' },
            { label: '용량', value: '20 L' },
            { label: '기록된 투입량', value: '5 L (25%) · 추정치 포함' },
            { label: '담당 연락처', value: '안전관리팀 055-000-0000' },
            { label: '출력일', value: '2026-10-17' },
        ]));
        expect(model.rows.some((row) => row.label === '봉인일')).toBe(false);
        expect(model.components).toEqual([['Acetone', '67-64-1', '1회', '5 L']]);
        expect(model.hazards).toEqual(['인화성']);
        expect(model.cautions[0]).toBe('산성 폐액과 혼합 금지');
        expect(model.cautions.filter((c) => c.startsWith('다른 분류의 폐액'))).toHaveLength(1);
        expect(model.fileName).toBe('폐액통_내용기록표_유기-1_2026-10-17.pdf');
        expect(model.partialNote).toBeNull();
    });

    it('marks sealed containers and truncates long component lists', () => {
        const many = summarizeContainer(container, [{
            id: 'd', createdAt: '2026-10-02T00:00:00.000Z', handlerName: null, memo: null,
            amountValue: null, amountUnit: null, amountIsApproximate: false, amountIsUnknown: true, voidedAt: null,
            items: Array.from({ length: LABEL_MAX_COMPONENTS + 3 }, (_, i) => ({
                lineNumber: i + 1, chemicalName: `Chemical ${i}`, casNumber: null, hazardFlags: [], solutionVolumeMl: null,
            })),
        }]);
        const model = buildContainerLabelModel({ ...container, status: 'sealed', sealedAt: '2026-10-10T00:00:00Z' }, many, {
            language: 'en', labName: null, handlerContact: null, prohibitions: [], printedAt: new Date(2026, 9, 17), partialContents: true,
        });
        expect(model.partialNote).toContain('part of a long deposit history');
        expect(model.statusText).toBe('Sealed — no further deposits');
        expect(model.components).toHaveLength(LABEL_MAX_COMPONENTS);
        expect(model.hiddenComponentCount).toBe(3);
        expect(model.rows.find((row) => row.label === 'Recorded volume')?.value).toBe('includes deposits without an amount');
        expect(model.hazards).toEqual(['No hazard information recorded in the app — check the contents directly']);
    });
});

describe('renderContainerLabelElement', () => {
    it('renders record text as text, never as markup', () => {
        const model = buildContainerLabelModel({ ...container, label: '<img src=x onerror=alert(1)>' }, summary, {
            language: 'ko', labName: null, handlerContact: null, prohibitions: [], printedAt: new Date(2026, 9, 17),
        });
        const node = renderContainerLabelElement(model);
        expect(node.querySelector('img')).toBeNull();
        expect(node.textContent).toContain('<img src=x onerror=alert(1)>');
        expect(node.querySelectorAll('tr').length).toBeGreaterThan(model.rows.length);
    });
});
