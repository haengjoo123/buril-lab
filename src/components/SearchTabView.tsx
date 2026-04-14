import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Camera, Loader2, AlertCircle, ChevronDown, ChevronUp, Box, Mic, ArrowUp, X } from 'lucide-react';
import { ResultCard } from './ResultCard';
import { MediaProductCard } from './MediaProductCard';
import { MediaProductFilter } from './MediaProductFilter';
import { OnboardingGuideCard } from './onboarding/OnboardingGuideCard';
import type { AnalysisResult } from '../types';
import type { CabinetSearchResult } from '../services/cabinetService';
import type { MediaProduct, SortOption } from '../services/mediaProductService';
import { useOnboardingStore } from '../store/useOnboardingStore';

interface SearchTabViewProps {
  cartCount: number;
  query: string;
  lastSearchQuery: string;
  isLoading: boolean;
  isAiAnalyzing: boolean;
  error: string | null;
  result: AnalysisResult | null;
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
  onSuggestionClick: (term: string) => void;
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
  isSuggestionsLoading?: boolean;
  onClearSuggestions?: () => void;
  onRequireAuth?: () => void;
  onOpenVoiceAgent?: () => void;
}

export function SearchTabView({
  cartCount,
  query,
  lastSearchQuery,
  isLoading,
  isAiAnalyzing,
  error,
  result,
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
  onSuggestionClick,
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
  isSuggestionsLoading = false,
  onClearSuggestions,
  onRequireAuth,
  onOpenVoiceAgent,
}: SearchTabViewProps) {
  const { t } = useTranslation();
  const showOnboardingGuide = useOnboardingStore((state) => state.hasCompletedWelcome && !state.hasSkippedOnboarding && !state.seenGuides.search);
  const markGuideSeen = useOnboardingStore((state) => state.markGuideSeen);
  const hasOtherResults = mediaProducts.length > 0 || cabinetResults.length > 0;
  const hasSearchResults = Boolean(result) || hasOtherResults;
  const showChemicalNotFoundNotice = !isLoading && !result && hasOtherResults && !!lastSearchQuery;

  return (
    <div className="p-5 flex flex-col gap-6" style={{ paddingBottom: cartCount > 0 ? '100px' : undefined }}>
      {showOnboardingGuide && (
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
      )}

      {!result && (
        <section className="mt-4 animate-in fade-in slide-in-from-top-2 duration-500">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 leading-tight">
            {t('app_subtitle_1')}<br />
            <span className="text-blue-600 dark:text-blue-400">{t('app_subtitle_2')}</span> {t('app_subtitle_3')}
          </h2>
          <p className="mt-2 text-slate-500 dark:text-slate-400 text-sm">
            {t('app_desc')}
          </p>
        </section>
      )}

      <form onSubmit={onSearchSubmit} className="relative group z-20">
        <div
          className={`rounded-[1.5rem] border bg-white dark:bg-slate-800 px-4 py-3 shadow-[0_14px_32px_-26px_rgba(15,23,42,0.24)] transition-all group-focus-within:-translate-y-0.5 group-focus-within:shadow-[0_20px_44px_-30px_rgba(37,99,235,0.22)] ${error
            ? 'border-red-300 dark:border-red-900/50'
            : 'border-slate-100 dark:border-slate-700/70'
            }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center transition-colors ${error
                ? 'text-red-500 dark:text-red-400'
                : 'text-slate-400 group-focus-within:text-blue-500 dark:text-slate-500 dark:group-focus-within:text-blue-400'
                }`}
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
            </div>

            <div className="min-w-0 flex-1">
              <input
                type="text"
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                className="block w-full bg-transparent text-base font-medium leading-5 text-gray-900 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none"
                placeholder={t('search_placeholder')}
                disabled={isLoading}
              />
            </div>

            {!isLoading && (query.trim() || hasSearchResults) && (
              <button
                type="button"
                onClick={onReset}
                aria-label={t('search_reset')}
                className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-200"
              >
                <span className="sr-only">{t('search_reset')}</span>
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenScanner}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-blue-50 px-4 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/40"
            >
              <Camera className="w-4 h-4" />
              <span>{t('btn_scan')}</span>
            </button>

            {onOpenVoiceAgent && (
              <button
                type="button"
                onClick={onOpenVoiceAgent}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <Mic className="w-4 h-4" />
                <span>{t('voice_agent_cta_speak')}</span>
              </button>
            )}
            <button
              type="submit"
              disabled={!query.trim() || isLoading}
              className={`ml-auto inline-flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300 ${
                query.trim() 
                  ? 'bg-slate-900 text-white shadow-md hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white' 
                  : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-600'
              }`}
              aria-label={t('lab_mgmt_search_btn')}
            >
              <ArrowUp className="w-5 h-5 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Autocomplete Dropdown */}
        {(suggestions.length > 0 || isSuggestionsLoading) && query.length >= 2 && !result && mediaProducts.length === 0 && cabinetResults.length === 0 && (
          <div className="absolute top-full left-0 right-0 mt-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-lg shadow-gray-200/50 dark:shadow-slate-900/50 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2">
            {isSuggestionsLoading && suggestions.length === 0 ? (
              <div className="p-4 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400 gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('search_loading_suggestions')}
              </div>
            ) : (
              <ul className="max-h-60 overflow-y-auto w-full">
                {suggestions.map((sug) => (
                  <li key={sug}>
                    <button
                      type="button"
                      className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 border-b border-gray-100 dark:border-slate-700/50 last:border-0 transition-colors flex items-center gap-3"
                      onClick={() => {
                        onSuggestionClick(sug);
                        if (onClearSuggestions) onClearSuggestions();
                      }}
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
      </form>

      {isAiAnalyzing && (
        <div className="flex items-center gap-3 text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 p-4 rounded-xl text-sm animate-in fade-in slide-in-from-top-1 border border-purple-100 dark:border-purple-900/30">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="font-medium">{t('app_ai_analyzing')}</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg text-sm animate-in fade-in slide-in-from-top-1 border border-red-100 dark:border-red-900/30">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {(result || mediaProducts.length > 0 || cabinetResults.length > 0) ? (
        <div className="flex flex-col gap-4">
          {showChemicalNotFoundNotice && (
            <div className="flex items-start gap-2 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg text-sm border border-amber-100 dark:border-amber-900/40">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
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
                  <div
                    key={item.itemId}
                    onClick={() => { void onCabinetResultClick(item); }}
                    className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-emerald-100 dark:border-emerald-900/50 cursor-pointer hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors flex flex-col gap-1"
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
                  </div>
                ))}
              </div>
            </div>
          )}

          {result && (
            <div>
              {(mediaProducts.length > 0 || cabinetResults.length > 0) && (
                <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2 mt-2">
                  {t('search_results_chemical')}
                </h3>
              )}
              <ResultCard result={result} onReset={onReset} onRequireAuth={onRequireAuth} />
            </div>
          )}

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
                  <MediaProductCard key={product.id} product={product} onNavigateToCabinet={onNavigateToCabinet} />
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
      ) : (
        <div className={`flex flex-col gap-6 transition-opacity duration-300 ${isLoading ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
          {recentSearches.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-slate-800 dark:text-slate-200">{t('guide_example')}</h3>
                <button
                  onClick={onClearSearchHistory}
                  className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                >
                  {t('recent_clear')}
                </button>
              </div>
              <div className="space-y-3">
                {recentSearches.map((term) => (
                  <div
                    key={term}
                    onClick={() => onSuggestionClick(term)}
                    className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/70 p-4 rounded-xl flex items-center justify-between shadow-[0_14px_32px_-26px_rgba(15,23,42,0.24)] hover:shadow-[0_20px_44px_-30px_rgba(37,99,235,0.15)] active:scale-[0.98] transition-all cursor-pointer group"
                  >
                    <span className="font-medium text-slate-700 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 flex items-center gap-2">
                      <div className="bg-gray-100 dark:bg-slate-700 p-1 rounded-md">
                        <Search className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                      </div>
                      {term}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveSearchHistory(term);
                      }}
                      aria-label={t('search_remove_history')}
                      className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <span className="sr-only">{t('search_remove_history')}</span>
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
