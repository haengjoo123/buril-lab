// Factors are relative to one base unit per dimension: g, L, m, m², s, mol, K,
// mol/L (molar), g/L (mass concentration) and % (mass and volume fractions).
export const units: Record<
  string,
  { dimension: string; factor: number; offset?: number }
> = {
  kg: { dimension: "mass", factor: 1000 },
  g: { dimension: "mass", factor: 1 },
  mg: { dimension: "mass", factor: 0.001 },
  µg: { dimension: "mass", factor: 1e-6 },
  ng: { dimension: "mass", factor: 1e-9 },
  pg: { dimension: "mass", factor: 1e-12 },
  L: { dimension: "volume", factor: 1 },
  mL: { dimension: "volume", factor: 0.001 },
  µL: { dimension: "volume", factor: 1e-6 },
  nL: { dimension: "volume", factor: 1e-9 },
  m: { dimension: "length", factor: 1 },
  cm: { dimension: "length", factor: 0.01 },
  mm: { dimension: "length", factor: 0.001 },
  µm: { dimension: "length", factor: 1e-6 },
  nm: { dimension: "length", factor: 1e-9 },
  "m²": { dimension: "area", factor: 1 },
  "cm²": { dimension: "area", factor: 1e-4 },
  "mm²": { dimension: "area", factor: 1e-6 },
  "µm²": { dimension: "area", factor: 1e-12 },
  ms: { dimension: "time", factor: 0.001 },
  s: { dimension: "time", factor: 1 },
  min: { dimension: "time", factor: 60 },
  h: { dimension: "time", factor: 3600 },
  day: { dimension: "time", factor: 86400 },
  mol: { dimension: "amount", factor: 1 },
  mmol: { dimension: "amount", factor: 0.001 },
  µmol: { dimension: "amount", factor: 1e-6 },
  nmol: { dimension: "amount", factor: 1e-9 },
  pmol: { dimension: "amount", factor: 1e-12 },
  K: { dimension: "temperature", factor: 1 },
  "°C": { dimension: "temperature", factor: 1, offset: 273.15 },
  "°F": { dimension: "temperature", factor: 5 / 9, offset: 255.3722222222222 },
  M: { dimension: "molar", factor: 1 },
  mM: { dimension: "molar", factor: 0.001 },
  µM: { dimension: "molar", factor: 1e-6 },
  nM: { dimension: "molar", factor: 1e-9 },
  pM: { dimension: "molar", factor: 1e-12 },
  "g/L": { dimension: "massConcentration", factor: 1 },
  "mg/mL": { dimension: "massConcentration", factor: 1 },
  "µg/mL": { dimension: "massConcentration", factor: 0.001 },
  "µg/µL": { dimension: "massConcentration", factor: 1 },
  "ng/µL": { dimension: "massConcentration", factor: 0.001 },
  "% w/v": { dimension: "massConcentration", factor: 10 },
  "% w/w": { dimension: "massFraction", factor: 1 },
  "ppm w/w": { dimension: "massFraction", factor: 0.0001 },
  "ppb w/w": { dimension: "massFraction", factor: 0.0000001 },
  "% v/v": { dimension: "volumeFraction", factor: 1 },
  "ppm v/v": { dimension: "volumeFraction", factor: 0.0001 },
};
/**
 * The converter's conversion types and the units each offers, in the order
 * shown. The first two units are the pair a type opens with. RPM and RCF are
 * not in `units`: they convert through `convertCentrifuge`.
 */
