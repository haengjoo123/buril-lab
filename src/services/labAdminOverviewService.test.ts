import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryCalls: Array<[string, unknown[]]> = [];
const queryResult: { data: unknown; error: unknown; count: number | null } = { data: [], error: null, count: 0 };

vi.mock('./supabaseClient', () => {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'gte', 'order', 'limit']) {
    builder[method] = (...args: unknown[]) => {
      queryCalls.push([method, args]);
      return method === 'limit' ? Promise.resolve(queryResult) : builder;
    };
  }
  return { supabase: { from: (table: string) => { queryCalls.push(['from', [table]]); return builder; } } };
});
vi.mock('./safetyCenterService', () => ({
  safetyCenterService: { getLabRequests: vi.fn(), getLabLinkRequests: vi.fn() },
}));
vi.mock('./inventoryService', () => ({ inventoryService: { getItems: vi.fn() } }));
vi.mock('./labService', () => ({ labService: { getLabMembers: vi.fn() } }));
vi.mock('./wasteContainerService', () => ({ fetchWasteContainers: vi.fn(), fetchWasteContainerTotals: vi.fn() }));

import { safetyCenterService } from './safetyCenterService';
import { inventoryService, type InventoryItem } from './inventoryService';
import { labService } from './labService';
import { fetchWasteContainerTotals, fetchWasteContainers, type WasteContainer } from './wasteContainerService';
import { useLabStore } from '../store/useLabStore';
import {
  createLabAdminOverviewLoader,
  fetchLabDangerWarnings,
  getLabAdminSourceKeys,
  labAdminSourceLoaders,
  loadLabAdminOverview,
  summarizeInventoryForOverview,
  type LabAdminSourceLoaders,
} from './labAdminOverviewService';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeLoaders(overrides: Partial<LabAdminSourceLoaders> = {}): LabAdminSourceLoaders {
  return {
    centerRequests: vi.fn(async () => []),
    linkRequests: vi.fn(async () => []),
    inventory: vi.fn(async () => ({ totalCount: 0, casMissingCount: 0, datedItems: [] })),
    dangerWarnings: vi.fn(async () => ({ count: 0, latest: [] })),
    wasteContainers: vi.fn(async () => []),
    members: vi.fn(async () => []),
    purchaseRequests: vi.fn(async () => []),
    ...overrides,
  };
}

function item(overrides: Partial<InventoryItem>): InventoryItem {
  return {
    id: 'i', lab_id: 'lab-a', user_id: null, name: 'Acetone', brand: null, product_number: null, cas_number: '67-64-1',
    quantity: 1, capacity: null, storage_type: 'other', cabinet_id: null, storage_location_id: null, product_id: null,
    expiry_date: null, manufacturer_date_type: 'unlabeled', received_date: null, opened_date: null, memo: null,
    remaining_percent: null, created_at: '', updated_at: '',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryCalls.length = 0;
  queryResult.data = [];
  queryResult.error = null;
  queryResult.count = 0;
  useLabStore.setState({ currentLabId: 'lab-a' });
});

describe('loadLabAdminOverview', () => {
  it('keeps a failed source from affecting the others', async () => {
    const loaders = fakeLoaders({
      inventory: vi.fn(async () => { throw new Error('inventory down'); }),
      members: vi.fn(async () => [{ user_id: 'u', role: 'student', joined_at: '2026-11-01' }]),
    });
    const results = await loadLabAdminOverview('lab-a', { loaders, sources: ['inventory', 'members', 'centerRequests'] });
    expect(results.inventory).toMatchObject({ status: 'rejected' });
    expect(results.members).toEqual({ status: 'fulfilled', value: [{ user_id: 'u', role: 'student', joined_at: '2026-11-01' }] });
    expect(results.centerRequests).toEqual({ status: 'fulfilled', value: [] });
    expect(loaders.linkRequests).not.toHaveBeenCalled();
  });

  it('drops results when the lab changed while loading', async () => {
    const slow = deferred<[]>();
    const loaders = fakeLoaders({ centerRequests: vi.fn(() => slow.promise) });
    const pending = loadLabAdminOverview('lab-a', { loaders, sources: ['centerRequests'] });
    useLabStore.setState({ currentLabId: 'lab-b' });
    slow.resolve([]);
    expect(await pending).toEqual({});
  });
});

