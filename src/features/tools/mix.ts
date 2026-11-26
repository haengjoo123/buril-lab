import { mixAmounts } from "./labMath";

/**
 * Master mix and medium/buffer arithmetic on plain numbers. `MixTool` decides
 * which fields a row needs and reads them; nothing here knows about empty
 * fields or the screen. Volumes are in µL and masses in g unless a name says
 * otherwise.
 */

/** Units an amount can be entered in. Only the volumes count toward a reaction volume. */
export const amountUnits = ["g", "mg", "µg", "mL", "µL"] as const;
/** Master mix: stock and final concentration share one of these, so only their ratio matters. */
export const ratioUnits = [
  "X",
  "M",
  "mM",
  "µM",
  "nM",
  "ng/µL",
  "U/µL",
  "%",
] as const;
/** Medium/buffer: what a final concentration can be given in. */
export const recipeUnits = ["g/L", "mg/mL", "% w/v", "M", "mM", "X"] as const;
export const recipeVolumeUnits = ["mL", "L"] as const;

const MICROLITRES: Record<string, number> = { L: 1e6, mL: 1e3, µL: 1 };
const GRAMS: Record<string, number> = { g: 1, mg: 1e-3, µg: 1e-6 };
/** Drops binary floating-point residue (1000.0000000000001 is 1000). */
export const tidy = (n: number) => Number(n.toPrecision(12));

/** A volume in µL, or null when the unit is not a volume (g, mg, µg). */
export const microlitres = (value: number, unit: string) =>
  Object.hasOwn(MICROLITRES, unit) ? value * MICROLITRES[unit] : null;

/** A volume in the unit it is read in at the bench: µL below 1 mL, mL below 1 L. */
export function readableVolume(volume: number) {
  const size = Math.abs(tidy(volume));
  const unit = size >= 1e6 ? "L" : size >= 1e3 ? "mL" : "µL";
  return { value: tidy(volume / MICROLITRES[unit]), unit };
}
/** A mass in g from 1 g up, mg from 1 mg up, µg below that. */
export function readableMass(grams: number) {
  const size = Math.abs(tidy(grams));
  const unit = size >= 1 || size === 0 ? "g" : size >= 1e-3 ? "mg" : "µg";
  return { value: tidy(grams / GRAMS[unit]), unit };
}

/**
 * An amount multiplied up: by reactions and overage for a master mix, by
 * target ÷ reference for a recipe. `mixAmounts` rejects a negative or
 * non-finite amount and a factor that is not positive.
 */
export const scaled = (amount: number, count: number, excess = 0) =>
  mixAmounts([{ name: "", amount, unit: "" }], count, excess)[0].total;

/** Reactions × (1 + overage %): what one reaction is multiplied by for the whole mix. */
export function mixFactor(count: number, excess: number) {
  if (!Number.isInteger(count) || count < 1)
    throw Error("Reaction count must be an integer");
  if (!Number.isFinite(excess) || excess < 0)
    throw Error("Overage must be zero or more");
  return scaled(1, count, excess);
}

/**
 * Volume of a stock in one reaction: final ÷ stock × reaction volume. The two
 * concentrations are in the same unit, whichever it is.
 */
export function stockVolume(stock: number, final: number, volume: number) {
  if (
    ![stock, final, volume].every(Number.isFinite) ||
    stock <= 0 ||
    final < 0 ||
    volume <= 0
  )
    throw Error("Invalid concentration or volume");
  if (final > stock) throw Error("Final concentration exceeds the stock");
  return (final / stock) * volume;
}

export interface ReactionComponent {
  /** µL in one reaction; null for a component measured by mass. */
  volume: number | null;
  /** Added to each tube on its own (template, sample) instead of to the master mix. */
  perTube: boolean;
}
/**
 * Where the volume of one reaction goes. With a reaction volume, what the
 * components leave is filled with water or buffer; without one there is no
 * fill and the reaction is as large as its components.
 */
export function reactionVolumes(
  components: ReactionComponent[],
  reactionVolume: number | null
) {
  if (
    reactionVolume != null &&
    !(Number.isFinite(reactionVolume) && reactionVolume > 0)
  )
    throw Error("Enter positive finite values");
  let mixed = 0,
    perTube = 0;
  for (const component of components) {
    if (component.volume == null) continue;
    if (!Number.isFinite(component.volume) || component.volume < 0)
      throw Error("Invalid amount");
    if (component.perTube) perTube += component.volume;
    else mixed += component.volume;
  }
  let fill: number | null = null;
  if (reactionVolume != null) {
    const rest = reactionVolume - mixed - perTube;
    // Components that add up to exactly the reaction volume leave residue
    // such as -5.6e-17, which is "nothing left", not "too much".
    fill = Math.abs(rest) <= reactionVolume * 1e-9 ? 0 : rest;
    if (fill < 0) throw Error("Components exceed the reaction volume");
  }
  const dispense = mixed + (fill ?? 0);
  return {
    /** Water or buffer per reaction; null without a reaction volume. */
    fill,
    /** Added to each tube on its own. */
    perTube,
    /** Master mix that goes into each tube: everything except `perTube`. */
    dispense,
    /** The finished reaction. */
    perReaction: dispense + perTube,
  };
}

/** Target ÷ reference volume: what a recipe's reference amounts are multiplied by. */
export function recipeScale(reference: number, target: number) {
  if (![reference, target].every((v) => Number.isFinite(v) && v > 0))
    throw Error("Enter positive finite values");
  return target / reference;
}
/** A recipe volume in litres; the unit is "L" or "mL". */
export function recipeLitres(value: number, unit: string) {
  if (!Number.isFinite(value) || value <= 0)
    throw Error("Enter positive finite values");
  return unit === "L" ? value : value / 1000;
}
/**
 * What to add for `litres` of solution at a final concentration: a mass in g,
 * or for an X concentration the volume of the X stock in µL. M and mM need the
 * molecular weight (g/mol), X needs the stock's X.
 */
export function recipeAmount(
  unit: string,
  final: number,
  litres: number,
  extra: { mw?: number | null; stock?: number | null } = {}
): { kind: "mass"; grams: number } | { kind: "volume"; microlitres: number } {
  if (
    !Number.isFinite(final) ||
    final < 0 ||
    !Number.isFinite(litres) ||
    litres <= 0
  )
    throw Error("Invalid concentration or volume");
  switch (unit) {
    case "g/L":
    case "mg/mL":
      return { kind: "mass", grams: final * litres };
    case "% w/v":
      // 1 % w/v is 1 g in 100 mL, 10 g in a litre.
      return { kind: "mass", grams: final * 10 * litres };
    case "M":
    case "mM": {
      const mw = extra.mw;
      if (mw == null || !Number.isFinite(mw) || mw <= 0)
        throw Error("Molecular weight required");
      return {
        kind: "mass",
        grams: (unit === "mM" ? final / 1000 : final) * mw * litres,
      };
    }
    case "X": {
      const stock = extra.stock;
      if (stock == null || !Number.isFinite(stock) || stock <= 0)
        throw Error("Invalid concentration or volume");
      if (final > stock) throw Error("Final concentration exceeds the stock");
      return { kind: "volume", microlitres: (final / stock) * litres * 1e6 };
    }
    default:
      throw Error("Invalid unit or value");
  }
}
