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
