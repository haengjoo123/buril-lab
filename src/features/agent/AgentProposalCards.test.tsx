// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '../../locales/translations';
import type { InventoryItem } from '../../services/inventoryService';

// The registration form reaches Supabase-backed services; a stand-in shows what it was opened with.
vi.mock('../inventory/InventoryFormModal', () => ({
  InventoryFormModal: ({ initialDraft, onSaved, onClose }: {
    initialDraft: Record<string, unknown>;
    onSaved: (result: unknown) => void;
    onClose: () => void;
  }) => (
    <div data-testid="registration-form" data-draft={JSON.stringify(initialDraft)}>
      <button type="button" onClick={() => onSaved({ kind: 'created', itemId: 'new', item: null, values: {} })}>save form</button>
      <button type="button" onClick={onClose}>close form</button>
    </div>
  ),
}));
vi.mock('../../services/inventoryService', () => ({ inventoryService: {}, storageLocationService: {}, createInventoryOperationRequestId: vi.fn() }));
vi.mock('../../services/purchaseRequestService', () => ({ createPurchaseRequest: vi.fn(), toPurchaseError: vi.fn() }));
vi.mock('../../services/wasteContainerService', () => ({ requestWasteContainerPickup: vi.fn(), toWasteContainerError: vi.fn() }));
vi.mock('../../store/useLabStore', () => ({ useLabStore: { getState: () => ({ currentLabId: null }) } }));
vi.mock('../../store/useWasteStore', () => ({ useWasteStore: { getState: () => ({ batch: { components: [], labId: null } }) } }));
vi.mock('./agentDataSources', () => ({ agentDataSources: {} }));

import { AgentActionError, type AgentActions, type AgentWasteBatchAddition } from './agentActions';
import { AgentProposalCard } from './AgentProposalCards';
import type { AgentContainerRow, AgentProposalResult } from './agentResults';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const i18n = createInstance();
await i18n.init({ lng: 'ko', resources: { ko: { translation: translations.ko } } });
const ko = translations.ko as Record<string, string>;

const LAB_ID = '11111111-1111-4111-8111-111111111111';

function item(overrides: Partial<InventoryItem>): InventoryItem {
  return {
    id: 'item-1', lab_id: LAB_ID, user_id: null, name: '아세톤', brand: 'Sigma', product_number: 'A-100', cas_number: '67-64-1',
    quantity: 1, capacity: '500 mL', storage_type: 'other', cabinet_id: null, storage_location_id: null, product_id: null,
    expiry_date: null, manufacturer_date_type: 'unlabeled', received_date: null, opened_date: null, memo: null,
    remaining_percent: 60, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    storage_location_name: '시약 선반', _source: 'inventory', ...overrides,
  };
}

function container(overrides: Partial<AgentContainerRow>): AgentContainerRow {
  return {
    id: 'c1', label: '산 폐액-1', streamCode: 'ACID_AQUEOUS', status: 'active', location: '흄후드 옆',
    totalMl: 4_000, fillPercent: 40, hasUnknownAmounts: false, pickupRequested: false, ...overrides,
  };
}

function stubActions(): { [K in keyof AgentActions]: ReturnType<typeof vi.fn<AgentActions[K]>> } {
  let nextRequest = 0;
  return {
    setRemaining: vi.fn<AgentActions['setRemaining']>().mockResolvedValue(undefined),
    recordUsedUp: vi.fn<AgentActions['recordUsedUp']>().mockResolvedValue(undefined),
    requestPurchase: vi.fn<AgentActions['requestPurchase']>().mockResolvedValue(undefined),
    requestPickup: vi.fn<AgentActions['requestPickup']>().mockResolvedValue(undefined),
    loadLocations: vi.fn<AgentActions['loadLocations']>().mockResolvedValue([]),
    newRequestId: vi.fn<AgentActions['newRequestId']>().mockImplementation(() => `request-${nextRequest += 1}`),
    wasteBatchSize: vi.fn<AgentActions['wasteBatchSize']>().mockReturnValue(0),
    lookupForm: vi.fn<AgentActions['lookupForm']>().mockResolvedValue({ status: 'not_found' }),
    addToWasteBatch: vi.fn<AgentActions['addToWasteBatch']>().mockResolvedValue(undefined),
  };
}

