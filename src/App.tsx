import { useEffect, useCallback, lazy, Suspense } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { MainLayout } from './components/MainLayout';
import { SearchTabView } from './components/SearchTabView';
import { BottomTabNav } from './components/BottomTabNav';

// Lazy load Scanner — react-webcam + Vision OCR are heavy and only needed on camera open
const Scanner = lazy(() => import('./components/Scanner'));
import { CartView } from './components/CartView';
import { WasteLogView } from './components/WasteLogView';
import { FridgeView } from './features/fridge/FridgeView';
import { CabinetListView } from './features/fridge/CabinetListView';
import { AuthView } from './components/AuthView';
import { SafetyDisclaimer } from './components/SafetyDisclaimer';
import { InventoryListView } from './features/inventory/InventoryListView';
import { GlobalAuditLogsView } from './features/admin/GlobalAuditLogsView';
import type { CabinetSearchResult } from './services/cabinetService';
import { useWasteStore } from './store/useWasteStore';
import { useAuth } from './hooks/useAuth';
import { useAppUiState } from './hooks/useAppUiState';
import { useSearchFlow } from './hooks/useSearchFlow';
import { useLabStore } from './store/useLabStore';
import { useFridgeStore } from './store/fridgeStore';
import { useTranslation } from 'react-i18next';
import { Loader2, ShoppingBag } from 'lucide-react';

