import React, { useEffect, useState } from 'react';
import { Box, Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface CabinetFormDialogProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    description?: string;
    initialName?: string;
    initialLocation?: string;
    onConfirm: (name: string, location?: string) => void;
    isLoading?: boolean;
}

export function CabinetFormDialog({
    isOpen,
    onClose,
    title,
    description,
    initialName = '',
    initialLocation = '',
    onConfirm,
    isLoading = false
}: CabinetFormDialogProps) {
    const { t } = useTranslation();
    const [name, setName] = useState(initialName);
    const [location, setLocation] = useState(initialLocation);

    useEffect(() => {
        if (isOpen) {
            setName(initialName);
            setLocation(initialLocation);
        }
    }, [isOpen, initialName, initialLocation]);

    if (!isOpen) return null;

    const handleConfirm = () => {
        if (!name.trim()) return;
        onConfirm(name.trim(), location.trim() || undefined);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleConfirm();
        } else if (e.key === 'Escape') {
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
            <div
                className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
                onClick={e => e.stopPropagation()}
                onKeyDown={handleKeyDown}
            >
                <div className="p-6 pb-4">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-full text-blue-600 dark:text-blue-400">
                            <Box className="w-6 h-6" />
                        </div>
                        <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">{title}</h3>
                    </div>

                    {description && (
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 pl-11 mb-4">
                            {description}
                        </p>
                    )}

                    <div className="space-y-4 mt-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                {t('cabinet_form_name_label')} <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={t('cabinet_form_name_placeholder')}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 dark:text-slate-100 placeholder-slate-400"
                                autoFocus
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                {t('cabinet_form_location_label')}
                            </label>
                            <input
                                type="text"
                                value={location}
                                onChange={(e) => setLocation(e.target.value)}
                                placeholder={t('cabinet_form_location_placeholder')}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 dark:text-slate-100 placeholder-slate-400"
                            />
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3 px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
                    <button
                        onClick={onClose}
                        disabled={isLoading}
                        className="flex-1 px-4 py-2.5 rounded-xl font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        <X className="w-4 h-4" />
                        {t('btn_cancel')}
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!name.trim() || isLoading}
                        className="flex-1 px-4 py-2.5 rounded-xl font-medium text-white flex items-center justify-center gap-2 transition-transform active:scale-95 bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-200 dark:shadow-blue-900/20 disabled:opacity-50 disabled:active:scale-100"
                    >
                        <Check className="w-4 h-4" />
                        {isLoading ? t('btn_saving') : t('btn_confirm')}
                    </button>
                </div>
            </div>
        </div>
    );
}
