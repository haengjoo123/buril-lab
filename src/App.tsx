import { useEffect, useCallback, lazy, Suspense, useState } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { MainLayout } from './components/MainLayout';
import { SearchTabView } from './components/SearchTabView';
import { BottomTabNav } from './components/BottomTabNav';
import { VoiceAgentSheet } from './components/VoiceAgentSheet';
import { openVoiceAgentSheet } from './components/openVoiceAgentSheet';
import { GatewayLanding } from './components/GatewayLanding';

const Scanner = lazy(() => import('./components/Scanner'));

import { CartView } from './components/CartView';
import { AuthView } from './components/AuthView';
import { ResetPasswordView } from './components/ResetPasswordView';
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
import { SafetyCenterShell } from './features/safety-center/SafetyCenterShell';
import { isAuthRequiredPath, sanitizeReturnTo } from './utils/authRoutes';
import {
  getLegacyLabAppRedirect,
  isOpsPath,
  isLabAppPath,
  isSafetyCenterPath,
  labAppRoute,
} from './utils/appRoutes';
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
const SafetyCenterWorkspace = lazy(() =>
  import('./features/safety-center/SafetyCenterWorkspace').then((module) => ({ default: module.SafetyCenterWorkspace }))
);
const OpsConsoleView = lazy(() =>
  import('./features/ops/OpsConsoleView').then((module) => ({ default: module.OpsConsoleView }))
);

const isNativeApp = Capacitor.isNativePlatform();

function TabContentFallback() {
  return (
    <div className="h-full min-h-[16rem] flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
    </div>
  );
}

function FullScreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950">
      <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
    </div>
  );
}

