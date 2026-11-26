// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '../../locales/translations';
import type { AgentStatus, AgentTurn } from '../../store/useAgentStore';

// The view only needs the action object's identity; the cards that use it have their own tests.
vi.mock('./agentActions', () => ({ agentActions: {}, actionErrorKindOf: () => 'failed' }));
vi.mock('../inventory/InventoryFormModal', () => ({ InventoryFormModal: () => null }));

import { AgentResultView } from './AgentResultView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const i18n = createInstance();
await i18n.init({ lng: 'ko', resources: { ko: { translation: translations.ko } } });
const ko = translations.ko as Record<string, string>;

let cleanup: (() => void) | null = null;

async function mount(initial: { status: AgentStatus; turn: AgentTurn | null }) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onDismissProposal = vi.fn();
  const show = (props: { status: AgentStatus; turn: AgentTurn | null }) => act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <AgentResultView
          {...props}
          onUiAction={vi.fn()}
          onExample={vi.fn()}
          onRetry={vi.fn()}
          onDismissProposal={onDismissProposal}
          onProposalConfirmed={vi.fn()}
        />
      </I18nextProvider>,
    );
  });
  await show(initial);
  cleanup = () => {
    act(() => root.unmount());
    host.remove();
  };
  const region = (role: 'status' | 'alert') => host.querySelector<HTMLElement>(`:scope > div > [data-agent-announcer="${role}"]`)!;
  return { host, show, region, onDismissProposal };
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

const turn = (patch: Partial<AgentTurn>): AgentTurn => ({ id: 1, text: '만료된 시약 보여줘', plan: null, result: null, error: null, ...patch });

describe('agent result view announcements', () => {
  it('speaks each step through live regions that are in the page before any request', async () => {
    const view = await mount({ status: 'idle', turn: null });
    const status = view.region('status');
    const alert = view.region('alert');
    // In the page, empty, before anything is asked.
    expect(status.textContent).toBe('');
    expect(alert.textContent).toBe('');

    await view.show({ status: 'planning', turn: turn({}) });
    expect(view.region('status')).toBe(status);
    expect(status.textContent).toBe(ko.agent_status_planning);
    expect(view.host.querySelector('[data-agent-result]')?.getAttribute('aria-busy')).toBe('true');
    expect(view.host.querySelector('[data-agent-skeleton]')).not.toBeNull();

    await view.show({ status: 'running', turn: turn({ plan: { kind: 'expiry_list', window: 'expired' } }) });
    expect(status.textContent).toBe(ko.agent_status_running);

    await view.show({
      status: 'idle',
      turn: turn({
        plan: { kind: 'expiry_list', window: 'expired' },
        result: { type: 'expiry_list', window: 'expired', rows: [], total: 0, undatedCount: 0, inventoryCount: 3 },
      }),
    });
    expect(view.region('status')).toBe(status);
    expect(status.textContent).toBe('유효기한이 지난 시약 결과를 표시했어요.');
    expect(view.host.querySelector('[data-agent-result]')?.getAttribute('aria-busy')).toBe('false');
    expect(view.host.querySelector('[data-agent-skeleton]')).toBeNull();

    await view.show({ status: 'idle', turn: turn({ error: 'rate_limited' }) });
    expect(view.region('alert')).toBe(alert);
    expect(alert.textContent).toBe(ko.agent_error_rate_limited);
    expect(status.textContent).toBe('');
    // The visible copy carries no live role of its own, so nothing is announced twice.
    expect(view.host.querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(2);
  });

  it('gives the examples the focus when a proposal is cancelled', async () => {
    const view = await mount({
      status: 'idle',
      turn: turn({
        plan: { kind: 'register_item', name: '아세톤', casNumber: null, quantity: null, capacity: null },
        result: { type: 'register_proposal', draft: { name: '아세톤', casNumber: null, quantity: null, capacity: null }, labId: null },
      }),
    });
    // Cancelling clears the request, as the store does.
    view.onDismissProposal.mockImplementation(() => { void view.show({ status: 'idle', turn: null }); });
    const cancel = Array.from(view.host.querySelectorAll('button')).find((button) => button.textContent?.trim() === ko.agent_proposal_cancel)!;
    cancel.focus();
    await act(async () => { cancel.click(); });

    expect(view.onDismissProposal).toHaveBeenCalledTimes(1);
    const idle = view.host.querySelector('[data-agent-result="idle"]');
    expect(idle).not.toBeNull();
    expect(document.activeElement).toBe(idle);
  });
});
