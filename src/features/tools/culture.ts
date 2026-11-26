/**
 * Cell counting and cell culture apart from the screens: the reference data
 * the two tools offer (counting chambers, culture vessels) with where every
 * figure comes from, and the arithmetic around a count, a growth estimate and
 * the passage log. Pure: no React and no storage.
 */
import { niceTicks } from "./chartMath";
import { need, plainNumber } from "./format";
import {
  growthHours,
  positive,
  type CultureProfile,
  type Vessel,
} from "./labMath";

/** Where a set of reference figures was read. Shown next to the figures. */
export interface Source {
  name: string;
  url: string;
}
const same = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));

// ---------------------------------------------------------------------------
// Counting chambers
// ---------------------------------------------------------------------------

/**
 * The maker's table of rulings: squares, their side, the chamber depth and the
 * volume above one square (read 2026-11-27). A ruling is listed only when that
 * table prints the volume. Thoma, Malassez and Nageotte are described there in
 * words without one, so they are left out and the tool takes a typed volume.
 */
export const CHAMBER_SOURCE: Source = {
  name: "Marienfeld Superior, Neubauer Counting Chamber and Counting Grids",
  url: "https://www.marienfeld-superior.com/counting-grids.html",
};
export interface ChamberPreset {
  id: string;
  /** The ruling, as its maker names it. */
  ruling: string;
  /** Which square of the ruling one counted square is. */
  square: "large" | "group";
  sideMm: number;
  depthMm: number;
  /** Volume above one such square in µL (mm³), as the table prints it. */
  volumeUl: number;
}
export const chamberPresets: readonly ChamberPreset[] = [
  {
    id: "neubauer-improved",
    ruling: "Neubauer improved",
    square: "large",
    sideMm: 1,
    depthMm: 0.1,
    volumeUl: 0.1,
  },
  {
    // One of the 25 group squares of a large square; for small, dense cells.
    id: "neubauer-improved-group",
    ruling: "Neubauer improved",
    square: "group",
    sideMm: 0.2,
    depthMm: 0.1,
    volumeUl: 0.004,
  },
  {
    id: "neubauer",
    ruling: "Neubauer",
    square: "large",
    sideMm: 1,
    depthMm: 0.1,
    volumeUl: 0.1,
  },
  {
    id: "burker",
    ruling: "Bürker",
    square: "large",
    sideMm: 1,
    depthMm: 0.1,
    volumeUl: 0.1,
  },
  {
    id: "burker-turk",
    ruling: "Bürker-Türk",
    square: "large",
    sideMm: 1,
    depthMm: 0.1,
    volumeUl: 0.1,
  },
  {
    id: "fuchs-rosenthal",
    ruling: "Fuchs-Rosenthal",
    square: "large",
    sideMm: 1,
    depthMm: 0.2,
    volumeUl: 0.2,
  },
];
export const DEFAULT_CHAMBER = "neubauer-improved";
/** µL to the mL a count document stores, without binary residue. */
export const millilitresOf = (microlitres: number) =>
  Number(plainNumber(microlitres / 1000));
export const microlitresOf = (millilitres: number) =>
  Number(plainNumber(millilitres * 1000));
/**
 * The preset a count is on: the chosen one, for as long as the stored volume
 * is still that preset's. A volume typed over it (here, or in a build of the
 * app that has no presets) makes the count a custom one.
 */
export function chamberOf(
  id: unknown,
  volumeMl: number | null | undefined
): ChamberPreset | undefined {
  const preset = chamberPresets.find((row) => row.id === id);
  return preset &&
    volumeMl != null &&
    same(millilitresOf(preset.volumeUl), volumeMl)
    ? preset
    : undefined;
}
/**
 * Cells per mL that one counted cell stands for before dilution: 1 ÷ the
 * volume above a square. 0.1 µL = 10⁻⁴ mL gives the familiar × 10⁴.
 */
export const cellsPerMlFactor = (volumeMl: number) =>
  Number(plainNumber(1 / volumeMl));

// ---------------------------------------------------------------------------
// A count
// ---------------------------------------------------------------------------

/**
 * How evenly the squares were loaded: the mean count of a square and the
 * coefficient of variation (sample standard deviation ÷ mean, in %). With one
 * square, or nothing counted, there is no spread to report.
 */
