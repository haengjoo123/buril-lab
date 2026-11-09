import { useEffect, useId, useRef, useState } from 'react';
import { Check, SlidersHorizontal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SegmentedControl, type SegmentedControlOption } from './SegmentedControl';
import { useAdaptiveDialog } from '../hooks/useAdaptiveDialog';

interface LogFilterOption<T extends string> {
    value: T;
    label: string;
}

interface LogFilterMenuProps<R extends string> {
    compact?: boolean;
    /** Omit to hide the period section (e.g. on the archive tab). */
    range?: {
        value: R;
        options: ReadonlyArray<SegmentedControlOption<R>>;
        onChange: (value: R) => void;
        /** Short label shown on the closed button, such as "30일". */
        buttonLabel: string;
    };
    sort: {
        value: string;
        options: ReadonlyArray<LogFilterOption<string>>;
        onChange: (value: string) => void;
        defaultValue: string;
    };
}

/**
 * The phone sheet keeps period and sort within reach; larger screens use a popover.
 * The trigger shows the period, with a dot for a non-default sort order.
 */
export function LogFilterMenu<R extends string>({ range, sort, compact = false }: LogFilterMenuProps<R>) {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    useAdaptiveDialog(panelRef, () => setIsOpen(false), isOpen);
    const panelId = useId();
    const sortHeadingId = useId();
    const isSortCustomized = sort.value !== sort.defaultValue;
    const sortLabel = sort.options.find((option) => option.value === sort.value)?.label ?? '';

    useEffect(() => {
        if (!isOpen) return;
        const onPointerDown = (event: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
        };
    }, [isOpen]);

    const summary = [range?.buttonLabel, sortLabel].filter(Boolean).join(', ');

    return (
        <div ref={rootRef} className="relative shrink-0">
            <button
                type="button"
                onClick={() => setIsOpen((open) => !open)}
                aria-expanded={isOpen}
                aria-haspopup="dialog"
                aria-controls={isOpen ? panelId : undefined}
                aria-label={`${t('log_filter_button')}: ${summary}`}
                title={`${t('log_filter_button')}: ${summary}`}
                className={`relative flex h-11 items-center justify-center gap-1.5 border transition-colors ${compact ? 'rounded-full px-2.5 text-xs font-medium' : 'rounded-lg px-3 text-sm font-semibold shadow-sm'} ${isOpen
                    ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-200'
                    : 'border-gray-200 bg-white text-slate-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                    }`}
            >
                <SlidersHorizontal aria-hidden="true" className="h-4 w-4 shrink-0" />
                {range && <span className="whitespace-nowrap">{range.buttonLabel}</span>}
                {isSortCustomized && (
                    <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-blue-600 ring-2 ring-white dark:ring-slate-800" />
                )}
            </button>

            {isOpen && (
                <div className={compact ? 'adaptive-overlay fixed z-[70] flex items-end justify-center' : 'absolute right-0 top-full z-50 mt-2 w-64 max-w-[calc(100vw-2rem)]'}>
                {compact && <div className="absolute inset-0 bg-slate-950/30" onClick={() => setIsOpen(false)} />}
                <div ref={panelRef} id={panelId}
                    role="dialog"
                    aria-modal="true"
                    tabIndex={-1}
                    aria-label={t('log_filter_button')}
                    className={compact
                        ? 'logs-filter-sheet relative max-h-full w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4 text-slate-900 shadow-xl dark:bg-slate-900 dark:text-slate-100'
                        : 'rounded-xl border border-gray-100 bg-white p-3 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.15)] dark:border-slate-700 dark:bg-slate-800'}
                >
                    {compact && <div className="mb-3 flex items-center justify-between pl-1">
                        <h3 className="text-base font-semibold">{t('log_filter_button')}</h3>
                        <button type="button" onClick={() => setIsOpen(false)} aria-label={t('btn_close')} className="flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={20} /></button>
                    </div>}
                    {range && (
                        <div className="mb-3">
                            <p className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">{t('log_range_label')}</p>
                            <SegmentedControl
                                semantics="radio"
                                size="sm"
                                fullWidth
                                ariaLabel={t('log_range_label')}
                                value={range.value}
                                options={range.options}
                                onChange={(value) => {
                                    range.onChange(value);
                                    setIsOpen(false);
                                }}
                            />
                        </div>
                    )}
                    <p id={sortHeadingId} className="mb-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{t('sort_by')}</p>
                    <div role="radiogroup" aria-labelledby={sortHeadingId} className="-mx-1 flex flex-col">
                        {sort.options.map((option) => {
                            const isSelected = option.value === sort.value;
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    role="radio"
                                    aria-checked={isSelected}
                                    onClick={() => {
                                        sort.onChange(option.value);
                                        setIsOpen(false);
                                    }}
                                    className={`flex h-11 items-center justify-between gap-2 rounded-lg px-2 text-left text-sm transition-colors ${isSelected
                                        ? 'font-semibold text-blue-700 dark:text-blue-300'
                                        : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/60'
                                        }`}
                                >
                                    <span className="min-w-0 truncate">{option.label}</span>
                                    {isSelected && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
                                </button>
                            );
                        })}
                    </div>
                </div>
                </div>
            )}
        </div>
    );
}
