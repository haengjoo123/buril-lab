/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect } from 'react';
import { X, History, Loader2, User, PackagePlus, Trash2, AlertTriangle } from 'lucide-react';
import { cabinetService, type ActivityLog, type ActivityActionType } from '../../../services/cabinetService';
import { useTranslation } from 'react-i18next';

interface ActivityLogModalProps {
    isOpen: boolean;
    cabinetId: string;
    cabinetName: string;
    onClose: () => void;
}

const REASON_LABELS: Record<string, string> = {
    used: 'cabinet_dispose_reason_used',
    expired: 'cabinet_dispose_reason_expired',
    broken: 'cabinet_dispose_reason_broken',
    other: 'cabinet_dispose_reason_other',
};

type FilterType = 'all' | 'add' | 'remove' | 'clear_all';

export function ActivityLogModal({ isOpen, cabinetId, cabinetName, onClose }: ActivityLogModalProps) {
    const { t } = useTranslation();
    const [logs, setLogs] = useState<ActivityLog[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [filter, setFilter] = useState<FilterType>('all');

    useEffect(() => {
        if (isOpen && cabinetId) {
            setIsLoading(true);
            cabinetService.getActivityLogs(cabinetId)
                .then(data => setLogs(data))
                .catch(err => console.error('Failed to load activity logs:', err))
                .finally(() => setIsLoading(false));
        }
    }, [isOpen, cabinetId]);

    if (!isOpen) return null;

    const filteredLogs = filter === 'all' ? logs : logs.filter(l => l.action_type === filter);

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const getReasonLabel = (reason?: string) => {
        if (!reason) return null;
        const key = REASON_LABELS[reason];
        return key ? t(key) : reason;
    };

    const getActionConfig = (action: ActivityActionType) => {
        switch (action) {
            case 'add':
                return {
                    icon: <PackagePlus size={14} className="text-emerald-600" />,
                    label: t('activity_log_action_add'),
                    chipStyle: 'bg-emerald-100 text-emerald-700',
                    rowStyle: 'border-l-2 border-emerald-400',
                };
            case 'remove':
                return {
                    icon: <Trash2 size={14} className="text-red-500" />,
                    label: t('activity_log_action_remove'),
                    chipStyle: 'bg-red-100 text-red-700',
                    rowStyle: 'border-l-2 border-red-400',
                };
            case 'clear_all':
                return {
                    icon: <AlertTriangle size={14} className="text-orange-500" />,
                    label: t('activity_log_action_clear_all'),
                    chipStyle: 'bg-orange-100 text-orange-700',
                    rowStyle: 'border-l-2 border-orange-400',
                };
        }
    };

    const FILTERS: { key: FilterType; label: string }[] = [
        { key: 'all', label: t('activity_log_filter_all') },
        { key: 'add', label: t('activity_log_action_add') },
        { key: 'remove', label: t('activity_log_action_remove') },
        { key: 'clear_all', label: t('activity_log_action_clear_all') },
    ];

    return (
        <div className="fixed inset-0 z-[100] flex items-end justify-center animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-white dark:bg-slate-800 rounded-t-2xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col animate-in slide-in-from-bottom duration-300">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-700 shrink-0">
                    <div className="flex items-center gap-2">
                        <History className="w-5 h-5 text-blue-500" />
                        <div>
                            <span className="font-semibold text-slate-800 dark:text-slate-100 text-sm">
                                {cabinetName}
                            </span>
                            <p className="text-xs text-slate-400 dark:text-slate-500">
                                {t('activity_log_title')}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 rounded-full text-gray-400 hover:bg-gray-200 dark:hover:bg-slate-700 hover:text-gray-600 transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Filter Tabs */}
                <div className="flex gap-1 px-4 pt-3 pb-2 shrink-0 overflow-x-auto">
                    {FILTERS.map(f => (
                        <button
                            key={f.key}
                            onClick={() => setFilter(f.key)}
                            className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${filter === f.key
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-600'
                                }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="overflow-y-auto px-4 pb-4 flex flex-col gap-2 flex-1">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                        </div>
                    ) : filteredLogs.length === 0 ? (
                        <p className="text-center text-slate-400 dark:text-slate-500 py-8 text-sm">
                            {t('activity_log_empty')}
                        </p>
                    ) : (
                        filteredLogs.map(log => {
                            const config = getActionConfig(log.action_type);
                            const reasonLabel = getReasonLabel(log.reason);
                            const displayName = log.performed_by_nickname || log.performed_by_email;
                            return (
                                <div
                                    key={log.id}
                                    className={`flex items-start gap-3 px-3 py-2.5 bg-slate-50 dark:bg-slate-700/50 rounded-lg pl-4 ${config.rowStyle}`}
                                >
                                    <div className="flex-1 min-w-0">
                                        {/* Action type + Item name */}
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 ${config.chipStyle}`}>
                                                {config.icon}
                                                {config.label}
                                            </span>
                                            <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                                                {/* clear_all은 여러 이름이 나열될 수 있어서 줄임 */}
                                                {log.action_type === 'clear_all'
                                                    ? (log.item_name.length > 60 ? log.item_name.slice(0, 57) + '...' : log.item_name)
                                                    : log.item_name
                                                }
                                            </span>
                                        </div>

                                        {/* Reason badge (삭제 사유) */}
                                        {reasonLabel && (
                                            <span className="inline-block mt-1 text-[10px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-600 px-1.5 py-0.5 rounded">
                                                {reasonLabel}
                                            </span>
                                        )}

                                        {/* Memo */}
                                        {log.memo && (
                                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                                                {log.memo}
                                            </p>
                                        )}

                                        {/* Performed by */}
                                        {displayName && (
                                            <div className="flex items-center gap-1 mt-1 text-xs text-slate-400 dark:text-slate-500">
                                                <User size={10} className="shrink-0" />
                                                <span className="truncate">{displayName}</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Date */}
                                    <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0 mt-0.5">
                                        {formatDate(log.performed_at)}
                                    </span>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Footer */}
                {!isLoading && filteredLogs.length > 0 && (
                    <div className="p-3 border-t border-gray-100 dark:border-slate-700 text-center shrink-0">
                        <span className="text-xs text-slate-400 dark:text-slate-500">
                            {t('activity_log_count', { count: filteredLogs.length })}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}
