import type { LabSafetyCenterLinkRequest, LabSafetyCenterRequest } from '../safety-center/types';
import type { InventoryItem } from '../../services/inventoryService';
import type { InventoryExpiryFilter } from '../inventory/inventoryExpiryFilter';
import type { WasteContainerStatus } from '../../services/wasteContainerService';
import { FILL_WARNING_RATIO } from '../wasteContainers/containerSummary';
import { hasManufacturerDate } from '../../utils/manufacturerDate';
import { calendarDateToUtcMs, parseCalendarDate } from '../../utils/dateValidation';
import { getRequestDueState } from './safetyRequestDue';
import { isNewLabMember, type SortableLabMember } from './labMemberSort';

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** A sealed container still waiting for pickup this long gets a reminder. */
export const SEALED_PICKUP_REMINDER_DAYS = 14;
/** Expiry within this many days is red (same threshold as the inventory's "critical"). */
export const EXPIRY_CRITICAL_DAYS = 7;
/** Expiry within this many days is amber (same threshold as the inventory's "warning"). */
export const EXPIRY_WARNING_DAYS = 30;
/** Reagent names shown on the expiry card before "외 N". */
export const EXPIRY_NAME_PREVIEW = 2;

/** red = act now (overdue, danger), amber = act soon, slate = for information. Same scale as InboxRow. */
export type LabAdminTaskSeverity = 'red' | 'amber' | 'slate';

export type LabAdminCenterRequestInput = Pick<LabSafetyCenterRequest, 'id' | 'title' | 'center_name' | 'status' | 'due_date'>;
export type LabAdminLinkRequestInput = Pick<
  LabSafetyCenterLinkRequest,
  'link_id' | 'center_name' | 'institution_name' | 'link_status' | 'link_scope'
>;
export type LabAdminInventoryInput = Pick<InventoryItem, 'id' | 'name' | 'expiry_date' | 'manufacturer_date_type'>;
export type LabAdminMemberInput = SortableLabMember;

/** One ignored DANGER storage warning. Deliberately carries no actor: the card is about things, not people. */
export interface LabAdminDangerWarning {
  id: string;
  createdAt: string;
  primaryName: string;
  secondaryName: string;
  cabinetId: string | null;
  cabinetName: string | null;
  shelfId: string | null;
  /** Cabinet item to highlight when the cabinet opens. */
  itemId: string | null;
}

export interface LabAdminDangerSummary {
  /** Ignored DANGER warnings in the last 7 days. */
  count: number;
  /** Newest first, at most a few. */
  latest: LabAdminDangerWarning[];
}

export interface LabAdminContainerInput {
  id: string;
  label: string;
  streamCode: string;
  status: WasteContainerStatus;
  location: string | null;
  sealedAt: string | null;
  /** Recorded volume / capacity from the database totals; null without a capacity. Not capped at 1. */
  fillRatio: number | null;
}

/** Each source is undefined/null while it is loading or after it failed: it then adds no task. */
export interface LabAdminTaskSources {
  centerRequests?: readonly LabAdminCenterRequestInput[] | null;
  linkRequests?: readonly LabAdminLinkRequestInput[] | null;
  inventory?: readonly LabAdminInventoryInput[] | null;
  dangerWarnings?: LabAdminDangerSummary | null;
  wasteContainers?: readonly LabAdminContainerInput[] | null;
  members?: readonly LabAdminMemberInput[] | null;
  joinPasswordNeedsChange?: boolean;
}

export type LabAdminExpiryLevel = 'expired' | 'critical' | 'warning';

export interface LabAdminExpiryItem {
  id: string;
  name: string;
  daysLeft: number;
  level: LabAdminExpiryLevel;
}

interface LabAdminTaskBase {
  /**
   * Stable id, also the snooze key. Built from what the card shows where it matters, so a
   * snoozed card comes back when something more urgent or new appears that week.
   */
  key: string;
  severity: LabAdminTaskSeverity;
  /** How many things the card stands for (sort tie-breaker). */
  count: number;
  /** Days until the nearest due date (negative = overdue); null when the card has no date. */
  sortDays: number | null;
}

