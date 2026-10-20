import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '../../src/index.css';
import '../../src/locales/i18n';
import { AdaptiveViewportProvider } from '../../src/components/AdaptiveViewportProvider';
import { MainLayout } from '../../src/components/MainLayout';
import { BottomTabNav } from '../../src/components/BottomTabNav';
import { InventoryListView } from '../../src/features/inventory/InventoryListView';
import { SearchTabView } from '../../src/components/SearchTabView';
import { CartView } from '../../src/components/CartView';
import { WasteLogView } from '../../src/components/WasteLogView';
import { FridgeView } from '../../src/features/fridge/FridgeView';
import { inventoryService, storageLocationService, type InventoryItem } from '../../src/services/inventoryService';
import { cabinetService } from '../../src/services/cabinetService';
import { useOnboardingStore } from '../../src/store/useOnboardingStore';
import { useWasteStore } from '../../src/store/useWasteStore';
import { useFridgeStore } from '../../src/store/fridgeStore';
import type { AppTab } from '../../src/hooks/useAppUiState';
import type { AnalysisResult } from '../../src/types';

const noop = () => {};
const item: InventoryItem = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Adaptive reagent', quantity: 2,
  lab_id: null, user_id: null, brand: 'Fixture', product_number: null, cas_number: '67-64-1',
  capacity: '100 mL', storage_type: 'other', cabinet_id: null, storage_location_id: null, product_id: null,
  expiry_date: null, manufacturer_date_type: 'expiry', received_date: null, opened_date: null, memo: null,
  remaining_percent: 100, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
};
inventoryService.getItems = async () => {
  document.documentElement.dataset.inventoryLoads = String(Number(document.documentElement.dataset.inventoryLoads ?? 0) + 1);
  return [item];
};
storageLocationService.getLocations = async () => [];
cabinetService.getCabinets = async () => [];
useOnboardingStore.setState({ hasCompletedWelcome: false });
const result: AnalysisResult = {
  chemical: { id: 'fixture-acetone', name: 'Acetone', casNumber: '67-64-1', molecularFormula: 'C3H6O', ghs: { signal: '', hazardStatements: [] } },
  category: 'ORGANIC_NON_HALOGEN', binColor: 'bg-blue-500', label: 'category_organic_non_halogen', reason: 'Fixture', isSafe: true,
};
useWasteStore.getState().addToCart(result);
useFridgeStore.setState({ selectedReagentId: 'fixture-bottle', shelves: [{
  id: 'fixture-floor', level: 0, dividers: [], items: [{
    id: 'fixture-bottle', reagentId: 'fixture-reagent', name: 'Cabinet reagent', shelfId: 'fixture-floor',
    position: 50, width: 8, template: 'A', isAcidic: false, isBasic: false, hCodes: [],
  }],
}] });

export function Fixture() {
  const initial = new URLSearchParams(location.search).get('screen') ?? 'inventory';
  const [tab, setTab] = useState<AppTab>(initial === 'cart' ? 'search' : initial as AppTab);
  const [cartOpen, setCartOpen] = useState(initial === 'cart');
  const [query, setQuery] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  const [searchResult, setSearchResult] = useState<AnalysisResult | null>(null);
  useEffect(() => { document.documentElement.dataset.fixtureMounts = String(Number(document.documentElement.dataset.fixtureMounts ?? 0) + 1); }, []);
  return <>
    <MainLayout activeTab={tab} onTabClick={setTab} onCartClick={() => setCartOpen(true)} cartCount={1} userEmail="fixture@example.invalid" onSignOut={noop}
      bottomNav={<BottomTabNav activeTab={tab} isAdmin={false} onTabClick={setTab} />}>
      {tab === 'inventory' ? <InventoryListView userId="fixture-user" />
        : tab === 'cabinet' ? <FridgeView cabinetId="" />
        : tab === 'logs' ? <WasteLogView />
        : <SearchTabView cartCount={1} query={query} lastSearchQuery={lastQuery} result={searchResult}
          isLoading={false} isAiAnalyzing={false} error={null} mediaProducts={[]} mediaBrands={[]} mediaCount={0}
          cabinetResults={[]} showAllProducts={false} selectedBrand="" sortBy="name_asc" recentSearches={[]}
          onQueryChange={setQuery} onSearchSubmit={event => { event?.preventDefault(); setLastQuery(query); setSearchResult(result); }}
          onReset={() => setSearchResult(null)} onSuggestionClick={noop} onOpenScanner={noop} onClearSearchHistory={noop}
          onRemoveSearchHistory={noop} onCabinetResultClick={async () => {}} onBrandChange={noop} onSortChange={noop}
          onClearFilters={noop} onToggleShowAllProducts={noop} onNavigateToCabinet={noop} onOpenCart={() => setCartOpen(true)} />}
    </MainLayout>
    {cartOpen && <CartView onClose={() => setCartOpen(false)} onDisposed={noop} />}
  </>;
}

createRoot(document.getElementById('root')!).render(<BrowserRouter><AdaptiveViewportProvider><Fixture /></AdaptiveViewportProvider></BrowserRouter>);