let unmount: (() => void) | null = null;

async function render(result: AgentProposalResult, arrange: (actions: ReturnType<typeof stubActions>) => void = () => undefined) {
  const actions = stubActions();
  arrange(actions);
  const onUiAction = vi.fn();
  const onDismiss = vi.fn();
  const onConfirmed = vi.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <AgentProposalCard result={result} actions={actions} onUiAction={onUiAction} onDismiss={onDismiss} onConfirmed={onConfirmed} />
      </I18nextProvider>,
    );
  });
  unmount = () => {
    act(() => root.unmount());
    host.remove();
  };
  const button = (label: string) => Array.from(host.querySelectorAll('button')).find((element) => element.textContent?.trim() === label);
  const click = async (element: Element | null | undefined) => {
    if (!element) throw new Error('element not found');
    await act(async () => {
      (element as HTMLElement).click();
    });
  };
  const radios = () => Array.from(host.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  /** The radio inside the label that carries this text. */
  const radioLabeled = (label: string) => Array.from(host.querySelectorAll('label'))
    .find((element) => element.textContent?.trim() === label)?.querySelector<HTMLInputElement>('input[type="radio"]');
  const announced = (role: 'status' | 'alert') => host.querySelector(`[data-agent-announcer="${role}"]`)?.textContent ?? '';
  return { host, actions, onUiAction, onDismiss, onConfirmed, button, click, radios, radioLabeled, announced };
}

afterEach(() => {
  unmount?.();
  unmount = null;
});

