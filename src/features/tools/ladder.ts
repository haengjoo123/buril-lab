/**
 * Ladder (size marker) helpers kept apart from the screen: reading a pasted
 * list of band sizes, laying out the log-spaced diagram, drawing it on a
 * canvas, and checking the product link. No ladder data is built in; every
 * band comes from the user.
 */
import { plainNumber } from "./format";
import { ladderPositions } from "./geometry";

/**
 * A stored band. `color` and `highlight` have been in the document since the
 * first version of the tool (the old screen draws `color` as the SVG stroke
 * and the gel tool reads `highlight`), so both are reused as they are.
 */
export interface LadderBand {
  /** Null while the size field is empty. */
  size: number | null;
  label: string;
  color: string;
  highlight?: boolean;
}

/** The band colours offered. All read on a white and on a dark panel. */
export const bandColors = [
  { value: "#2563eb", ko: "파랑", en: "Blue" },
  { value: "#dc2626", ko: "빨강", en: "Red" },
  { value: "#ea580c", ko: "주황", en: "Orange" },
  { value: "#16a34a", ko: "초록", en: "Green" },
  { value: "#9333ea", ko: "보라", en: "Purple" },
  { value: "#64748b", ko: "회색", en: "Gray" },
] as const;
export const defaultBandColor: string = bandColors[0].value;

/** The label a band gets when the user has not written one: its size. */
export const autoLabel = (size: number | null | undefined) =>
  size == null || !Number.isFinite(size) ? "" : plainNumber(size);

/** Rounds away the binary residue of a unit change (0.1 kb is 100 bp). */
const tidy = (value: number) => Number(value.toPrecision(12));

/**
 * A band with another size. A label that only repeated the old size follows
 * the new one; a label the user wrote ("3 kb (ref)") is kept.
 */
export function resizeBand(band: LadderBand, size: number | null): LadderBand {
  const follows =
    band.label.trim() === "" || band.label === autoLabel(band.size);
  return { ...band, size, label: follows ? autoLabel(size) : band.label };
}
/** Every band's size multiplied (bp to kb is × 0.001), labels as above. */
export const rescaleBands = (bands: LadderBand[], factor: number) =>
  factor === 1
    ? bands
    : bands.map((band) =>
        resizeBand(band, band.size == null ? null : tidy(band.size * factor))
      );

// Lengths in bases or base pairs, masses in kDa.
const lengthUnits: Record<string, number> = {
  bp: 1,
  nt: 1,
  kb: 1e3,
  kbp: 1e3,
  knt: 1e3,
  mb: 1e6,
  mbp: 1e6,
};
const massUnits: Record<string, number> = { da: 1e-3, kda: 1, kd: 1, mda: 1e3 };
const unitScale = (unit: string) => {
  const key = unit.toLowerCase();
  return key in lengthUnits
    ? { family: "length", factor: lengthUnits[key] }
    : key in massUnits
    ? { family: "mass", factor: massUnits[key] }
    : null;
};
// Words between sizes in a sentence ("500, 750 and 1,000 bp").
const fillers = new Set(["and", "or", "&", "to", "및", "와", "과", "또는", "그리고"]);

/**
 * The numbers in one token. A comma directly before exactly three digits
 * groups thousands ("10,000"); any other comma separates values
 * ("100,200,300,1000"). Several groups are one number only when it is a round
 * one ("1,000,000"), since "100,200,300" is far more likely to be three bands
 * than one of a hundred million. Decimals use a point.
 */
function readNumbers(text: string): number[] | null {
  const grouped = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text);
  if (grouped) {
    const groups = text.split(".")[0].split(",").slice(1);
    if (groups.length === 1 || groups.every((group) => group === "000"))
      return [Number(text.replaceAll(",", ""))];
  }
  const values: number[] = [];
  for (const part of text.split(",")) {
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(part)) return null;
    values.push(Number(part));
  }
  return values;
}

export interface ParsedBandList {
  /** Sizes in the ladder's unit, in the order they were written. */
  sizes: number[];
  /** What could not be read as a size, as written. */
  skipped: string[];
  /** How many of `skipped` were sizes in a unit of another kind (kDa for a DNA ladder). */
  unitMismatch: number;
  /** Sizes left out because the same size came earlier in the list. */
  duplicates: number;
}

