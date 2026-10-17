import { describe, expect, it } from 'vitest';
import type { WasteContainerDeposit } from '../../services/wasteContainerService';
import {
    withDatabaseTotals,
    chooseDefaultContainer,
    formatMassMg,
    formatVolumeMl,
    sortContainers,
    summarizeContainer,
} from './containerSummary';

function deposit(overrides: Partial<WasteContainerDeposit>): WasteContainerDeposit {
    return {
        id: 'd',
        createdAt: '2026-10-01T00:00:00.000Z',
        handlerName: '김연구',
        memo: null,
        amountValue: 500,
        amountUnit: 'mL',
        amountIsApproximate: false,
        amountIsUnknown: false,
        voidedAt: null,
        items: [],
        ...overrides,
    };
}

describe('summarizeContainer', () => {
    it('merges the same chemical by CAS across deposits and keeps hazards in severity order', () => {
        const summary = summarizeContainer({ capacityMl: 4000 }, [
            deposit({
                id: 'a',
                createdAt: '2026-10-01T00:00:00.000Z',
                items: [{ lineNumber: 1, chemicalName: 'Acetone', casNumber: '67-64-1', hazardFlags: ['FLAMMABLE'], solutionVolumeMl: 300 }],
            }),
            deposit({
                id: 'b',
                createdAt: '2026-10-03T00:00:00.000Z',
                amountValue: 700,
                items: [
                    { lineNumber: 1, chemicalName: '아세톤', casNumber: '67-64-1', hazardFlags: ['FLAMMABLE'], solutionVolumeMl: 200 },
                    { lineNumber: 2, chemicalName: 'Methanol', casNumber: '67-56-1', hazardFlags: ['ACUTE_TOXIC', 'FLAMMABLE'], solutionVolumeMl: null },
                ],
            }),
        ]);

        expect(summary.depositCount).toBe(2);
        expect(summary.totalMl).toBe(1200);
        expect(summary.fillRatio).toBeCloseTo(0.3);
        expect(summary.firstDepositAt).toBe('2026-10-01T00:00:00.000Z');
        expect(summary.lastDepositAt).toBe('2026-10-03T00:00:00.000Z');
        expect(summary.components.map((c) => [c.chemicalName, c.depositCount, c.recordedVolumeMl])).toEqual([
            ['Acetone', 2, 500],
            ['Methanol', 1, null],
        ]);
        expect(summary.hazardFlags).toEqual(['ACUTE_TOXIC', 'FLAMMABLE']);
    });

    it('excludes voided deposits and flags missing amounts instead of guessing them', () => {
        const summary = summarizeContainer({ capacityMl: null }, [
            deposit({ id: 'a', amountValue: 1000 }),
            deposit({ id: 'b', voidedAt: '2026-10-02T00:00:00.000Z', amountValue: 9999 }),
            deposit({ id: 'c', amountIsUnknown: true, amountValue: null, amountUnit: null }),
            deposit({ id: 'd', amountValue: 2500, amountUnit: 'mg', amountIsApproximate: true }),
        ]);

        expect(summary.depositCount).toBe(3);
        expect(summary.voidedCount).toBe(1);
        expect(summary.totalMl).toBe(1000);
        expect(summary.totalMg).toBe(2500);
        expect(summary.hasUnknownAmounts).toBe(true);
        expect(summary.hasApproximateAmounts).toBe(true);
        expect(summary.fillRatio).toBeNull();
    });

    it('groups chemicals without a CAS by their name', () => {
        const summary = summarizeContainer({ capacityMl: null }, [
            deposit({ items: [{ lineNumber: 1, chemicalName: 'Buffer A ', casNumber: null, hazardFlags: [], solutionVolumeMl: 10 }] }),
            deposit({ items: [{ lineNumber: 1, chemicalName: 'buffer a', casNumber: '', hazardFlags: [], solutionVolumeMl: 5 }] }),
        ]);
        expect(summary.components).toHaveLength(1);
        expect(summary.components[0]).toMatchObject({ depositCount: 2, recordedVolumeMl: 15, casNumber: null });
    });
});

