import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { TFunction } from 'i18next';
import { searchChemical } from '../services/searchService';
import { getSearchErrorMessageKey } from '../utils/searchErrorMessage';
import { fetchChemicalSuggestions } from '../services/chemicalSuggestionService';
import { cabinetService, type CabinetSearchResult } from '../services/cabinetService';
import { searchMediaProductsAdvanced, type MediaProduct, type SortOption } from '../services/mediaProductService';
import { analyzeChemical } from '../utils/chemicalAnalyzer';
import { classifyChemicalWithAI } from '../services/aiClassificationService';
import type { AnalysisResult } from '../types';
import { getLabAppScopedPath, labAppRoute } from '../utils/appRoutes';
import { hasCasNumberFormat, normalizeCasNumber } from '../utils/casNumber';
import {
  recordSearchAction,
  recordSearchEvent,
  type SearchAnalyticsChannel,
} from '../services/searchAnalyticsService';

interface UseSearchFlowParams {
  pathname: string;
  searchParams: URLSearchParams;
  navigate: NavigateFunction;
  t: TFunction;
  addSearchHistory: (query: string) => void;
  labId?: string | null;
}

interface UseSearchFlowResult {
  query: string;
  setQuery: (value: string) => void;
  lastSearchQuery: string;
  result: AnalysisResult | null;
  mediaProducts: MediaProduct[];
  mediaBrands: string[];
  mediaCount: number;
  cabinetResults: CabinetSearchResult[];
  showAllProducts: boolean;
  setShowAllProducts: (value: boolean) => void;
  selectedBrand: string;
  sortBy: SortOption;
  isLoading: boolean;
  isAiAnalyzing: boolean;
  error: string | null;
  handleBrandChange: (brand: string) => void;
  handleSortChange: (sort: SortOption) => void;
  handleClearFilters: () => void;
  handleSearch: (e?: FormEvent) => void;
  handleReset: () => void;
  navigateWithFreshFilters: (rawQuery: string, channel?: SearchAnalyticsChannel) => void;
  suggestions: string[];
  isSuggestionsLoading: boolean;
  clearSuggestions: () => void;
  currentSearchEventId: string | null;
}

