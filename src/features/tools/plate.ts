import { heatStep } from "./chartMath";
import { plainNumber } from "./format";

/**
 * Pure logic of the plate labelling tool: well coordinates and ranges, what a
 * selection has in common, applying single fields, series fills, the change
 * records behind undo, and the concentration scale.
 */

export type WellRole = "standard" | "sample" | "blank";
export const wellRoles: readonly WellRole[] = ["standard", "sample", "blank"];

/**
 * A well as it is saved. `role` and `concentration` were added after the first
 * release, so they are optional: a well saved before has neither, and a well
 * with no role or no concentration is written without the key.
 */
export type Well = {
  sample: string;
  condition: string;
  replicate: string;
  color: string;
  role?: WellRole;
  /** In the plate's concentration unit. */
  concentration?: number | null;
};
export type Wells = Record<string, Well>;

/** A well as the editor holds it: every field present. */
export type WellFields = {
  sample: string;
  condition: string;
  replicate: string;
  role: WellRole | "";
  concentration: number | null;
  color: string;
};
export type FieldKey = keyof WellFields;
export const fieldKeys: readonly FieldKey[] = [
  "sample",
  "condition",
  "replicate",
  "role",
  "concentration",
  "color",
];
export const defaultColor = "#bfdbfe";
export const emptyFields: WellFields = {
  sample: "",
  condition: "",
  replicate: "",
  role: "",
  concentration: null,
  color: defaultColor,
};

/** Reads a saved well, old or new, into editor fields. */
export function readFields(well: Partial<Well> | null | undefined): WellFields {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    sample: text(well?.sample),
    condition: text(well?.condition),
    replicate: text(well?.replicate),
    role: wellRoles.includes(well?.role as WellRole)
      ? (well?.role as WellRole)
      : "",
    concentration:
      typeof well?.concentration === "number" &&
      Number.isFinite(well.concentration)
        ? well.concentration
        : null,
    color: text(well?.color) || defaultColor,
  };
}
/**
 * A saved well with `changes` laid over it. Keys this version does not know
 * are kept, so a document touched by a newer app loses nothing here.
 */
export function patchWell(
  existing: Well | undefined,
  changes: Partial<WellFields>
): Well {
  const fields = { ...readFields(existing), ...changes };
  const next: Well = {
    ...existing,
    sample: fields.sample,
    condition: fields.condition,
    replicate: fields.replicate,
    color: fields.color,
  };
  if (fields.role) next.role = fields.role;
  else delete next.role;
  if (fields.concentration != null) next.concentration = fields.concentration;
  else delete next.concentration;
  return next;
}
/** Writes the same fields to every named well and leaves their other fields alone. */
export function applyToWells(
  wells: Wells,
  names: readonly string[],
  changes: Partial<WellFields>
): Wells {
  const next = { ...wells };
  for (const name of names) next[name] = patchWell(wells[name], changes);
  return next;
}
/** Writes each well its own fields (a series fill). */
export function patchWells(
  wells: Wells,
  patch: Record<string, Partial<WellFields>>
): Wells {
  const next = { ...wells };
  for (const [name, changes] of Object.entries(patch))
    next[name] = patchWell(wells[name], changes);
  return next;
}
export function clearWells(wells: Wells, names: readonly string[]): Wells {
  const drop = new Set(names);
  return Object.fromEntries(
    Object.entries(wells).filter(([name]) => !drop.has(name))
  );
}
/**
 * What the named wells share, field by field. A field they disagree on is
 * listed in `mixed`; its value is then empty, except the colour, which shows
 * the first well's because a colour input cannot be empty.
 */
export function commonFields(
  wells: Wells,
  names: readonly string[]
): { values: WellFields; mixed: FieldKey[] } {
  if (!names.length) return { values: { ...emptyFields }, mixed: [] };
  const all = names.map((name) => readFields(wells[name])),
    first = all[0],
    mixed = fieldKeys.filter((key) =>
      all.some((fields) => fields[key] !== first[key])
    );
  const differs = (key: FieldKey) => mixed.includes(key);
  return {
    values: {
      sample: differs("sample") ? "" : first.sample,
      condition: differs("condition") ? "" : first.condition,
      replicate: differs("replicate") ? "" : first.replicate,
      role: differs("role") ? "" : first.role,
      concentration: differs("concentration") ? null : first.concentration,
      color: first.color,
    },
    mixed,
  };
}