export const unitCategories: readonly {
  id: string;
  ko: string;
  en: string;
  units: readonly string[];
}[] = [
  { id: "volume", ko: "부피", en: "Volume", units: ["mL", "µL", "L", "nL"] },
  {
    id: "mass",
    ko: "질량",
    en: "Mass",
    units: ["g", "mg", "µg", "ng", "pg", "kg"],
  },
  {
    id: "concentration",
    ko: "농도",
    en: "Concentration",
    units: [
      "M",
      "mM",
      "µM",
      "nM",
      "pM",
      "g/L",
      "mg/mL",
      "µg/mL",
      "µg/µL",
      "ng/µL",
      "% w/v",
      "% w/w",
      "ppm w/w",
      "ppb w/w",
    ],
  },
  {
    id: "temperature",
    ko: "온도",
    en: "Temperature",
    units: ["°C", "°F", "K"],
  },
  { id: "centrifuge", ko: "RPM / RCF", en: "RPM / RCF", units: ["RPM", "RCF"] },
  {
    id: "length",
    ko: "길이",
    en: "Length",
    units: ["m", "cm", "mm", "µm", "nm"],
  },
  { id: "area", ko: "면적", en: "Area", units: ["m²", "cm²", "mm²", "µm²"] },
  {
    id: "time",
    ko: "시간",
    en: "Time",
    units: ["s", "min", "h", "day", "ms"],
  },
  {
    id: "amount",
    ko: "물질량",
    en: "Amount",
    units: ["mol", "mmol", "µmol", "nmol", "pmol"],
  },
  {
    id: "volumeFraction",
    ko: "부피 비율",
    en: "Volume fraction",
    units: ["% v/v", "ppm v/v"],
  },
];
const given = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value > 0;
/**
 * What a conversion needs besides the value: a molecular weight between molar
 * and mass-based concentrations, a solution density between mass fractions
 * (% w/w, ppm w/w) and any other concentration.
 */
export function conversionNeeds(from: string, to: string) {
  const a = units[from]?.dimension,
    b = units[to]?.dimension,
    differ = a !== b;
  return {
    mw: differ && (a === "molar" || b === "molar"),
    density: differ && (a === "massFraction" || b === "massFraction"),
  };
}
export function convertUnit(
  value: number,
  from: string,
  to: string,
  mw?: number,
  density?: number
): number {
  const a = units[from],
    b = units[to];
  if (!a || !b || !Number.isFinite(value)) throw Error("Invalid unit or value");
  // Only a temperature can be below zero; there is no negative mass, volume,
  // amount, length, area, time or concentration to convert.
  if (a.dimension !== "temperature" && value < 0)
    throw Error("Enter non-negative values");
  if (a.dimension === b.dimension) {
    const base = value * a.factor + (a.offset ?? 0);
    if (a.dimension === "temperature" && base < 0)
      throw Error("Below absolute zero");
    return (base - (b.offset ?? 0)) / b.factor;
  }
  const concentration = ["molar", "massConcentration", "massFraction"];
  if (
    !concentration.includes(a.dimension) ||
    !concentration.includes(b.dimension)
  )
    throw Error("Incompatible dimensions");
  if ((a.dimension === "molar" || b.dimension === "molar") && !given(mw))
    throw Error("Molecular weight required");
  if (
    (a.dimension === "massFraction" || b.dimension === "massFraction") &&
    !given(density)
  )
    throw Error("Density (g/mL) required");
  const grams =
    a.dimension === "molar"
      ? value * a.factor * mw!
      : a.dimension === "massFraction"
      ? value * a.factor * 10 * density!
      : value * a.factor;
  return b.dimension === "molar"
    ? grams / mw! / b.factor
    : b.dimension === "massFraction"
    ? grams / (10 * density!) / b.factor
    : grams / b.factor;
}
/**
 * A value in each of `targets` it can be expressed in. A unit that needs a
 * molecular weight or density that was not given is left out, as is `from`
 * itself; an invalid value throws as `convertUnit` does.
 */
export function convertAll(
  value: number,
  from: string,
  targets: readonly string[],
  mw?: number,
  density?: number
) {
  const rows: { unit: string; value: number }[] = [];
  for (const unit of targets) {
    if (unit === from) continue;
    const needs = conversionNeeds(from, unit);
    if ((needs.mw && !given(mw)) || (needs.density && !given(density)))
      continue;
    rows.push({ unit, value: convertUnit(value, from, unit, mw, density) });
  }
  return rows;
}
// Thermo Fisher centrifuge best practices: radius in centimetres, RCF in ×g.
export function convertCentrifuge(
  value: number,
  from: "RPM" | "RCF",
  radiusCm: number
) {
  if (!Number.isFinite(radiusCm) || radiusCm <= 0)
    throw Error("Enter a positive rotor radius");
  if (!Number.isFinite(value) || value < 0)
    throw Error("Enter a non-negative speed or force");
  return from === "RPM"
    ? 1.118e-5 * radiusCm * value ** 2
    : Math.sqrt(value / (1.118e-5 * radiusCm));
}
