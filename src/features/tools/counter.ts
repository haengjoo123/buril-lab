/**
 * Counter documents and the arithmetic on them, apart from the screen: what a
 * press adds, what an undo step restores, how a percentage is rounded and what
 * an export contains. Every function returns a new group and leaves its
 * argument alone; a change that changes nothing returns the same group, which
 * is how callers tell that nothing happened.
 */
export type CountItem = {
  id: string;
  name: string;
  value: number;
  color: string;
};
/** One undoable change: the value each changed item had before it. */
export type UndoStep = Record<string, number>;
export type CountGroup = {
  id: string;
  name: string;
  items: CountItem[];
  /** Amount one press adds or removes. Absent or null counts by 1. */
  step?: number | null;
  /** The last few changes, newest last. Stored so a slip can be undone later. */
  undo?: UndoStep[];
};
/** Counters as stored before multi-item counters existed. */
export type LegacyCounter = { id: string; name: string; value: number };
export type CountData = { groups: CountGroup[]; counters: LegacyCounter[] };

export const MAX_ITEMS = 12;
/** Seven digits: the most `format()` shows without rounding. */
export const MAX_COUNT = 9_999_999;
export const MAX_STEP = 1000;
/** Undo steps kept with a counter. Each is a few dozen bytes. */
export const UNDO_LIMIT = 20;

/**
 * The counters of a document. A document saved before multi-item counters has
 * only `counters`; each becomes a counter with one item.
 */
export const counterGroups = (
  data: CountData,
  colors: readonly string[]
): CountGroup[] =>
  data.groups.length
    ? data.groups
    : data.counters.map((item, i) => ({
        id: item.id,
        name: item.name,
        items: [{ ...item, color: colors[i % colors.length] }],
      }));

export const validStep = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= MAX_STEP;
export const stepOf = (group: CountGroup) =>
  validStep(group.step) ? group.step : 1;
export const totalOf = (group: CountGroup) =>
  group.items.reduce((sum, item) => sum + item.value, 0);

/** A typed count: a whole number from 0 to `MAX_COUNT`. */
export function wholeCount(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_COUNT)
    throw Error("Count must be a whole number from 0 to 9,999,999");
  return value;
}

/**
 * Share of the total as a percentage with one decimal, rounded half up:
 * 182 of 200 is "91.0", 49 of 400 (12.25%) is "12.3". The screen, the CSV and
 * the copied summary all use this, so they cannot disagree.
 */
export function percentText(value: number, total: number) {
  const tenths = total > 0 ? Math.round((value * 1000) / total) : 0;
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

const remember = (group: CountGroup, step: UndoStep): CountGroup => ({
  ...group,
  undo: [...(group.undo ?? []), step].slice(-UNDO_LIMIT),
});

/** Sets one item's value, kept within 0…`MAX_COUNT`, as an undoable change. */
export function setValue(
  group: CountGroup,
  itemId: string,
  value: number
): CountGroup {
  const item = group.items.find((row) => row.id === itemId);
  if (!item) return group;
  // A stored value already above the ceiling is left there, not pulled down.
  const next = Math.min(Math.max(MAX_COUNT, item.value), Math.max(0, value));
  if (item.value === next) return group;
  return remember(
    {
      ...group,
      items: group.items.map((row) =>
        row.id === itemId ? { ...row, value: next } : row
      ),
    },
    { [itemId]: item.value }
  );
}

/** One press of + (1) or − (-1): the counter's step, never below zero. */
export function countBy(
  group: CountGroup,
  itemId: string,
  direction: 1 | -1
): CountGroup {
  const item = group.items.find((row) => row.id === itemId);
  return item
    ? setValue(group, itemId, item.value + direction * stepOf(group))
    : group;
}

/** Every value back to zero, as one undoable change. */
export function resetGroup(group: CountGroup): CountGroup {
  const counted = group.items.filter((item) => item.value !== 0);
  if (!counted.length) return group;
  return remember(
    { ...group, items: group.items.map((item) => ({ ...item, value: 0 })) },
    Object.fromEntries(counted.map((item) => [item.id, item.value]))
  );
}

/** Takes back the newest change. */
export function undoLast(group: CountGroup): CountGroup {
  const steps = group.undo ?? [],
    step = steps.at(-1);
  if (!step) return group;
  return {
    ...group,
    items: group.items.map((item) => {
      const before = step[item.id];
      return typeof before === "number" && Number.isFinite(before)
        ? { ...item, value: before }
        : item;
    }),
    undo: steps.slice(0, -1),
  };
}

/**
 * Renames a counter. A counter with one item shows that item's name on the
 * big button; while the two names are the same they are renamed together.
 */
export function renameGroup(group: CountGroup, name: string): CountGroup {
  const only = group.items.length === 1 ? group.items[0] : undefined;
  return {
    ...group,
    name,
    items:
      only && only.name === group.name ? [{ ...only, name }] : group.items,
  };
}

export const updateItem = (
  group: CountGroup,
  itemId: string,
  patch: Partial<Pick<CountItem, "name" | "color">>
): CountGroup => ({
  ...group,
  items: group.items.map((item) =>
    item.id === itemId ? { ...item, ...patch } : item
  ),
});

/**
 * Puts an item at `index` (the end by default). Nothing happens at the item
 * ceiling or when the item is already there, so restoring twice is harmless.
 */
export function insertItem(
  group: CountGroup,
  item: CountItem,
  index = group.items.length
): CountGroup {
  if (
    group.items.length >= MAX_ITEMS ||
    group.items.some((row) => row.id === item.id)
  )
    return group;
  const items = [...group.items];
  items.splice(Math.max(0, Math.min(index, items.length)), 0, item);
  return { ...group, items };
}

/**
 * Removes an item; a counter keeps at least one. Undo steps no longer mention
 * the item, and steps that changed nothing else are dropped.
 */
export function removeItem(group: CountGroup, itemId: string): CountGroup {
  if (
    group.items.length <= 1 ||
    !group.items.some((item) => item.id === itemId)
  )
    return group;
  const undo = (group.undo ?? [])
    .map((step) =>
      Object.fromEntries(Object.entries(step).filter(([id]) => id !== itemId))
    )
    .filter((step) => Object.keys(step).length > 0);
  return {
    ...group,
    items: group.items.filter((item) => item.id !== itemId),
    ...(group.undo ? { undo } : {}),
  };
}

/** Puts a deleted counter back where it was, unless it is already there. */
export function insertGroup(
  groups: CountGroup[],
  group: CountGroup,
  index: number
): CountGroup[] {
  if (groups.some((row) => row.id === group.id)) return groups;
  const next = [...groups];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, group);
  return next;
}

