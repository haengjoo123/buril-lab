/**
 * Data for the lab admin overview (/app/admin, "개요"). Every source loads on its own:
 * one slow or failing source never blanks the others, and each can be retried alone.
 *
 * Several services read the lab from useLabStore instead of taking an id, so every result
 * is committed only while that lab is still the current one (canCommitLabRequest).
 */

import { supabase } from './supabaseClient';
import { safetyCenterService } from './safetyCenterService';
import { inventoryService, type InventoryItem } from './inventoryService';
import { labService } from './labService';
import { fetchWasteContainerTotals, fetchWasteContainers } from './wasteContainerService';
import { useLabStore } from '../store/useLabStore';
import { isPurchaseRequestsEnabled, isWasteContainersEnabled } from '../config/featureFlags';
import { listPurchaseRequests } from './purchaseRequestService';
import { canCommitLabRequest, type LabRequestToken } from '../utils/labRequestScope';
import { hasManufacturerDate } from '../utils/manufacturerDate';
import { summarizeContainer, withDatabaseTotals } from '../features/wasteContainers/containerSummary';
import type { LabSafetyCenterLinkRequest, LabSafetyCenterRequest } from '../features/safety-center/types';
import type {
  LabAdminContainerInput,
  LabAdminDangerSummary,
  LabAdminDangerWarning,
  LabAdminMemberInput,
  LabAdminPurchaseInput,
} from '../features/admin/labAdminTasks';

const DAY_MS = 24 * 60 * 60 * 1000;
/** DANGER warnings ignored within this window appear on the overview. */
export const DANGER_WARNING_WINDOW_DAYS = 7;
/** Newest ignored warnings fetched for the card's detail line. */
export const DANGER_WARNING_PREVIEW = 3;

export const LAB_ADMIN_SOURCE_KEYS = [
  'centerRequests',
  'linkRequests',
  'inventory',
  'dangerWarnings',
  'wasteContainers',
  'members',
  'purchaseRequests',
] as const;

export type LabAdminSourceKey = (typeof LAB_ADMIN_SOURCE_KEYS)[number];

export interface LabAdminInventorySummary {
  /** Every reagent row the inventory list shows (inventory + cabinet items). */
  totalCount: number;
  casMissingCount: number;
  /** Only items with a manufacturer-printed date: the expiry card needs nothing else. */
  datedItems: InventoryItem[];
}

export interface LabAdminSourceValues {
  centerRequests: LabSafetyCenterRequest[];
  linkRequests: LabSafetyCenterLinkRequest[];
  inventory: LabAdminInventorySummary;
  dangerWarnings: LabAdminDangerSummary;
  wasteContainers: LabAdminContainerInput[];
  members: LabAdminMemberInput[];
  purchaseRequests: LabAdminPurchaseInput[];
}

export type LabAdminSourceResult<K extends LabAdminSourceKey = LabAdminSourceKey> =
  | { status: 'fulfilled'; value: LabAdminSourceValues[K] }
  | { status: 'rejected'; reason: unknown };

export type LabAdminOverviewResults = { [K in LabAdminSourceKey]?: LabAdminSourceResult<K> };

export type LabAdminSourceLoaders = { [K in LabAdminSourceKey]: (labId: string) => Promise<LabAdminSourceValues[K]> };

/** The sources this build loads: waste containers and purchase requests only behind their feature flags. */
export function getLabAdminSourceKeys(options: { wasteContainers?: boolean; purchaseRequests?: boolean } = {}): LabAdminSourceKey[] {
  const includeContainers = options.wasteContainers ?? isWasteContainersEnabled;
  const includePurchases = options.purchaseRequests ?? isPurchaseRequestsEnabled;
  return LAB_ADMIN_SOURCE_KEYS.filter((key) => (key !== 'wasteContainers' || includeContainers)
    && (key !== 'purchaseRequests' || includePurchases));
}

class LabChangedError extends Error {
  constructor() {
    super('The current lab changed before the overview loaded.');
    this.name = 'LabChangedError';
  }
}

/** For services that read the current lab from the store: refuse to load another lab's data. */
function assertCurrentLab(labId: string): void {
  if (useLabStore.getState().currentLabId !== labId) throw new LabChangedError();
}

export function summarizeInventoryForOverview(items: readonly InventoryItem[]): LabAdminInventorySummary {
  return {
    totalCount: items.length,
    casMissingCount: items.filter((item) => !item.cas_number?.trim()).length,
    datedItems: items.filter((item) => hasManufacturerDate(item.manufacturer_date_type) && Boolean(item.expiry_date)),
  };
}

type DangerWarningRow = {
  id?: unknown;
  created_at?: unknown;
  primary_chemical_name?: unknown;
  secondary_chemical_name?: unknown;
  cabinet_id?: unknown;
  shelf_id?: unknown;
  item_a_id?: unknown;
  cabinets?: { name?: unknown } | Array<{ name?: unknown }> | null;
};

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

function normalizeDangerWarning(row: DangerWarningRow): LabAdminDangerWarning {
  const cabinet = Array.isArray(row.cabinets) ? row.cabinets[0] : row.cabinets;
  return {
    id: String(row.id ?? ''),
    createdAt: String(row.created_at ?? ''),
    primaryName: text(row.primary_chemical_name) ?? '',
    secondaryName: text(row.secondary_chemical_name) ?? '',
    cabinetId: text(row.cabinet_id),
    cabinetName: text(cabinet?.name),
    shelfId: text(row.shelf_id),
    itemId: text(row.item_a_id),
  };
}

/**
 * Ignored DANGER storage warnings in this lab over the last 7 days: an exact count and the
 * newest few. The actor (user_id) is never selected; lab members can already read these rows.
 */
