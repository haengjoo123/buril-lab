import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { translations } from '../locales/translations';
import type { WasteLogItemRecord, WasteLogRecord } from '../services/wasteLogService';

vi.mock('../services/supabaseClient', () => ({ supabase: {} }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ session: null }) }));

import { PhPredictionAuditPanel, WasteLogItemsPanel } from './WasteLogView';
import { AuditChangeList } from './AuditChangeList';

const i18n = createInstance();
await i18n.init({ lng: 'ko', resources: {
    ko: { translation: translations.ko }, en: { translation: translations.en },
} });
const render = (element: React.ReactNode) => renderToStaticMarkup(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>);
const baseLog: WasteLogRecord = {
    id: 'record', created_at: '2026-10-18T02:57:00Z', chemicals: [], disposal_category: 'REACTIVE',
};

describe('waste record details', () => {
    it('shows essential chemical and safety information without collection metadata', () => {
        const item: WasteLogItemRecord = {
            wasteLogId: 'record', cartLineId: 'line', sourceSearchEventId: null,
            inventoryItemId: null, cabinetItemId: null, concentrationUnit: null,
            solutionVolumeNormalizedMl: 100, solutionVolumeIsEstimate: false,
            concentrationBasis: null, densityUnit: null, densityKind: null,
            densityTemperatureC: null, densitySource: null, densityIsEstimate: false,
            createdAt: '2026-10-18T02:57:00Z',
            chemicalName: '소디움 아지드', casNumber: '26628-22-8', formula: 'N3Na',
            id: 'internal-item', lineNumber: 1, sourceType: 'search', sourceRef: 'internal-source',
            molecularWeight: 65.01, pubchemCid: 33557, koshaChemId: '892', identityConfidence: 1,
            ghsDataStatus: 'verified', solutionVolumeValue: 100, solutionVolumeUnit: 'mL',
            concentrationValue: null, densityValue: null, phCatalogId: 'internal-catalog',
            hazardFlags: ['CORROSIVE', 'ACUTE_TOXIC'],
            dataSources: [{ sourceType: 'pubchem', sourceRef: 'CID:33557', capturedAt: '2026-10-18T02:56:00Z' }],
            analysisSnapshot: { category: 'REACTIVE', reason: 'reason_unknown', ghs: { signal: 'Danger', hazardStatements: ['H300'] } },
        };
        const html = render(<WasteLogItemsPanel items={[item]} isLoading={false} error={null} onRetry={vi.fn()} onViewAudit={vi.fn()} />);
        for (const text of ['소디움 아지드', '26628-22-8', 'N3Na', '100 mL', '부식성', '급성독성', '확인됨', '분류 근거와 안전 정보']) {
            expect(html).toContain(text);
        }
        for (const text of ['PubChem', 'CID:', 'KOSHA', 'search', 'internal-', '식별 신뢰도', '데이터 출처', '2026-10-18', 'reason_unknown']) {
            expect(html).not.toContain(text);
        }
    });

    it('translates prediction reasons, hides versions, and ignores stale numbers in unsupported results', () => {
        const html = render(<PhPredictionAuditPanel log={{
            ...baseLog,
            confirmation_snapshot: { measuredBatchPh: 7.2 },
            ph_prediction_snapshot: {
                status: 'unsupported', value: 9.9,
                issueCodes: ['additional_components_unconfirmed', 'future_internal_issue'],
                modelVersion: 'buril-model-version', catalogVersion: 'buril-catalog-version',
            },
        }} />);
        expect(html).toContain('7.2');
        expect(html).toContain('계산 불가');
        expect(html).toContain(translations.ko.waste_ph_prediction_issue_additional_components_unconfirmed);
        expect(html).toContain(translations.ko.waste_ph_prediction_no_detail);
        for (const text of ['unsupported', '9.9', 'additional_components_unconfirmed', 'future_internal_issue', 'buril-']) expect(html).not.toContain(text);
    });

    it('distinguishes a valid prediction from a measurement and supports English', async () => {
        await i18n.changeLanguage('en');
        try {
            const html = render(<PhPredictionAuditPanel log={{ ...baseLog, ph_prediction_snapshot: {
                status: 'approximate', displayValue: 7.1, issueCodes: [],
            } }} />);
            expect(html).toContain('≈ 7.1');
            expect(html).toContain('Prediction (not measured)');
            expect(html).toContain('Not recorded');
        } finally {
            await i18n.changeLanguage('ko');
        }
    });

    it('renders readable shared history and no empty metadata-only detail block', () => {
        expect(render(<AuditChangeList diff={{ request_id: { from: null, to: 'internal-id' } }} />)).toBe('');
        const html = render(<AuditChangeList diff={{ remaining_percent: { from: 100, to: 50 }, memo: { from: null, to: '확인 완료' } }} />);
        expect(html).toContain('100%');
        expect(html).toContain('50%');
        expect(html).toContain('확인 완료');
        expect(html).not.toContain('remaining_percent');
        expect(html).not.toContain('&quot;');
    });
});