export function useSearchFlow({
  pathname,
  searchParams,
  navigate,
  t,
  addSearchHistory,
  labId,
}: UseSearchFlowParams): UseSearchFlowResult {
  const [query, setQuery] = useState('');
  const [lastSearchQuery, setLastSearchQuery] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [mediaProducts, setMediaProducts] = useState<MediaProduct[]>([]);
  const [mediaBrands, setMediaBrands] = useState<string[]>([]);
  const [mediaCount, setMediaCount] = useState(0);
  const [cabinetResults, setCabinetResults] = useState<CabinetSearchResult[]>([]);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState('all');
  const [sortBy, setSortBy] = useState<SortOption>('relevance');
  const [isLoading, setIsLoading] = useState(false);
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentSearchEventId, setCurrentSearchEventId] = useState<string | null>(null);

  // Autocomplete states
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const searchSequenceRef = useRef(0);
  const referencePhRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSearchChannelRef = useRef<SearchAnalyticsChannel>('url');

  const urlQuery = useMemo(() => searchParams.get('q'), [searchParams]);
  const isSearchTab = useMemo(() => {
    const appPathname = getLabAppScopedPath(pathname);
    return !appPathname.startsWith('/logs')
      && !appPathname.startsWith('/cabinet')
      && !appPathname.startsWith('/inventory')
      && !appPathname.startsWith('/admin')
      && !pathname.startsWith('/center')
      && !pathname.startsWith('/ops')
      && !pathname.startsWith('/feedback-admin');
  }, [pathname]);

  const performSearch = useCallback(async (
    searchQuery: string,
    brand: string = 'all',
    sort: SortOption = 'relevance',
    trackSubmittedSearch: boolean = true,
  ) => {
    if (!searchQuery.trim()) return;

    const searchSequence = ++searchSequenceRef.current;
    const searchChannel = pendingSearchChannelRef.current;
    const searchStartedAt = performance.now();
    if (trackSubmittedSearch) {
      pendingSearchChannelRef.current = 'url';
      setCurrentSearchEventId(null);
    }
    if (referencePhRetryRef.current) {
      clearTimeout(referencePhRetryRef.current);
      referencePhRetryRef.current = null;
    }

    if (hasCasNumberFormat(searchQuery) && !normalizeCasNumber(searchQuery)) {
      setIsLoading(false);
      setIsAiAnalyzing(false);
      setResult(null);
      setMediaProducts([]);
      setMediaBrands([]);
      setMediaCount(0);
      setCabinetResults([]);
      setLastSearchQuery(searchQuery);
      setError(t('search_invalid_cas_checksum', 'CAS 번호의 검증 숫자가 올바르지 않습니다. 번호를 확인해 주세요.'));
      if (trackSubmittedSearch) {
        void recordSearchEvent({
          rawQuery: searchQuery,
          searchChannel,
          outcome: 'invalid_query',
          labId,
          latencyMs: Math.round(performance.now() - searchStartedAt),
        }).then((eventId) => {
          if (searchSequenceRef.current === searchSequence) setCurrentSearchEventId(eventId);
        });
      }
      return;
    }

    setIsLoading(true);
    setIsAiAnalyzing(false);
    setError(null);
    setResult(null);
    setMediaProducts([]);
    setMediaBrands([]);
    setMediaCount(0);
    setCabinetResults([]);
    setLastSearchQuery(searchQuery);

    try {
      // 화학물질/제품/시약장 검색은 병렬로 실행해 응답 지연을 줄인다.
      const [chemicalData, mediaSearchResult, cabinetSearchResult] = await Promise.all([
        searchChemical(searchQuery),
        searchMediaProductsAdvanced({
          query: searchQuery,
          limit: 50,
          brandFilter: brand,
          sortBy: sort,
        }),
        cabinetService.searchCabinetItems(searchQuery),
      ]);

      if (searchSequenceRef.current !== searchSequence) return;

      if (chemicalData) {
        let analysis = analyzeChemical(chemicalData);

        // 규칙 기반 분류 실패 시에만 AI 분류를 보조로 사용한다.
        if (analysis.category === 'UNKNOWN' &&
          analysis.materialProfile?.kind !== 'possible_ionic_organic_material') {
          setIsAiAnalyzing(true);
          try {
            const aiResult = await classifyChemicalWithAI(chemicalData);
            if (aiResult) {
              analysis = { ...analysis, ...aiResult };
            }
          } finally {
            setIsAiAnalyzing(false);
          }
        }

        if (searchSequenceRef.current !== searchSequence) return;

        setResult(analysis);

        const referencePhStatus = chemicalData.referencePhLookup?.status;
        if (referencePhStatus === 'pending' || referencePhStatus === 'transient_error') {
          const retryAfterMs = chemicalData.referencePhLookup?.retryAfterMs || 2_000;
          referencePhRetryRef.current = setTimeout(async () => {
            try {
              const refreshedChemical = await searchChemical(searchQuery);
              if (!refreshedChemical || searchSequenceRef.current !== searchSequence) return;
              const refreshedAnalysis = analyzeChemical(refreshedChemical);
              setResult((previous) => previous?.isAiEstimated && refreshedAnalysis.category === 'UNKNOWN'
                ? { ...previous, chemical: refreshedChemical }
                : refreshedAnalysis);
            } catch (retryError) {
              if (import.meta.env.DEV) console.warn('[Chemical search] Refresh failed:', retryError);
            } finally {
              referencePhRetryRef.current = null;
            }
          }, retryAfterMs);
        }
      }

      if (mediaSearchResult.products.length > 0) {
        setMediaProducts(mediaSearchResult.products);
        setMediaBrands(mediaSearchResult.brands);
        setMediaCount(mediaSearchResult.totalCount);
      }

      if (cabinetSearchResult.length > 0) {
        setCabinetResults(cabinetSearchResult);
      }

      if (!chemicalData && mediaSearchResult.products.length === 0 && cabinetSearchResult.length === 0) {
        setError(`'${searchQuery}'${t('search_not_found')}`);
      } else {
        addSearchHistory(searchQuery);
      }

      if (trackSubmittedSearch) {
        const chemical = chemicalData;
        void recordSearchEvent({
          rawQuery: searchQuery,
          searchChannel,
          outcome: chemicalData || mediaSearchResult.products.length > 0 || cabinetSearchResult.length > 0
            ? 'matched'
            : 'no_result',
          labId,
          chemicalResultCount: chemicalData ? 1 : 0,
          productResultCount: mediaSearchResult.totalCount,
          cabinetResultCount: cabinetSearchResult.length,
          latencyMs: Math.round(performance.now() - searchStartedAt),
          matchedCas: chemical?.casNumber || null,
          matchedPubchemCid: chemical && /^\d+$/.test(chemical.id) ? Number(chemical.id) : null,
          matchedKoshaId: chemical?.koshaId ?? null,
          matchedStandardName: chemical?.name || null,
        }).then((eventId) => {
          if (searchSequenceRef.current !== searchSequence) return;
          setCurrentSearchEventId(eventId);
          if (eventId && chemical) {
            void recordSearchAction({
              eventId,
              actionType: 'result_opened',
              targetType: 'chemical',
              targetRef: chemical.id,
              matchedCas: chemical.casNumber || null,
              matchedStandardName: chemical.name,
            });
          }
        });
      }
    } catch (err) {
      if (searchSequenceRef.current !== searchSequence) return;
      const isOnline = typeof navigator === 'undefined' || navigator.onLine;
      setError(t(getSearchErrorMessageKey(err, isOnline)));
      if (import.meta.env.DEV) console.error(err);
      if (trackSubmittedSearch) {
        void recordSearchEvent({
          rawQuery: searchQuery,
          searchChannel,
          outcome: 'technical_error',
          labId,
          latencyMs: Math.round(performance.now() - searchStartedAt),
        }).then((eventId) => {
          if (searchSequenceRef.current === searchSequence) setCurrentSearchEventId(eventId);
        });
      }
    } finally {
      if (searchSequenceRef.current === searchSequence) setIsLoading(false);
    }
  }, [t, addSearchHistory, labId]);

  useEffect(() => () => {
    searchSequenceRef.current += 1;
    if (referencePhRetryRef.current) clearTimeout(referencePhRetryRef.current);
  }, []);

  useEffect(() => {
    if (!isSearchTab) return;

    if (urlQuery) {
      if (urlQuery !== lastSearchQuery && !isLoading) {
        setQuery(urlQuery);
        performSearch(urlQuery);
      }
      return;
    }

    if (!lastSearchQuery) return;

    setQuery('');
    setResult(null);
    setMediaProducts([]);
    setMediaBrands([]);
    setMediaCount(0);
    setCabinetResults([]);
    setShowAllProducts(false);
    setSelectedBrand('all');
    setSortBy('relevance');
    setLastSearchQuery('');
    setError(null);
    setIsAiAnalyzing(false);
    setCurrentSearchEventId(null);
  }, [urlQuery, lastSearchQuery, isLoading, performSearch, isSearchTab]);

  // Debounced autocomplete effect
  useEffect(() => {
    if (!isSearchTab) return;

    const trimmedQuery = query.trim();

    // Don't search if query is too short, or if it matches the last executed search (meaning the user already searched it)
    if (trimmedQuery.length < 2 || trimmedQuery === lastSearchQuery.trim()) {
      setSuggestions([]);
      setIsSuggestionsLoading(false);
      return;
    }

    let isActive = true;
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      setIsSuggestionsLoading(true);
      try {
        const newSuggestions = await fetchChemicalSuggestions(trimmedQuery, 5, controller.signal);
        if (isActive) {
          setSuggestions(newSuggestions);
        }
      } catch {
        if (isActive) {
          setSuggestions([]);
        }
      } finally {
        if (isActive) {
          setIsSuggestionsLoading(false);
        }
      }
    }, 300); // 300ms debounce

    return () => {
      isActive = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, lastSearchQuery, isSearchTab]);

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
  }, []);

  const handleBrandChange = useCallback((brand: string) => {
    setSelectedBrand(brand);
    setShowAllProducts(false);
    if (lastSearchQuery) {
      performSearch(lastSearchQuery, brand, sortBy, false);
    }
  }, [lastSearchQuery, performSearch, sortBy]);

  const handleSortChange = useCallback((sort: SortOption) => {
    setSortBy(sort);
    setShowAllProducts(false);
    if (lastSearchQuery) {
      performSearch(lastSearchQuery, selectedBrand, sort, false);
    }
  }, [lastSearchQuery, performSearch, selectedBrand]);

  const handleClearFilters = useCallback(() => {
    setSelectedBrand('all');
    setSortBy('relevance');
    if (lastSearchQuery) {
      performSearch(lastSearchQuery, 'all', 'relevance', false);
    }
  }, [lastSearchQuery, performSearch]);

  const navigateWithFreshFilters = useCallback((
    rawQuery: string,
    channel: SearchAnalyticsChannel = 'manual',
  ) => {
    const normalized = rawQuery.trim();
    setSelectedBrand('all');
    setSortBy('relevance');
    if (!normalized) {
      navigate(labAppRoute());
      return;
    }
    pendingSearchChannelRef.current = channel;
    navigate(`${labAppRoute()}?q=${encodeURIComponent(normalized)}`);
  }, [navigate]);

  const handleSearch = useCallback((e?: FormEvent) => {
    e?.preventDefault();
    navigateWithFreshFilters(query, 'manual');
  }, [navigateWithFreshFilters, query]);

  const handleReset = useCallback(() => {
    searchSequenceRef.current += 1;
    if (referencePhRetryRef.current) {
      clearTimeout(referencePhRetryRef.current);
      referencePhRetryRef.current = null;
    }
    navigate(labAppRoute());
  }, [navigate]);

  return {
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
    currentSearchEventId,
  };
}