/**
 * Reads band sizes copied from a product sheet into the ladder's unit.
 *
 * Values may be separated by line breaks, tabs, spaces, semicolons, slashes
 * or commas, may group thousands ("10,000") and may carry a unit ("1.5 kb",
 * "500bp", "250 kDa"), which is converted.
 *
 * A value without a unit takes the next unit written after it in the same
 * list, as in "10, 15 and 25 kDa"; when none follows, it is already in the
 * ladder's unit. A line holding a single value is a list of its own: in a
 * column of "10,000", "3 kb", "500" the first line is not in kb. Lines that
 * each hold several values, or a line ending in a comma, are one list that
 * was wrapped.
 */
export function parseBandList(text: string, unit: string): ParsedBandList {
  const target = unitScale(unit) ?? { family: "length", factor: 1 };
  const entries: {
    value: number;
    unit: string | null;
    raw: string;
    list: number;
  }[] = [];
  const skipped: string[] = [];
  let unitMismatch = 0;
  let list = 0,
    // How many values the line before held, and whether it ended mid-list.
    before: { count: number; open: boolean } | null = null;
  for (const line of text.replace(/[，、]/g, ",").split(/\r\n|\r|\n/)) {
    if (!line.trim()) {
      before = null;
      continue;
    }
    const first = entries.length;
    // Whether the previous token was a bare number a unit word can attach to.
    let bare = false;
    for (const token of line
      .replace(/,(?=\s|$)/g, " ")
      .split(/[\s;；/|•·]+/)) {
      const raw = token
        .replace(/^[([{"'“‘~≈<>:,-]+/, "")
        .replace(/[)\]}"'”’.:,-]+$/, "");
      if (!raw) continue;
      if (unitScale(raw)) {
        const last = entries.at(-1);
        if (bare && last) last.unit = raw;
        // A unit on its own (a column heading) says nothing about a band.
        bare = false;
        continue;
      }
      bare = false;
      if (fillers.has(raw.toLowerCase())) continue;
      const match = raw.match(/^([\d.,]*\d)\.?([A-Za-z]+)?$/);
      const values = match ? readNumbers(match[1]) : null;
      if (
        !match ||
        !values ||
        (match[2] && !unitScale(match[2])) ||
        values.some((value) => !Number.isFinite(value) || value <= 0)
      ) {
        skipped.push(raw);
        continue;
      }
      for (const value of values)
        entries.push({ value, unit: match[2] ?? null, raw, list });
      bare = !match[2];
    }
    const count = entries.length - first;
    if (!before || !(before.open || (before.count > 1 && count > 1))) {
      list++;
      for (let i = first; i < entries.length; i++) entries[i].list = list;
    }
    before = { count, open: /(?:,|&|\band|및|와|과)\s*$/i.test(line) };
  }
  let following: string | null = null,
    current = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].list !== current) {
      current = entries[i].list;
      following = null;
    }
    if (entries[i].unit) following = entries[i].unit;
    else entries[i].unit = following;
  }
  const sizes: number[] = [];
  let duplicates = 0;
  for (const entry of entries) {
    const scale = entry.unit ? unitScale(entry.unit) : target;
    if (!scale || scale.family !== target.family) {
      skipped.push(entry.unit ? `${entry.raw} (${entry.unit})` : entry.raw);
      unitMismatch++;
      continue;
    }
    const size = tidy((entry.value * scale.factor) / target.factor);
    if (sizes.includes(size)) duplicates++;
    else sizes.push(size);
  }
  return { sizes, skipped, unitMismatch, duplicates };
}

/**
 * Moves labels apart so that none overlaps the one above it. `ys` are the
 * wanted positions from top to bottom; each result is at least `gap` below
 * the previous one and, where there is room, no lower than `max`.
 */
export function spreadLabels(ys: number[], gap: number, max: number): number[] {
  const out = [...ys];
  for (let i = 1; i < out.length; i++)
    out[i] = Math.max(out[i], out[i - 1] + gap);
  const last = out.length - 1;
  if (last >= 0 && out[last] > max) {
    out[last] = max;
    for (let i = last - 1; i >= 0; i--)
      out[i] = Math.min(out[i], out[i + 1] - gap);
  }
  return out;
}

export interface DiagramBand {
  /** Index of the band in the list that was passed in. */
  index: number;
  /** Where the band is drawn. */
  y: number;
  /** Where its label is written: `y`, unless labels had to be moved apart. */
  labelY: number;
  color: string;
  /** Thickness of the band. */
  stroke: number;
  bold: boolean;
  text: string;
}
export interface LadderDiagram {
  width: number;
  height: number;
  /** The lane the bands are drawn across. */
  x1: number;
  x2: number;
  /** Where labels start. */
  labelX: number;
  /** Bands with a usable size, largest (top) first. */
  bands: DiagramBand[];
}
const DIAGRAM = {
  width: 280,
  minHeight: 420,
  margin: 35,
  x1: 20,
  x2: 120,
  labelX: 138,
  labelGap: 15,
  maxText: 22,
};

/**
 * The ladder diagram as coordinates, shared by the on-screen SVG and the PNG
 * export. Bands are spaced by the logarithm of their size with the largest at
 * the top; bands without a positive size are left out. The drawing grows
 * taller when there are more labels than fit.
 */
export function ladderDiagram(bands: LadderBand[], unit: string): LadderDiagram {
  const usable = bands
    .map((band, index) => ({ band, index }))
    .filter(
      ({ band }) =>
        band.size != null && Number.isFinite(band.size) && band.size > 0
    )
    .sort((a, b) => (b.band.size as number) - (a.band.size as number));
  const height = Math.max(
    DIAGRAM.minHeight,
    2 * DIAGRAM.margin + (usable.length - 1) * DIAGRAM.labelGap
  );
  const span = height - 2 * DIAGRAM.margin;
  const ys = ladderPositions(usable.map(({ band }) => band.size)).map(
    (position) => DIAGRAM.margin + position * span
  );
  const labels = spreadLabels(ys, DIAGRAM.labelGap, height - DIAGRAM.margin);
  return {
    width: DIAGRAM.width,
    height,
    x1: DIAGRAM.x1,
    x2: DIAGRAM.x2,
    labelX: DIAGRAM.labelX,
    bands: usable.map(({ band, index }, i) => {
      const text = `${band.label.trim() || autoLabel(band.size)} ${unit}`.trim();
      return {
        index,
        y: ys[i],
        labelY: labels[i],
        color: band.color || defaultBandColor,
        stroke: band.highlight ? 7 : 3,
        bold: !!band.highlight,
        text:
          text.length > DIAGRAM.maxText
            ? `${text.slice(0, DIAGRAM.maxText - 1)}…`
            : text,
      };
    }),
  };
}

/** The part of a 2D canvas context the diagram is drawn with. */
export type LadderCanvas = Pick<
  CanvasRenderingContext2D,
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "font"
  | "textBaseline"
  | "fillRect"
  | "fillText"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "stroke"
  | "setTransform"
>;
const INK = "#172238";
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
/** Space above the diagram for a title, and below it for the caption. */
export const pngHeader = (title: string) => (title.trim() ? 30 : 0);
export const PNG_FOOTER = 28;

/**
 * Draws the diagram for the PNG export: always dark on white, whatever the
 * app theme, with an optional title above and a caption below. The canvas
 * must be `width × (height + pngHeader(title) + PNG_FOOTER)` times `scale`.
 */
export function paintLadder(
  c: LadderCanvas,
  diagram: LadderDiagram,
  { scale = 1, title = "", caption = "" } = {}
) {
  const header = pngHeader(title);
  // Text wider than the room it has is squeezed rather than cut off.
  const room = diagram.width - diagram.x1 - 10;
  c.setTransform(scale, 0, 0, scale, 0, 0);
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, diagram.width, diagram.height + header + PNG_FOOTER);
  c.textBaseline = "middle";
  if (header) {
    c.fillStyle = INK;
    c.font = `600 14px ${FONT}`;
    c.fillText(title.trim(), diagram.x1, 20, room);
  }
  for (const band of diagram.bands) {
    const y = band.y + header,
      labelY = band.labelY + header;
    c.strokeStyle = band.color;
    c.lineWidth = band.stroke;
    c.beginPath();
    c.moveTo(diagram.x1, y);
    c.lineTo(diagram.x2, y);
    c.stroke();
    // A leader from the band to a label that had to move.
    c.strokeStyle = "#94a3b8";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(diagram.x2 + 3, y);
    c.lineTo(diagram.labelX - 4, labelY);
    c.stroke();
    c.fillStyle = INK;
    c.font = `${band.bold ? "700" : "400"} 12px ${FONT}`;
    c.fillText(
      band.text,
      diagram.labelX,
      labelY,
      diagram.width - diagram.labelX - 6
    );
  }
  if (caption) {
    c.fillStyle = "#64748b";
    c.font = `400 10px ${FONT}`;
    c.fillText(
      caption,
      diagram.x1,
      diagram.height + header + PNG_FOOTER / 2,
      room
    );
  }
}

/**
 * The address to link to, or null when the text is not a web address. Only
 * http and https are linked: the text is typed by the user and may be synced
 * from another device, and a `javascript:` or `data:` address must never
 * become a link.
 */
export function httpUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}
