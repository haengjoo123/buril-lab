import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildLabAdminTasks, type LabAdminContainerInput } from '../admin/labAdminTasks';
import { keepPickupState, normalizeWasteContainerRow, type WasteContainer } from '../../services/wasteContainerService';
import { ContainerPickupSection } from './ContainerPickupSection';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-13T03:00:00.000Z').getTime();

const row = {
    id: '11111111-1111-4111-8111-111111111111', lab_id: null, stream_code: 'ORGANIC_NON_HALOGENATED', label: '유기-1',
    location: null, capacity_ml: 20000, status: 'active', started_at: '2026-11-01T00:00:00.000Z', sealed_at: null,
    collected_at: null, collection_note: null, created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z',
};
const requested = { ...row, pickup_requested_at: '2026-11-10T00:00:00.000Z', pickup_request_note: '금요일 오전 가능' };

const render = (container: WasteContainer, language = 'ko') =>
    renderToStaticMarkup(<ContainerPickupSection container={container} language={language} onChanged={() => {}} />);

describe('pickup state on container rows', () => {
    it('leaves the pickup fields undefined when the row was read without the pickup columns', () => {
        const container = normalizeWasteContainerRow(row);
        expect('pickupRequestedAt' in container).toBe(false);
        expect(normalizeWasteContainerRow({ ...row, pickup_requested_at: null, pickup_request_note: null }))
            .toMatchObject({ pickupRequestedAt: null, pickupRequestNote: null });
        expect(normalizeWasteContainerRow(requested))
            .toMatchObject({ pickupRequestedAt: '2026-11-10T00:00:00.000Z', pickupRequestNote: '금요일 오전 가능' });
    });

    it('carries a known request over a row returned by an older RPC, except after collection', () => {
        const previous = normalizeWasteContainerRow(requested);
        const sealed = normalizeWasteContainerRow({ ...row, status: 'sealed', sealed_at: '2026-11-12T00:00:00.000Z' });
        expect(keepPickupState(previous, sealed)).toMatchObject({ status: 'sealed', pickupRequestedAt: '2026-11-10T00:00:00.000Z' });

        const collected = normalizeWasteContainerRow({ ...row, status: 'collected', collected_at: '2026-11-12T00:00:00.000Z' });
        expect(keepPickupState(previous, collected)).toMatchObject({ pickupRequestedAt: null, pickupRequestNote: null });

        const withdrawn = normalizeWasteContainerRow({ ...row, pickup_requested_at: null, pickup_request_note: null });
        expect(keepPickupState(previous, withdrawn).pickupRequestedAt).toBeNull();
    });
});

describe('ContainerPickupSection', () => {
    it('offers a request with an optional note when none is pending', () => {
        const html = render(normalizeWasteContainerRow({ ...row, pickup_requested_at: null, pickup_request_note: null }));
        expect(html).toContain('수거 요청');
        expect(html).toContain('maxLength="500"');
        expect(html).not.toContain('요청 취소');
    });

    it('shows a pending request with its note and a way to withdraw it', () => {
        const html = render(normalizeWasteContainerRow(requested));
        expect(html).toContain('수거 요청됨');
        expect(html).toContain('금요일 오전 가능');
        expect(html).toContain('요청 취소');
        expect(html).not.toContain('<input');
    });

    it('renders nothing for a collected container', () => {
        expect(render(normalizeWasteContainerRow({ ...row, status: 'collected', collected_at: '2026-11-12T00:00:00.000Z' }))).toBe('');
    });
});

describe('admin inbox pickup task', () => {
    const container = (overrides: Partial<LabAdminContainerInput>): LabAdminContainerInput => ({
        id: 'c1', label: 'Organic-1', streamCode: 'organic', status: 'active', location: null, sealedAt: null, fillRatio: 0,
        ...overrides,
    });

    it('shows a requested container at once and replaces its fill and sealed reminders', () => {
        const pickupRequestedAt = new Date(NOW - 3 * DAY).toISOString();
        const { active } = buildLabAdminTasks({
            wasteContainers: [
                container({ id: 'asked', pickupRequestedAt }),
                container({ id: 'asked-full', pickupRequestedAt, fillRatio: 1.2 }),
                container({ id: 'asked-sealed', pickupRequestedAt, status: 'sealed', sealedAt: new Date(NOW - 30 * DAY).toISOString() }),
                container({ id: 'quiet', pickupRequestedAt: null }),
                container({ id: 'flag-off' }),
            ],
        }, NOW);
        expect(active.map((task) => task.key).sort()).toEqual([
            'waste_container:asked-full:pickup',
            'waste_container:asked-sealed:pickup',
            'waste_container:asked:pickup',
        ]);
        const task = active[0];
        expect(task.kind === 'waste_container' && [task.reason, task.severity, task.pickupDays]).toEqual(['pickup', 'amber', 3]);
    });
});
