import type { ToolDocument } from "./registry";

/** Data for a copy of saved work. A running timer belongs to the original. */
export const duplicateData = (doc: ToolDocument) => ({
  ...doc.data,
  ...(doc.tool_id === "cell-culture" ? { timer: null } : {}),
});
