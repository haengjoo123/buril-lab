import React, { useState, useEffect, useCallback } from 'react';
import { fetchWasteLogs, deleteWasteLog } from '../services/wasteLogService';
import type { WasteLog } from '../types';
import { useTranslation } from 'react-i18next';
import { Trash2, ChevronDown, ChevronUp, FlaskConical, Loader2, AlertCircle } from 'lucide-react';
import { CustomDialog } from './CustomDialog';

export const WasteLogView: React.FC = () => {
    const { t } = useTranslation();
    const [logs, setLogs] = useState<WasteLog[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [page, setPage] = useState(0);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const PAGE_SIZE = 20;

    const loadLogs = useCallback(async (reset: boolean = false) => {
        setIsLoading(true);
        setError(null);
        try {
            const offset = reset ? 0 : page * PAGE_SIZE;
            const result = await fetchWasteLogs(PAGE_SIZE, offset);
            if (reset) {
                setLogs(result.logs);
                setPage(0);
            } else {
                setLogs(prev => [...prev, ...result.logs]);
            }
            setTotalCount(result.count);
        } catch {
            setError(t('dispose_error'));
        } finally {
            setIsLoading(false);
        }
    }, [page, t]);

    useEffect(() => {
        loadLogs(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleLoadMore = () => {
        const nextPage = page + 1;
        setPage(nextPage);
        // Load with the next offset
        setIsLoading(true);
        setError(null);
        fetchWasteLogs(PAGE_SIZE, nextPage * PAGE_SIZE)
            .then(result => {
                setLogs(prev => [...prev, ...result.logs]);
                setTotalCount(result.count);
            })
            .catch(() => setError(t('dispose_error')))
            .finally(() => setIsLoading(false));
    };

    const handleDelete = async () => {
        if (!deleteId) return;
        try {
            await deleteWasteLog(deleteId);
            setLogs(prev => prev.filter(l => l.id !== deleteId));
            setTotalCount(prev => prev - 1);
        } catch {
            setError(t('dispose_error'));
        } finally {
            setDeleteId(null);
        }
    };

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        return d.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    // Compute total volume from individual cart items
    const computeTotalVolume = (log: WasteLog): string | null => {
        if (log.total_volume_ml) return `${log.total_volume_ml} mL`;
        // Try summing individual volumes
        const total = log.chemicals.reduce((sum, c) => {
            if (c.volume) {
                const num = parseFloat(c.volume.replace(/[^0-9.]/g, ''));
                return sum + (isNaN(num) ? 0 : num);
            }
            return sum;
        }, 0);
        return total > 0 ? `${total} mL` : null;
    };

    return (
        <div className="p-5 flex flex-col gap-4" style={{ paddingBottom: '100px' }}>
            {/* Header */}
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                    {t('log_title')}
                </h2>
                {totalCount > 0 && (
                    <span className="text-sm text-slate-500 dark:text-slate-400">
                        {totalCount}건
                    </span>
                )}
            </div>

            {/* Error */}
            {error && (
                <div className="flex items-center gap-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg text-sm border border-red-100 dark:border-red-900/30">
                    <AlertCircle className="w-4 h-4" />
                    {error}
                </div>
            )}

            {/* Empty State */}
            {!isLoading && logs.length === 0 && !error && (
                <div className="text-center py-20">
                    <div className="inline-flex p-4 bg-slate-100 dark:bg-slate-800 rounded-full mb-4">
                        <FlaskConical className="w-8 h-8 text-slate-400 dark:text-slate-500" />
                    </div>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">
                        {t('log_empty')}
                    </p>
                </div>
            )}

            {/* Log Cards */}
            <div className="space-y-3">
                {logs.map(log => {
                    const isExpanded = expandedId === log.id;
                    const totalVol = computeTotalVolume(log);

                    return (
                        <div
                            key={log.id}
                            className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden transition-all"
                        >
                            {/* Card Header */}
                            <button
                                onClick={() => setExpandedId(isExpanded ? null : log.id)}
                                className="w-full p-4 text-left flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-slate-750 transition-colors"
                            >
                                {/* Category Color Dot */}
                                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${getCategoryColor(log.disposal_category)}`} />

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-semibold text-sm text-slate-800 dark:text-slate-200 truncate">
                                            {log.disposal_category}
                                        </span>
                                        <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap">
                                            {formatDate(log.created_at)}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 dark:text-slate-400">
                                        <span>{t('log_chemicals_count', { count: log.chemicals.length })}</span>
                                        {totalVol && <span>• {totalVol}</span>}
                                        {log.handler_name && <span>• {log.handler_name}</span>}
                                    </div>
                                </div>

                                {isExpanded
                                    ? <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                    : <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                }
                            </button>

                            {/* Expanded Detail */}
                            {isExpanded && (
                                <div className="px-4 pb-4 border-t border-gray-100 dark:border-slate-700">
                                    {/* Chemicals List */}
                                    <div className="space-y-2 mt-3">
                                        {log.chemicals.map((chem, idx) => (
                                            <div
                                                key={idx}
                                                className="flex justify-between items-center p-2.5 bg-gray-50 dark:bg-slate-750 rounded-lg text-sm"
                                            >
                                                <div>
                                                    <div className="font-medium text-slate-700 dark:text-slate-300">
                                                        {chem.chemical?.name || 'Unknown'}
                                                    </div>
                                                    <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                                                        {chem.label && t(chem.label as any)}
                                                    </div>
                                                </div>
                                                {(chem.volume || chem.molarity) && (
                                                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                                                        {chem.volume}{chem.volume && chem.molarity && ' • '}{chem.molarity}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>

                                    {/* Memo */}
                                    {log.memo && (
                                        <div className="mt-3 p-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm text-blue-700 dark:text-blue-300">
                                            📝 {log.memo}
                                        </div>
                                    )}

                                    {/* Delete Button */}
                                    <button
                                        onClick={() => setDeleteId(log.id)}
                                        className="mt-3 w-full py-2 text-sm text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        {t('log_delete') || '삭제'}
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Load More */}
            {logs.length < totalCount && (
                <button
                    onClick={handleLoadMore}
                    disabled={isLoading}
                    className="w-full py-3 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-colors font-medium"
                >
                    {isLoading
                        ? <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                        : `더 보기 (${logs.length}/${totalCount})`
                    }
                </button>
            )}

            {/* Initial Loading */}
            {isLoading && logs.length === 0 && (
                <div className="flex justify-center py-10">
                    <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                </div>
            )}

            <CustomDialog
                isOpen={!!deleteId}
                onClose={() => setDeleteId(null)}
                title={t('log_delete') || '삭제'}
                description={t('log_delete_confirm')}
                type="confirm"
                isDestructive={true}
                onConfirm={handleDelete}
            />
        </div>
    );
};

/** Map disposal category label to a color dot */
function getCategoryColor(category: string): string {
    const lower = category.toLowerCase();
    if (lower.includes('할로겐') || lower.includes('halogen')) return 'bg-purple-500';
    if (lower.includes('유기') || lower.includes('organic')) return 'bg-orange-500';
    if (lower.includes('산') || lower.includes('acid')) return 'bg-red-500';
    if (lower.includes('알칼리') || lower.includes('alkali')) return 'bg-blue-500';
    if (lower.includes('주의') || lower.includes('warn')) return 'bg-yellow-500';
    return 'bg-gray-400';
}