describe('summary merging and database totals', () => {
    it('merges a CAS-less row into the same chemical recorded with a CAS', () => {
        const summary = summarizeContainer({ capacityMl: null }, [
            deposit({ items: [{ lineNumber: 1, chemicalName: 'Acetone', casNumber: '67-64-1', hazardFlags: ['FLAMMABLE'], solutionVolumeMl: 100 }] }),
            deposit({ createdAt: '2026-10-05T00:00:00.000Z', items: [{ lineNumber: 1, chemicalName: 'acetone', casNumber: null, hazardFlags: [], solutionVolumeMl: 50 }] }),
        ]);
        expect(summary.components).toHaveLength(1);
        expect(summary.components[0]).toMatchObject({ casNumber: '67-64-1', depositCount: 2, recordedVolumeMl: 150, lastAt: '2026-10-05T00:00:00.000Z' });
    });

    it('prefers database totals over a partial deposit list', () => {
        const partial = summarizeContainer({ capacityMl: 20000 }, [deposit({ amountValue: 500 })]);
        const merged = withDatabaseTotals(partial, 20000, { depositCount: 1400, totalMl: 18000, hasUnknownAmounts: false });
        expect(merged).toMatchObject({ depositCount: 1400, totalMl: 18000, fillRatio: 0.9 });
        expect(withDatabaseTotals(partial, 20000, null)).toBe(partial);
    });
});

describe('container helpers', () => {
    it('orders active, sealed, then collected containers', () => {
        const sorted = sortContainers([
            { status: 'collected' as const, startedAt: '2026-10-05', label: 'C' },
            { status: 'active' as const, startedAt: '2026-09-01', label: 'A-old' },
            { status: 'sealed' as const, startedAt: '2026-10-01', label: 'S' },
            { status: 'active' as const, startedAt: '2026-10-02', label: 'A-new' },
        ]);
        expect(sorted.map((c) => c.label)).toEqual(['A-new', 'A-old', 'S', 'C']);
    });

    it('selects the only active container, keeps a still-valid choice, and never guesses between several', () => {
        expect(chooseDefaultContainer([{ id: 'x' }], null)).toBe('x');
        expect(chooseDefaultContainer([{ id: 'x' }, { id: 'y' }], null)).toBeNull();
        expect(chooseDefaultContainer([{ id: 'x' }, { id: 'y' }], 'y')).toBe('y');
        expect(chooseDefaultContainer([{ id: 'x' }, { id: 'y' }], 'gone')).toBeNull();
        expect(chooseDefaultContainer([], null)).toBeNull();
    });

    it('formats volumes and masses compactly', () => {
        expect(formatVolumeMl(850)).toBe('850 mL');
        expect(formatVolumeMl(12.25)).toBe('12.3 mL');
        expect(formatVolumeMl(4000)).toBe('4 L');
        expect(formatVolumeMl(4200)).toBe('4.2 L');
        expect(formatVolumeMl(12500)).toBe('12.5 L');
        expect(formatMassMg(2500)).toBe('2.5 g');
        expect(formatMassMg(300)).toBe('300 mg');
    });
});

describe('stream dot colors', async () => {
    const { wasteStreamDotClass, getCategoryColor } = await import('../../utils/wasteLabels');
    it('keeps non-halogenated organic orange and halogenated purple', () => {
        expect(wasteStreamDotClass('ORGANIC_NON_HALOGENATED')).toBe('bg-orange-500');
        expect(wasteStreamDotClass('ORGANIC_HALOGENATED')).toBe('bg-purple-500');
        expect(getCategoryColor('Non-halogenated organic waste')).toBe('bg-orange-500');
        expect(wasteStreamDotClass('ACID_AQUEOUS')).toBe('bg-red-500');
    });
});
