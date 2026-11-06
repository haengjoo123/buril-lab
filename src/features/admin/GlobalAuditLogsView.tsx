import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { auditService, type AuditLog } from '../../services/auditService';
import { useLabStore } from '../../store/useLabStore';
import { labService } from '../../services/labService';
import { useTranslation } from 'react-i18next';
import { RefreshCw, ShieldAlert, Loader2 } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { AppSelect } from '../../components/AppSelect';
import { formatAuditRelativeTime } from './auditRelativeTime';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { canCommitLabRequest, type LabRequestToken } from '../../utils/labRequestScope';
import {
    buildAuditEventDescription,
    formatAuditActionName,
    formatAuditEntityName,
    formatAuditValue,
    getAuditActionCategory,
    getAuditChangeRows,
    getAuditDetailSections,
} from '../../utils/auditLogFormatting';

type ActionFilter = 'all' | 'create' | 'update' | 'delete';
type PeriodFilter = 'all' | 'today' | '7d';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
/** Below this many logs, counters and filters are noise: everything fits on screen. */
const AUDIT_FILTER_MIN_LOGS = 5;

type AuditActionTone = 'delete' | 'clear' | 'update' | 'create' | 'other';

const ACTION_CHIP_CLASSES: Record<AuditActionTone, string> = {
    delete: 'bg-red-100 text-red-700',
    clear: 'bg-amber-100 text-amber-700',
    update: 'bg-blue-100 text-blue-700',
    create: 'bg-emerald-100 text-emerald-700',
    other: 'bg-gray-100 text-gray-700',
};

// Dark variants are needed so the card's dark:border-slate-* does not override the accent.
const ACTION_CARD_ACCENT_CLASSES: Record<AuditActionTone, string> = {
    delete: 'border-l-red-400 dark:border-l-red-500',
    clear: 'border-l-amber-400 dark:border-l-amber-500',
    update: 'border-l-blue-400 dark:border-l-blue-500',
    create: 'border-l-emerald-400 dark:border-l-emerald-500',
    other: 'border-l-slate-300 dark:border-l-slate-600',
};

const getAuditActionTone = (log: AuditLog): AuditActionTone => {
    const activityActionType = typeof log.after_data?.action_type === 'string'
        ? log.after_data.action_type
        : typeof log.before_data?.action_type === 'string'
            ? log.before_data.action_type
            : null;

    if (activityActionType === 'remove' || log.action === 'delete') return 'delete';
    if (activityActionType === 'clear_all') return 'clear';
    if (activityActionType === 'update' || log.action === 'update') return 'update';
    if (activityActionType === 'add' || log.action === 'create') return 'create';
    // Lab admin actions (join, role change, link approval...) use the same colors as their counter.
    const category = getAuditActionCategory(log);
    if (category === 'delete' || category === 'update' || category === 'create') return category;
    return 'other';
};

/** Current members as user_id -> nickname (or email), for member records. Only admins read those rows. */
type MemberNames = { labId: string; names: Readonly<Record<string, string>> };

