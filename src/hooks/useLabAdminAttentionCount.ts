import { useEffect, useState } from 'react';
import type { AppTab } from './useAppUiState';
import { countLabAdminAttention, readLabAdminSnoozes } from '../features/admin/labAdminTasks';
import {
  getLabAdminSourceKeys,
  labAdminSourceLoaders,
  type LabAdminSourceKey,
  type LabAdminSourceLoaders,
} from '../services/labAdminOverviewService';
import { useLabStore } from '../store/useLabStore';
import {
  getLabAdminAttentionGeneration,
  isLabAdminAttentionFresh,
  primeLabAdminAttention,
  useLabAdminAttentionStore,
} from '../store/useLabAdminAttentionStore';

/**
 * The only sources that can turn a card red: overdue center requests and over-capacity
 * containers. Link requests are always amber, so loading them could never change the count;
 * reagents and storage warnings stay on the overview.
 */
export type LabAdminAttentionSourceKey = Extract<LabAdminSourceKey, 'centerRequests' | 'wasteContainers'>;

export function getLabAdminAttentionSourceKeys(
  keys: readonly LabAdminSourceKey[] = getLabAdminSourceKeys(),
): LabAdminAttentionSourceKey[] {
  return keys.filter((key): key is LabAdminAttentionSourceKey => key === 'centerRequests' || key === 'wasteContainers');
}

/**
 * primed: the count is stored. stale: an invalidation happened meanwhile (look again).
 * dropped: another lab is current now. failed: every source failed (nothing stored, no retry).
 */
export type LabAdminAttentionLoadOutcome = 'primed' | 'stale' | 'dropped' | 'failed';

export interface LabAdminAttentionLoadOptions {
  loaders?: Pick<LabAdminSourceLoaders, LabAdminAttentionSourceKey>;
  sources?: readonly LabAdminAttentionSourceKey[];
  /** Defaults to the lab store. */
  getCurrentLabId?: () => string | null;
}

// One load per lab at a time; a second caller waits for the same result.
const inFlightLoads = new Map<string, Promise<LabAdminAttentionLoadOutcome>>();

async function runLoad(labId: string, options: LabAdminAttentionLoadOptions): Promise<LabAdminAttentionLoadOutcome> {
  const loaders = options.loaders ?? labAdminSourceLoaders;
  const sources = new Set(options.sources ?? getLabAdminAttentionSourceKeys());
  const getCurrentLabId = options.getCurrentLabId ?? (() => useLabStore.getState().currentLabId);
  const generation = getLabAdminAttentionGeneration(labId);

  const [requests, containers] = await Promise.allSettled([
    sources.has('centerRequests') ? loaders.centerRequests(labId) : Promise.reject(new Error('not loaded')),
    sources.has('wasteContainers') ? loaders.wasteContainers(labId) : Promise.reject(new Error('not loaded')),
  ]);
  if (getLabAdminAttentionGeneration(labId) !== generation) return 'stale';
  // A source that reads the current lab may have failed for the switch: keep nothing half-counted.
  if (getCurrentLabId() !== labId) return 'dropped';
  if (requests.status === 'rejected' && containers.status === 'rejected') return 'failed';

  const now = Date.now();
  const count = countLabAdminAttention({
    centerRequests: requests.status === 'fulfilled' ? requests.value : null,
    wasteContainers: containers.status === 'fulfilled' ? containers.value : null,
  }, now, readLabAdminSnoozes(labId, now));
  primeLabAdminAttention(labId, count, now);
  return 'primed';
}

/** Loads the badge's sources for a lab and stores its red count (rejected sources add nothing). */
export function loadLabAdminAttention(
  labId: string,
  options: LabAdminAttentionLoadOptions = {},
): Promise<LabAdminAttentionLoadOutcome> {
  const running = inFlightLoads.get(labId);
  if (running) return running;
  const load = runLoad(labId, options).finally(() => {
    inFlightLoads.delete(labId);
  });
  inFlightLoads.set(labId, load);
  return load;
}

/**
 * Red "확인할 일" count for the admin tab of the current lab. 0 (and nothing loaded) unless the
 * user is an admin of that lab. Cached for LAB_ADMIN_ATTENTION_TTL_MS: a fresh count is never
 * reloaded just because the tab changed; a stale or invalidated one is reloaded on the next
 * tab change, lab change or invalidation.
 */
export function useLabAdminAttentionCount({ labId, isAdmin, activeTab }: {
  labId: string | null;
  isAdmin: boolean;
  activeTab: AppTab;
}): number {
  const enabledLabId = isAdmin && labId ? labId : null;
  const entry = useLabAdminAttentionStore((state) => (enabledLabId ? state.entries[enabledLabId] : undefined));
  const generation = useLabAdminAttentionStore((state) => (enabledLabId ? state.generation[enabledLabId] ?? 0 : 0));
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!enabledLabId) return;
    // Read the store now, not the render value: the overview may have primed it in this commit.
    if (isLabAdminAttentionFresh(useLabAdminAttentionStore.getState().entries[enabledLabId], Date.now())) return;
    let isCurrent = true;
    void loadLabAdminAttention(enabledLabId).then((outcome) => {
      // Dropped by an invalidation while loading: check again (it may have been primed meanwhile).
      if (isCurrent && outcome === 'stale') setRetryCount((count) => count + 1);
    });
    return () => {
      isCurrent = false;
    };
  }, [activeTab, enabledLabId, entry, generation, retryCount]);

  return enabledLabId && entry ? entry.count : 0;
}