export function countSpread(counts: readonly number[]) {
  const n = counts.length,
    mean = n ? counts.reduce((sum, value) => sum + value, 0) / n : 0;
  if (n < 2 || mean === 0) return { mean, cv: null };
  const variance =
    counts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  return { mean, cv: (100 * Math.sqrt(variance)) / mean };
}
export const VOLUME_UNITS = ["mL", "µL", "L"] as const;
/** mL per unit as a fraction, so 500 µL is 500 ÷ 1000 and not 500 × 0.001. */
const ML: Record<string, [times: number, over: number]> = {
  mL: [1, 1],
  µL: [1, 1000],
  L: [1000, 1],
};
/** Cells in a suspension of the given volume at `perMl` cells per mL. */
export function totalCells(perMl: number, volume: number, unit: string) {
  const ratio = ML[unit];
  if (!ratio || !Number.isFinite(perMl)) throw Error("Invalid unit or value");
  if (!Number.isFinite(volume) || volume < 0)
    throw Error("Enter non-negative values");
  return (perMl * volume * ratio[0]) / ratio[1];
}
const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";
/**
 * A cell number the way a notebook writes it: "1.96 × 10⁶". Below 10,000 the
 * number itself, to the same significant digits.
 */
export function scientific(value: number, digits = 3) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1e4) return plainNumber(value, digits);
  const [mantissa, exponent] = value.toExponential(digits - 1).split("e");
  return `${mantissa} × 10${[...String(Number(exponent))]
    .map((digit) => SUPERSCRIPT[Number(digit)])
    .join("")}`;
}
/** A percentage to one decimal: 90.909… is 90.9. */
export const oneDecimal = (value: number) => Number(value.toFixed(1));
/**
 * A cell density another tool sent, in cells per mL; null when its unit is
 * not one this can read, so the value is not taken at a wrong scale.
 */
export function densityPerMl(value: number, unit: string): number | null {
  const per = unit.replace(/\s+/g, "").toLowerCase();
  const scale: Record<string, number> = {
    "cells/ml": 1,
    "cells/µl": 1000,
    "cells/μl": 1000,
    "cells/ul": 1000,
    "cells/l": 0.001,
  };
  return per in scale && Number.isFinite(value) && value > 0
    ? Number(plainNumber(value * scale[per]))
    : null;
}

// ---------------------------------------------------------------------------
// Culture vessels
// ---------------------------------------------------------------------------

/**
 * Growth area and growth-medium volume per vessel from the supplier's table
 * (read 2026-11-27; the 384- and 1536-well rows are left out). For a plate
 * both figures are for one well. Other makers' vessels of the same name
 * differ by a few percent, so the tool lets every figure be changed.
 */
export const VESSEL_SOURCE: Source = {
  name: "Thermo Fisher Scientific, Useful Numbers for Cell Culture",
  url: "https://www.thermofisher.com/us/en/home/references/gibco-cell-culture-basics/cell-culture-protocols/cell-culture-useful-numbers.html",
};
export interface VesselPreset {
  id: string;
  /** The vessel as the table names it. */
  name: string;
  kind: "dish" | "plate" | "flask";
  /** Growth area in cm²; of one well for a plate. */
  area: number;
  /** Growth medium in mL, lowest and highest the table gives. */
  medium: readonly [min: number, max: number];
}
export const vesselPresets: readonly VesselPreset[] = [
  { id: "dish-35", name: "35 mm", kind: "dish", area: 8.8, medium: [2, 2] },
  { id: "dish-60", name: "60 mm", kind: "dish", area: 21.5, medium: [5, 5] },
  { id: "dish-100", name: "100 mm", kind: "dish", area: 56.7, medium: [12, 12] },
  { id: "dish-150", name: "150 mm", kind: "dish", area: 145, medium: [30, 30] },
  { id: "plate-6", name: "6-well", kind: "plate", area: 9.6, medium: [1, 3] },
  { id: "plate-12", name: "12-well", kind: "plate", area: 3.5, medium: [1, 2] },
  { id: "plate-24", name: "24-well", kind: "plate", area: 1.9, medium: [0.5, 1] },
  { id: "plate-48", name: "48-well", kind: "plate", area: 1.1, medium: [0.2, 0.4] },
  { id: "plate-96", name: "96-well", kind: "plate", area: 0.32, medium: [0.1, 0.2] },
  { id: "t25", name: "T-25", kind: "flask", area: 25, medium: [3, 5] },
  { id: "t75", name: "T-75", kind: "flask", area: 75, medium: [8, 15] },
  { id: "t175", name: "T-175", kind: "flask", area: 175, medium: [35, 53] },
  { id: "t225", name: "T-225", kind: "flask", area: 225, medium: [45, 68] },
];
/**
 * The volume a preset fills in: the top of the table's range. The range stays
 * on screen beside the field, and the field can be changed.
 */
