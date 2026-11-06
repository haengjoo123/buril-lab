import { describe, expect, it } from 'vitest';
import type { WasteLogRecord } from '../services/wasteLogService';
import {
    findJustRecordedLogId,
    formatVolumeMl,
    getMostRecentSectionKey,
    getWasteChemicalNames,
    groupWasteLogsByAge,
    shortWasteStreamLabel,
    summarizeChemicalNames,
} from './wasteLogDisplay';

const NOW = new Date(2026, 10, 6, 10, 0, 0).getTime();
const t = (key: string, options?: Record<string, unknown>) => `${key}:${String(options?.count ?? '')}`;

function log(overrides: Partial<WasteLogRecord>): WasteLogRecord {
    return {
        id: 'log',
        created_at: new Date(NOW - 5 * 60 * 1000).toISOString(),
        chemicals: [],
        disposal_category: '비할로겐 유기 폐액',
        ...overrides,
    };
}

describe('waste log display helpers', () => {
    it('reads V2 and legacy component names once, in recorded order', () => {
        const names = getWasteChemicalNames([
            { chemicalName: 'Acetone' },
            { chemical: { name: 'Methanol' } },
            { chemicalName: 'Acetone' },
            { name: ' Toluene ' },
            {},
        ] as unknown[]);
        expect(names).toEqual(['Acetone', 'Methanol', 'Toluene']);
        expect(summarizeChemicalNames(names, 2)).toEqual({ text: 'Acetone + Methanol', extra: 1 });
        expect(summarizeChemicalNames([], 2)).toEqual({ text: '', extra: 0 });
    });

    it('excludes corrected records from group counts and volumes but keeps them listed', () => {
        const sections = groupWasteLogsByAge([
            log({ id: 'a', total_volume_ml: 300 }),
            log({ id: 'b', total_volume_ml: 150 }),
            log({ id: 'voided', total_volume_ml: 200, voided_at: new Date(NOW).toISOString() }),
        ], 'desc', t, 'ko', NOW);

        expect(sections).toHaveLength(1);
        expect(sections[0].logs.map((entry) => entry.id)).toHaveLength(3);
        expect(sections[0].activeCount).toBe(2);
        expect(sections[0].totalVolumeMl).toBe(450);
        expect(sections[0].subtitle).toBe('log_group_day_count:2');
    });

    it('opens the most recent group regardless of sort order', () => {
        const older = log({ id: 'old', created_at: new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString() });
        const newer = log({ id: 'new' });
        const ascending = groupWasteLogsByAge([older, newer], 'asc', t, 'ko', NOW);
        expect(ascending[0].logs[0].id).toBe('old');
        expect(getMostRecentSectionKey(ascending)).toBe(ascending[1].key);
        expect(getMostRecentSectionKey([])).toBeNull();
    });

    it('finds the newest active record by the current user within the last minute', () => {
        const logs = [
            log({ id: 'mine-older', user_id: 'me', created_at: new Date(NOW - 50 * 1000).toISOString() }),
            log({ id: 'mine-newest', user_id: 'me', created_at: new Date(NOW - 10 * 1000).toISOString() }),
            log({ id: 'someone-else', user_id: 'other', created_at: new Date(NOW - 5 * 1000).toISOString() }),
            log({ id: 'voided', user_id: 'me', created_at: new Date(NOW - 2 * 1000).toISOString(), voided_at: new Date(NOW).toISOString() }),
            log({ id: 'too-old', user_id: 'me', created_at: new Date(NOW - 5 * 60 * 1000).toISOString() }),
        ];
        expect(findJustRecordedLogId(logs, 'me', NOW)).toBe('mine-newest');
        expect(findJustRecordedLogId([logs[4]], 'me', NOW)).toBeNull();
    });

    it('formats compact stream labels and group volumes', () => {
        expect(shortWasteStreamLabel('ORGANIC_NON_HALOGENATED', 'ko')).toBe('비할로겐');
        expect(shortWasteStreamLabel('ORGANIC_NON_HALOGENATED', 'en')).toBe('Non-halogenated');
        expect(shortWasteStreamLabel(null, 'ko')).toBeNull();
        expect(shortWasteStreamLabel('NOT_A_STREAM', 'ko')).toBeNull();
        expect(formatVolumeMl(0.1 + 0.2, 'en')).toBe('0.3 mL');
        expect(formatVolumeMl(1250, 'ko')).toBe('1,250 mL');
    });
});
