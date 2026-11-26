import type { ToolRecord } from "./repository";

export type SaveState =
  | "draft"
  | "saving"
  | "saved"
  | "offline"
  | "retrying"
  | "conflict"
  | "storage-error";

/**
 * What the shell should tell the user about one document. A dirty document
 * that cannot reach the server is "offline" or "retrying", never "saving":
 * "saving" promises that a request is on its way.
 */
export function saveState(
  record: Pick<ToolRecord, "status" | "dirty" | "draft" | "remote"> | undefined,
  repo: { error: string; offline: boolean }
): SaveState {
  if (repo.error === "Local storage failed") return "storage-error";
  if (record?.remote || record?.status === "conflict") return "conflict";
  if (record?.draft) return "draft";
  if (record && !record.dirty && record.status === "synced") return "saved";
  if (repo.offline) return "offline";
  if (repo.error || record?.status === "error") return "retrying";
  return "saving";
}