export const presetVolume = (preset: VesselPreset) => preset.medium[1];
export const mediumRange = (preset: VesselPreset) =>
  preset.medium[0] === preset.medium[1]
    ? plainNumber(preset.medium[0])
    : `${plainNumber(preset.medium[0])}–${plainNumber(preset.medium[1])}`;
/** The preset a vessel is on, for as long as its area is still the preset's. */
export function vesselPresetOf(
  id: unknown,
  area: number | null | undefined
): VesselPreset | undefined {
  const preset = vesselPresets.find((row) => row.id === id);
  return preset && area === preset.area ? preset : undefined;
}

// ---------------------------------------------------------------------------
// Stored culture inputs
// ---------------------------------------------------------------------------

type Nullable<T, K extends keyof T> = Omit<T, K> & { [P in K]: T[P] | null };
/** A profile as a document holds it: a number field left empty is null. */
export type StoredProfile = Nullable<
  CultureProfile,
  "doublingHours" | "density" | "maxDensity"
>;
export type StoredVessel = Nullable<
  Vessel,
  "area" | "volume" | "count" | "target"
> & {
  /** Id of the vessel preset the figures came from, when one was chosen. */
  preset?: string;
};
/**
 * The profile for a seeding calculation. Only the density this culture type
 * uses has to be filled in; the doubling time plays no part in seeding.
 */
export function seedingProfile(profile: StoredProfile): CultureProfile {
  const adherent = profile.kind === "adherent";
  return {
    kind: profile.kind,
    doublingHours: profile.doublingHours ?? 0,
    density: adherent ? need(profile.density) : profile.density ?? 0,
    maxDensity: adherent ? profile.maxDensity ?? 0 : need(profile.maxDensity),
  };
}
/** A vessel for a seeding calculation. The area is asked for only when the target uses it. */
export function seedingVessel(vessel: StoredVessel): Vessel {
  const byArea = vessel.mode === "confluence" || vessel.mode === "cells/cm2";
  return {
    id: vessel.id,
    name: vessel.name,
    mode: vessel.mode,
    area: byArea ? need(vessel.area) : vessel.area ?? 0,
    volume: need(vessel.volume),
    count: need(vessel.count),
    target: need(vessel.target),
  };
}

// ---------------------------------------------------------------------------
// Growth estimate
// ---------------------------------------------------------------------------

/**
 * Hours until the culture reaches `target`, doubling every `doublingHours`
 * without a lag phase, and the ceiling the model stops at: 100% confluence
 * for adherent cells, the cell line's maximum density in suspension.
 */
export function growthPlan(
  profile: Pick<CultureProfile, "kind" | "doublingHours" | "maxDensity">,
  start: number,
  target: number
) {
  const hours = growthHours(start, target, profile.doublingHours);
  if (profile.kind === "adherent") {
    if (target > 100) throw Error("Confluence cannot exceed 100%");
    return { hours, cap: 100 };
  }
  positive(profile.maxDensity);
  if (target > profile.maxDensity)
    throw Error("Density cannot exceed the maximum density");
  return { hours, cap: profile.maxDensity };
}
/** The model's value `hours` from now, never above the ceiling. */
export const growthValue = (
  start: number,
  doublingHours: number,
  hours: number,
  cap: number
) => Math.min(cap, start * 2 ** (hours / doublingHours));
export interface GrowthCurve {
  /** Hours until the target is reached. */
  hours: number;
  /** Hours the curve covers: a little past the target, or up to the ceiling. */
  end: number;
  points: { hours: number; value: number }[];
}
/**
 * The estimate as a curve from now until a quarter past the time the target
 * is reached, or until the ceiling when that comes first. The target time is
 * one of the points, so it can be read off the plot.
 */
export function growthCurve(
  start: number,
  target: number,
  doublingHours: number,
  cap: number,
  samples = 40
): GrowthCurve {
  const hours = growthHours(start, target, doublingHours),
    toCap = doublingHours * Math.log2(cap / start),
    end = Math.max(hours, Math.min(hours * 1.25, toCap));
  const times = new Set<number>([hours]);
  for (let i = 0; i <= samples; i++) times.add((end * i) / samples);
  return {
    hours,
    end,
    points: [...times]
      .sort((a, b) => a - b)
      .map((time) => ({
        hours: time,
        // Exactly the target at the target time, not 79.99999999999999.
        value:
          time === hours
            ? target
            : growthValue(start, doublingHours, time, cap),
      })),
  };
}
/**
 * The same estimate at round times for a table: now, every round step up to
 * the end of the curve, and the moment the target is reached.
 */
