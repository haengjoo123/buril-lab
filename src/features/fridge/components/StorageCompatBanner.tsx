/**
 * StorageCompatBanner
 * Compact pill for storage-compatibility problems in the current cabinet.
 * Expands into a per-shelf list; tapping a row collapses back to the pill
 * and brings the affected shelf into view.
 */
import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Layers, Loader2, ShieldAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFridgeStore } from '../../../store/fridgeStore';
import type {
    StorageReviewConflict,
    StorageWarning,
} from '../../../utils/storageCompatibilityChecker';

interface StorageCompatBannerProps {
    reopenToken?: number;
    warningMap: Map<string, StorageWarning[]>;
    /** Pairs whose GHS data is missing but whose names suggest a conflict. */
    reviewMap: Map<string, StorageReviewConflict[]>;
    onFocusIssue: (itemIds: string[]) => void;
    onAutoArrange?: () => void;
    isAutoArrangeBusy?: boolean;
}

type IssueKind = 'danger' | 'warning' | 'review';

interface IssueRow {
    key: string;
    kind: IssueKind;
    itemA: string;
    itemB: string;
    messageKey: string;
    itemIds: string[];
}

const KIND_STYLES: Record<IssueKind, { row: string; chip: string; icon: string }> = {
    danger: {
        row: 'bg-red-100/60 dark:bg-red-900/30',
        chip: 'bg-red-200 text-red-800 dark:bg-red-800 dark:text-red-200',
        icon: 'text-red-500',
    },
    warning: {
        row: 'bg-orange-100/60 dark:bg-orange-900/30',
        chip: 'bg-orange-200 text-orange-800 dark:bg-orange-800 dark:text-orange-100',
        icon: 'text-orange-500',
    },
    review: {
        row: 'border border-dashed border-amber-300 bg-amber-50/70 dark:border-amber-700 dark:bg-amber-950/30',
        chip: 'border border-amber-300 bg-white text-amber-700 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-300',
        icon: 'text-amber-500',
    },
};

const KIND_LABEL_KEYS: Record<IssueKind, string> = {
    danger: 'storage_compat_danger',
    warning: 'storage_compat_warning',
    review: 'storage_compat_review_needed',
};

