import React, { useEffect, useRef, useState } from 'react';
import { Trash2, Edit2, MapPin, Camera, ClipboardList, History, ArrowRight, MoreVertical } from 'lucide-react';
import type { Cabinet } from '../../../services/cabinetService';
import { useTranslation } from 'react-i18next';

interface CabinetCardProps {
    cabinet: Cabinet;
    isSelected?: boolean;
    onClick: () => void;
    onEdit?: (e: React.MouseEvent) => void;
    onDelete?: (e: React.MouseEvent) => void;
    onImageClick?: (e: React.MouseEvent) => void;
    onInventory?: (e: React.MouseEvent) => void;
    onDisposalLog?: (e: React.MouseEvent) => void;
    onManage?: (e: React.MouseEvent) => void;
    inventoryCount?: number;
    historyCount?: number;
}

export function CabinetCard({
    cabinet,
    isSelected = false,
    onClick,
    onEdit,
    onDelete,
    onImageClick,
    onInventory,
    onDisposalLog,
    onManage,
    inventoryCount = 0,
    historyCount = 0,
}: CabinetCardProps) {
    const { t, i18n } = useTranslation();
    const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
    const actionMenuRef = useRef<HTMLDivElement>(null);
    const formattedDate = new Date(cabinet.created_at).toLocaleDateString(i18n.language.startsWith('ko') ? 'ko-KR' : 'en-US');
    const hasOverflowActions = Boolean(onEdit || onDelete);
    const isKorean = i18n.language.startsWith('ko');
    const inventoryCountLabel = isKorean ? `${inventoryCount}개` : `${inventoryCount} item${inventoryCount === 1 ? '' : 's'}`;
    const historyCountLabel = isKorean ? `${historyCount}건` : `${historyCount} record${historyCount === 1 ? '' : 's'}`;

    useEffect(() => {
        if (!isActionMenuOpen) return;

        const handlePointerDown = (event: PointerEvent) => {
            if (event.target instanceof Node && actionMenuRef.current?.contains(event.target)) {
                return;
            }
            setIsActionMenuOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsActionMenuOpen(false);
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isActionMenuOpen]);

    const handleImageClick = (e: React.MouseEvent) => {
        if (onImageClick) {
            onImageClick(e);
        }
    };

    return (
        <div
            onClick={onClick}
            className={`relative flex min-w-0 cursor-pointer gap-3 overflow-visible rounded-2xl border bg-white p-4 shadow-sm transition-all group dark:bg-slate-800 lg:grid lg:min-h-[148px] lg:grid-cols-[168px_minmax(0,1fr)] lg:items-stretch lg:gap-0 lg:p-0 ${
                isSelected
                    ? 'border-blue-500 shadow-md shadow-blue-950/5 ring-1 ring-blue-100 dark:border-blue-700 dark:ring-blue-900/30'
                    : 'border-gray-200 hover:border-blue-300 hover:shadow-md dark:border-slate-700 dark:hover:border-blue-700'
            }`}
        >
            <div
                className="relative min-h-[112px] w-20 shrink-0 self-stretch cursor-pointer overflow-hidden rounded-xl bg-slate-100 group/image dark:bg-slate-700 lg:h-auto lg:min-h-[148px] lg:w-full lg:rounded-none lg:rounded-l-2xl lg:border-r lg:border-slate-100 dark:lg:border-slate-700"
                onClick={handleImageClick}
                title={t('cabinet_card_change_photo')}
            >
                {cabinet.image_url ? (
                    <>
                        <img src={cabinet.image_url} alt={cabinet.name} className="absolute inset-0 h-full w-full object-cover" />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover/image:opacity-100">
                            <Camera className="h-6 w-6 text-white" />
                        </div>
                    </>
                ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-400 transition-colors group-hover/image:bg-slate-200 dark:text-slate-500 dark:group-hover/image:bg-slate-600">
                        <Camera className="h-6 w-6 lg:h-8 lg:w-8" />
                    </div>
                )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-3 lg:p-4">
                <div className="flex min-w-0 items-start gap-3">
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (onManage) {
                                onManage(e);
                                return;
                            }
                            onClick();
                        }}
                        className="group/title min-w-0 flex-1 overflow-hidden rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800"
                        aria-label={`${cabinet.name} ${t('cabinet_manage')}`}
                    >
                        <h3 className="flex min-w-0 flex-wrap items-center gap-2 text-base font-semibold text-slate-900 transition-colors group-hover/title:text-blue-600 dark:text-slate-100 dark:group-hover/title:text-blue-400">
                            <span className="min-w-0 truncate">{cabinet.name}</span>
                            {cabinet.location && (
                                <span className="flex shrink-0 items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                                    <MapPin className="h-3 w-3" />
                                    {cabinet.location}
                                </span>
                            )}
                        </h3>
                        <p
                            className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400"
                            title={t('cabinet_card_size', { width: cabinet.width, height: cabinet.height, date: formattedDate })}
                        >
                            {t('cabinet_card_size', { width: cabinet.width, height: cabinet.height, date: formattedDate })}
                        </p>
                    </button>

                    {hasOverflowActions && (
                        <div ref={actionMenuRef} className="relative shrink-0">
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsActionMenuOpen((current) => !current);
                                }}
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                                aria-label={t('cabinet_card_actions', '시약장 작업')}
                                aria-haspopup="menu"
                                aria-expanded={isActionMenuOpen}
                            >
                                <MoreVertical className="h-5 w-5" />
                            </button>

                            {isActionMenuOpen && (
                                <div
                                    role="menu"
                                    className="absolute right-0 top-9 z-30 w-40 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg shadow-slate-950/10 dark:border-slate-700 dark:bg-slate-800"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    {onEdit && (
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setIsActionMenuOpen(false);
                                                onEdit(e);
                                            }}
                                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-slate-700 transition-colors hover:bg-blue-50 hover:text-blue-700 dark:text-slate-200 dark:hover:bg-blue-950/30 dark:hover:text-blue-300"
                                        >
                                            <Edit2 className="h-4 w-4" />
                                            {t('cabinet_card_edit')}
                                        </button>
                                    )}
                                    {onDelete && (
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setIsActionMenuOpen(false);
                                                onDelete(e);
                                            }}
                                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                            {t('cabinet_card_delete')}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {(onInventory || onDisposalLog || onManage) ? (
                    <div className="mt-auto grid gap-3 border-t border-gray-100 pt-3 dark:border-slate-700 lg:flex lg:items-center lg:justify-between">
                        <div className="grid min-w-0 flex-1 grid-cols-2 overflow-hidden rounded-lg border border-slate-100 bg-slate-50/70 divide-x divide-slate-200 dark:border-slate-700 dark:bg-slate-900/40 dark:divide-slate-700 lg:max-w-[360px]">
                            {onInventory && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onInventory(e); }}
                                    className="flex min-w-0 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/20"
                                    title={`${t('tab_inventory')} ${inventoryCountLabel}`}
                                    aria-label={`${t('tab_inventory')} ${inventoryCountLabel}`}
                                >
                                    <ClipboardList className="h-4 w-4 shrink-0 text-slate-500" />
                                    <span className="min-w-0">
                                        <span className="block truncate text-xs font-semibold text-slate-600 dark:text-slate-300">{t('tab_inventory')}</span>
                                        <span className="mt-0.5 block truncate text-xs font-bold text-slate-900 dark:text-slate-100">{inventoryCountLabel}</span>
                                    </span>
                                </button>
                            )}
                            {onDisposalLog && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onDisposalLog(e); }}
                                    className="flex min-w-0 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-orange-50 hover:text-orange-700 dark:hover:bg-orange-950/20"
                                    title={`${t('cabinet_dispose_log_btn')} ${historyCountLabel}`}
                                    aria-label={`${t('cabinet_dispose_log_btn')} ${historyCountLabel}`}
                                >
                                    <History className="h-4 w-4 shrink-0 text-slate-500" />
                                    <span className="min-w-0">
                                        <span className="block truncate text-xs font-semibold text-slate-600 dark:text-slate-300">
                                            <span className="sm:hidden">{t('cabinet_dispose_log_btn_short')}</span>
                                            <span className="hidden sm:inline">{t('cabinet_dispose_log_btn')}</span>
                                        </span>
                                        <span className="mt-0.5 block truncate text-xs font-bold text-slate-900 dark:text-slate-100">{historyCountLabel}</span>
                                    </span>
                                </button>
                            )}
                        </div>

                        {onManage && (
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onManage(e); }}
                                className={`hidden h-9 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold text-white transition-colors lg:inline-flex ${
                                    isSelected
                                        ? 'bg-blue-600 shadow-sm shadow-blue-600/20 hover:bg-blue-700'
                                        : 'bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white'
                                }`}
                                aria-label={t('cabinet_manage')}
                            >
                                {t('cabinet_manage')}
                                <ArrowRight className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
