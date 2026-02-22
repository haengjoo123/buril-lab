import React, { useEffect, useRef } from 'react';
import { AlertCircle, Check, X } from 'lucide-react';

interface DialogProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    description?: string;
    type?: 'alert' | 'confirm' | 'prompt';
    // For prompt
    inputValue?: string;
    onInputChange?: (val: string) => void;
    inputPlaceholder?: string;
    // Buttons
    confirmText?: string;
    cancelText?: string;
    onConfirm?: () => void;
    // Styling
    isDestructive?: boolean;
}

export function CustomDialog({
    isOpen,
    onClose,
    title,
    description,
    type = 'alert',
    inputValue,
    onInputChange,
    inputPlaceholder,
    confirmText = '확인',
    cancelText = '취소',
    onConfirm,
    isDestructive = false
}: DialogProps) {
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen && type === 'prompt') {
            // setTimeout to ensure it focuses after the modal transition
            setTimeout(() => {
                inputRef.current?.focus();
            }, 100);
        }
    }, [isOpen, type]);

    if (!isOpen) return null;

    const handleConfirm = () => {
        if (onConfirm) onConfirm();
        else onClose();
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
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal Box */}
            <div
                className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
                onClick={e => e.stopPropagation()}
                onKeyDown={handleKeyDown}
            >
                {/* Header Icon & Title */}
                <div className="p-6 pb-4">
                    <div className="flex items-center gap-3 mb-2">
                        {isDestructive ? (
                            <div className="bg-red-100 dark:bg-red-900/30 p-2 rounded-full text-red-600 dark:text-red-400">
                                <AlertCircle className="w-6 h-6" />
                            </div>
                        ) : (
                            <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-full text-blue-600 dark:text-blue-400">
                                <Check className="w-6 h-6" />
                            </div>
                        )}
                        <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">{title}</h3>
                    </div>

                    {description && (
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 pl-11">
                            {description}
                        </p>
                    )}

                    {type === 'prompt' && (
                        <div className="mt-4">
                            <input
                                ref={inputRef}
                                type="text"
                                value={inputValue || ''}
                                onChange={(e) => onInputChange?.(e.target.value)}
                                placeholder={inputPlaceholder}
                                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 dark:text-slate-100 placeholder-slate-400"
                            />
                        </div>
                    )}
                </div>

                {/* Footer Buttons */}
                <div className="flex items-center gap-3 px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
                    {type !== 'alert' && (
                        <button
                            onClick={onClose}
                            className="flex-1 px-4 py-2.5 rounded-xl font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-2"
                        >
                            <X className="w-4 h-4" />
                            {cancelText}
                        </button>
                    )}
                    <button
                        onClick={handleConfirm}
                        className={`flex-1 px-4 py-2.5 rounded-xl font-medium text-white flex items-center justify-center gap-2 transition-transform active:scale-95 ${isDestructive
                            ? 'bg-red-600 hover:bg-red-700 shadow-md shadow-red-200 dark:shadow-red-900/20'
                            : 'bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-200 dark:shadow-blue-900/20'
                            }`}
                    >
                        {type === 'prompt' && !isDestructive && <Check className="w-4 h-4" />}
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}
