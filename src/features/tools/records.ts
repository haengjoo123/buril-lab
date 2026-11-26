import type { ToolRecord } from "./repository";

/**
 * The record a tool page works on.
 * - named work: the document with that id;
 * - a workspace tool: its fixed-id workspace document;
 * - otherwise the tool's device draft.
 *
 * A device may hold more than one draft of a tool (an old race created an
 * extra, empty one on some page loads). The draft the user actually worked in
 * wins: most edits first, then most recent.
 */
export function pickRecord(
  items: readonly ToolRecord[],
  toolId: string,
  documentId: string | undefined,
  workspace: boolean
): ToolRecord | undefined {
  const mine = items.filter(
    (row) => !row.doc.deleted_at && row.doc.tool_id === toolId
  );
  if (documentId) return mine.find((row) => row.doc.id === documentId);
  if (workspace) return mine.find((row) => row.doc.data._workspace === true);
  return mine
    .filter((row) => row.draft)
    .sort(
      (a, b) =>
        b.generation - a.generation ||
        b.doc.updated_at.localeCompare(a.doc.updated_at)
    )[0];
}
/** Never-edited drafts of a tool other than the one in use: safe to drop. */
export function spareDrafts(
  items: readonly ToolRecord[],
  toolId: string,
  keep: ToolRecord | undefined
): ToolRecord[] {
  return items.filter(
    (row) =>
      row !== keep &&
      row.doc.id !== keep?.doc.id &&
      row.draft &&
      !row.doc.deleted_at &&
      row.doc.tool_id === toolId &&
      row.generation <= 1
  );
}
