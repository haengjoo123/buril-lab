export const units: Record<
  string,
  { dimension: string; factor: number; offset?: number }
> = {
  kg: { dimension: "mass", factor: 1000 },
  g: { dimension: "mass", factor: 1 },
  mg: { dimension: "mass", factor: 0.001 },
  µg: { dimension: "mass", factor: 1e-6 },
  ng: { dimension: "mass", factor: 1e-9 },
  L: { dimension: "volume", factor: 1 },
  mL: { dimension: "volume", factor: 0.001 },
  µL: { dimension: "volume", factor: 1e-6 },
  nL: { dimension: "volume", factor: 1e-9 },
  m: { dimension: "length", factor: 1 },
  cm: { dimension: "length", factor: 0.01 },
  mm: { dimension: "length", factor: 0.001 },
  µm: { dimension: "length", factor: 1e-6 },
  "m²": { dimension: "area", factor: 1 },
  "cm²": { dimension: "area", factor: 1e-4 },
  "mm²": { dimension: "area", factor: 1e-6 },
  "µm²": { dimension: "area", factor: 1e-12 },
  s: { dimension: "time", factor: 1 },
  min: { dimension: "time", factor: 60 },
  h: { dimension: "time", factor: 3600 },
  day: { dimension: "time", factor: 86400 },
  mol: { dimension: "amount", factor: 1 },
  mmol: { dimension: "amount", factor: 0.001 },
  µmol: { dimension: "amount", factor: 1e-6 },
  K: { dimension: "temperature", factor: 1 },
  "°C": { dimension: "temperature", factor: 1, offset: 273.15 },
  "°F": { dimension: "temperature", factor: 5 / 9, offset: 255.3722222222222 },
  M: { dimension: "molar", factor: 1 },
  mM: { dimension: "molar", factor: 0.001 },
  µM: { dimension: "molar", factor: 1e-6 },
  nM: { dimension: "molar", factor: 1e-9 },
  "g/L": { dimension: "massConcentration", factor: 1 },
  "mg/mL": { dimension: "massConcentration", factor: 1 },
  "µg/mL": { dimension: "massConcentration", factor: 0.001 },
  "% w/v": { dimension: "massConcentration", factor: 10 },
  "% w/w": { dimension: "massFraction", factor: 1 },
  "ppm w/w": { dimension: "massFraction", factor: 0.0001 },
  "ppb w/w": { dimension: "massFraction", factor: 0.0000001 },
  "% v/v": { dimension: "volumeFraction", factor: 1 },
  "ppm v/v": { dimension: "volumeFraction", factor: 0.0001 },
};
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
  if (
    (a.dimension === "molar" || b.dimension === "molar") &&
    !(mw && Number.isFinite(mw) && mw > 0)
  )
    throw Error("Molecular weight required");
  if (
    (a.dimension === "massFraction" || b.dimension === "massFraction") &&
    !(density && Number.isFinite(density) && density > 0)
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
