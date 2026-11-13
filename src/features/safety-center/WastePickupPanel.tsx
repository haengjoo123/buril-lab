import React, { useEffect, useState } from 'react';
import { Loader2, MapPin, Truck } from 'lucide-react';
import { safetyCenterService } from '../../services/safetyCenterService';
import { wasteStreamLabel } from '../../utils/wasteLabels';
import { containerCopy, containerStatusLabel } from '../wasteContainers/copy';
import { formatLabelDate } from '../wasteContainers/containerLabel';
import { formatVolumeMl } from '../wasteContainers/containerSummary';
import type { SafetyCenterWastePickup } from './types';

interface WastePickupPanelProps {
    centerId: string;
    language: string;
}

type PanelState =
    | { status: 'loading' }
    | { status: 'failed' }
    | { status: 'ready'; pickups: SafetyCenterWastePickup[] };

/** Containers that linked labs asked this center to collect. Read-only: the lab records the collection. */
export const WastePickupPanel: React.FC<WastePickupPanelProps> = ({ centerId, language }) => {
    const copy = containerCopy(language);
    const [loaded, setLoaded] = useState<{ centerId: string; state: PanelState } | null>(null);

    useEffect(() => {
        let cancelled = false;
        safetyCenterService.getWastePickups(centerId)
            .then((pickups) => {
                if (!cancelled) setLoaded({ centerId, state: { status: 'ready', pickups } });
            })
            .catch((error) => {
                console.error('Failed to load waste pickup requests:', error);
                if (!cancelled) setLoaded({ centerId, state: { status: 'failed' } });
            });
        return () => {
            cancelled = true;
        };
    }, [centerId]);

    const state: PanelState = loaded?.centerId === centerId ? loaded.state : { status: 'loading' };

    return (
        <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                <Truck className="h-4 w-4" aria-hidden="true" />
                {copy.centerPickupTitle}
                {state.status === 'ready' && state.pickups.length > 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                        {state.pickups.length}
                    </span>
                )}
            </h3>
            <p className="mt-1 break-keep text-xs text-slate-500 dark:text-slate-400">{copy.centerPickupHelp}</p>

            {state.status === 'loading' && (
                <p className="mt-3 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400" role="status">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {copy.centerPickupLoading}
                </p>
            )}
            {state.status === 'failed' && (
                <p className="mt-3 break-keep text-sm text-red-600 dark:text-red-400" role="alert">{copy.centerPickupFailed}</p>
            )}
            {state.status === 'ready' && state.pickups.length === 0 && (
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{copy.centerPickupEmpty}</p>
            )}
            {state.status === 'ready' && state.pickups.length > 0 && (
                <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                    {state.pickups.map((pickup) => (
                        <li key={pickup.container_id} className="py-3 first:pt-0 last:pb-0">
                            <p className="break-words text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {pickup.lab_name} · {pickup.label}
                            </p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                                <span>{wasteStreamLabel(pickup.stream_code, language)}</span>
                                <span>{containerStatusLabel(pickup.status, language)}</span>
                                <span>{copy.pickupRequested(formatLabelDate(pickup.pickup_requested_at))}</span>
                                <span>
                                    {copy.recorded} {formatVolumeMl(Number(pickup.total_ml) || 0)}
                                    {pickup.capacity_ml ? ` / ${formatVolumeMl(Number(pickup.capacity_ml))}` : ''}
                                    {pickup.has_unknown_amounts ? ' +' : ''}
                                </span>
                                {pickup.location && (
                                    <span className="inline-flex min-w-0 items-center gap-1">
                                        <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                                        <span className="min-w-0 break-words">{pickup.location}</span>
                                    </span>
                                )}
                            </p>
                            {pickup.pickup_request_note && (
                                <p className="mt-1 break-words text-sm text-slate-600 dark:text-slate-300">{pickup.pickup_request_note}</p>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
};