export type LabAdminTask =
  | (LabAdminTaskBase & {
    kind: 'center_request';
    requestId: string;
    title: string;
    centerName: string;
    dueDate: string;
    daysLeft: number;
  })
  | (LabAdminTaskBase & {
    kind: 'expiry';
    expiredCount: number;
    /** 1-7 days left. */
    within7Count: number;
    /** 1-30 days left (includes within7Count), like "30일 이내" on the inventory banner. */
    within30Count: number;
    /** Nearest expiry first. */
    items: LabAdminExpiryItem[];
  })
  | (LabAdminTaskBase & {
    kind: 'danger_warning';
    latest: LabAdminDangerWarning | null;
  })
  | (LabAdminTaskBase & {
    kind: 'link_request';
    linkId: string;
    centerName: string;
    institutionName: string;
    scope: string[];
  })
  | (LabAdminTaskBase & {
    kind: 'waste_container';
    reason: 'fill' | 'sealed';
    containerId: string;
    label: string;
    streamCode: string;
    location: string | null;
    /** Rounded percent for 'fill'. */
    fillPercent: number | null;
    /** Whole days since sealing for 'sealed'. */
    sealedDays: number | null;
  })
  | (LabAdminTaskBase & {
    kind: 'new_members';
    memberIds: string[];
  })
  | (LabAdminTaskBase & {
    kind: 'join_password';
  });

export type LabAdminTaskKind = LabAdminTask['kind'];
export type LabAdminExpiryTask = Extract<LabAdminTask, { kind: 'expiry' }>;

export interface LabAdminTaskList {
  /** Shown in "이번 주 확인할 일", sorted. */
  active: LabAdminTask[];
  /** Hidden until next Monday, same order. */
  snoozed: LabAdminTask[];
}

/**
 * Days from today to an expiry date. Same rule as getExpiryStatus (local calendar day,
 * so the card and the inventory list agree), with `now` passed in.
 */
export function expiryDaysLeft(expiryDate: string | null | undefined, now: number): number | null {
  const parsed = parseCalendarDate(expiryDate);
  if (!parsed) return null;
  const today = new Date(now);
  const todayMs = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((calendarDateToUtcMs(parsed) - todayMs) / DAY_MS);
}

/** expired includes "expires today", like getExpiryStatus. Null beyond 30 days. */
export function expiryLevelForDays(daysLeft: number): LabAdminExpiryLevel | null {
  if (daysLeft <= 0) return 'expired';
  if (daysLeft <= EXPIRY_CRITICAL_DAYS) return 'critical';
  if (daysLeft <= EXPIRY_WARNING_DAYS) return 'warning';
  return null;
}

