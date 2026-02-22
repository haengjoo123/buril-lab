import React, { useMemo, useState } from 'react';
import { useWasteStore } from '../store/useWasteStore';
import { analyzeMixture } from '../utils/mixtureLogic';
import { checkCompatibility } from '../utils/compatibilityChecker';
import { saveWasteLog } from '../services/wasteLogService';
import { X, Trash2, AlertTriangle, AlertOctagon, CheckCircle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CustomDialog } from './CustomDialog';

interface CartViewProps {
    onClose: () => void;
    onDisposed?: () => void;
}

export const CartView: React.FC<CartViewProps> = ({ onClose, onDisposed }) => {
    const { cart, removeFromCart, clearCart } = useWasteStore();
    const { t } = useTranslation();

    const mixtureResult = useMemo(() => analyzeMixture(cart), [cart]);
    const compatWarnings = useMemo(() => checkCompatibility(cart), [cart]);

    // Dispose flow state
    const [showDisposeModal, setShowDisposeModal] = useState(false);
    const [handlerName, setHandlerName] = useState('');
    const [memo, setMemo] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [saveResult, setSaveResult] = useState<'success' | 'error' | null>(null);

    const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);

    const handleDispose = async () => {
        setIsSaving(true);
        setSaveResult(null);
        try {
            // Calculate total volume from cart items
            const totalVol = cart.reduce((sum, item) => {
                if (item.volume) {
                    const num = parseFloat(item.volume.replace(/[^0-9.]/g, ''));
                    return sum + (isNaN(num) ? 0 : num);
                }
                return sum;
            }, 0);

            await saveWasteLog({
                chemicals: cart,
                disposal_category: t(mixtureResult.label as any) || mixtureResult.label,
                total_volume_ml: totalVol > 0 ? totalVol : undefined,
                handler_name: handlerName || undefined,
                memo: memo || undefined,
            });

            setSaveResult('success');
            // After a brief success message, clear cart and close
            setTimeout(() => {
                clearCart();
                setShowDisposeModal(false);
                setSaveResult(null);
                onClose();
                onDisposed?.();
            }, 1200);
        } catch {
            setSaveResult('error');
        } finally {
            setIsSaving(false);
        }
    };

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

                    {/* ── Compatibility Warnings ── */}
                    {compatWarnings.length > 0 && (
                        <div className="space-y-2 pt-1">
                            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-1">
                                {t('compat_title')}
                            </div>
                            {compatWarnings.map((w, idx) => {
                                const isDanger = w.severity === 'DANGER';
                                return (
                                    <div
                                        key={`${w.ruleId}-${idx}`}
                                        className={`p-3 rounded-xl border text-sm flex items-start gap-2.5 ${isDanger
                                            ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-300'
                                            : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-300'
                                            }`}
                                    >
                                        {isDanger
                                            ? <AlertOctagon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                            : <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                        }
                                        <div className="min-w-0">
                                            <div className="font-bold text-xs mb-0.5">
                                                {isDanger ? t('compat_danger') : t('compat_warning')}: {w.chemicalA} ↔ {w.chemicalB}
                                            </div>
                                            <div className="text-xs leading-snug opacity-90">
                                                {t(w.messageKey as any)}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
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

                        {/* ── Dispose Complete Button ── */}
                        <button
                            onClick={() => setShowDisposeModal(true)}
                            className="w-full py-3 bg-blue-600 dark:bg-blue-500 text-white rounded-xl hover:bg-blue-700 dark:hover:bg-blue-600 text-sm font-semibold transition-colors shadow-md mb-2"
                        >
                            {t('btn_dispose_complete')}
                        </button>

                        <button
                            onClick={() => setIsClearDialogOpen(true)}
                            className="w-full py-3 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-800 text-sm font-medium transition-colors"
                        >
                            {t('btn_clear_all')}
                        </button>
                    </div>
                )}
            </div>

            {/* ── Dispose Confirmation Modal ── */}
            {showDisposeModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-auto">
                    <div className="absolute inset-0 bg-black/40" onClick={() => !isSaving && setShowDisposeModal(false)} />
                    <div
                        className="relative z-10 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-[90%] max-w-[360px] p-6 animate-in fade-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {saveResult === 'success' ? (
                            <div className="text-center py-4">
                                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                                <p className="font-semibold text-slate-800 dark:text-white">
                                    {t('dispose_success')}
                                </p>
                            </div>
                        ) : (
                            <>
                                <h3 className="font-bold text-lg text-slate-800 dark:text-white mb-1">
                                    {t('btn_dispose_complete')}
                                </h3>
                                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                                    {t('dispose_confirm')}
                                </p>

                                {/* Handler Name */}
                                <div className="mb-3">
                                    <input
                                        type="text"
                                        value={handlerName}
                                        onChange={(e) => setHandlerName(e.target.value)}
                                        placeholder={t('input_handler')}
                                        className="w-full px-3 py-2.5 border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700 text-slate-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>

                                {/* Memo */}
                                <div className="mb-4">
                                    <textarea
                                        value={memo}
                                        onChange={(e) => setMemo(e.target.value)}
                                        placeholder={t('input_memo')}
                                        rows={2}
                                        className="w-full px-3 py-2.5 border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700 text-slate-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                                    />
                                </div>

                                {/* Error Message */}
                                {saveResult === 'error' && (
                                    <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 text-xs rounded-lg flex items-center gap-2">
                                        <AlertTriangle className="w-3.5 h-3.5" />
                                        {t('dispose_error')}
                                    </div>
                                )}

                                {/* Action Buttons */}
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setShowDisposeModal(false)}
                                        disabled={isSaving}
                                        className="flex-1 py-2.5 border border-gray-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                                    >
                                        {t('btn_cancel')}
                                    </button>
                                    <button
                                        onClick={handleDispose}
                                        disabled={isSaving}
                                        className="flex-1 py-2.5 bg-blue-600 dark:bg-blue-500 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors flex items-center justify-center gap-1.5"
                                    >
                                        {isSaving
                                            ? <Loader2 className="w-4 h-4 animate-spin" />
                                            : t('btn_confirm')
                                        }
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            <CustomDialog
                isOpen={isClearDialogOpen}
                onClose={() => setIsClearDialogOpen(false)}
                title={t('btn_clear_all')}
                description={t('cart_confirm_clear')}
                type="confirm"
                isDestructive={true}
                onConfirm={() => {
                    clearCart();
                    setIsClearDialogOpen(false);
                }}
            />
        </div>
    );
};
