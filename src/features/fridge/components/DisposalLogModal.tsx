import { useState, useEffect } from 'react';
import { X, History, Loader2, User } from 'lucide-react';
import { cabinetService, type DisposalLog } from '../../../services/cabinetService';
import { useTranslation } from 'react-i18next';

interface DisposalLogModalProps {
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

export function DisposalLogModal({ isOpen, cabinetId, cabinetName, onClose }: DisposalLogModalProps) {
    const { t } = useTranslation();
    const [logs, setLogs] = useState<DisposalLog[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (isOpen && cabinetId) {
            setIsLoading(true);
            cabinetService.getDisposalLogs(cabinetId)
                .then(data => setLogs(data))
                .catch(err => console.error('Failed to load disposal logs:', err))
                .finally(() => setIsLoading(false));
        }
    }, [isOpen, cabinetId]);

    if (!isOpen) return null;

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
    };

    const getReasonLabel = (reason: string) => {
        const key = REASON_LABELS[reason];
        return key ? t(key) : reason;
    };

    const getReasonColor = (reason: string) => {
        switch (reason) {
            case 'used': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
            case 'expired': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
            case 'broken': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
            default: return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-end justify-center animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-white dark:bg-slate-800 rounded-t-2xl shadow-xl w-full max-w-md max-h-[70vh] flex flex-col animate-in slide-in-from-bottom duration-300">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-700 shrink-0">
                    <div className="flex items-center gap-2">
                        <History className="w-5 h-5 text-orange-500" />
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                            {cabinetName} {t('cabinet_dispose_log_title')}
                        </span>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 rounded-full text-gray-400 hover:bg-gray-200 dark:hover:bg-slate-700 hover:text-gray-600 transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div className="overflow-y-auto p-4 flex flex-col gap-2">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                        </div>
                    ) : logs.length === 0 ? (
                        <p className="text-center text-slate-400 dark:text-slate-500 py-8">
                            {t('cabinet_dispose_log_empty')}
                        </p>
                    ) : (
                        logs.map(log => (
                            <div
                                key={log.id}
                                className="flex items-center gap-3 px-3 py-2.5 bg-slate-50 dark:bg-slate-700/50 rounded-lg"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                                            {log.item_name}
                                        </span>
                                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md shrink-0 ${getReasonColor(log.reason)}`}>
                                            {getReasonLabel(log.reason)}
                                        </span>
                                    </div>
                                    {log.memo && (
                                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                                            {log.memo}
                                        </p>
                                    )}
                                    {(log.disposed_by_nickname || log.disposed_by_email) && (
                                        <div className="flex items-center gap-1 mt-1 text-xs text-slate-400 dark:text-slate-500 truncate">
                                            <User size={12} className="shrink-0" />
                                            <span>{log.disposed_by_nickname || log.disposed_by_email}</span>
                                        </div>
                                    )}
                                </div>
                                <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">
                                    {formatDate(log.disposed_at)}
                                </span>
                            </div>
                        ))
                    )}
                </div>

                {/* Footer */}
                {!isLoading && logs.length > 0 && (
                    <div className="p-3 border-t border-gray-100 dark:border-slate-700 text-center shrink-0">
                        <span className="text-xs text-slate-400 dark:text-slate-500">
                            {t('cabinet_dispose_log_count', { count: logs.length })}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}
