import { dilution, positive } from "./labMath";
import { units, convertUnit } from "./units";

/** The quantity of C1·V1 = C2·V2 that is asked for. */
export type DilutionSolve = "stockVolume" | "target" | "volume";
export const dilutionSolves: readonly DilutionSolve[] = [
  "stockVolume",
  "target",
  "volume",
];
/**
 * Strength of a concentrate ("10X buffer"). It says how many times stronger
 * than the working solution something is, so it converts only to itself. It
 * is not in the shared unit table, and the tool does not store it in a unit
 * field: builds from before it look every stored unit up in that table.
 */
export const foldUnit = "X";
export const dilutionConcentrationUnits: readonly string[] = [
  "M",
  "mM",
  "µM",
  "nM",
  "g/L",
  "mg/mL",
  "µg/mL",
  "% w/v",
  foldUnit,
];
export const dilutionVolumeUnits: readonly string[] = ["L", "mL", "µL", "nL"];

const family = (unit: string) =>
  unit === foldUnit ? "fold" : units[unit]?.dimension;
/** Target units a stock unit can be paired with: X only with X. */
export const targetUnitsFor = (stockUnit: string) =>
  dilutionConcentrationUnits.filter(
    (unit) => (unit === foldUnit) === (stockUnit === foldUnit)
  );
/** True when one side is molar and the other is mass per volume. */
export const needsMolecularWeight = (a: string, b: string) =>
  a !== foldUnit && b !== foldUnit && family(a) !== family(b);
/**
 * The target unit after the stock unit changed between molar and mass per
 * volume. A target that was in the stock's family moves with it; one
 * deliberately set to the other family (mM stock, mg/mL target) stays.
 */
export const followStockUnit = (
  previousStock: string,
  stock: string,
  target: string
) =>
  family(previousStock) === family(target) && family(stock) !== family(target)
    ? stock
    : target;
export function convertConcentration(
  value: number,
  from: string,
  to: string,
  mw?: number
) {
  if (from === foldUnit || to === foldUnit) {
    if (from !== to) throw Error("Incompatible dimensions");
    return value;
  }
  // The same unit is returned untouched, so a typed 0.3 stays 0.3.
  return from === to && units[from] ? value : convertUnit(value, from, to, mw);
}
export const convertVolume = (value: number, from: string, to: string) =>
  from === to && units[from] ? value : convertUnit(value, from, to);

const unitAliases = new Map([
  ["mol/L", "M"],
  ["mmol/L", "mM"],
  ["µmol/L", "µM"],
  ["nmol/L", "nM"],
  ["mg/L", "µg/mL"],
  ["ng/µL", "µg/mL"],
  ["µg/µL", "mg/mL"],
  ["x", foldUnit],
  ["×", foldUnit],
]);
/**
 * The unit of this tool that a unit written elsewhere means, or null. Only
 * spellings of the same size are matched ("ng/µL" is µg/mL); a unit that
 * would need its number rescaled is not guessed at.
 */
export function matchConcentrationUnit(unit: string): string | null {
  // The units here use the micro sign (U+00B5). Greek mu (U+03BC) and a
  // plain "u" are both written for it.
  const text = unit
    .trim()
    .replace(/\u03bc/g, "\u00b5")
    .replace(/(^|\/)u(?=[MgL])/g, "$1\u00b5");
  return (
    dilutionConcentrationUnits.find((known) => known === text) ??
    unitAliases.get(text) ??
    null
  );
}

/**
 * C1·V1 = C2·V2 solved for the quantity left out. Concentrations share one
 * unit and volumes another; the result is in those units.
 *
 * The target can be given as `fold` (a "1 : N" dilution, N = C1 ÷ C2) instead
 * of a concentration. The stock concentration is then optional: without it
 * the volumes are still exact and the concentrations are only relative, with
 * the stock counted as N and the dilution as 1 (`relative`).
 */
