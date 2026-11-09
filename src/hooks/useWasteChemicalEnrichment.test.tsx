// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { WasteComponent } from '../types';
vi.mock('../config/featureFlags', () => ({ isChemicalEnrichmentEnabled: true }));
vi.mock('../store/useWasteStore', async () => {
  const { create } = await import('zustand');
  return { useWasteStore: create(() => ({ cart: [], refreshChemicalEnrichment: vi.fn().mockResolvedValue(undefined) })) };
});
import { useWasteStore } from '../store/useWasteStore';
import { useWasteChemicalEnrichment } from './useWasteChemicalEnrichment';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(() => root?.unmount());
  document.body.innerHTML = '';
  vi.clearAllMocks();
});
function Probe() { useWasteChemicalEnrichment('user-a', null); return null; }
it('ignores automatic catalog/version results but refreshes each explicit catalog selection', async () => {
  const component = { cartLineId: 'line', chemical: { name: 'HCl', casNumber: '7647-01-0', molecularFormula: 'HCl' }, enrichmentVersion: 0 } as WasteComponent;
  useWasteStore.setState({ cart: [component] });
  const node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node);
  await act(async () => { root!.render(<Probe />); });
  const refresh = useWasteStore.getState().refreshChemicalEnrichment;
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => { useWasteStore.setState({ cart: [{ ...component, enrichmentVersion: 2, phCatalogId: 'hydrochloric-acid',
    phCatalogMatch: { status: 'matched', id: 'hydrochloric-acid', selection: 'automatic', candidateIds: [], catalogVersion: 'test' } }] }); });
  expect(refresh).toHaveBeenCalledTimes(1);
  for (const revision of [1, 2]) {
    await act(async () => { useWasteStore.setState((s) => ({ cart: [{ ...s.cart[0], identitySelectionRevision: revision }] })); });
    expect(refresh).toHaveBeenCalledTimes(revision + 1);
  }
  await act(async () => { useWasteStore.setState((s) => ({ cart: [{ ...s.cart[0], hazardDataConfirmedByUser: true }] })); });
  expect(refresh).toHaveBeenCalledTimes(3);
});
