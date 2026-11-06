import { create } from 'zustand';

/**
 * The red count on the admin tab ("확인할 일"), cached per lab so switching tabs does not
 * reload it. Not persisted: a new session starts empty and loads once.
 */

/** How long a count stays fresh before the next tab change reloads it. */
export const LAB_ADMIN_ATTENTION_TTL_MS = 5 * 60 * 1000;

export interface LabAdminAttentionEntry {
  count: number;
  /** When the sources behind the count were loaded (epoch ms). */
  loadedAt: number;
}

interface LabAdminAttentionState {
  entries: Record<string, LabAdminAttentionEntry>;
  /** Bumped on every invalidation, so a load that started before it is dropped. */
  generation: Record<string, number>;
}

export const useLabAdminAttentionStore = create<LabAdminAttentionState>(() => ({
  entries: {},
  generation: {},
}));

export function isLabAdminAttentionFresh(entry: LabAdminAttentionEntry | undefined, now: number): boolean {
  return entry !== undefined && now - entry.loadedAt < LAB_ADMIN_ATTENTION_TTL_MS;
}

export function getLabAdminAttentionGeneration(labId: string): number {
  return useLabAdminAttentionStore.getState().generation[labId] ?? 0;
}

/**
 * Drops the cached count after something it depends on changed (a reply, a link response,
 * a container sealed...), so the badge reloads. Without a lab id every lab is dropped.
 */
export function invalidateLabAdminAttention(labId?: string): void {
  useLabAdminAttentionStore.setState((state) => {
    if (labId === undefined) {
      const generation: Record<string, number> = { ...state.generation };
      for (const key of new Set([...Object.keys(state.entries), ...Object.keys(state.generation)])) {
        generation[key] = (generation[key] ?? 0) + 1;
      }
      return { entries: {}, generation };
    }
    const entries = { ...state.entries };
    delete entries[labId];
    return { entries, generation: { ...state.generation, [labId]: (state.generation[labId] ?? 0) + 1 } };
  });
}

/** Stores a freshly computed count (from the badge's own load or from the overview's data). */
export function primeLabAdminAttention(labId: string, count: number, loadedAt: number = Date.now()): void {
  useLabAdminAttentionStore.setState((state) => {
    const current = state.entries[labId];
    if (current && current.count === count && current.loadedAt === loadedAt) return state;
    return { entries: { ...state.entries, [labId]: { count, loadedAt } } };
  });
}