describe('usage proposal', () => {
  const single: AgentProposalResult = {
    type: 'usage_proposal', query: '아세톤', change: { kind: 'remaining', percent: null },
    items: [item({})], hiddenCount: 0, aliasOnly: false, labId: LAB_ID,
  };

  it('saves nothing until the amount is chosen and the button is pressed', async () => {
    const view = await render(single);
    const confirm = view.button(ko.agent_usage_confirm_remaining)!;
    // The only match is selected, but no amount was typed.
    expect(view.radios()[0].checked).toBe(true);
    expect(confirm.disabled).toBe(true);
    expect(view.host.textContent).toContain(ko.agent_usage_need_level);
    expect(view.host.textContent).toContain(ko.agent_proposal_nothing_saved);

    await view.click(view.radioLabeled(ko.inventory_remaining_stage_2_label));
    expect(confirm.disabled).toBe(false);
    expect(view.host.textContent).toContain('‘아세톤’의 남은 양을 약 30%로 기록해요.');
    expect(view.actions.setRemaining).not.toHaveBeenCalled();

    await view.click(confirm);
    expect(view.actions.setRemaining).toHaveBeenCalledTimes(1);
    expect(view.actions.setRemaining).toHaveBeenCalledWith(LAB_ID, single.items[0], 30);
    expect(view.onConfirmed).toHaveBeenCalledTimes(1);
    expect(view.host.querySelector('[role="status"]')?.textContent).toContain('남은 양을 약 30%로 기록했어요.');
    // Once saved, the controls are gone, so it cannot be saved twice.
    expect(view.button(ko.agent_usage_confirm_remaining)).toBeUndefined();
  });

  it('keeps the percentage the person typed', async () => {
    const view = await render({ ...single, change: { kind: 'remaining', percent: 45 } });
    await view.click(view.button(ko.agent_usage_confirm_remaining));
    expect(view.actions.setRemaining).toHaveBeenCalledWith(LAB_ID, single.items[0], 45);
  });

  it('picks no bottle when several match', async () => {
    const second = item({ id: 'item-2', brand: 'Merck', remaining_percent: null });
    const view = await render({ ...single, change: { kind: 'remaining', percent: 30 }, items: [single.items[0], second] });
    const confirm = view.button(ko.agent_usage_confirm_remaining)!;
    // Neither bottle is chosen; only the typed amount is.
    expect(view.radios().slice(0, 2).every((radio) => !radio.checked)).toBe(true);
    expect(view.radioLabeled(ko.inventory_remaining_stage_2_label)?.checked).toBe(true);
    expect(confirm.disabled).toBe(true);
    expect(view.host.textContent).toContain('일치하는 품목이 2개예요.');

    await view.click(view.radios()[1]);
    await view.click(confirm);
    expect(view.actions.setRemaining).toHaveBeenCalledWith(LAB_ID, second, 30);
  });

  it('leaves without saving when cancelled', async () => {
    const view = await render({ ...single, change: { kind: 'remaining', percent: 30 } });
    await view.click(view.button(ko.agent_proposal_cancel));
    expect(view.onDismiss).toHaveBeenCalledTimes(1);
    expect(view.actions.setRemaining).not.toHaveBeenCalled();
    expect(view.onConfirmed).not.toHaveBeenCalled();
  });

  it('explains a refused save and reports nothing as confirmed', async () => {
    const view = await render({ ...single, change: { kind: 'remaining', percent: 30 } });
    view.actions.setRemaining.mockRejectedValueOnce(new AgentActionError('space_changed'));
    await view.click(view.button(ko.agent_usage_confirm_remaining));
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain(ko.agent_proposal_error_space_changed);
    expect(view.onConfirmed).not.toHaveBeenCalled();

    // The proposal stays, so the person can try again.
    await view.click(view.button(ko.agent_usage_confirm_remaining));
    expect(view.actions.setRemaining).toHaveBeenCalledTimes(2);
    expect(view.onConfirmed).toHaveBeenCalledTimes(1);
  });

  it('records a used-up bottle only for a bottle on a cabinet shelf, with one id across retries', async () => {
    const usedUp = { ...single, change: { kind: 'used_up' } as const };
    const inventoryRow = await render(usedUp);
    expect(inventoryRow.button(ko.agent_usage_confirm_used_up)!.disabled).toBe(true);
    expect(inventoryRow.host.textContent).toContain(ko.agent_usage_used_up_cabinet_only);
    unmount?.();

    const bottle = item({ id: 'bottle-1', _source: 'cabinet_item', storage_type: 'cabinet', cabinet_name: '시약장 A', shelf_level: 1 });
    const view = await render({ ...usedUp, items: [bottle] });
    view.actions.recordUsedUp.mockRejectedValueOnce(new Error('offline'));
    await view.click(view.button(ko.agent_usage_confirm_used_up));
    await view.click(view.button(ko.agent_usage_confirm_used_up));
    expect(view.actions.recordUsedUp.mock.calls).toEqual([
      [LAB_ID, 'bottle-1', 'request-1'],
      [LAB_ID, 'bottle-1', 'request-1'],
    ]);
    expect(view.host.querySelector('[role="status"]')?.textContent).toContain(ko.agent_usage_done_used_up);
  });
});

