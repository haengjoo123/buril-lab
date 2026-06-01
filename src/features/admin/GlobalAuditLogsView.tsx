import React, { useState, useEffect, useMemo } from 'react';
import { auditService, type AuditLog } from '../../services/auditService';
import { useLabStore } from '../../store/useLabStore';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, Loader2, Users } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { AppSelect } from '../../components/AppSelect';
import { MemberManagementPanel } from './MemberManagementPanel';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import {
    buildAuditEventDescription,
    formatAuditActionName,
    formatAuditEntityName,
    formatAuditValue,
    getAuditActionCategory,
    getAuditChangeRows,
    getAuditDetailSections,
    isUuidLike,
} from '../../utils/auditLogFormatting';

type ActionFilter = 'all' | 'create' | 'update' | 'delete';
type PeriodFilter = 'all' | 'today' | '7d';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

type AdminTab = 'members' | 'audit';

export const GlobalAuditLogsView: React.FC = () => {
    const { t, i18n } = useTranslation();
    const isDesktop = useIsDesktop();
    const currentLabId = useLabStore(state => state.currentLabId);
    const [activeTab, setActiveTab] = useState<AdminTab>('members');
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [limit, setLimit] = useState(100);
    const [actionFilter, setActionFilter] = useState<ActionFilter>('all');
    const [entityFilter, setEntityFilter] = useState<string>('all');
    const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('7d');
    const [keyword, setKeyword] = useState('');
    const [expandedLogIds, setExpandedLogIds] = useState<Record<string, boolean>>({});
    const [selectedAuditLogId, setSelectedAuditLogId] = useState<string | null>(null);

    useEffect(() => {
        if (isDesktop) {
            setActiveTab('audit');
        }
    }, [isDesktop]);

    useEffect(() => {
        if (!currentLabId || activeTab !== 'audit') return;
        const run = async () => {
            setIsLoading(true);
            try {
                const fetchedLogs = await auditService.getLogs({ limit });
                setLogs(fetchedLogs);
            } catch (error) {
                console.error(error);
            } finally {
                setIsLoading(false);
            }
        };
        void run();
    }, [currentLabId, limit, activeTab]);

    const filteredLogs = useMemo(() => {
        return logs.filter((log) => {
            if (actionFilter !== 'all' && getAuditActionCategory(log) !== actionFilter) return false;
            if (entityFilter !== 'all' && log.entity_type !== entityFilter) return false;

            if (periodFilter !== 'all') {
                const createdAtMs = new Date(log.created_at).getTime();
                const nowDate = new Date();
                const todayStart = new Date(nowDate);
                todayStart.setHours(0, 0, 0, 0);
                const boundaryMs = periodFilter === 'today'
                    ? todayStart.getTime()
                    : nowDate.getTime() - SEVEN_DAYS_MS;
                if (createdAtMs < boundaryMs) return false;
            }

            const trimmedKeyword = keyword.trim().toLowerCase();
            if (!trimmedKeyword) return true;

            const searchable = [
                log.actor_name || '',
                log.entity_type,
                log.entity_id,
                formatAuditActionName(log.action, t, log),
                buildAuditEventDescription(log, t, i18n.language),
                log.location_context || '',
            ].join(' ').toLowerCase();

            return searchable.includes(trimmedKeyword);
        });
    }, [actionFilter, entityFilter, i18n.language, keyword, logs, periodFilter, t]);

    const summary = useMemo(() => {
        const actors = new Set(filteredLogs.map(log => log.actor_name).filter(Boolean));
        return {
            total: filteredLogs.length,
            create: filteredLogs.filter(log => getAuditActionCategory(log) === 'create').length,
            update: filteredLogs.filter(log => getAuditActionCategory(log) === 'update').length,
            delete: filteredLogs.filter(log => getAuditActionCategory(log) === 'delete').length,
            actors: actors.size,
        };
    }, [filteredLogs]);

    const selectedAuditLog = useMemo(
        () => filteredLogs.find((log) => log.id === selectedAuditLogId) || filteredLogs[0] || null,
        [filteredLogs, selectedAuditLogId]
    );

    useEffect(() => {
        if (!isDesktop) return;
        if (filteredLogs.length === 0) {
            setSelectedAuditLogId(null);
            return;
        }
        if (!selectedAuditLogId || !filteredLogs.some((log) => log.id === selectedAuditLogId)) {
            setSelectedAuditLogId(filteredLogs[0].id);
        }
    }, [filteredLogs, isDesktop, selectedAuditLogId]);

    const entityOptions = useMemo(() => {
        return Array.from(new Set(logs.map(log => log.entity_type))).sort();
    }, [logs]);

    const actionFilterOptions = useMemo(() => ([
        { value: 'all', label: t('audit_filter_all_actions') },
        { value: 'create', label: t('audit_filter_create') },
        { value: 'update', label: t('audit_filter_update') },
        { value: 'delete', label: t('audit_filter_delete') },
    ]), [t]);

    const entityFilterOptions = useMemo(() => ([
        { value: 'all', label: t('audit_filter_all_entities') },
        ...entityOptions.map((entity) => ({
            value: entity,
            label: formatAuditEntityName(entity, t),
        })),
    ]), [entityOptions, t]);

    const periodFilterOptions = useMemo(() => ([
        { value: 'all', label: t('audit_filter_all_period') },
        { value: 'today', label: t('audit_filter_today') },
        { value: '7d', label: t('audit_filter_7d') },
    ]), [t]);

    const toggleExpand = (logId: string) => {
        setExpandedLogIds(prev => ({ ...prev, [logId]: !prev[logId] }));
    };

    const renderActionChip = (log: AuditLog) => {
        const activityActionType = typeof log.after_data?.action_type === 'string'
            ? log.after_data.action_type
            : typeof log.before_data?.action_type === 'string'
                ? log.before_data.action_type
                : null;

        const className = activityActionType === 'remove' || log.action === 'delete'
            ? 'bg-red-100 text-red-700'
            : activityActionType === 'clear_all'
                ? 'bg-amber-100 text-amber-700'
                : activityActionType === 'update' || log.action === 'update'
                    ? 'bg-blue-100 text-blue-700'
                    : activityActionType === 'add' || log.action === 'create'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-gray-100 text-gray-700';

        return (
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${className}`}>
                {formatAuditActionName(log.action, t, log)}
            </span>
        );
    };

    if (isLoading && activeTab === 'audit') {
        return (
            <div className="flex items-center justify-center p-8">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="flex flex-col">
            {/* Tab header */}
            <div className="flex border-b border-slate-200 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-900 z-10">
                <button
                    onClick={() => setActiveTab('members')}
                    className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === 'members'
                            ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                            : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                >
                    <Users className="w-4 h-4" />
                    {t('admin_tab_members')}
                </button>
                <button
                    onClick={() => setActiveTab('audit')}
                    className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === 'audit'
                            ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                            : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                >
                    <ShieldAlert className="w-4 h-4" />
                    {t('admin_tab_audit')}
                </button>
            </div>

            {/* Tab content */}
            {activeTab === 'members' ? (
                <MemberManagementPanel />
            ) : (
                <div className="p-5 flex flex-col gap-4" style={{ paddingBottom: '100px' }}>
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <ShieldAlert className="w-6 h-6 text-red-500" />
                            {t('audit_title')}
                        </h2>
                    </div>
                    <div className="text-xs text-slate-500 mb-2">{t('audit_subtitle')}</div>

                    <div className="grid grid-cols-4 gap-1 md:gap-2">
                        <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 md:p-3">
                            <div className="text-[9px] md:text-[11px] text-slate-500 truncate whitespace-nowrap">{t('audit_summary_total')}</div>
                            <div className="text-base md:text-lg font-bold text-slate-800 dark:text-slate-100">{summary.total}</div>
                        </div>
                        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 p-2 md:p-3">
                            <div className="text-[9px] md:text-[11px] text-emerald-700 dark:text-emerald-300 truncate whitespace-nowrap">{t('audit_summary_create')}</div>
                            <div className="text-base md:text-lg font-bold text-emerald-700 dark:text-emerald-300">{summary.create}</div>
                        </div>
                        <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 p-2 md:p-3">
                            <div className="text-[11px] md:text-[11px] text-blue-700 dark:text-blue-300 truncate whitespace-nowrap">{t('audit_summary_update')}</div>
                            <div className="text-base md:text-lg font-bold text-blue-700 dark:text-blue-300">{summary.update}</div>
                        </div>
                        <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 p-2 md:p-3">
                            <div className="text-[9px] md:text-[11px] text-red-700 dark:text-red-300 truncate whitespace-nowrap">{t('audit_summary_delete')}</div>
                            <div className="text-base md:text-lg font-bold text-red-700 dark:text-red-300">{summary.delete}</div>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 flex flex-col gap-2">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <AppSelect
                                value={actionFilter}
                                onChange={(value) => setActionFilter(value as ActionFilter)}
                                options={actionFilterOptions}
                                buttonClassName="bg-white dark:bg-slate-900"
                            />
                            <AppSelect
                                value={entityFilter}
                                onChange={setEntityFilter}
                                options={entityFilterOptions}
                                buttonClassName="bg-white dark:bg-slate-900"
                            />
                            <AppSelect
                                value={periodFilter}
                                onChange={(value) => setPeriodFilter(value as PeriodFilter)}
                                options={periodFilterOptions}
                                buttonClassName="bg-white dark:bg-slate-900"
                            />
                            <input
                                value={keyword}
                                onChange={(e) => setKeyword(e.target.value)}
                                placeholder={t('audit_search_placeholder')}
                                className="px-2 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                        </div>
                    </div>

                    <div className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-4">
                        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                            {filteredLogs.length > 0 ? (
                                <table className="w-full table-auto text-left text-sm">
                                    <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                                        <tr>
                                            <th className="px-3 py-3">{t('audit_entity_type_label')}</th>
                                            <th className="px-3 py-3">{t('audit_actor_label')}</th>
                                            <th className="px-3 py-3">{t('audit_filter_all_actions')}</th>
                                            <th className="px-3 py-3">{t('audit_location_label')}</th>
                                            <th className="px-3 py-3 text-right">{t('audit_filter_all_period')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {filteredLogs.map((log) => {
                                            const isSelected = selectedAuditLog?.id === log.id;
                                            return (
                                                <tr
                                                    key={log.id}
                                                    onClick={() => setSelectedAuditLogId(log.id)}
                                                    className={`cursor-pointer transition-colors ${
                                                        isSelected
                                                            ? 'bg-indigo-50/80 dark:bg-indigo-950/20'
                                                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
                                                    }`}
                                                >
                                                    <td className="px-3 py-3">
                                                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                                                            {formatAuditEntityName(log.entity_type, t)}
                                                        </div>
                                                        <div className="mt-0.5 max-w-[18rem] truncate text-xs text-slate-500">
                                                            {buildAuditEventDescription(log, t, i18n.language)}
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-3 text-xs text-slate-600 dark:text-slate-300">
                                                        {log.actor_name || t('audit_unknown')}
                                                    </td>
                                                    <td className="px-3 py-3">{renderActionChip(log)}</td>
                                                    <td className="max-w-[12rem] truncate px-3 py-3 text-xs text-slate-500">
                                                        {log.location_context || '-'}
                                                    </td>
                                                    <td className="px-3 py-3 text-right text-xs text-slate-500">
                                                        {new Date(log.created_at).toLocaleString(i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US')}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="p-8">
                                    <EmptyState variant="audit" subtitle={t('audit_empty')} />
                                </div>
                            )}
                        </div>

                        <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{t('audit_title')}</h3>
                            {selectedAuditLog ? (
                                <div className="mt-4 space-y-4">
                                    <div>
                                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                            {buildAuditEventDescription(selectedAuditLog, t, i18n.language)}
                                        </div>
                                        <div className="mt-2 flex flex-wrap items-center gap-2">
                                            {renderActionChip(selectedAuditLog)}
                                            <span className="text-xs text-slate-500">
                                                {formatAuditEntityName(selectedAuditLog.entity_type, t)}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
                                        {[
                                            [t('audit_actor_label'), selectedAuditLog.actor_name || t('audit_unknown')],
                                            [t('audit_location_label'), selectedAuditLog.location_context || '-'],
                                            [t('audit_entity_type_label'), selectedAuditLog.entity_id],
                                            [t('audit_filter_all_period'), new Date(selectedAuditLog.created_at).toLocaleString(i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US')],
                                        ].map(([label, value]) => (
                                            <div key={label} className="flex items-start justify-between gap-3 py-2">
                                                <span className="text-slate-500 dark:text-slate-400">{label}</span>
                                                <span className="text-right font-semibold text-slate-800 dark:text-slate-100">{value}</span>
                                            </div>
                                        ))}
                                    </div>

                                    {getAuditChangeRows(selectedAuditLog, t, i18n.language).length > 0 && (
                                        <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-3 dark:border-indigo-900/40 dark:bg-indigo-950/20">
                                            <h4 className="text-sm font-bold text-indigo-700 dark:text-indigo-300">{t('audit_change_summary')}</h4>
                                            <div className="mt-2 space-y-2">
                                                {getAuditChangeRows(selectedAuditLog, t, i18n.language).slice(0, 6).map((row) => (
                                                    <div key={row.key} className="text-xs text-slate-700 dark:text-slate-200">
                                                        <div className="font-semibold text-slate-500 dark:text-slate-400">{row.label}</div>
                                                        <div className="mt-1 flex items-center justify-between gap-2">
                                                            <span className="truncate rounded bg-white px-2 py-1 text-red-600 line-through dark:bg-slate-900 dark:text-red-300">{row.fromText}</span>
                                                            <span className="truncate rounded bg-white px-2 py-1 text-emerald-700 dark:bg-slate-900 dark:text-emerald-300">{row.toText}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {getAuditDetailSections(selectedAuditLog, t, i18n.language).slice(0, 2).map((section) => (
                                        <div key={section.key} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                                            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">{section.title}</h4>
                                            <div className="mt-2 space-y-2 text-xs">
                                                {section.rows.slice(0, 5).map((row) => (
                                                    <div key={row.key} className="flex items-start justify-between gap-3">
                                                        <span className="text-slate-500 dark:text-slate-400">{row.label}</span>
                                                        <span className="break-all text-right text-slate-700 dark:text-slate-200">{row.value}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="mt-6">
                                    <EmptyState variant="audit" subtitle={t('audit_empty')} />
                                </div>
                            )}
                        </aside>
                    </div>

                    <div className="space-y-3 lg:hidden">
                        {filteredLogs.map(log => {
                            const changeRows = getAuditChangeRows(log, t, i18n.language).slice(0, 4);
                            const detailSections = getAuditDetailSections(log, t, i18n.language);
                            const locationText = typeof log.location_context === 'string' && !isUuidLike(log.location_context)
                                ? formatAuditValue('location_context', log.location_context, t, i18n.language)
                                : null;
                            const detailToggleLabel = expandedLogIds[log.id]
                                ? (i18n.language.startsWith('ko') ? '상세 닫기' : 'Hide details')
                                : (i18n.language.startsWith('ko') ? '상세 보기' : 'Show details');

                            return (
                                <div key={log.id} className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col gap-2">
                                    <div className="flex justify-between items-start gap-2">
                                        <div className="flex flex-col gap-1">
                                            <div className="font-semibold text-sm text-slate-800 dark:text-slate-100">
                                                {buildAuditEventDescription(log, t, i18n.language)}
                                            </div>
                                            <div className="text-xs text-slate-500">
                                                {t('audit_entity_type_label')} {formatAuditEntityName(log.entity_type, t)}
                                                {locationText ? `${t('audit_location_label')}${locationText}` : ''}
                                            </div>
                                        </div>
                                        <span className="text-xs text-slate-500">
                                            {new Date(log.created_at).toLocaleString(i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US')}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {renderActionChip(log)}
                                        <span className="text-xs text-slate-600 dark:text-slate-300">
                                            {t('audit_actor_label')} {log.actor_name || t('audit_unknown')}
                                        </span>
                                    </div>

                                    {changeRows.length > 0 && (
                                        <div className="mt-1 bg-slate-50 dark:bg-slate-900 p-2 rounded text-xs">
                                            <div className="font-medium text-slate-700 dark:text-slate-300 mb-1">{t('audit_change_summary')}</div>
                                            <div className="space-y-1">
                                                {changeRows.map((row) => (
                                                    <div key={row.key} className="flex flex-wrap items-center gap-1.5 text-slate-600 dark:text-slate-300">
                                                        <span className="font-medium text-slate-500 dark:text-slate-400">{row.label}</span>
                                                        <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-600 line-through dark:bg-red-950/40 dark:text-red-300">
                                                            {row.fromText}
                                                        </span>
                                                        <span className="text-slate-400">→</span>
                                                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                                            {row.toText}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {detailSections.length > 0 && (
                                        <>
                                            <button
                                                onClick={() => toggleExpand(log.id)}
                                                className="text-xs text-blue-600 hover:text-blue-700 w-fit"
                                            >
                                                {detailToggleLabel}
                                            </button>

                                            {expandedLogIds[log.id] && (
                                                <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-2">
                                                    {detailSections.map((section) => (
                                                        <div key={section.key} className="bg-slate-50 dark:bg-slate-900 p-2 rounded text-[11px]">
                                                            <div className="font-semibold text-slate-700 dark:text-slate-300 mb-2">{section.title}</div>
                                                            <div className="space-y-1.5">
                                                                {section.rows.map((row) => (
                                                                    <div key={row.key} className="flex items-start justify-between gap-3">
                                                                        <span className="text-slate-500 dark:text-slate-400">{row.label}</span>
                                                                        <span className="text-right text-slate-700 break-all dark:text-slate-200">{row.value}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        })}
                        {filteredLogs.length === 0 && (
                            <EmptyState variant="audit" subtitle={t('audit_empty')} />
                        )}
                    </div>
                    {logs.length >= limit && (
                        <button
                            onClick={() => setLimit(l => l + 50)}
                            className="w-full py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-blue-600 font-medium"
                        >
                            {t('audit_load_more')}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};