export function solveDilution(
  solve: DilutionSolve,
  known: {
    stock?: number;
    target?: number;
    fold?: number;
    stockVolume?: number;
    volume?: number;
  }
) {
  const byFold = solve !== "target" && known.fold != null;
  const relative = byFold && known.stock == null;
  let stock = known.stock ?? NaN,
    target = known.target ?? NaN,
    stockVolume = known.stockVolume ?? NaN,
    volume = known.volume ?? NaN;
  if (byFold) {
    const fold = known.fold!;
    positive(fold);
    if (fold < 1) throw Error("Dilution factor must be at least 1");
    if (relative) stock = fold;
    positive(stock);
    target = stock / fold;
  }
  if (solve === "target") {
    positive(stock, stockVolume, volume);
    if (stockVolume > volume) throw Error("Stock volume exceeds final volume");
    target = (stock * stockVolume) / volume;
  } else if (solve === "volume") {
    positive(stock, target, stockVolume);
    if (target > stock) throw Error("Target exceeds stock concentration");
    volume = (stock * stockVolume) / target;
  }
  const forward = dilution(stock, target, volume);
  if (solve === "stockVolume") stockVolume = forward.stockVolume;
  return {
    stock,
    target,
    stockVolume,
    volume,
    diluentVolume: volume - stockVolume,
    fold: forward.factor,
    relative,
  };
}

/** Below this, common micropipettes are no longer reliable. In litres. */
export const minimumPipetteVolume = 0.5e-6;
/** What an intermediate dilution is planned to pipette at least. */
const comfortableVolume = 2e-6;
// Volumes arrive through unit conversions; a value that is the limit except
// for floating-point residue counts as the limit.
const below = (value: number, limit: number) => value < limit * (1 - 1e-9);

export type PipettingAdvice =
  | {
      kind: "intermediate";
      /** How many times more dilute than the stock the intermediate is. */
      fold: number;
      /** Dilutions that make it: one, or this many 10-fold ones. */
      steps: number;
      /** Per step: taken from the solution before it, and diluent added. */
      takeVolume: number;
      diluentVolume: number;
      /** Volume of the intermediate that replaces the stock volume. */
      transferVolume: number;
      finalDiluentVolume: number;
    }
  | { kind: "larger-volume"; minimumVolume: number };
/**
 * What to do when the stock volume is too small to pipette. Volumes in
 * litres. The stock is first diluted by a power of ten chosen so that at
 * least 2 µL of that intermediate goes into the final volume. When the final
 * volume is too small for that, the advice is the smallest final volume that
 * takes 0.5 µL of stock.
 */
export function pipettingAdvice(
  stockVolume: number,
  volume: number
): PipettingAdvice | null {
  if (
    !(stockVolume > 0) ||
    !(volume > 0) ||
    !below(stockVolume, minimumPipetteVolume)
  )
    return null;
  let power = 1;
  while (below(stockVolume * 10 ** power, comfortableVolume) && power < 30)
    power++;
  const fold = 10 ** power,
    transferVolume = stockVolume * fold;
  // The intermediate has to stay more concentrated than the final solution.
  if (!below(transferVolume, volume))
    return {
      kind: "larger-volume",
      minimumVolume: (minimumPipetteVolume * volume) / stockVolume,
    };
  // Up to 1 : 1000 is one step from 2 µL of stock (2 µL in 2 mL). Beyond
  // that it is made 10-fold at a time, 10 µL into 90 µL.
  const single = power <= 3;
  return {
    kind: "intermediate",
    fold,
    steps: single ? 1 : power,
    takeVolume: single ? comfortableVolume : 10e-6,
    diluentVolume: single ? comfortableVolume * (fold - 1) : 90e-6,
    transferVolume,
    finalDiluentVolume: volume - transferVolume,
  };
}
/** A volume in litres in the unit a person would say it in (198 µL, 2 mL). */
export function readableVolume(litres: number) {
  const unit =
    ["L", "mL", "µL"].find(
      (candidate) => !below(Math.abs(litres), units[candidate].factor)
    ) ?? "nL";
  return { value: litres / units[unit].factor, unit };
}