export const StorageCompatBanner: React.FC<StorageCompatBannerProps> = ({
    reopenToken = 0,
    warningMap,
    reviewMap,
    onFocusIssue,
    onAutoArrange,
    isAutoArrangeBusy = false,
}) => {
    const { t } = useTranslation();
    const shelves = useFridgeStore(s => s.shelves);
    // Re-opening from the tray expands the list and undoes a dismiss.
    const [ui, setUi] = useState({ token: reopenToken, expanded: false, dismissed: false });
    if (ui.token !== reopenToken) {
        setUi({ token: reopenToken, expanded: true, dismissed: false });
    }

    const rowsByShelf = shelves
        .map(shelf => {
            const rows: IssueRow[] = [
                ...(warningMap.get(shelf.id) ?? []).map((warning, index) => ({
                    key: `w-${warning.ruleId}-${index}`,
                    kind: (warning.severity === 'DANGER' ? 'danger' : 'warning') as IssueKind,
                    itemA: warning.itemA,
                    itemB: warning.itemB,
                    messageKey: warning.messageKey,
                    itemIds: warning.itemIds,
                })),
                ...(reviewMap.get(shelf.id) ?? []).map((conflict, index) => ({
                    key: `r-${conflict.ruleId}-${index}`,
                    kind: 'review' as IssueKind,
                    itemA: conflict.itemA,
                    itemB: conflict.itemB,
                    messageKey: conflict.messageKey,
                    itemIds: conflict.itemIds,
                })),
            ];
            return { shelf, rows };
        })
        .filter(entry => entry.rows.length > 0);

    const counts: Record<IssueKind, number> = { danger: 0, warning: 0, review: 0 };
    rowsByShelf.forEach(entry => entry.rows.forEach(row => { counts[row.kind] += 1; }));
    const total = counts.danger + counts.warning + counts.review;

    if (total === 0 || ui.dismissed) return null;

    const tone: IssueKind = counts.danger > 0 ? 'danger' : counts.warning > 0 ? 'warning' : 'review';
    const shellClassName = {
        danger: 'bg-red-50/95 dark:bg-red-950/90 border-red-300 dark:border-red-800',
        warning: 'bg-orange-50/95 dark:bg-orange-950/90 border-orange-300 dark:border-orange-800',
        review: 'bg-amber-50/95 dark:bg-amber-950/90 border-dashed border-amber-300 dark:border-amber-700',
    }[tone];
    const titleClassName = {
        danger: 'text-red-800 dark:text-red-200',
        warning: 'text-orange-800 dark:text-orange-100',
        review: 'text-amber-800 dark:text-amber-200',
    }[tone];

    const toggleExpanded = () => setUi(current => ({ ...current, expanded: !current.expanded }));

    const handleRowClick = (row: IssueRow) => {
        setUi(current => ({ ...current, expanded: false }));
        onFocusIssue(row.itemIds);
    };

    return (
        <div className={`
            absolute top-16 left-1/2 -translate-x-1/2 z-30 pointer-events-none
            flex w-[360px] max-w-[calc(100vw-2rem)] justify-center
            animate-in fade-in slide-in-from-top-3 duration-300
        `}>
            <div className={`
                pointer-events-auto border shadow-lg backdrop-blur-md overflow-hidden
                ${ui.expanded ? 'w-full rounded-xl' : 'rounded-full'}
                ${shellClassName}
            `}>
                {/* Pill / header */}
                <div className="flex items-center">
                    <button
                        type="button"
                        onClick={toggleExpanded}
                        aria-expanded={ui.expanded}
                        className="flex min-h-10 min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 pr-1 text-left"
                    >
                        <ShieldAlert className={`h-4 w-4 shrink-0 ${KIND_STYLES[tone].icon}`} aria-hidden="true" />
                        <span className={`sr-only`}>{t('storage_compat_banner_title')}</span>
                        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                            {(['danger', 'warning', 'review'] as IssueKind[]).filter(kind => counts[kind] > 0).map(kind => (
                                <span key={kind} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-bold ${KIND_STYLES[kind].chip}`}>
                                    {t(KIND_LABEL_KEYS[kind])} {counts[kind]}
                                </span>
                            ))}
                        </span>
                        {ui.expanded
                            ? <ChevronUp className="ml-auto h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                            : <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                        }
                    </button>
                    <button
                        type="button"
                        onClick={() => setUi(current => ({ ...current, dismissed: true, expanded: false }))}
                        aria-label={t('btn_close')}
                        className="mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                    >
                        <X className="h-3.5 w-3.5 text-slate-400" />
                    </button>
                </div>

                {/* Expanded list */}
                {ui.expanded && (
                    <div className="border-t border-black/5 dark:border-white/5">
                        <div className="max-h-[38vh] overflow-y-auto px-3 pb-2">
                            {rowsByShelf.map(({ shelf, rows }) => (
                                <div key={shelf.id} className="mt-2.5">
                                    <div className={`mb-1.5 text-2xs font-bold ${titleClassName}`}>
                                        {t('storage_compat_shelf', { level: shelf.level + 1 })}
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        {rows.map(row => (
                                            <IssueRowButton key={row.key} row={row} onClick={() => handleRowClick(row)} />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                        {onAutoArrange && (
                            <div className="border-t border-black/5 p-2 dark:border-white/5">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setUi(current => ({ ...current, expanded: false }));
                                        onAutoArrange();
                                    }}
                                    disabled={isAutoArrangeBusy}
                                    className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isAutoArrangeBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />}
                                    {isAutoArrangeBusy ? t('cabinet_auto_place_loading') : t('cabinet_auto_place_button')}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

const IssueRowButton: React.FC<{ row: IssueRow; onClick: () => void }> = ({ row, onClick }) => {
    const { t } = useTranslation();
    const styles = KIND_STYLES[row.kind];

    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex min-h-11 w-full items-start gap-2 rounded-lg p-2 text-left text-xs transition-opacity hover:opacity-80 ${styles.row}`}
        >
            <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${styles.icon}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex min-w-0 items-center gap-1.5">
                    <span className={`shrink-0 rounded px-1.5 py-px text-3xs font-bold ${styles.chip}`}>
                        {t(KIND_LABEL_KEYS[row.kind])}
                    </span>
                    <span className="min-w-0 truncate font-semibold text-slate-700 dark:text-slate-200">
                        {row.itemA} ↔ {row.itemB}
                    </span>
                </div>
                <p className="line-clamp-2 leading-relaxed text-slate-600 dark:text-slate-300">
                    {t(row.messageKey)}
                </p>
            </div>
        </button>
    );
};
