import { supabase } from "../../services/supabaseClient";

/**
 * Counts how often a tool is opened or its work saved, so that later work on
 * the tools can follow what is actually used. Only the tool id and the event
 * are sent; nothing typed into a tool leaves the device through here.
 *
 * It must never get in the user's way: failures are swallowed, and when the
 * server does not have the counting function yet (the migration is applied
 * separately from the app) it stops trying for the rest of the session.
 */
let unavailable = false;
const lastOpen = new Map<string, number>();
const OPEN_INTERVAL_MS = 10 * 60 * 1000;

export function recordToolUsage(toolId: string, event: "open" | "save") {
  if (unavailable || typeof navigator === "undefined" || !navigator.onLine)
    return;
  const now = Date.now();
  if (event === "open") {
    // Moving in and out of a tool is one visit, not several.
    if (now - (lastOpen.get(toolId) ?? 0) < OPEN_INTERVAL_MS) return;
    lastOpen.set(toolId, now);
  }
  try {
    void Promise.resolve(
      supabase.rpc("record_tool_usage", { p_tool_id: toolId, p_event: event })
    ).then(
      ({ error }) => {
        // PGRST202: the function is not in the schema cache; 42883: undefined function.
        if (error && ["PGRST202", "42883", "404"].includes(String(error.code)))
          unavailable = true;
      },
      () => {
        /* Offline or interrupted: not worth retrying a counter. */
      }
    );
  } catch {
    unavailable = true;
  }
}
