import { describe, expect, it } from 'vitest';
import {
  LAB_ADMIN_SNOOZE_STORAGE_PREFIX,
  buildLabAdminTasks,
  countLabAdminAttention,
  expiryDaysLeft,
  expiryListFilter,
  isLabAdminTaskSnoozed,
  nextKstMondayStart,
  readLabAdminSnoozes,
  snoozeLabAdminTask,
  unsnoozeLabAdminTask,
  type LabAdminCenterRequestInput,
  type LabAdminContainerInput,
  type LabAdminInventoryInput,
  type LabAdminTask,
} from './labAdminTasks';

const DAY = 24 * 60 * 60 * 1000;
// 2026-11-06 12:00 KST (a Friday).
const NOW_KST_NOON = Date.UTC(2026, 10, 6, 3);
// Local noon on 2026-11-06: expiry dates follow the local calendar, like the inventory list.
const LOCAL_NOON = new Date(2026, 10, 6, 12).getTime();

function localDate(offsetDays: number): string {
  const date = new Date(2026, 10, 6 + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function request(id: string, dueDate: string | null, status: LabAdminCenterRequestInput['status'] = 'open'): LabAdminCenterRequestInput {
  return { id, title: `Request ${id}`, center_name: 'Center', status, due_date: dueDate };
}

function reagent(id: string, offsetDays: number | null, type: LabAdminInventoryInput['manufacturer_date_type'] = 'expiry'): LabAdminInventoryInput {
  return { id, name: `Reagent ${id}`, expiry_date: offsetDays === null ? null : localDate(offsetDays), manufacturer_date_type: type };
}

function container(overrides: Partial<LabAdminContainerInput>): LabAdminContainerInput {
  return {
    id: 'c1', label: 'Organic-1', streamCode: 'organic', status: 'active', location: null, sealedAt: null, fillRatio: 0,
    ...overrides,
  };
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
}

const kinds = (tasks: LabAdminTask[]) => tasks.map((task) => task.key);

describe('buildLabAdminTasks', () => {
  it('returns nothing for empty or missing sources', () => {
    expect(buildLabAdminTasks({}, NOW_KST_NOON)).toEqual({ active: [], snoozed: [] });
    expect(buildLabAdminTasks({
      centerRequests: [], linkRequests: [], inventory: [], wasteContainers: [], members: [],
      dangerWarnings: { count: 0, latest: [] }, joinPasswordNeedsChange: false,
    }, NOW_KST_NOON)).toEqual({ active: [], snoozed: [] });
  });

  it('flags center requests by Asia/Seoul calendar days: D+1 red, D-0 and D-3 amber, D-4 none', () => {
    const { active } = buildLabAdminTasks({
      centerRequests: [
        request('overdue', '2026-11-05'),
        request('today', '2026-11-06'),
        request('d3', '2026-11-09'),
        request('d4', '2026-11-10'),
        request('nodue', null),
      ],
    }, NOW_KST_NOON);
    expect(active.map((task) => [task.key, task.severity])).toEqual([
      ['center_request:overdue:overdue', 'red'],
      ['center_request:today', 'amber'],
      ['center_request:d3', 'amber'],
    ]);
    const overdue = active[0];
    expect(overdue.kind === 'center_request' && overdue.daysLeft).toBe(-1);
  });

  it('uses the Seoul date even when UTC is still on the previous day', () => {
    // 2026-11-06 00:30 KST is 2026-11-05 15:30 UTC: a request due 11-05 is already overdue.
    const { active } = buildLabAdminTasks({ centerRequests: [request('r', '2026-11-05')] }, Date.UTC(2026, 10, 5, 15, 30));
    expect(active[0].severity).toBe('red');
  });

  it('skips requests the lab has already submitted or that are resolved', () => {
    const { active } = buildLabAdminTasks({
      centerRequests: [
        request('submitted', '2026-11-01', 'submitted'),
        request('resolved', '2026-11-01', 'resolved'),
        request('in_progress', '2026-11-01', 'in_progress'),
      ],
    }, NOW_KST_NOON);
    expect(kinds(active)).toEqual(['center_request:in_progress:overdue']);
  });

  it('groups expiry at the 7 and 30 day edges', () => {
    const { active } = buildLabAdminTasks({
      inventory: [
        reagent('past', -3),
        reagent('today', 0),
        reagent('d7', 7),
        reagent('d8', 8),
        reagent('d30', 30),
        reagent('d31', 31),
        reagent('undated', null),
        // A date the manufacturer did not print is not tracked.
        reagent('unlabeled', -10, 'unlabeled'),
      ],
    }, LOCAL_NOON);
    expect(active).toHaveLength(1);
    const task = active[0];
    if (task.kind !== 'expiry') throw new Error('expected expiry task');
    expect(task.severity).toBe('red');
    expect(task.expiredCount).toBe(2);
    expect(task.within7Count).toBe(1);
    // Cumulative, like "30일 이내" on the inventory banner and ?filter=expiring.
    expect(task.within30Count).toBe(3);
    expect(task.items.map((item) => item.id)).toEqual(['past', 'today', 'd7', 'd8', 'd30']);
    expect(task.sortDays).toBe(-3);
  });

  it('is amber when nothing expires within 7 days', () => {
    const { active } = buildLabAdminTasks({ inventory: [reagent('d8', 8), reagent('d30', 30)] }, LOCAL_NOON);
    expect(active[0].severity).toBe('amber');
    expect(buildLabAdminTasks({ inventory: [reagent('d31', 31)] }, LOCAL_NOON).active).toEqual([]);
  });

  it('counts expiry days on the local calendar', () => {
    expect(expiryDaysLeft(localDate(1), new Date(2026, 10, 6, 23, 59).getTime())).toBe(1);
    expect(expiryDaysLeft(localDate(1), new Date(2026, 10, 7, 0, 1).getTime())).toBe(0);
  });

  it('flags containers at 80% fill, over 100% as red, and sealed for exactly 14 days', () => {
    const sealedAt = new Date(NOW_KST_NOON - 14 * DAY).toISOString();
    const { active } = buildLabAdminTasks({
      wasteContainers: [
        container({ id: 'full', fillRatio: 0.8 }),
        container({ id: 'below', fillRatio: 0.79 }),
        container({ id: 'over', fillRatio: 1.05 }),
        container({ id: 'unknown', fillRatio: null }),
        container({ id: 'sealed14', status: 'sealed', sealedAt }),
        container({ id: 'sealed13', status: 'sealed', sealedAt: new Date(NOW_KST_NOON - 14 * DAY + 1).toISOString() }),
      ],
    }, NOW_KST_NOON);
    expect(active.map((task) => [task.key, task.severity])).toEqual([
      ['waste_container:over:over', 'red'],
      ['waste_container:full:fill', 'amber'],
      ['waste_container:sealed14:sealed', 'amber'],
    ]);
    const sealed = active[2];
    expect(sealed.kind === 'waste_container' && sealed.sealedDays).toBe(14);
    const full = active[1];
    expect(full.kind === 'waste_container' && full.fillPercent).toBe(80);
  });

  it('lists members who joined within 14 days (inclusive), never the admin', () => {
    const joined = (msAgo: number) => new Date(NOW_KST_NOON - msAgo).toISOString();
    const { active } = buildLabAdminTasks({
      members: [
        { user_id: 'edge', role: 'student', joined_at: joined(14 * DAY) },
        { user_id: 'old', role: 'student', joined_at: joined(14 * DAY + 1) },
        { user_id: 'admin', role: 'admin', joined_at: joined(DAY) },
        { user_id: 'fresh', role: 'graduate', joined_at: joined(DAY) },
      ],
    }, NOW_KST_NOON);
    expect(active).toHaveLength(1);
    const task = active[0];
    if (task.kind !== 'new_members') throw new Error('expected new members task');
    expect(task.severity).toBe('slate');
    expect(task.memberIds.sort()).toEqual(['edge', 'fresh']);
  });

  it('adds link requests, DANGER warnings and the join password card', () => {
    const { active } = buildLabAdminTasks({
      linkRequests: [
        { link_id: 'l1', center_name: 'C', institution_name: 'I', link_status: 'requested', link_scope: ['summary'] },
        { link_id: 'l2', center_name: 'C', institution_name: 'I', link_status: 'approved', link_scope: ['summary'] },
      ],
      dangerWarnings: {
        count: 2,
        latest: [{
          id: 'w1', createdAt: '2026-11-05T00:00:00Z', primaryName: 'Nitric acid', secondaryName: 'Ethanol',
          cabinetId: 'cab', cabinetName: 'B-2', shelfId: null, itemId: null,
        }],
      },
      joinPasswordNeedsChange: true,
    }, NOW_KST_NOON);
    expect(active.map((task) => [task.key, task.severity])).toEqual([
      ['danger_warning:w1', 'red'],
      ['join_password', 'amber'],
      ['link_request:l1', 'amber'],
    ]);
  });

  it('shows a snoozed DANGER card again when a newer warning is ignored', () => {
    const warning = (id: string) => ({
      id, createdAt: '2026-11-05T00:00:00Z', primaryName: 'Nitric acid', secondaryName: 'Ethanol',
      cabinetId: 'cab', cabinetName: 'B-2', shelfId: null, itemId: null,
    });
    const snoozes = { 'danger_warning:w1': NOW_KST_NOON + DAY };
    const same = buildLabAdminTasks({ dangerWarnings: { count: 1, latest: [warning('w1')] } }, NOW_KST_NOON, snoozes);
    expect(kinds(same.snoozed)).toEqual(['danger_warning:w1']);
    const newer = buildLabAdminTasks({ dangerWarnings: { count: 2, latest: [warning('w2'), warning('w1')] } }, NOW_KST_NOON, snoozes);
    expect(kinds(newer.active)).toEqual(['danger_warning:w2']);
  });

  it('sorts by severity, then due date, then count', () => {
    const { active } = buildLabAdminTasks({
      centerRequests: [request('soon', '2026-11-08'), request('late', '2026-11-05'), request('today', '2026-11-06')],
      dangerWarnings: { count: 1, latest: [] },
      members: [{ user_id: 'm', role: 'student', joined_at: new Date(NOW_KST_NOON - DAY).toISOString() }],
      wasteContainers: [container({ id: 'a', fillRatio: 0.9 })],
      linkRequests: [{ link_id: 'l', center_name: 'C', institution_name: 'I', link_status: 'requested', link_scope: [] }],
    }, NOW_KST_NOON);
    expect(kinds(active)).toEqual([
      'center_request:late:overdue',
      'danger_warning',
      'center_request:today',
      'center_request:soon',
      'link_request:l',
      'waste_container:a:fill',
      'new_members:m',
    ]);
  });

  it('puts the larger card first when severity and date tie', () => {
    const { active } = buildLabAdminTasks({
      wasteContainers: [container({ id: 'over', fillRatio: 1.2 })],
      dangerWarnings: { count: 5, latest: [] },
    }, NOW_KST_NOON);
    // Both are red without a date: the card standing for more things goes first.
    expect(kinds(active)).toEqual(['danger_warning', 'waste_container:over:over']);
  });

  it('keeps a snoozed expiry card hidden for new 30-day reagents but shows it for a new red one', () => {
    const amberOnly = buildLabAdminTasks({ inventory: [reagent('d20', 20)] }, LOCAL_NOON);
    expect(kinds(amberOnly.active)).toEqual(['expiry']);
    const snoozes = { expiry: LOCAL_NOON + DAY };
    // Another reagent entering the 30-day window: still hidden.
    expect(kinds(buildLabAdminTasks({ inventory: [reagent('d20', 20), reagent('d25', 25)] }, LOCAL_NOON, snoozes).snoozed))
      .toEqual(['expiry']);
    // A reagent registered already expired: the card is back.
    const withExpired = buildLabAdminTasks({ inventory: [reagent('d20', 20), reagent('past', -1)] }, LOCAL_NOON, snoozes);
    expect(withExpired.snoozed).toEqual([]);
    expect(withExpired.active[0].severity).toBe('red');

    // Snoozed while red: the same red reagents keep it hidden, another one within 7 days shows it again.
    const redKey = withExpired.active[0].key;
    expect(redKey).toMatch(/^expiry:1:[0-9a-z]+$/);
    const redSnoozes = { [redKey]: LOCAL_NOON + DAY };
    expect(buildLabAdminTasks({ inventory: [reagent('past', -1), reagent('d25', 25)] }, LOCAL_NOON, redSnoozes).active).toEqual([]);
    const moreRed = buildLabAdminTasks({ inventory: [reagent('past', -1), reagent('d5', 5)] }, LOCAL_NOON, redSnoozes);
    expect(moreRed.active).toHaveLength(1);
    expect(moreRed.active[0].key).not.toBe(redKey);
  });

  it('builds the same expiry key whatever order the reagents load in', () => {
    const a = buildLabAdminTasks({ inventory: [reagent('x', -1), reagent('y', 3)] }, LOCAL_NOON).active[0].key;
    const b = buildLabAdminTasks({ inventory: [reagent('y', 3), reagent('x', -1)] }, LOCAL_NOON).active[0].key;
    expect(a).toBe(b);
  });

  it('shows a snoozed new-member card again only when someone newer joins', () => {
    const joined = (msAgo: number) => new Date(NOW_KST_NOON - msAgo).toISOString();
    const first = { user_id: 'first', role: 'student', joined_at: joined(13 * DAY) };
    const second = { user_id: 'second', role: 'student', joined_at: joined(2 * DAY) };
    const { active } = buildLabAdminTasks({ members: [first, second] }, NOW_KST_NOON);
    expect(kinds(active)).toEqual(['new_members:second']);
    const snoozes = { 'new_members:second': NOW_KST_NOON + 3 * DAY };
    // Two days later the first member is past 14 days: same newest member, still hidden.
    expect(kinds(buildLabAdminTasks({ members: [first, second] }, NOW_KST_NOON + 2 * DAY, snoozes).snoozed))
      .toEqual(['new_members:second']);
    const third = { user_id: 'third', role: 'student', joined_at: joined(-DAY) };
    expect(kinds(buildLabAdminTasks({ members: [first, second, third] }, NOW_KST_NOON + 2 * DAY, snoozes).active))
      .toEqual(['new_members:third']);
  });

  it('shows a snoozed container or request again once it escalates to red', () => {
    const fillSnoozes = { 'waste_container:c1:fill': NOW_KST_NOON + DAY };
    expect(buildLabAdminTasks({ wasteContainers: [container({ fillRatio: 0.9 })] }, NOW_KST_NOON, fillSnoozes).active).toEqual([]);
    expect(kinds(buildLabAdminTasks({ wasteContainers: [container({ fillRatio: 1.1 })] }, NOW_KST_NOON, fillSnoozes).active))
      .toEqual(['waste_container:c1:over']);

    // Hidden on Friday while due Saturday; overdue on Sunday.
    const requestSnoozes = { 'center_request:r': NOW_KST_NOON + 3 * DAY };
    expect(buildLabAdminTasks({ centerRequests: [request('r', '2026-11-07')] }, NOW_KST_NOON, requestSnoozes).active).toEqual([]);
    const overdue = buildLabAdminTasks({ centerRequests: [request('r', '2026-11-07')] }, NOW_KST_NOON + 2 * DAY, requestSnoozes);
    expect(overdue.active.map((task) => [task.key, task.severity])).toEqual([['center_request:r:overdue', 'red']]);
  });

  it('opens the inventory filter that lists every reagent the expiry card counts', () => {
    expect(expiryListFilter({ expiredCount: 2, within30Count: 0 })).toBe('expired');
    expect(expiryListFilter({ expiredCount: 0, within30Count: 3 })).toBe('expiring');
    expect(expiryListFilter({ expiredCount: 1, within30Count: 3 })).toBe('attention');
  });

  it('moves snoozed tasks aside until the snooze expires', () => {
    const sources = { joinPasswordNeedsChange: true };
    const snoozes = { join_password: NOW_KST_NOON + DAY };
    expect(buildLabAdminTasks(sources, NOW_KST_NOON, snoozes)).toMatchObject({ active: [], snoozed: [{ key: 'join_password' }] });
    expect(buildLabAdminTasks(sources, NOW_KST_NOON + DAY, snoozes)).toMatchObject({ active: [{ key: 'join_password' }], snoozed: [] });
  });
});

describe('snooze helpers', () => {
  it('ends a snooze at the next Monday 00:00 in Seoul', () => {
    // Friday 2026-11-06 12:00 KST -> Monday 2026-11-09 00:00 KST (= 11-08 15:00 UTC).
    expect(nextKstMondayStart(NOW_KST_NOON)).toBe(Date.UTC(2026, 10, 8, 15));
    // Sunday 23:59 KST -> one minute later.
    const sundayLate = Date.UTC(2026, 10, 8, 14, 59);
    expect(nextKstMondayStart(sundayLate)).toBe(Date.UTC(2026, 10, 8, 15));
    // Monday 00:00 KST exactly -> the Monday after.
    expect(nextKstMondayStart(Date.UTC(2026, 10, 8, 15))).toBe(Date.UTC(2026, 10, 15, 15));
    // Sunday 16:00 UTC is already Monday 01:00 in Seoul.
    expect(nextKstMondayStart(Date.UTC(2026, 10, 8, 16))).toBe(Date.UTC(2026, 10, 15, 15));
  });

  it('expires a Sunday snooze when Monday starts in Seoul', () => {
    const storage = memoryStorage();
    const sundayLate = Date.UTC(2026, 10, 8, 14, 0); // Sunday 23:00 KST
    const snoozes = snoozeLabAdminTask('lab-1', 'expiry', sundayLate, storage);
    expect(isLabAdminTaskSnoozed(snoozes, 'expiry', Date.UTC(2026, 10, 8, 14, 59))).toBe(true);
    const mondayStart = Date.UTC(2026, 10, 8, 15);
    expect(isLabAdminTaskSnoozed(snoozes, 'expiry', mondayStart)).toBe(false);
    expect(readLabAdminSnoozes('lab-1', mondayStart, storage)).toEqual({});
  });

  it('stores per lab and prunes expired or malformed entries', () => {
    const storage = memoryStorage();
    const key = `${LAB_ADMIN_SNOOZE_STORAGE_PREFIX}lab-1`;
    storage.setItem(key, JSON.stringify({ keep: NOW_KST_NOON + DAY, old: NOW_KST_NOON - 1, bad: 'x' }));
    expect(readLabAdminSnoozes('lab-1', NOW_KST_NOON, storage)).toEqual({ keep: NOW_KST_NOON + DAY });
    expect(JSON.parse(storage.map.get(key) ?? '{}')).toEqual({ keep: NOW_KST_NOON + DAY });
    expect(readLabAdminSnoozes('lab-2', NOW_KST_NOON, storage)).toEqual({});

    storage.setItem(key, 'not json');
    expect(readLabAdminSnoozes('lab-1', NOW_KST_NOON, storage)).toEqual({});
    expect(storage.map.has(key)).toBe(false);
  });

  it('snoozes and unsnoozes a task', () => {
    const storage = memoryStorage();
    const snoozed = snoozeLabAdminTask('lab-1', 'new_members', NOW_KST_NOON, storage);
    expect(snoozed).toEqual({ new_members: Date.UTC(2026, 10, 8, 15) });
    expect(readLabAdminSnoozes('lab-1', NOW_KST_NOON, storage)).toEqual(snoozed);
    expect(unsnoozeLabAdminTask('lab-1', 'new_members', NOW_KST_NOON, storage)).toEqual({});
    expect(storage.map.size).toBe(0);
  });

  it('works without storage', () => {
    expect(readLabAdminSnoozes('lab-1', NOW_KST_NOON, null)).toEqual({});
    expect(snoozeLabAdminTask('lab-1', 'expiry', NOW_KST_NOON, null)).toEqual({ expiry: Date.UTC(2026, 10, 8, 15) });
  });
});

describe('countLabAdminAttention', () => {
  it('counts an overdue center request', () => {
    expect(countLabAdminAttention({ centerRequests: [request('late', '2026-11-05')] }, NOW_KST_NOON)).toBe(1);
  });

  it('does not count a request that is only due soon or already answered', () => {
    expect(countLabAdminAttention({ centerRequests: [request('soon', '2026-11-08')] }, NOW_KST_NOON)).toBe(0);
    expect(countLabAdminAttention({ centerRequests: [request('sent', '2026-11-01', 'submitted')] }, NOW_KST_NOON)).toBe(0);
  });

  it('counts an over-capacity container but not a nearly full one', () => {
    expect(countLabAdminAttention({ wasteContainers: [container({ fillRatio: 1.2 })] }, NOW_KST_NOON)).toBe(1);
    expect(countLabAdminAttention({ wasteContainers: [container({ fillRatio: 0.85 })] }, NOW_KST_NOON)).toBe(0);
  });

  it('leaves out snoozed red cards', () => {
    const snoozes = { 'center_request:late:overdue': NOW_KST_NOON + DAY };
    expect(countLabAdminAttention({ centerRequests: [request('late', '2026-11-05')] }, NOW_KST_NOON, snoozes)).toBe(0);
  });

  it('never counts link requests (always amber)', () => {
    expect(countLabAdminAttention({
      linkRequests: [{ link_id: 'l1', center_name: 'Center', institution_name: 'Univ', link_status: 'requested', link_scope: ['summary'] }],
    }, NOW_KST_NOON)).toBe(0);
  });

  it('adds up every red card from both sources', () => {
    expect(countLabAdminAttention({
      centerRequests: [request('a', '2026-11-01'), request('b', '2026-11-04', 'in_progress'), request('c', '2026-11-20')],
      wasteContainers: [container({ id: 'c1', fillRatio: 1.05 }), container({ id: 'c2', fillRatio: 0.5 })],
    }, NOW_KST_NOON)).toBe(3);
  });
});
