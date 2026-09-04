// Operations 9 only prepares the durable deletion queue. User-facing intake
// remains unavailable until the Operations 11 scheduler has passed its live
// checks and the runtime safety switch is enabled deliberately.
export const DELETION_UI_ENABLED = false as const;
