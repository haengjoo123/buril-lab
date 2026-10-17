import React from 'react';
import type { WasteContainerStatus } from '../../services/wasteContainerService';
import { containerStatusLabel } from './copy';

/** Status pill in the same shape as the waste-log badges (rounded-full, 10–11px, ring). */
const STATUS_CHIP: Record<WasteContainerStatus, string> = {
    active: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/60',
    sealed: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/60',
    collected: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-600',
};

export const ContainerStatusChip: React.FC<{ status: WasteContainerStatus; language: string }> = ({ status, language }) => (
    <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${STATUS_CHIP[status]}`}>
        {containerStatusLabel(status, language)}
    </span>
);
