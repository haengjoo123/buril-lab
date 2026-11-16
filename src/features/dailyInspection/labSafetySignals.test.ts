import { describe, expect, it } from 'vitest';
import { buildLabAdminTasks } from '../admin/labAdminTasks';
import { inspectionCopy } from './copy';
import {
    buildInspectionHints,
    missingInspectionWeekdays,
    summarizeCabinetLocks,
    type LabCabinetItemInput,
    type LabCabinetLockInput,
} from './labSafetySignals';

// Monday 2026-11-16, 10:00 KST.
const NOW = Date.UTC(2026, 10, 16, 1);

const cabinets: LabCabinetLockInput[] = [
    { id: 'open-shelf', name: '공용 선반', locked: false },
    { id: 'acid', name: '산 시약장', locked: null },
    { id: 'safe', name: '독성 시약장', locked: true },
    { id: 'solvents', name: '용매 시약장', locked: false },
];
const items: LabCabinetItemInput[] = [
    // Fatal acute toxicity (H300/H310/H330) is the trusted toxic group; H301 alone is left to the 화관법 lookup.
    { cabinetId: 'open-shelf', name: '플루오로아세트산 소듐', hCodes: ['H300'], casNo: '62-74-8', ghsStatus: 'success' },
    { cabinetId: 'open-shelf', name: '불화 소듐', hCodes: ['H301'], casNo: '7681-49-4', ghsStatus: 'success' },
    { cabinetId: 'open-shelf', name: '벤젠', hCodes: ['H225', 'H350'], casNo: '71-43-2', ghsStatus: 'success' },
    { cabinetId: 'acid', name: '포르말린', hCodes: ['H301', 'H350'], casNo: '50-00-0', ghsStatus: 'success' },
    { cabinetId: 'safe', name: '시안화 칼륨', hCodes: ['H300'], casNo: '151-50-8', ghsStatus: 'success' },
    { cabinetId: 'solvents', name: '아세톤', hCodes: ['H225'], casNo: '67-64-1', ghsStatus: 'success' },
];

describe('summarizeCabinetLocks', () => {
    it('groups lock-requiring reagents by cabinets without a lock and cabinets not recorded yet', () => {
        expect(summarizeCabinetLocks(cabinets, items)).toEqual({
            unlocked: [{ cabinetId: 'open-shelf', cabinetName: '공용 선반', count: 2 }],
            unset: [{ cabinetId: 'acid', cabinetName: '산 시약장', count: 1 }],
        });
    });

    it('counts 화관법 lock duties when the lookup supplies them', () => {
        const summary = summarizeCabinetLocks(cabinets, items, (cas) => cas === '67-64-1');
        expect(summary.unlocked.map((group) => [group.cabinetId, group.count])).toEqual([['open-shelf', 2], ['solvents', 1]]);
    });
});

describe('missingInspectionWeekdays', () => {
    it('lists weekdays of the last 7 days without a record, leaving out weekends and today', () => {
        expect(missingInspectionWeekdays([{ inspectionDate: '2026-11-12' }, { inspectionDate: '2026-11-16' }], NOW))
            .toEqual(['2026-11-13', '2026-11-11', '2026-11-10', '2026-11-09']);
        expect(missingInspectionWeekdays(['09', '10', '11', '12', '13'].map((day) => ({ inspectionDate: `2026-11-${day}` })), NOW)).toEqual([]);
    });
});

describe('buildInspectionHints', () => {
    const copy = inspectionCopy('ko').hints;

    it('points the locked-storage item at the first unlocked cabinet and the waste item at the containers', () => {
        const hints = buildInspectionHints({ cabinetLocks: summarizeCabinetLocks(cabinets, items), containerAttentionCount: 2 }, copy);
        expect(hints.chemical_toxic).toEqual({
            count: 2,
            text: '잠금장치 없는 시약장에 독성·발암성 물질 2개',
            target: { kind: 'cabinet', cabinetId: 'open-shelf' },
        });
        expect(hints.chemical_waste).toMatchObject({ count: 2, target: { kind: 'containers' } });
        expect(Object.keys(hints).sort()).toEqual(['chemical_toxic', 'chemical_waste']);
    });

    it('asks for the lock setting when no cabinet is recorded as unlocked, and stays silent without data', () => {
        const unsetOnly = summarizeCabinetLocks(cabinets.filter((cabinet) => cabinet.locked !== false), items);
        expect(buildInspectionHints({ cabinetLocks: unsetOnly }, copy).chemical_toxic?.text)
            .toBe('독성·발암성 물질이 있는 시약장 1개의 잠금 여부가 기록되지 않았어요');
        expect(buildInspectionHints({ cabinetLocks: { unlocked: [], unset: [] }, containerAttentionCount: 0 }, copy)).toEqual({});
        expect(buildInspectionHints({}, copy)).toEqual({});
    });
});

describe('admin cards from the same signals', () => {
    it('shows a missed-inspection card from two missed weekdays, keyed by the count', () => {
        const none = buildLabAdminTasks({ dailyInspections: ['09', '10', '11', '13'].map((day) => ({ inspectionDate: `2026-11-${day}` })) }, NOW);
        expect(none.active).toEqual([]);

        const { active } = buildLabAdminTasks({ dailyInspections: [{ inspectionDate: '2026-11-12' }] }, NOW);
        expect(active).toEqual([expect.objectContaining({
            kind: 'daily_inspection_missing', key: 'daily_inspection_missing:4', severity: 'amber',
            missingDates: ['2026-11-13', '2026-11-11', '2026-11-10', '2026-11-09'],
        })]);
    });

    it('prefers cabinets recorded without a lock over unset ones', () => {
        const [unlocked] = buildLabAdminTasks({ cabinetLocks: summarizeCabinetLocks(cabinets, items) }, NOW).active;
        expect(unlocked).toMatchObject({
            kind: 'cabinet_locks', reason: 'unlocked', cabinetId: 'open-shelf', cabinetCount: 1, reagentCount: 2, severity: 'amber',
        });

        const [unset] = buildLabAdminTasks({ cabinetLocks: { unlocked: [], unset: [{ cabinetId: 'acid', cabinetName: '산 시약장', count: 3 }] } }, NOW).active;
        expect(unset).toMatchObject({ kind: 'cabinet_locks', reason: 'unset', key: 'cabinet_locks:unset:1:3' });

        expect(buildLabAdminTasks({ cabinetLocks: { unlocked: [], unset: [] } }, NOW).active).toEqual([]);
    });
});
