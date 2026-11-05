import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface SegmentedControlOption<T extends string> {
    value: T;
    label: ReactNode;
    icon?: ReactNode;
    /** Tooltip / accessible fallback when the visible label may be truncated. */
    title?: string;
    /** `success` marks a mode that changes what a tap does (e.g. placing items). */
    tone?: 'default' | 'success';
}

interface SegmentedControlProps<T extends string> {
    value: T;
    options: ReadonlyArray<SegmentedControlOption<T>>;
    onChange: (value: T) => void;
    ariaLabel: string;
    /**
     * `tabs` switches the panel below it (tablist). `radio` picks one mode for
     * the same surface (radiogroup). Both support arrow-key navigation.
     */
    semantics?: 'tabs' | 'radio';
    size?: 'md' | 'sm';
    /** `floating` sits on top of a canvas or image and needs its own shadow. */
    appearance?: 'default' | 'floating';
    fullWidth?: boolean;
    className?: string;
    onboardingTarget?: string;
}

const joinClasses = (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(' ');

/**
 * One segmented control for every in-page tab or mode switch.
 *
 * Each segment is a 44px-tall hit area whose visible pill is inset by 4px, so
 * the track stays 44px tall on touch devices instead of growing to 52px once
 * the global 44px touch-target rule applies to the buttons.
 */
export function SegmentedControl<T extends string>({
    value,
    options,
    onChange,
    ariaLabel,
    semantics = 'tabs',
    size = 'md',
    appearance = 'default',
    fullWidth = false,
    className,
    onboardingTarget,
}: SegmentedControlProps<T>) {
    const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const isTabs = semantics === 'tabs';

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const currentIndex = options.findIndex((option) => option.value === value);
        if (currentIndex < 0) return;
        const lastIndex = options.length - 1;
        let nextIndex: number | null = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = lastIndex;
        if (nextIndex === null) return;
        event.preventDefault();
        onChange(options[nextIndex].value);
        buttonRefs.current[nextIndex]?.focus();
    };

    return (
        <div
            role={isTabs ? 'tablist' : 'radiogroup'}
            aria-label={ariaLabel}
            aria-orientation={isTabs ? 'horizontal' : undefined}
            data-onboarding-target={onboardingTarget}
            onKeyDown={handleKeyDown}
            className={joinClasses(
                fullWidth ? 'flex w-full' : 'inline-flex max-w-full',
                'min-w-0 rounded-xl',
                appearance === 'floating'
                    ? 'pointer-events-auto bg-slate-100/90 shadow-md ring-1 ring-slate-200 backdrop-blur dark:bg-slate-800/90 dark:ring-slate-700'
                    : 'bg-slate-100 dark:bg-slate-800',
                className,
            )}
        >
            {options.map((option, index) => {
                const isActive = option.value === value;
                const isSuccess = option.tone === 'success';
                return (
                    <button
                        key={option.value}
                        ref={(element) => { buttonRefs.current[index] = element; }}
                        type="button"
                        role={isTabs ? 'tab' : 'radio'}
                        aria-selected={isTabs ? isActive : undefined}
                        aria-checked={isTabs ? undefined : isActive}
                        tabIndex={isActive ? 0 : -1}
                        title={option.title}
                        onClick={() => onChange(option.value)}
                        className={joinClasses(
                            'group flex h-11 min-w-0 items-center justify-center rounded-xl p-1',
                            fullWidth && 'flex-1',
                        )}
                    >
                        <span
                            className={joinClasses(
                                'flex h-full w-full min-w-0 items-center justify-center gap-1.5 rounded-lg font-semibold whitespace-nowrap transition-colors',
                                size === 'sm' ? 'px-2.5 text-xs' : 'px-3 text-sm',
                                isActive
                                    ? joinClasses(
                                        'bg-white shadow-sm ring-1 ring-slate-900/5 dark:bg-slate-600 dark:ring-white/10',
                                        isSuccess ? 'text-emerald-700 dark:text-emerald-200' : 'text-slate-900 dark:text-white',
                                    )
                                    : 'text-slate-500 group-hover:text-slate-900 dark:text-slate-400 dark:group-hover:text-slate-100',
                            )}
                        >
                            {option.icon && <span aria-hidden="true" className="flex shrink-0 items-center">{option.icon}</span>}
                            <span className="min-w-0 truncate">{option.label}</span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
