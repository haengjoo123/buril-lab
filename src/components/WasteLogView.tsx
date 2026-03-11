/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchWasteLogs, deleteWasteLog } from '../services/wasteLogService';
import type { WasteLog } from '../types';
import { useTranslation } from 'react-i18next';
import { Trash2, ChevronDown, ChevronUp, Loader2, AlertCircle, Search, History, X, FileText, FileSpreadsheet, Download } from 'lucide-react';
import { CustomDialog } from './CustomDialog';
import { useLabStore } from '../store/useLabStore';
import type { WasteLogSortBy } from '../services/wasteLogService';
import { auditService, type AuditLog } from '../services/auditService';
import { EmptyState } from './EmptyState';
import { OnboardingGuideCard } from './onboarding/OnboardingGuideCard';
import * as XLSX from 'xlsx';
import html2pdf from 'html2pdf.js';
import { useOnboardingStore } from '../store/useOnboardingStore';
import { AppSelect } from './AppSelect';

type LogDateRange = '7d' | '30d' | '90d' | 'all';
type LogGroupMode = 'day' | 'week' | 'month';
type LogViewTab = 'recent' | 'archive';
type ExportFormat = 'pdf' | 'excel';
type ExportScope = 'today' | '7d' | '30d' | '90d' | 'archive' | 'all' | 'custom';

interface GroupedLogSection {
    key: string;
    mode: LogGroupMode;
    title: string;
    subtitle: string;
    logs: WasteLog[];
    totalVolumeMl: number;
    latestCreatedAt: number;
}

const PAGE_SIZE = 20;
const DELETE_WINDOW_MS = 24 * 60 * 60 * 1000;
const ARCHIVE_CUTOFF_DAYS = 90;

