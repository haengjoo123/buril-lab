import React, { useState, useEffect, useMemo } from 'react';
import { auditService, type AuditLog } from '../../services/auditService';
import { useLabStore } from '../../store/useLabStore';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, Loader2 } from 'lucide-react';
import type { TFunction } from 'i18next';
import { EmptyState } from '../../components/EmptyState';
import { AppSelect } from '../../components/AppSelect';

type ActionFilter = 'all' | 'create' | 'update' | 'delete';
type PeriodFilter = 'all' | 'today' | '7d';

const ACTION_KEY: Record<string, string> = {
    create: 'audit_action_create',
    update: 'audit_action_update',
    delete: 'audit_action_delete',
};

const ENTITY_KEY: Record<string, string> = {
    inventory: 'audit_entity_inventory',
    cabinet_item: 'audit_entity_cabinet_item',
    cabinet_activity: 'audit_entity_cabinet_activity',
    cabinet: 'audit_entity_cabinet',
    waste_log: 'audit_entity_waste_log',
};

const FIELD_KEY: Record<string, string> = {
    name: 'audit_field_name',
    quantity: 'audit_field_quantity',
    capacity: 'audit_field_capacity',
    expiry_date: 'audit_field_expiry_date',
    memo: 'audit_field_memo',
    brand: 'audit_field_brand',
    product_number: 'audit_field_product_number',
    cas_number: 'audit_field_cas_number',
    cas_no: 'audit_field_cas_number',
    action_type: 'audit_field_action_type',
    item_name: 'audit_field_item_name',
    storage_type: 'audit_field_storage_type',
    cabinet_id: 'audit_field_cabinet_id',
    storage_location_id: 'audit_field_storage_location_id',
};

const toSafeText = (value: unknown, t: TFunction): string => {
    if (value == null) return '-';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return t('audit_complex_data');
    }
};

const toRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
};

const isUuidLike = (value: string): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const formatFieldName = (key: string, t: TFunction): string => FIELD_KEY[key] ? t(FIELD_KEY[key]) : key;
const formatActionName = (action: string, t: TFunction): string => ACTION_KEY[action] ? t(ACTION_KEY[action]) : action;
const formatEntityName = (entityType: string, t: TFunction): string => ENTITY_KEY[entityType] ? t(ENTITY_KEY[entityType]) : entityType;

const buildEventDescription = (log: AuditLog, t: TFunction): string => {
    const actor = log.actor_name || t('audit_unknown_user');
    const actionLabel = formatActionName(log.action, t);
    const entityLabel = formatEntityName(log.entity_type, t);
    const beforeData = toRecord(log.before_data);
    const afterData = toRecord(log.after_data);

    const itemName =
        (afterData?.item_name as string | undefined) ||
        (afterData?.name as string | undefined) ||
        (beforeData?.item_name as string | undefined) ||
        (beforeData?.name as string | undefined);

    const location = log.location_context && !isUuidLike(log.location_context) ? log.location_context : null;

    if (itemName && location) {
        return t('audit_event_item_location', { actor, item: itemName, location, action: actionLabel });
    }
    if (itemName) {
        return t('audit_event_item', { actor, item: itemName, action: actionLabel });
    }
    return t('audit_event_entity', { actor, entity: entityLabel, action: actionLabel });
};

const getChangedFields = (log: AuditLog, t: TFunction): string[] => {
    const diffData = toRecord(log.diff_data);
    if (!diffData) return [];
    return Object.entries(diffData).slice(0, 4).map(([key, rawValue]) => {
        const valueRecord = toRecord(rawValue);
        const fromValue = valueRecord?.from;
        const toValue = valueRecord?.to;
        return `${formatFieldName(key, t)}: ${toSafeText(fromValue, t)} -> ${toSafeText(toValue, t)}`;
    });
};