/** Short, stable text hash (FNV-1a, base 36) so snooze keys stay small in localStorage. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function buildCenterRequestTasks(requests: readonly LabAdminCenterRequestInput[], now: number): LabAdminTask[] {
  return requests.flatMap((request): LabAdminTask[] => {
    // Only requests still waiting on the lab: once the lab has submitted, the center acts next.
    if (request.status !== 'open' && request.status !== 'in_progress') return [];
    const due = getRequestDueState(request.due_date, now);
    if (!due || due.tone === 'later' || !request.due_date) return [];
    const isOverdue = due.tone === 'overdue';
    return [{
      kind: 'center_request',
      // Turning overdue is a new state: a request hidden while due soon shows again.
      key: isOverdue ? `center_request:${request.id}:overdue` : `center_request:${request.id}`,
      severity: isOverdue ? 'red' : 'amber',
      count: 1,
      sortDays: due.daysLeft,
      requestId: request.id,
      title: request.title,
      centerName: request.center_name,
      dueDate: request.due_date,
      daysLeft: due.daysLeft,
    }];
  });
}

function buildExpiryTask(items: readonly LabAdminInventoryInput[], now: number): LabAdminTask | null {
  const flagged: LabAdminExpiryItem[] = [];
  for (const item of items) {
    // Same rule as the inventory list: only a date the manufacturer printed counts.
    if (!hasManufacturerDate(item.manufacturer_date_type)) continue;
    const daysLeft = expiryDaysLeft(item.expiry_date, now);
    if (daysLeft === null) continue;
    const level = expiryLevelForDays(daysLeft);
    if (!level) continue;
    flagged.push({ id: item.id, name: item.name, daysLeft, level });
  }
  if (flagged.length === 0) return null;
  flagged.sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name, 'ko'));
  const expiredCount = flagged.filter((item) => item.level === 'expired').length;
  const within7Count = flagged.filter((item) => item.level === 'critical').length;
  const within30Count = flagged.filter((item) => item.level !== 'expired').length;
  // Keyed by the red items (expired or within 7 days): one appearing after "이번 주 숨기기"
  // shows the card again, while reagents only entering the 30-day window keep it hidden.
  const urgentIds = flagged.filter((item) => item.level !== 'warning').map((item) => item.id).sort();
  return {
    kind: 'expiry',
    key: urgentIds.length > 0 ? `expiry:${urgentIds.length}:${shortHash(urgentIds.join(','))}` : 'expiry',
    severity: urgentIds.length > 0 ? 'red' : 'amber',
    count: flagged.length,
    sortDays: flagged[0].daysLeft,
    expiredCount,
    within7Count,
    within30Count,
    items: flagged,
  };
}

/** The inventory ?filter= that lists every reagent the expiry card counts (its "목록 보기"). */
export function expiryListFilter(task: Pick<LabAdminExpiryTask, 'expiredCount' | 'within30Count'>): InventoryExpiryFilter {
  if (task.expiredCount === 0) return 'expiring';
  return task.within30Count > 0 ? 'attention' : 'expired';
}

function buildDangerTask(summary: LabAdminDangerSummary): LabAdminTask | null {
  if (summary.count <= 0) return null;
  const latest = summary.latest[0] ?? null;
  return {
    kind: 'danger_warning',
    // Keyed by the newest warning: a DANGER warning ignored after "이번 주 숨기기" shows the card again.
    key: latest?.id ? `danger_warning:${latest.id}` : 'danger_warning',
    severity: 'red',
    count: summary.count,
    sortDays: null,
    latest,
  };
}

function buildLinkTasks(links: readonly LabAdminLinkRequestInput[]): LabAdminTask[] {
  return links
    .filter((link) => link.link_status === 'requested')
    .map((link): LabAdminTask => ({
      kind: 'link_request',
      key: `link_request:${link.link_id}`,
      severity: 'amber',
      count: 1,
      sortDays: null,
      linkId: link.link_id,
      centerName: link.center_name,
      institutionName: link.institution_name,
      scope: [...link.link_scope],
    }));
}

function buildContainerTasks(containers: readonly LabAdminContainerInput[], now: number): LabAdminTask[] {
  return containers.flatMap((container): LabAdminTask[] => {
    const base = {
      kind: 'waste_container' as const,
      count: 1,
      sortDays: null,
      containerId: container.id,
      label: container.label,
      streamCode: container.streamCode,
      location: container.location,
    };
    if (container.status === 'active' && container.fillRatio !== null && container.fillRatio >= FILL_WARNING_RATIO) {
      const isOver = container.fillRatio > 1;
      return [{
        ...base,
        // Going over capacity is a new state: a container hidden while nearly full shows again.
        key: `waste_container:${container.id}:${isOver ? 'over' : 'fill'}`,
        severity: isOver ? 'red' : 'amber',
        reason: 'fill',
        fillPercent: Math.round(container.fillRatio * 100),
        sealedDays: null,
      }];
    }
    if (container.status === 'sealed' && container.sealedAt) {
      const sealedAt = new Date(container.sealedAt).getTime();
      if (Number.isNaN(sealedAt)) return [];
      const sealedMs = now - sealedAt;
      if (sealedMs < SEALED_PICKUP_REMINDER_DAYS * DAY_MS) return [];
      return [{
        ...base,
        key: `waste_container:${container.id}:sealed`,
        severity: 'amber',
        reason: 'sealed',
        fillPercent: null,
        sealedDays: Math.floor(sealedMs / DAY_MS),
      }];
    }
    return [];
  });
}

