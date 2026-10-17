import { useCallback, useEffect, useState } from 'react';
import type { WasteStreamCode } from '../../types';
import {
    fetchActiveWasteContainersForStream,
    type WasteContainer,
} from '../../services/wasteContainerService';
import { chooseDefaultContainer } from './containerSummary';

export interface ContainerSelection {
    enabled: boolean;
    containers: WasteContainer[];
    loading: boolean;
    loadFailed: boolean;
    selectedId: string | null;
    selected: WasteContainer | null;
    /** Several active containers exist and none is chosen yet: block the deposit. */
    needsChoice: boolean;
    select: (id: string) => void;
    refresh: () => void;
}

interface LoadResult {
    key: string;
    containers: WasteContainer[];
    failed: boolean;
}

const EMPTY: WasteContainer[] = [];

/**
 * Active containers for the stream a ready deposit is routed to. With none,
 * deposits keep working exactly as before (no container link).
 */
export function useContainerSelection(
    enabled: boolean,
    streamCode: WasteStreamCode | null,
    scopeKey: string,
): ContainerSelection {
    const [result, setResult] = useState<LoadResult | null>(null);
    const [choice, setChoice] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const active = enabled && Boolean(streamCode);
    const requestKey = `${scopeKey}:${streamCode ?? ''}:${reloadToken}`;

    useEffect(() => {
        if (!active || !streamCode) return;
        let cancelled = false;
        fetchActiveWasteContainersForStream(streamCode)
            .then((rows) => {
                if (!cancelled) setResult({ key: requestKey, containers: rows, failed: false });
            })
            .catch((error) => {
                if (cancelled) return;
                console.error('Failed to load waste containers:', error);
                setResult({ key: requestKey, containers: EMPTY, failed: true });
            });
        return () => {
            cancelled = true;
        };
    }, [active, streamCode, requestKey]);

    const select = useCallback((id: string) => setChoice(id), []);
    const refresh = useCallback(() => setReloadToken((value) => value + 1), []);

    const current = active && result?.key === requestKey ? result : null;
    const containers = current?.containers ?? EMPTY;
    const selectedId = chooseDefaultContainer(containers, choice);
    const selected = containers.find((container) => container.id === selectedId) ?? null;

    return {
        enabled: active,
        containers,
        loading: active && current === null,
        loadFailed: current?.failed ?? false,
        selectedId,
        selected,
        needsChoice: active && containers.length > 1 && !selected,
        select,
        refresh,
    };
}
