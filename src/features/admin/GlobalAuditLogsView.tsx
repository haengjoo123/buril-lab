import React, { useState, useEffect, useMemo } from 'react';
import { auditService, type AuditLog } from '../../services/auditService';
import { useLabStore } from '../../store/useLabStore';
import { ShieldAlert, Loader2 } from 'lucide-react';

type ActionFilter = 'all' | 'create' | 'update' | 'delete';
type PeriodFilter = 'all' | 'today' | '7d';

const ACTION_LABEL: Record<string, string> = {
    create: '등록',
    update: '수정',
    delete: '삭제',
};

const ENTITY_LABEL: Record<string, string> = {
    inventory: '재고 항목',
    cabinet_item: '시약장 항목',
    cabinet_activity: '시약장 활동',
    cabinet: '시약장',
    waste_log: '폐기 기록',
};

const FIELD_LABEL: Record<string, string> = {
    name: '이름',
    quantity: '수량',
    capacity: '용량',
    expiry_date: '유효기간',
    memo: '메모',
    brand: '브랜드',
    product_number: '제품번호',
    cas_number: 'CAS 번호',
    cas_no: 'CAS 번호',
    action_type: '작업',
    item_name: '항목명',
    storage_type: '보관 유형',
    cabinet_id: '시약장',
    storage_location_id: '보관 장소',
};

const toSafeText = (value: unknown): string => {
    if (value == null) return '-';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return '[복합 데이터]';
    }
};

const toRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
};

const isUuidLike = (value: string): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const formatFieldName = (key: string): string => FIELD_LABEL[key] || key;
const formatActionName = (action: string): string => ACTION_LABEL[action] || action;
const formatEntityName = (entityType: string): string => ENTITY_LABEL[entityType] || entityType;

const buildEventDescription = (log: AuditLog): string => {
    const actor = log.actor_name || '알 수 없는 사용자';
    const actionLabel = formatActionName(log.action);
    const entityLabel = formatEntityName(log.entity_type);
    const beforeData = toRecord(log.before_data);
    const afterData = toRecord(log.after_data);

    const itemName =
        (afterData?.item_name as string | undefined) ||
        (afterData?.name as string | undefined) ||
        (beforeData?.item_name as string | undefined) ||
        (beforeData?.name as string | undefined);

    const location = log.location_context && !isUuidLike(log.location_context) ? log.location_context : null;

    if (itemName && location) {
        return `${actor}님이 ${itemName}을(를) ${location}에서 ${actionLabel}했습니다.`;
    }
    if (itemName) {
        return `${actor}님이 ${itemName}을(를) ${actionLabel}했습니다.`;
    }
    return `${actor}님이 ${entityLabel}을(를) ${actionLabel}했습니다.`;
};

const getChangedFields = (log: AuditLog): string[] => {
    const diffData = toRecord(log.diff_data);
    if (!diffData) return [];
    return Object.entries(diffData).slice(0, 4).map(([key, rawValue]) => {
        const valueRecord = toRecord(rawValue);
        const fromValue = valueRecord?.from;
        const toValue = valueRecord?.to;
        return `${formatFieldName(key)}: ${toSafeText(fromValue)} -> ${toSafeText(toValue)}`;
    });
};