function buildNewMemberTask(members: readonly LabAdminMemberInput[], now: number): LabAdminTask | null {
  const newMembers = members.filter((member) => isNewLabMember(member, now));
  if (newMembers.length === 0) return null;
  // isNewLabMember already dropped members without a valid join date.
  const joinedMs = (member: LabAdminMemberInput) => new Date(member.joined_at).getTime();
  const newest = newMembers.reduce((latest, member) => {
    const diff = joinedMs(member) - joinedMs(latest);
    return diff > 0 || (diff === 0 && member.user_id > latest.user_id) ? member : latest;
  });
  return {
    kind: 'new_members',
    // Keyed by the newest member, like the DANGER card: someone joining after "이번 주 숨기기"
    // shows the card again, while a member passing 14 days does not.
    key: `new_members:${newest.user_id}`,
    severity: 'slate',
    count: newMembers.length,
    sortDays: null,
    memberIds: newMembers.map((member) => member.user_id),
  };
}

const SEVERITY_RANK: Record<LabAdminTaskSeverity, number> = { red: 0, amber: 1, slate: 2 };

/** red > amber > slate, then nearest due date (dated cards first), then larger count. */
export function compareLabAdminTasks(a: LabAdminTask, b: LabAdminTask): number {
  const severityDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (severityDiff !== 0) return severityDiff;
  if (a.sortDays !== b.sortDays) {
    if (a.sortDays === null) return 1;
    if (b.sortDays === null) return -1;
    return a.sortDays - b.sortDays;
  }
  if (a.count !== b.count) return b.count - a.count;
  return a.key.localeCompare(b.key);
}

/** Every card the overview shows for this week, split into visible and snoozed, both sorted. */
export function buildLabAdminTasks(
  sources: LabAdminTaskSources,
  now: number,
  snoozes: LabAdminSnoozes = {},
): LabAdminTaskList {
  const tasks: LabAdminTask[] = [];
  if (sources.centerRequests) tasks.push(...buildCenterRequestTasks(sources.centerRequests, now));
  if (sources.inventory) {
    const expiry = buildExpiryTask(sources.inventory, now);
    if (expiry) tasks.push(expiry);
  }
  if (sources.dangerWarnings) {
    const danger = buildDangerTask(sources.dangerWarnings);
    if (danger) tasks.push(danger);
  }
  if (sources.linkRequests) tasks.push(...buildLinkTasks(sources.linkRequests));
  if (sources.wasteContainers) tasks.push(...buildContainerTasks(sources.wasteContainers, now));
  if (sources.members) {
    const newMembers = buildNewMemberTask(sources.members, now);
    if (newMembers) tasks.push(newMembers);
  }
  if (sources.joinPasswordNeedsChange) {
    tasks.push({ kind: 'join_password', key: 'join_password', severity: 'amber', count: 1, sortDays: null });
  }

  tasks.sort(compareLabAdminTasks);
  const active: LabAdminTask[] = [];
  const snoozed: LabAdminTask[] = [];
  for (const task of tasks) {
    (isLabAdminTaskSnoozed(snoozes, task.key, now) ? snoozed : active).push(task);
  }
  return { active, snoozed };
}

/**
 * The number on the admin tab: visible red cards built from the light sources only (overdue
 * center requests, over-capacity containers). Link requests are always amber, so they never count;
 * reagents and storage warnings stay on the overview.
 */