export const GlobalAuditLogsView: React.FC = () => {
    const { t } = useTranslation();
    const currentLabId = useLabStore(state => state.currentLabId);
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [limit, setLimit] = useState(100);
    const [actionFilter, setActionFilter] = useState<ActionFilter>('all');
    const [entityFilter, setEntityFilter] = useState<string>('all');
    const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('7d');
    const [keyword, setKeyword] = useState('');
    const [expandedLogIds, setExpandedLogIds] = useState<Record<string, boolean>>({});

    useEffect(() => {
        if (!currentLabId) return;
        setIsLoading(true);
        auditService.getLogs({ limit })
            .then(setLogs)
            .catch(console.error)
            .finally(() => setIsLoading(false));
    }, [currentLabId, limit]);

    const filteredLogs = useMemo(() => {
        const now = Date.now();
        return logs.filter((log) => {
            if (actionFilter !== 'all' && log.action !== actionFilter) return false;
            if (entityFilter !== 'all' && log.entity_type !== entityFilter) return false;

            if (periodFilter !== 'all') {
                const createdAtMs = new Date(log.created_at).getTime();
                const boundaryMs = periodFilter === 'today'
                    ? new Date(new Date().setHours(0, 0, 0, 0)).getTime()
                    : now - 7 * 24 * 60 * 60 * 1000;
                if (createdAtMs < boundaryMs) return false;
            }

            const trimmedKeyword = keyword.trim().toLowerCase();
            if (!trimmedKeyword) return true;

            const afterData = toRecord(log.after_data);
            const beforeData = toRecord(log.before_data);
            const searchable = [
                log.actor_name || '',
                log.entity_type,
                log.entity_id,
                formatActionName(log.action, t),
                (afterData?.item_name as string | undefined) || '',
                (afterData?.name as string | undefined) || '',
                (beforeData?.item_name as string | undefined) || '',
                (beforeData?.name as string | undefined) || '',
                log.location_context || '',
            ].join(' ').toLowerCase();

            return searchable.includes(trimmedKeyword);
        });
    }, [actionFilter, entityFilter, keyword, logs, periodFilter, t]);

    const summary = useMemo(() => {
        const actors = new Set(filteredLogs.map(log => log.actor_name).filter(Boolean));
        return {
            total: filteredLogs.length,
            create: filteredLogs.filter(log => log.action === 'create').length,
            update: filteredLogs.filter(log => log.action === 'update').length,
            delete: filteredLogs.filter(log => log.action === 'delete').length,
            actors: actors.size,
        };
    }, [filteredLogs]);

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
            label: formatEntityName(entity, t),
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

    const renderActionChip = (action: string) => {
        const className = action === 'delete'
            ? 'bg-red-100 text-red-700'
            : action === 'create'
                ? 'bg-emerald-100 text-emerald-700'
                : action === 'update'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-700';
        return <span className={`px-2 py-0.5 rounded text-xs font-bold ${className}`}>{formatActionName(action, t)}</span>;
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-8">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="p-5 flex flex-col gap-4" style={{ paddingBottom: '100px' }}>
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <ShieldAlert className="w-6 h-6 text-red-500" />
                    {t('audit_title')}
                </h2>
            </div>
            <div className="text-xs text-slate-500 mb-2">{t('audit_subtitle')}</div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
                    <div className="text-[11px] text-slate-500">{t('audit_summary_total')}</div>
                    <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{summary.total}</div>
                </div>
                <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 p-3">
                    <div className="text-[11px] text-emerald-700 dark:text-emerald-300">{t('audit_summary_create')}</div>
                    <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{summary.create}</div>
                </div>
                <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 p-3">
                    <div className="text-[11px] text-blue-700 dark:text-blue-300">{t('audit_summary_update')}</div>
                    <div className="text-lg font-bold text-blue-700 dark:text-blue-300">{summary.update}</div>
                </div>
                <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 p-3">
                    <div className="text-[11px] text-red-700 dark:text-red-300">{t('audit_summary_delete')}</div>
                    <div className="text-lg font-bold text-red-700 dark:text-red-300">{summary.delete}</div>
                </div>
                <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
                    <div className="text-[11px] text-slate-500">{t('audit_summary_actors')}</div>
                    <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{summary.actors}</div>
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

            <div className="space-y-3">
                {filteredLogs.map(log => (
                    <div key={log.id} className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col gap-2">
                        <div className="flex justify-between items-start gap-2">
                            <div className="flex flex-col gap-1">
                                <div className="font-semibold text-sm text-slate-800 dark:text-slate-100">{buildEventDescription(log, t)}</div>
                                <div className="text-xs text-slate-500">
                                    {t('audit_entity_type_label')} {formatEntityName(log.entity_type, t)}
                                    {log.location_context && !isUuidLike(log.location_context) ? `${t('audit_location_label')}${log.location_context}` : ''}
                                </div>
                            </div>
                            <span className="text-xs text-slate-500">{new Date(log.created_at).toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            {renderActionChip(log.action)}
                            <span className="text-xs text-slate-600 dark:text-slate-300">
                                {t('audit_actor_label')} {log.actor_name || t('audit_unknown')}
                            </span>
                        </div>

                        {getChangedFields(log, t).length > 0 && (
                            <div className="mt-1 bg-slate-50 dark:bg-slate-900 p-2 rounded text-xs">
                                <div className="font-medium text-slate-700 dark:text-slate-300 mb-1">{t('audit_change_summary')}</div>
                                {getChangedFields(log, t).map((line, index) => (
                                    <div key={index} className="text-slate-600 dark:text-slate-300">{line}</div>
                                ))}
                            </div>
                        )}

                        <button
                            onClick={() => toggleExpand(log.id)}
                            className="text-xs text-blue-600 hover:text-blue-700 w-fit"
                        >
                            {expandedLogIds[log.id] ? t('audit_detail_hide') : t('audit_detail_show')}
                        </button>

                        {expandedLogIds[log.id] && (
                            <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-2">
                                <div className="bg-slate-50 dark:bg-slate-900 p-2 rounded text-[11px]">
                                    <div className="font-semibold text-slate-700 dark:text-slate-300 mb-1">{t('audit_before')}</div>
                                    <pre className="text-slate-600 dark:text-slate-400 whitespace-pre-wrap max-h-36 overflow-y-auto">
                                        {JSON.stringify(log.before_data, null, 2)}
                                    </pre>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-900 p-2 rounded text-[11px]">
                                    <div className="font-semibold text-slate-700 dark:text-slate-300 mb-1">{t('audit_after')}</div>
                                    <pre className="text-slate-600 dark:text-slate-400 whitespace-pre-wrap max-h-36 overflow-y-auto">
                                        {JSON.stringify(log.after_data, null, 2)}
                                    </pre>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
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
    );
};