describe('proposal accessibility', () => {
  const proposal: AgentProposalResult = {
    type: 'usage_proposal', query: '아세톤', change: { kind: 'remaining', percent: 30 },
    items: [item({})], hiddenCount: 0, aliasOnly: false, labId: LAB_ID,
  };

  it('keeps live regions in the page from the start and speaks outcomes through them', async () => {
    const view = await render(proposal);
    // Present and empty before anything happens, so later text is announced.
    expect(view.host.querySelector('[role="status"]')).not.toBeNull();
    expect(view.host.querySelector('[role="alert"]')).not.toBeNull();
    expect(view.announced('status')).toBe('');
    expect(view.announced('alert')).toBe('');

    view.actions.setRemaining.mockRejectedValueOnce(new AgentActionError('not_allowed'));
    await view.click(view.button(ko.agent_usage_confirm_remaining));
    expect(view.announced('alert')).toBe(ko.agent_proposal_error_not_allowed);

    await view.click(view.button(ko.agent_usage_confirm_remaining));
    expect(view.announced('alert')).toBe('');
    expect(view.announced('status')).toBe('남은 양을 약 30%로 기록했어요.');
    // The same two elements carried every message.
    expect(view.host.querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(2);
  });

  it('stays focusable while saving, marks itself busy and ignores a second press', async () => {
    let finish: () => void = () => undefined;
    const view = await render(proposal, (actions) => actions.setRemaining.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; })));
    const confirm = view.button(ko.agent_usage_confirm_remaining)!;
    confirm.focus();
    await view.click(confirm);

    expect(confirm.disabled).toBe(false);
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(confirm);
    expect(view.host.querySelector('section')?.getAttribute('aria-busy')).toBe('true');
    expect(view.announced('status')).toBe(ko.agent_proposal_saving);
    // The label stays in the button, so its name and its width do not change.
    expect(confirm.textContent).toContain(ko.agent_usage_confirm_remaining);

    await view.click(confirm);
    await view.click(view.button(ko.agent_proposal_cancel));
    expect(view.actions.setRemaining).toHaveBeenCalledTimes(1);
    expect(view.onDismiss).not.toHaveBeenCalled();

    await act(async () => { finish(); });
    // The button is gone; the outcome has the focus instead of nothing.
    expect(document.activeElement?.textContent).toContain('남은 양을 약 30%로 기록했어요.');
    expect(document.activeElement).not.toBe(document.body);
  });

  it('says why the button is unavailable and ties the reason to it', async () => {
    const view = await render({ ...proposal, change: { kind: 'remaining', percent: null } });
    const confirm = view.button(ko.agent_usage_confirm_remaining)!;
    expect(confirm.disabled).toBe(true);
    const described = view.host.ownerDocument.getElementById(confirm.getAttribute('aria-describedby')!);
    expect(described?.textContent).toBe(ko.agent_usage_need_level);
  });

  it('offers the amount as one named group of native radios', async () => {
    const view = await render(proposal);
    const scale = view.radioLabeled(ko.inventory_remaining_stage_1_label)!;
    const group = scale.closest('fieldset')!;
    expect(group.querySelector('legend')?.textContent).toBe(ko.agent_usage_level_label);
    const steps = Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(steps).toHaveLength(4);
    // One name makes them one group: arrow keys move within it and Tab stops on it once.
    expect(new Set(steps.map((step) => step.name)).size).toBe(1);
  });
});

describe('purchase proposal', () => {
  const proposal: AgentProposalResult = { type: 'purchase_proposal', itemName: '에탄올', quantity: 2, matches: [], labId: LAB_ID };

  it('sends the typed name and quantity, and nothing the person did not choose', async () => {
    const view = await render(proposal);
    expect(view.host.textContent).toContain('연구실 관리자에게 ‘에탄올’ 2개 구매를 요청해요.');
    await view.click(view.button(ko.agent_purchase_proposal_confirm));
    expect(view.actions.requestPurchase).toHaveBeenCalledWith(LAB_ID, {
      itemName: '에탄올', quantity: 2, brand: null, productNumber: null, casNumber: null, packageSize: null, sourceInventoryId: null,
    });
    expect(view.host.querySelector('[role="status"]')?.textContent).toContain(ko.agent_purchase_proposal_done);
  });

  it('takes brand, size and CAS number only from the inventory record the person links', async () => {
    const first = item({ name: '에탄올', brand: 'Sigma', capacity: '1 L', cas_number: '64-17-5', product_number: 'E-1' });
    const second = item({ id: 'item-2', name: '에탄올', brand: 'Merck', capacity: '500 mL', cas_number: '64-17-5', product_number: 'E-2' });
    const view = await render({ ...proposal, quantity: null, matches: [first, second] });
    // With several records, none is linked until the person chooses.
    expect(view.radios().map((radio) => radio.checked)).toEqual([false, false, true]);

    await view.click(view.radios()[1]);
    await view.click(view.button(ko.agent_purchase_proposal_confirm));
    expect(view.actions.requestPurchase).toHaveBeenCalledWith(LAB_ID, {
      itemName: '에탄올', quantity: 1, brand: 'Merck', productNumber: 'E-2', casNumber: '64-17-5', packageSize: '500 mL', sourceInventoryId: 'item-2',
    });
  });
});