describe('createLabAdminOverviewLoader', () => {
  it('reports each source as it settles', async () => {
    const onResult = vi.fn();
    const loader = createLabAdminOverviewLoader({ loaders: fakeLoaders(), getCurrentLabId: () => 'lab-a' });
    await loader.load('lab-a', ['members', 'linkRequests'], onResult);
    expect(onResult.mock.calls.map(([key]) => key).sort()).toEqual(['linkRequests', 'members']);
  });

  it('never commits a slow lab A response after switching to lab B', async () => {
    let currentLab = 'lab-a';
    const slowA = deferred<[]>();
    const centerRequests = vi.fn((labId: string) => (labId === 'lab-a' ? slowA.promise : Promise.resolve([])));
    const onResult = vi.fn();
    const loader = createLabAdminOverviewLoader({
      loaders: fakeLoaders({ centerRequests }),
      getCurrentLabId: () => currentLab,
    });

    const first = loader.load('lab-a', ['centerRequests'], onResult);
    currentLab = 'lab-b';
    loader.invalidate();
    const second = loader.load('lab-b', ['centerRequests'], onResult);
    await second;
    slowA.resolve([]);
    await first;

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(centerRequests).toHaveBeenLastCalledWith('lab-b');
  });

  it('lets only the newest load of a source commit, without cancelling other sources', async () => {
    const firstMembers = deferred<[]>();
    let memberCalls = 0;
    const members = vi.fn(() => (memberCalls++ === 0 ? firstMembers.promise : Promise.resolve([])));
    const onResult = vi.fn();
    const loader = createLabAdminOverviewLoader({ loaders: fakeLoaders({ members }), getCurrentLabId: () => 'lab-a' });

    const full = loader.load('lab-a', ['members', 'linkRequests'], onResult);
    await loader.load('lab-a', ['members'], onResult);
    firstMembers.resolve([]);
    const results = await full;

    expect(results.members).toBeUndefined();
    expect(results.linkRequests).toEqual({ status: 'fulfilled', value: [] });
    // The newer members load committed once; the superseded one never did.
    expect(onResult.mock.calls.map(([key]) => key).sort()).toEqual(['linkRequests', 'members']);
  });

  it('drops everything in flight after invalidate (unmount)', async () => {
    const slow = deferred<[]>();
    const onResult = vi.fn();
    const loader = createLabAdminOverviewLoader({
      loaders: fakeLoaders({ linkRequests: vi.fn(() => slow.promise) }),
      getCurrentLabId: () => 'lab-a',
    });
    const pending = loader.load('lab-a', ['linkRequests'], onResult);
    loader.invalidate();
    slow.resolve([]);
    expect(await pending).toEqual({});
    expect(onResult).not.toHaveBeenCalled();
  });
});

