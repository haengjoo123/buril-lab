/**
 * A number as plain text for the clipboard, CSV cells and inputs: no grouping
 * separators, and binary floating-point residue rounded away (1 mL in µL is
 * 1000, not 1000.0000000000001). Display formatting lives in `ui.tsx`.
 */
export const plainNumber = (n: number, digits = 12) =>
  Number.isFinite(n) ? String(Number(n.toPrecision(digits))) : String(n);