describe('registration proposal', () => {
  const proposal: AgentProposalResult = {
    type: 'register_proposal', draft: { name: '아세톤', casNumber: null, quantity: 2, capacity: '500 mL' }, labId: null,
  };

  it('opens the registration form with the typed details and registers only when the form is saved', async () => {
    const view = await render(proposal);
    expect(view.host.querySelector('[data-testid="registration-form"]')).toBeNull();

    await view.click(view.button(ko.agent_register_open));
    await act(async () => { await Promise.resolve(); });
    const form = view.host.ownerDocument.querySelector('[data-testid="registration-form"]')!;
    expect(JSON.parse(form.getAttribute('data-draft')!)).toEqual({ name: '아세톤', quantity: 2, capacity: '500 mL' });
    expect(view.onConfirmed).not.toHaveBeenCalled();

    // Closing the form without saving leaves the proposal as it was.
    await view.click(view.button('close form'));
    expect(view.onConfirmed).not.toHaveBeenCalled();
    expect(view.button(ko.agent_register_open)).toBeDefined();

    await view.click(view.button(ko.agent_register_open));
    await act(async () => { await Promise.resolve(); });
    await view.click(view.button('save form'));
    expect(view.onConfirmed).toHaveBeenCalledTimes(1);
    expect(view.host.querySelector('[role="status"]')?.textContent).toContain(ko.agent_register_done);
  });
});

describe('pickup proposal', () => {
  it('asks which container when there are several and requests only that one', async () => {
    const view = await render({
      type: 'pickup_proposal', containers: [container({}), container({ id: 'c2', label: '유기 폐액-2' })], requestedCount: 1, labId: LAB_ID,
    });
    const confirm = view.button(ko.agent_pickup_confirm)!;
    expect(confirm.disabled).toBe(true);
    expect(view.host.textContent).toContain('1개는 이미 수거가 요청돼 있어 빼고 보여 줘요.');

    await view.click(view.radios()[1]);
    expect(view.host.textContent).toContain('‘유기 폐액-2’ 수거를 요청해요.');
    await view.click(confirm);
    expect(view.actions.requestPickup).toHaveBeenCalledWith(LAB_ID, 'c2');
    expect(view.host.querySelector('[role="status"]')?.textContent).toContain(ko.agent_pickup_done);
  });

  it('says so when no container needs a request', async () => {
    const view = await render({ type: 'pickup_proposal', containers: [], requestedCount: 2, labId: LAB_ID });
    expect(view.host.textContent).toContain(ko.agent_pickup_none_title);
    expect(view.button(ko.agent_pickup_confirm)).toBeUndefined();
  });
});

