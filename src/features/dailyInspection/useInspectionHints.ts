import { useEffect, useMemo, useState } from 'react';
import {
    isCabinetLockRulesEnabled,
    isDailyInspectionEnabled,
    isInspectionHintsEnabled,
    isWasteContainersEnabled,
} from '../../config/featureFlags';
import { loadWasteContainersForOverview } from '../../services/labAdminOverviewService';
import { loadCabinetLockSummary } from '../../services/labSafetySignalService';
import { buildContainerTasks } from '../admin/labAdminTasks';
import { inspectionCopy } from './copy';
import { buildInspectionHints, type CabinetLockSummary, type InspectionHint } from './labSafetySignals';

interface SignalState {
    labId: string;
    cabinetLocks: CabinetLockSummary | null;
    containerAttentionCount: number | null;
}

const NO_HINTS: Partial<Record<string, InspectionHint>> = {};

/**
 * Hints for today's checklist from what the lab already recorded. Each source
 * loads on its own and a failed one simply adds no hint.
 */
export function useInspectionHints(labId: string | null, language: string): Partial<Record<string, InspectionHint>> {
    const enabled = isInspectionHintsEnabled && isDailyInspectionEnabled && Boolean(labId);
    const [signals, setSignals] = useState<SignalState | null>(null);

    useEffect(() => {
        if (!enabled || !labId) return;
        let cancelled = false;
        void Promise.allSettled([
            isCabinetLockRulesEnabled ? loadCabinetLockSummary(labId) : Promise.resolve(null),
            isWasteContainersEnabled
                ? loadWasteContainersForOverview(labId).then((containers) => buildContainerTasks(containers, Date.now()).length)
                : Promise.resolve(null),
        ]).then(([locks, containers]) => {
            if (cancelled) return;
            setSignals({
                labId,
                cabinetLocks: locks.status === 'fulfilled' ? locks.value : null,
                containerAttentionCount: containers.status === 'fulfilled' ? containers.value : null,
            });
        });
        return () => { cancelled = true; };
    }, [enabled, labId]);

    return useMemo(() => (
        enabled && signals && signals.labId === labId
            ? buildInspectionHints(signals, inspectionCopy(language).hints)
            : NO_HINTS
    ), [enabled, labId, language, signals]);
}