/** The lab's activity log ("활동 기록" tab of the lab admin area). */
export const GlobalAuditLogsView: React.FC = () => {
    const { t, i18n } = useTranslation();
    const isDesktop = useIsDesktop();
    const currentLabId = useLabStore(state => state.currentLabId);
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loadedLabId, setLoadedLabId] = useState<string | null | undefined>(undefined);
    const [reloadKey, setReloadKey] = useState(0);
    const [limit, setLimit] = useState(100);
    const [actionFilter, setActionFilter] = useState<ActionFilter>('all');
    const [entityFilter, setEntityFilter] = useState<string>('all');
    const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('7d');
    const [keyword, setKeyword] = useState('');
    const [expandedLogIds, setExpandedLogIds] = useState<Record<string, boolean>>({});
    const [selectedAuditLogId, setSelectedAuditLogId] = useState<string | null>(null);
    const [memberNames, setMemberNames] = useState<MemberNames | null>(null);
    const loadRequestRef = useRef(0);
    // The lab whose member names were requested: loaded once per lab, errors ignored.
    const memberNamesLabRef = useRef<string | null>(null);
    const dateLocale = i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US';
    const showFilters = logs.length >= AUDIT_FILTER_MIN_LOGS;
    const hasMemberLogs = useMemo(() => logs.some((log) => log.entity_type === 'lab_member'), [logs]);
    const descriptionContext = useMemo(
        () => ({ memberNames: memberNames && memberNames.labId === currentLabId ? memberNames.names : undefined }),
        [currentLabId, memberNames]
    );

    useEffect(() => {
        if (!hasMemberLogs || !currentLabId || memberNamesLabRef.current === currentLabId) return;
        const labId = currentLabId;
        memberNamesLabRef.current = labId;
        labService.getLabMembers(labId)
            .then((members) => {
                if (useLabStore.getState().currentLabId !== labId) {
                    // Another lab is shown now: ask again if the admin comes back to this one.
                    if (memberNamesLabRef.current === labId) memberNamesLabRef.current = null;
                    return;
                }
                const names: Record<string, string> = {};
                for (const member of members) {
                    const name = member.nickname?.trim() || member.email;
                    if (member.user_id && name) names[member.user_id] = name;
                }
                setMemberNames({ labId, names });
            })
            .catch((error) => {
                // Names are a nicety: records still read "이전 멤버" without them.
                console.error(error);
            });
    }, [currentLabId, hasMemberLogs]);

    useLayoutEffect(() => {
        loadRequestRef.current += 1;
        setLogs([]);
        setSelectedAuditLogId(null);
        setExpandedLogIds({});
        setLoadError(null);
        setLoadedLabId(undefined);
        setIsLoading(true);
    }, [currentLabId]);

    useEffect(() => {
        const token: LabRequestToken = {
            generation: ++loadRequestRef.current,
            labId: currentLabId,
        };
        const isCurrentRequest = () => canCommitLabRequest(
            token,
            loadRequestRef.current,
            useLabStore.getState().currentLabId,
        );

        setLogs([]);
        setSelectedAuditLogId(null);
        setLoadError(null);
        if (!currentLabId) {
            setLoadedLabId(currentLabId);
            setIsLoading(false);
            return;
        }
        const run = async () => {
            setIsLoading(true);
            try {
                const fetchedLogs = await auditService.getLogs({ limit });
                if (!isCurrentRequest()) return;
                setLogs(fetchedLogs);
            } catch (error) {
                if (!isCurrentRequest()) return;
                console.error(error);
                setLogs([]);
                setLoadError(t('audit_load_error'));
            } finally {
                if (isCurrentRequest()) {
                    setLoadedLabId(token.labId);
                    setIsLoading(false);
                }
            }
        };
        void run();
        return () => {
            if (loadRequestRef.current === token.generation) loadRequestRef.current += 1;
        };
    }, [currentLabId, limit, reloadKey, t]);

    const filteredLogs = useMemo(() => {
        // Filters are hidden for short lists, so they must not silently apply either.
        if (!showFilters) return logs;
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
                buildAuditEventDescription(log, t, i18n.language, descriptionContext),
                log.location_context || '',
            ].join(' ').toLowerCase();

            return searchable.includes(trimmedKeyword);
        });
    }, [actionFilter, descriptionContext, entityFilter, i18n.language, keyword, logs, periodFilter, showFilters, t]);

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

    const renderActionChip = (log: AuditLog) => (
        <span className={`px-2 py-0.5 rounded text-xs font-bold ${ACTION_CHIP_CLASSES[getAuditActionTone(log)]}`}>
            {formatAuditActionName(log.action, t, log)}
        </span>
    );

    const isAuditLoading = isLoading || loadedLabId !== currentLabId;

    const renderAuditContent = () => {
        if (isAuditLoading) {
            return (
                <div className="flex items-center justify-center p-8">
                    <Loader2 className="w-8 h-8 text-red-500 animate-spin" aria-label={t('loading')} />
                </div>
            );
        }

        if (loadError) {
            return (
                <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-red-100 bg-red-50 p-6 text-center text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                    <span>{loadError}</span>
                    <button
                        type="button"
                        onClick={() => setReloadKey((key) => key + 1)}
                        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-slate-900 dark:text-red-200 dark:hover:bg-red-950/50"
                    >
                        <RefreshCw className="h-4 w-4" aria-hidden="true" />
                        {t('search_retry')}
                    </button>
                </div>
            );
        }

        return (
            <>
                {showFilters && (
                    <>
                        <div className="grid grid-cols-4 gap-1 md:gap-2">
                            <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 md:p-3">
                                <div className="text-3xs md:text-2xs text-slate-500 truncate whitespace-nowrap">{t('audit_summary_total')}</div>
                                <div className="text-base md:text-lg font-bold text-slate-800 dark:text-slate-100">{summary.total}</div>
                            </div>
                            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 p-2 md:p-3">
                                <div className="text-3xs md:text-2xs text-emerald-700 dark:text-emerald-300 truncate whitespace-nowrap">{t('audit_summary_create')}</div>
                                <div className="text-base md:text-lg font-bold text-emerald-700 dark:text-emerald-300">{summary.create}</div>
                            </div>
                            <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 p-2 md:p-3">
                                <div className="text-3xs md:text-2xs text-blue-700 dark:text-blue-300 truncate whitespace-nowrap">{t('audit_summary_update')}</div>
                                <div className="text-base md:text-lg font-bold text-blue-700 dark:text-blue-300">{summary.update}</div>
                            </div>
                            <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 p-2 md:p-3">
                                <div className="text-3xs md:text-2xs text-red-700 dark:text-red-300 truncate whitespace-nowrap">{t('audit_summary_delete')}</div>
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
                    </>
                )}

                <div className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-4">
                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                        {filteredLogs.length > 0 ? (
                            <table className="w-full table-auto text-left text-sm">
                                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                                    <tr>
                                        <th className="px-3 py-3">{t('audit_col_item')}</th>
                                        <th className="px-3 py-3">{t('audit_col_actor')}</th>
                                        <th className="px-3 py-3">{t('audit_col_action')}</th>
                                        <th className="px-3 py-3">{t('audit_col_location')}</th>
                                        <th className="px-3 py-3 text-right">{t('audit_col_time')}</th>
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
                                                        ? 'bg-slate-100 dark:bg-slate-800'
                                                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
                                                }`}
                                            >
                                                <td className="px-3 py-3">
                                                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                                                        {formatAuditEntityName(log.entity_type, t)}
                                                    </div>
                                                    <div className="mt-0.5 max-w-[18rem] truncate text-xs text-slate-500">
                                                        {buildAuditEventDescription(log, t, i18n.language, descriptionContext)}
                                                    </div>
                                                </td>
                                                <td className="px-3 py-3 text-xs text-slate-600 dark:text-slate-300">
                                                    {log.actor_name || t('audit_unknown')}
                                                </td>
                                                <td className="px-3 py-3">{renderActionChip(log)}</td>
                                                <td className="max-w-[12rem] truncate px-3 py-3 text-xs text-slate-500">
                                                    {formatAuditValue('location_context', log.location_context, t, i18n.language)}
                                                </td>
                                                <td className="px-3 py-3 text-right text-xs text-slate-500">
                                                    {new Date(log.created_at).toLocaleString(dateLocale)}
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
                        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{t('audit_detail_title')}</h3>
                        {selectedAuditLog ? (
                            <div className="mt-4 space-y-4">
                                <div>
                                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                        {buildAuditEventDescription(selectedAuditLog, t, i18n.language, descriptionContext)}
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
                                        [t('audit_col_actor'), selectedAuditLog.actor_name || t('audit_unknown')],
                                        [t('audit_col_location'), formatAuditValue('location_context', selectedAuditLog.location_context, t, i18n.language)],
                                        [t('audit_col_item'), formatAuditEntityName(selectedAuditLog.entity_type, t)],
                                        [t('audit_col_time'), new Date(selectedAuditLog.created_at).toLocaleString(dateLocale)],
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
                        const detailToggleLabel = expandedLogIds[log.id]
                            ? (i18n.language.startsWith('ko') ? '상세 닫기' : 'Hide details')
                            : (i18n.language.startsWith('ko') ? '상세 보기' : 'Show details');

                        return (
                            <div
                                key={log.id}
                                className={`flex flex-col gap-2 rounded-xl border border-l-4 border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 ${ACTION_CARD_ACCENT_CLASSES[getAuditActionTone(log)]}`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <p className="min-w-0 text-sm font-semibold text-slate-800 dark:text-slate-100">
                                        {buildAuditEventDescription(log, t, i18n.language, descriptionContext)}
                                    </p>
                                    <time
                                        dateTime={log.created_at}
                                        title={new Date(log.created_at).toLocaleString(dateLocale)}
                                        className="shrink-0 whitespace-nowrap text-xs text-slate-500"
                                    >
                                        {formatAuditRelativeTime(log.created_at, dateLocale)}
                                    </time>
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
                                                    <div key={section.key} className="bg-slate-50 dark:bg-slate-900 p-2 rounded text-2xs">
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
            </>
        );
    };

    return (
        <div className="p-5 flex flex-col gap-4" style={{ paddingBottom: '100px' }}>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <ShieldAlert className="w-6 h-6 text-red-500" aria-hidden="true" />
                {t('admin_tab_audit')}
            </h2>
            {renderAuditContent()}
        </div>
    );
};