describe('waste batch proposal', () => {
  const analysisOf = (name: string, casNumber: string) => ({
    chemical: { id: casNumber, name, casNumber, molecularFormula: '' },
    category: 'ORGANIC_NON_HALOGEN', binColor: '', label: '', reason: '', isSafe: true,
  }) as unknown as AgentWasteBatchAddition['analysis'];
  const mL = (value: number) => ({ value, unit: 'mL', kind: 'volume' } as const);
  const acetone = { key: '0:아세톤', typedName: '아세톤', amount: mL(200), lookup: { status: 'found', analysis: analysisOf('아세톤 (Acetone)', '67-64-1'), verifiedByCas: false } } as const;
  const methanol = { key: '1:메탄올', typedName: '메탄올', amount: mL(100), lookup: { status: 'found', analysis: analysisOf('메탄올 (Methanol)', '67-56-1'), verifiedByCas: false } } as const;
  const checkboxes = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));

  it('adds only the components left ticked, then opens the review', async () => {
    const view = await render({
      type: 'waste_batch_proposal', labId: LAB_ID,
      components: [acetone, methanol, { key: '2:없는물질', typedName: '없는물질', amount: mL(10), lookup: { status: 'not_found' } }],
    });
    expect(view.host.textContent).toContain(ko.agent_batch_note_scope);
    expect(view.host.textContent).toContain('‘없는물질’은(는) 찾지 못해 담지 않아요.');
    expect(view.host.textContent).toContain('입력: 아세톤 · 200 mL');
    expect(view.host.textContent).toContain(ko.agent_batch_needs_review);
    expect(view.actions.addToWasteBatch).not.toHaveBeenCalled();

    await view.click(checkboxes(view.host)[1]);
    expect(view.host.textContent).toContain('성분 1개를 폐액 배치에 담고 검토 화면을 열어요.');
    await view.click(view.button(ko.agent_batch_confirm));

    expect(view.actions.addToWasteBatch).toHaveBeenCalledWith(LAB_ID, [
      { typedName: '아세톤', analysis: acetone.lookup.analysis, verifiedByCas: false, amount: mL(200) },
    ]);
    expect(view.onUiAction).toHaveBeenCalledWith({ type: 'open_screen', screen: 'cart' });
    expect(view.onConfirmed).toHaveBeenCalledTimes(1);
    expect(view.host.querySelector('[role="status"]')?.textContent).toContain('폐액 배치에 성분 1개를 담았어요.');
  });

  it('cannot be confirmed with nothing ticked, and says when it adds to an existing batch', async () => {
    const view = await render(
      { type: 'waste_batch_proposal', labId: LAB_ID, components: [acetone] },
      (actions) => actions.wasteBatchSize.mockReturnValue(2),
    );
    expect(view.host.textContent).toContain('지금 폐액 배치에 성분 2개가 있어요.');
    await view.click(checkboxes(view.host)[0]);
    expect(view.button(ko.agent_batch_confirm)!.disabled).toBe(true);
    expect(view.host.textContent).toContain(ko.agent_batch_choose);
  });

  it('looks up the form the person picks and never takes one for them', async () => {
    const view = await render(
      {
        type: 'waste_batch_proposal', labId: LAB_ID,
        components: [{ key: '0:염산', typedName: '염산', amount: mL(500), lookup: { status: 'choose_form', choices: [{ name: '염산 35%' }, { name: '염산 10%' }] } }],
      },
      (actions) => actions.lookupForm.mockResolvedValue({ status: 'found', analysis: analysisOf('염산 10%', '7647-01-0'), verifiedByCas: false }),
    );
    expect(view.button(ko.agent_batch_confirm)!.disabled).toBe(true);
    expect(view.actions.lookupForm).not.toHaveBeenCalled();

    await view.click(view.radios()[1]);
    expect(view.actions.lookupForm).toHaveBeenCalledWith('염산 10%');
    // The options are gone; the component found in their place has the focus.
    expect(document.activeElement).toBe(checkboxes(view.host)[0]);
    await view.click(view.button(ko.agent_batch_confirm));
    expect(view.actions.addToWasteBatch).toHaveBeenCalledWith(LAB_ID, [
      expect.objectContaining({ typedName: '염산', amount: mL(500), analysis: expect.objectContaining({ chemical: expect.objectContaining({ name: '염산 10%' }) }) }),
    ]);
  });

  it('says so when nothing could be found, and still offers the review', async () => {
    const view = await render({
      type: 'waste_batch_proposal', labId: LAB_ID,
      components: [{ key: '0:x', typedName: '없는물질', amount: mL(10), lookup: { status: 'failed' } }],
    });
    expect(view.host.textContent).toContain(ko.agent_batch_none_title);
    expect(view.button(ko.agent_batch_confirm)).toBeUndefined();
    await view.click(Array.from(view.host.querySelectorAll('button')).find((element) => element.textContent?.includes(ko.agent_disposal_open_review)));
    expect(view.onUiAction).toHaveBeenCalledWith({ type: 'open_screen', screen: 'cart' });
  });

  it('keeps the proposal when the batch belongs to another space', async () => {
    const view = await render(
      { type: 'waste_batch_proposal', labId: LAB_ID, components: [acetone] },
      (actions) => actions.addToWasteBatch.mockRejectedValue(new AgentActionError('space_changed')),
    );
    await view.click(view.button(ko.agent_batch_confirm));
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain(ko.agent_proposal_error_space_changed);
    expect(view.onUiAction).not.toHaveBeenCalled();
    expect(view.onConfirmed).not.toHaveBeenCalled();
  });
});

