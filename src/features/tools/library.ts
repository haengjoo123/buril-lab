// Standard genetic code, NCBI translation table 1, retrieved 2026-11-09.
export const geneticCodeSource =
  "https://www.ncbi.nlm.nih.gov/Taxonomy/Utils/wprintgc.cgi#SG1";
const letters =
  "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";
export const codons = [..."UCAG"].flatMap((a, i) =>
  [..."UCAG"].flatMap((b, j) =>
    [..."UCAG"].map((c, k) => ({
      codon: a + b + c,
      amino: letters[i * 16 + j * 4 + k],
    }))
  )
);
export type Codon = (typeof codons)[number];
export const aminoAcids = [
  ["A", "Ala", "Alanine", "알라닌", "nonpolar"],
  ["R", "Arg", "Arginine", "아르기닌", "basic"],
  ["N", "Asn", "Asparagine", "아스파라긴", "polar"],
  ["D", "Asp", "Aspartic acid", "아스파트산", "acidic"],
  ["C", "Cys", "Cysteine", "시스테인", "polar"],
  ["E", "Glu", "Glutamic acid", "글루탐산", "acidic"],
  ["Q", "Gln", "Glutamine", "글루타민", "polar"],
  ["G", "Gly", "Glycine", "글리신", "nonpolar"],
  ["H", "His", "Histidine", "히스티딘", "basic"],
  ["I", "Ile", "Isoleucine", "아이소류신", "nonpolar"],
  ["L", "Leu", "Leucine", "류신", "nonpolar"],
  ["K", "Lys", "Lysine", "라이신", "basic"],
  ["M", "Met", "Methionine", "메티오닌", "nonpolar"],
  ["F", "Phe", "Phenylalanine", "페닐알라닌", "aromatic"],
  ["P", "Pro", "Proline", "프롤린", "nonpolar"],
  ["S", "Ser", "Serine", "세린", "polar"],
  ["T", "Thr", "Threonine", "트레오닌", "polar"],
  ["W", "Trp", "Tryptophan", "트립토판", "aromatic"],
  ["Y", "Tyr", "Tyrosine", "타이로신", "aromatic"],
  ["V", "Val", "Valine", "발린", "nonpolar"],
] as const;
export const libraryVersion = "2026-11-09";

/**
 * Where the property columns of data/amino-properties.json come from. Each
 * value was read from the page itself on the date given (see data/NOTICE.txt);
 * the screen names the source next to the values.
 */
export const aminoSources = {
  /** pKa of α-COOH, α-NH₃⁺ and the side chain, and pI, of the free amino acid. */
  ionization: {
    label: "OpenStax, Organic Chemistry (McMurry), Table 26.1",
    url: "https://openstax.org/books/organic-chemistry/pages/26-1-structures-of-amino-acids",
    checked: "2026-11-27",
  },
  /** Average mass of the residue in a chain: the free amino acid less H₂O. */
  residueMass: {
    label: "Expasy FindMod, Mass values used",
    url: "https://web.expasy.org/findmod/findmod_masses.html",
    checked: "2026-11-27",
  },
  /** Hydropathy index of Kyte & Doolittle, J. Mol. Biol. 157:105–132 (1982). */
  hydropathy: {
    label: "Kyte & Doolittle (1982), Expasy ProtScale",
    url: "https://web.expasy.org/protscale/pscale/Hphob.Doolittle.html",
    checked: "2026-11-27",
  },
} as const;

/** The codons of an amino acid by its one-letter code (`*` for stop), as RNA. */
export const codonsFor = (amino: string) =>
  codons.filter((c) => c.amino === amino).map((c) => c.codon);

const stopWords = ["*", "stop", "ter", "종결", "정지"],
  startWords = ["start", "시작"];
/**
 * Looks codons up by what was typed. `exact` is what the text names outright:
 * a codon (AUG or ATG; N stands for any base, so GCN is every codon starting
 * with GC), an amino acid by its one- or three-letter code or its full name in
 * either language, or "stop" / "start". `partial` follows with everything the
 * text is only part of: codons that begin with it and amino acids whose code
 * or name contains it.
 *
 * A single letter is read as an amino acid first (A is alanine), because that
 * is the more specific meaning; codons beginning with A come after, as partial
 * matches. ANN asks for those codons outright.
 */
export function searchCodons(input: string): {
  exact: Codon[];
  partial: Codon[];
} {
  const text = input.trim().toLowerCase();
  if (!text) return { exact: [], partial: [] };
  const bases = text.toUpperCase().replaceAll("T", "U");
  const pattern = /^[ACGUN]{3}$/.test(bases)
    ? new RegExp(`^${bases.replaceAll("N", "[ACGU]")}$`)
    : null;
  const named = aminoAcids.find(
    (a) =>
      a[0].toLowerCase() === text ||
      a[1].toLowerCase() === text ||
      a[2].toLowerCase() === text ||
      a[3] === text
  );
  const exact = codons.filter((c) =>
    pattern
      ? pattern.test(c.codon)
      : named
      ? c.amino === named[0]
      : stopWords.includes(text)
      ? c.amino === "*"
      : startWords.includes(text) && c.codon === "AUG"
  );
  const prefix = /^[ACGU]{1,2}$/.test(bases) ? bases : null;
  // A lone letter would be "contained" in almost every name, so it only
  // matches where a code or a name begins with it.
  const within = (word: string) =>
    text.length > 1
      ? word.toLowerCase().includes(text)
      : word.toLowerCase().startsWith(text);
  const partial = codons.filter((c) => {
    if (exact.includes(c)) return false;
    if (prefix && c.codon.startsWith(prefix)) return true;
    const amino = aminoAcids.find((a) => a[0] === c.amino);
    return (amino ? amino.slice(1, 4) : ["Stop", "종결"]).some(within);
  });
  return { exact, partial };
}
