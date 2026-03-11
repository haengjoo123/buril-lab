import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface AppSelectOption {
    value: string;
    label: React.ReactNode;
    disabled?: boolean;
}

interface AppSelectProps {
    value: string;
    options: AppSelectOption[];
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    size?: 'sm' | 'md';
    align?: 'left' | 'right';
    className?: string;
    buttonClassName?: string;
    menuClassName?: string;
}

const joinClasses = (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(' ');

export const AppSelect: React.FC<AppSelectProps> = ({
    value,
    options,
    onChange,
    placeholder,
    disabled = false,
    size = 'md',
    align = 'left',
    className,
    buttonClassName,
    menuClassName,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const selectedOption = useMemo(
        () => options.find((option) => option.value === value),
        [options, value]
    );

    useEffect(() => {
        if (disabled) {
            setIsOpen(false);
        }
    }, [disabled]);

    useEffect(() => {
        const handlePointerDown = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleEscape);
        };
    }, []);

    const sizeClasses = size === 'sm'
        ? 'min-h-[34px] px-3 py-1.5 text-xs rounded-lg'
        : 'min-h-[42px] px-3 py-2 text-sm rounded-xl';

    const iconSizeClasses = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

    return (
        <div ref={containerRef} className={joinClasses('relative', className)}>
            <button
                type="button"
                onClick={() => {
                    if (disabled) return;
                    setIsOpen((prev) => !prev);
                }}
                disabled={disabled}
                className={joinClasses(
                    'w-full border bg-white text-left text-slate-900 shadow-sm transition-all dark:bg-slate-800 dark:text-slate-100',
                    'border-slate-200 hover:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 dark:border-slate-600 dark:hover:border-emerald-500/70',
                    'flex items-center justify-between gap-2',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    sizeClasses,
                    buttonClassName
                )}
            >
                <span className="min-w-0 truncate">
                    {selectedOption?.label || placeholder || ''}
                </span>
                <ChevronDown className={joinClasses(iconSizeClasses, 'shrink-0 text-slate-400 transition-transform', isOpen && 'rotate-180')} />
            </button>

            {isOpen && !disabled && (
                <div
                    className={joinClasses(
                        'absolute top-full mt-2 min-w-full overflow-hidden border bg-white shadow-xl dark:bg-slate-800',
                        'border-slate-200 dark:border-slate-600',
                        'rounded-xl z-[120]',
                        align === 'right' ? 'right-0' : 'left-0',
                        menuClassName
                    )}
                >
                    {/* 스크롤 영역을 분리해 옵션이 많아도 버튼 높이를 건드리지 않도록 유지합니다. */}
                    <div className="max-h-64 overflow-y-auto py-1">
                        {options.map((option) => {
                            const isSelected = option.value === value;
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    disabled={option.disabled}
                                    onClick={() => {
                                        if (option.disabled) return;
                                        onChange(option.value);
                                        setIsOpen(false);
                                    }}
                                    className={joinClasses(
                                        'w-full px-3 py-2 text-left transition-colors',
                                        'flex items-center justify-between gap-2',
                                        size === 'sm' ? 'text-xs' : 'text-sm',
                                        isSelected
                                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                            : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/70',
                                        option.disabled && 'cursor-not-allowed opacity-50'
                                    )}
                                >
                                    <span className="min-w-0 truncate">{option.label}</span>
                                    {isSelected && <Check className={joinClasses(iconSizeClasses, 'shrink-0')} />}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default AppSelect;