describe('waste batch form choice', () => {
  const mL = (value: number) => ({ value, unit: 'mL', kind: 'volume' } as const);
  const forms: AgentProposalResult = {
    type: 'waste_batch_proposal', labId: LAB_ID,
    components: [{ key: '0:염산', typedName: '염산', amount: mL(500), lookup: { status: 'choose_form', choices: [{ name: '염산 35%' }, { name: '염산 10%' }] } }],
  };

  it('keeps the options focusable while a pick is looked up and ignores another pick', async () => {
    let finish: (lookup: { status: 'not_found' }) => void = () => undefined;
    const view = await render(forms, (actions) => actions.lookupForm.mockImplementation(() => new Promise((resolve) => { finish = resolve; })));
    const [first, second] = view.radios();
    second.focus();
    await view.click(second);

    expect(second.disabled).toBe(false);
    expect(second.checked).toBe(true);
    expect(document.activeElement).toBe(second);
    expect(second.closest('fieldset')?.getAttribute('aria-busy')).toBe('true');
    expect(view.announced('status')).toBe(ko.agent_batch_form_loading);
    await view.click(first);
    expect(view.actions.lookupForm).toHaveBeenCalledTimes(1);

    await act(async () => { finish({ status: 'not_found' }); });
    // Nothing was left to add: the card that says so has the focus the options had.
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.textContent).toContain(ko.agent_batch_none_title);
  });

  it('moves the focus to the message when the picked form is not found but other components remain', async () => {
    const found = {
      key: '1:아세톤', typedName: '아세톤', amount: mL(200),
      lookup: { status: 'found', verifiedByCas: false, analysis: { chemical: { id: 'a', name: '아세톤', casNumber: '67-64-1', molecularFormula: '' } } as never },
    } as const;
    const view = await render(
      { ...forms, components: [...forms.components, found] },
      (actions) => actions.lookupForm.mockResolvedValue({ status: 'not_found' }),
    );
    await view.click(view.radios()[0]);
    expect(document.activeElement?.tagName).toBe('LI');
    expect(document.activeElement?.textContent).toContain('‘염산’은(는) 찾지 못해 담지 않아요.');
  });

  it('writes amounts in the app language', async () => {
    const view = await render({
      type: 'waste_batch_proposal', labId: LAB_ID,
      components: [{
        key: '0:a', typedName: '아세톤', amount: { value: 1500, unit: 'mL', kind: 'volume' },
        lookup: { status: 'found', verifiedByCas: true, analysis: { chemical: { id: 'a', name: '아세톤', casNumber: '67-64-1', molecularFormula: '' } } as never },
      }],
    });
    expect(view.host.textContent).toContain('입력: 아세톤 · 1,500 mL');
    expect(view.host.textContent).toContain(ko.agent_batch_cas_verified);
  });
});
