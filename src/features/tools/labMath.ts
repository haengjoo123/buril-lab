export function positive(...values: number[]) {
  if (values.some((v) => !Number.isFinite(v) || v <= 0))
    throw Error("Enter positive finite values");
}
export function dilution(
  stock: number,
  target: number,
  volume: number,
  steps = 1,
  factor = 2
) {
  positive(stock, target, volume);
  if (target > stock) throw Error("Target exceeds stock concentration");
  if (!Number.isInteger(steps) || steps < 1 || steps > 100)
    throw Error("Steps: 1–100");
  if (steps > 1 && factor <= 1)
    throw Error("Serial dilution factor must exceed 1");
  return {
    stockVolume: (target * volume) / stock,
    diluentVolume: volume - (target * volume) / stock,
    factor: stock / target,
    series: Array.from({ length: steps }, (_, i) => ({
      step: i + 1,
      concentration: target / factor ** i,
      transferVolume: volume / factor,
      diluentVolume: volume - volume / factor,
    })),
  };
}
export function molarity(massG: number, mw: number, volumeL: number) {
  positive(mw, volumeL);
  if (massG < 0 || !Number.isFinite(massG)) throw Error("Invalid mass");
  return massG / mw / volumeL;
}
export function mixAmounts(
  rows: { name: string; amount: number; unit: string }[],
  count: number,
  excess: number
) {
  positive(count);
  if (
    excess < 0 ||
    !Number.isFinite(excess) ||
    rows.some((r) => r.amount < 0 || !Number.isFinite(r.amount))
  )
    throw Error("Invalid amount");
  return rows.map((r) => ({
    ...r,
    total: r.amount * count * (1 + excess / 100),
  }));
}
export interface CultureProfile {
  kind: "adherent" | "suspension";
  doublingHours: number;
  density: number;
  maxDensity: number;
}
export interface Vessel {
  id: string;
  name: string;
  area: number;
  volume: number;
  count: number;
  mode: "cells/mL" | "cells/vessel" | "cells/cm2" | "confluence" | "split";
  target: number;
}
export function seeding(
  profile: CultureProfile,
  concentration: number,
  availableVolume: number,
  vessels: Vessel[]
) {
  positive(concentration, availableVolume);
  positive(
    profile.doublingHours,
    profile.kind === "adherent" ? profile.density : profile.maxDensity
  );
  let stockTotal = 0;
  const rows = vessels.map((v) => {
    positive(v.volume, v.count, v.target);
    if (!Number.isInteger(v.count))
      throw Error("Vessel count must be an integer");
    if (
      profile.kind === "suspension" &&
      ["confluence", "cells/cm2"].includes(v.mode)
    )
      throw Error("Area targets require adherent cells");
    if (["confluence", "cells/cm2"].includes(v.mode))
      positive(v.area, profile.density);
    const cells =
      v.mode === "split"
        ? ((profile.kind === "adherent" ? availableVolume : v.volume) /
            v.target) *
          concentration
        : v.mode === "cells/mL"
        ? v.target * v.volume
        : v.mode === "cells/cm2"
        ? v.target * v.area
        : v.mode === "confluence"
        ? (v.target / 100) * v.area * profile.density
        : v.target;
    const stock = cells / concentration,
      medium = v.volume - stock;
    stockTotal += stock * v.count;
    const confluence =
      profile.kind === "adherent" && v.area > 0 && profile.density > 0
        ? (100 * cells) / v.area / profile.density
        : null;
    return {
      ...v,
      cells,
      stock,
      medium,
      confluence,
      warning:
        medium < 0
          ? "Negative medium volume"
          : confluence !== null && confluence > 100
          ? "Above 100% confluence"
          : profile.kind === "suspension" &&
            cells / v.volume > profile.maxDensity
          ? "Above maximum density"
          : "",
    };
  });
  return {
    rows,
    stockTotal,
    mediumTotal: rows.reduce((s, r) => s + r.medium * r.count, 0),
    valid: stockTotal <= availableVolume && rows.every((r) => r.medium >= 0),
    insufficient: stockTotal > availableVolume,
  };
}
export function growthHours(
  start: number,
  target: number,
  doublingHours: number
) {
  positive(start, target, doublingHours);
  if (target <= start) throw Error("Target must exceed starting density");
  return doublingHours * Math.log2(target / start);
}
export function cellCount(
  live: number[],
  dead: number[],
  dilutionFactor: number,
  volumeMl: number
) {
  positive(dilutionFactor, volumeMl);
  if (
    live.length === 0 ||
    live.length !== dead.length ||
    [...live, ...dead].some((v) => !Number.isInteger(v) || v < 0)
  )
    throw Error("Invalid counts");
  const l = live.reduce((s, n) => s + n, 0),
    d = dead.reduce((s, n) => s + n, 0);
  return {
    concentration: (l / live.length / volumeMl) * dilutionFactor,
    viability: l + d ? (100 * l) / (l + d) : null,
    total: l + d,
  };
}
