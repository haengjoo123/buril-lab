import { describe, it, expect } from "vitest";
import { aminoAcids, codonsFor, searchCodons } from "./library";
import properties from "./data/amino-properties.json";
import {
  readingFrames,
  translate,
  translateSequence,
} from "./translate";
import {
  FormulaError,
  checkFormula,
  formulaWeight,
  parseFormula,
} from "./formula";
import { IncompleteInput } from "./format";
import {
  elementGroup,
  elementPeriod,
  elementPosition,
  stepElement,
} from "./elementNames";

describe("sequence translation", () => {
  // Translated by hand from the standard code, codon by codon:
  //   +1  ATG GCC ATT GTA ATG GGC CGC TGA AAG GGT GCC CGA TAG
  //        M   A   I   V   M   G   R   *   K   G   A   R   *
  //   +2  TGG CCA TTG TAA TGG GCC GCT GAA AGG GTG CCC GAT (AG)
  //        W   P   L   *   W   A   A   E   R   V   P   D
  //   +3  GGC CAT TGT AAT GGG CCG CTG AAA GGG TGC CCG ATA (G)
  //        G   H   C   N   G   P   L   K   G   C   P   I
  const dna = "ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG";
  it("translates the three reading frames of a strand", () => {
    expect(readingFrames(dna)).toEqual([
      { frame: 1, protein: "MAIVMGR*KGAR*", trailing: 0 },
      { frame: 2, protein: "WPL*WAAERVPD", trailing: 2 },
      { frame: 3, protein: "GHCNGPLKGCPI", trailing: 1 },
    ]);
  });
  it("gives the reverse complement and its frames", () => {
    const read = translateSequence(dna);
    // The strand reversed, each base replaced by its partner.
    expect(read.reverse).toBe("CTATCGGGCACCCTTTCAGCGGCCCATTACAATGGCCAT");
    // −1  CTA TCG GGC ACC CTT TCA GCG GCC CAT TAC AAT GGC CAT
    //      L   S   G   T   L   S   A   A   H   Y   N   G   H
    expect(read.backward[0]).toEqual({
      frame: 1,
      protein: "LSGTLSAAHYNGH",
      trailing: 0,
    });
    expect(read.forward[0].protein).toBe("MAIVMGR*KGAR*");
    expect(read.rna).toBe(false);
    expect(read.unknown).toBe(0);
  });
  it("reads RNA, lower case, spacing and FASTA headers", () => {
    const read = translateSequence(">mRNA test 1\n5'-aug gcc AUU\nUAA-3'");
    expect(read.rna).toBe(true);
    expect(read.sequence).toBe("AUGGCCAUUUAA");
    expect(read.forward[0].protein).toBe("MAI*");
    // Written back in the letters it came in.
    expect(read.reverse).toBe("UUAAAUGGCCAU");
  });
  it("marks a codon with an unknown base as X and leaves partial codons out", () => {
    expect(translate("ATGNCCTA")).toBe("MX");
    const read = translateSequence("ATGNCCTA");
    expect(read.unknown).toBe(1);
    expect(read.forward[0].trailing).toBe(2);
    // The unknown base stays unknown on the other strand.
    expect(read.reverse).toBe("TAGGNCAT");
  });
  it("returns nothing for an empty sequence", () => {
    const read = translateSequence("  \n");
    expect(read.sequence).toBe("");
    expect(read.forward.map((frame) => frame.protein)).toEqual(["", "", ""]);
  });
});

