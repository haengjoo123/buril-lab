import { toolWorkspaceId, type ToolRepository } from "./repository";
import { setDeviceEnabled } from "./notifications";
import type { Clock } from "./clock";

/**
 * Starts a named countdown in the timer tool from anywhere else (an
 * incubation step, a culture's next passage). It appears in the timer list
 * like one made there and notifies on this device. Returns the timer's id.
 */
export async function startTimer(
  repo: ToolRepository,
  { name, durationMs }: { name: string; durationMs: number }
) {
  const id = crypto.randomUUID(),
    now = Date.now();
  const clock: Clock = {
    id,
    name,
    color: "#2563eb",
    duration: durationMs,
    remaining: durationMs,
    end: now + durationMs,
    running: true,
    elapsed: 0,
    started: now,
  };
  const workspace = repo.items.find(
    (row) =>
      row.doc.tool_id === "timer" &&
      row.doc.data._workspace === true &&
      !row.doc.deleted_at
  );
  if (workspace)
    await repo.update(
      workspace.doc.id,
      {
        data: {
          ...workspace.doc.data,
          clocks: [...((workspace.doc.data.clocks as Clock[]) ?? []), clock],
        },
      },
      { immediate: true }
    );
  else
    await repo.create(
      "timer",
      "Timer",
      { _workspace: true, clocks: [clock] },
      { id: toolWorkspaceId(repo.owner, "timer") }
    );
  setDeviceEnabled(repo.owner, id, true);
  return id;
}