/**
 * What a change did, for a screen reader: "Live 183" when one item changed,
 * the new total when several did (reset, or undoing one), "" when none did.
 */
export function changeText(
  before: CountGroup,
  after: CountGroup,
  totalLabel: string
) {
  const changed = after.items.filter(
    (item) =>
      before.items.find((old) => old.id === item.id)?.value !== item.value
  );
  if (!changed.length) return "";
  return changed.length === 1
    ? `${changed[0].name} ${changed[0].value}`
    : `${totalLabel} ${totalOf(after)}`;
}

/**
 * A counter as one line of text: "Live 182 (91.0%) · Dead 18 (9.0%) · Total
 * 200". A single counter has no shares to report: "Colonies 37".
 */
export function summaryText(group: CountGroup, totalLabel: string) {
  const total = totalOf(group);
  if (group.items.length <= 1)
    return group.items.map((item) => `${item.name} ${item.value}`).join("");
  return [
    ...group.items.map(
      (item) =>
        `${item.name} ${item.value} (${percentText(item.value, total)}%)`
    ),
    `${totalLabel} ${total}`,
  ].join(" · ");
}

/** CSV rows: the headers, then name, count and percentage of every item. */
export function csvRows(
  group: CountGroup,
  headers: [item: string, count: string, percent: string]
): (string | number)[][] {
  const total = totalOf(group);
  return [
    headers,
    ...group.items.map((item) => [
      item.name,
      item.value,
      percentText(item.value, total),
    ]),
  ];
}

/** A counter's name as part of a file name, or undefined when nothing is left. */
export function fileNamePart(name: string) {
  return (
    name
      .trim()
      .replace(/[\\/:*?"<>|\s]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || undefined
  );
}

export type CounterShortcut =
  | { action: "count"; index: number; direction: 1 | -1 }
  | { action: "count-selected" }
  | { action: "undo" };
/**
 * The counting shortcut a key press stands for, if any. Top-row digits are
 * read from the physical key, because Shift turns their character into "!" or
 * "@". A number-pad key counts only while it types a digit: with Shift held,
 * Windows reports it as a navigation key without Shift, and adding where the
 * user meant to subtract would be worse than doing nothing.
 */
export function counterShortcut(event: {
  key: string;
  code?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): CounterShortcut | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === "Backspace") return { action: "undo" };
  if (event.key === " " || event.key === "Enter")
    return { action: "count-selected" };
  const digit =
    /^Digit([1-9])$/.exec(event.code ?? "")?.[1] ??
    /^[1-9]$/.exec(event.key)?.[0];
  return digit
    ? {
        action: "count",
        index: Number(digit) - 1,
        direction: event.shiftKey ? -1 : 1,
      }
    : null;
}
