import { useEffect, useCallback, lazy, Suspense, useState } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { MainLayout } from './components/MainLayout';
import { SearchTabView } from './components/SearchTabView';
import { BottomTabNav } from './components/BottomTabNav';
import { VoiceAgentSheet, openVoiceAgentSheet } from './components/VoiceAgentSheet';

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
import { useOnboardingStore } from './store/useOnboardingStore';
import { useTranslation } from 'react-i18next';
import { Loader2, ShoppingBag } from 'lucide-react';
import { OnboardingWelcomeModal } from './components/onboarding/OnboardingWelcomeModal';
import { isAuthRequiredPath, sanitizeReturnTo } from './utils/authRoutes';
import { focusCabinetItem } from './services/cabinetFocusService';
import type { VoiceQueryResponse, VoiceUiAction } from './utils/voiceAgent';

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
  const currentRole = myLabs.find((membership) => membership.lab_id === currentLabId)?.role;
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

  useEffect(() => {
    if (session) return;
    if (useLabStore.getState().currentLabId !== null) {
      useLabStore.getState().clearLabState();
    }
  }, [session]);

  useEffect(() => {
    if (isAuthLoading || session) return;
    if (isLoginRoute) return;
    if (!isAuthRequiredPath(location.pathname)) return;
    const returnTo = `${location.pathname}${location.search}`;
    navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`, { replace: true });
  }, [isAuthLoading, session, isLoginRoute, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (isAuthLoading || !session) return;
    if (!isLoginRoute) return;
    const raw = searchParams.get('returnTo');
    const destination = sanitizeReturnTo(raw) ?? '/';
    navigate(destination, { replace: true });
  }, [isAuthLoading, session, isLoginRoute, navigate, searchParams]);

  useEffect(() => {
    syncVersion();
  }, [syncVersion]);

  useEffect(() => {
    document.documentElement.lang = i18n.language.startsWith('ko') ? 'ko' : 'en';
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

    void focusCabinetItem({ cabinetId, itemId });
  }, [navigate, session]);

  const handleCabinetSearchResultClick = useCallback(async (item: CabinetSearchResult) => {
    if (!session) {
      const returnTo = `/cabinet?id=${item.cabinetId}`;
      navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }

    navigate(`/cabinet?id=${item.cabinetId}`);
    await focusCabinetItem({
      cabinetId: item.cabinetId,
      itemId: item.itemId,
      shelfId: item.shelfId,
    });
  }, [navigate, session]);

  const handleVoiceUiAction = useCallback(async (action: VoiceUiAction, _result: VoiceQueryResponse) => {
    if (action.type === 'search_reagent') {
      const searchQuery = action.query?.trim() || _result.match?.name?.trim() || _result.resolvedText.trim();
      if (!searchQuery) {
        return;
      }

      navigate(`/?q=${encodeURIComponent(searchQuery)}`);
      return;
    }

    if (_result.intent !== 'location') {
      return;
    }

    if (action.type !== 'focus_cabinet_item' || !action.cabinetId || !action.highlightItemId) {
      return;
    }

    navigate(`/cabinet?id=${action.cabinetId}`, {
      state: {
        cabinetId: action.cabinetId,
        itemId: action.highlightItemId,
      },
    });

    await focusCabinetItem({
      cabinetId: action.cabinetId,
      itemId: action.highlightItemId,
      shelfId: action.shelfId,
    });
  }, [navigate]);

  const handleScan = (scannedText: string) => {
    setIsScanning(false);
    navigateWithFreshFilters(scannedText);
  };

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
                <FridgeView
                  cabinetId={activeCabinetId}
                  onBack={() => navigate('/cabinet')}
                  onOpenVoiceAgent={() => openVoiceAgentSheet({
                    screen: 'cabinet',
                    cabinetId: activeCabinetId,
                    language: i18n.language.startsWith('ko') ? 'ko' : 'en',
                  })}
                />
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
              onOpenVoiceAgent={() => openVoiceAgentSheet({
                screen: 'search',
                language: i18n.language.startsWith('ko') ? 'ko' : 'en',
              })}
            />
          )}
        </Suspense>

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

      <VoiceAgentSheet
        currentContext={{
          screen: activeTab === 'cabinet' ? 'cabinet' : 'search',
          cabinetId: activeCabinetId || undefined,
          language: i18n.language.startsWith('ko') ? 'ko' : 'en',
        }}
        onUiAction={handleVoiceUiAction}
      />
    </>
  );
}

export default App;
