import React, { useState, useCallback } from 'react';
import { MainLayout } from './components/MainLayout';
import { ResultCard } from './components/ResultCard';
import { MediaProductCard } from './components/MediaProductCard';
import { MediaProductFilter } from './components/MediaProductFilter';
import { Scanner } from './components/Scanner';
import { CartView } from './components/CartView';
import { SafetyDisclaimer } from './components/SafetyDisclaimer';
import { searchChemical } from './services/searchService';
import { searchMediaProductsAdvanced, type MediaProduct, type SortOption } from './services/mediaProductService';
import { analyzeChemical } from './utils/chemicalAnalyzer';
import { useWasteStore } from './store/useWasteStore';
import { useTranslation } from 'react-i18next';
import type { AnalysisResult } from './types';
import { Search, Camera, Loader2, AlertCircle, ShoppingBag, ChevronDown, ChevronUp } from 'lucide-react';

function App() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [lastSearchQuery, setLastSearchQuery] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [mediaProducts, setMediaProducts] = useState<MediaProduct[]>([]);
  const [mediaBrands, setMediaBrands] = useState<string[]>([]);
  const [mediaCount, setMediaCount] = useState(0);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState('all');
  const [sortBy, setSortBy] = useState<SortOption>('relevance');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);

  const cart = useWasteStore((state) => state.cart);
  const { recentSearches, addSearchHistory, removeSearchHistory, clearSearchHistory } = useWasteStore();

  const performSearch = useCallback(async (searchQuery: string, brand: string = 'all', sort: SortOption = 'relevance') => {
    if (!searchQuery.trim()) return;

    setIsLoading(true);
    setError(null);
    setResult(null);
    setMediaProducts([]);
    setMediaBrands([]);
    setMediaCount(0);
    setLastSearchQuery(searchQuery);

    try {
      // Parallel search: chemicals + media products
      const [chemicalData, mediaSearchResult] = await Promise.all([
        searchChemical(searchQuery),
        searchMediaProductsAdvanced({
          query: searchQuery,
          limit: 50,
          brandFilter: brand,
          sortBy: sort
        })
      ]);

      if (chemicalData) {
        const analysis = analyzeChemical(chemicalData);
        setResult(analysis);
      }

      if (mediaSearchResult.products.length > 0) {
        setMediaProducts(mediaSearchResult.products);
        setMediaBrands(mediaSearchResult.brands);
        setMediaCount(mediaSearchResult.totalCount);
      }

      // Show error only if both searches returned nothing
      if (!chemicalData && mediaSearchResult.products.length === 0) {
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

  // Re-search when filter/sort changes
  const handleBrandChange = (brand: string) => {
    setSelectedBrand(brand);
    setShowAllProducts(false);
    if (lastSearchQuery) {
      performSearch(lastSearchQuery, brand, sortBy);
    }
  };

  const handleSortChange = (sort: SortOption) => {
    setSortBy(sort);
    setShowAllProducts(false);
    if (lastSearchQuery) {
      performSearch(lastSearchQuery, selectedBrand, sort);
    }
  };

  const handleClearFilters = () => {
    setSelectedBrand('all');
    setSortBy('relevance');
    if (lastSearchQuery) {
      performSearch(lastSearchQuery, 'all', 'relevance');
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSelectedBrand('all');
    setSortBy('relevance');
    performSearch(query);
  };

  const handleScan = (scannedText: string) => {
    setIsScanning(false);
    setQuery(scannedText);
    setSelectedBrand('all');
    setSortBy('relevance');
    performSearch(scannedText);
  };

  const handleReset = () => {
    setResult(null);
    setMediaProducts([]);
    setMediaBrands([]);
    setMediaCount(0);
    setShowAllProducts(false);
    setSelectedBrand('all');
    setSortBy('relevance');
    setLastSearchQuery('');
    setQuery('');
    setError(null);
  };

  return (
    <>
      <SafetyDisclaimer />

      {isScanning && (
        <Scanner
          onScan={handleScan}
          onClose={() => setIsScanning(false)}
        />
      )}

      {isCartOpen && (
        <CartView onClose={() => setIsCartOpen(false)} />
      )}

      <MainLayout onLogoClick={handleReset}>
        <div className="p-5 flex flex-col gap-6" style={{ paddingBottom: '100px' }}>

          {/* Header Section - Hide when showing result to focus */}
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

          {/* Search Bar */}
          <form onSubmit={handleSearch} className="relative group z-20">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className={`w-5 h-5 transition-colors ${error ? 'text-red-400' : 'text-gray-400 dark:text-gray-500 group-focus-within:text-blue-500 dark:group-focus-within:text-blue-400'}`} />
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={`block w-full pl-10 pr-12 py-4 border rounded-xl leading-5 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 placeholder:text-sm focus:outline-none focus:ring-2 shadow-sm transition-all ${error
                ? 'border-red-300 dark:border-red-900/50 focus:ring-red-500 focus:border-red-500'
                : 'border-gray-200 dark:border-slate-700 focus:ring-blue-500 focus:border-transparent'
                }`}
              placeholder={t('search_placeholder')}
              disabled={isLoading}
            />
            {/* Right Action Icon (Loader or Clear) */}
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
              {isLoading ? (
                <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
              ) : (result || mediaProducts.length > 0) ? (
                <button type="button" onClick={handleReset} className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300">
                  <span className="sr-only">Reset</span>
                  X
                </button>
              ) : null}
            </div>
          </form>

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg text-sm animate-in fade-in slide-in-from-top-1 border border-red-100 dark:border-red-900/30">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          {/* Main Content Area */}
          {(result || mediaProducts.length > 0) ? (
            <div className="flex flex-col gap-4">
              {/* Chemical Result */}
              {result && (
                <div>
                  {mediaProducts.length > 0 && (
                    <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
                      {t('search_results_chemical')}
                    </h3>
                  )}
                  <ResultCard result={result} onReset={handleReset} />
                </div>
              )}

              {/* Media Products Results */}
              {mediaProducts.length > 0 && (
                <div>
                  {result && (
                    <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2 mt-4">
                      {t('search_results_product')}
                    </h3>
                  )}

                  {/* Filter Controls */}
                  <MediaProductFilter
                    brands={mediaBrands}
                    selectedBrand={selectedBrand}
                    onBrandChange={handleBrandChange}
                    sortBy={sortBy}
                    onSortChange={handleSortChange}
                    totalCount={mediaCount}
                    onClearFilters={handleClearFilters}
                  />

                  <div className="flex flex-col gap-3">
                    {(showAllProducts ? mediaProducts : mediaProducts.slice(0, 5)).map((product) => (
                      <MediaProductCard key={product.id} product={product} />
                    ))}
                  </div>
                  {mediaProducts.length > 5 && (
                    <button
                      onClick={() => setShowAllProducts(!showAllProducts)}
                      className="w-full mt-3 py-2 px-4 flex items-center justify-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"
                    >
                      {showAllProducts ? (
                        <>
                          <ChevronUp className="w-4 h-4" />
                          접기
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-4 h-4" />
                          +{mediaProducts.length - 5}개 더 보기
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Default View: Buttons & Tips */
            <div className={`flex flex-col gap-6 transition-opacity duration-300 ${isLoading ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>

              {/* Quick Suggestions */}
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-5 px-5 no-scrollbar">
                {['Water', 'Ethanol', 'HCl', 'NaOH'].map((item) => (
                  <button
                    key={item}
                    onClick={() => { setQuery(item); setTimeout(() => performSearch(item), 0); }}
                    className="whitespace-nowrap px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-full text-sm text-gray-600 dark:text-gray-300 shadow-sm active:bg-gray-50 dark:active:bg-slate-700 from-blue-50 to-white"
                  >
                    {item}
                  </button>
                ))}
              </div>

              {/* Scanner Button */}
              <button
                onClick={() => setIsScanning(true)}
                className="w-full h-40 bg-blue-600 dark:bg-blue-700 rounded-2xl flex flex-col items-center justify-center gap-3 shadow-lg shadow-blue-200 dark:shadow-blue-900/20 active:scale-[0.98] transition-all group cursor-pointer hover:bg-blue-700 dark:hover:bg-blue-600"
              >
                <div className="p-4 bg-white/20 rounded-full group-hover:bg-white/30 transition-colors">
                  <Camera className="w-10 h-10 text-white" />
                </div>
                <span className="text-white font-semibold text-lg">{t('btn_scan')}</span>
              </button>

              {/* Recent Search History */}
              {recentSearches.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-slate-800 dark:text-slate-200">{t('guide_example')}</h3>
                    <button
                      onClick={clearSearchHistory}
                      className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                    >
                      {t('recent_clear')}
                    </button>
                  </div>
                  <div className="space-y-3">
                    {recentSearches.map((term) => (
                      <div
                        key={term}
                        onClick={() => { setQuery(term); performSearch(term); }}
                        className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 p-4 rounded-xl flex items-center justify-between shadow-sm active:bg-gray-50 dark:active:bg-slate-700 transition-colors cursor-pointer group"
                      >
                        <span className="font-medium text-slate-700 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 flex items-center gap-2">
                          <div className="bg-gray-100 dark:bg-slate-700 p-1 rounded-md">
                            <Search className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                          </div>
                          {term}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeSearchHistory(term); }}
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

        {/* Floating Cart Button */}
        {cart.length > 0 && !isCartOpen && (
          <button
            onClick={() => setIsCartOpen(true)}
            className="absolute bottom-6 right-6 w-14 h-14 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-full shadow-2xl flex items-center justify-center z-40 active:scale-90 transition-transform animate-in fade-in slide-in-from-bottom-4"
          >
            <ShoppingBag className="w-6 h-6" />
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center font-bold border-2 border-white dark:border-slate-900 text-white">{cart.length}</span>
          </button>
        )}
      </MainLayout>
    </>
  )
}

export default App;
