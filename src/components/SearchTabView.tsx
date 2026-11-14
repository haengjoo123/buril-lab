import { useAdaptiveLayout } from '../hooks/useAdaptiveLayout';
import { AdaptivePaneLayout } from './AdaptivePaneLayout';
import logo from '../assets/burillab_app_icon.png';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Camera, Loader2, AlertCircle, ChevronDown, ChevronUp, ChevronRight, Box, Mic, ArrowUp, X, ShoppingBag, ClipboardList, ArrowRight, RotateCcw } from 'lucide-react';
import { ResultCard } from './ResultCard';
import { MediaProductCard } from './MediaProductCard';
import { MediaProductFilter } from './MediaProductFilter';
import { InventoryRegistrationModal } from './InventoryRegistrationModal';
import { OnboardingGuideCard } from './onboarding/OnboardingGuideCard';
import type { AnalysisResult, CartItem, DisposalCategory } from '../types';
import type { CabinetSearchResult } from '../services/cabinetService';
import type { MediaProduct, SortOption } from '../services/mediaProductService';
import { useOnboardingStore } from '../store/useOnboardingStore';
import { useLabStore } from '../store/useLabStore';
import { fetchWasteLogs, type WasteLogRecord } from '../services/wasteLogService';
import { getCategoryDetails } from '../utils/chemicalAnalyzer';
import { wasteStreamLabel } from '../utils/wasteLabels';
import type { SearchErrorKind } from '../hooks/useSearchFlow';
import type { ChemicalFormChoice } from '../services/chemicalSuggestionService';
import type { ScannerSelectionMeta } from './Scanner';

type WasteLogChemicalEntry = Partial<CartItem> & {
  chemical?: Partial<CartItem['chemical']> | null;
  /** V2 waste logs store a flat component snapshot. */
  chemicalName?: unknown;
  name?: unknown;
};

const getWasteLogChemicalName = (item: WasteLogChemicalEntry | null | undefined): string | null => {
  const candidates = [item?.chemical?.name, item?.chemicalName, item?.name];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
};

const DISPOSAL_CATEGORY_VALUES = new Set<string>([
  'ACID',
  'ALKALI',
  'NEUTRAL',
  'ORGANIC_HALOGEN',
  'ORGANIC_NON_HALOGEN',
  'HEAVY_METAL',
  'CYANIDE',
  'REACTIVE',
  'SOLID_WASTE',
  'SPECIAL_HAZARD',
  'UNKNOWN',
]);

/** Volume a log contributes to the "today" summary; mass-only or unknown amounts are skipped. */
const getWasteLogVolumeMl = (log: WasteLogRecord): number => {
  if (log.voided_at) return 0;
  if (log.schema_version === 2) {
    if (log.amount_is_unknown) return 0;
    if (log.normalized_amount_unit === 'mL' && typeof log.normalized_amount_value === 'number') {
      return log.normalized_amount_value;
    }
    if (log.normalized_amount_unit) return 0;
  }
  return typeof log.total_volume_ml === 'number' ? log.total_volume_ml : 0;
};

interface TodayWasteSummary {
  count: number;
  volumeMl: number;
}

function ResultSkeleton() {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-gray-100 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-800">
        <div className="h-6 w-2/3 animate-pulse rounded-md bg-slate-200 dark:bg-slate-700" />
        <div className="mt-2 h-4 w-1/2 animate-pulse rounded-md bg-slate-200/70 dark:bg-slate-700/70" />
        <div className="mt-2 h-3 w-1/3 animate-pulse rounded-md bg-slate-200/70 dark:bg-slate-700/70" />
      </div>
      <div className="flex flex-col items-center gap-3 p-5">
        <div className="h-7 w-1/2 animate-pulse rounded-md bg-slate-200 dark:bg-slate-700" />
        <div className="h-4 w-5/6 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
        <div className="h-4 w-2/3 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
        <div className="mt-2 h-12 w-full animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
        <div className="h-12 w-full animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
      </div>
    </div>
  );
}

interface SearchTabViewProps {
  cartCount: number;
  query: string;
  lastSearchQuery: string;
  isLoading: boolean;
  isAiAnalyzing: boolean;
  error: string | null;
  errorKind?: SearchErrorKind | null;
  onRetrySearch?: () => void;
  result: AnalysisResult | null;
  scanSelectionMeta?: ScannerSelectionMeta;
  sourceSearchEventId?: string;
  mediaProducts: MediaProduct[];
  mediaBrands: string[];
  mediaCount: number;
  cabinetResults: CabinetSearchResult[];
  showAllProducts: boolean;
  selectedBrand: string;
  sortBy: SortOption;
  recentSearches: string[];
  onQueryChange: (value: string) => void;
  onSearchSubmit: (e?: FormEvent) => void;
  onReset: () => void;
  onResultAddConfirmed?: () => void;
  onSuggestionClick: (term: string) => void;
  onHistoryClick?: (term: string) => void;
  onProductResultClick?: (product: MediaProduct) => void;
  onOpenScanner: () => void;
  onClearSearchHistory: () => void;
  onRemoveSearchHistory: (term: string) => void;
  onCabinetResultClick: (item: CabinetSearchResult) => Promise<void>;
  onBrandChange: (brand: string) => void;
  onSortChange: (sort: SortOption) => void;
  onClearFilters: () => void;
  onToggleShowAllProducts: () => void;
  onNavigateToCabinet: (cabinetId: string, itemId: string) => void;
  suggestions?: string[];
  /** Forms to choose from when the typed name fits several reagents. */
  formChoices?: ChemicalFormChoice[];
  formChoicesQuery?: string;
  isSuggestionsLoading?: boolean;
  onClearSuggestions?: () => void;
  onRequireAuth?: () => void;
  onOpenVoiceAgent?: () => void;
  cartItems?: CartItem[];
  onOpenCart?: () => void;
  showRecentWasteLogs?: boolean;
  onOpenLogs?: () => void;
  onSearchFocusChange?: (isFocused: boolean) => void;
  wasteComponentSearchMode?: boolean;
  searchFocusRequestKey?: number;
  /** Re-tap of the active search tab / "type it in" from the scanner; a value present at mount is ignored. */
  inputFocusRequestKey?: number;
  onReturnToWasteBatch?: () => void;
}

