/**
 * A number as plain text for the clipboard, CSV cells and inputs: no grouping
 * separators, and binary floating-point residue rounded away (1 mL in µL is
 * 1000, not 1000.0000000000001). Display formatting lives in `ui.tsx`.
 */
export const plainNumber = (n: number, digits = 12) =>
  Number.isFinite(n) ? String(Number(n.toPrecision(digits))) : String(n);

/**
 * A file name for an export: `buril-<tool>[-<title>]-YYYYMMDD-HHmm.<ext>`.
 * Unique per minute, so a second export does not replace the first on a phone,
 * where every export lands in the same folder under the name it is given.
 */
export function exportFileName(
  tool: string,
  title: string | undefined,
  extension: string,
  now = new Date()
) {
  const two = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(
    now.getDate()
  )}-${two(now.getHours())}${two(now.getMinutes())}`;
  const name = title
    ?.trim()
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${["buril", tool, name, stamp].filter(Boolean).join("-")}.${extension}`;
}
/**
 * Text typed into a number field as a number, or null when it is not one.
 * Accepts a decimal comma ("0,5") but not grouping ("1,000" stays ambiguous
 * and is rejected rather than guessed).
 */
export function parseNumber(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const normal = /^[-+]?\d+,\d+$/.test(text) && !/^[-+]?\d{1,3},\d{3}$/.test(text)
    ? text.replace(",", ".")
    : text;
  const value = Number(normal);
  return Number.isFinite(value) ? value : null;
}
