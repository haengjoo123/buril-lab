import React, { useMemo } from 'react';
import { useWasteStore } from '../store/useWasteStore';
import { analyzeMixture } from '../utils/mixtureLogic';
import { X, Trash2, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface CartViewProps {
    onClose: () => void;
}

export const CartView: React.FC<CartViewProps> = ({ onClose }) => {
    const { cart, removeFromCart, clearCart } = useWasteStore();
    const { t } = useTranslation();

    const mixtureResult = useMemo(() => analyzeMixture(cart), [cart]);

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center pointer-events-none">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 pointer-events-auto"
                onClick={onClose}
            />

            {/* Sheet Content */}
            <div
                className="relative z-10 w-full max-w-[430px] bg-white dark:bg-slate-900 rounded-t-2xl shadow-2xl overflow-hidden pointer-events-auto flex flex-col max-h-[90vh] animate-in slide-in-from-bottom duration-300"
                onClick={(e) => e.stopPropagation()}
            >

                {/* Header */}
                <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
                    <h3 className="font-bold text-lg text-slate-800 dark:text-white">
                        {t('cart_title')} <span className="text-blue-600 dark:text-blue-400">({cart.length})</span>
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-gray-200 dark:hover:bg-slate-800 rounded-full transition-colors">
                        <X className="w-6 h-6 text-gray-500 dark:text-gray-400" />
                    </button>
                </div>

                {/* List of Chemicals */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[150px]">
                    {cart.length === 0 ? (
                        <div className="text-center text-gray-400 dark:text-gray-500 py-10">
                            {t('cart_empty')}
                        </div>
                    ) : (
                        cart.map((item) => (
                            <div key={item.chemical.id} className="flex justify-between items-center p-3 border border-gray-100 dark:border-slate-700 rounded-lg bg-gray-50/50 dark:bg-slate-800/50">
                                <div>
                                    <div className="font-semibold text-slate-700 dark:text-slate-300">{item.chemical.name}</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-500">{t(item.label as any)}</div>
                                    {(item.volume || item.molarity) && (
                                        <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 font-mono">
                                            {item.volume}{item.volume && item.molarity && ' • '}{item.molarity}
                                        </div>
                                    )}
                                </div>
                                <button
                                    onClick={() => removeFromCart(item.chemical.id)}
                                    className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 p-2"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        ))
                    )}
                </div>

                {/* Mixture Analysis Result Footer */}
                {cart.length > 0 && (
                    <div className="p-5 border-t border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] text-center">
                        <h4 className="text-sm text-gray-500 dark:text-gray-400 mb-2 font-medium">{t('cart_guide_title')}</h4>

                        <div className={`p-4 rounded-xl ${mixtureResult.binColor} text-white shadow-lg mb-3`}>
                            <div className="font-bold text-lg mb-1">{t(mixtureResult.label as any)}</div>
                            <div className="text-sm opacity-90 leading-snug">{t(mixtureResult.reason as any)}</div>

                            {/* Detailed Disposal Info for Alkali+Organic */}
                            {(mixtureResult as any).disposalDetails && (
                                <div className="mt-3 pt-3 border-t border-white/20 text-xs text-left space-y-1">
                                    <div className="flex justify-between">
                                        <span className="opacity-80">{t('detail_solubility' as any)}:</span>
                                        <span className="font-bold">{(mixtureResult as any).disposalDetails.solubility}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="opacity-80">{t('detail_neutralization' as any)}:</span>
                                        <span className="font-bold">{(mixtureResult as any).disposalDetails.neutralization}</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {!mixtureResult.isSafe && (
                            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 text-xs p-2 rounded flex items-center gap-2 mb-3 text-left">
                                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                                {t('cart_safety_check')}
                            </div>
                        )}

                        <button
                            onClick={() => {
                                if (confirm(t('cart_confirm_clear'))) clearCart();
                            }}
                            className="w-full py-3 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-800 text-sm font-medium transition-colors"
                        >
                            {t('btn_clear_all')}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