/** Rows and columns of each plate size. */
export const plateSizes: Record<string, readonly [number, number]> = {
  "6": [2, 3],
  "12": [3, 4],
  "24": [4, 6],
  "48": [6, 8],
  "96": [8, 12],
  "384": [16, 24],
};
export function plateShape(size: string) {
  const [rows, cols] = plateSizes[size] ?? plateSizes["96"];
  return { rows, cols };
}
export const rowLetter = (row: number) => String.fromCharCode(65 + row);
export const wellName = (row: number, col: number) =>
  `${rowLetter(row)}${col + 1}`;
export function wellPosition(name: string) {
  const match = /^([A-Z])([1-9]\d?)$/.exec(name);
  return match
    ? { row: match[1].charCodeAt(0) - 65, col: Number(match[2]) - 1 }
    : null;
}
/** Every well of a plate, row by row (A1, A2, … B1 …). */
export function wellNames(rows: number, cols: number) {
  return Array.from({ length: rows * cols }, (_, index) =>
    wellName(Math.floor(index / cols), index % cols)
  );
}
const byRow = (a: string, b: string) => {
  const p = wellPosition(a),
    q = wellPosition(b);
  return !p || !q ? a.localeCompare(b) : p.row - q.row || p.col - q.col;
};
/** Distinct wells in row order, the order every fill and export uses. */
export const sortWells = (names: Iterable<string>) =>
  [...new Set(names)].sort(byRow);
/** The rectangle of wells with `from` and `to` at opposite corners. */
export function rangeWells(from: string, to: string): string[] {
  const a = wellPosition(from),
    b = wellPosition(to);
  if (!a || !b) return [];
  const wells: string[] = [];
  for (let row = Math.min(a.row, b.row); row <= Math.max(a.row, b.row); row++)
    for (let col = Math.min(a.col, b.col); col <= Math.max(a.col, b.col); col++)
      wells.push(wellName(row, col));
  return wells;
}
export function lineWells(
  axis: "row" | "column",
  index: number,
  rows: number,
  cols: number
) {
  return axis === "row"
    ? Array.from({ length: cols }, (_, col) => wellName(index, col))
    : Array.from({ length: rows }, (_, row) => wellName(row, index));
}
/**
 * Adds `names` to the selection, or takes them out when all of them are
 * already in it.
 */
export function toggleWells(
  selected: readonly string[],
  names: readonly string[]
): string[] {
  const current = new Set(selected);
  if (names.every((name) => current.has(name))) {
    const drop = new Set(names);
    return selected.filter((name) => !drop.has(name));
  }
  return sortWells([...selected, ...names]);
}

/**
 * A focusable place in the grid. Row −1 is the column headers and column −1
 * the row headers; the corner between them is not a cell.
 */
export type Cell = { row: number; col: number };
/** Where a navigation key leads from `cell`, or null when the key is not one. */
export function moveCell(
  cell: Cell,
  key: string,
  rows: number,
  cols: number,
  toEdge = false
): Cell | null {
  const clamp = (next: Cell): Cell => {
    const row = Math.min(rows - 1, Math.max(-1, next.row)),
      col = Math.min(cols - 1, Math.max(-1, next.col));
    // Stepping into the corner stays where it was.
    return row === -1 && col === -1 ? cell : { row, col };
  };
  switch (key) {
    case "ArrowLeft":
      return clamp({ row: cell.row, col: cell.col - 1 });
    case "ArrowRight":
      return clamp({ row: cell.row, col: cell.col + 1 });
    case "ArrowUp":
      return clamp({ row: cell.row - 1, col: cell.col });
    case "ArrowDown":
      return clamp({ row: cell.row + 1, col: cell.col });
    // Home and End go to the ends of the row; with Ctrl, of the whole plate.
    case "Home":
      return clamp({ row: toEdge ? 0 : cell.row, col: 0 });
    case "End":
      return clamp({ row: toEdge ? rows - 1 : cell.row, col: cols - 1 });
    default:
      return null;
  }
}

