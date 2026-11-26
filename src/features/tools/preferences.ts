import { toolWorkspaceId, type ToolRepository } from "./repository";
import type { RecentTool } from "./catalog";

/**
 * Per-account tool preferences (favorites, recently used). They live in one
 * hidden document so they follow the account across devices; it is stored
 * under the `notes` tool id because the server only accepts known tool ids.
 */
export function readPreferences(repo: ToolRepository) {
  const data =
    repo.items.find((row) => row.doc.data._preferences === true)?.doc.data ??
    {};
  return {
    favorites: (Array.isArray(data.favorites) ? data.favorites : []).filter(
      (id): id is string => typeof id === "string"
    ),
    recent: (Array.isArray(data.recent) ? data.recent : []) as RecentTool[],
  };
}
/**
 * Changes some preference keys and keeps the rest. Always a merge: an older
 * build of the app writes this document with fewer keys than this one knows.
 */
export async function updatePreferences(
  repo: ToolRepository,
  patch: Record<string, unknown>
) {
  const row = repo.items.find((item) => item.doc.data._preferences === true);
  const data = { ...(row?.doc.data ?? {}), ...patch, _preferences: true };
  if (row) await repo.update(row.doc.id, { data });
  else
    await repo.create("notes", ".preferences", data, {
      id: toolWorkspaceId(repo.owner, "preferences"),
    });
}
