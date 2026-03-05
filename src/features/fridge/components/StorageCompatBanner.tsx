/**
 * StorageCompatBanner
 * Floating banner that shows chemical storage compatibility warnings
 * for the current cabinet. Minimizable, with per-shelf breakdown.
 */
import React, { useState, useMemo } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, ShieldAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFridgeStore } from '../../../store/fridgeStore';
import {
    checkCabinetCompatibility,
    type StorageWarning,
} from '../../../utils/storageCompatibilityChecker';

export const StorageCompatBanner: React.FC = () => {
    const { t } = useTranslation();
    const shelves = useFridgeStore(s => s.shelves);
    const [isExpanded, setIsExpanded] = useState(false);
    const [isDismissed, setIsDismissed] = useState(false);

    const warningMap = useMemo(() => checkCabinetCompatibility(shelves), [shelves]);

    const totalWarnings = useMemo(() => {
        let count = 0;
        warningMap.forEach(w => count += w.length);
        return count;
    }, [warningMap]);

    const dangerCount = useMemo(() => {
        let count = 0;
        warningMap.forEach(warnings => {
            count += warnings.filter(w => w.severity === 'DANGER').length;
        });
        return count;
    }, [warningMap]);

    // No warnings or dismissed → don't render
    if (totalWarnings === 0 || isDismissed) return null;

    const hasDanger = dangerCount > 0;

    return (
        <div className={`
            absolute top-16 left-1/2 -translate-x-1/2 z-30 pointer-events-auto
            w-[360px] max-w-[calc(100vw-2rem)]
            animate-in fade-in slide-in-from-top-3 duration-300
        `}>
            <div className={`
                rounded-xl border shadow-lg backdrop-blur-md overflow-hidden
                ${hasDanger
                    ? 'bg-red-50/95 dark:bg-red-950/90 border-red-300 dark:border-red-800'
                    : 'bg-amber-50/95 dark:bg-amber-950/90 border-amber-300 dark:border-amber-800'
                }
            `}>
                {/* Header */}
                <div
                    className="flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer select-none"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <div className={`
                        w-8 h-8 rounded-lg flex items-center justify-center shrink-0
                        ${hasDanger
                            ? 'bg-red-200/60 dark:bg-red-800/40'
                            : 'bg-amber-200/60 dark:bg-amber-800/40'
                        }
                    `}>
                        <ShieldAlert className={`w-4.5 h-4.5 ${hasDanger ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <span className={`text-sm font-bold ${hasDanger ? 'text-red-800 dark:text-red-200' : 'text-amber-800 dark:text-amber-200'}`}>
                                {t('storage_compat_banner_title')}
                            </span>
                            <span className={`
                                text-[10px] font-bold px-1.5 py-0.5 rounded-full
                                ${hasDanger
                                    ? 'bg-red-200 text-red-800 dark:bg-red-800 dark:text-red-200'
                                    : 'bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-200'
                                }
                            `}>
                                {totalWarnings}
                            </span>
                        </div>
                        <p className={`text-[11px] mt-0.5 ${hasDanger ? 'text-red-600/80 dark:text-red-400/80' : 'text-amber-600/80 dark:text-amber-400/80'}`}>
                            {t('storage_compat_banner_desc')}
                        </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        {isExpanded
                            ? <ChevronUp className="w-4 h-4 text-slate-400" />
                            : <ChevronDown className="w-4 h-4 text-slate-400" />
                        }
                        <button
                            onClick={(e) => { e.stopPropagation(); setIsDismissed(true); }}
                            className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                        >
                            <X className="w-3.5 h-3.5 text-slate-400" />
                        </button>
                    </div>
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                    <div className="px-3.5 pb-3 border-t border-black/5 dark:border-white/5 max-h-[40vh] overflow-y-auto">
                        {shelves.map(shelf => {
                            const warnings = warningMap.get(shelf.id);
                            if (!warnings || warnings.length === 0) return null;

                            return (
                                <div key={shelf.id} className="mt-2.5">
                                    <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1.5">
                                        {t('storage_compat_shelf', { level: shelf.level + 1 })}
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        {warnings.map((w, i) => (
                                            <WarningRow key={`${w.ruleId}-${i}`} warning={w} />
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

const WarningRow: React.FC<{ warning: StorageWarning }> = ({ warning }) => {
    const { t } = useTranslation();
    const isDanger = warning.severity === 'DANGER';

    return (
        <div className={`
            flex items-start gap-2 p-2 rounded-lg text-xs
            ${isDanger
                ? 'bg-red-100/60 dark:bg-red-900/30'
                : 'bg-amber-100/60 dark:bg-amber-900/30'
            }
        `}>
            <AlertTriangle className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isDanger ? 'text-red-500' : 'text-amber-500'}`} />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`
                        text-[10px] font-bold px-1.5 py-px rounded
                        ${isDanger
                            ? 'bg-red-200 text-red-800 dark:bg-red-800 dark:text-red-200'
                            : 'bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-200'
                        }
                    `}>
                        {isDanger ? t('storage_compat_danger') : t('storage_compat_warning')}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400 font-medium truncate">
                        {warning.itemA} ↔ {warning.itemB}
                    </span>
                </div>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                    {t(warning.messageKey)}
                </p>
            </div>
        </div>
    );
};
