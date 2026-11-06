import { useCallback, useEffect, useState } from 'react';
import type { WasteStreamCode } from '../../types';
import {
    fetchActiveWasteContainersForStream,
    fetchWasteContainerTotals,
    type WasteContainer,
    type WasteContainerTotals,
} from '../../services/wasteContainerService';
import { chooseDefaultContainer } from './containerSummary';

export interface ContainerSelection {
    enabled: boolean;
    /** The stream the deposit is routed to; containers listed here all belong to it. */
    streamCode: WasteStreamCode | null;
    containers: WasteContainer[];
    /** Recorded fill per container; empty when the totals could not be loaded. */
    totals: Record<string, WasteContainerTotals>;
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
    totals: Record<string, WasteContainerTotals>;
    /** The container last chosen for this stream, as stored when the list loaded. */
    rememberedId: string | null;
    failed: boolean;
}

const EMPTY: WasteContainer[] = [];
const EMPTY_TOTALS: Record<string, WasteContainerTotals> = {};
const LAST_CONTAINER_STORAGE_PREFIX = 'buril-waste-container-last-v1:';

const lastContainerStorageKey = (scopeKey: string, streamCode: WasteStreamCode): string =>
    `${LAST_CONTAINER_STORAGE_PREFIX}${scopeKey}:${streamCode}`;

const readLastContainer = (key: string): string | null => {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    } catch {
        return null;
    }
};

const writeLastContainer = (key: string, id: string): void => {
    try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(key, id);
    } catch {
        // Remembering the last container is a convenience; a full or blocked storage is fine.
    }
};

/**
 * Active containers for the stream a ready deposit is routed to. With none,
 * deposits keep working exactly as before (no container link). The container
 * last chosen for the same stream is preselected while it is still active.
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
            .then(async (rows) => {
                // The fill bar is extra; a totals failure must not hide the containers.
                const totals = rows.length > 0
                    ? await fetchWasteContainerTotals(rows.map((row) => row.id)).catch((error) => {
                        console.error('Failed to load waste container totals:', error);
                        return EMPTY_TOTALS;
                    })
                    : EMPTY_TOTALS;
                if (cancelled) return;
                setResult({
                    key: requestKey,
                    containers: rows,
                    totals,
                    rememberedId: readLastContainer(lastContainerStorageKey(scopeKey, streamCode)),
                    failed: false,
                });
            })
            .catch((error) => {
                if (cancelled) return;
                console.error('Failed to load waste containers:', error);
                setResult({ key: requestKey, containers: EMPTY, totals: EMPTY_TOTALS, rememberedId: null, failed: true });
            });
        return () => {
            cancelled = true;
        };
    }, [active, streamCode, requestKey, scopeKey]);

    const select = useCallback((id: string) => {
        setChoice(id);
        if (streamCode) writeLastContainer(lastContainerStorageKey(scopeKey, streamCode), id);
    }, [scopeKey, streamCode]);
    const refresh = useCallback(() => setReloadToken((value) => value + 1), []);

    const current = active && result?.key === requestKey ? result : null;
    const containers = current?.containers ?? EMPTY;
    const preferredId = [choice, current?.rememberedId ?? null]
        .find((id) => id && containers.some((container) => container.id === id)) ?? null;
    const selectedId = chooseDefaultContainer(containers, preferredId);
    const selected = containers.find((container) => container.id === selectedId) ?? null;

    return {
        enabled: active,
        streamCode: active ? streamCode : null,
        containers,
        totals: current?.totals ?? EMPTY_TOTALS,
        loading: active && current === null,
        loadFailed: current?.failed ?? false,
        selectedId,
        selected,
        needsChoice: active && containers.length > 1 && !selected,
        select,
        refresh,
    };
}