export type FillDirection = "row" | "column";
/**
 * A dilution series over the selected wells. With "row" the left-most selected
 * column holds `start` and each selected column to its right is `factor` times
 * more dilute; every selected row gets the same series, so the rows are
 * replicates. "column" runs it down instead. A well's step is the rank of its
 * column (or row) among those that have a selected well, so the same column
 * holds the same concentration in every row.
 */
export function dilutionSeries(
  names: readonly string[],
  start: number,
  factor: number,
  direction: FillDirection
): Record<string, number> {
  if (!Number.isFinite(start) || start <= 0)
    throw Error("Concentration must be positive");
  if (!Number.isFinite(factor) || factor <= 1)
    throw Error("Serial dilution factor must exceed 1");
  const placed = names.flatMap((name) => {
    const position = wellPosition(name);
    return position
      ? [{ name, at: direction === "row" ? position.col : position.row }]
      : [];
  });
  const steps = [...new Set(placed.map((well) => well.at))].sort(
    (a, b) => a - b
  );
  return Object.fromEntries(
    placed.map(({ name, at }) => {
      const value = Number(
        (start / factor ** steps.indexOf(at)).toPrecision(12)
      );
      if (!Number.isFinite(value) || value <= 0)
        throw Error("Result is not finite");
      return [name, value];
    })
  );
}
/**
 * Numbered samples with replicates: the wells are walked along the rows
 * ("row": A1, A2, … B1) or down the columns ("column": A1, B1, … A2), each
 * `replicates` wells in a row take the next number, and the wells of one
 * sample are numbered 1 … `replicates`. With one replicate the replicate
 * field is left as it is.
 */
export function numberedSamples(
  names: readonly string[],
  options: {
    prefix: string;
    first: number;
    replicates: number;
    direction: FillDirection;
  }
): Record<string, { sample: string; replicate?: string }> {
  const { prefix, first, replicates, direction } = options;
  if (!Number.isInteger(replicates) || replicates < 1)
    throw Error("Replicates must be a whole number of 1 or more");
  if (!Number.isInteger(first) || first < 0)
    throw Error("Start number must be a whole number of 0 or more");
  const order = sortWells(names);
  if (direction === "column")
    order.sort((a, b) => {
      const p = wellPosition(a),
        q = wellPosition(b);
      return !p || !q ? 0 : p.col - q.col || p.row - q.row;
    });
  return Object.fromEntries(
    order.map((name, index) => [
      name,
      {
        sample: `${prefix}${first + Math.floor(index / replicates)}`,
        ...(replicates > 1
          ? { replicate: String((index % replicates) + 1) }
          : {}),
      },
    ])
  );
}

/**
 * One undoable change: the wells it touched, as they were and as they became.
 * A missing side means the well did not exist then. Only the touched wells are
 * recorded, so undoing does not disturb wells changed elsewhere since.
 */
export type WellChange = Record<string, { before?: Well; after?: Well }>;
const sameWell = (a: Well | undefined, b: Well | undefined) => {
  if (!a || !b) return a === b;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<
    keyof Well
  >;
  return [...keys].every((key) => a[key] === b[key]);
};
export function diffWells(before: Wells, after: Wells): WellChange {
  const change: WellChange = {};
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)]))
    if (!sameWell(before[name], after[name]))
      change[name] = {
        ...(before[name] ? { before: before[name] } : {}),
        ...(after[name] ? { after: after[name] } : {}),
      };
  return change;
}
/** Puts the touched wells back to one side of a change: "before" undoes it. */
export function applyChange(
  wells: Wells,
  change: WellChange,
  side: "before" | "after"
): Wells {
  const next = { ...wells };
  for (const [name, sides] of Object.entries(change)) {
    const well = sides[side];
    if (well) next[name] = well;
    else delete next[name];
  }
  return next;
}
export const invertChange = (change: WellChange): WellChange =>
  Object.fromEntries(
    Object.entries(change).map(([name, { before, after }]) => [
      name,
      {
        ...(after ? { before: after } : {}),
        ...(before ? { after: before } : {}),
      },
    ])
  );

