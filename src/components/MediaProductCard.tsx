/**
 * Media Product Card Component
 * Displays a media product search result
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Package } from 'lucide-react';
import type { MediaProduct } from '../services/mediaProductService';

interface MediaProductCardProps {
    product: MediaProduct;
    onClose?: () => void;
}

export const MediaProductCard: React.FC<MediaProductCardProps> = ({ product, onClose }) => {
    const { t } = useTranslation();

    // CacheBy product page URL
    const productUrl = `https://www.cacheby.com/products/${product.url_slug}`;

    return (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-gray-100 dark:border-slate-700 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Header with tag */}
            <div className="bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-white" />
                    <span className="text-white text-sm font-medium">{t('media_product_label') || '배지/시약 제품'}</span>
                </div>
                {onClose && (
                    <button
                        onClick={onClose}
                        className="text-white/80 hover:text-white transition-colors"
                    >
                        ✕
                    </button>
                )}
            </div>

            {/* Product Info */}
            <div className="p-4">
                <div className="flex gap-4">
                    {/* Thumbnail */}
                    <div className="flex-shrink-0 w-24 h-24 bg-gray-100 dark:bg-slate-700 rounded-xl overflow-hidden">
                        {product.thumbnail_url ? (
                            <img
                                src={product.thumbnail_url}
                                alt={product.product_name || 'Product'}
                                className="w-full h-full object-contain"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect fill="%23e2e8f0" width="96" height="96"/><text x="48" y="48" font-family="Arial" font-size="12" fill="%2394a3b8" text-anchor="middle" dominant-baseline="middle">No Image</text></svg>';
                                }}
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500">
                                <Package className="w-8 h-8" />
                            </div>
                        )}
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                        {/* Brand */}
                        {product.brand && (
                            <span className="inline-block px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-medium rounded-full mb-1">
                                {product.brand}
                            </span>
                        )}

                        {/* Product Name */}
                        <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-base leading-tight mb-2 line-clamp-2">
                            {product.product_name || 'Unknown Product'}
                        </h3>

                        {/* Product Numbers */}
                        {product.product_numbers && product.product_numbers.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-3">
                                {product.product_numbers.slice(0, 5).map((num, idx) => (
                                    <span
                                        key={idx}
                                        className="inline-block px-1.5 py-0.5 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400 text-xs rounded"
                                    >
                                        {num}
                                    </span>
                                ))}
                                {product.product_numbers.length > 5 && (
                                    <span className="inline-block px-1.5 py-0.5 text-gray-400 dark:text-gray-500 text-xs">
                                        +{product.product_numbers.length - 5}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Action Button */}
                <a
                    href={productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 w-full flex items-center justify-center gap-2 py-3 px-4 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-medium rounded-xl transition-all active:scale-[0.98]"
                >
                    <ExternalLink className="w-4 h-4" />
                    {t('view_product') || '제품 보기'}
                </a>
            </div>
        </div>
    );
};

export default MediaProductCard;