describe("codon search", () => {
  const list = (found: { codon: string }[]) => found.map((c) => c.codon);
  it("finds a codon exactly, in RNA or DNA letters", () => {
    expect(list(searchCodons("AUG").exact)).toEqual(["AUG"]);
    expect(list(searchCodons(" atg ").exact)).toEqual(["AUG"]);
    expect(searchCodons("AUG").partial).toEqual([]);
  });
  it("puts an amino acid's own codons before partial matches", () => {
    // K is lysine; nothing else is named K.
    const one = searchCodons("K");
    expect(list(one.exact)).toEqual(["AAA", "AAG"]);
    expect(list(searchCodons("Lys").exact)).toEqual(["AAA", "AAG"]);
    expect(list(searchCodons("lysine").exact)).toEqual(["AAA", "AAG"]);
    expect(list(searchCodons("라이신").exact)).toEqual(["AAA", "AAG"]);
    // "leu" is leucine outright and part of isoleucine.
    const leu = searchCodons("leu");
    expect(list(leu.exact)).toEqual([
      "UUA",
      "UUG",
      "CUU",
      "CUC",
      "CUA",
      "CUG",
    ]);
    expect(list(leu.partial)).toEqual(["AUU", "AUC", "AUA"]);
  });
  it("reads a single base letter as the amino acid first, then as a first base", () => {
    const found = searchCodons("A");
    expect(list(found.exact)).toEqual(["GCU", "GCC", "GCA", "GCG"]);
    // Every codon starting with A follows, as a partial match.
    expect(list(found.partial)).toEqual(
      expect.arrayContaining(["AUG", "AAA", "AGG"])
    );
    expect(found.partial.some((c) => found.exact.includes(c))).toBe(false);
  });
  it("matches N as any base and finds stop and start by name", () => {
    expect(list(searchCodons("GCN").exact)).toEqual(codonsFor("A"));
    expect(searchCodons("ANN").exact).toHaveLength(16);
    expect(list(searchCodons("TNN").exact).every((c) => c[0] === "U")).toBe(
      true
    );
    expect(list(searchCodons("stop").exact)).toEqual(["UAA", "UAG", "UGA"]);
    expect(list(searchCodons("종결").exact)).toEqual(["UAA", "UAG", "UGA"]);
    expect(list(searchCodons("*").exact)).toEqual(["UAA", "UAG", "UGA"]);
    expect(list(searchCodons("start").exact)).toEqual(["AUG"]);
  });
  it("lists codons by their first bases as partial matches", () => {
    const found = searchCodons("UA");
    expect(found.exact).toEqual([]);
    expect(list(found.partial)).toEqual(["UAU", "UAC", "UAA", "UAG"]);
    expect(searchCodons("")).toEqual({ exact: [], partial: [] });
    expect(searchCodons("zzz")).toEqual({ exact: [], partial: [] });
  });
  it("gives every amino acid its codons, 61 in all", () => {
    expect(codonsFor("M")).toEqual(["AUG"]);
    expect(codonsFor("W")).toEqual(["UGG"]);
    expect(
      aminoAcids.reduce((sum, a) => sum + codonsFor(a[0]).length, 0)
    ).toBe(61);
  });
});

