import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { TFunction } from 'i18next';
import { searchChemical } from '../services/searchService';
import { fetchPubchemSuggestions } from '../services/pubchemApi';
import { fetchKoshaSuggestions } from '../services/koshaApi';
import { cabinetService, type CabinetSearchResult } from '../services/cabinetService';
import { searchMediaProductsAdvanced, type MediaProduct, type SortOption } from '../services/mediaProductService';
import { analyzeChemical } from '../utils/chemicalAnalyzer';
import { classifyChemicalWithAI } from '../services/geminiClassificationService';
import type { AnalysisResult } from '../types';

interface UseSearchFlowParams {
  pathname: string;
  searchParams: URLSearchParams;
  navigate: NavigateFunction;
  t: TFunction;
  addSearchHistory: (query: string) => void;
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
  navigateWithFreshFilters: (rawQuery: string) => void;
  suggestions: string[];
  isSuggestionsLoading: boolean;
  clearSuggestions: () => void;
}

export function useSearchFlow({
  pathname,
  searchParams,
  navigate,
  t,
  addSearchHistory,
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

  // Autocomplete states
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);

  const urlQuery = useMemo(() => searchParams.get('q'), [searchParams]);
  const isSearchTab = useMemo(() => !pathname.startsWith('/logs')
    && !pathname.startsWith('/cabinet')
    && !pathname.startsWith('/inventory')
    && !pathname.startsWith('/admin'), [pathname]);

  const performSearch = useCallback(async (searchQuery: string, brand: string = 'all', sort: SortOption = 'relevance') => {
    if (!searchQuery.trim()) return;

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

      if (chemicalData) {
        let analysis = analyzeChemical(chemicalData);

        // 규칙 기반 분류 실패 시에만 AI 분류를 보조로 사용한다.
        if (analysis.category === 'UNKNOWN') {
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

        setResult(analysis);
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
    } catch (err) {
      setError(t('search_error'));
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [t, addSearchHistory]);

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
  }, [urlQuery, lastSearchQuery, isLoading, performSearch, isSearchTab]);

  // Debounced autocomplete effect
  useEffect(() => {
    if (!isSearchTab) return;

    // Don't search if query is too short, or if it matches the last executed search (meaning the user already searched it)
    if (query.trim().length < 2 || query.trim() === lastSearchQuery) {
      setSuggestions([]);
      setIsSuggestionsLoading(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSuggestionsLoading(true);
      try {
        // 한글 입력은 KOSHA, 그 외는 PubChem을 사용해 자동완성 품질을 맞춘다.
        const hasKorean = /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(query);
        const newSuggestions = hasKorean
          ? await fetchKoshaSuggestions(query)
          : await fetchPubchemSuggestions(query);
        setSuggestions(newSuggestions);
      } catch (err) {
        setSuggestions([]);
      } finally {
        setIsSuggestionsLoading(false);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [query, lastSearchQuery, isSearchTab]);

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
  }, []);

  const handleBrandChange = useCallback((brand: string) => {
    setSelectedBrand(brand);
    setShowAllProducts(false);
    if (lastSearchQuery) {
      performSearch(lastSearchQuery, brand, sortBy);
    }
  }, [lastSearchQuery, performSearch, sortBy]);

  const handleSortChange = useCallback((sort: SortOption) => {
    setSortBy(sort);
    setShowAllProducts(false);
    if (lastSearchQuery) {
      performSearch(lastSearchQuery, selectedBrand, sort);
    }
  }, [lastSearchQuery, performSearch, selectedBrand]);

  const handleClearFilters = useCallback(() => {
    setSelectedBrand('all');
    setSortBy('relevance');
    if (lastSearchQuery) {
      performSearch(lastSearchQuery, 'all', 'relevance');
    }
  }, [lastSearchQuery, performSearch]);

  const navigateWithFreshFilters = useCallback((rawQuery: string) => {
    const normalized = rawQuery.trim();
    setSelectedBrand('all');
    setSortBy('relevance');
    if (!normalized) {
      navigate('/');
      return;
    }
    navigate(`/?q=${encodeURIComponent(normalized)}`);
  }, [navigate]);

  const handleSearch = useCallback((e?: FormEvent) => {
    e?.preventDefault();
    navigateWithFreshFilters(query);
  }, [navigateWithFreshFilters, query]);

  const handleReset = useCallback(() => {
    navigate('/');
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
  };
}
