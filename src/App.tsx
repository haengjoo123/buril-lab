import { useEffect, useCallback, lazy, Suspense, useRef, useState } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { MainLayout } from './components/MainLayout';
import { SearchTabView } from './components/SearchTabView';
import { BottomTabNav } from './components/BottomTabNav';
import { VoiceAgentSheet } from './components/VoiceAgentSheet';
import { openVoiceAgentSheet } from './components/openVoiceAgentSheet';
import { GatewayLanding } from './components/GatewayLanding';

const Scanner = lazy(() => import('./components/Scanner'));
import type { ScannerSelectionMeta } from './components/Scanner';

import { CartView } from './components/CartView';
import { WasteV2DisabledCartView } from './components/WasteV2DisabledCartView';
import { isChemicalEnrichmentEnabled, isWasteV2Enabled } from './config/featureFlags';
import { AuthView } from './components/AuthView';
import { ResetPasswordView } from './components/ResetPasswordView';
import { SafetyDisclaimer } from './components/SafetyDisclaimer';
import { PrivacyPolicyView } from './components/PrivacyPolicyView';
import type { CabinetSearchResult } from './services/cabinetService';
import type { InventoryItem } from './services/inventoryService';
import { searchChemical } from './services/searchService';
import { analyzeChemical } from './utils/chemicalAnalyzer';
import { normalizeCasNumber } from './utils/casNumber';
import { useWasteStore } from './store/useWasteStore';
import { useAuth } from './hooks/useAuth';
import { useAppUiState, type AppTab } from './hooks/useAppUiState';
import { useSearchFlow } from './hooks/useSearchFlow';
import { useLabStore } from './store/useLabStore';
import { useOnboardingStore, type OnboardingMissionKey } from './store/useOnboardingStore';
import { useTranslation } from 'react-i18next';
import { Loader2, ShoppingBag } from 'lucide-react';
import { OnboardingMissionPanel } from './components/onboarding/OnboardingMissionPanel';
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
import { analyticsService } from './services/analyticsService';
import type { VoiceQueryResponse, VoiceUiAction } from './utils/voiceAgent';
import {
  requiresSolidSlurryWasteBatch,
  type WasteBatchDisposalReason,
} from './features/fridge/reagentDisposalFlow';

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
const onboardingPlatform = isNativeApp ? 'native' : 'web';

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
  const parkedBatchCount = useWasteStore((state) => state.parkedBatches.length);
  const wasteDraftCount = parkedBatchCount + (cart.length > 0 ? 1 : 0);
  const setWasteScope = useWasteStore((state) => state.setScope);
  const refreshChemicalEnrichment = useWasteStore((state) => state.refreshChemicalEnrichment);
  const { recentSearches, addSearchHistory, removeSearchHistory, clearSearchHistory, loadSearchHistory } = useWasteStore();
  const [isSafetyAcknowledged, setIsSafetyAcknowledged] = useState(() => localStorage.getItem('buril-safety-acknowledged') === 'true');
  const [isSearchInputFocused, setIsSearchInputFocused] = useState(false);
  const [isAddingWasteComponent, setIsAddingWasteComponent] = useState(false);
  const [wasteComponentSearchRequestKey, setWasteComponentSearchRequestKey] = useState(0);
  const [scanSelection, setScanSelection] = useState<{
    searchTerm: string;
    meta: ScannerSelectionMeta;
  } | null>(null);
  const [onboardingCheckedUserId, setOnboardingCheckedUserId] = useState<string | null>(null);
  const currentLabId = useLabStore((state) => state.currentLabId);
  const myLabs = useLabStore((state) => state.myLabs);
  const currentRole = myLabs.find((membership) => membership.lab_id === currentLabId)?.role;
  const isAdmin = currentRole === 'admin';
  const isWelcomeOpen = useOnboardingStore((state) => state.isWelcomeOpen);
  const hasCompletedWelcome = useOnboardingStore((state) => state.hasCompletedWelcome);
  const hasSkippedOnboarding = useOnboardingStore((state) => state.hasSkippedOnboarding);
  const hasCompletedMissionOnboarding = useOnboardingStore((state) => state.hasCompletedMissionOnboarding);
  const syncVersion = useOnboardingStore((state) => state.syncVersion);
  const setActiveOnboardingUser = useOnboardingStore((state) => state.setActiveUser);
  const applyRemoteOnboardingProgress = useOnboardingStore((state) => state.applyRemoteOnboardingProgress);
  const openWelcome = useOnboardingStore((state) => state.openWelcome);
  const markMissionCompleted = useOnboardingStore((state) => state.markMissionCompleted);
  const activeOnboardingUserId = session?.user?.id ?? user?.id ?? null;
  const hasAuthSession = Boolean(session);
  const isOnboardingRemoteChecked = hasAuthSession
    && Boolean(activeOnboardingUserId)
    && onboardingCheckedUserId === activeOnboardingUserId;

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

  useEffect(() => {
    if (!scanSelection || !lastSearchQuery) return;
    if (scanSelection.searchTerm.trim().toLowerCase() !== lastSearchQuery.trim().toLowerCase()) {
      setScanSelection(null);
    }
  }, [lastSearchQuery, scanSelection]);

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

  const handleStartInventoryWasteBatch = useCallback(async (
    item: InventoryItem,
    options?: { reason?: WasteBatchDisposalReason },
  ) => {
    const wasteState = useWasteStore.getState();
    const requiresSolidMatrix = requiresSolidSlurryWasteBatch(options?.reason);
    const incidentContext = options?.reason === 'broken' || options?.reason === 'leak'
      ? options.reason
      : null;
    const initialScopeKey = wasteState.scopeKey;
    const initialWasEmpty = wasteState.batch.components.length === 0;
    if (
      (item.lab_id ?? null) !== (wasteState.batch.labId ?? null) ||
      (item.lab_id === null && item.user_id !== (wasteState.batch.userId ?? null))
    ) {
      throw new Error(t('cabinet_waste_scope_changed'));
    }
    if (incidentContext && !initialWasEmpty) {
      throw new Error(t('cabinet_incident_waste_batch_conflict'));
    }
    if (requiresSolidMatrix && !initialWasEmpty && wasteState.batch.matrix !== 'solid_slurry') {
      throw new Error(t('cabinet_solid_waste_batch_conflict'));
    }

    const verifiedInventoryCas = normalizeCasNumber(item.cas_number);
    const queryForLookup = verifiedInventoryCas || item.name;
    let chemical = null;
    try {
      chemical = await searchChemical(queryForLookup);
    } catch (lookupError) {
      console.warn('[Waste V2] Inventory chemical lookup failed; preserving an unverified component.', lookupError);
    }

    const analysis = analyzeChemical(chemical ?? {
      id: `inventory:${item.id}`,
      name: item.name,
      casNumber: verifiedInventoryCas ?? '',
      molecularFormula: '',
      properties: {
        isOrganic: false,
        isHalogenated: false,
      },
    });
    const identityWasVerifiedByCas = Boolean(
      verifiedInventoryCas &&
      chemical &&
      normalizeCasNumber(chemical.casNumber) === verifiedInventoryCas,
    );
    const isCabinetItem = item._source === 'cabinet_item';
    const latestWasteState = useWasteStore.getState();
    if (
      latestWasteState.scopeKey !== initialScopeKey ||
      (item.lab_id ?? null) !== (latestWasteState.batch.labId ?? null) ||
      (item.lab_id === null && item.user_id !== (latestWasteState.batch.userId ?? null))
    ) {
      throw new Error(t('cabinet_waste_scope_changed'));
    }
    const wasEmpty = latestWasteState.batch.components.length === 0;
    if (incidentContext && !wasEmpty) {
      throw new Error(t('cabinet_incident_waste_batch_conflict'));
    }
    if (requiresSolidMatrix && !wasEmpty && latestWasteState.batch.matrix !== 'solid_slurry') {
      throw new Error(t('cabinet_solid_waste_batch_conflict'));
    }

    latestWasteState.addToCart(analysis, {
      sourceType: isCabinetItem ? 'cabinet' : 'inventory',
      sourceRef: item.id,
      inventoryId: isCabinetItem ? undefined : item.id,
      cabinetId: isCabinetItem ? item.id : undefined,
      // Name-only lookups can resolve to similarly named materials. Only an
      // exact, checksum-valid CAS match is automatically confirmed.
      identityConfidence: identityWasVerifiedByCas ? 'verified' : 'review_required',
      ghsDataStatus: chemical?.hazardLookup?.status === 'classified' || chemical?.hazardLookup?.status === 'not_classified'
        ? 'verified'
        : chemical?.hazardLookup?.status === 'source_absent' || chemical?.hazardLookup?.status === 'identity_ambiguous'
          ? 'lookup_failed'
          : chemical ? 'not_checked' : 'lookup_failed',
      inventoryDisposalQuantity: isCabinetItem || item.quantity <= 1 ? 1 : undefined,
      inventorySnapshot: {
        brand: item.brand,
        productNumber: item.product_number,
        location: item.cabinet_name || item.storage_location_name || null,
        nominalCapacity: item.capacity,
        quantity: item.quantity,
        remainingPercent: item.remaining_percent,
      },
    });
    if (wasEmpty && requiresSolidMatrix) {
      useWasteStore.getState().setMatrix('solid_slurry');
    }
    if (wasEmpty && options?.reason === 'leak') {
      // A spill can involve liquid, absorbent, packaging, or an unknown matrix.
      // Do not infer an ordinary solvent stream from the inventory product alone.
      useWasteStore.getState().setMatrix('unknown');
    }
    if (incidentContext) {
      useWasteStore.getState().setIncidentContext(incidentContext);
    }
    setIsCartOpen(true);
  }, [setIsCartOpen, t]);
  const wasOnboardingOpenRef = useRef(false);
  const onboardingBaselineRef = useRef({
    result,
    cartCount: cart.length,
  });
  const previousOnboardingTabRef = useRef(activeTab);

  useEffect(() => {
    if (activeTab !== 'search') {
      setIsSearchInputFocused(false);
    }
  }, [activeTab]);

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
    setWasteScope(activeOnboardingUserId, currentLabId);
  }, [activeOnboardingUserId, currentLabId, setWasteScope]);

  useEffect(() => {
    if (!activeOnboardingUserId || !isChemicalEnrichmentEnabled) return;
    void refreshChemicalEnrichment();
  }, [activeOnboardingUserId, currentLabId, refreshChemicalEnrichment]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;

    let disposed = false;
    let removeListener: (() => Promise<void>) | undefined;
    void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (isScanning) {
        setIsScanning(false);
        return;
      }
      if (isCartOpen) {
        setIsCartOpen(false);
        return;
      }
      if (canGoBack) {
        navigate(-1);
        return;
      }
      if (window.confirm(t('native_exit_confirm' as never))) {
        void CapacitorApp.exitApp();
      }
    }).then((handle) => {
      if (disposed) {
        void handle.remove();
        return;
      }
      removeListener = handle.remove;
    });

    return () => {
      disposed = true;
      void removeListener?.();
    };
  }, [isCartOpen, isScanning, navigate, setIsCartOpen, setIsScanning, t]);

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
    setActiveOnboardingUser(activeOnboardingUserId);
  }, [activeOnboardingUserId, setActiveOnboardingUser]);

  useEffect(() => {
    if (!hasAuthSession || !activeOnboardingUserId) {
      setOnboardingCheckedUserId(null);
      return;
    }

    let isCancelled = false;

    void analyticsService.getOnboardingProgress().then((progress) => {
      if (isCancelled) return;

      if (progress) {
        applyRemoteOnboardingProgress(activeOnboardingUserId, progress);
      }

      setOnboardingCheckedUserId(activeOnboardingUserId);
    });

    return () => {
      isCancelled = true;
    };
  }, [activeOnboardingUserId, applyRemoteOnboardingProgress, hasAuthSession]);

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
    if (
      !session ||
      !isSafetyAcknowledged ||
      !isOnboardingRemoteChecked ||
      !isLabRoute ||
      isWelcomeOpen ||
      hasCompletedWelcome ||
      hasCompletedMissionOnboarding ||
      hasSkippedOnboarding
    ) {
      return;
    }

    openWelcome();
  }, [
    session,
    isSafetyAcknowledged,
    isOnboardingRemoteChecked,
    isLabRoute,
    isWelcomeOpen,
    hasCompletedWelcome,
    hasCompletedMissionOnboarding,
    hasSkippedOnboarding,
    openWelcome,
  ]);

  const completeOnboardingMission = useCallback((mission: OnboardingMissionKey, sourceScreen: string) => {
    const onboardingState = useOnboardingStore.getState();
    if (
      onboardingState.hasSkippedOnboarding ||
      onboardingState.hasCompletedMissionOnboarding ||
      onboardingState.completedMissions[mission]
    ) {
      return;
    }

    markMissionCompleted(mission);

    void analyticsService.trackOnboardingEvent({
      eventType: 'step_completed',
      stepKey: mission,
      sourceScreen,
      platform: onboardingPlatform,
      metadata: {
        active_tab: activeTab,
        cart_count: cart.length,
      },
    });

    if (mission === 'search') {
      void analyticsService.trackOnboardingEvent({
        eventType: 'first_value_reached',
        stepKey: mission,
        sourceScreen,
        platform: onboardingPlatform,
        metadata: {
          query: lastSearchQuery || query,
        },
      });
    }
  }, [activeTab, cart.length, lastSearchQuery, markMissionCompleted, query]);

  useEffect(() => {
    if (isWelcomeOpen && !wasOnboardingOpenRef.current) {
      onboardingBaselineRef.current = {
        result,
        cartCount: cart.length,
      };
      previousOnboardingTabRef.current = activeTab;
    }

    if (!isWelcomeOpen) {
      previousOnboardingTabRef.current = activeTab;
    }

    wasOnboardingOpenRef.current = isWelcomeOpen;
  }, [activeTab, cart.length, isWelcomeOpen, result]);

  useEffect(() => {
    if (
      !isWelcomeOpen ||
      !result ||
      result === onboardingBaselineRef.current.result
    ) {
      return;
    }

    completeOnboardingMission('search', 'search');
  }, [completeOnboardingMission, isWelcomeOpen, result]);

  useEffect(() => {
    if (!isWelcomeOpen || cart.length <= onboardingBaselineRef.current.cartCount) return;
    completeOnboardingMission('disposal', 'search');
  }, [cart.length, completeOnboardingMission, isWelcomeOpen]);

  useEffect(() => {
    if (!isWelcomeOpen) {
      previousOnboardingTabRef.current = activeTab;
      return;
    }

    if (previousOnboardingTabRef.current === activeTab) return;
    previousOnboardingTabRef.current = activeTab;

    if (activeTab === 'cabinet') {
      completeOnboardingMission('cabinet', 'cabinet');
      return;
    }

    if (activeTab === 'inventory') {
      completeOnboardingMission('inventory', 'inventory');
    }
  }, [activeTab, completeOnboardingMission, isWelcomeOpen]);

  const handleOnboardingNavigateTab = useCallback((tab: AppTab) => {
    handleTabClick(tab);

    if (tab === 'cabinet') {
      completeOnboardingMission('cabinet', 'cabinet');
    } else if (tab === 'inventory') {
      completeOnboardingMission('inventory', 'inventory');
    }
  }, [completeOnboardingMission, handleTabClick]);

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

  const handleScan = (scannedText: string, selectionMeta: ScannerSelectionMeta) => {
    setIsScanning(false);
    setScanSelection({ searchTerm: scannedText, meta: selectionMeta });
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

  const shouldHideMobileSearchChrome = activeTab === 'search' && isSearchInputFocused;

  return (
    <>
      <SafetyDisclaimer />

      {isWelcomeOpen && isOnboardingRemoteChecked && !isScanning && (
        <OnboardingMissionPanel
          activeTab={activeTab}
          cartCount={cart.length}
          hasSearchResult={Boolean(result)}
          isNativeApp={isNativeApp}
          onRunSampleSearch={() => {
            setScanSelection(null);
            navigateWithFreshFilters('Acetone');
          }}
          onOpenScanner={() => setIsScanning(true)}
          onNavigateTab={handleOnboardingNavigateTab}
        />
      )}

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
        isWasteV2Enabled ? (
          <CartView
            onClose={() => setIsCartOpen(false)}
            onDisposed={incrementLogRefreshKey}
            onOpenLogs={(wasteLogId, openCorrection = false) => navigate(wasteLogId
              ? `${labAppRoute('/logs')}?record=${encodeURIComponent(wasteLogId)}${openCorrection ? '&correct=1' : ''}`
              : labAppRoute('/logs'))}
            onAddComponent={() => {
              setIsAddingWasteComponent(true);
              setWasteComponentSearchRequestKey((requestKey) => requestKey + 1);
              setIsCartOpen(false);
              handleTabClick('search');
            }}
          />
        ) : (
          <WasteV2DisabledCartView
            onClose={() => setIsCartOpen(false)}
            onOpenLogs={() => navigate(labAppRoute('/logs'))}
          />
        )
      )}

      <MainLayout
        onLogoClick={handleReset}
        userEmail={user?.email}
        onSignOut={isAuthenticated ? signOut : undefined}
        onLoginClick={!isAuthenticated ? () => navigateToLogin() : undefined}
        activeTab={activeTab}
        isAdmin={isAdmin}
        onTabClick={handleTabClick}
        cartCount={wasteDraftCount}
        onCartClick={() => {
          if (!isAuthenticated) {
            navigateToLogin(labAppRoute());
            return;
          }

          setIsCartOpen(true);
        }}
        bottomNav={
          shouldHideMobileSearchChrome ? null : (
            <BottomTabNav activeTab={activeTab} isAdmin={isAdmin} onTabClick={handleTabClick} />
          )
        }
      >
        <Suspense fallback={<TabContentFallback />}>
          {activeTab === 'cabinet' ? (
            <div className="h-full">
              {activeCabinetId ? (
                <FridgeView
                  key={`${activeCabinetId}:${logRefreshKey}`}
                  cabinetId={activeCabinetId}
                  onBack={() => navigate(labAppRoute('/cabinet'))}
                  onStartWasteBatch={isWasteV2Enabled ? handleStartInventoryWasteBatch : undefined}
                />
              ) : (
                <CabinetListView onSelectCabinet={(id) => navigate(labAppRoute(`/cabinet?id=${id}`))} />
              )}
            </div>
          ) : activeTab === 'logs' ? (
            <WasteLogView
              key={logRefreshKey}
              initialWasteLogId={searchParams.get('record')}
              openCorrection={searchParams.get('correct') === '1'}
            />
          ) : activeTab === 'inventory' ? (
            <InventoryListView
              key={logRefreshKey}
              onStartWasteBatch={isWasteV2Enabled ? handleStartInventoryWasteBatch : undefined}
            />
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
              scanSelectionMeta={scanSelection &&
                scanSelection.searchTerm.trim().toLowerCase() === lastSearchQuery.trim().toLowerCase()
                ? scanSelection.meta
                : undefined}
              mediaProducts={mediaProducts}
              mediaBrands={mediaBrands}
              mediaCount={mediaCount}
              cabinetResults={cabinetResults}
              showAllProducts={showAllProducts}
              selectedBrand={selectedBrand}
              sortBy={sortBy}
              recentSearches={recentSearches}
              onQueryChange={(value) => {
                if (scanSelection && value.trim().toLowerCase() !== scanSelection.searchTerm.trim().toLowerCase()) {
                  setScanSelection(null);
                }
                setQuery(value);
              }}
              onSearchSubmit={(event) => {
                setScanSelection(null);
                handleSearch(event);
              }}
              onReset={() => {
                setScanSelection(null);
                handleReset();
              }}
              onResultAddConfirmed={() => {
                if (isAddingWasteComponent) {
                  setIsAddingWasteComponent(false);
                  setIsCartOpen(true);
                }
                if (isWelcomeOpen) {
                  completeOnboardingMission('disposal', 'search');
                }
              }}
              onSuggestionClick={(term) => {
                setScanSelection(null);
                navigateWithFreshFilters(term);
              }}
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
              onSearchFocusChange={setIsSearchInputFocused}
              wasteComponentSearchMode={isAddingWasteComponent}
              searchFocusRequestKey={wasteComponentSearchRequestKey}
              onReturnToWasteBatch={() => {
                setIsAddingWasteComponent(false);
                setIsCartOpen(true);
              }}
              onRequireAuth={!isAuthenticated ? () => navigateToLogin() : undefined}
              onOpenVoiceAgent={() => openVoiceAgentSheet({
                screen: 'search',
                language: i18n.language.startsWith('ko') ? 'ko' : 'en',
              })}
            />
          )}
        </Suspense>

        {wasteDraftCount > 0 && !isCartOpen && !shouldHideMobileSearchChrome && (
          <button
            onClick={() => {
              if (!isAuthenticated) {
                navigateToLogin(labAppRoute());
                return;
              }

              setIsCartOpen(true);
            }}
            className={`absolute ${activeTab === 'inventory' ? 'bottom-24 right-24' : 'bottom-20 right-6'} z-40 flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-2xl transition-transform animate-in fade-in slide-in-from-bottom-4 active:scale-90 dark:bg-slate-100 dark:text-slate-900 lg:hidden`}
            aria-label={`${t('cart_title')} ${wasteDraftCount}`}
          >
            <ShoppingBag className="w-6 h-6" />
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center font-bold border-2 border-white dark:border-slate-900 text-white">{wasteDraftCount}</span>
          </button>
        )}
      </MainLayout>

      <VoiceAgentSheet
        currentContext={{
          screen: activeTab === 'cabinet' ? 'cabinet' : 'search',
          cabinetId: activeCabinetId || undefined,
          labId: currentLabId || undefined,
          language: i18n.language.startsWith('ko') ? 'ko' : 'en',
        }}
        onUiAction={handleVoiceUiAction}
      />
    </>
  );
}

export default App;