export async function fetchLabDangerWarnings(labId: string, now: number = Date.now()): Promise<LabAdminDangerSummary> {
  const since = new Date(now - DANGER_WARNING_WINDOW_DAYS * DAY_MS).toISOString();
  const { data, error, count } = await supabase
    .from('safety_compliance_events')
    .select(
      'id, created_at, primary_chemical_name, secondary_chemical_name, cabinet_id, shelf_id, item_a_id:metadata->>item_a_id, cabinets(name)',
      { count: 'exact' },
    )
    .eq('lab_id', labId)
    .eq('event_type', 'storage_warning_ignored')
    .eq('warning_severity', 'DANGER')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(DANGER_WARNING_PREVIEW);
  if (error) throw error;
  const rows = ((data ?? []) as DangerWarningRow[]).map(normalizeDangerWarning);
  return { count: typeof count === 'number' ? count : rows.length, latest: rows };
}

async function loadWasteContainersForOverview(labId: string): Promise<LabAdminContainerInput[]> {
  assertCurrentLab(labId);
  // Collected containers are excluded: they need nothing more.
  const containers = await fetchWasteContainers();
  const totals = await fetchWasteContainerTotals(containers.map((container) => container.id));
  return containers.map((container) => ({
    id: container.id,
    label: container.label,
    streamCode: container.streamCode,
    status: container.status,
    location: container.location,
    sealedAt: container.sealedAt,
    // Present only when the pickup columns were read, so the result is unchanged while the feature is off.
    ...(container.pickupRequestedAt !== undefined ? { pickupRequestedAt: container.pickupRequestedAt } : {}),
    fillRatio: withDatabaseTotals(summarizeContainer(container, []), container.capacityMl, totals[container.id]).fillRatio,
  }));
}

export const labAdminSourceLoaders: LabAdminSourceLoaders = {
  centerRequests: (labId) => safetyCenterService.getLabRequests(labId),
  linkRequests: (labId) => safetyCenterService.getLabLinkRequests(labId),
  inventory: async (labId) => {
    assertCurrentLab(labId);
    return summarizeInventoryForOverview(await inventoryService.getItems());
  },
  dangerWarnings: (labId) => fetchLabDangerWarnings(labId),
  wasteContainers: loadWasteContainersForOverview,
  members: async (labId) => {
    const members = await labService.getLabMembers(labId);
    // Only what the cards need: no emails or nicknames are kept on the overview.
    return members.map(({ user_id, role, joined_at }) => ({ user_id, role, joined_at }));
  },
  purchaseRequests: async (labId) => {
    // Only undecided requests matter here; closed ones are not fetched.
    const requests = await listPurchaseRequests(labId, 0);
    return requests
      .filter((request) => request.status === 'requested')
      .map(({ id, createdAt }) => ({ id, createdAt }));
  },
};

async function settle<K extends LabAdminSourceKey>(
  loaders: LabAdminSourceLoaders,
  key: K,
  labId: string,
): Promise<LabAdminSourceResult<K>> {
  try {
    return { status: 'fulfilled', value: await loaders[key](labId) };
  } catch (reason) {
    return { status: 'rejected', reason };
  }
}

export interface LabAdminOverviewLoaderOptions {
  loaders?: LabAdminSourceLoaders;
  /** Defaults to the lab store. */
  getCurrentLabId?: () => string | null;
}

export type LabAdminSourceListener = <K extends LabAdminSourceKey>(key: K, result: LabAdminSourceResult<K>) => void;

/**
 * Loads overview sources with one request generation per source. A result commits only when
 * it is the newest load of that source and its lab is still current, so a slow response for
 * lab A never lands under lab B, and a retry of one source does not cancel the others.
 */
export function createLabAdminOverviewLoader(options: LabAdminOverviewLoaderOptions = {}) {
  const loaders = options.loaders ?? labAdminSourceLoaders;
  const getCurrentLabId = options.getCurrentLabId ?? (() => useLabStore.getState().currentLabId);
  const generations: Record<LabAdminSourceKey, number> = {
    centerRequests: 0,
    linkRequests: 0,
    inventory: 0,
    dangerWarnings: 0,
    wasteContainers: 0,
    members: 0,
    purchaseRequests: 0,
  };

  return {
    /** Resolves with the results that committed; `onResult` fires as each source settles. */
    async load(
      labId: string,
      sources: readonly LabAdminSourceKey[],
      onResult?: LabAdminSourceListener,
    ): Promise<LabAdminOverviewResults> {
      const committed: Record<string, LabAdminSourceResult> = {};
      await Promise.allSettled(sources.map(async (key) => {
        generations[key] += 1;
        const token: LabRequestToken = { generation: generations[key], labId };
        const result = await settle(loaders, key, labId);
        if (!canCommitLabRequest(token, generations[key], getCurrentLabId())) return;
        committed[key] = result;
        onResult?.(key, result);
      }));
      return committed as LabAdminOverviewResults;
    },
    /** Drops every in-flight result (lab switch, unmount). */
    invalidate(sources: readonly LabAdminSourceKey[] = LAB_ADMIN_SOURCE_KEYS) {
      sources.forEach((key) => {
        generations[key] += 1;
      });
    },
  };
}

export type LabAdminOverviewLoader = ReturnType<typeof createLabAdminOverviewLoader>;

/** One-shot load of every source, settled independently (Promise.allSettled). */
export function loadLabAdminOverview(
  labId: string,
  options: LabAdminOverviewLoaderOptions & { sources?: readonly LabAdminSourceKey[] } = {},
): Promise<LabAdminOverviewResults> {
  return createLabAdminOverviewLoader(options).load(labId, options.sources ?? getLabAdminSourceKeys());
}
