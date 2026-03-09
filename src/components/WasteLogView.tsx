/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useCallback } from 'react';
import { fetchWasteLogs, deleteWasteLog } from '../services/wasteLogService';
import type { WasteLog } from '../types';
import { useTranslation } from 'react-i18next';
import { Trash2, ChevronDown, ChevronUp, Loader2, AlertCircle, Search, History, X } from 'lucide-react';
import { CustomDialog } from './CustomDialog';
import { useLabStore } from '../store/useLabStore';
import type { WasteLogSortBy } from '../services/wasteLogService';
import { auditService, type AuditLog } from '../services/auditService';
import { EmptyState } from './EmptyState';

export const WasteLogView: React.FC = () => {
    const { t } = useTranslation();
    const currentLabId = useLabStore(state => state.currentLabId);
    const myLabs = useLabStore(state => state.myLabs);
    const currentRole = myLabs.find(m => m.lab_id === currentLabId)?.role;
    const canDeleteLogs = !currentLabId || currentRole === 'admin';
    const [logs, setLogs] = useState<WasteLog[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [page, setPage] = useState(0);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [sortBy, setSortBy] = useState<WasteLogSortBy>('created_at');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [viewingAuditLogForId, setViewingAuditLogForId] = useState<string | null>(null);
    const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
    const [isLoadingAudit, setIsLoadingAudit] = useState(false);
    const PAGE_SIZE = 20;

    useEffect(() => {
        if (!viewingAuditLogForId) {
            setAuditLogs([]);
            return;
        }

        let targetId = viewingAuditLogForId;
        // Some items from cart might have a prefixed ID like 'cabinet:UUID'
        if (targetId.includes(':')) {
            targetId = targetId.split(':').pop() || targetId;
        }

        const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/i.test(targetId);

        if (!isUUID) {
            console.warn('Invalid UUID format for audit log search:', targetId);
            setAuditLogs([]);
            return;
        }

        setIsLoadingAudit(true);
        auditService.getLogs({ entity_id: targetId, limit: 10 })
            .then(setAuditLogs)
            .catch(console.error)
            .finally(() => setIsLoadingAudit(false));
    }, [viewingAuditLogForId]);

    const loadLogs = useCallback(async (reset: boolean = false) => {
        setIsLoading(true);
        setError(null);
        try {
            const offset = reset ? 0 : page * PAGE_SIZE;
            const result = await fetchWasteLogs(PAGE_SIZE, offset, {
                search: searchQuery || undefined,
                sortBy,
                sortOrder,
            });
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
    }, [page, searchQuery, sortBy, sortOrder, t]);

    // 실험실/검색/정렬 변경 시 재조회
    useEffect(() => {
        loadLogs(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentLabId, searchQuery, sortBy, sortOrder]);

    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setSearchQuery(searchInput.trim());
    };

    const handleLoadMore = () => {
        const nextPage = page + 1;
        setPage(nextPage);
        setIsLoading(true);
        setError(null);
        fetchWasteLogs(PAGE_SIZE, nextPage * PAGE_SIZE, {
            search: searchQuery || undefined,
            sortBy,
            sortOrder,
        })
            .then(result => {
                setLogs(prev => [...prev, ...result.logs]);
                setTotalCount(result.count);
            })
            .catch(() => setError(t('dispose_error')))
            .finally(() => setIsLoading(false));
    };

    // 시약명 포함 클라이언트 필터 (서버는 분류/처리자/메모만 검색)
    const filteredLogs = searchQuery
        ? logs.filter(log => {
            const q = searchQuery.toLowerCase();
            const matchText =
                log.disposal_category?.toLowerCase().includes(q) ||
                log.handler_name?.toLowerCase().includes(q) ||
                log.memo?.toLowerCase().includes(q);
            const matchChemical = log.chemicals?.some(
                c =>
                    c.chemical?.name?.toLowerCase().includes(q) ||
                    (c as any).name?.toLowerCase().includes(q) ||
                    (c as any).deleted_location?.toLowerCase().includes(q)
            );
            return matchText || matchChemical;
        })
        : logs;

    const handleDelete = async () => {
        if (!deleteId) return;
        if (!canDeleteLogs) {
            setError(t('log_delete_admin_only'));
            setDeleteId(null);
            return;
        }
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

    const getPrimaryChemicalName = (log: WasteLog): string | null => {
        const first = log.chemicals?.[0] as any;
        return first?.chemical?.name || first?.name || null;
    };

    const getDeletedLocation = (log: WasteLog): string | null => {
        const first = log.chemicals?.[0] as any;
        if (first?.deleted_location) return String(first.deleted_location);

        const memo = log.memo || '';
        const match = memo.match(/삭제 위치:\s*([^|]+)/);
        return match?.[1]?.trim() || null;
    };

    const getDeleteReason = (log: WasteLog): string | null => {
        const memo = (log.memo || '').trim();
        if (!memo) return null;

        // 과거 데이터 호환: "사유 | 삭제 위치: ..." 형태에서 사유만 사용
        const reasonPart = memo.split('|')[0]?.trim() || '';
        const cleaned = reasonPart.replace(/^📝\s*/, '').trim();
        return cleaned || null;
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

            {/* 검색 & 정렬 */}
            <div className="flex items-center gap-2">
                <form onSubmit={handleSearchSubmit} className="relative flex-1 min-w-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        type="text"
                        value={searchInput}
                        onChange={e => setSearchInput(e.target.value)}
                        placeholder={t('log_search_placeholder')}
                        className="w-full h-[42px] pl-9 pr-4 py-2.5 text-sm bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                </form>
                <select
                    value={`${sortBy}-${sortOrder}`}
                    onChange={e => {
                        const [by, order] = e.target.value.split('-') as [WasteLogSortBy, 'asc' | 'desc'];
                        setSortBy(by);
                        setSortOrder(order);
                    }}
                    className="flex-shrink-0 h-[42px] py-2.5 px-3 text-sm bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                    <option value="created_at-desc">{t('log_sort_date_desc')}</option>
                    <option value="created_at-asc">{t('log_sort_date_asc')}</option>
                    <option value="disposal_category-asc">{t('log_sort_category_asc')}</option>
                    <option value="disposal_category-desc">{t('log_sort_category_desc')}</option>
                    <option value="handler_name-asc">{t('log_sort_handler_asc')}</option>
                    <option value="handler_name-desc">{t('log_sort_handler_desc')}</option>
                </select>
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
                <EmptyState variant={searchQuery ? 'logs_search' : 'logs'} />
            )}

            {/* Log Cards */}
            <div className="space-y-3">
                {filteredLogs.map(log => {
                    const isExpanded = expandedId === log.id;
                    const totalVol = computeTotalVolume(log);
                    const primaryChemicalName = getPrimaryChemicalName(log);
                    const deletedLocation = getDeletedLocation(log);
                    const deleteReason = getDeleteReason(log);
                    const locationBadgeClass = getLocationBadgeClass(deletedLocation);
                    const displayTitle = log.disposal_category.startsWith('기타')
                        ? (primaryChemicalName || log.disposal_category)
                        : log.disposal_category;

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
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="font-semibold text-sm text-slate-800 dark:text-slate-200 truncate">
                                                {displayTitle}
                                            </span>
                                            {deletedLocation && (
                                                <span className={`text-[11px] px-1.5 py-0.5 rounded whitespace-nowrap ${locationBadgeClass}`}>
                                                    {deletedLocation}
                                                </span>
                                            )}
                                        </div>
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
                                                        {chem.chemical?.name || (chem as any).name || 'Unknown'}
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
                                                {(chem as any).id && (
                                                    <button
                                                        onClick={() => setViewingAuditLogForId((chem as any).id)}
                                                        className="mt-1.5 flex items-center gap-1 text-[11px] text-blue-500 hover:text-blue-600 transition-colors"
                                                    >
                                                        <History className="w-3 h-3" /> 변경 내용 비교 보기
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>

                                    {/* Disposal reason */}
                                    {deleteReason && (
                                        <div className="mt-3 p-2.5 bg-slate-50 dark:bg-slate-700/30 rounded-lg text-sm text-slate-700 dark:text-slate-300">
                                            <span className="font-medium">폐기 사유:</span> {deleteReason}
                                        </div>
                                    )}

                                    {/* Delete Button / Permission */}
                                    {canDeleteLogs ? (
                                        <button
                                            onClick={() => setDeleteId(log.id)}
                                            className="mt-3 w-full py-2 text-sm text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                            {t('log_delete') || '삭제'}
                                        </button>
                                    ) : (
                                        <div className="mt-3 text-xs text-slate-500 dark:text-slate-400 text-center py-2">
                                            {t('log_delete_admin_only')}
                                        </div>
                                    )}
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
                isOpen={canDeleteLogs && !!deleteId}
                onClose={() => setDeleteId(null)}
                title={t('log_delete') || '삭제'}
                description={t('log_delete_confirm')}
                type="confirm"
                isDestructive={true}
                onConfirm={handleDelete}
            />

            {/* Audit Log Modal */}
            {viewingAuditLogForId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setViewingAuditLogForId(null)} />
                    <div className="relative bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                            <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                <History className="w-4 h-4" /> 항목의 원본 변경 이력
                            </h3>
                            <button onClick={() => setViewingAuditLogForId(null)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded">
                                <X className="w-4 h-4 text-slate-500" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {isLoadingAudit ? (
                                <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
                            ) : auditLogs.length === 0 ? (
                                <p className="text-center text-sm text-slate-500 py-8">이 항목의 감사 로그가 없습니다.</p>
                            ) : (
                                auditLogs.map(log => (
                                    <div key={log.id} className="bg-slate-50 dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-sm">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="font-semibold">{log.action.toUpperCase()}</span>
                                            <span className="text-xs text-slate-500">{new Date(log.created_at).toLocaleString('ko-KR')}</span>
                                        </div>
                                        {log.actor_name && <div className="text-xs text-slate-500 mb-2">작업자: {log.actor_name}</div>}
                                        {log.diff_data && Object.keys(log.diff_data).length > 0 && (
                                            <div className="mt-1 flex flex-col gap-1 text-[11px] font-mono">
                                                {Object.entries(log.diff_data).map(([k, v]: [string, any]) => (
                                                    <div key={k} className="flex gap-2">
                                                        <span className="text-slate-500 w-20 shrink-0">{k}:</span>
                                                        <span className="text-red-500/80 line-through truncate">{JSON.stringify(v.from)}</span>
                                                        <span>→</span>
                                                        <span className="text-emerald-600 truncate">{JSON.stringify(v.to)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {log.before_data && log.action === 'delete' && (
                                            <div className="mt-2 bg-red-50 dark:bg-red-900/10 p-2 rounded text-[10px] overflow-auto">
                                                <span className="font-bold text-red-800 dark:text-red-400 mb-1 block">Deleted Data:</span>
                                                <pre className="text-slate-600 dark:text-slate-400 max-h-24 overflow-y-auto whitespace-pre-wrap">
                                                    {JSON.stringify(log.before_data, null, 2)}
                                                </pre>
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
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

function getLocationBadgeClass(location?: string | null): string {
    const lower = (location || '').toLowerCase();
    if (lower.includes('시약장') || lower.includes('cabinet')) {
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
    }
    if (lower.includes('냉장고') || lower.includes('fridge')) {
        return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300';
    }
    if (lower.includes('냉동') || lower.includes('freezer')) {
        return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300';
    }
    if (lower.includes('후드') || lower.includes('hood')) {
        return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
    }
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
}
