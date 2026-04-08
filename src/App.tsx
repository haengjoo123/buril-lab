import { useEffect, useCallback, lazy, Suspense, useState } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { MainLayout } from './components/MainLayout';
import { SearchTabView } from './components/SearchTabView';
import { BottomTabNav } from './components/BottomTabNav';

// Lazy load Scanner — react-webcam + Vision OCR are heavy and only needed on camera open
const Scanner = lazy(() => import('./components/Scanner'));
import { CartView } from './components/CartView';
import { AuthView } from './components/AuthView';
import { SafetyDisclaimer } from './components/SafetyDisclaimer';
import { PrivacyPolicyView } from './components/PrivacyPolicyView';
import type { CabinetSearchResult } from './services/cabinetService';
import { useWasteStore } from './store/useWasteStore';
import { useAuth } from './hooks/useAuth';
import { useAppUiState } from './hooks/useAppUiState';
import { useSearchFlow } from './hooks/useSearchFlow';
import { useLabStore } from './store/useLabStore';
import { useFridgeStore } from './store/fridgeStore';
import { useOnboardingStore } from './store/useOnboardingStore';
import { useTranslation } from 'react-i18next';
import { Loader2, ShoppingBag } from 'lucide-react';
import { OnboardingWelcomeModal } from './components/onboarding/OnboardingWelcomeModal';
import { isAuthRequiredPath, sanitizeReturnTo } from './utils/authRoutes';

// Split heavy tabs to reduce initial dev-time module transform cost.
const WasteLogView = lazy(() =>
  import('./components/WasteLogView').then((module) => ({ default: module.WasteLogView }))
);
const FridgeView = lazy(() =>
  import('./features/fridge/FridgeView').then((module) => ({ default: module.FridgeView }))
);
const CabinetListView = lazy(() =>
  import('./features/fridge/CabinetListView').then((module) => ({ default: module.CabinetListView }))
);
const InventoryListView = lazy(() =>
  import('./features/inventory/InventoryListView').then((module) => ({ default: module.InventoryListView }))
);
const GlobalAuditLogsView = lazy(() =>
  import('./features/admin/GlobalAuditLogsView').then((module) => ({ default: module.GlobalAuditLogsView }))
);

function TabContentFallback() {
  return (
    <div className="h-full min-h-[16rem] flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
    </div>
  );
}

