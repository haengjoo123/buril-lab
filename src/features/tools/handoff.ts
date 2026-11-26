import type { ToolId } from "./registry";

/**
 * A value passed from one tool to another ("send to cell culture"). It is a
 * snapshot: the receiving tool copies it into its own inputs when the user
 * accepts, and nothing stays linked to the source afterwards.
 */
export type HandoffKind =
  | "molecular-weight"
  | "concentration"
  | "cell-density"
  | "volume"
  | "mass"
  | "count"
  | "table";
export interface Handoff {
  kind: HandoffKind;
  /** The number itself; `table` handoffs carry their rows in `rows`. */
  value: number;
  /** Unit as the source tool shows it, for example "cells/mL" or "g/mol". */
  unit: string;
  /** What the value is, shown to the user ("Viable cells", "NaCl"). */
  label: string;
  source: ToolId;
  rows?: string[][];
}
const kinds: readonly string[] = [
  "molecular-weight",
  "concentration",
  "cell-density",
  "volume",
  "mass",
  "count",
  "table",
];
/** Reads a handoff out of untyped router state; anything else is ignored. */
export function readHandoff(state: unknown): Handoff | null {
  const candidate = (state as { toolHandoff?: Partial<Handoff> } | null)
    ?.toolHandoff;
  return candidate &&
    typeof candidate.kind === "string" &&
    kinds.includes(candidate.kind) &&
    typeof candidate.value === "number" &&
    Number.isFinite(candidate.value) &&
    typeof candidate.unit === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.source === "string"
    ? (candidate as Handoff)
    : null;
}
