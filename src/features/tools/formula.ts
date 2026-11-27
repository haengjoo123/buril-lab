import periodic from "./data/periodic-table.json";
import { IncompleteInput } from "./format";

/**
 * Chemical formula → molecular weight.
 *
 * Reads formulas as they are written on a reagent label: element symbols with
 * counts (C6H12O6), groups in round, square or curly brackets to any depth
 * (Ca(OH)2, K4[Fe(CN)6]) and hydrates joined with a middle dot, a full stop or
 * an asterisk (CuSO4·5H2O, CuSO4.5H2O). Symbols are case-sensitive: Co is
 * cobalt, CO is carbon monoxide.
 *
 * Counts after a symbol or a bracket are whole numbers, so a full stop after
 * one always starts a hydrate part. The number that leads a part may be a
 * decimal (CaSO4·0.5H2O).
 *
 * Atomic weights are the ones in data/periodic-table.json (PubChem).
 */
type Element = { number: number; mass: number; decimals: number };
const elements: ReadonlyMap<string, Element> = new Map(
  periodic.Table.Row.map(({ Cell }): [string, Element] => [
    Cell[1],
    {
      number: Number(Cell[0]),
      mass: Number(Cell[3]),
      // How far the source states the weight: "35.45" is good to 2 places.
      decimals: Cell[3].split(".")[1]?.length ?? 0,
    },
  ])
);
const OPENING = "([{",
  CLOSING = ")]}",
  // Middle dot and its look-alikes (bullet, bullet operator, dot operator).
  JOINTS = "·.*•∙⋅",
  SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";

/** A formula that cannot be read. `near` is the text the message is about. */
export class FormulaError extends Error {
  readonly near: string;
  constructor(message: string, near = "") {
    super(message);
    this.name = "FormulaError";
    this.near = near;
  }
}

type Atoms = Map<string, number>;
const add = (into: Atoms, from: Atoms, times: number) =>
  from.forEach((count, symbol) =>
    into.set(symbol, (into.get(symbol) ?? 0) + count * times)
  );
/**
 * Atoms per element in a formula, in the order the elements first appear.
 * Throws `IncompleteInput` for an empty formula and `FormulaError` for one
 * that cannot be read.
 */
export function parseFormula(input: string): Atoms {
  const text = input
    .replace(/[₀-₉]/g, (digit) => String(SUBSCRIPTS.indexOf(digit)))
    .replace(/\s+/g, "");
  if (!text) throw new IncompleteInput();
  let at = 0;
  /** The number at the cursor, or 1 when there is none. */
  const number = (pattern: RegExp) => {
    const digits = pattern.exec(text.slice(at))?.[0];
    if (!digits) return 1;
    at += digits.length;
    if (!(Number(digits) > 0))
      throw new FormulaError("Formula count must be greater than zero", digits);
    return Number(digits);
  };
  const count = () => number(/^\d+/);
  const total: Atoms = new Map();
  // Hydrate parts, one per turn: "CuSO4" and then "5H2O".
  for (;;) {
    const times = number(/^\d+(?:\.\d+)?/);
    // The part itself at the bottom, and one entry per bracket left open.
    const open: { atoms: Atoms; bracket: string }[] = [
      { atoms: new Map(), bracket: "" },
    ];
    while (at < text.length) {
      const char = text[at],
        top = open[open.length - 1];
      if (JOINTS.includes(char)) {
        if (open.length > 1)
          throw new FormulaError("Unexpected character in formula", char);
        break;
      }
      if (OPENING.includes(char)) {
        open.push({ atoms: new Map(), bracket: char });
        at++;
      } else if (CLOSING.includes(char)) {
        if (
          open.length < 2 ||
          OPENING.indexOf(top.bracket) !== CLOSING.indexOf(char)
        )
          throw new FormulaError("Unbalanced brackets in formula", char);
        if (!top.atoms.size)
          throw new FormulaError("Incomplete formula", top.bracket + char);
        at++;
        open.pop();
        add(open[open.length - 1].atoms, top.atoms, count());
      } else if (/[A-Za-z]/.test(char)) {
        const symbol = /^[A-Z][a-z]?/.exec(text.slice(at))?.[0] ?? char;
        if (!elements.has(symbol))
          throw new FormulaError("Unknown element symbol", symbol);
        at += symbol.length;
        top.atoms.set(symbol, (top.atoms.get(symbol) ?? 0) + count());
      } else if (/\d/.test(char))
        // A number with nothing before it to count, as in "Ca(2OH)".
        throw new FormulaError("Incomplete formula", char);
      else throw new FormulaError("Unexpected character in formula", char);
    }
    if (open.length > 1)
      throw new FormulaError(
        "Unbalanced brackets in formula",
        open[open.length - 1].bracket
      );
    // Nothing between two joints, before the first or after the last one.
    if (!open[0].atoms.size) throw new FormulaError("Incomplete formula");
    add(total, open[0].atoms, times);
    if (at >= text.length) return total;
    at++;
  }
}

export interface FormulaPart {
  symbol: string;
  /** Atomic number. */
  number: number;
  /** Atoms of the element in one formula unit. */
  count: number;
  /** The element's share of the weight, g/mol. */
  mass: number;
  /** The same share as a percentage of the whole. */
  percent: number;
}
export interface FormulaWeight {
  /** Molecular (formula) weight in g/mol, unrounded. */
  mass: number;
  /**
   * Decimal places the weight is good to: the fewest among the atomic weights
   * used, as the source states them (Cl 35.45 limits NaCl to 58.44).
   */
  decimals: number;
  /** `mass` rounded to `decimals`. */
  rounded: number;
  parts: FormulaPart[];
}
export function formulaWeight(input: string): FormulaWeight {
  const atoms = [...parseFormula(input)];
  const masses = atoms.map(
    ([symbol, count]) => count * elements.get(symbol)!.mass
  );
  const mass = masses.reduce((sum, part) => sum + part, 0);
  if (!Number.isFinite(mass)) throw Error("Result is not finite");
  const decimals = Math.min(
    ...atoms.map(([symbol]) => elements.get(symbol)!.decimals)
  );
  return {
    mass,
    decimals,
    rounded: Number(mass.toFixed(decimals)),
    parts: atoms.map(([symbol, count], index) => ({
      symbol,
      number: elements.get(symbol)!.number,
      count,
      mass: masses[index],
      percent: (masses[index] / mass) * 100,
    })),
  };
}
/**
 * `formulaWeight` for a screen: the weight, or the message to show with the
 * text it is about. An empty formula is neither.
 */
export function checkFormula(input: string): {
  weight: FormulaWeight | null;
  error: string;
  near: string;
} {
  try {
    return { weight: formulaWeight(input), error: "", near: "" };
  } catch (e) {
    if (e instanceof IncompleteInput)
      return { weight: null, error: "", near: "" };
    return {
      weight: null,
      error: e instanceof Error ? e.message : String(e),
      near: e instanceof FormulaError ? e.near : "",
    };
  }
}
