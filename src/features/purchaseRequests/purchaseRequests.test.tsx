// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forecastStock, productKeyOf, type ForecastItem, type UsageCount } from './stockForecast';
import { PurchaseRequestsDialog } from './PurchaseRequestsDialog';
import { adminActionsFor } from './purchaseFlow';
import { buildLabAdminTasks } from '../admin/labAdminTasks';
import { normalizePurchaseRequest, toPurchaseError } from '../../services/purchaseRequestService';

const service = vi.hoisted(() => ({
    fetchUsageCounts: vi.fn(),
    listPurchaseRequests: vi.fn(),
    createPurchaseRequest: vi.fn(),
    updatePurchaseRequest: vi.fn(),
}));

vi.mock('../../services/purchaseRequestService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/purchaseRequestService')>()),
    ...service,
}));

const item = (overrides: Partial<ForecastItem> & { id: string }): ForecastItem => ({
    name: 'Acetone',
    brand: null,
    product_number: null,
    cas_number: '67-64-1',
    quantity: 1,
    capacity: '500 mL',
    remaining_percent: null,
    ...overrides,
});

const usage = (entries: Array<[string, number]>) =>
    new Map<string, UsageCount>(entries.map(([id, usedCount]) => [id, { usedCount, lastUsedAt: null }]));

describe('stock forecast', () => {
    it('pools rows of one product and estimates days left from the recent pace', () => {
        // 2 rows of acetone: 2 sealed + an open one at 50% = 2.5 bottles; 9 used in 180 days = 0.05 a day.
        const forecasts = forecastStock(
            [item({ id: 'a', quantity: 2, remaining_percent: 50 }), item({ id: 'b', cas_number: ' 67-64-1 ', name: 'Acetone HPLC' })],
            usage([['a', 6], ['b', 3]]),
        );
        expect(forecasts).toHaveLength(1);
        expect(forecasts[0]).toMatchObject({ bottles: 3, onHand: 2.5, usedInWindow: 9, daysLeft: 50, level: 'soon', reason: 'pace', itemIds: ['a', 'b'] });
        // 90 days at 0.05 a day is 4.5 bottles, minus 2.5 on hand.
        expect(forecasts[0].suggestedQuantity).toBe(2);
    });

    it('flags a last bottle by its remaining percent, and leaves well stocked products out', () => {
        const forecasts = forecastStock([
            item({ id: 'low', name: 'Toluene', cas_number: '108-88-3', remaining_percent: 15 }),
            item({ id: 'soon', name: 'Hexane', cas_number: null, product_number: 'H-1', brand: 'Sigma', remaining_percent: 35 }),
            item({ id: 'fine', name: 'Ethanol', cas_number: '64-17-5', remaining_percent: 80 }),
            item({ id: 'stocked', name: 'Methanol', cas_number: '67-56-1', quantity: 4 }),
        ], usage([['stocked', 1]]));
        expect(forecasts.map((forecast) => [forecast.name, forecast.level, forecast.reason, forecast.lastBottlePercent])).toEqual([
            ['Toluene', 'low', 'last_bottle', 15],
            ['Hexane', 'soon', 'last_bottle', 35],
        ]);
        expect(forecasts[0].suggestedQuantity).toBe(1);
    });

    it('keys products by CAS, then brand and product number, then name', () => {
        expect(productKeyOf({ name: 'A', brand: 'X', product_number: 'P', cas_number: '1-11-1' })).toBe('cas:1-11-1');
        expect(productKeyOf({ name: 'A', brand: ' Sigma ', product_number: 'P1', cas_number: null })).toBe('pn:sigma|p1');
        expect(productKeyOf({ name: '  Buffer   A ', brand: null, product_number: null, cas_number: '' })).toBe('name:buffer a');
    });
});

describe('purchase request helpers', () => {
    it('maps database errors and rows', () => {
        expect(toPurchaseError({ message: 'PURCHASE_REQUEST_ADMIN_REQUIRED' }).code).toBe('admin_required');
        expect(toPurchaseError(new Error('PURCHASE_REQUEST_INVALID_TRANSITION')).code).toBe('invalid_transition');
        expect(toPurchaseError('boom').code).toBe('unknown');
        expect(normalizePurchaseRequest({ id: 'r', lab_id: 'l', item_name: 'Acetone', quantity: '3', status: 'odd' }))
            .toMatchObject({ id: 'r', quantity: 3, status: 'requested', note: null });
        expect(() => normalizePurchaseRequest({ id: 'r' })).toThrow();
        expect(adminActionsFor('requested')).toEqual(['approved', 'rejected']);
        expect(adminActionsFor('ordered')).toEqual(['received', 'cancelled']);
        expect(adminActionsFor('received')).toEqual([]);
    });

    it('adds one amber inbox card for undecided requests', () => {
        const now = Date.UTC(2026, 10, 13, 3);
        const { active } = buildLabAdminTasks({
            purchaseRequests: [
                { id: 'b', createdAt: new Date(now - 3 * 86_400_000).toISOString() },
                { id: 'a', createdAt: new Date(now - 86_400_000).toISOString() },
            ],
        }, now);
        expect(active).toEqual([expect.objectContaining({ kind: 'purchase_request', severity: 'amber', count: 2, oldestDays: 3 })]);
        expect(buildLabAdminTasks({ purchaseRequests: [] }, now).active).toEqual([]);
    });
});