export function countLabAdminAttention(
  sources: Pick<LabAdminTaskSources, 'centerRequests' | 'linkRequests' | 'wasteContainers'>,
  now: number,
  snoozes: LabAdminSnoozes = {},
): number {
  const { centerRequests, linkRequests, wasteContainers } = sources;
  return buildLabAdminTasks({ centerRequests, linkRequests, wasteContainers }, now, snoozes)
    .active.filter((task) => task.severity === 'red').length;
}

// --- "이번 주 숨기기" ---------------------------------------------------------------

/** localStorage key prefix; the lab id follows. */
export const LAB_ADMIN_SNOOZE_STORAGE_PREFIX = 'buril.labAdmin.snooze.';

/** Task key -> hidden until (epoch ms). */
export type LabAdminSnoozes = Readonly<Record<string, number>>;

type SnoozeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultSnoozeStorage(): SnoozeStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function snoozeStorageKey(labId: string): string {
  return `${LAB_ADMIN_SNOOZE_STORAGE_PREFIX}${labId}`;
}

/** Monday 00:00 in Asia/Seoul after `now` (a full week ahead when `now` is already Monday). */
export function nextKstMondayStart(now: number): number {
  const kst = new Date(now + KST_OFFSET_MS);
  const weekday = kst.getUTCDay(); // 0 = Sunday, 1 = Monday
  const daysAhead = ((8 - weekday) % 7) || 7;
  return Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + daysAhead) - KST_OFFSET_MS;
}

export function isLabAdminTaskSnoozed(snoozes: LabAdminSnoozes, key: string, now: number): boolean {
  const until = snoozes[key];
  return typeof until === 'number' && until > now;
}

function pruneSnoozes(raw: unknown, now: number): Record<string, number> {
  const kept: Record<string, number> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return kept;
  for (const [key, until] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof until === 'number' && Number.isFinite(until) && until > now) kept[key] = until;
  }
  return kept;
}

function writeSnoozes(labId: string, snoozes: Record<string, number>, storage: SnoozeStorage | null): void {
  if (!storage) return;
  try {
    if (Object.keys(snoozes).length === 0) storage.removeItem(snoozeStorageKey(labId));
    else storage.setItem(snoozeStorageKey(labId), JSON.stringify(snoozes));
  } catch {
    // Storage can be full or blocked; the snooze then lasts for this screen only.
  }
}

/** Current snoozes for a lab. Expired or malformed entries are ignored and removed from storage. */
export function readLabAdminSnoozes(
  labId: string,
  now: number = Date.now(),
  storage: SnoozeStorage | null = defaultSnoozeStorage(),
): LabAdminSnoozes {
  if (!storage) return {};
  let stored: string | null = null;
  try {
    stored = storage.getItem(snoozeStorageKey(labId));
  } catch {
    return {};
  }
  if (!stored) return {};
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(stored);
  } catch {
    parsed = null;
  }
  const kept = pruneSnoozes(parsed, now);
  const storedCount = parsed && typeof parsed === 'object' ? Object.keys(parsed).length : -1;
  if (storedCount !== Object.keys(kept).length) writeSnoozes(labId, kept, storage);
  return kept;
}

/** Hides a task until next Monday 00:00 (Asia/Seoul). Returns the new snoozes. */
export function snoozeLabAdminTask(
  labId: string,
  key: string,
  now: number = Date.now(),
  storage: SnoozeStorage | null = defaultSnoozeStorage(),
): LabAdminSnoozes {
  const next = { ...readLabAdminSnoozes(labId, now, storage), [key]: nextKstMondayStart(now) };
  writeSnoozes(labId, next, storage);
  return next;
}

/** Shows a snoozed task again. Returns the new snoozes. */
export function unsnoozeLabAdminTask(
  labId: string,
  key: string,
  now: number = Date.now(),
  storage: SnoozeStorage | null = defaultSnoozeStorage(),
): LabAdminSnoozes {
  const next: Record<string, number> = { ...readLabAdminSnoozes(labId, now, storage) };
  delete next[key];
  writeSnoozes(labId, next, storage);
  return next;
}