export const WasteLogView: React.FC = () => {
    const { t } = useTranslation();
    const showOnboardingGuide = useOnboardingStore((state) => state.hasCompletedWelcome && !state.hasSkippedOnboarding && !state.seenGuides.logs);
    const markGuideSeen = useOnboardingStore((state) => state.markGuideSeen);
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
    const [activeTab, setActiveTab] = useState<LogViewTab>('recent');
    const [dateRange, setDateRange] = useState<LogDateRange>('30d');
    const [sortBy, setSortBy] = useState<WasteLogSortBy>('created_at');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [viewingAuditLogForId, setViewingAuditLogForId] = useState<string | null>(null);
    const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
    const [isLoadingAudit, setIsLoadingAudit] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
    const [exportFormat, setExportFormat] = useState<ExportFormat>('excel');
    const [exportScope, setExportScope] = useState<ExportScope>('30d');
    const [customExportStartDate, setCustomExportStartDate] = useState('');
    const [customExportEndDate, setCustomExportEndDate] = useState('');
    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
    const exportOptionsContainerRef = useRef<HTMLDivElement>(null);
    const customExportSectionRef = useRef<HTMLDivElement>(null);

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

    useEffect(() => {
        if (!isExportDialogOpen || exportScope !== 'custom') {
            return;
        }

        requestAnimationFrame(() => {
            const container = exportOptionsContainerRef.current;
            const customSection = customExportSectionRef.current;

            if (!container || !customSection) {
                return;
            }

            customSection.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
            });
        });
    }, [exportScope, isExportDialogOpen]);

    const { createdAfter, createdBefore } = useMemo(
        () => getLogDateFilters(activeTab, dateRange),
        [activeTab, dateRange]
    );

    const loadLogs = useCallback(async (reset: boolean = false) => {
        setIsLoading(true);
        setError(null);
        try {
            const offset = reset ? 0 : page * PAGE_SIZE;
            const result = await fetchWasteLogs(PAGE_SIZE, offset, {
                search: searchQuery || undefined,
                sortBy,
                sortOrder,
                createdAfter,
                createdBefore,
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
    }, [createdAfter, createdBefore, page, searchQuery, sortBy, sortOrder, t]);

    // 실험실/검색/정렬/기간 변경 시 재조회
    useEffect(() => {
        loadLogs(true);
        setExpandedSections({});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, currentLabId, dateRange, searchQuery, sortBy, sortOrder]);

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
            createdAfter,
            createdBefore,
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

    const groupedSections = useMemo(
        () => sortBy === 'created_at'
            ? groupWasteLogsByAge(filteredLogs, sortOrder, t)
            : [],
        [filteredLogs, sortOrder, sortBy, t]
    );

    const sortOptions = useMemo(() => ([
        { value: 'created_at-desc', label: t('log_sort_date_desc') },
        { value: 'created_at-asc', label: t('log_sort_date_asc') },
        { value: 'disposal_category-asc', label: t('log_sort_category_asc') },
        { value: 'disposal_category-desc', label: t('log_sort_category_desc') },
        { value: 'handler_name-asc', label: t('log_sort_handler_asc') },
        { value: 'handler_name-desc', label: t('log_sort_handler_desc') },
    ]), [t]);

    const isDeleteAllowedForLog = useCallback((log: WasteLog) => {
        if (!canDeleteLogs) {
            return false;
        }

        return Date.now() - new Date(log.created_at).getTime() <= DELETE_WINDOW_MS;
    }, [canDeleteLogs]);

    const getDeleteBlockedMessage = useCallback((log: WasteLog) => {
        if (!canDeleteLogs) {
            return t('log_delete_admin_only');
        }

        if (!isDeleteAllowedForLog(log)) {
            return t('log_delete_time_limited');
        }

        return null;
    }, [canDeleteLogs, isDeleteAllowedForLog, t]);

    const handleDelete = async () => {
        if (!deleteId) return;
        const targetLog = logs.find(log => log.id === deleteId);

        if (!targetLog) {
            setDeleteId(null);
            return;
        }

        const blockedMessage = getDeleteBlockedMessage(targetLog);
        if (blockedMessage) {
            setError(blockedMessage);
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

    const renderLogCard = useCallback((log: WasteLog) => {
        const isExpanded = expandedId === log.id;
        const totalVol = computeTotalVolume(log);
        const primaryChemicalName = getPrimaryChemicalName(log);
        const deletedLocation = getDeletedLocation(log);
        const deleteReason = getDeleteReason(log);
        const locationBadgeClass = getLocationBadgeClass(deletedLocation);
        const displayTitle = log.disposal_category.startsWith('기타')
            ? (primaryChemicalName || log.disposal_category)
            : log.disposal_category;
        const canDeleteThisLog = isDeleteAllowedForLog(log);
        const deleteBlockedMessage = getDeleteBlockedMessage(log);

        return (
            <div
                key={log.id}
                className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden transition-all"
            >
                <button
                    onClick={() => setExpandedId(isExpanded ? null : log.id)}
                    className="w-full p-4 text-left flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-slate-750 transition-colors"
                >
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

                {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-100 dark:border-slate-700">
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

                        {deleteReason && (
                            <div className="mt-3 p-2.5 bg-slate-50 dark:bg-slate-700/30 rounded-lg text-sm text-slate-700 dark:text-slate-300">
                                <span className="font-medium">폐기 사유:</span> {deleteReason}
                            </div>
                        )}

                        {canDeleteThisLog ? (
                            <button
                                onClick={() => setDeleteId(log.id)}
                                className="mt-3 w-full py-2 text-sm text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                {t('log_delete') || '삭제'}
                            </button>
                        ) : deleteBlockedMessage ? (
                            <div className="mt-3 text-xs text-slate-500 dark:text-slate-400 text-center py-2">
                                {deleteBlockedMessage}
                            </div>
                        ) : null}
                    </div>
                )}
            </div>
        );
    }, [expandedId, getDeleteBlockedMessage, isDeleteAllowedForLog, t]);

    const openExportDialog = (format: ExportFormat) => {
        setIsExportMenuOpen(false);
        setExportFormat(format);
        setExportScope(activeTab === 'archive' ? 'archive' : dateRange);
        setCustomExportStartDate('');
        setCustomExportEndDate('');
        setIsExportDialogOpen(true);
    };

    const getExportScopeOptions = useCallback((): Array<{ value: ExportScope; label: string; description: string }> => [
        {
            value: 'today',
            label: t('log_export_scope_today'),
            description: t('log_export_scope_today_desc'),
        },
        {
            value: '7d',
            label: t('log_export_scope_7d'),
            description: t('log_export_scope_7d_desc'),
        },
        {
            value: '30d',
            label: t('log_export_scope_30d'),
            description: t('log_export_scope_30d_desc'),
        },
        {
            value: '90d',
            label: t('log_export_scope_90d'),
            description: t('log_export_scope_90d_desc'),
        },
        {
            value: 'archive',
            label: t('log_export_scope_archive'),
            description: t('log_export_scope_archive_desc'),
        },
        {
            value: 'all',
            label: t('log_export_scope_all'),
            description: t('log_export_scope_all_desc'),
        },
        {
            value: 'custom',
            label: t('log_export_scope_custom'),
            description: t('log_export_scope_custom_desc'),
        },
    ], [t]);

    const fetchLogsForExport = useCallback(async (scope: ExportScope) => {
        const filters = getExportDateFilters(
            scope,
            customExportStartDate,
            customExportEndDate
        );
        const result = await fetchWasteLogs(5000, 0, {
            search: searchQuery || undefined,
            sortBy,
            sortOrder,
            createdAfter: filters.createdAfter,
            createdBefore: filters.createdBefore,
        });

        return result.logs;
    }, [customExportEndDate, customExportStartDate, searchQuery, sortBy, sortOrder]);

    const handleExportExcel = async (scope: ExportScope) => {
        setIsExporting(true);
        try {
            const allLogs = await fetchLogsForExport(scope);

            const data = allLogs.map(log => ({
                "폐기일시": formatDate(log.created_at),
                "폐기구분": log.disposal_category,
                "시약명": log.chemicals.map(c => c.chemical?.name || (c as any).name || 'Unknown').join(', '),
                "총 용량": computeTotalVolume(log) || '',
                "삭제 위치": getDeletedLocation(log) || '',
                "처리자": log.handler_name || '',
                "사유": getDeleteReason(log) || ''
            }));

            const ws = XLSX.utils.json_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "폐기기록");
            XLSX.writeFile(wb, `폐기기록_${getExportFilenameSuffix(scope)}_${new Date().toISOString().slice(0, 10)}.xlsx`);
        } catch (e) {
            console.error(e);
            setError(t('dispose_error'));
        } finally {
            setIsExporting(false);
        }
    };

    const handleExportPDF = async (scope: ExportScope) => {
        setIsExporting(true);
        try {
            const allLogs = await fetchLogsForExport(scope);

            const container = document.createElement('div');
            container.style.padding = '20px';
            container.style.fontFamily = 'sans-serif';
            container.style.color = '#000';

            let html = `
                <h2 style="text-align: center; margin-bottom: 20px;">폐기 기록 목록</h2>
                <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: left;">
                    <thead>
                        <tr style="background-color: #f3f4f6;">
                            <th style="border: 1px solid #e5e7eb; padding: 8px;">폐기일시</th>
                            <th style="border: 1px solid #e5e7eb; padding: 8px;">폐기구분</th>
                            <th style="border: 1px solid #e5e7eb; padding: 8px;">시약명</th>
                            <th style="border: 1px solid #e5e7eb; padding: 8px;">용량</th>
                            <th style="border: 1px solid #e5e7eb; padding: 8px;">삭제 위치</th>
                            <th style="border: 1px solid #e5e7eb; padding: 8px;">처리자</th>
                            <th style="border: 1px solid #e5e7eb; padding: 8px;">사유</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            allLogs.forEach(log => {
                const chemicals = log.chemicals.map(c => c.chemical?.name || (c as any).name || 'Unknown').join(', ');
                html += `
                    <tr>
                        <td style="border: 1px solid #e5e7eb; padding: 6px;">${formatDate(log.created_at)}</td>
                        <td style="border: 1px solid #e5e7eb; padding: 6px;">${log.disposal_category}</td>
                        <td style="border: 1px solid #e5e7eb; padding: 6px;">${chemicals}</td>
                        <td style="border: 1px solid #e5e7eb; padding: 6px;">${computeTotalVolume(log) || ''}</td>
                        <td style="border: 1px solid #e5e7eb; padding: 6px;">${getDeletedLocation(log) || ''}</td>
                        <td style="border: 1px solid #e5e7eb; padding: 6px;">${log.handler_name || ''}</td>
                        <td style="border: 1px solid #e5e7eb; padding: 6px;">${getDeleteReason(log) || ''}</td>
                    </tr>
                `;
            });
            html += `</tbody></table>`;
            container.innerHTML = html;

            const opt = {
                margin: 10,
                filename: `폐기기록_${getExportFilenameSuffix(scope)}_${new Date().toISOString().slice(0, 10)}.pdf`,
                image: { type: 'jpeg' as const, quality: 0.98 },
                html2canvas: { scale: 2 },
                jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'landscape' as const }
            };

            await html2pdf().set(opt).from(container).save();
        } catch (e) {
            console.error(e);
            setError(t('dispose_error'));
        } finally {
            setIsExporting(false);
        }
    };

    const handleConfirmExport = async () => {
        if (exportScope === 'custom') {
            if (!customExportStartDate || !customExportEndDate) {
                setError(t('log_export_custom_required'));
                return;
            }

            if (customExportStartDate > customExportEndDate) {
                setError(t('log_export_custom_invalid_range'));
                return;
            }
        }

        setIsExportDialogOpen(false);

        if (exportFormat === 'pdf') {
            await handleExportPDF(exportScope);
            return;
        }

        await handleExportExcel(exportScope);
    };

    return (
        <div className="p-5 flex flex-col gap-4" style={{ paddingBottom: '100px' }}>
            {showOnboardingGuide && (
                <OnboardingGuideCard
                    icon={<History className="h-5 w-5" />}
                    title={t('onboarding_logs_title')}
                    description={t('onboarding_logs_desc')}
                    points={[
                        t('onboarding_logs_point_1'),
                        t('onboarding_logs_point_2'),
                        t('onboarding_logs_point_3'),
                    ]}
                    onDismiss={() => markGuideSeen('logs')}
                />
            )}

            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3 shrink-0">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        {t('log_title')}
                    </h2>
                    {totalCount > 0 && (
                        <span className="text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {totalCount}건
                        </span>
                    )}
                </div>

                {totalCount > 0 && (
                    <div className="relative ml-auto">
                        <button
                            onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                            disabled={isExporting}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-slate-700 bg-white border border-gray-200 hover:bg-gray-50 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50 shadow-sm whitespace-nowrap shrink-0"
                        >
                            {isExporting ? (
                                <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                            ) : (
                                <Download className="w-4 h-4 shrink-0" />
                            )}
                            <span className="mx-0.5">{isExporting ? t('log_exporting') : t('log_export', '내보내기')}</span>
                            <ChevronDown className="w-3.5 h-3.5 ml-0.5 opacity-60" />
                        </button>

                        {isExportMenuOpen && (
                            <>
                                <div
                                    className="fixed inset-0 z-40"
                                    onClick={() => setIsExportMenuOpen(false)}
                                />
                                <div className="absolute right-0 top-full mt-2 w-44 bg-white dark:bg-slate-800 rounded-xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.1)] dark:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.3)] border border-gray-100 dark:border-slate-700 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                                    <button
                                        onClick={() => {
                                            openExportDialog('pdf');
                                        }}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-left hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
                                    >
                                        <div className="w-6 h-6 rounded-md flex items-center justify-center bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 shrink-0">
                                            <FileText className="w-3.5 h-3.5" />
                                        </div>
                                        <span className="text-slate-700 dark:text-slate-200">{t('log_export_pdf', 'PDF로 내보내기')}</span>
                                    </button>
                                    <button
                                        onClick={() => {
                                            openExportDialog('excel');
                                        }}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-left hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors mt-0.5"
                                    >
                                        <div className="w-6 h-6 rounded-md flex items-center justify-center bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 shrink-0">
                                            <FileSpreadsheet className="w-3.5 h-3.5" />
                                        </div>
                                        <span className="text-slate-700 dark:text-slate-200">{t('log_export_excel', 'Excel로 내보내기')}</span>
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            <div className="flex flex-wrap gap-2">
                {([
                    ['recent', t('log_tab_recent')],
                    ['archive', t('log_tab_archive')],
                ] as Array<[LogViewTab, string]>).map(([value, label]) => {
                    const isActive = activeTab === value;
                    return (
                        <button
                            key={value}
                            type="button"
                            onClick={() => setActiveTab(value)}
                            className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${isActive
                                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                                    : 'bg-white text-slate-600 border border-gray-200 hover:bg-gray-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600 dark:hover:bg-slate-700'
                                }`}
                        >
                            {label}
                        </button>
                    );
                })}
            </div>

            <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm text-slate-700 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-slate-200">
                <div className="font-medium">{t('log_management_policy_title')}</div>
                <div className="mt-1 text-slate-600 dark:text-slate-300">
                    {activeTab === 'recent'
                        ? t('log_management_policy_desc_recent')
                        : t('log_management_policy_desc_archive')}
                </div>
            </div>

            {/* 검색 & 정렬 */}
            <div className="flex flex-col gap-2">
                {activeTab === 'recent' && (
                    <div className="flex flex-wrap gap-2">
                        {([
                            ['7d', t('log_range_7d')],
                            ['30d', t('log_range_30d')],
                            ['90d', t('log_range_90d')],
                        ] as Array<[LogDateRange, string]>).map(([value, label]) => {
                            const isActive = dateRange === value;
                            return (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setDateRange(value)}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${isActive
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-white text-slate-600 border border-gray-200 hover:bg-gray-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600 dark:hover:bg-slate-700'
                                        }`}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                )}

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
                    <AppSelect
                        value={`${sortBy}-${sortOrder}`}
                        onChange={(value) => {
                            const [by, order] = value.split('-') as [WasteLogSortBy, 'asc' | 'desc'];
                            setSortBy(by);
                            setSortOrder(order);
                        }}
                        options={sortOptions}
                        className="flex-shrink-0 min-w-[148px]"
                        buttonClassName="flex-shrink-0 min-w-[148px] bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-600"
                        align="right"
                    />
                </div>
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
                {sortBy === 'created_at' ? groupedSections.map(section => {
                    const isExpanded = expandedSections[section.key] ?? false;

                    return (
                        <div
                            key={section.key}
                            className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900/60"
                        >
                            <button
                                type="button"
                                onClick={() => setExpandedSections(prev => ({
                                    ...prev,
                                    [section.key]: !isExpanded,
                                }))}
                                className="flex w-full items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 text-left dark:border-slate-700"
                            >
                                <div>
                                    <div className="text-sm font-semibold text-slate-900 dark:text-white">
                                        {section.title}
                                    </div>
                                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                        {section.subtitle}
                                        {section.totalVolumeMl > 0 && ` • ${section.totalVolumeMl} mL`}
                                    </div>
                                </div>
                                {isExpanded
                                    ? <ChevronUp className="h-4 w-4 text-slate-400" />
                                    : <ChevronDown className="h-4 w-4 text-slate-400" />
                                }
                            </button>

                            {isExpanded && (
                                <div className="space-y-3 p-3">
                                    {section.logs.map(renderLogCard)}
                                </div>
                            )}
                        </div>
                    );
                }) : filteredLogs.map(renderLogCard)}
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

            {isExportDialogOpen && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                        onClick={() => setIsExportDialogOpen(false)}
                    />
                    <div className="relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900">
                        <div className="border-b border-slate-100 p-4 dark:border-slate-800">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                        {t('log_export_dialog_title')}
                                    </h3>
                                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                        {t(
                                            exportFormat === 'pdf'
                                                ? 'log_export_dialog_desc_pdf'
                                                : 'log_export_dialog_desc_excel'
                                        )}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsExportDialogOpen(false)}
                                    className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        <div
                            ref={exportOptionsContainerRef}
                            className="space-y-2 overflow-y-auto p-4"
                        >
                            {getExportScopeOptions().map(option => {
                                const isSelected = exportScope === option.value;

                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => setExportScope(option.value)}
                                        className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${isSelected
                                                ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30'
                                                : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'
                                            }`}
                                    >
                                        <div className="text-sm font-medium text-slate-900 dark:text-white">
                                            {option.label}
                                        </div>
                                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                            {option.description}
                                        </div>
                                    </button>
                                );
                            })}

                            {exportScope === 'custom' && (
                                <div
                                    ref={customExportSectionRef}
                                    className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60"
                                >
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <label className="flex flex-col gap-1.5 text-sm text-slate-700 dark:text-slate-300">
                                            <span>{t('log_export_custom_start')}</span>
                                            <input
                                                type="date"
                                                value={customExportStartDate}
                                                onChange={(e) => setCustomExportStartDate(e.target.value)}
                                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-1.5 text-sm text-slate-700 dark:text-slate-300">
                                            <span>{t('log_export_custom_end')}</span>
                                            <input
                                                type="date"
                                                value={customExportEndDate}
                                                onChange={(e) => setCustomExportEndDate(e.target.value)}
                                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                                            />
                                        </label>
                                    </div>
                                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                        {t('log_export_custom_hint')}
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3 border-t border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/50">
                            <button
                                type="button"
                                onClick={() => setIsExportDialogOpen(false)}
                                className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                            >
                                {t('btn_cancel')}
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmExport}
                                className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                            >
                                {t('log_export_confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

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

function getCreatedAfterIso(range: Exclude<LogDateRange, 'all'>): string {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (days - 1));
    return date.toISOString();
}

function getArchiveCreatedBeforeIso(): string {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (ARCHIVE_CUTOFF_DAYS - 1));
    cutoff.setMilliseconds(cutoff.getMilliseconds() - 1);
    return cutoff.toISOString();
}

function getLogDateFilters(activeTab: LogViewTab, dateRange: LogDateRange): {
    createdAfter?: string;
    createdBefore?: string;
} {
    if (activeTab === 'archive') {
        return {
            createdBefore: getArchiveCreatedBeforeIso(),
        };
    }

    const normalizedRange: Exclude<LogDateRange, 'all'> = dateRange === 'all' ? '30d' : dateRange;
    return {
        createdAfter: getCreatedAfterIso(normalizedRange),
    };
}

function getTodayRange(): { createdAfter: string; createdBefore: string } {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    end.setMilliseconds(end.getMilliseconds() - 1);

    return {
        createdAfter: start.toISOString(),
        createdBefore: end.toISOString(),
    };
}

function getExportDateFilters(
    scope: ExportScope,
    customStartDate?: string,
    customEndDate?: string
): { createdAfter?: string; createdBefore?: string } {
    if (scope === 'today') {
        return getTodayRange();
    }

    if (scope === '7d' || scope === '30d' || scope === '90d') {
        return {
            createdAfter: getCreatedAfterIso(scope),
        };
    }

    if (scope === 'archive') {
        return {
            createdBefore: getArchiveCreatedBeforeIso(),
        };
    }

    if (scope === 'custom' && customStartDate && customEndDate) {
        return {
            createdAfter: toStartOfDayIso(customStartDate),
            createdBefore: toEndOfDayIso(customEndDate),
        };
    }

    return {};
}

function getExportFilenameSuffix(scope: ExportScope): string {
    if (scope === 'today') return 'today';
    if (scope === '7d') return '7days';
    if (scope === '30d') return '30days';
    if (scope === '90d') return '90days';
    if (scope === 'archive') return 'archive';
    if (scope === 'custom') return 'custom';
    return 'all';
}

function toStartOfDayIso(dateString: string): string {
    const date = new Date(`${dateString}T00:00:00`);
    return date.toISOString();
}

function toEndOfDayIso(dateString: string): string {
    const date = new Date(`${dateString}T23:59:59.999`);
    return date.toISOString();
}

function groupWasteLogsByAge(
    logs: WasteLog[],
    sortOrder: 'asc' | 'desc',
    t: (key: string, options?: Record<string, unknown>) => string
): GroupedLogSection[] {
    const now = Date.now();
    const sections = new Map<string, GroupedLogSection>();

    for (const log of logs) {
        const createdAt = new Date(log.created_at);
        const ageInDays = Math.floor((now - createdAt.getTime()) / (24 * 60 * 60 * 1000));
        const mode: LogGroupMode = ageInDays <= 7 ? 'day' : ageInDays <= 90 ? 'week' : 'month';
        const bucketDate = mode === 'day'
            ? startOfDay(createdAt)
            : mode === 'week'
                ? startOfWeek(createdAt)
                : startOfMonth(createdAt);
        const key = `${mode}:${bucketDate.toISOString()}`;

        const current = sections.get(key);
        const totalVolumeMl = sumLogVolume(log);
        if (current) {
            current.logs.push(log);
            current.totalVolumeMl += totalVolumeMl;
            current.latestCreatedAt = Math.max(current.latestCreatedAt, createdAt.getTime());
            continue;
        }

        sections.set(key, {
            key,
            mode,
            title: formatGroupTitle(mode, bucketDate),
            subtitle: formatGroupSubtitle(mode, bucketDate, createdAt, 1, t),
            logs: [log],
            totalVolumeMl,
            latestCreatedAt: createdAt.getTime(),
        });
    }

    const grouped = Array.from(sections.values()).map(section => ({
        ...section,
        subtitle: formatGroupSubtitle(
            section.mode,
            getGroupBaseDate(section.key),
            new Date(section.latestCreatedAt),
            section.logs.length,
            t
        ),
        logs: [...section.logs].sort((a, b) => {
            const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            return sortOrder === 'asc' ? diff : -diff;
        }),
    }));

    return grouped.sort((a, b) => {
        const diff = a.latestCreatedAt - b.latestCreatedAt;
        return sortOrder === 'asc' ? diff : -diff;
    });
}

function sumLogVolume(log: WasteLog): number {
    if (typeof log.total_volume_ml === 'number' && !Number.isNaN(log.total_volume_ml)) {
        return log.total_volume_ml;
    }

    return log.chemicals.reduce((sum, chemical) => {
        if (!chemical.volume) {
            return sum;
        }

        const parsed = parseFloat(chemical.volume.replace(/[^0-9.]/g, ''));
        return Number.isNaN(parsed) ? sum : sum + parsed;
    }, 0);
}

function formatGroupTitle(mode: LogGroupMode, baseDate: Date): string {
    if (mode === 'day') {
        return baseDate.toLocaleDateString('ko-KR', {
            month: 'long',
            day: 'numeric',
            weekday: 'short',
        });
    }

    if (mode === 'week') {
        const endDate = new Date(baseDate);
        endDate.setDate(baseDate.getDate() + 6);
        return `${baseDate.toLocaleDateString('ko-KR', {
            month: 'numeric',
            day: 'numeric',
        })} - ${endDate.toLocaleDateString('ko-KR', {
            month: 'numeric',
            day: 'numeric',
        })}`;
    }

    return baseDate.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
    });
}

function formatGroupSubtitle(
    mode: LogGroupMode,
    baseDate: Date,
    latestDate: Date,
    count: number,
    t: (key: string, options?: Record<string, unknown>) => string
): string {
    if (mode === 'day') {
        return t('log_group_day_count', { count });
    }

    if (mode === 'week') {
        return t('log_group_week_summary', {
            count,
            latest: latestDate.toLocaleDateString(),
        });
    }

    return t('log_group_month_summary', {
        count,
        month: baseDate.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
        }),
    });
}

function getGroupBaseDate(sectionKey: string): Date {
    const iso = sectionKey.slice(sectionKey.indexOf(':') + 1);
    return new Date(iso);
}

function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date): Date {
    const start = startOfDay(date);
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    return start;
}

function startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}