function App() {
  const { t } = useTranslation();
  const { session, user, isLoading: isAuthLoading, signIn, signUp, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const activeCabinetId = searchParams.get('id');

  const cart = useWasteStore((state) => state.cart);
  const { recentSearches, addSearchHistory, removeSearchHistory, clearSearchHistory, loadSearchHistory } = useWasteStore();
  const currentLabId = useLabStore((state) => state.currentLabId);
  const myLabs = useLabStore((state) => state.myLabs);
  const currentRole = myLabs.find(m => m.lab_id === currentLabId)?.role;
  const isAdmin = currentRole === 'admin';

  const {
    query,
    setQuery,
    lastSearchQuery,
    result,
    mediaProducts,
    mediaBrands,
    mediaCount,
    cabinetResults,
    showAllProducts,
    setShowAllProducts,
    selectedBrand,
    sortBy,
    isLoading,
    isAiAnalyzing,
    error,
    handleBrandChange,
    handleSortChange,
    handleClearFilters,
    handleSearch,
    handleReset,
    navigateWithFreshFilters,
    suggestions,
    isSuggestionsLoading,
    clearSuggestions,
  } = useSearchFlow({
    pathname: location.pathname,
    searchParams,
    navigate,
    t,
    addSearchHistory,
  });

  const {
    activeTab,
    isScanning,
    setIsScanning,
    isCartOpen,
    setIsCartOpen,
    logRefreshKey,
    incrementLogRefreshKey,
    handleTabClick,
  } = useAppUiState({
    pathname: location.pathname,
    activeCabinetId,
    currentLabId,
    lastSearchQuery,
    navigate,
  });

  useEffect(() => {
    if (session) {
      loadSearchHistory();
    }
  }, [session, loadSearchHistory]);
  const handleNavigateToCabinet = useCallback((cabinetId: string, itemId: string) => {
    // Switch to cabinet tab and load the cabinet
    navigate(`/cabinet?id=${cabinetId}`);
    // Set highlight with a small delay to let the FridgeView mount
    setTimeout(() => {
      const store = useFridgeStore.getState();
      store.setHighlightedItemId(itemId);
      // Clear highlight after 6 seconds
      setTimeout(() => {
        if (useFridgeStore.getState().highlightedItemId === itemId) {
          useFridgeStore.getState().setHighlightedItemId(null);
        }
      }, 6000);
    }, 500);
  }, [navigate]);

  const handleCabinetSearchResultClick = useCallback(async (item: CabinetSearchResult) => {
    navigate(`/cabinet?id=${item.cabinetId}`);
    const store = useFridgeStore.getState();
    store.setMode('VIEW');
    await store.loadCabinet(item.cabinetId);
    useFridgeStore.getState().setFocusedShelfId(item.shelfId);
    useFridgeStore.getState().setHighlightedItemId(item.itemId);
  }, [navigate]);

  const handleScan = (scannedText: string) => {
    setIsScanning(false);
    navigateWithFreshFilters(scannedText);
  };

  // Auth Loading
  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  // Auth Gate
  if (!session) {
    if (useLabStore.getState().currentLabId !== null) {
      useLabStore.getState().clearLabState();
    }
    return <AuthView onSignIn={signIn} onSignUp={signUp} />;
  }

  return (
    <>
      <SafetyDisclaimer />

      {isScanning && (
        <Suspense fallback={
          <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
            <Loader2 className="w-10 h-10 text-white animate-spin" />
          </div>
        }>
          <Scanner
            onScan={handleScan}
            onClose={() => setIsScanning(false)}
          />
        </Suspense>
      )}

      {isCartOpen && (
        <CartView
          onClose={() => setIsCartOpen(false)}
          onDisposed={() => {
            incrementLogRefreshKey();
            navigate('/logs');
          }}
        />
      )}

      <MainLayout onLogoClick={handleReset} userEmail={user?.email} onSignOut={signOut} bottomNav={
        <BottomTabNav activeTab={activeTab} isAdmin={isAdmin} onTabClick={handleTabClick} />
      }>
        {activeTab === 'cabinet' ? (
          <div className="h-full">
            {activeCabinetId ? (
              <FridgeView cabinetId={activeCabinetId} onBack={() => navigate('/cabinet')} />
            ) : (
              <CabinetListView onSelectCabinet={(id) => navigate(`/cabinet?id=${id}`)} />
            )}
          </div>
        ) : activeTab === 'logs' ? (
          <WasteLogView key={logRefreshKey} />
        ) : activeTab === 'inventory' ? (
          <InventoryListView />
        ) : activeTab === 'admin' && isAdmin ? (
          <GlobalAuditLogsView />
        ) : (
          <SearchTabView
            cartCount={cart.length}
            query={query}
            isLoading={isLoading}
            isAiAnalyzing={isAiAnalyzing}
            error={error}
            result={result}
            mediaProducts={mediaProducts}
            mediaBrands={mediaBrands}
            mediaCount={mediaCount}
            cabinetResults={cabinetResults}
            showAllProducts={showAllProducts}
            selectedBrand={selectedBrand}
            sortBy={sortBy}
            recentSearches={recentSearches}
            onQueryChange={setQuery}
            onSearchSubmit={handleSearch}
            onReset={handleReset}
            onSuggestionClick={navigateWithFreshFilters}
            onOpenScanner={() => setIsScanning(true)}
            onClearSearchHistory={clearSearchHistory}
            onRemoveSearchHistory={removeSearchHistory}
            onCabinetResultClick={handleCabinetSearchResultClick}
            onBrandChange={handleBrandChange}
            onSortChange={handleSortChange}
            onClearFilters={handleClearFilters}
            onToggleShowAllProducts={() => setShowAllProducts(!showAllProducts)}
            onNavigateToCabinet={handleNavigateToCabinet}
            suggestions={suggestions}
            isSuggestionsLoading={isSuggestionsLoading}
            onClearSuggestions={clearSuggestions}
          />
        )}

        {/* Floating Cart Button */}
        {cart.length > 0 && !isCartOpen && (
          <button
            onClick={() => setIsCartOpen(true)}
            className="absolute bottom-20 right-6 w-14 h-14 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-full shadow-2xl flex items-center justify-center z-40 active:scale-90 transition-transform animate-in fade-in slide-in-from-bottom-4"
          >
            <ShoppingBag className="w-6 h-6" />
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center font-bold border-2 border-white dark:border-slate-900 text-white">{cart.length}</span>
          </button>
        )}
      </MainLayout>
    </>
  );
}

export default App;
