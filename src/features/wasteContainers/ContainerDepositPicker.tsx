import React from 'react';
import { AlertCircle, Check, Loader2, MapPin } from 'lucide-react';
import type { ContainerSelection } from './useContainerSelection';
import { containerCopy } from './copy';

interface ContainerDepositPickerProps {
    selection: ContainerSelection;
    language: string;
    disabled?: boolean;
}

/** Chooses which physical container a ready deposit goes into. Sits inside the cart's destination card. */
export const ContainerDepositPicker: React.FC<ContainerDepositPickerProps> = ({ selection, language, disabled }) => {
    const copy = containerCopy(language);
    if (!selection.enabled) return null;

    if (selection.loading) {
        return (
            <div className="flex items-center gap-2 rounded-xl bg-white/60 p-3 text-sm dark:bg-slate-900/30">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                {copy.pickerLoading}
            </div>
        );
    }

    if (selection.loadFailed) {
        return (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100" role="status">
                <p className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="break-keep">{copy.pickerLoadFailed}</span>
                </p>
                <button
                    type="button"
                    onClick={selection.refresh}
                    className="mt-2 inline-flex min-h-10 items-center rounded-xl border border-amber-300 bg-white px-3 text-sm font-medium text-amber-800 hover:bg-amber-50 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200"
                >
                    {copy.retry}
                </button>
            </div>
        );
    }

    if (selection.containers.length === 0) {
        return (
            <p className="break-keep rounded-xl bg-white/60 p-3 text-sm text-slate-600 dark:bg-slate-900/30 dark:text-slate-300">
                {copy.pickerNone}
            </p>
        );
    }

    return (
        <div className="rounded-xl bg-white/60 p-3 dark:bg-slate-900/30" role="radiogroup" aria-label={copy.pickerTitle}>
            <p className="text-xs font-semibold uppercase tracking-wide opacity-65">{copy.pickerTitle}</p>
            {selection.needsChoice && (
                <p className="mt-1 break-keep text-sm font-semibold text-amber-800 dark:text-amber-200">{copy.pickerChoose}</p>
            )}
            <div className="mt-2 grid gap-2">
                {selection.containers.map((container) => {
                    const checked = selection.selectedId === container.id;
                    return (
                        <button
                            key={container.id}
                            type="button"
                            role="radio"
                            aria-checked={checked}
                            disabled={disabled}
                            onClick={() => selection.select(container.id)}
                            className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${checked
                                ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30'
                                : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'}`}
                        >
                            <span className="min-w-0 flex-1">
                                <span className="block break-words text-sm font-semibold text-slate-900 dark:text-white">{container.label}</span>
                                {container.location && (
                                    <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                        <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                                        <span className="min-w-0 truncate">{container.location}</span>
                                    </span>
                                )}
                            </span>
                            <span
                                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${checked
                                    ? 'border-blue-600 bg-blue-600 text-white'
                                    : 'border-slate-300 dark:border-slate-600'}`}
                                aria-hidden="true"
                            >
                                {checked && <Check className="h-3.5 w-3.5" />}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
