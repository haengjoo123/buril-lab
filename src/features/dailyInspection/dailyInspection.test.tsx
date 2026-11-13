import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { normalizeDailyInspectionRow, toDailyInspectionError } from '../../services/dailyInspectionService';
import { CHECKLIST_VERSION, INSPECTION_ITEM_IDS, INSPECTION_SECTIONS } from './checklist';
import { DailyInspectionPanel } from './DailyInspectionPanel';
import {
    buildInspectionDays,
    fillUnansweredAsOk,
    kstDateString,
    normalizeInspectionResults,
    recentKstDates,
    setSectionResult,
    summarizeInspection,
} from './inspectionSummary';

describe('daily inspection checklist', () => {
    it('has unique item ids the database accepts, and a version it accepts', () => {
        expect(new Set(INSPECTION_ITEM_IDS).size).toBe(INSPECTION_ITEM_IDS.length);
        expect(INSPECTION_ITEM_IDS.length).toBeLessThanOrEqual(80);
        for (const id of INSPECTION_ITEM_IDS) expect(id).toMatch(/^[a-z0-9_]{1,40}$/);
        expect(CHECKLIST_VERSION).toMatch(/^[a-z0-9-]{1,40}$/);
        for (const section of INSPECTION_SECTIONS) {
            expect(section.items.length).toBeGreaterThan(0);
            for (const item of section.items) {
                expect(item.id.startsWith(`${section.id}_`)).toBe(true);
                expect(item.ko.trim() && item.en.trim()).toBeTruthy();
            }
        }
    });
});

describe('inspection day and progress', () => {
    it('uses the Korean calendar day whatever the device time zone', () => {
        // 2026-11-12 15:30 UTC is already 2026-11-13 in Korea.
        const lateUtc = Date.UTC(2026, 10, 12, 15, 30);
        expect(kstDateString(lateUtc)).toBe('2026-11-13');
        expect(kstDateString(Date.UTC(2026, 10, 12, 14, 59))).toBe('2026-11-12');
        expect(recentKstDates(3, lateUtc)).toEqual(['2026-11-13', '2026-11-12', '2026-11-11']);
    });

    it('requires every item before an inspection is complete and counts issues', () => {
        expect(summarizeInspection({})).toMatchObject({ answered: 0, issues: 0, complete: false });
        const partial = setSectionResult({}, 'gas', 'na');
        expect(summarizeInspection(partial).answered).toBe(INSPECTION_SECTIONS.find((section) => section.id === 'gas')!.items.length);
        const filled = fillUnansweredAsOk({ ...partial, chemical_waste: 'bad' });
        expect(filled.chemical_waste).toBe('bad');
        expect(filled.gas_storage).toBe('na');
        expect(summarizeInspection(filled)).toMatchObject({ answered: INSPECTION_ITEM_IDS.length, issues: 1, missing: [], complete: true });
    });

    it('drops unknown values from stored results', () => {
        expect(normalizeInspectionResults({ general_tidy: 'ok', fire_exit: 'broken', gas_storage: 3 })).toEqual({ general_tidy: 'ok' });
        expect(normalizeInspectionResults(['ok'])).toEqual({});
        expect(normalizeInspectionResults(null)).toEqual({});
    });

    it('shows days without a record as missing', () => {
        expect(buildInspectionDays(['2026-11-13', '2026-11-12', '2026-11-11'], [
            { inspectionDate: '2026-11-13', issueCount: 0 },
            { inspectionDate: '2026-11-11', issueCount: 2 },
        ])).toEqual([
            { date: '2026-11-13', status: 'done', issueCount: 0 },
            { date: '2026-11-12', status: 'missing', issueCount: 0 },
            { date: '2026-11-11', status: 'issues', issueCount: 2 },
        ]);
    });
});

describe('daily inspection service mapping', () => {
    it('normalizes a row and rejects an incomplete one', () => {
        expect(normalizeDailyInspectionRow({
            id: 'a', lab_id: 'b', inspection_date: '2026-11-13T00:00:00.000Z', checklist_version: 'kr-daily-v1',
            results: { general_tidy: 'ok', x: 'nope' }, issue_count: '2', note: '', inspector_name: '김연구', updated_at: 't',
        })).toEqual({
            id: 'a', labId: 'b', inspectionDate: '2026-11-13', checklistVersion: 'kr-daily-v1',
            results: { general_tidy: 'ok' }, issueCount: 2, note: null, inspectorName: '김연구', updatedAt: 't',
        });
        expect(() => normalizeDailyInspectionRow({ id: 'a' })).toThrow();
    });

    it('maps database errors to stable codes', () => {
        expect(toDailyInspectionError({ message: 'DAILY_INSPECTION_ACCESS_DENIED' }).code).toBe('access_denied');
        expect(toDailyInspectionError({ message: 'DAILY_INSPECTION_INVALID_INPUT' }).code).toBe('invalid_input');
        expect(toDailyInspectionError(new Error('network down')).code).toBe('unknown');
    });
});

describe('DailyInspectionPanel', () => {
    it('explains that inspections need a lab in the personal space', () => {
        const html = renderToStaticMarkup(<DailyInspectionPanel labId={null} language="ko" />);
        expect(html).toContain('연구실 공간에서 기록합니다');
        expect(html).not.toContain('role="radiogroup"');
    });

    it('shows a loading state before records arrive', () => {
        const html = renderToStaticMarkup(<DailyInspectionPanel labId="11111111-1111-4111-8111-111111111111" language="en" />);
        expect(html).toContain('Loading inspection records.');
    });

    it('renders every checklist item with three choices and blocks saving until all are answered', () => {
        const html = renderToStaticMarkup(
            <DailyInspectionPanel labId="11111111-1111-4111-8111-111111111111" language="ko" initialRecords={[]} />,
        );
        expect(html.match(/role="radiogroup"/g)).toHaveLength(INSPECTION_ITEM_IDS.length);
        expect(html.match(/role="radio"/g)).toHaveLength(INSPECTION_ITEM_IDS.length * 3);
        expect(html).toContain('오늘 점검이 아직 기록되지 않았습니다.');
        expect(html).toContain('남은 항목 모두 양호');
        expect(html).toMatch(/<button type="button" disabled=""[^>]*>점검 기록 저장<\/button>/);
        expect(html).toContain('14일 중 0일 기록');
    });

    it('opens on the record already saved today so a second save edits it', () => {
        const today = kstDateString();
        const results = fillUnansweredAsOk({ chemical_waste: 'bad' });
        const html = renderToStaticMarkup(
            <DailyInspectionPanel
                labId="11111111-1111-4111-8111-111111111111"
                language="ko"
                initialRecords={[{
                    id: 'r1', labId: 'l1', inspectionDate: today, checklistVersion: CHECKLIST_VERSION, results,
                    issueCount: 1, note: '덮개 교체 요청', inspectorName: '김연구', updatedAt: '',
                }]}
            />,
        );
        expect(html).toContain('오늘 점검 완료 · 불량 1건');
        expect(html).toContain('오늘 기록 수정');
        expect(html).toContain('덮개 교체 요청');
        expect(html).not.toContain('남은 항목 모두 양호');
        expect(html.match(/aria-checked="true"/g)).toHaveLength(INSPECTION_ITEM_IDS.length);
        expect(html).toContain('14일 중 1일 기록');
    });
});
