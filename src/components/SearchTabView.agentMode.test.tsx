// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '../locales/translations';
import type { SearchAgentModeProps } from '../features/agent/searchAgentMode';

vi.mock('../services/wasteLogService', () => ({ fetchWasteLogs: vi.fn(async () => []) }));

import { SearchTabView as SearchTabViewModule } from './SearchTabView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const i18n = createInstance();
await i18n.init({ lng: 'ko', resources: { ko: { translation: translations.ko }, en: { translation: translations.en } } });

const SearchTabView = SearchTabViewModule as unknown as React.FC<Record<string, unknown>>;
const noop = () => undefined;

function agentProps(overrides: Partial<SearchAgentModeProps> = {}): SearchAgentModeProps {
  return {
    mode: 'search',
    onModeChange: vi.fn(),
    text: '',
    onTextChange: vi.fn(),
    onSubmit: vi.fn(),
    onReset: vi.fn(),
    isBusy: false,
    hasTurn: false,
    resultView: <div data-testid="agent-result">agent result</div>,
    onAskAgent: vi.fn(),
    ...overrides,
  };
}

async function render(overrides: Record<string, unknown> = {}) {
  const onSearchSubmit = vi.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <I18nextProvider i18n={i18n}>
          <SearchTabView
            cartCount={0} query="" lastSearchQuery="" isLoading={false} isAiAnalyzing={false} error={null}
            result={null} mediaProducts={[]} mediaBrands={[]} mediaCount={0} cabinetResults={[]}
            showAllProducts={false} selectedBrand="all" sortBy="relevance" recentSearches={[]}
            onQueryChange={noop} onSearchSubmit={onSearchSubmit} onReset={noop} onSuggestionClick={noop}
            onOpenScanner={noop} onClearSearchHistory={noop} onRemoveSearchHistory={noop}
            onCabinetResultClick={async () => undefined} onBrandChange={noop} onSortChange={noop}
            onClearFilters={noop} onToggleShowAllProducts={noop} onNavigateToCabinet={noop}
            suggestions={[]}
            {...overrides}
          />
        </I18nextProvider>
      </MemoryRouter>,
    );
  });
  return {
    container,
    onSearchSubmit,
    unmount: () => act(() => { root.unmount(); container.remove(); }),
  };
}

const buttonWithText = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('button')).find((element) => element.textContent?.includes(text));
const scanButton = (container: HTMLElement) => container.querySelector(`button[aria-label="${translations.ko.btn_scan}"]`);
const submitForm = (container: HTMLElement) => act(async () => {
  container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
});

