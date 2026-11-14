// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translations } from '../locales/translations';

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

const TEA_CHOICES = [
  { name: '트라이에탄올아민', nameEn: 'Triethanolamine' },
  { name: '트라이에틸아민', nameEn: 'Triethylamine' },
  { name: '트리에틸알루미늄', nameEn: 'Triethylaluminium' },
];

async function render(overrides: Record<string, unknown> = {}) {
  const onSearchSubmit = vi.fn();
  const onSuggestionClick = vi.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <I18nextProvider i18n={i18n}>
          <SearchTabView
            cartCount={0} query="TEA" lastSearchQuery="" isLoading={false} isAiAnalyzing={false} error={null}
            result={null} mediaProducts={[]} mediaBrands={[]} mediaCount={0} cabinetResults={[]}
            showAllProducts={false} selectedBrand="all" sortBy="relevance" recentSearches={[]}
            onQueryChange={noop} onSearchSubmit={onSearchSubmit} onReset={noop} onSuggestionClick={onSuggestionClick}
            onOpenScanner={noop} onClearSearchHistory={noop} onRemoveSearchHistory={noop}
            onCabinetResultClick={async () => undefined} onBrandChange={noop} onSortChange={noop}
            onClearFilters={noop} onToggleShowAllProducts={noop} onNavigateToCabinet={noop}
            suggestions={[]} formChoices={TEA_CHOICES} formChoicesQuery="TEA"
            {...overrides}
          />
        </I18nextProvider>
      </MemoryRouter>,
    );
  });
  return {
    container,
    onSearchSubmit,
    onSuggestionClick,
    unmount: () => act(() => { root.unmount(); container.remove(); }),
  };
}

describe('SearchTabView form choice', () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  it('asks which form instead of linking TEA to one reagent', async () => {
    const view = await render();
    cleanup = view.unmount;
    expect(view.container.textContent).toContain('어떤 형태인가요?');
    for (const choice of TEA_CHOICES) expect(view.container.textContent).toContain(choice.name);

    const button = Array.from(view.container.querySelectorAll('button'))
      .find((element) => element.textContent?.includes('트라이에틸아민'));
    await act(async () => { button?.click(); });
    expect(view.onSuggestionClick).toHaveBeenCalledWith('트라이에틸아민');
  });

  it('does not search the ambiguous name on submit', async () => {
    const view = await render();
    cleanup = view.unmount;
    const form = view.container.querySelector('form');
    await act(async () => { form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(view.onSearchSubmit).not.toHaveBeenCalled();
  });

  it('ignores choices fetched for a different query', async () => {
    const view = await render({ query: 'TEAA', formChoicesQuery: 'TEA' });
    cleanup = view.unmount;
    expect(view.container.textContent).not.toContain('어떤 형태인가요?');
    const form = view.container.querySelector('form');
    await act(async () => { form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(view.onSearchSubmit).toHaveBeenCalledOnce();
  });
});
