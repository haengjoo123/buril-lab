/**
 * Nucleic acid quantitation and mass ↔ mole conversions.
 *
 * Molecular weights use the approximate formulas in Thermo Fisher's "DNA and
 * RNA Molecular Weights and Conversions":
 *   dsDNA = (base pairs × 607.4) + 157.9
 *   ssDNA = (nucleotides × 303.7) + 79.0
 *   ssRNA = (nucleotides × 320.5) + 159.0
 * They assume average base composition; for a known sequence the oligo
 * tool's exact weight is better.
 */
export type NucleicAcid = "dsDNA" | "ssDNA" | "RNA";
export const AVOGADRO = 6.02214076e23;

const positive = (...values: number[]) => {
  if (values.some((value) => !Number.isFinite(value) || value <= 0))
    throw Error("Enter positive finite values");
};
/** Average molecular weight (g/mol) of a molecule `length` bp (dsDNA) or nt long. */
export function nucleicAcidWeight(kind: NucleicAcid, length: number) {
  positive(length);
  if (!Number.isInteger(length)) throw Error("Length must be a whole number");
  return kind === "dsDNA"
    ? length * 607.4 + 157.9
    : kind === "ssDNA"
    ? length * 303.7 + 79.0
    : length * 320.5 + 159.0;
}
/** Picomoles in `nanograms` of a molecule of the given kind and length. */
export function picomoles(kind: NucleicAcid, length: number, nanograms: number) {
  positive(nanograms);
  // ng / (g/mol) = nmol; ×1000 → pmol.
  return (nanograms / nucleicAcidWeight(kind, length)) * 1000;
}
/** Nanograms in `pmol` of a molecule of the given kind and length. */
export function nanograms(kind: NucleicAcid, length: number, pmol: number) {
  positive(pmol);
  return (pmol * nucleicAcidWeight(kind, length)) / 1000;
}
/** Number of molecules in `nanograms`. */
export function copyNumber(kind: NucleicAcid, length: number, ng: number) {
  return picomoles(kind, length, ng) * 1e-12 * AVOGADRO;
}
/**
 * Insert mass (ng) for a ligation at an insert : vector molar ratio.
 * Computed from moles, so it is exact for the weight formula above rather than
 * the length-ratio shortcut (they agree to within a fraction of a percent).
 */
export function ligationInsertMass(
  vectorLength: number,
  vectorNanograms: number,
  insertLength: number,
  ratio: number
) {
  positive(ratio);
  return nanograms(
    "dsDNA",
    insertLength,
    ratio * picomoles("dsDNA", vectorLength, vectorNanograms)
  );
}
/**
 * µg/mL per absorbance unit at 260 nm, 1 cm path. dsDNA 50 and RNA 40 are
 * given alike by Thermo Fisher and the general literature. For ssDNA sources
 * differ: 33 is the commonly cited value, Thermo Fisher's table lists 37; the
 * screen lets the user change the factor.
 */
export const A260_FACTOR: Record<NucleicAcid, number> = {
  dsDNA: 50,
  ssDNA: 33,
  RNA: 40,
};
/** Concentration (µg/mL, equal to ng/µL) from an A260 reading. */
export function concentrationFromA260(
  absorbance: number,
  factor: number,
  dilution = 1,
  pathCm = 1
) {
  positive(factor, dilution, pathCm);
  if (!Number.isFinite(absorbance) || absorbance < 0)
    throw Error("Enter non-negative values");
  return (absorbance * factor * dilution) / pathCm;
}
/** A260/A280. Pure DNA is usually taken as about 1.8 and pure RNA about 2.0. */
export function purityRatio(a260: number, a280: number) {
  positive(a280);
  if (!Number.isFinite(a260) || a260 < 0) throw Error("Enter non-negative values");
  return a260 / a280;
}