describe('SearchTabView agent mode', () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  it('renders no trace of agent mode when the feature is off', async () => {
    const view = await render({ query: '아세톤 어디 있어?' });
    cleanup = view.unmount;
    expect(view.container.querySelector('[role="radiogroup"]')).toBeNull();
    expect(view.container.querySelector('[data-agent-switch]')).toBeNull();
    expect(view.container.querySelector('.search-mode-switch')).toBeNull();
    expect(view.container.textContent).not.toContain(translations.ko.agent_suggest_switch);
    expect(view.container.querySelector('input')?.getAttribute('placeholder')).toBe(translations.ko.search_placeholder);
    expect(scanButton(view.container)).not.toBeNull();

    await submitForm(view.container);
    expect(view.onSearchSubmit).toHaveBeenCalledOnce();
  });

  it('adds a two-way switch and keeps normal search working when the feature is on', async () => {
    const agent = agentProps();
    const view = await render({ agent, query: 'Acetone' });
    cleanup = view.unmount;
    const radios = Array.from(view.container.querySelectorAll('[role="radio"]'));
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(view.container.querySelector('input')?.value).toBe('Acetone');
    expect(scanButton(view.container)).not.toBeNull();

    await submitForm(view.container);
    expect(view.onSearchSubmit).toHaveBeenCalledOnce();
    expect(agent.onSubmit).not.toHaveBeenCalled();

    await act(async () => { (radios[1] as HTMLButtonElement).click(); });
    expect(agent.onModeChange).toHaveBeenCalledWith('agent');
  });

  it('offers agent mode for a typed sentence without switching by itself', async () => {
    const agent = agentProps();
    const view = await render({ agent, query: '아세톤 어디 있어?' });
    cleanup = view.unmount;
    const suggestion = buttonWithText(view.container, translations.ko.agent_suggest_switch);
    expect(suggestion).toBeDefined();
    expect(agent.onAskAgent).not.toHaveBeenCalled();

    await act(async () => { suggestion?.click(); });
    expect(agent.onAskAgent).toHaveBeenCalledWith('아세톤 어디 있어?');
  });

  it.each(['sodium chloride', 'Acetone', '67-64-1'])('does not offer agent mode for the name %s', async (query) => {
    const view = await render({ agent: agentProps(), query });
    cleanup = view.unmount;
    expect(buttonWithText(view.container, translations.ko.agent_suggest_switch)).toBeUndefined();
  });

  it('keeps suggestions for a name next to the agent offer', async () => {
    const view = await render({ agent: agentProps(), query: '에탄올 잔량', suggestions: ['에탄올'] });
    cleanup = view.unmount;
    expect(buttonWithText(view.container, translations.ko.agent_suggest_switch)).toBeDefined();
    expect(buttonWithText(view.container, '에탄올')).toBeDefined();
  });

  it('routes the input, submit and reset to the agent while in agent mode', async () => {
    const agent = agentProps({ mode: 'agent', text: '유효기한 지난 시약 보여줘', hasTurn: true });
    const view = await render({
      agent,
      // Normal-search state left over from before the switch must stay out of sight.
      query: 'Acetone', lastSearchQuery: '', suggestions: ['Acetone', 'Acetonitrile'], error: 'old search error',
    });
    cleanup = view.unmount;
    const input = view.container.querySelector('input');
    expect(input?.value).toBe('유효기한 지난 시약 보여줘');
    expect(input?.getAttribute('placeholder')).toBe(translations.ko.agent_placeholder);
    expect(scanButton(view.container)).toBeNull();
    expect(view.container.querySelector('[data-testid="agent-result"]')).not.toBeNull();
    expect(view.container.textContent).not.toContain('Acetonitrile');
    expect(view.container.textContent).not.toContain('old search error');
    expect(view.container.querySelector('[data-search-state]')?.getAttribute('data-search-state')).toBe('agent');
    expect(view.container.querySelector('[data-active-pane]')?.getAttribute('data-active-pane')).toBe('primary');

    await submitForm(view.container);
    expect(agent.onSubmit).toHaveBeenCalledOnce();
    expect(view.onSearchSubmit).not.toHaveBeenCalled();

    const reset = view.container.querySelector(`button[aria-label="${translations.ko.search_reset}"]`) as HTMLButtonElement | null;
    await act(async () => { reset?.click(); });
    expect(agent.onReset).toHaveBeenCalledOnce();
  });

  it('locks the input while a request is running', async () => {
    const view = await render({ agent: agentProps({ mode: 'agent', text: '아세톤 어디 있어?', isBusy: true, hasTurn: true }) });
    cleanup = view.unmount;
    expect(view.container.querySelector('input')?.disabled).toBe(true);
    expect((view.container.querySelector('button[type="submit"]') as HTMLButtonElement | null)?.disabled).toBe(true);
  });

  it('never shows the open normal-search result behind agent mode', async () => {
    const view = await render({
      agent: agentProps({ mode: 'agent' }),
      lastSearchQuery: 'Acetone',
      cabinetResults: [{ itemId: 'i', itemName: 'Stored acetone', cabinetId: 'c', cabinetName: 'Cabinet A', shelfId: 's', shelfLevel: 0 }],
    });
    cleanup = view.unmount;
    expect(view.container.textContent).not.toContain('Stored acetone');
    expect(view.container.querySelector('[data-testid="agent-result"]')).not.toBeNull();
  });
});
