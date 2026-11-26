/**
 * Notes helpers kept apart from the screen.
 *
 * A note's tags are stored as one comma-separated string (`"pcr, 2026"`), the
 * form the first version of the tool wrote and still reads. They are split
 * into separate tags only when read, and joined again when written.
 */

const MAX_TAG_LENGTH = 40;

const unique = (tags: string[]) => {
  const seen = new Set<string>();
  return tags.filter((tag) => {
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** The tags in a stored value, in order, without blanks or repeats. */
export function parseTags(raw: unknown): string[] {
  const parts = Array.isArray(raw)
    ? raw.filter((part): part is string => typeof part === "string")
    : typeof raw === "string"
    ? raw.split(/[,，\n]/)
    : [];
  return unique(parts.map((part) => part.trim().slice(0, MAX_TAG_LENGTH)));
}
/** Tags as they are stored. */
export const formatTags = (tags: string[]) => tags.join(", ");
/** `tags` with what was typed added; typed text may hold several, comma-separated. */
export const addTags = (tags: string[], typed: string) =>
  unique([...tags, ...parseTags(typed)]);

/** The titles a new note is given; a note still called this has no title of its own. */
export const DEFAULT_NOTE_TITLES = ["새 메모", "New note"];

/**
 * The first line of a note's body that says something, as a title: without
 * leading heading or list marks, and no longer than a title should be.
 */
export function firstLine(body: unknown): string {
  if (typeof body !== "string") return "";
  for (const line of body.split(/\r?\n/)) {
    const text = line.replace(/^\s*(?:#+|[-*•])\s+/, "").trim();
    if (text) return text.slice(0, 80).trim();
  }
  return "";
}

/** A note as exported text: its title, its tags, then the body. */
export function noteText(
  note: { title: string; tags: string[]; body: string },
  tagsLabel: string
): string {
  return [
    note.title,
    ...(note.tags.length ? [`${tagsLabel}: ${formatTags(note.tags)}`] : []),
    "",
    note.body,
  ].join("\n");
}

export type NoteSort = "updated" | "title";
interface NoteLike {
  title: string;
  updated_at: string;
  data: Record<string, unknown>;
}
/** Notes ordered by last edit (newest first) or by title. */
export function sortNotes<T extends NoteLike>(notes: T[], by: NoteSort): T[] {
  const byTitle = (a: T, b: T) =>
    a.title.localeCompare(b.title, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  return [...notes].sort(
    by === "title"
      ? (a, b) => byTitle(a, b) || b.updated_at.localeCompare(a.updated_at)
      : (a, b) => b.updated_at.localeCompare(a.updated_at) || byTitle(a, b)
  );
}
/** Every tag used by the notes, alphabetically, each with how many notes carry it. */
export function tagCounts(notes: NoteLike[]): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const note of notes)
    for (const tag of parseTags(note.data.tags)) {
      const entry = counts.get(tag.toLowerCase());
      if (entry) entry.count++;
      else counts.set(tag.toLowerCase(), { tag, count: 1 });
    }
  return [...counts.values()].sort((a, b) =>
    a.tag.localeCompare(b.tag, undefined, { numeric: true, sensitivity: "base" })
  );
}
/** Whether a note has the tag (when one is chosen) and contains the search text. */
export function matchesNote(note: NoteLike, query: string, tag: string) {
  const tags = parseTags(note.data.tags);
  if (tag && !tags.some((own) => own.toLowerCase() === tag.toLowerCase()))
    return false;
  const body = typeof note.data.body === "string" ? note.data.body : "";
  return `${note.title} ${body} ${tags.join(" ")}`
    .toLowerCase()
    .includes(query.trim().toLowerCase());
}