describe("formula weights", () => {
  // Atomic weights as data/periodic-table.json has them (PubChem):
  //   H 1.0080  C 12.011  N 14.007  O 15.999  Na 22.9897693  Al 26.981538
  //   S 32.07   Cl 35.45  K 39.0983 Ca 40.08  Fe 55.84       Cu 63.55
  it("adds the atoms of a simple formula", () => {
    // 6 × 12.011 + 12 × 1.0080 + 6 × 15.999 = 72.066 + 12.096 + 95.994
    const glucose = formulaWeight("C6H12O6");
    expect(glucose.mass).toBeCloseTo(180.156, 6);
    expect(glucose.decimals).toBe(3);
    expect(glucose.rounded).toBe(180.156);
    expect(glucose.parts.map((p) => [p.symbol, p.count])).toEqual([
      ["C", 6],
      ["H", 12],
      ["O", 6],
    ]);
    // 72.066 / 180.156, 12.096 / 180.156, 95.994 / 180.156
    expect(glucose.parts[0].percent).toBeCloseTo(40.002, 3);
    expect(glucose.parts[1].percent).toBeCloseTo(6.7142, 3);
    expect(glucose.parts[2].percent).toBeCloseTo(53.2838, 3);
    expect(glucose.parts[0].mass).toBeCloseTo(72.066, 6);
    // 22.9897693 + 35.45; chlorine is stated to two places.
    expect(formulaWeight("NaCl").mass).toBeCloseTo(58.4397693, 6);
    expect(formulaWeight("NaCl").rounded).toBe(58.44);
  });
  it("multiplies bracketed groups, to any depth", () => {
    // 40.08 + 2 × (15.999 + 1.0080) = 40.08 + 34.014
    const lime = formulaWeight("Ca(OH)2");
    expect(lime.mass).toBeCloseTo(74.094, 6);
    expect(lime.rounded).toBe(74.09);
    // 2 × 26.981538 + 3 × 32.07 + 12 × 15.999 = 53.963076 + 96.21 + 191.988
    expect(formulaWeight("Al2(SO4)3").mass).toBeCloseTo(342.161076, 6);
    // 4 × 39.0983 + 55.84 + 6 × 12.011 + 6 × 14.007
    //   = 156.3932 + 55.84 + 72.066 + 84.042
    const ferrocyanide = formulaWeight("K4[Fe(CN)6]");
    expect(ferrocyanide.mass).toBeCloseTo(368.3412, 6);
    expect(ferrocyanide.rounded).toBe(368.34);
    expect([...parseFormula("K4[Fe(CN)6]")]).toEqual([
      ["K", 4],
      ["Fe", 1],
      ["C", 6],
      ["N", 6],
    ]);
  });
  it("adds water of hydration after a middle dot, a full stop or an asterisk", () => {
    // 63.55 + 32.07 + 9 × 15.999 + 10 × 1.0080 = 63.55 + 32.07 + 143.991 + 10.080
    for (const text of [
      "CuSO4·5H2O",
      "CuSO4.5H2O",
      "CuSO4*5H2O",
      "CuSO4 • 5 H2O",
      "CuSO₄·5H₂O",
    ]) {
      const hydrate = formulaWeight(text);
      expect(hydrate.mass).toBeCloseTo(249.691, 6);
      expect(hydrate.rounded).toBe(249.69);
      expect(hydrate.parts.map((p) => [p.symbol, p.count])).toEqual([
        ["Cu", 1],
        ["S", 1],
        ["O", 9],
        ["H", 10],
      ]);
    }
    // Mohr's salt: N 2 × 14.007, H 20 × 1.0080, Fe 55.84, S 2 × 32.07,
    // O 14 × 15.999 = 28.014 + 20.160 + 55.84 + 64.14 + 223.986
    expect(formulaWeight("(NH4)2[Fe(SO4)2]·6H2O").mass).toBeCloseTo(392.14, 6);
    // Hemihydrate: 40.08 + 32.07 + 4.5 × 15.999 + 1 × 1.0080
    //   = 40.08 + 32.07 + 71.9955 + 1.0080
    const plaster = formulaWeight("CaSO4·0.5H2O");
    expect(plaster.mass).toBeCloseTo(145.1535, 6);
    expect(plaster.parts.find((p) => p.symbol === "H")?.count).toBe(1);
  });
  it("tells cobalt from carbon monoxide by case", () => {
    // Co 58.93319; C 12.011 + O 15.999
    expect(formulaWeight("Co").mass).toBeCloseTo(58.93319, 6);
    expect(formulaWeight("CO").mass).toBeCloseTo(28.01, 6);
  });
  it("names what is wrong with a formula it cannot read", () => {
    const problem = (text: string) => {
      const { error, near, weight } = checkFormula(text);
      expect(weight).toBeNull();
      return [error, near];
    };
    expect(problem("Xx2O")).toEqual(["Unknown element symbol", "Xx"]);
    expect(problem("h2o")).toEqual(["Unknown element symbol", "h"]);
    expect(problem("Ca(OH")).toEqual(["Unbalanced brackets in formula", "("]);
    expect(problem("H2O)")).toEqual(["Unbalanced brackets in formula", ")"]);
    expect(problem("Ca(OH]2")).toEqual(["Unbalanced brackets in formula", "]"]);
    expect(problem("H2O+")).toEqual(["Unexpected character in formula", "+"]);
    expect(problem("Ca()2")).toEqual(["Incomplete formula", "()"]);
    expect(problem("CuSO4·")).toEqual(["Incomplete formula", ""]);
    expect(problem("5")).toEqual(["Incomplete formula", ""]);
    expect(problem("H0")).toEqual([
      "Formula count must be greater than zero",
      "0",
    ]);
    expect(() => formulaWeight("Ca(OH")).toThrow(FormulaError);
  });
  it("treats an empty formula as not yet entered", () => {
    expect(() => formulaWeight("  ")).toThrow(IncompleteInput);
    expect(checkFormula("")).toEqual({ weight: null, error: "", near: "" });
  });
});

