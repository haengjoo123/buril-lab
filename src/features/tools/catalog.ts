/** Tool-list logic with no UI: search ranking and the recently used list. */

interface Searchable {
  id: string;
  ko: string;
  en: string;
  descKo: string;
  descEn: string;
  keywords: readonly string[];
}
const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, "");
/**
 * Tools matching a query, best match first: a name that starts with it, a name
 * that contains it, a keyword ("RCF", "C1V1", "원심"), then the description.
 * Both languages are searched whichever one the screen is in, and spaces are
 * ignored ("단위변환" finds "단위 변환"). An empty query returns everything.
 */
export function searchTools<T extends Searchable>(
  query: string,
  list: readonly T[]
): T[] {
  const q = normalize(query);
  if (!q) return [...list];
  const rank = (tool: T) => {
    const names = [tool.ko, tool.en].map(normalize);
    if (names.some((name) => name.startsWith(q))) return 0;
    if (names.some((name) => name.includes(q))) return 1;
    if (
      tool.id.includes(q) ||
      tool.keywords.some((keyword) => normalize(keyword).includes(q))
    )
      return 2;
    if ([tool.descKo, tool.descEn].some((text) => normalize(text).includes(q)))
      return 3;
    return -1;
  };
  return list
    .map((tool, index) => ({ tool, index, rank: rank(tool) }))
    .filter((row) => row.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((row) => row.tool);
}

export type RecentTool = { id: string; at: number };
const RECENT_LIMIT = 8;
const recentList = (value: unknown): RecentTool[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is RecentTool =>
          !!entry &&
          typeof (entry as RecentTool).id === "string" &&
          typeof (entry as RecentTool).at === "number"
      )
    : [];
/** Puts a tool at the head of the recently used list. */
export function touchRecent(
  recent: unknown,
  id: string,
  now: number
): RecentTool[] {
  return [
    { id, at: now },
    ...recentList(recent).filter((entry) => entry.id !== id),
  ].slice(0, RECENT_LIMIT);
}
/** Two devices' lists as one: each tool once, at its latest use. */
export function mergeRecent(a: unknown, b: unknown): RecentTool[] {
  const latest = new Map<string, number>();
  for (const entry of [...recentList(a), ...recentList(b)])
    latest.set(entry.id, Math.max(latest.get(entry.id) ?? 0, entry.at));
  return [...latest]
    .map(([id, at]) => ({ id, at }))
    .sort((x, y) => y.at - x.at)
    .slice(0, RECENT_LIMIT);
}
