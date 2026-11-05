import { useEffect, useId, useRef, useState } from 'react';
import { Check, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SegmentedControl, type SegmentedControlOption } from './SegmentedControl';

interface LogFilterOption<T extends string> {
    value: T;
    label: string;
}

interface LogFilterMenuProps<R extends string> {
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
 * Period and sort for the waste log list behind one compact button, so the
 * search field keeps the rest of the row on narrow screens. The button still
 * shows the current period, and a dot marks a non-default sort order.
 */
export function LogFilterMenu<R extends string>({ range, sort }: LogFilterMenuProps<R>) {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const panelId = useId();
    const sortHeadingId = useId();
    const isSortCustomized = sort.value !== sort.defaultValue;
    const sortLabel = sort.options.find((option) => option.value === sort.value)?.label ?? '';

    useEffect(() => {
        if (!isOpen) return;
        const onPointerDown = (event: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [isOpen]);

    const summary = [range?.buttonLabel, sortLabel].filter(Boolean).join(', ');

    return (
        <div ref={rootRef} className="relative shrink-0">
            <button
                type="button"
                onClick={() => setIsOpen((open) => !open)}
                aria-expanded={isOpen}
                aria-controls={isOpen ? panelId : undefined}
                aria-label={`${t('log_filter_button')}: ${summary}`}
                title={`${t('log_filter_button')}: ${summary}`}
                className={`relative flex h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-semibold shadow-sm transition-colors ${isOpen
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
                <div
                    id={panelId}
                    role="dialog"
                    aria-label={t('log_filter_button')}
                    className="absolute right-0 top-full z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-100 bg-white p-3 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.15)] animate-in fade-in zoom-in-95 duration-100 origin-top-right dark:border-slate-700 dark:bg-slate-800"
                >
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
            )}
        </div>
    );
}