const LAB = 'lab-1';
const request = (overrides: Record<string, unknown>) => normalizePurchaseRequest({
    id: 'r1', lab_id: LAB, item_name: 'Toluene', quantity: 1, status: 'requested',
    requested_by: 'student', requester_name: 'Kim', created_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-12T00:00:00Z',
    ...overrides,
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

async function mount(element: React.ReactElement) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root!.render(element);
    });
    await act(async () => undefined);
}

function unmount() {
    act(() => root?.unmount());
    root = null;
    container?.remove();
}

const byText = (text: string): HTMLElement | null =>
    Array.from(container.querySelectorAll<HTMLElement>('p,span,li,button,h2,h3')).find((node) => node.textContent?.trim() === text) ?? null;
const hasText = (text: string) => (container.textContent ?? '').includes(text);
const button = (name: string) => Array.from(container.querySelectorAll('button')).find((node) => node.textContent?.trim() === name) ?? null;
const inputLabelled = (label: string) => {
    const labelNode = Array.from(container.querySelectorAll('label')).find((node) => node.textContent?.startsWith(label));
    return (labelNode?.querySelector('input,textarea') ?? container.querySelector(`[aria-label="${label}"]`)) as HTMLInputElement;
};
const click = async (node: Element | null) => {
    expect(node).toBeTruthy();
    await act(async () => {
        (node as HTMLElement).click();
    });
    await act(async () => undefined);
};
const type = async (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
};

describe('purchase requests dialog', () => {
    beforeEach(() => {
        Object.values(service).forEach((fn) => fn.mockReset());
        service.fetchUsageCounts.mockResolvedValue(new Map());
    });
    afterEach(unmount);

    it('turns a low-stock row into a prefilled request', async () => {
        service.listPurchaseRequests.mockResolvedValue([]);
        service.createPurchaseRequest.mockImplementation(async (_lab: string, input: { itemName: string; quantity: number; sourceInventoryId: string | null }) =>
            request({ id: 'new', item_name: input.itemName, quantity: input.quantity, source_inventory_id: input.sourceInventoryId }));
        await mount(<PurchaseRequestsDialog
            items={[item({ id: 'tol', name: 'Toluene', cas_number: '108-88-3', remaining_percent: 10 })]}
            labId={LAB} userId="student" isAdmin={false} language="ko" onClose={() => undefined} />);

        expect(hasText('마지막 병 10% 남음')).toBe(true);
        await click(button('구매 요청'));
        expect(inputLabelled('시약 이름').value).toBe('Toluene');
        expect(inputLabelled('CAS 번호').value).toBe('108-88-3');
        await click(button('요청 보내기'));
        expect(service.createPurchaseRequest).toHaveBeenCalledWith(LAB, expect.objectContaining({ itemName: 'Toluene', quantity: 1, sourceInventoryId: 'tol' }));
        expect(hasText('구매 요청을 보냈습니다.')).toBe(true);
        expect(byText('승인 대기')).toBeTruthy();
        expect(byText('요청됨')).toBeTruthy();
    });

    it('lets the admin approve with a note and a member withdraw only their own request', async () => {
        service.listPurchaseRequests.mockResolvedValue([request({})]);
        service.updatePurchaseRequest.mockResolvedValue(request({ status: 'approved', decided_by: 'admin', decider_name: 'Lee', decision_note: 'vendor A' }));
        await mount(<PurchaseRequestsDialog items={[]} labId={LAB} userId="admin" isAdmin language="ko" onClose={() => undefined} />);
        await type(inputLabelled('메모 (선택, 요청자에게 보입니다)'), 'vendor A');
        await click(button('승인'));
        expect(service.updatePurchaseRequest).toHaveBeenCalledWith('r1', 'approved', 'vendor A');
        expect(byText('승인됨')).toBeTruthy();
        expect(button('주문함으로 표시')).toBeTruthy();
        unmount();

        await mount(<PurchaseRequestsDialog items={[]} labId={LAB} userId="someone-else" isAdmin={false} language="ko" onClose={() => undefined} />);
        expect(hasText('Toluene')).toBe(true);
        expect(button('요청 취소')).toBeNull();
        unmount();

        await mount(<PurchaseRequestsDialog items={[]} labId={LAB} userId="student" isAdmin={false} language="ko" onClose={() => undefined} />);
        expect(button('요청 취소')).toBeTruthy();
    });

    it('keeps the forecast in a personal space but offers no requests', async () => {
        await mount(<PurchaseRequestsDialog items={[item({ id: 'x', remaining_percent: 5 })]} labId={null} userId="me" isAdmin={false} language="ko" onClose={() => undefined} />);
        expect(byText('부족')).toBeTruthy();
        expect(hasText('구매 요청은 연구실 공간에서만 쓸 수 있습니다.')).toBe(true);
        expect(button('구매 요청')).toBeNull();
        expect(service.listPurchaseRequests).not.toHaveBeenCalled();
        expect(service.fetchUsageCounts).toHaveBeenCalledWith(null, 180);
    });
});