function App() {
  const { t, i18n } = useTranslation();
  const { session, user, isLoading: isAuthLoading, signIn, signUp, requestPasswordReset, signOut } = useAuth();
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

  const isAuthenticated = !!session;
  const navigateToLogin = useCallback((returnTo: string = `${location.pathname}${location.search}`) => {
    navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }, [location.pathname, location.search, navigate]);

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
    isAuthenticated,
  });

  const isLoginRoute = location.pathname === '/login';
  const isResetPasswordRoute = location.pathname === '/reset-password';
  const isPrivacyRoute = location.pathname === '/privacy';
  const isFeedbackAdminRoute = location.pathname === '/feedback-admin';
  const isGatewayRoute = location.pathname === '/';
  const isLabRoute = isLabAppPath(location.pathname);
  const isCenterRoute = isSafetyCenterPath(location.pathname);
  const isOpsRoute = isOpsPath(location.pathname);
  const legacyLabAppRedirect = getLegacyLabAppRedirect(location.pathname);
  const legacyOpsRedirect = isFeedbackAdminRoute ? '/ops/feedback' : null;
  const nativeGatewayRedirect = isNativeApp && isGatewayRoute ? labAppRoute() : null;
  const rootSearchRedirect = isGatewayRoute && searchParams.has('q') ? labAppRoute() : null;
  const labAppRedirectTarget = legacyLabAppRedirect ?? nativeGatewayRedirect ?? rootSearchRedirect;

  useEffect(() => {
    if (session) {
      loadSearchHistory();
    }
  }, [session, loadSearchHistory]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (session) return;
    if (useLabStore.getState().currentLabId !== null) {
      useLabStore.getState().clearLabState();
    }
  }, [isAuthLoading, session]);

  useEffect(() => {
    if (!labAppRedirectTarget) return;
    navigate(`${labAppRedirectTarget}${location.search}`, { replace: true });
  }, [labAppRedirectTarget, location.search, navigate]);

  useEffect(() => {
    if (!legacyOpsRedirect) return;
    navigate(legacyOpsRedirect, { replace: true });
  }, [legacyOpsRedirect, navigate]);

  useEffect(() => {
    if (isAuthLoading || labAppRedirectTarget || legacyOpsRedirect) return;
    if (isGatewayRoute || isLoginRoute || isResetPasswordRoute || isPrivacyRoute || isFeedbackAdminRoute || isCenterRoute || isOpsRoute || isLabRoute) return;
    navigate(labAppRoute(), { replace: true });
  }, [
    isAuthLoading,
    labAppRedirectTarget,
    legacyOpsRedirect,
    isGatewayRoute,
    isLoginRoute,
    isResetPasswordRoute,
    isPrivacyRoute,
    isFeedbackAdminRoute,
    isCenterRoute,
    isOpsRoute,
    isLabRoute,
    navigate,
  ]);

  useEffect(() => {
    if (isAuthLoading || session) return;
    if (labAppRedirectTarget) return;
    if (isLoginRoute || isResetPasswordRoute) return;
    if (!isAuthRequiredPath(location.pathname)) return;
    const returnTo = `${location.pathname}${location.search}`;
    navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`, { replace: true });
  }, [isAuthLoading, session, labAppRedirectTarget, isLoginRoute, isResetPasswordRoute, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (isAuthLoading || !session) return;
    if (!isLoginRoute) return;
    const raw = searchParams.get('returnTo');
    const destination = sanitizeReturnTo(raw) ?? labAppRoute();
    navigate(destination, { replace: true });
  }, [isAuthLoading, session, isLoginRoute, navigate, searchParams]);

  useEffect(() => {
    syncVersion();
  }, [syncVersion]);

  useEffect(() => {
    document.documentElement.lang = i18n.language.startsWith('ko') ? 'ko' : 'en';
  }, [i18n.language]);

  useEffect(() => {
    document.title = t('app_title');
  }, [i18n.language, t]);

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
    if (location.pathname !== labAppRoute('/cabinet') || searchParams.get('id') || !locationState?.cabinetId) {
      return;
    }

    navigate(labAppRoute(`/cabinet?id=${locationState.cabinetId}`), {
      replace: true,
      state: locationState,
    });
  }, [location.pathname, locationState, navigate, searchParams]);

  const handleNavigateToCabinet = useCallback((cabinetId: string, itemId: string) => {
    if (!session) {
      const returnTo = labAppRoute(`/cabinet?id=${cabinetId}`);
      navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }

    navigate(labAppRoute(`/cabinet?id=${cabinetId}`), {
      state: { cabinetId, itemId },
    });

    void focusCabinetItem({ cabinetId, itemId });
  }, [navigate, session]);

  const handleCabinetSearchResultClick = useCallback(async (item: CabinetSearchResult) => {
    if (!session) {
      const returnTo = labAppRoute(`/cabinet?id=${item.cabinetId}`);
      navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }

    navigate(labAppRoute(`/cabinet?id=${item.cabinetId}`));
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

      navigate(`${labAppRoute()}?q=${encodeURIComponent(searchQuery)}`);
      return;
    }

    if (_result.intent !== 'location') {
      return;
    }

    if (action.type !== 'focus_cabinet_item' || !action.cabinetId || !action.highlightItemId) {
      return;
    }

    if (!session) {
      navigateToLogin(labAppRoute(`/cabinet?id=${action.cabinetId}`));
      return;
    }

    navigate(labAppRoute(`/cabinet?id=${action.cabinetId}`), {
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
  }, [navigate, navigateToLogin, session]);

  const handleScan = (scannedText: string) => {
    setIsScanning(false);
    navigateWithFreshFilters(scannedText);
  };

  if (isAuthLoading) {
    return <FullScreenLoader />;
  }

  if (isPrivacyRoute) {
    return <PrivacyPolicyView onBack={() => navigate(-1)} />;
  }

  if (isResetPasswordRoute) {
    return <ResetPasswordView />;
  }

  if (labAppRedirectTarget) {
    return <FullScreenLoader />;
  }

  if (isGatewayRoute) {
    return (
      <GatewayLanding
        isAuthenticated={!!session}
        userEmail={user?.email}
        onNavigateToApp={() => navigate(labAppRoute())}
        onNavigateToCenter={() => navigate('/center')}
        onLoginClick={() => navigate('/login')}
        onSignOut={session ? signOut : undefined}
      />
    );
  }

  const guestRedirectingToLogin =
    !session && !isLoginRoute && isAuthRequiredPath(location.pathname);

  if (guestRedirectingToLogin) {
    return <FullScreenLoader />;
  }

  if (!session && isLoginRoute) {
    const showAuthPrompt = Boolean(searchParams.get('returnTo'));
    return (
      <AuthView
        onSignIn={signIn}
        onSignUp={signUp}
        onRequestPasswordReset={requestPasswordReset}
        authPrompt={showAuthPrompt ? t('auth_required_for_feature') : undefined}
        onBackToSearch={() => navigate(labAppRoute(), { replace: true })}
      />
    );
  }

  if (!session && !isLabRoute) {
    return (
      <GatewayLanding
        isAuthenticated={false}
        onNavigateToApp={() => navigate(labAppRoute())}
        onNavigateToCenter={() => navigate('/center')}
        onLoginClick={() => navigate('/login')}
      />
    );
  }

  if (isOpsRoute) {
    return (
      <>
        <SafetyDisclaimer />

        {isWelcomeOpen && <OnboardingWelcomeModal />}

        <Suspense fallback={<FullScreenLoader />}>
          <OpsConsoleView
            userEmail={user?.email}
            onSignOut={signOut}
            onExitToApp={() => navigate(labAppRoute())}
          />
        </Suspense>
      </>
    );
  }

  if (isFeedbackAdminRoute) {
    return <FullScreenLoader />;
  }

  if (isCenterRoute) {
    return (
      <>
        <SafetyDisclaimer />

        {isWelcomeOpen && <OnboardingWelcomeModal />}

        <SafetyCenterShell
          userEmail={user?.email}
          onSignOut={signOut}
          onExitToLab={() => navigate(labAppRoute())}
        >
          <Suspense fallback={<TabContentFallback />}>
            <SafetyCenterWorkspace />
          </Suspense>
        </SafetyCenterShell>
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

      {isCartOpen && isAuthenticated && (
        <CartView
          onClose={() => setIsCartOpen(false)}
          onDisposed={() => {
            incrementLogRefreshKey();
            navigate(labAppRoute('/logs'));
          }}
        />
      )}

      <MainLayout
        onLogoClick={handleReset}
        userEmail={user?.email}
        onSignOut={isAuthenticated ? signOut : undefined}
        onLoginClick={!isAuthenticated ? () => navigateToLogin() : undefined}
        activeTab={activeTab}
        isAdmin={isAdmin}
        onTabClick={handleTabClick}
        cartCount={cart.length}
        onCartClick={() => {
          if (!isAuthenticated) {
            navigateToLogin(labAppRoute());
            return;
          }

          setIsCartOpen(true);
        }}
        bottomNav={
          <BottomTabNav activeTab={activeTab} isAdmin={isAdmin} onTabClick={handleTabClick} />
        }
      >
        <Suspense fallback={<TabContentFallback />}>
          {activeTab === 'cabinet' ? (
            <div className="h-full">
              {activeCabinetId ? (
                <FridgeView
                  cabinetId={activeCabinetId}
                  onBack={() => navigate(labAppRoute('/cabinet'))}
                />
              ) : (
                <CabinetListView onSelectCabinet={(id) => navigate(labAppRoute(`/cabinet?id=${id}`))} />
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
              cartItems={cart}
              onOpenCart={() => {
                if (!isAuthenticated) {
                  navigateToLogin(labAppRoute());
                  return;
                }

                setIsCartOpen(true);
              }}
              showRecentWasteLogs={isAuthenticated}
              onOpenLogs={() => {
                if (!isAuthenticated) {
                  navigateToLogin(labAppRoute('/logs'));
                  return;
                }

                navigate(labAppRoute('/logs'));
              }}
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
              onRequireAuth={!isAuthenticated ? () => navigateToLogin() : undefined}
              onOpenVoiceAgent={() => openVoiceAgentSheet({
                screen: 'search',
                language: i18n.language.startsWith('ko') ? 'ko' : 'en',
              })}
            />
          )}
        </Suspense>

        {cart.length > 0 && !isCartOpen && (
          <button
            onClick={() => {
              if (!isAuthenticated) {
                navigateToLogin(labAppRoute());
                return;
              }

              setIsCartOpen(true);
            }}
            className={`absolute ${activeTab === 'inventory' ? 'bottom-24 right-24' : 'bottom-20 right-6'} z-40 flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-2xl transition-transform animate-in fade-in slide-in-from-bottom-4 active:scale-90 dark:bg-slate-100 dark:text-slate-900 lg:hidden`}
            aria-label={`${t('cart_title')} ${cart.length}`}
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
