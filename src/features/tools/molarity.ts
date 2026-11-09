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
  mw: ["g/mol"],
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
// Molarity is based on final solution volume. Inputs and return value use the base units above.
export function solveMolarity(
  basis: MolarityBasis,
  target: MolarityTarget,
  values: Record<MolarityTarget, number>
) {
  if (!molarityTargets[basis]?.includes(target)) throw Error("Invalid amount");
  const required = molarityTargets[basis].filter((key) => key !== target);
  if (required.some((key) => !Number.isFinite(values[key]) || values[key] < 0))
    throw Error("Invalid amount");
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
    result =
      target === "concentration"
        ? divide(m, mw * v)
        : target === "mass"
        ? c * mw * v
        : target === "volume"
        ? divide(m, mw * c)
        : divide(m, c * v);
  }
  if (!Number.isFinite(result)) throw Error("Result is not finite");
  if ((target === "mw" || target === "volume") && result <= 0)
    throw Error("Enter positive finite values");
  return result;
}