describe('source loaders', () => {
  it('only lists waste containers when the feature is on', () => {
    expect(getLabAdminSourceKeys({ wasteContainers: false })).not.toContain('wasteContainers');
    expect(getLabAdminSourceKeys({ wasteContainers: true })).toContain('wasteContainers');
  });

  it('refuses to read another lab through the store-scoped services', async () => {
    await expect(labAdminSourceLoaders.inventory('lab-b')).rejects.toThrow();
    expect(inventoryService.getItems).not.toHaveBeenCalled();
    await expect(labAdminSourceLoaders.wasteContainers('lab-b')).rejects.toThrow();
    expect(fetchWasteContainers).not.toHaveBeenCalled();
  });

  it('summarizes inventory without keeping undated items', async () => {
    vi.mocked(inventoryService.getItems).mockResolvedValue([
      item({ id: 'a', expiry_date: '2026-11-01', manufacturer_date_type: 'expiry' }),
      item({ id: 'b', cas_number: null }),
      item({ id: 'c', cas_number: '  ', expiry_date: '2026-11-01', manufacturer_date_type: 'unlabeled' }),
    ]);
    const summary = await labAdminSourceLoaders.inventory('lab-a');
    expect(summary.totalCount).toBe(3);
    expect(summary.casMissingCount).toBe(2);
    expect(summary.datedItems.map((row) => row.id)).toEqual(['a']);
    expect(summarizeInventoryForOverview([])).toEqual({ totalCount: 0, casMissingCount: 0, datedItems: [] });
  });

  it('computes container fill from database totals', async () => {
    const container = {
      id: 'c1', labId: 'lab-a', streamCode: 'organic', label: 'Organic-1', location: 'Hood', capacityMl: 1000,
      status: 'active', startedAt: '', sealedAt: null, collectedAt: null, collectionNote: null, createdAt: '', updatedAt: '',
    } as unknown as WasteContainer;
    vi.mocked(fetchWasteContainers).mockResolvedValue([container]);
    vi.mocked(fetchWasteContainerTotals).mockResolvedValue({ c1: { depositCount: 3, totalMl: 850, hasUnknownAmounts: false } });
    expect(await labAdminSourceLoaders.wasteContainers('lab-a')).toEqual([{
      id: 'c1', label: 'Organic-1', streamCode: 'organic', status: 'active', location: 'Hood', sealedAt: null, fillRatio: 0.85,
    }]);
  });

  it('keeps only role and join date for members', async () => {
    vi.mocked(labService.getLabMembers).mockResolvedValue([
      { user_id: 'u1', role: 'student', joined_at: '2026-11-01', email: 'a@example.com', nickname: 'A' },
    ]);
    expect(await labAdminSourceLoaders.members('lab-a')).toEqual([{ user_id: 'u1', role: 'student', joined_at: '2026-11-01' }]);
  });

  it('passes the lab id to the center services', async () => {
    vi.mocked(safetyCenterService.getLabRequests).mockResolvedValue([]);
    vi.mocked(safetyCenterService.getLabLinkRequests).mockResolvedValue([]);
    await labAdminSourceLoaders.centerRequests('lab-a');
    await labAdminSourceLoaders.linkRequests('lab-a');
    expect(safetyCenterService.getLabRequests).toHaveBeenCalledWith('lab-a');
    expect(safetyCenterService.getLabLinkRequests).toHaveBeenCalledWith('lab-a');
  });

  it('counts ignored DANGER warnings of the last 7 days without selecting the actor', async () => {
    queryResult.count = 4;
    queryResult.data = [{
      id: 'w1', created_at: '2026-11-05T01:00:00Z', primary_chemical_name: 'Nitric acid', secondary_chemical_name: 'Ethanol',
      cabinet_id: 'cab-1', shelf_id: 'shelf-1', item_a_id: 'item-1', cabinets: { name: 'B-2' },
    }];
    const now = Date.UTC(2026, 10, 6);
    const summary = await fetchLabDangerWarnings('lab-a', now);
    expect(summary).toEqual({
      count: 4,
      latest: [{
        id: 'w1', createdAt: '2026-11-05T01:00:00Z', primaryName: 'Nitric acid', secondaryName: 'Ethanol',
        cabinetId: 'cab-1', cabinetName: 'B-2', shelfId: 'shelf-1', itemId: 'item-1',
      }],
    });
    expect(queryCalls[0]).toEqual(['from', ['safety_compliance_events']]);
    const select = queryCalls.find(([method]) => method === 'select')?.[1][0] as string;
    expect(select).not.toContain('user_id');
    const filters = queryCalls.filter(([method]) => method === 'eq').map(([, args]) => args);
    expect(filters).toEqual([['lab_id', 'lab-a'], ['event_type', 'storage_warning_ignored'], ['warning_severity', 'DANGER']]);
    expect(queryCalls.find(([method]) => method === 'gte')?.[1]).toEqual(['created_at', new Date(now - 7 * 86400000).toISOString()]);
  });

  it('throws when the warning query fails', async () => {
    queryResult.error = { message: 'denied' };
    await expect(fetchLabDangerWarnings('lab-a')).rejects.toEqual({ message: 'denied' });
  });
});