export const GlobalAuditLogsView: React.FC = () => {
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
                formatActionName(log.action),
                (afterData?.item_name as string | undefined) || '',
                (afterData?.name as string | undefined) || '',
                (beforeData?.item_name as string | undefined) || '',
                (beforeData?.name as string | undefined) || '',
                log.location_context || '',
            ].join(' ').toLowerCase();

            return searchable.includes(trimmedKeyword);
        });
    }, [actionFilter, entityFilter, keyword, logs, periodFilter]);

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
        return <span className={`px-2 py-0.5 rounded text-xs font-bold ${className}`}>{formatActionName(action)}</span>;
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
                    전체 감사 로그 (Admin)
                </h2>
            </div>
            <div className="text-xs text-slate-500 mb-2">※ 모든 항목의 변경 이력이 기록됩니다.</div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
                    <div className="text-[11px] text-slate-500">전체</div>
                    <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{summary.total}</div>
                </div>
                <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 p-3">
                    <div className="text-[11px] text-emerald-700 dark:text-emerald-300">등록</div>
                    <div className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{summary.create}</div>
                </div>
                <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 p-3">
                    <div className="text-[11px] text-blue-700 dark:text-blue-300">수정</div>
                    <div className="text-lg font-bold text-blue-700 dark:text-blue-300">{summary.update}</div>
                </div>
                <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 p-3">
                    <div className="text-[11px] text-red-700 dark:text-red-300">삭제</div>
                    <div className="text-lg font-bold text-red-700 dark:text-red-300">{summary.delete}</div>
                </div>
                <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
                    <div className="text-[11px] text-slate-500">작업자 수</div>
                    <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{summary.actors}</div>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 flex flex-col gap-2">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <select
                        value={actionFilter}
                        onChange={(e) => setActionFilter(e.target.value as ActionFilter)}
                        className="px-2 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                        <option value="all">모든 작업</option>
                        <option value="create">등록</option>
                        <option value="update">수정</option>
                        <option value="delete">삭제</option>
                    </select>
                    <select
                        value={entityFilter}
                        onChange={(e) => setEntityFilter(e.target.value)}
                        className="px-2 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                        <option value="all">모든 항목 유형</option>
                        {entityOptions.map(entity => (
                            <option key={entity} value={entity}>{formatEntityName(entity)}</option>
                        ))}
                    </select>
                    <select
                        value={periodFilter}
                        onChange={(e) => setPeriodFilter(e.target.value as PeriodFilter)}
                        className="px-2 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    >
                        <option value="all">전체 기간</option>
                        <option value="today">오늘</option>
                        <option value="7d">최근 7일</option>
                    </select>
                    <input
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        placeholder="작업자/항목명 검색"
                        className="px-2 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                </div>
            </div>

            <div className="space-y-3">
                {filteredLogs.map(log => (
                    <div key={log.id} className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col gap-2">
                        <div className="flex justify-between items-start gap-2">
                            <div className="flex flex-col gap-1">
                                <div className="font-semibold text-sm text-slate-800 dark:text-slate-100">{buildEventDescription(log)}</div>
                                <div className="text-xs text-slate-500">
                                    항목 유형: {formatEntityName(log.entity_type)}
                                    {log.location_context && !isUuidLike(log.location_context) ? ` · 위치: ${log.location_context}` : ''}
                                </div>
                            </div>
                            <span className="text-xs text-slate-500">{new Date(log.created_at).toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            {renderActionChip(log.action)}
                            <span className="text-xs text-slate-600 dark:text-slate-300">
                                작업자: {log.actor_name || '알 수 없음'}
                            </span>
                        </div>

                        {getChangedFields(log).length > 0 && (
                            <div className="mt-1 bg-slate-50 dark:bg-slate-900 p-2 rounded text-xs">
                                <div className="font-medium text-slate-700 dark:text-slate-300 mb-1">변경 요약</div>
                                {getChangedFields(log).map((line, index) => (
                                    <div key={index} className="text-slate-600 dark:text-slate-300">{line}</div>
                                ))}
                            </div>
                        )}

                        <button
                            onClick={() => toggleExpand(log.id)}
                            className="text-xs text-blue-600 hover:text-blue-700 w-fit"
                        >
                            {expandedLogIds[log.id] ? '원본 상세 숨기기' : '원본 상세 보기'}
                        </button>

                        {expandedLogIds[log.id] && (
                            <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-2">
                                <div className="bg-slate-50 dark:bg-slate-900 p-2 rounded text-[11px]">
                                    <div className="font-semibold text-slate-700 dark:text-slate-300 mb-1">Before</div>
                                    <pre className="text-slate-600 dark:text-slate-400 whitespace-pre-wrap max-h-36 overflow-y-auto">
                                        {JSON.stringify(log.before_data, null, 2)}
                                    </pre>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-900 p-2 rounded text-[11px]">
                                    <div className="font-semibold text-slate-700 dark:text-slate-300 mb-1">After</div>
                                    <pre className="text-slate-600 dark:text-slate-400 whitespace-pre-wrap max-h-36 overflow-y-auto">
                                        {JSON.stringify(log.after_data, null, 2)}
                                    </pre>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
                {filteredLogs.length === 0 && (
                    <div className="text-center py-10 text-slate-500">
                        조건에 맞는 감사 로그가 없습니다.
                    </div>
                )}
            </div>
            {logs.length >= limit && (
                <button
                    onClick={() => setLimit(l => l + 50)}
                    className="w-full py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-blue-600 font-medium"
                >
                    더 보기
                </button>
            )}
        </div>
    );
};
