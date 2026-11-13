import { useEffect, useMemo, useState } from 'react';
import { fetchWasteContainerDeposits } from '../../services/wasteContainerService';
import {
    checkContainerContents,
    type ContainerContentWarning,
    type IncomingWaste,
} from './containerContentCheck';
import { summarizeContainer, type ContainerComponentSummary } from './containerSummary';

export type ContainerContentCheck =
    | { status: 'off' }
    | { status: 'loading' }
    /** The records could not be read, so nothing was compared. */
    | { status: 'unavailable' }
    | {
        status: 'ready';
        warnings: ContainerContentWarning[];
        /** Distinct substances recorded in the container. */
        recordedCount: number;
        /** Only part of the deposit history was loaded. */
        truncated: boolean;
    };

interface LoadedContents {
    key: string;
    components: ContainerComponentSummary[] | null;
    truncated: boolean;
}

/**
 * Compares the waste about to be poured with the selected container's recorded
 * contents. `revision` changes when the container's records change (for
 * example its deposit count), so the contents are read again.
 */
export function useContainerContentCheck(
    enabled: boolean,
    containerId: string | null,
    revision: string | number,
    incoming: IncomingWaste,
): ContainerContentCheck {
    const [loaded, setLoaded] = useState<LoadedContents | null>(null);
    const active = enabled && Boolean(containerId);
    const key = `${containerId ?? ''}:${revision}`;

    useEffect(() => {
        if (!active || !containerId) return;
        let cancelled = false;
        fetchWasteContainerDeposits(containerId)
            .then((page) => {
                if (cancelled) return;
                const summary = summarizeContainer({ capacityMl: null }, page.deposits);
                setLoaded({ key, components: summary.components, truncated: page.truncated });
            })
            .catch((error) => {
                if (cancelled) return;
                console.error('Failed to load waste container contents:', error);
                setLoaded({ key, components: null, truncated: false });
            });
        return () => {
            cancelled = true;
        };
    }, [active, containerId, key]);

    const current = active && loaded?.key === key ? loaded : null;
    return useMemo<ContainerContentCheck>(() => {
        if (!active) return { status: 'off' };
        if (!current) return { status: 'loading' };
        if (!current.components) return { status: 'unavailable' };
        return {
            status: 'ready',
            warnings: checkContainerContents(incoming, current.components),
            recordedCount: current.components.length,
            truncated: current.truncated,
        };
    }, [active, current, incoming]);
}