export function SearchTabView({
  cartCount,
  query,
  lastSearchQuery,
  isLoading,
  isAiAnalyzing,
  error,
  errorKind = null,
  onRetrySearch,
  result,
  scanSelectionMeta,
  sourceSearchEventId,
  mediaProducts,
  mediaBrands,
  mediaCount,
  cabinetResults,
  showAllProducts,
  selectedBrand,
  sortBy,
  recentSearches,
  onQueryChange,
  onSearchSubmit,
  onReset,
  onResultAddConfirmed,
  onSuggestionClick,
  onHistoryClick,
  onProductResultClick,
  onOpenScanner,
  onClearSearchHistory,
  onRemoveSearchHistory,
  onCabinetResultClick,
  onBrandChange,
  onSortChange,
  onClearFilters,
  onToggleShowAllProducts,
  onNavigateToCabinet,
  suggestions = [],
  formChoices = [],
  formChoicesQuery = '',
  isSuggestionsLoading = false,
  onClearSuggestions,
  onRequireAuth,
  onOpenVoiceAgent,
  cartItems = [],
  onOpenCart,
  showRecentWasteLogs = false,
  onOpenLogs,
  onSearchFocusChange,
  wasteComponentSearchMode = false,
  searchFocusRequestKey = 0,
  inputFocusRequestKey = 0,
  onReturnToWasteBatch,
}: SearchTabViewProps) {
  const { t, i18n } = useTranslation();
  // fetchWasteLogs scopes by the current lab, so the home log summary must refetch on a switch.
  const currentLabId = useLabStore((state) => state.currentLabId);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchFormRef = useRef<HTMLFormElement>(null);
  const detailPaneRef = useRef<HTMLElement>(null);
  const blurTimeoutRef = useRef<number | null>(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [autocompleteMaxHeight, setAutocompleteMaxHeight] = useState(240);
  const [recentWasteLogs, setRecentWasteLogs] = useState<WasteLogRecord[]>([]);
  const [todayWasteSummary, setTodayWasteSummary] = useState<TodayWasteSummary | null>(null);
  const [isWasteLogsLoading, setIsWasteLogsLoading] = useState(false);
  const [wasteLogsError, setWasteLogsError] = useState(false);
  const [inventoryDraft, setInventoryDraft] = useState<{ product: MediaProduct; casNumber: string } | null>(null);
  const showOnboardingGuide = useOnboardingStore((state) => state.hasCompletedWelcome && !state.hasSkippedOnboarding && !state.seenGuides.search);
  const layout = useAdaptiveLayout();
  // Keep compact screens and segmented displays on their existing pane flow.
  const isDesktopSearch = layout.viewport.width >= 1024 && layout.segments.length <= 1;
  const isMobileSearch = layout.activeRegion.width < 600 && !layout.twoPane;
  const [closedResultQuery, setClosedResultQuery] = useState<string | null>(null);
  const markGuideSeen = useOnboardingStore((state) => state.markGuideSeen);
  const hasOtherResults = mediaProducts.length > 0 || cabinetResults.length > 0;
  const hasSearchResults = Boolean(result) || hasOtherResults;
  const desktopSearchState = hasSearchResults || isLoading ? 'results' : 'start';
  const showChemicalNotFoundNotice = !isLoading && !result && hasOtherResults && !!lastSearchQuery;
  const normalizedQuery = query.trim();
  // Choices fetched for an earlier keystroke must not gate the current query.
  const activeFormChoices = formChoicesQuery && formChoicesQuery === normalizedQuery ? formChoices : [];
  const shouldShowAutocomplete =
    normalizedQuery.length >= 2 &&
    normalizedQuery !== lastSearchQuery &&
    (suggestions.length > 0 || activeFormChoices.length > 0 || isSuggestionsLoading);
  const shouldShowRecentDropdown = isSearchFocused && !normalizedQuery && recentSearches.length > 0;
  const isSearchDropdownOpen = shouldShowAutocomplete || shouldShowRecentDropdown;
  const isNotFound = Boolean(error) && errorKind === 'not_found';
  // A miss is a normal outcome (neutral styling); only real failures get the red treatment.
  const showErrorOutline = Boolean(error) && !isNotFound;
  const notFoundSuggestions = useMemo(() => {
    if (!isNotFound || normalizedQuery !== lastSearchQuery) return [];
    const searched = lastSearchQuery.trim().toLowerCase();
    return suggestions.filter((suggestion) => suggestion.trim().toLowerCase() !== searched);
  }, [isNotFound, lastSearchQuery, normalizedQuery, suggestions]);
  // Only the hero for first-time users; anyone with history sees their recents instead.
  const showHero = !lastSearchQuery && !isLoading && !isSearchFocused && recentSearches.length === 0;
  const visibleCartItems = useMemo(() => cartItems.slice(0, 3), [cartItems]);
  const hiddenCartCount = Math.max(0, cartItems.length - visibleCartItems.length);

  // Keep the detail pane (with a skeleton) while a new search loads from an open result,
  // instead of flashing back to the list and then to the new result.
  const isResultPaneOpen = Boolean(result) && closedResultQuery !== lastSearchQuery;
  const [holdDetailPane, setHoldDetailPane] = useState(false);
  const shouldShowDetailPane = isResultPaneOpen || (isLoading && holdDetailPane);
  if (shouldShowDetailPane !== holdDetailPane) {
    setHoldDetailPane(shouldShowDetailPane);
  }
  const resultIdentity = result ? `${lastSearchQuery}\u0000${result.chemical.id}` : null;

  const closeDetailPane = useCallback(() => {
    setClosedResultQuery(lastSearchQuery);
    setHoldDetailPane(false);
  }, [lastSearchQuery]);
  const closeDetailPaneRef = useRef(closeDetailPane);
  useEffect(() => {
    closeDetailPaneRef.current = closeDetailPane;
  }, [closeDetailPane]);

  const setSearchFocus = useCallback((isFocused: boolean) => {
    setIsSearchFocused(isFocused);
    onSearchFocusChange?.(isFocused);
  }, [onSearchFocusChange]);

  const updateAutocompleteMaxHeight = useCallback(() => {
    if (!searchFormRef.current) return;

    const viewport = window.visualViewport;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportTop = viewport?.offsetTop ?? 0;
    const formRect = searchFormRef.current.getBoundingClientRect();
    const formBottom = formRect.bottom;
    const panelBottom = isDesktopSearch
      ? searchFormRef.current.closest('.search-panes')?.getBoundingClientRect().bottom ?? Infinity
      : searchFormRef.current.closest('[data-pane]')?.getBoundingClientRect().bottom ?? Infinity;
    const availableHeight = isMobileSearch
      ? formRect.top - Math.max(viewportTop, layout.bounds.y) - 16
      : Math.min(viewportTop + viewportHeight, layout.activeRegion.y + layout.activeRegion.height, panelBottom) - formBottom - 18;
    const nextHeight = Math.max(0, Math.min(360, Math.floor(availableHeight)));

    setAutocompleteMaxHeight(nextHeight);
  }, [isDesktopSearch, isMobileSearch, layout.activeRegion, layout.bounds.y]);

  const handleInputFocus = useCallback(() => {
    if (blurTimeoutRef.current !== null) {
      window.clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }

    setSearchFocus(true);
    window.setTimeout(() => {
      if (!isMobileSearch) searchFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      updateAutocompleteMaxHeight();
    }, 80);
  }, [isMobileSearch, setSearchFocus, updateAutocompleteMaxHeight]);

  const handleInputBlur = useCallback(() => {
    blurTimeoutRef.current = window.setTimeout(() => {
      setSearchFocus(false);
      blurTimeoutRef.current = null;
    }, 120);
  }, [setSearchFocus]);

  const handleFormSubmit = useCallback((event?: FormEvent) => {
    // A name that fits several reagents is never searched as-is: the person picks the form first.
    if (activeFormChoices.length > 0) {
      event?.preventDefault();
      return;
    }
    searchInputRef.current?.blur();
    setSearchFocus(false);
    setClosedResultQuery(null);
    onSearchSubmit(event);
  }, [activeFormChoices.length, onSearchSubmit, setSearchFocus]);

  const handleSuggestionSelect = useCallback((term: string) => {
    searchInputRef.current?.blur();
    setSearchFocus(false);
    setClosedResultQuery(null);
    onSuggestionClick(term);
    onClearSuggestions?.();
  }, [onClearSuggestions, onSuggestionClick, setSearchFocus]);

  const handleHistorySelect = useCallback((term: string) => {
    searchInputRef.current?.blur();
    setSearchFocus(false);
    // Re-tapping the term of the current result reopens it instead of doing nothing.
    setClosedResultQuery(null);
    if (onHistoryClick) {
      onHistoryClick(term);
    } else {
      onSuggestionClick(term);
    }
  }, [onHistoryClick, onSuggestionClick, setSearchFocus]);

  const handleRegisterResultInventory = useCallback(() => {
    if (!result) return;
    if (onRequireAuth) {
      onRequireAuth();
      return;
    }
    setInventoryDraft({
      product: {
        id: '',
        brand: null,
        product_name: result.chemical.name,
        product_numbers: null,
        thumbnail_url: null,
        url_slug: null,
      },
      casNumber: result.chemical.casNumber || '',
    });
  }, [onRequireAuth, result]);

  // Focus requests (re-tapping the search tab, "type it in" from the scanner, adding a
  // waste component) first bring the list pane forward, since the input lives there.
  const [pendingFocusKey, setPendingFocusKey] = useState(0);
  const queueSearchInputFocus = useCallback(() => {
    closeDetailPaneRef.current();
    setPendingFocusKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (searchFocusRequestKey <= 0) return;

    const animationFrame = window.requestAnimationFrame(queueSearchInputFocus);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [queueSearchInputFocus, searchFocusRequestKey]);

  const mountedInputFocusKeyRef = useRef(inputFocusRequestKey);
  useEffect(() => {
    if (inputFocusRequestKey === mountedInputFocusKeyRef.current) return;

    const animationFrame = window.requestAnimationFrame(queueSearchInputFocus);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [inputFocusRequestKey, queueSearchInputFocus]);

  useEffect(() => {
    if (pendingFocusKey <= 0) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [pendingFocusKey]);

  // A new result must open at its title, not at the previous result's scroll offset.
  useLayoutEffect(() => {
    const detailPane = detailPaneRef.current;
    if (detailPane) detailPane.scrollTop = 0;
  }, [resultIdentity]);

  useEffect(() => {
    if (!isSearchFocused || !isSearchDropdownOpen) return;

    updateAutocompleteMaxHeight();
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', updateAutocompleteMaxHeight);
    viewport?.addEventListener('scroll', updateAutocompleteMaxHeight);
    window.addEventListener('resize', updateAutocompleteMaxHeight);
    window.addEventListener('scroll', updateAutocompleteMaxHeight, true);

    return () => {
      viewport?.removeEventListener('resize', updateAutocompleteMaxHeight);
      viewport?.removeEventListener('scroll', updateAutocompleteMaxHeight);
      window.removeEventListener('resize', updateAutocompleteMaxHeight);
      window.removeEventListener('scroll', updateAutocompleteMaxHeight, true);
    };
  }, [isSearchFocused, isSearchDropdownOpen, updateAutocompleteMaxHeight]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current !== null) {
        window.clearTimeout(blurTimeoutRef.current);
      }
      onSearchFocusChange?.(false);
    };
  }, [onSearchFocusChange]);

  useEffect(() => {
    if (!isSearchFocused) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!searchFormRef.current) return;
      if (event.target instanceof Node && searchFormRef.current.contains(event.target)) return;

      searchInputRef.current?.blur();
      setSearchFocus(false);
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown, true);

    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
    };
  }, [isSearchFocused, setSearchFocus]);

  useEffect(() => {
    let isMounted = true;

    const loadRecentWasteLogs = async () => {
      if (!showRecentWasteLogs) {
        setRecentWasteLogs([]);
        setTodayWasteSummary(null);
        setWasteLogsError(false);
        setIsWasteLogsLoading(false);
        return;
      }

      setIsWasteLogsLoading(true);
      setWasteLogsError(false);

      try {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const [{ logs }, todayLogs] = await Promise.all([
          fetchWasteLogs(3, 0, { sortBy: 'created_at', sortOrder: 'desc' }),
          fetchWasteLogs(100, 0, {
            sortBy: 'created_at',
            sortOrder: 'desc',
            createdAfter: startOfToday.toISOString(),
          }).then(({ logs: rows }) => rows).catch(() => null),
        ]);
        if (!isMounted) return;
        setRecentWasteLogs(logs);
        if (todayLogs) {
          const activeTodayLogs = todayLogs.filter((log) => !log.voided_at);
          setTodayWasteSummary({
            count: activeTodayLogs.length,
            volumeMl: activeTodayLogs.reduce((sum, log) => sum + getWasteLogVolumeMl(log), 0),
          });
        } else {
          setTodayWasteSummary(null);
        }
      } catch {
        if (!isMounted) return;
        setRecentWasteLogs([]);
        setTodayWasteSummary(null);
        setWasteLogsError(true);
      } finally {
        if (isMounted) {
          setIsWasteLogsLoading(false);
        }
      }
    };

    void Promise.resolve().then(loadRecentWasteLogs);

    return () => {
      isMounted = false;
    };
  }, [showRecentWasteLogs, currentLabId]);

  const formatWasteLogDate = (isoDate: string): string => {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return '';

    return new Intl.DateTimeFormat('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const getWasteLogCategoryLabel = (log: WasteLogRecord): string => {
    if (log.stream_code) return wasteStreamLabel(log.stream_code, i18n.language);
    if (DISPOSAL_CATEGORY_VALUES.has(log.disposal_category)) {
      return t(getCategoryDetails(log.disposal_category as DisposalCategory).label);
    }
    return log.disposal_category;
  };

  const getWasteLogTitle = (log: WasteLogRecord): string => {
    const names = (log.chemicals ?? [])
      .map((item) => getWasteLogChemicalName(item))
      .filter((name): name is string => Boolean(name));

    if (names.length === 0) return getWasteLogCategoryLabel(log);
    if (names.length === 1) return names[0];
    return t('cmp_search_log_title_more', { name: names[0], count: names.length - 1, defaultValue: '{{name}} 외 {{count}}개' });
  };

  const todaySummaryLabel = todayWasteSummary && todayWasteSummary.count > 0
    ? [
      t('search_logs_today', { count: todayWasteSummary.count }),
      todayWasteSummary.volumeMl > 0 ? `${Math.round(todayWasteSummary.volumeMl).toLocaleString()} mL` : null,
    ].filter(Boolean).join(' · ')
    : t('tab_logs');
  // A corrected (voided) record is not "what I just disposed" — point at the latest active one.
  const latestWasteLog = recentWasteLogs.find((log) => !log.voided_at);
  const showMobileWasteLogLine = showRecentWasteLogs && !isWasteLogsLoading && !wasteLogsError && Boolean(latestWasteLog);

  const searchedTermKey = lastSearchQuery.trim().toLowerCase();
  const ownedCabinetChips = result && cabinetResults.length > 0 ? (
    <div className="mt-3 flex flex-wrap gap-2">
      {cabinetResults.slice(0, 2).map((item) => {
        const shelfLabel = t('cabinet_shelf_level', { level: item.shelfLevel + 1 });
        const showItemName = item.itemName.trim().toLowerCase() !== searchedTermKey;
        return (
          <button
            key={item.itemId}
            type="button"
            onClick={() => { void onCabinetResultClick(item); }}
            aria-label={`${item.itemName} · ${item.cabinetName} · ${shelfLabel}`}
            className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
          >
            <Box className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">
              {showItemName ? `${item.itemName} · ` : ''}{item.cabinetName} · {shelfLabel}
            </span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
          </button>
        );
      })}
      {cabinetResults.length > 2 && (
        <button
          type="button"
          onClick={closeDetailPane}
          className="inline-flex min-h-9 items-center rounded-full border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 dark:border-emerald-900/60 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
        >
          +{cabinetResults.length - 2}
        </button>
      )}
    </div>
  ) : null;

  const renderRecentSearchRows = () => recentSearches.map((term) => (
    <li key={term} className="flex items-center">
      <button
        type="button"
        onClick={() => handleHistorySelect(term)}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-blue-600 active:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700/50 dark:hover:text-blue-300 dark:active:bg-slate-700"
      >
        <Search className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{term}</span>
      </button>
      <button
        type="button"
        onClick={() => onRemoveSearchHistory(term)}
        aria-label={`${t('search_remove_history')}: ${term}`}
        className="mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-500 dark:text-slate-500 dark:hover:bg-slate-700"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </li>
  ));

  return (
    <div
      className="h-full min-h-0"
      onPointerDown={(event) => {
        if (!isSearchFocused || !searchFormRef.current) return;
        if (event.target instanceof Node && searchFormRef.current.contains(event.target)) return;
        searchInputRef.current?.blur();
        setSearchFocus(false);
      }}
    >
      <AdaptivePaneLayout onActivePaneChange={pane => (pane === 'primary' ? closeDetailPane() : setClosedResultQuery(null))} layout={layout} activePane={shouldShowDetailPane ? 'detail' : 'primary'}
        onBack={closeDetailPane} className="search-panes flex h-full flex-col"
        data-desktop-search={isDesktopSearch} data-mobile-search={isMobileSearch} data-search-state={desktopSearchState}>

        {isMobileSearch && !lastSearchQuery && !isLoading && !error && !wasteComponentSearchMode && <section className="search-mobile-welcome">
          <img src={logo} alt="" className="h-12 w-12" />
          <h2>{t('search_mobile_title')}</h2>
          <p>{t('search_mobile_description')}</p>
        </section>}

        <div data-pane="primary" className="search-primary-pane min-h-0 min-w-0 flex-1 overflow-y-auto p-4"><div className="search-primary-content flex flex-col gap-6">
      <div className="search-controls contents">
      {showOnboardingGuide && (
        <div className={`search-onboarding ${isSearchFocused ? 'hidden wide:block' : ''}`}>
          <OnboardingGuideCard
            icon={<Search className="h-5 w-5" />}
            title={t('onboarding_search_title')}
            description={t('onboarding_search_desc')}
            points={[
              t('onboarding_search_point_1'),
              t('onboarding_search_point_2'),
              t('onboarding_search_point_3'),
            ]}
            onDismiss={() => markGuideSeen('search')}
          />
        </div>
      )}

      {showHero && !isMobileSearch && (
        <section className="mt-4 animate-in fade-in slide-in-from-top-2 duration-500 wide:hidden">
          <h2 className="text-2xl font-bold leading-tight text-slate-900 dark:text-slate-100 wide:text-4xl wide:tracking-tight">
            {t('app_subtitle_1')}<br />
            <span className="text-blue-600 dark:text-blue-400">{t('app_subtitle_2')}</span> {t('app_subtitle_3')}
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400 wide:text-base">
            {t('app_desc')}
          </p>
        </section>
      )}

      <section className={isDesktopSearch ? 'search-desktop-heading' : 'hidden wide:block'}>
        <h2 className={isDesktopSearch ? 'text-3xl font-bold tracking-tight text-slate-950 dark:text-slate-100' : 'text-4xl font-bold tracking-tight text-slate-950 dark:text-slate-100'}>
          {t(isDesktopSearch ? 'search_desktop_title' : 'tab_search')}
        </h2>
        <p className="mt-3 text-base text-slate-600 dark:text-slate-400">
          {t(isDesktopSearch ? 'search_desktop_description' : 'app_desc')}
        </p>
      </section>

      {wasteComponentSearchMode && (
        <div
          role="status"
          className="search-notice flex flex-col items-start gap-2 border-b border-slate-200 pb-4 text-slate-900 dark:border-slate-800 dark:text-slate-100 sm:flex-row sm:justify-between"
        >
          <div>
            <p className="font-semibold">{t('waste_component_search_title')}</p>
            <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
              {t('waste_component_search_desc')}
            </p>
          </div>
          {onReturnToWasteBatch && (
            <button
              type="button"
              onClick={onReturnToWasteBatch}
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded text-sm font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
            >
              <ShoppingBag className="h-4 w-4" aria-hidden="true" />
              {t('waste_return_to_batch')}
            </button>
          )}
        </div>
      )}

      <form
        ref={searchFormRef}
        onSubmit={handleFormSubmit}
        data-onboarding-target="search-box"
        className={`search-composer relative group z-20 ${!isDesktopSearch && !isMobileSearch && isSearchFocused ? 'sticky top-3 wide:relative wide:top-auto' : ''}`}
      >
        <div
          className={`search-composer-surface ${isDesktopSearch
            ? 'rounded-[24px] border bg-slate-50/80 px-3 py-2 transition-colors group-focus-within:border-blue-300 group-focus-within:bg-white group-focus-within:ring-2 group-focus-within:ring-blue-100 dark:bg-slate-900/70 dark:group-focus-within:bg-slate-900 dark:group-focus-within:ring-blue-950'
            : 'rounded-[1.5rem] border bg-white px-4 py-3 shadow-[0_14px_32px_-26px_rgba(15,23,42,0.24)] transition-all group-focus-within:-translate-y-0.5 group-focus-within:shadow-[0_20px_44px_-30px_rgba(37,99,235,0.22)] dark:bg-slate-800 wide:rounded-none wide:border-0 wide:bg-transparent wide:p-0 wide:shadow-none wide:group-focus-within:translate-y-0 wide:group-focus-within:shadow-none dark:wide:bg-transparent'} ${showErrorOutline
            ? 'border-red-300 dark:border-red-900/50'
            : isDesktopSearch ? 'border-slate-200 dark:border-slate-700' : 'border-slate-100 dark:border-slate-700/70'
            }`}
        >
          <div className={isDesktopSearch ? 'flex min-h-[60px] items-center gap-3' : `flex items-center gap-2 transition-colors wide:min-h-[76px] wide:gap-3 wide:rounded-[24px] wide:border wide:px-3 wide:py-2 ${
            showErrorOutline
              ? 'wide:border-red-200 wide:bg-red-50 dark:wide:border-red-900/60 dark:wide:bg-red-950/30'
              : 'wide:border-slate-200 wide:bg-slate-50/80 wide:ring-1 wide:ring-white wide:group-focus-within:border-blue-300 wide:group-focus-within:bg-white wide:group-focus-within:ring-blue-100 dark:wide:border-slate-700/70 dark:wide:bg-slate-900/70 dark:wide:ring-slate-700/50 dark:wide:group-focus-within:border-blue-500/60 dark:wide:group-focus-within:bg-slate-900 dark:wide:group-focus-within:ring-blue-500/20'
          }`}>
            <button
              type="button"
              onClick={onOpenScanner}
              aria-label={t('btn_scan')}
              disabled={isLoading}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-blue-300 wide:h-12 wide:w-12"
            >
              <Camera className="h-5 w-5 stroke-[2.2]" />
            </button>

            <div className="min-w-0 flex-1">
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
                data-onboarding-target="search-input"
              className={isDesktopSearch ? 'block h-14 w-full bg-transparent text-lg font-medium text-slate-900 placeholder:text-slate-400 caret-blue-600 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500 dark:[color-scheme:dark]' : 'block h-10 w-full bg-transparent text-base font-medium leading-5 text-gray-900 placeholder:text-slate-400 caret-blue-600 focus:outline-none dark:text-gray-100 dark:placeholder:text-slate-500 dark:caret-blue-300 dark:[color-scheme:dark] wide:h-14 wide:text-lg wide:text-slate-900 wide:placeholder:text-slate-400 dark:wide:text-slate-100 dark:wide:placeholder:text-slate-500'}
              placeholder={t('search_placeholder')}
              aria-label={t('search_placeholder')}
              disabled={isLoading}
            />
            </div>

            {!isLoading && (query.trim() || hasSearchResults) && (
              <button
                type="button"
                onClick={onReset}
                aria-label={t('search_reset')}
                className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-200 wide:hover:bg-slate-200/70 wide:hover:text-slate-700"
              >
                <span className="sr-only">{t('search_reset')}</span>
                <X className="h-4 w-4" />
              </button>
            )}
            <div className="flex shrink-0 items-center gap-1">
              {(query.trim() || (isDesktopSearch && isLoading)) && (
                <button
                  type="submit"
                  disabled={isLoading}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-950/30 transition-all duration-300 hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-60 wide:h-12 wide:w-12"
                  aria-label={t('lab_mgmt_search_btn')}
                >
                  {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5 stroke-[2.4]" />}
                </button>
              )}
              {onOpenVoiceAgent && (
                <button
                  type="button"
                  onClick={onOpenVoiceAgent}
                  disabled={isLoading}
                  aria-label={t('voice_agent_cta_speak')}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-blue-300 wide:h-12 wide:w-12"
                >
                  <Mic className="h-5 w-5 stroke-[2.3]" />
                </button>
              )}
            </div>
          </div>

        </div>

        {/* Autocomplete Dropdown */}
        {shouldShowAutocomplete && (
          <div
            className={`search-suggestions absolute top-full left-0 right-0 mt-3 flex flex-col bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-lg shadow-gray-200/50 dark:shadow-slate-900/50 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 ${isSearchFocused ? '' : 'max-h-60'}`}
            style={isSearchFocused ? { maxHeight: `${autocompleteMaxHeight}px` } : undefined}
          >
            {activeFormChoices.length > 0 && (
              <section aria-labelledby="search-form-choice-title" className="shrink-0 border-b border-gray-100 px-4 py-3 dark:border-slate-700/50">
                <h3 id="search-form-choice-title" className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('search_form_choice_title')}</h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('search_form_choice_hint')}</p>
                <ul className="mt-2 flex flex-col gap-1">
                  {activeFormChoices.map((choice) => (
                    <li key={choice.name}>
                      <button
                        type="button"
                        className="flex w-full min-w-0 flex-col items-start rounded-lg border border-slate-200 px-3 py-2 text-left transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:hover:border-blue-700 dark:hover:bg-slate-700/50"
                        onClick={() => handleSuggestionSelect(choice.name)}
                      >
                        <span className="max-w-full truncate text-sm font-medium text-slate-800 dark:text-slate-100">{choice.name}</span>
                        {choice.nameEn && <span className="max-w-full truncate text-xs text-slate-500 dark:text-slate-400">{choice.nameEn}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {activeFormChoices.length > 0 && suggestions.length === 0 ? null : isSuggestionsLoading && suggestions.length === 0 ? (
              <div className="p-4 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400 gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('search_loading_suggestions')}
              </div>
            ) : (
              <ul className="min-h-0 max-h-full overflow-y-auto w-full">
                {suggestions.map((sug) => (
                  <li key={sug}>
                    <button
                      type="button"
                      className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700/50 last:border-0 transition-colors flex items-center gap-3"
                      onClick={() => handleSuggestionSelect(sug)}
                    >
                      <Search className="w-4 h-4 text-gray-400" />
                      {sug}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Recent searches while the input is focused and empty */}
        {shouldShowRecentDropdown && (
          <div
            className="search-suggestions absolute top-full left-0 right-0 z-50 mt-3 flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg shadow-gray-200/50 animate-in fade-in slide-in-from-top-2 dark:border-slate-700 dark:bg-slate-800 dark:shadow-slate-900/50"
            style={{ maxHeight: `${autocompleteMaxHeight}px` }}
            // Keep the input focused while removing entries.
            onMouseDown={(event) => event.preventDefault()}
          >
            <div className="flex shrink-0 items-center justify-between px-4 pt-2.5 pb-1">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{t('guide_example')}</span>
              <button
                type="button"
                onClick={onClearSearchHistory}
                className="text-xs text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-300"
              >
                {t('recent_clear')}
              </button>
            </div>
            <ul className="min-h-0 overflow-y-auto divide-y divide-gray-100 dark:divide-slate-700/50">
              {renderRecentSearchRows()}
            </ul>
          </div>
        )}
      </form>

      {isDesktopSearch && desktopSearchState === 'start' && recentSearches.length > 0 && !shouldShowRecentDropdown && (
        <section className="mt-4" aria-label={t('guide_example')}>
          <div className="mb-3 flex items-center justify-between gap-4">
            <h3 className="text-sm font-medium text-slate-600 dark:text-slate-400">{t('guide_example')}</h3>
            <button type="button" onClick={onClearSearchHistory} className="rounded text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
              {t('recent_clear')}
            </button>
          </div>
          <ul className="flex flex-wrap gap-2">
            {recentSearches.slice(0, 5).map(term => (
              <li key={term} className="min-w-0 max-w-full">
                <button type="button" onClick={() => handleHistorySelect(term)}
                  className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-blue-700 dark:hover:text-blue-300">
                  <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                  <span className="truncate">{term}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isAiAnalyzing && (
        <div role="status" className="search-message flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
          <span className="font-medium">{t('app_ai_analyzing')}</span>
        </div>
      )}

      {error && isNotFound ? (
        <div className="search-message text-sm text-slate-600 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            <span className="min-w-0">{error}</span>
          </div>
          {notFoundSuggestions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {notFoundSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => handleSuggestionSelect(suggestion)}
                  className="inline-flex min-h-9 max-w-full items-center rounded text-sm font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
                >
                  <span className="truncate">{suggestion}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : error ? (
        <div role="alert" className="search-message flex items-start gap-3 text-sm">
          <AlertCircle className="mt-1 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
          <div className="min-w-0 flex-1">
          <p className="leading-6 text-slate-600 dark:text-slate-400">{error}</p>
          {errorKind === 'technical' && onRetrySearch && (
            <button
              type="button"
              onClick={onRetrySearch}
              disabled={isLoading}
              className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded text-sm font-medium text-blue-600 underline-offset-4 hover:underline disabled:opacity-60 dark:text-blue-400"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t('search_retry')}
            </button>
          )}
          </div>
        </div>
      ) : null}
      </div>

      <div className="search-results-list contents">
      {isDesktopSearch && desktopSearchState === 'results' && (
        <h3 className="mb-4 text-sm font-semibold text-slate-700 dark:text-slate-300">{t('search_desktop_results_title')}</h3>
      )}
      {(result || mediaProducts.length > 0 || cabinetResults.length > 0) ? (
        <div className="flex flex-col gap-4">
          {showChemicalNotFoundNotice && (
            <div className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <span>{t('search_chemical_not_found_notice', { query: lastSearchQuery })}</span>
            </div>
          )}
          {cabinetResults.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
                {t('app_cabinet_results')}
              </h3>
              <div className="flex flex-col gap-3">
                {cabinetResults.map((item) => (
                  <button
                    type="button"
                    key={item.itemId}
                    onClick={() => { void onCabinetResultClick(item); }}
                    className="w-full text-left bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-emerald-100 dark:border-emerald-900/50 cursor-pointer hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors flex flex-col gap-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                        {item.itemName}
                      </span>
                      <span className="text-xs bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-2 py-1 rounded-md">
                        {item.cabinetName}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                      <Box className="w-3 h-3" />
                      {t('cabinet_shelf_level', { level: item.shelfLevel + 1 })}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {result && <button type="button" onClick={() => setClosedResultQuery(null)}
            aria-pressed={isDesktopSearch ? true : undefined}
            className={isDesktopSearch ? 'order-first flex min-h-11 flex-col gap-1 rounded-r-lg border-l-4 border-blue-600 bg-blue-50 p-4 text-left text-slate-900 transition-colors hover:bg-blue-100 dark:border-blue-400 dark:bg-blue-950/40 dark:text-slate-100 dark:hover:bg-blue-950/60' : 'min-h-11 rounded-xl border border-blue-200 p-4 text-left font-semibold text-blue-700 dark:text-blue-300'}>
            {isDesktopSearch ? <>
              <span className="font-semibold">{result.chemical.name}</span>
              {result.chemical.casNumber && <span className="text-xs text-slate-600 dark:text-slate-400">CAS {result.chemical.casNumber}</span>}
              <span className="text-xs text-slate-500 dark:text-slate-400">{t('search_results_chemical')}</span>
            </> : <>{lastSearchQuery} · {t('search_results_chemical')}</>}
          </button>}

          {mediaProducts.length > 0 && (
            <div>
              {result && (
                <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2 mt-4">
                  {t('search_results_product')}
                </h3>
              )}

              <MediaProductFilter
                brands={mediaBrands}
                selectedBrand={selectedBrand}
                onBrandChange={onBrandChange}
                sortBy={sortBy}
                onSortChange={onSortChange}
                totalCount={mediaCount}
                onClearFilters={onClearFilters}
              />

              <div className="flex flex-col gap-3">
                {(showAllProducts ? mediaProducts : mediaProducts.slice(0, 5)).map((product) => (
                  <MediaProductCard
                    key={product.id}
                    product={product}
                    onSelected={product => { setClosedResultQuery(null); onProductResultClick?.(product); }}
                    onNavigateToCabinet={onNavigateToCabinet}
                  />
                ))}
              </div>
              {mediaProducts.length > 5 && (
                <button
                  onClick={onToggleShowAllProducts}
                  className="w-full mt-3 py-2 px-4 flex items-center justify-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"
                >
                  {showAllProducts ? (
                    <>
                      <ChevronUp className="w-4 h-4" />
                      {t('app_fold')}
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-4 h-4" />
                      {t('app_view_more_count', { count: mediaProducts.length - 5 })}
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      ) : isLoading ? (
        <div aria-hidden="true" className="flex flex-col gap-3">
          <div className="h-20 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
          <div className="h-14 animate-pulse rounded-2xl bg-slate-100/70 dark:bg-slate-800/70" />
          <div className="h-14 animate-pulse rounded-2xl bg-slate-100/50 dark:bg-slate-800/50" />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {!isDesktopSearch && <section className="hidden wide:block">
            <div className="mb-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{t('search_preview_title')}</h3>
            </div>
            <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="max-w-md text-center">
                <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-blue-50 text-blue-300 dark:bg-blue-950/30 dark:text-blue-700">
                  <Search className="h-16 w-16" />
                </div>
                <h4 className="mt-6 text-2xl font-bold text-slate-900 dark:text-slate-100">{t('search_preview_empty_title')}</h4>
                <p className="mt-3 text-base leading-7 text-slate-500 dark:text-slate-400">
                  {t('search_preview_empty_desc')}
                </p>
              </div>
            </div>
          </section>}

          {recentSearches.length > 0 && !isSearchFocused && !isMobileSearch && (
            <section className={isDesktopSearch ? 'hidden' : 'wide:hidden'}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('guide_example')}</h3>
                <button
                  type="button"
                  onClick={onClearSearchHistory}
                  className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                >
                  {t('recent_clear')}
                </button>
              </div>
              <ul className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_14px_32px_-26px_rgba(15,23,42,0.24)] divide-y divide-slate-100 dark:divide-slate-700/70 dark:border-slate-700/70 dark:bg-slate-800">
                {renderRecentSearchRows()}
              </ul>
            </section>
          )}

          {showMobileWasteLogLine && latestWasteLog && !isSearchFocused && (
            <button
              type="button"
              onClick={onOpenLogs}
              className="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-2.5 text-left shadow-[0_14px_32px_-26px_rgba(15,23,42,0.24)] transition-colors hover:border-emerald-200 active:bg-emerald-50 dark:border-slate-700/70 dark:bg-slate-800 dark:hover:border-emerald-900/60 dark:active:bg-emerald-950/20 wide:hidden"
            >
              <ClipboardList className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <span className="shrink-0 text-sm font-bold text-slate-800 dark:text-slate-100">{todaySummaryLabel}</span>
              <span className="min-w-0 flex-1 text-right">
                <span className="inline-block max-w-full truncate rounded-full bg-emerald-50 px-2.5 py-1 align-middle text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  {getWasteLogTitle(latestWasteLog)}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      </div>
        </div>

        {!isDesktopSearch && <aside className="mt-5 hidden flex-col gap-5 wide:flex">
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{t('guide_example')}</h3>
              {recentSearches.length > 0 && (
                <button
                  onClick={onClearSearchHistory}
                  className="text-xs font-semibold text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-300"
                >
                  {t('recent_clear')}
                </button>
              )}
            </div>
            <div className="space-y-2">
              {recentSearches.length > 0 ? recentSearches.slice(0, 6).map((term) => (
                <button
                  key={term}
                  type="button"
                  onClick={() => handleHistorySelect(term)}
                  className="flex w-full items-center gap-3 rounded-lg border border-slate-100 px-3 py-3 text-left text-sm font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-800 dark:text-slate-200 dark:hover:border-blue-900/60 dark:hover:bg-blue-950/30 dark:hover:text-blue-300"
                >
                  <Search className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate">{term}</span>
                  <ArrowUp className="h-4 w-4 rotate-45 text-slate-300" />
                </button>
              )) : (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700">
                  {t('search_placeholder')}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {t('cart_title')}
                </h3>
              </div>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                {cartCount}
              </span>
            </div>

            {visibleCartItems.length > 0 ? (
              <div className="space-y-2">
                {visibleCartItems.map((item) => (
                  <div
                    key={item.chemical.id}
                    className="rounded-lg border border-slate-100 px-3 py-3 dark:border-slate-800"
                  >
                    <div className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">
                      {item.chemical.name}
                    </div>
                    <div className="mt-1 truncate text-xs font-medium text-slate-500 dark:text-slate-400">
                      {t(item.label)}
                    </div>
                  </div>
                ))}
                {hiddenCartCount > 0 && (
                  <div className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-center text-xs font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    +{hiddenCartCount}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700">
                {t('cart_empty')}
              </div>
            )}

            {cartCount > 0 && onOpenCart && (
              <button
                type="button"
                onClick={onOpenCart}
                className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-bold text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                {t('cart_title')}
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </section>

          {showRecentWasteLogs && (
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {t('tab_logs')}
                  </h3>
                </div>
                {onOpenLogs && (
                  <button
                    type="button"
                    onClick={onOpenLogs}
                    className="text-xs font-semibold text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    {t('log_view_details')}
                  </button>
                )}
              </div>

              {isWasteLogsLoading ? (
                <div className="flex min-h-28 items-center justify-center text-slate-400">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : wasteLogsError ? (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700">
                  {t('common_load_failed')}
                </div>
              ) : recentWasteLogs.length > 0 ? (
                <div className="space-y-2">
                  {recentWasteLogs.map((log) => {
                    const logTitle = getWasteLogTitle(log);
                    const logCategory = getWasteLogCategoryLabel(log);
                    return (
                    <button
                      key={log.id}
                      type="button"
                      onClick={onOpenLogs}
                      className="flex w-full items-start gap-3 rounded-lg border border-slate-100 px-3 py-3 text-left transition-colors hover:border-emerald-200 hover:bg-emerald-50 dark:border-slate-800 dark:hover:border-emerald-900/60 dark:hover:bg-emerald-950/20"
                    >
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-slate-800 dark:text-slate-100">
                          {logTitle}
                        </span>
                        {logCategory !== logTitle && (
                          <span className="mt-1 block truncate text-xs text-slate-500 dark:text-slate-400">
                            {logCategory}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-2xs font-semibold text-slate-400">
                        {formatWasteLogDate(log.created_at)}
                      </span>
                    </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700">
                  {t('log_empty')}
                </div>
              )}
            </section>
          )}
        </aside>}
        </div>
        <section ref={detailPaneRef} data-pane="detail" className="min-h-0 overflow-y-auto p-4">
          {result ? (
            <ResultCard
              key={resultIdentity ?? undefined}
              result={result}
              scanSelectionMeta={scanSelectionMeta}
              sourceSearchEventId={sourceSearchEventId}
              onReset={onReset}
              onAddConfirmed={onResultAddConfirmed}
              onRequireAuth={onRequireAuth}
              onRegisterInventory={wasteComponentSearchMode ? undefined : handleRegisterResultInventory}
              headerAccessory={ownedCabinetChips}
            />
          ) : isLoading ? (
            <div className="flex flex-col gap-3">
              {isAiAnalyzing && (
                <div className="flex items-center gap-3 rounded-xl border border-purple-100 bg-purple-50 p-4 text-sm text-purple-600 dark:border-purple-900/30 dark:bg-purple-900/20 dark:text-purple-400">
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  <span className="font-medium">{t('app_ai_analyzing')}</span>
                </div>
              )}
              <ResultSkeleton />
            </div>
          ) : (
            <div className={isDesktopSearch ? 'flex h-full min-h-48 flex-col items-center justify-center gap-3 p-8 text-center text-slate-500 dark:text-slate-400' : 'flex h-full min-h-48 items-center justify-center text-center text-slate-500'}>
              {isDesktopSearch ? <>
                <Search className="h-8 w-8 text-slate-400 dark:text-slate-500" aria-hidden="true" />
                <h3 className="font-semibold text-slate-700 dark:text-slate-300">{t('search_desktop_select_title')}</h3>
                <p className="max-w-sm text-sm">{t('search_desktop_select_description')}</p>
              </> : t('search_preview_empty_desc')}
            </div>
          )}
        </section>
      </AdaptivePaneLayout>

      {inventoryDraft && (
        <InventoryRegistrationModal
          product={inventoryDraft.product}
          initialCasNumber={inventoryDraft.casNumber}
          isOpen
          onClose={() => setInventoryDraft(null)}
          onNavigateToCabinet={onNavigateToCabinet}
        />
      )}
    </div>
  );
}
