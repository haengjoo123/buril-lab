/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo, useState } from 'react';
import { useWasteStore } from '../store/useWasteStore';
import { analyzeMixture } from '../utils/mixtureLogic';
import { checkCompatibility } from '../utils/compatibilityChecker';
import { saveWasteLog } from '../services/wasteLogService';
import { getAIDisposalGuide } from '../services/geminiDisposalGuideService';
import { X, Trash2, AlertTriangle, AlertOctagon, CheckCircle, Loader2, Sparkles, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CustomDialog } from './CustomDialog';
import type { CartItem } from '../types';

interface CartViewProps {
    onClose: () => void;
    onDisposed?: () => void;
}

export const CartView: React.FC<CartViewProps> = ({ onClose, onDisposed }) => {
    const { 
        cart, removeFromCart, clearCart, 
        aiGuide, setAiGuide,
        aiLoading, setAiLoading,
        aiError, setAiError
    } = useWasteStore();

    const { t } = useTranslation();

    const formatSolutionContext = (context?: CartItem['solutionContext']): string | null => {
        if (!context) return null;

        if (context.physicalForm === 'neat_or_solid') {
            return t('solution_form_neat_or_solid' as any);
        }

        if (context.physicalForm === 'aqueous') {
            return t('solution_form_aqueous' as any);
        }

        if (context.physicalForm === 'mixed_or_unknown') {
            return t('solution_form_mixed_or_unknown' as any);
        }

        const solventName = context.solventName || t('solvent_unknown' as any);
        const classLabelMap: Partial<Record<NonNullable<CartItem['solutionContext']>['solventClass'], string>> = {
            organic_halogen: t('solvent_class_halogen' as any),
            organic_non_halogen: t('solvent_class_non_halogen' as any),
            organic_unknown: t('solvent_unverified_short' as any),
        };
        const classLabel = classLabelMap[context.solventClass];
        const suffix = classLabel ? ` (${classLabel})` : '';
        return `${t('solution_form_organic_solvent' as any)}: ${solventName}${suffix}`;
    };

    const mixtureResult = useMemo(() => analyzeMixture(cart), [cart]);
    const compatWarnings = useMemo(() => checkCompatibility(cart), [cart]);

    // Dispose flow state
    const [showDisposeModal, setShowDisposeModal] = useState(false);
    const [handlerName, setHandlerName] = useState('');
    const [memo, setMemo] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [saveResult, setSaveResult] = useState<'success' | 'error' | null>(null);

    const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);

    // AI Guide local UI state
    const [aiExpanded, setAiExpanded] = useState(true);




    const handleRequestAIGuide = async () => {
        setAiLoading(true);
        setAiError(false);

        try {
            const chemicals = cart.map(item => ({
                name: item.chemical.name,
                casNumber: item.chemical.casNumber,
                molecularFormula: item.chemical.molecularFormula,
                category: item.category,
                solutionContext: item.solutionContext,
            }));
            const result = await getAIDisposalGuide(chemicals, {
                sourceScreen: 'cart_view',
                triggerSource: 'cart_ai_disposal_guide_button',
            });
            setAiGuide(result.guide);

        } catch {
            setAiError(true);
        } finally {
            setAiLoading(false);
        }
    };

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
                <div className="flex-shrink overflow-y-auto p-4 space-y-3 min-h-[80px] max-h-[150px]">
                    {cart.length === 0 ? (
                        <div className="text-center text-gray-400 dark:text-gray-500 py-10">
                            {t('cart_empty')}
                        </div>
                    ) : (
                        cart.map((item) => {
                            const solutionContextLabel = formatSolutionContext(item.solutionContext);

                            return (
                                <div key={item.chemical.id} className="flex justify-between items-center p-3 border border-gray-100 dark:border-slate-700 rounded-lg bg-gray-50/50 dark:bg-slate-800/50">
                                    <div className="min-w-0 pr-2">
                                        <div className="font-semibold text-slate-700 dark:text-slate-300">{item.chemical.name}</div>
                                        <div className="text-xs text-slate-500 dark:text-slate-500">{t(item.label as any)}</div>
                                        {solutionContextLabel && (
                                            <div className="text-xs text-blue-600 dark:text-blue-300 mt-0.5">
                                                {t('solution_context_label' as any)}: {solutionContextLabel}
                                            </div>
                                        )}
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
                            );
                        })
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
                    <>
                    {/* Scrollable analysis content */}
                    <div className="flex-1 overflow-y-auto border-t border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                        <div className="p-4 pb-2 text-center">
                        <h4 className="text-xs text-gray-400 dark:text-gray-500 mb-2 font-medium uppercase tracking-tight">{t('cart_guide_title')}</h4>

                        <div className={`p-3.5 rounded-xl ${mixtureResult.binColor} text-white shadow-md mb-2.5`}>
                            <div className="font-bold text-base mb-0.5">{t(mixtureResult.label as any)}</div>
                            <div className="text-[13px] opacity-90 leading-snug">{t(mixtureResult.reason as any)}</div>

                            {/* Detailed Disposal Info for Alkali+Organic */}
                            {(mixtureResult as any).disposalDetails && (
                                <div className="mt-2 pt-2 border-t border-white/20 text-[11px] text-left space-y-0.5">
                                    <div className="flex justify-between">
                                        <span className="opacity-80">{t('detail_solubility' as any)}:</span>
                                        <span className="font-bold">{t(`status_${(mixtureResult as any).disposalDetails.solubility.toLowerCase()}` as any)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="opacity-80">{t('detail_neutralization' as any)}:</span>
                                        <span className="font-bold">{t(`status_${(mixtureResult as any).disposalDetails.neutralization.toLowerCase()}` as any)}</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {(mixtureResult.baseLabel || mixtureResult.contextWarnings?.length) && (
                            <div className="space-y-2 mb-2.5">
                                {mixtureResult.baseLabel && (
                                    <div className="rounded-lg border border-blue-100 bg-blue-50 p-2 text-left text-[11px] leading-snug text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
                                        <div className="font-semibold">
                                            {t('mixture_base_basis_label' as any)}: {t(mixtureResult.baseLabel as any)}
                                        </div>
                                        {mixtureResult.baseReason && (
                                            <div className="mt-0.5 opacity-90">
                                                {t(mixtureResult.baseReason as any)}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {mixtureResult.contextWarnings?.map((warningKey) => (
                                    <div
                                        key={warningKey}
                                        className="rounded-lg border border-amber-100 bg-amber-50 p-2 text-left text-[11px] leading-snug text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                                    >
                                        {t(warningKey as any)}
                                    </div>
                                ))}
                            </div>
                        )}

                        {!mixtureResult.isSafe && (
                            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 text-[11px] p-2 rounded-lg flex items-center gap-2 mb-2.5 text-left border border-red-100 dark:border-red-900/40">
                                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                                {t('cart_safety_check')}
                            </div>
                        )}

                        {/* ── AI Disposal Guide ── */}
                        {!aiGuide && !aiLoading && !aiError && (
                            <button
                                onClick={handleRequestAIGuide}
                                className="w-full py-3 bg-gradient-to-r from-violet-500 to-indigo-500 text-white rounded-xl hover:from-violet-600 hover:to-indigo-600 text-sm font-semibold transition-all shadow-md mb-2 flex items-center justify-center gap-2"
                            >
                                <Sparkles className="w-4 h-4" />
                                {t('ai_guide_btn' as any)}
                            </button>
                        )}

                        {aiLoading && (
                            <div className="p-4 rounded-xl bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-950/30 dark:to-indigo-950/30 border border-violet-200 dark:border-violet-800/50 mb-2">
                                <div className="flex items-center gap-2 text-violet-600 dark:text-violet-300">
                                    <Sparkles className="w-4 h-4 animate-pulse" />
                                    <span className="text-sm font-medium animate-pulse">{t('ai_guide_loading' as any)}</span>
                                </div>
                            </div>
                        )}

                        {aiError && (
                            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 mb-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-red-600 dark:text-red-300 text-sm">
                                        <AlertTriangle className="w-4 h-4" />
                                        {t('ai_guide_error' as any)}
                                    </div>
                                    <button
                                        onClick={handleRequestAIGuide}
                                        className="flex items-center gap-1 text-xs text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-200 font-medium"
                                    >
                                        <RotateCcw className="w-3 h-3" />
                                        {t('ai_guide_retry' as any)}
                                    </button>
                                </div>
                            </div>
                        )}

                        {aiGuide && (
                            <div className="rounded-xl bg-gradient-to-br from-violet-50 via-indigo-50 to-purple-50 dark:from-violet-950/30 dark:via-indigo-950/30 dark:to-purple-950/30 border border-violet-200 dark:border-violet-800/50 mb-2 overflow-hidden shadow-sm">
                                <button
                                    onClick={() => setAiExpanded(!aiExpanded)}
                                    className="w-full p-3 flex items-center justify-between text-left"
                                >
                                    <div className="flex items-center gap-2">
                                        <Sparkles className="w-4 h-4 text-violet-500 dark:text-violet-400" />
                                        <span className="text-sm font-bold text-violet-700 dark:text-violet-300">
                                            {t('ai_guide_title' as any)}
                                        </span>
                                    </div>
                                    {aiExpanded
                                        ? <ChevronUp className="w-4 h-4 text-violet-400" />
                                        : <ChevronDown className="w-4 h-4 text-violet-400" />
                                    }
                                </button>
                                {aiExpanded && (
                                    <div className="px-3 pb-3">
                                        <div className="space-y-2 max-h-[200px] overflow-y-auto">
                                            {(() => {
                                                if (!aiGuide) return null;
                                                // Parse the AI guide text into styled sections
                                                const lines = aiGuide.split('\n').filter(l => l.trim());
                                                const sections: Array<{ type: 'recommendation' | 'warning' | 'info'; title: string; content: string[] }> = [];
                                                let current: (typeof sections)[0] | null = null;

                                                for (const line of lines) {
                                                    const trimmed = line.trim();
                                                    if (trimmed.startsWith('🪣')) {
                                                        current = { type: 'recommendation', title: trimmed.replace('🪣', '').trim(), content: [] };
                                                        sections.push(current);
                                                    } else if (trimmed.startsWith('⚠️')) {
                                                        current = { type: 'warning', title: trimmed.replace('⚠️', '').trim(), content: [] };
                                                        sections.push(current);
                                                    } else if (trimmed.startsWith('→') || trimmed.startsWith('->')) {
                                                        if (current) {
                                                            current.content.push(trimmed.replace(/^(→|->)\s*/, ''));
                                                        }
                                                    } else {
                                                        // Any other text: attach to current or create info section
                                                        if (current) {
                                                            current.content.push(trimmed);
                                                        } else {
                                                            current = { type: 'info', title: '', content: [trimmed] };
                                                            sections.push(current);
                                                        }
                                                    }
                                                }

                                                if (sections.length === 0) {
                                                    // Fallback: render as plain text
                                                    return (
                                                        <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed text-left">
                                                            {aiGuide}
                                                        </div>
                                                    );
                                                }

                                                return sections.map((section, idx) => {
                                                    if (section.type === 'recommendation') {
                                                        return (
                                                            <div key={idx} className="rounded-lg bg-gradient-to-r from-violet-100 to-indigo-100 dark:from-violet-900/40 dark:to-indigo-900/40 border border-violet-300/60 dark:border-violet-700/60 p-3">
                                                                <div className="flex items-center gap-1.5 mb-1.5">
                                                                    <span className="text-base">🪣</span>
                                                                    <span className="text-xs font-bold text-violet-700 dark:text-violet-300 uppercase tracking-wide">{section.title}</span>
                                                                </div>
                                                                {section.content.map((c, ci) => (
                                                                    <div key={ci} className="text-sm font-semibold text-violet-800 dark:text-violet-200 pl-6">
                                                                        {c}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        );
                                                    }

                                                    if (section.type === 'warning') {
                                                        return (
                                                            <div key={idx} className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-300/60 dark:border-amber-700/60 p-3 text-left">
                                                                <div className="flex items-center gap-1.5 mb-1.5">
                                                                    <span className="text-base">⚠️</span>
                                                                    <span className="text-xs font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wide">{section.title}</span>
                                                                </div>
                                                                {section.content.map((c, ci) => (
                                                                    <div key={ci} className="text-[13px] text-amber-800 dark:text-amber-200 pl-6 leading-snug">
                                                                        {c}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        );
                                                    }

                                                    // 'info' fallback
                                                    return (
                                                        <div key={idx} className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed pl-1">
                                                            {section.content.join(' ')}
                                                        </div>
                                                    );
                                                });
                                            })()}
                                        </div>
                                        <div className="mt-2.5 pt-2 border-t border-violet-200/50 dark:border-violet-700/50">
                                            <p className="text-[10px] text-violet-400 dark:text-violet-500 italic">
                                                {t('ai_guide_disclaimer' as any)}
                                            </p>
                                        </div>
                                        <button
                                            onClick={handleRequestAIGuide}
                                            className="mt-2 w-full py-1.5 text-xs text-violet-500 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 font-medium flex items-center justify-center gap-1 rounded-lg hover:bg-violet-100/50 dark:hover:bg-violet-900/20 transition-colors"
                                        >
                                            <RotateCcw className="w-3 h-3" />
                                            {t('ai_guide_retry' as any)}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                        </div>
                    </div>

                    {/* ── Action Buttons (always visible) ── */}
                    <div className="shrink-0 p-4 pt-3 border-t border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 text-center flex gap-2.5">
                        <button
                            onClick={() => setIsClearDialogOpen(true)}
                            className="flex-1 py-3 border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-800 text-sm font-medium transition-colors"
                        >
                            {t('btn_clear_all')}
                        </button>

                        <button
                            onClick={() => setShowDisposeModal(true)}
                            className="flex-[1.5] py-3 bg-blue-600 dark:bg-blue-500 text-white rounded-xl hover:bg-blue-700 dark:hover:bg-blue-600 text-sm font-semibold transition-colors shadow-md"
                        >
                            {t('btn_dispose_complete')}
                        </button>
                    </div>
                    </>
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