/**
 * True when the values read better on a logarithmic scale: at least three
 * distinct positive values spanning a decade or more, spaced more evenly as
 * ratios than as differences (a dilution series). On a linear scale such a
 * series puts everything but its top two or three steps in the lightest shade.
 */
function readsBetterOnLog(values: readonly number[]) {
  if (values.some((value) => value < 0)) return false;
  const distinct = [...new Set(values.filter((value) => value > 0))].sort(
    (a, b) => a - b
  );
  if (distinct.length < 3 || distinct[distinct.length - 1] / distinct[0] < 10)
    return false;
  // Unevenness of the gaps between neighbours: their standard deviation over their mean.
  const unevenness = (points: number[]) => {
    const gaps = points.slice(1).map((point, index) => point - points[index]),
      mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    return (
      Math.sqrt(
        gaps.reduce((sum, gap) => sum + (gap - mean) ** 2, 0) / gaps.length
      ) / mean
    );
  };
  return unevenness(distinct.map(Math.log10)) < unevenness(distinct);
}
export type ConcentrationScale = {
  /** The ends of the scale. On a log scale `min` is the smallest positive value. */
  min: number;
  max: number;
  log: boolean;
  /** True when a zero sits below `min` on a log scale and is drawn in the lightest step. */
  belowMin: boolean;
  /** The heat step (0 … 6) of a value, or null when it has none. */
  step: (value: number | null | undefined) => number | null;
};
/** The scale for a concentration view of these values, or null when there are none. */
export function concentrationScale(
  values: readonly number[]
): ConcentrationScale | null {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return null;
  const log = readsBetterOnLog(finite),
    scaled = (value: number) => (log ? Math.log10(value) : value),
    inRange = log ? finite.filter((value) => value > 0) : finite,
    min = Math.min(...inRange),
    max = Math.max(...inRange),
    low = scaled(min),
    high = scaled(max);
  return {
    min,
    max,
    log,
    belowMin: inRange.length < finite.length,
    step: (value) => {
      if (value == null || !Number.isFinite(value)) return null;
      if (log && value <= 0) return 0;
      if (high === low) return heatStep(value, min, max);
      // An evenly spaced series lands exactly on the edges between steps,
      // where rounding error would send neighbours up or down at random. The
      // nudge sends every edge value to the step above it.
      return heatStep((scaled(value) - low) / (high - low) + 1e-9, 0, 1);
    },
  };
}

/**
 * A number short enough to print inside a well: four significant digits, or
 * powers of ten outside 0.001 … 100000. The exact value is in the well's
 * label and in the list.
 */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (value === 0) return "0";
  const size = Math.abs(value);
  if (size >= 1e5 || size < 1e-3)
    return value
      .toExponential(2)
      .replace(/\.?0+e/, "e")
      .replace("e+", "e");
  return size >= 1000
    ? String(Math.round(value))
    : String(Number(value.toPrecision(4)));
}

/**
 * The rows sent to the calibration curve: one per well that has a role, in
 * row order, as `[role, name, concentration]`. The name is "A1" or
 * "A1 · sample"; the concentration is plain text, empty when the well has none.
 */
export function calibrationRows(
  wells: Wells,
  names: readonly string[]
): string[][] {
  return names.flatMap((name) => {
    if (!wells[name]) return [];
    const fields = readFields(wells[name]),
      sample = fields.sample.trim();
    return fields.role
      ? [
          [
            fields.role,
            sample ? `${name} · ${sample}` : name,
            fields.concentration == null
              ? ""
              : plainNumber(fields.concentration),
          ],
        ]
      : [];
  });
}
