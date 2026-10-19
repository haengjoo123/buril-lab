import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import { translations } from '../locales/translations';
import { getAuditChangeRows, getAuditDetailSections } from './auditLogFormatting';
import { hazardFlagLabel, wasteStreamLabel } from './wasteLabels';

const i18n = createInstance();
await i18n.init({ lng: 'ko', resources: { ko: { translation: translations.ko } } });

describe('user-facing activity history', () => {
    it('keeps readable changes and hides internal fields, snapshots, and identifiers', () => {
        const diff = {
            quantity: { from: 2, to: 1 },
            remaining_percent: { from: 80, to: 50 },
            storage_type: { from: 'cabinet', to: 'other' },
            memo: { from: '기존 메모', to: '새 메모' },
            updated_at: { from: '2026-10-17', to: '2026-10-18' },
            request_id: { from: null, to: 'internal-request' },
            analysis_snapshot: { from: {}, to: { internal: 'secret' } },
            future_internal_field: { from: 'raw_code', to: 'raw_code_2' },
            cabinet_id: { from: null, to: 'edb1c829-6064-4fd9-a7dc-e03a05a6653b' },
        };
        const rows = getAuditChangeRows({ diff_data: diff }, i18n.t, 'ko');
        expect(rows.map((row) => row.key)).toEqual(['quantity', 'remaining_percent', 'storage_type', 'memo']);
        expect(rows[0]).toMatchObject({ label: '수량', fromText: '2', toText: '1' });
        expect(rows[1]).toMatchObject({ fromText: '80%', toText: '50%' });
        expect(rows[2].fromText).not.toBe('cabinet');
        expect(rows[3].toText).toBe('새 메모');
        const sections = getAuditDetailSections({ before_data: null, after_data: Object.fromEntries(
            Object.entries(diff).map(([key, value]) => [key, value.to]),
        ) }, i18n.t, 'ko');
        expect(sections[0].rows.map((row) => row.key)).toEqual(rows.map((row) => row.key));
    });

    it('translates container states and never treats an unknown state as collected', () => {
        const rows = getAuditChangeRows({ diff_data: {
            status: { from: 'active', to: 'future_status' },
            stream_code: { from: 'ACID_AQUEOUS', to: 'SPECIAL_REVIEW' },
        } }, i18n.t, 'ko');
        expect(rows.find((row) => row.key === 'status')?.toText).toBe('알 수 없음');
        expect(rows.find((row) => row.key === 'stream_code')?.toText).toBe('분리 보관·특별 검토');
    });

    it('keeps a review notice for unknown hazard and waste classification codes', () => {
        expect(hazardFlagLabel('NEW_HAZARD', 'ko')).toBe('추가 위험 정보 확인 필요');
        expect(wasteStreamLabel('NEW_STREAM', 'ko')).toBe('분류 확인 필요');
        expect(hazardFlagLabel('CORROSIVE', 'en')).toBe('Corrosive');
    });
});
