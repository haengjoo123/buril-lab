import React from 'react';
import { FILL_WARNING_RATIO, formatVolumeMl } from './containerSummary';
import { containerCopy } from './copy';

interface ContainerFillBarProps {
    totalMl: number;
    capacityMl: number | null;
    hasUnknownAmounts: boolean;
    language: string;
    /** Smaller text for list cards. */
    compact?: boolean;
}

/** Recorded volume against capacity. Without a capacity it shows the volume only. */
export const ContainerFillBar: React.FC<ContainerFillBarProps> = ({ totalMl, capacityMl, hasUnknownAmounts, language, compact }) => {
    const copy = containerCopy(language);
    const textSize = compact ? 'text-xs' : 'text-sm';
    const volumeText = `${formatVolumeMl(totalMl)}${hasUnknownAmounts ? '+' : ''}`;
    if (!capacityMl) {
        return (
            <span className={`block ${textSize} text-slate-600 dark:text-slate-300`}>
                {copy.recorded} <span className="font-semibold text-slate-800 dark:text-slate-100">{volumeText}</span>
            </span>
        );
    }
    const ratio = totalMl / capacityMl;
    const percent = Math.round(ratio * 100);
    const over = ratio > 1;
    const warn = !over && ratio >= FILL_WARNING_RATIO;
    const tone = over ? 'bg-red-500' : warn ? 'bg-amber-500' : 'bg-blue-600';
    const toneText = over ? 'text-red-600 dark:text-red-400' : warn ? 'text-amber-700 dark:text-amber-300' : 'text-slate-600 dark:text-slate-300';
    const note = over ? copy.overCapacity : warn ? copy.nearlyFull : null;
    return (
        <span className="block">
            <span className={`flex items-baseline justify-between gap-3 ${textSize}`}>
                <span className="whitespace-nowrap text-slate-600 dark:text-slate-300">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">{volumeText}</span>
                    {' / '}{formatVolumeMl(capacityMl)}
                </span>
                <span className={`whitespace-nowrap font-semibold ${toneText}`}>
                    {note ? `${note} · ` : ''}{percent}%
                </span>
            </span>
            <span
                className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(percent, 100)}
                aria-label={copy.recorded}
            >
                <span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.min(ratio, 1) * 100}%` }} />
            </span>
        </span>
    );
};
