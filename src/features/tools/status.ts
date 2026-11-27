import type { PendingToolWork, ToolRecord } from "./repository";

/**
 * The question to ask before sign-out clears this device's tool cache, or ""
 * when nothing would be lost.
 */
export function pendingWorkMessage(
  pending: PendingToolWork,
  korean: boolean
): string {
  const documents = pending.documents.length,
    drafts = pending.drafts.length,
    images = pending.images;
  if (!documents && !drafts && !images) return "";
  const lines = korean
    ? [
        "실험 도구에 이 기기에만 있는 작업이 있습니다.",
        documents && `· 계정에 동기화되지 않은 작업 ${documents}개`,
        drafts && `· 저장하지 않은 초안 ${drafts}개`,
        images && `· 아직 올라가지 않은 이미지 ${images}개`,
        "로그아웃하면 이 기기에서 삭제되며 복구할 수 없습니다. 로그아웃할까요?",
      ]
    : [
        "Lab tools has work that exists only on this device.",
        documents &&
          `· ${documents} item${documents === 1 ? "" : "s"} not synced to your account`,
        drafts && `· ${drafts} unsaved draft${drafts === 1 ? "" : "s"}`,
        images && `· ${images} image${images === 1 ? "" : "s"} not uploaded yet`,
        "Signing out deletes it from this device and it cannot be recovered. Sign out anyway?",
      ];
  return lines.filter(Boolean).join("\n");
}

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