function App() {
  const { t, i18n } = useTranslation();
  const { session, user, isLoading: isAuthLoading, signIn, signUp, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const locationState = location.state as { cabinetId?: string; itemId?: string } | null;

  const activeCabinetId = searchParams.get('id') || locationState?.cabinetId || null;

  const cart = useWasteStore((state) => state.cart);
  const { recentSearches, addSearchHistory, removeSearchHistory, clearSearchHistory, loadSearchHistory } = useWasteStore();
  const [isSafetyAcknowledged, setIsSafetyAcknowledged] = useState(() => localStorage.getItem('buril-safety-acknowledged') === 'true');
  const currentLabId = useLabStore((state) => state.currentLabId);
  const myLabs = useLabStore((state) => state.myLabs);
  const currentRole = myLabs.find(m => m.lab_id === currentLabId)?.role;
  const isAdmin = currentRole === 'admin';
  const isWelcomeOpen = useOnboardingStore((state) => state.isWelcomeOpen);
  const hasCompletedWelcome = useOnboardingStore((state) => state.hasCompletedWelcome);
  const hasSkippedOnboarding = useOnboardingStore((state) => state.hasSkippedOnboarding);
  const syncVersion = useOnboardingStore((state) => state.syncVersion);
  const openWelcome = useOnboardingStore((state) => state.openWelcome);

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
    isAuthenticated: !!session,
  });

  const isLoginRoute = location.pathname === '/login';
  const isPrivacyRoute = location.pathname === '/privacy';

  useEffect(() => {
    if (session) {
      loadSearchHistory();
    }
  }, [session, loadSearchHistory]);

  // 게스트에게는 저장된 연구실 컨텍스트가 남지 않도록 정리
  useEffect(() => {
    if (session) return;
    if (useLabStore.getState().currentLabId !== null) {
      useLabStore.getState().clearLabState();
    }
  }, [session]);

  // 보호 경로 직접 진입 시 로그인으로 치환
  useEffect(() => {
    if (isAuthLoading || session) return;
    if (isLoginRoute) return;
    if (!isAuthRequiredPath(location.pathname)) return;
    const returnTo = `${location.pathname}${location.search}`;
    navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`, { replace: true });
  }, [isAuthLoading, session, isLoginRoute, location.pathname, location.search, navigate]);

  // 로그인 완료 후 /login 에서 원래 화면으로
  useEffect(() => {
    if (isAuthLoading || !session) return;
    if (!isLoginRoute) return;
    const raw = searchParams.get('returnTo');
    const dest = sanitizeReturnTo(raw) ?? '/';
    navigate(dest, { replace: true });
  }, [isAuthLoading, session, isLoginRoute, navigate, searchParams]);

  useEffect(() => {
    syncVersion();
  }, [syncVersion]);

  // Update HTML lang attribute for localized date input placeholders
  useEffect(() => {
    const lang = i18n.language.startsWith('ko') ? 'ko' : 'en';
    document.documentElement.lang = lang;
  }, [i18n.language]);

  useEffect(() => {
    const handleSafetyAcknowledged = () => setIsSafetyAcknowledged(true);
    window.addEventListener('buril:safety-acknowledged', handleSafetyAcknowledged);

    return () => {
      window.removeEventListener('buril:safety-acknowledged', handleSafetyAcknowledged);
    };
  }, []);

  useEffect(() => {
    if (!session || !isSafetyAcknowledged || isWelcomeOpen || hasCompletedWelcome || hasSkippedOnboarding) {
      return;
    }

    openWelcome();
  }, [session, isSafetyAcknowledged, isWelcomeOpen, hasCompletedWelcome, hasSkippedOnboarding, openWelcome]);
  useEffect(() => {
    if (location.pathname !== '/cabinet' || searchParams.get('id') || !locationState?.cabinetId) {
      return;
    }

    // 상태 기반 진입도 새로고침/공유 시 일관되도록 URL에 캐비닛 ID를 복원합니다.
    navigate(`/cabinet?id=${locationState.cabinetId}`, {
      replace: true,
      state: locationState,
    });
  }, [location.pathname, locationState, navigate, searchParams]);

  const handleNavigateToCabinet = useCallback((cabinetId: string, itemId: string) => {
    if (!session) {
      const returnTo = `/cabinet?id=${cabinetId}`;
      navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }

    navigate(`/cabinet?id=${cabinetId}`, {
      state: { cabinetId, itemId },
    });

    void (async () => {
      const store = useFridgeStore.getState();
      store.setMode('VIEW');
      store.setFocusedShelfId(null);

      await store.loadCabinet(cabinetId);

      // 배치된 아이템이 있는 선반까지 함께 포커스해야 상세 화면 진입 직후 바로 위치를 보여줄 수 있습니다.
      const matchedShelf = useFridgeStore.getState().shelves.find((shelf) =>
        shelf.items.some((item) => item.id === itemId)
      );

      useFridgeStore.getState().setFocusedShelfId(matchedShelf?.id ?? null);
      useFridgeStore.getState().setHighlightedItemId(itemId);

      setTimeout(() => {
        if (useFridgeStore.getState().highlightedItemId === itemId) {
          useFridgeStore.getState().setHighlightedItemId(null);
        }
      }, 6000);
    })();
  }, [navigate, session]);

  const handleCabinetSearchResultClick = useCallback(async (item: CabinetSearchResult) => {
    if (!session) {
      const returnTo = `/cabinet?id=${item.cabinetId}`;
      navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }

    navigate(`/cabinet?id=${item.cabinetId}`);
    const store = useFridgeStore.getState();
    store.setMode('VIEW');
    await store.loadCabinet(item.cabinetId);
    useFridgeStore.getState().setFocusedShelfId(item.shelfId);
    useFridgeStore.getState().setHighlightedItemId(item.itemId);
  }, [navigate, session]);

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

  if (isPrivacyRoute) {
    return <PrivacyPolicyView onBack={() => navigate(-1)} />;
  }

  const guestRedirectingToLogin =
    !session && !isLoginRoute && isAuthRequiredPath(location.pathname);

  if (guestRedirectingToLogin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!session && isLoginRoute) {
    const showAuthPrompt = Boolean(searchParams.get('returnTo'));
    return (
      <AuthView
        onSignIn={signIn}
        onSignUp={signUp}
        authPrompt={showAuthPrompt ? t('auth_required_for_feature') : undefined}
        onBackToSearch={() => navigate('/')}
      />
    );
  }

  if (!session) {
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

        <MainLayout
          onLogoClick={handleReset}
          hideLabSwitcher
          onLoginClick={() => navigate('/login')}
          bottomNav={
            <BottomTabNav activeTab={activeTab} isAdmin={false} onTabClick={handleTabClick} />
          }
        >
          <SearchTabView
            cartCount={0}
            query={query}
            lastSearchQuery={lastSearchQuery}
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
            onRequireAuth={() =>
              navigate(`/login?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`)
            }
          />
        </MainLayout>
      </>
    );
  }

  return (
    <>
      <SafetyDisclaimer />

      {isWelcomeOpen && <OnboardingWelcomeModal />}

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
        <Suspense fallback={<TabContentFallback />}>
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
              lastSearchQuery={lastSearchQuery}
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
        </Suspense>

        {/* Floating Cart Button */}
        {cart.length > 0 && !isCartOpen && (
          <button
            onClick={() => setIsCartOpen(true)}
            className={`absolute ${activeTab === 'inventory' ? 'bottom-24 right-24' : 'bottom-20 right-6'} w-14 h-14 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-full shadow-2xl flex items-center justify-center z-40 active:scale-90 transition-transform animate-in fade-in slide-in-from-bottom-4`}
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
