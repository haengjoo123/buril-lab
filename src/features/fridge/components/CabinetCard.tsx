import React from 'react';
import { Trash2, Edit2, MapPin, Camera, ClipboardList, History } from 'lucide-react';
import type { Cabinet } from '../../../services/cabinetService';
import { useTranslation } from 'react-i18next';

interface CabinetCardProps {
    cabinet: Cabinet;
    onClick: () => void;
    onEdit?: (e: React.MouseEvent) => void;
    onDelete?: (e: React.MouseEvent) => void;
    onImageClick?: (e: React.MouseEvent) => void;
    onInventory?: (e: React.MouseEvent) => void;
    onDisposalLog?: (e: React.MouseEvent) => void;
}

export function CabinetCard({ cabinet, onClick, onEdit, onDelete, onImageClick, onInventory, onDisposalLog }: CabinetCardProps) {
    const { t } = useTranslation();
    const formattedDate = new Date(cabinet.created_at).toLocaleDateString();

    const handleImageClick = (e: React.MouseEvent) => {
        if (onImageClick) {
            onImageClick(e);
        }
    };

    return (
        <div
            onClick={onClick}
            className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all cursor-pointer group hover:border-blue-300 dark:hover:border-blue-700 flex flex-col gap-3"
        >
            {/* Top: Image + Info */}
            <div className="flex items-center gap-3">
                <div
                    className="relative w-14 h-14 shrink-0 rounded-xl overflow-hidden cursor-pointer group/image"
                    onClick={handleImageClick}
                    title={t('cabinet_card_change_photo')}
                >
                    {cabinet.image_url ? (
                        <>
                            <img src={cabinet.image_url} alt={cabinet.name} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/image:opacity-100 transition-opacity">
                                <Camera className="w-6 h-6 text-white" />
                            </div>
                        </>
                    ) : (
                        <div className="w-full h-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-400 dark:text-slate-500 group-hover/image:bg-slate-200 dark:group-hover/image:bg-slate-600 transition-colors">
                            <Camera className="w-6 h-6" />
                        </div>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-base group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors flex items-center gap-2 flex-wrap">
                        <span className="truncate">{cabinet.name}</span>
                        {cabinet.location && (
                            <span className="text-xs font-normal px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-md flex items-center gap-1 shrink-0">
                                <MapPin className="w-3 h-3" />
                                {cabinet.location}
                            </span>
                        )}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {t('cabinet_card_size', { width: cabinet.width, height: cabinet.height, date: formattedDate })}
                    </p>
                </div>
            </div>

            {/* Bottom: Action Buttons */}
            {(onEdit || onDelete || onInventory || onDisposalLog) && (
                <div className="flex items-center justify-end gap-1 border-t border-gray-100 dark:border-slate-700 pt-2 -mb-1">
                    {onInventory && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onInventory(e); }}
                            className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors flex items-center gap-1"
                            title="시약 재고 목록"
                        >
                            <ClipboardList className="w-4 h-4" />
                            <span>재고</span>
                        </button>
                    )}
                    {onDisposalLog && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onDisposalLog(e); }}
                            className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded-lg transition-colors flex items-center gap-1"
                            title={t('cabinet_dispose_log_btn')}
                        >
                            <History className="w-4 h-4" />
                            <span>{t('cabinet_dispose_log_btn')}</span>
                        </button>
                    )}
                    {onEdit && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onEdit(e); }}
                            className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors flex items-center gap-1"
                            title={t('cabinet_card_edit')}
                        >
                            <Edit2 className="w-4 h-4" />
                            <span>{t('cabinet_card_edit')}</span>
                        </button>
                    )}
                    {onDelete && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onDelete(e); }}
                            className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors flex items-center gap-1"
                            title={t('cabinet_card_delete')}
                        >
                            <Trash2 className="w-4 h-4" />
                            <span>{t('cabinet_card_delete')}</span>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