export function growthTable(
  curve: Pick<GrowthCurve, "hours" | "end">,
  start: number,
  target: number,
  doublingHours: number,
  cap: number
) {
  const times = new Set<number>([0, curve.hours]);
  for (const tick of niceTicks(0, curve.end, 6))
    if (tick > 0 && tick <= curve.end && !same(tick, curve.hours))
      times.add(tick);
  return [...times]
    .sort((a, b) => a - b)
    .map((time) => ({
      hours: time,
      value:
        time === curve.hours
          ? target
          : growthValue(start, doublingHours, time, cap),
      reached: time === curve.hours,
    }));
}

// ---------------------------------------------------------------------------
// Passage log
// ---------------------------------------------------------------------------

export interface Passage {
  id: string;
  number: number;
  /** When the passage was done (ISO). */
  at: string;
  medium: string;
  antibiotics: string;
  conditions: string;
  notes: string;
  /** The seeding calculation done with it, or null. */
  snapshot: unknown;
}
export const MAX_PASSAGE = 9999;
/** A typed passage number: a whole number from 0. */
export function passageNumber(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_PASSAGE)
    throw Error("Passage number must be a whole number from 0 to 9999");
  return value;
}
export const latestPassage = (passages: readonly Pick<Passage, "number">[]) =>
  passages.length ? Math.max(...passages.map((row) => row.number)) : null;
/**
 * The number the next record gets: one after the highest recorded, or the
 * starting number (0 when none was given) while the log is empty.
 */
export function nextPassageNumber(
  passages: readonly Pick<Passage, "number">[],
  start: number | null | undefined
) {
  const latest = latestPassage(passages);
  return latest == null
    ? typeof start === "number" && Number.isInteger(start) && start >= 0
      ? start
      : 0
    : latest + 1;
}
const moment = (iso: string) => {
  const value = +new Date(iso);
  return Number.isFinite(value) ? value : 0;
};
/** Newest first by the date of the passage, then by number. */
export const sortPassages = <T extends Pick<Passage, "number" | "at">>(
  passages: readonly T[]
): T[] =>
  [...passages].sort(
    (a, b) => moment(b.at) - moment(a.at) || b.number - a.number
  );
const two = (value: number) => String(value).padStart(2, "0");
/** A moment as the value of a `datetime-local` field, in local time. */
export const localInput = (date: Date) =>
  `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(
    date.getHours()
  )}:${two(date.getMinutes())}`;
/** The value of a `datetime-local` field as an ISO moment. */
export function fromLocalInput(text: string) {
  const date = new Date(text);
  if (!text.trim() || !Number.isFinite(+date))
    throw Error("Enter a valid date and time");
  return date.toISOString();
}
/** A moment for a CSV cell, in local time: 2026-11-27 09:05. */
export const localStamp = (iso: string) => {
  const date = new Date(iso);
  return Number.isFinite(+date) ? localInput(date).replace("T", " ") : "";
};
/**
 * The seeding calculation saved with a passage, as one line: the vessels with
 * the stock and medium each takes. Empty for a record without one.
 */
export function snapshotSummary(snapshot: unknown) {
  const saved = snapshot as {
    concentration?: unknown;
    result?: { rows?: unknown };
  } | null;
  const rows = Array.isArray(saved?.result?.rows)
    ? (saved.result.rows as Record<string, unknown>[])
    : [];
  const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value)
      ? plainNumber(value, 6)
      : "?";
  return {
    concentration:
      typeof saved?.concentration === "number" ? saved.concentration : "",
    vessels: rows
      .map(
        (row) =>
          `${String(row.name ?? "")} ×${number(row.count)}: ${number(
            row.stock
          )} + ${number(row.medium)} mL`
      )
      .join("; "),
  };
}
/** The passage log as CSV rows, oldest first, under the given headers. */
export function passageCsvRows(
  passages: readonly Passage[],
  headers: readonly string[]
): (string | number)[][] {
  return [
    [...headers],
    ...sortPassages(passages)
      .reverse()
      .map((row) => {
        const seeding = snapshotSummary(row.snapshot);
        return [
          row.number,
          localStamp(row.at),
          row.medium,
          row.antibiotics,
          row.conditions,
          row.notes,
          seeding.concentration,
          seeding.vessels,
        ];
      }),
  ];
}
