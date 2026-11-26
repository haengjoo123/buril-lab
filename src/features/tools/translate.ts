import { codons } from "./library";
import { cleanSequence, reverseComplement } from "./oligo";

/**
 * Translation of a pasted nucleotide sequence with the standard genetic code
 * (NCBI table 1, the table in library.ts). Sequences are handled as DNA
 * letters; RNA is read with U as T and shown again with U.
 */
const AMINO: ReadonlyMap<string, string> = new Map(
  codons.map((c) => [c.codon.replaceAll("U", "T"), c.amino])
);

export interface ReadingFrame {
  /** 1, 2 or 3: the base of the sequence the first codon starts at. */
  frame: 1 | 2 | 3;
  /**
   * One letter per codon: `*` for a stop codon and `X` for a codon with a base
   * other than A, C, G or T/U (N and the other ambiguity codes).
   */
  protein: string;
  /** Bases left after the last whole codon (0–2); they are not translated. */
  trailing: number;
}

/** Translates `sequence` (cleaned DNA letters) codon by codon from `offset`. */
export function translate(sequence: string, offset = 0): string {
  let protein = "";
  for (let i = offset; i + 3 <= sequence.length; i += 3)
    protein += AMINO.get(sequence.slice(i, i + 3)) ?? "X";
  return protein;
}
/** The three reading frames of one strand, read 5′→3′. */
export function readingFrames(sequence: string): ReadingFrame[] {
  return ([1, 2, 3] as const).map((frame) => ({
    frame,
    protein: translate(sequence, frame - 1),
    trailing: Math.max(0, sequence.length - (frame - 1)) % 3,
  }));
}
/**
 * Reads pasted text as one nucleotide sequence and translates both strands.
 * FASTA header lines (`>name`), spaces, digits and 5′/3′ marks are dropped.
 * The text counts as RNA when it has U and no T; `sequence` and `reverse` are
 * returned in the letters it was written in.
 */
export function translateSequence(input: string) {
  const body = input
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");
  const rna = /u/i.test(body) && !/t/i.test(body);
  const sequence = cleanSequence(body),
    reverse = reverseComplement(sequence);
  const written = (strand: string) =>
    rna ? strand.replaceAll("T", "U") : strand;
  return {
    rna,
    sequence: written(sequence),
    /** The other strand, 5′→3′. Bases that are not A, C, G or T/U read N. */
    reverse: written(reverse),
    /** Letters that are not A, C, G or T/U; their codons translate to X. */
    unknown: sequence.replace(/[ACGT]/g, "").length,
    forward: readingFrames(sequence),
    backward: readingFrames(reverse),
  };
}
