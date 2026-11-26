/**
 * DNA oligonucleotide (primer) calculations.
 *
 * Melting temperature uses the unified nearest-neighbour parameters of
 * SantaLucia (1998) PNAS 95:1460–1465, Table 2, with that paper's sodium
 * correction. Polymerase vendors' calculators add Mg²⁺/dNTP corrections and
 * can differ from this by several °C; the screen says so.
 */

/** ΔH° (kcal/mol) and ΔS° (cal/K·mol) per dimer, 5′→3′ on one strand, 1 M NaCl. */
const NEAREST_NEIGHBOUR: Record<string, readonly [number, number, number]> = {
  // [ΔH°, ΔS°, ΔG°37] — ΔG°37 is the paper's own column, kept to check the table.
  AA: [-7.9, -22.2, -1.0],
  AT: [-7.2, -20.4, -0.88],
  TA: [-7.2, -21.3, -0.58],
  CA: [-8.5, -22.7, -1.45],
  GT: [-8.4, -22.4, -1.44],
  CT: [-7.8, -21.0, -1.28],
  GA: [-8.2, -22.2, -1.3],
  CG: [-10.6, -27.2, -2.17],
  GC: [-9.8, -24.4, -2.24],
  GG: [-8.0, -19.9, -1.84],
};
const INIT_GC = [0.1, -2.8, 0.98] as const,
  INIT_AT = [2.3, 4.1, 1.03] as const,
  SYMMETRY = [0, -1.4, 0.43] as const;
const GAS_CONSTANT = 1.987; // cal/(K·mol)
const COMPLEMENT: Record<string, string> = { A: "T", T: "A", G: "C", C: "G" };

export const nearestNeighbourTable = NEAREST_NEIGHBOUR;

/** Letters only, upper case, U read as T. Spaces, digits and 5′/3′ marks are dropped. */
export function cleanSequence(input: string) {
  return input
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .replace(/U/g, "T");
}
/** Characters that are not A, C, G or T after cleaning. */
export function invalidBases(sequence: string) {
  return [...new Set(sequence.replace(/[ACGT]/g, ""))];
}
export function reverseComplement(sequence: string) {
  return [...sequence]
    .reverse()
    .map((base) => COMPLEMENT[base] ?? "N")
    .join("");
}
export function gcPercent(sequence: string) {
  if (!sequence.length) throw Error("Enter a sequence");
  return (100 * [...sequence].filter((b) => b === "G" || b === "C").length) /
    sequence.length;
}
const dimer = (pair: string) =>
  NEAREST_NEIGHBOUR[pair] ?? NEAREST_NEIGHBOUR[reverseComplement(pair)];

function requireBases(sequence: string) {
  if (!sequence.length) throw Error("Enter a sequence");
  if (invalidBases(sequence).length)
    throw Error("Sequence may contain only A, C, G and T");
}
/**
 * Duplex thermodynamics for an oligo with its perfect complement, 1 M NaCl:
 * ΔH° (kcal/mol), ΔS° (cal/K·mol) and ΔG°37 (kcal/mol).
 */
export function duplexThermodynamics(sequence: string) {
  requireBases(sequence);
  if (sequence.length < 2) throw Error("Sequence needs at least 2 bases");
  let enthalpy = 0,
    entropy = 0,
    freeEnergy = 0;
  for (let i = 0; i < sequence.length - 1; i++) {
    const [h, s, g] = dimer(sequence.slice(i, i + 2));
    enthalpy += h;
    entropy += s;
    freeEnergy += g;
  }
  for (const end of [sequence[0], sequence[sequence.length - 1]]) {
    const [h, s, g] = end === "G" || end === "C" ? INIT_GC : INIT_AT;
    enthalpy += h;
    entropy += s;
    freeEnergy += g;
  }
  const selfComplementary = sequence === reverseComplement(sequence);
  if (selfComplementary) {
    entropy += SYMMETRY[1];
    freeEnergy += SYMMETRY[2];
  }
  return { enthalpy, entropy, freeEnergy, selfComplementary };
}
/**
 * Nearest-neighbour melting temperature in °C.
 * `strandMolar` is the total oligo strand concentration (M), `sodiumMolar`
 * the monovalent cation concentration (M).
 *   Tm = ΔH° / (ΔS° + 0.368·(N−1)·ln[Na⁺] + R·ln(C/x)) − 273.15
 * with x = 4 for a non-self-complementary duplex and 1 for a self-complementary one.
 */
export function meltingTemperature(
  sequence: string,
  strandMolar: number,
  sodiumMolar: number
) {
  if (!(strandMolar > 0) || !(sodiumMolar > 0))
    throw Error("Enter positive finite values");
  const { enthalpy, entropy, selfComplementary } =
    duplexThermodynamics(sequence);
  const salted =
    entropy + 0.368 * (sequence.length - 1) * Math.log(sodiumMolar);
  return (
    (1000 * enthalpy) /
      (salted +
        GAS_CONSTANT * Math.log(strandMolar / (selfComplementary ? 1 : 4))) -
    273.15
  );
}
/** The 2 + 4 rule (Wallace): 2 °C per A/T and 4 °C per G/C. For short oligos only. */
export function wallaceTemperature(sequence: string) {
  requireBases(sequence);
  return [...sequence].reduce(
    (sum, base) => sum + (base === "G" || base === "C" ? 4 : 2),
    0
  );
}
/**
 * Molecular weight (g/mol) of a single-stranded DNA oligo.
 * Residue masses (nucleotide − H₂O) are those in Thermo Fisher's "DNA and RNA
 * Molecular Weights and Conversions": A 313.2, T 304.2, C 289.2, G 329.2. A
 * chain of n residues carries n phosphates; a synthetic oligo has a 5′-OH
 * instead of the 5′ phosphate, so HPO₃ (79.98) comes off and the two chain
 * ends add H₂O (18.02): −61.96. With a 5′ phosphate the ends add H₂O only.
 */
export function oligoMolecularWeight(sequence: string, fivePrimePhosphate = false) {
  requireBases(sequence);
  const mass: Record<string, number> = { A: 313.2, T: 304.2, C: 289.2, G: 329.2 };
  const residues = [...sequence].reduce((sum, base) => sum + mass[base], 0);
  return residues + (fivePrimePhosphate ? 18.02 : -61.96);
}
/** Volume (µL) that dissolves `nanomoles` of oligo to `micromolar`. */
export function resuspensionVolume(nanomoles: number, micromolar: number) {
  if (!(nanomoles > 0) || !(micromolar > 0))
    throw Error("Enter positive finite values");
  // nmol / (µmol/L) = mL; ×1000 → µL.
  return (nanomoles / micromolar) * 1000;
}
/** Longest run of one base, e.g. 4 for "…GGGG…". */
export function longestRun(sequence: string) {
  let best = 0,
    run = 0;
  for (let i = 0; i < sequence.length; i++) {
    run = i > 0 && sequence[i] === sequence[i - 1] ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}
