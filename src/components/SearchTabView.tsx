import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Camera, Loader2, AlertCircle, ChevronDown, ChevronUp, Box } from 'lucide-react';
import { ResultCard } from './ResultCard';
import { MediaProductCard } from './MediaProductCard';
import { MediaProductFilter } from './MediaProductFilter';
import type { AnalysisResult } from '../types';
import type { CabinetSearchResult } from '../services/cabinetService';
import type { MediaProduct, SortOption } from '../services/mediaProductService';

interface SearchTabViewProps {
  cartCount: number;
  query: string;
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
}

export function SearchTabView({
  cartCount,
  query,
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
}: SearchTabViewProps) {
  const { t } = useTranslation();

  return (
    <div className="p-5 flex flex-col gap-6" style={{ paddingBottom: cartCount > 0 ? '100px' : undefined }}>
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
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className={`w-5 h-5 transition-colors ${error ? 'text-red-400' : 'text-gray-400 dark:text-gray-500 group-focus-within:text-blue-500 dark:group-focus-within:text-blue-400'}`} />
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className={`block w-full pl-10 pr-12 py-4 border rounded-xl leading-5 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 placeholder:text-sm focus:outline-none focus:ring-2 shadow-sm transition-all ${error
            ? 'border-red-300 dark:border-red-900/50 focus:ring-red-500 focus:border-red-500'
            : 'border-gray-200 dark:border-slate-700 focus:ring-blue-500 focus:border-transparent'
            }`}
          placeholder={t('search_placeholder')}
          disabled={isLoading}
        />
        <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
          {isLoading ? (
            <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
          ) : (result || mediaProducts.length > 0 || cabinetResults.length > 0) ? (
            <button type="button" onClick={onReset} className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300">
              <span className="sr-only">Reset</span>
              X
            </button>
          ) : null}
        </div>

        {/* Autocomplete Dropdown */}
        {(suggestions.length > 0 || isSuggestionsLoading) && query.length >= 2 && !result && mediaProducts.length === 0 && cabinetResults.length === 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg shadow-gray-200/50 dark:shadow-slate-900/50 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2">
            {isSuggestionsLoading && suggestions.length === 0 ? (
              <div className="p-4 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400 gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('loading_suggestions', 'Loading suggestions...')}
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
              <ResultCard result={result} onReset={onReset} />
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
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-5 px-5 no-scrollbar">
            {['Water', 'Ethanol', 'HCl', 'NaOH'].map((item) => (
              <button
                key={item}
                onClick={() => onSuggestionClick(item)}
                className="whitespace-nowrap px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-full text-sm text-gray-600 dark:text-gray-300 shadow-sm active:bg-gray-50 dark:active:bg-slate-700 from-blue-50 to-white"
              >
                {item}
              </button>
            ))}
          </div>

          <button
            onClick={onOpenScanner}
            className="w-full h-40 bg-blue-600 dark:bg-blue-700 rounded-2xl flex flex-col items-center justify-center gap-3 shadow-lg shadow-blue-200 dark:shadow-blue-900/20 active:scale-[0.98] transition-all group cursor-pointer hover:bg-blue-700 dark:hover:bg-blue-600"
          >
            <div className="p-4 bg-white/20 rounded-full group-hover:bg-white/30 transition-colors">
              <Camera className="w-10 h-10 text-white" />
            </div>
            <span className="text-white font-semibold text-lg">{t('btn_scan')}</span>
          </button>

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
                    className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 p-4 rounded-xl flex items-center justify-between shadow-sm active:bg-gray-50 dark:active:bg-slate-700 transition-colors cursor-pointer group"
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
                      className="p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <span className="sr-only">Remove</span>
                      ✕
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