describe("amino acid properties", () => {
  it("has every property for all 20 amino acids", () => {
    expect(properties).toHaveLength(20);
    for (const a of aminoAcids) {
      const row = properties.find((item) => item.name === a[2])!;
      expect(row, a[2]).toBeDefined();
      for (const value of [
        row.residueMass,
        row.pKaCarboxyl,
        row.pKaAmino,
        row.pI,
        row.hydropathy,
      ])
        expect(Number.isFinite(value), a[2]).toBe(true);
    }
    // Seven side chains ionize: Asp, Glu, His, Cys, Tyr, Lys, Arg.
    expect(
      properties
        .filter((row) => row.pKaSideChain != null)
        .map((row) => row.name)
        .sort()
    ).toEqual([
      "Arginine",
      "Aspartic acid",
      "Cysteine",
      "Glutamic acid",
      "Histidine",
      "Lysine",
      "Tyrosine",
    ]);
  });
  it("lists residue masses that are the formula weight less one water", () => {
    // An independent route to the same number: the PubChem formula, weighed
    // with the PubChem atomic weights, minus H2O. PubChem states sulfur as
    // 32.07, which puts cysteine and methionine 0.01 above the listed mass.
    const water = formulaWeight("H2O").mass;
    for (const row of properties)
      expect(
        Math.abs(formulaWeight(row.formula).mass - water - row.residueMass),
        row.name
      ).toBeLessThan(0.02);
  });
  it("keeps the values read from the sources", () => {
    const of = (name: string) => properties.find((row) => row.name === name)!;
    // OpenStax Organic Chemistry, Table 26.1.
    expect(of("Lysine")).toMatchObject({
      pKaCarboxyl: 2.18,
      pKaAmino: 8.95,
      pKaSideChain: 10.53,
      pI: 9.74,
    });
    expect(of("Aspartic acid")).toMatchObject({ pKaSideChain: 3.65, pI: 2.77 });
    expect(of("Glycine")).toMatchObject({ pKaSideChain: null, pI: 5.97 });
    // Expasy FindMod, average residue masses.
    expect(of("Glycine").residueMass).toBe(57.0519);
    expect(of("Tryptophan").residueMass).toBe(186.2132);
    // Kyte & Doolittle (1982): the two ends of the scale.
    expect(of("Isoleucine").hydropathy).toBe(4.5);
    expect(of("Arginine").hydropathy).toBe(-4.5);
  });
});

describe("periodic table layout", () => {
  it("derives group and period from the atomic number", () => {
    expect([elementGroup(1), elementPeriod(1)]).toEqual([1, 1]);
    expect([elementGroup(2), elementPeriod(2)]).toEqual([18, 1]);
    expect([elementGroup(6), elementPeriod(6)]).toEqual([14, 2]);
    expect([elementGroup(17), elementPeriod(17)]).toEqual([17, 3]);
    expect([elementGroup(26), elementPeriod(26)]).toEqual([8, 4]);
    expect([elementGroup(79), elementPeriod(79)]).toEqual([11, 6]);
    expect([elementGroup(118), elementPeriod(118)]).toEqual([18, 7]);
    // The rows set apart keep their period and have no group.
    expect([elementGroup(57), elementPeriod(57)]).toEqual([null, 6]);
    expect([elementGroup(92), elementPeriod(92)]).toEqual([null, 7]);
  });
  it("gives every element its own cell", () => {
    const cells = new Set(
      Array.from({ length: 118 }, (_, i) => elementPosition(i + 1).join(","))
    );
    expect(cells.size).toBe(118);
  });
  it("moves with the arrow keys and skips empty cells", () => {
    // H → He across the gap of period 1, and no further.
    expect(stepElement(1, "ArrowRight")).toBe(2);
    expect(stepElement(2, "ArrowRight")).toBe(2);
    expect(stepElement(2, "ArrowLeft")).toBe(1);
    // Be → B across the gap of period 2.
    expect(stepElement(4, "ArrowRight")).toBe(5);
    // He ↓ Ne; H ↓ Li; nothing above H.
    expect(stepElement(2, "ArrowDown")).toBe(10);
    expect(stepElement(1, "ArrowDown")).toBe(3);
    expect(stepElement(1, "ArrowUp")).toBe(1);
    // Sc has nothing above it in group 3.
    expect(stepElement(21, "ArrowUp")).toBe(21);
    // Below Y the group-3 cells are placeholders: the next element down is La.
    expect(stepElement(39, "ArrowDown")).toBe(57);
    expect(stepElement(57, "ArrowUp")).toBe(39);
    expect(stepElement(57, "ArrowDown")).toBe(89);
    // Ba → Hf: the lanthanides are not in that row.
    expect(stepElement(56, "ArrowRight")).toBe(72);
    expect(stepElement(57, "ArrowRight")).toBe(58);
    // Home and End go to the ends of the row.
    expect(stepElement(26, "Home")).toBe(19);
    expect(stepElement(26, "End")).toBe(36);
    expect(stepElement(60, "Home")).toBe(57);
    expect(stepElement(60, "End")).toBe(71);
  });
});
