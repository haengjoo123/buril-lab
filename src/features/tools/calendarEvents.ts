import { toolWorkspaceId, type ToolRepository } from "./repository";
import type { CalendarEvent } from "./calendar";

/**
 * Adds an event to the calendar tool from anywhere else (a culture's next
 * passage, a planned harvest). It appears in the calendar like one made
 * there. The event is a copy: later changes in the source tool do not move
 * it. Returns the event's id.
 */
export async function addCalendarEvent(
  repo: ToolRepository,
  {
    title,
    start,
    end,
    reminderMinutes = 0,
  }: {
    title: string;
    start: Date;
    /** One hour after the start when left out. */
    end?: Date;
    reminderMinutes?: number;
  }
) {
  const event: CalendarEvent = {
    id: crypto.randomUUID(),
    title,
    start: start.toISOString(),
    end: (end ?? new Date(+start + 3600000)).toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    repeat: "none",
    exceptions: [],
    reminderMinutes,
  };
  const workspace = repo.items.find(
    (row) =>
      row.doc.tool_id === "calendar" &&
      row.doc.data._workspace === true &&
      !row.doc.deleted_at
  );
  if (workspace)
    await repo.update(
      workspace.doc.id,
      {
        data: {
          ...workspace.doc.data,
          events: [
            ...((workspace.doc.data.events as CalendarEvent[]) ?? []),
            event,
          ],
        },
      },
      { immediate: true }
    );
  else
    await repo.create(
      "calendar",
      "Calendar",
      { _workspace: true, events: [event] },
      { id: toolWorkspaceId(repo.owner, "calendar") }
    );
  return event.id;
}
