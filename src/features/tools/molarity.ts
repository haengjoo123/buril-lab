import { parseNumber, plainNumber } from "./format";
import { convertUnit } from "./units";

export type MolarityBasis = "mass" | "amount" | "massConcentration";
export type MolarityTarget =
  | "concentration"
  | "mass"
  | "volume"
  | "mw"
  | "amount"
  | "massConcentration";
export const molarityTargets: Record<MolarityBasis, readonly MolarityTarget[]> =
  {
    mass: ["concentration", "mass", "volume", "mw"],
    amount: ["concentration", "amount", "volume"],
    massConcentration: ["concentration", "massConcentration", "mw"],
  };
export const molarityUnits: Record<MolarityTarget, readonly string[]> = {
  concentration: ["M", "mM", "µM", "nM"],
  mass: ["g", "mg", "µg", "ng"],
  volume: ["L", "mL", "µL", "nL"],
  mw: ["g/mol", "kDa"],
  amount: ["mol", "mmol", "µmol"],
  massConcentration: ["g/L", "mg/mL", "µg/mL", "% w/v"],
};
export const molarityBaseUnits: Record<MolarityTarget, string> = {
  concentration: "M",
  mass: "g",
  volume: "L",
  mw: "g/mol",
  amount: "mol",
  massConcentration: "g/L",
};
// 1 Da is 1 g/mol, so a protein of 66.5 kDa weighs 66 500 g/mol.
const molecularWeightFactors: Record<string, number> = {
  "g/mol": 1,
  kDa: 1000,
};
function molecularWeightFactor(unit: string, value: number) {
  const factor = molecularWeightFactors[unit];
  if (!factor || !Number.isFinite(value)) throw Error("Invalid unit or value");
  return factor;
}
/** A value in one of `molarityUnits[key]` as the engine's base unit. */
export function toMolarityBase(
  key: MolarityTarget,
  value: number,
  unit: string
) {
  return key === "mw"
    ? value * molecularWeightFactor(unit, value)
    : convertUnit(value, unit, molarityBaseUnits[key]);
}
/** The engine's base-unit value in one of `molarityUnits[key]`. */
export function fromMolarityBase(
  key: MolarityTarget,
  value: number,
  unit: string
) {
  return key === "mw"
    ? value / molecularWeightFactor(unit, value)
    : convertUnit(value, molarityBaseUnits[key], unit);
}
/**
 * What to store for a molecular weight typed in `unit`. The stored `mw` is
 * always g/mol, which is how builds from before kDa read it, so a weight
 * typed in kDa is stored converted, with the text as typed beside it.
 */
export function storeMolecularWeight(text: string, unit: string) {
  if (unit !== "kDa") return { mw: text, mwTyped: "" };
  const kilodaltons = parseNumber(text);
  return {
    mw: kilodaltons == null ? "" : plainNumber(kilodaltons * 1000),
    mwTyped: text,
  };
}
/**
 * The text of the molecular weight field in `unit`, from what
 * `storeMolecularWeight` stored. When the typed kDa text no longer matches
 * the g/mol value, an older build has edited that value since, and it counts.
 */
export function molecularWeightText(mw: string, unit: string, typed: string) {
  if (unit !== "kDa") return mw;
  const grams = parseNumber(mw),
    kilodaltons = parseNumber(typed);
  if (
    kilodaltons == null
      ? grams == null
      : grams != null &&
        Math.abs(kilodaltons * 1000 - grams) <= 1e-9 * Math.abs(grams)
  )
    return typed;
  return grams == null ? mw : plainNumber(grams / 1000);
}
/** The solute in a weighed mass of a reagent that is `purity` % pure. */
export function pureMass(mass: number, purity: number) {
  if (!Number.isFinite(purity) || purity <= 0 || purity > 100)
    throw Error("Purity must be between 0 and 100");
  return (mass * purity) / 100;
}
/**
 * Molarity is based on final solution volume. Inputs and return value use the
 * base units above.
 *
 * `purity` (%) applies where a mass is weighed: only that fraction of the
 * weighed reagent is solute. A mass that is solved for is the mass to weigh
 * (pure mass ÷ purity); a mass that is given counts as mass × purity. Water
 * of crystallisation is not purity: a hydrate is handled by entering its
 * formula weight as the molecular weight.
 */
export function solveMolarity(
  basis: MolarityBasis,
  target: MolarityTarget,
  values: Record<MolarityTarget, number>,
  purity = 100
) {
  if (!molarityTargets[basis]?.includes(target)) throw Error("Invalid amount");
  const required = molarityTargets[basis].filter((key) => key !== target);
  if (required.some((key) => !Number.isFinite(values[key]) || values[key] < 0))
    throw Error("Enter non-negative values");
  for (const key of required) {
    if ((key === "mw" || key === "volume") && values[key] <= 0)
      throw Error("Enter positive finite values");
  }
  const divide = (numerator: number, denominator: number) => {
    if (denominator <= 0) throw Error("Enter positive finite values");
    return numerator / denominator;
  };
  const {
    mass: m,
    concentration: c,
    volume: v,
    mw,
    amount: n,
    massConcentration: mc,
  } = values;
  let result: number;
  if (basis === "amount") {
    result =
      target === "concentration"
        ? divide(n, v)
        : target === "amount"
        ? c * v
        : divide(n, c);
  } else if (basis === "massConcentration") {
    result =
      target === "concentration"
        ? divide(mc, mw)
        : target === "massConcentration"
        ? c * mw
        : divide(mc, c);
  } else {
    const fraction = pureMass(1, purity),
      pure = target === "mass" ? 0 : m * fraction;
    result =
      target === "concentration"
        ? divide(pure, mw * v)
        : target === "mass"
        ? (c * mw * v) / fraction
        : target === "volume"
        ? divide(pure, mw * c)
        : divide(pure, c * v);
  }
  if (!Number.isFinite(result)) throw Error("Result is not finite");
  if ((target === "mw" || target === "volume") && result <= 0)
    throw Error("Enter positive finite values");
  return result;
}
