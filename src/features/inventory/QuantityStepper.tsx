import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Plus } from 'lucide-react';

interface QuantityStepperProps {
    value: number;
    onChange: (next: number) => void;
    min?: number;
    readOnly?: boolean;
    /** Lets a read-only stepper explain itself on tap (e.g. cabinet bottles are always 1). */
    onReadOnlyClick?: () => void;
    disabled?: boolean;
    id?: string;
    ariaLabel?: string;
    /** Size and shape; defaults to a 44px touch target. */
    className?: string;
}

/**
 * −/＋ quantity control. Typing is free-form (the field may be empty while the
 * user types "2" after clearing "1"); the value is clamped to `min` on blur.
 */
export const QuantityStepper: React.FC<QuantityStepperProps> = ({
    value,
    onChange,
    min = 1,
    readOnly = false,
    onReadOnlyClick,
    disabled = false,
    id,
    ariaLabel,
    className = 'h-11 rounded-lg',
}) => {
    const { t } = useTranslation();
    const [draft, setDraft] = useState<string | null>(null);
    const isLocked = readOnly || disabled;
    const display = draft ?? String(value);

    const commit = (next: number) => {
        onChange(Math.max(min, Math.round(next)));
    };

    const handleTextChange = (raw: string) => {
        const digits = raw.replace(/[^0-9]/g, '').slice(0, 6);
        setDraft(digits);
        if (!digits) return;
        const parsed = Number.parseInt(digits, 10);
        if (Number.isFinite(parsed) && parsed >= min) commit(parsed);
    };

    const handleBlur = () => {
        if (draft === null) return;
        const parsed = Number.parseInt(draft, 10);
        if (!Number.isFinite(parsed) || parsed < min) commit(min);
        setDraft(null);
    };

    const step = (delta: number) => {
        if (isLocked) {
            onReadOnlyClick?.();
            return;
        }
        setDraft(null);
        commit(value + delta);
    };

    const buttonClassName = 'flex w-11 shrink-0 items-center justify-center text-slate-500 transition-colors hover:bg-slate-50 active:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700 dark:active:bg-slate-600';

    return (
        <div
            className={`flex items-stretch overflow-hidden border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 ${isLocked ? 'opacity-70' : ''} ${className}`}
        >
            <button
                type="button"
                onClick={() => step(-1)}
                disabled={disabled || (!readOnly && value <= min)}
                aria-label={t('inventory_quantity_decrease')}
                className={buttonClassName}
            >
                <Minus className="h-4 w-4" />
            </button>
            <input
                id={id}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                enterKeyHint="done"
                autoComplete="off"
                value={display}
                onChange={(event) => handleTextChange(event.target.value)}
                onFocus={(event) => event.currentTarget.select()}
                onBlur={handleBlur}
                onClick={readOnly ? onReadOnlyClick : undefined}
                readOnly={readOnly}
                disabled={disabled}
                aria-label={ariaLabel ?? t('inventory_quantity')}
                className="w-full min-w-0 flex-1 bg-transparent text-center text-sm font-bold tabular-nums text-slate-900 focus:outline-none dark:text-slate-100"
            />
            <button
                type="button"
                onClick={() => step(1)}
                disabled={disabled}
                aria-label={t('inventory_quantity_increase')}
                className={buttonClassName}
            >
                <Plus className="h-4 w-4" />
            </button>
        </div>
    );
};
