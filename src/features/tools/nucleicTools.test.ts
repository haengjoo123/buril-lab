import { describe, it, expect } from "vitest";
import {
  cleanSequence,
  duplexThermodynamics,
  gcPercent,
  invalidBases,
  longestRun,
  meltingTemperature,
  nearestNeighbourTable,
  oligoMolecularWeight,
  resuspensionVolume,
  reverseComplement,
  wallaceTemperature,
} from "./oligo";
import {
  concentrationFromA260,
  copyNumber,
  ligationInsertMass,
  nanograms,
  nucleicAcidWeight,
  picomoles,
  purityRatio,
} from "./nucleic";

describe("oligo calculations", () => {
  it("holds a nearest-neighbour table consistent with the paper's own ΔG°37 column", () => {
    // ΔG°37 = ΔH° − 310.15 K × ΔS°. SantaLucia (1998) lists all three; a
    // mistyped ΔH° or ΔS° would break this within the paper's rounding.
    for (const [pair, [h, s, g]] of Object.entries(nearestNeighbourTable))
      expect(Math.abs(h - (310.15 * s) / 1000 - g), pair).toBeLessThan(0.03);
    expect(Object.keys(nearestNeighbourTable)).toHaveLength(10);
  });
  it("reproduces the paper's worked example for CGTTGA", () => {
    // SantaLucia (1998): ΔG°37 = 0.98 + 1.03 − 2.17 − 1.44 − 1.00 − 1.45 − 1.30 = −5.35 kcal/mol.
    // ΔH° = 0.1 + 2.3 − 10.6 − 8.4 − 7.9 − 8.5 − 8.2 = −41.2; ΔS° = −2.8 + 4.1 − 27.2 − 22.4 − 22.2 − 22.7 − 22.2 = −115.4.
    const d = duplexThermodynamics("CGTTGA");
    expect(d.freeEnergy).toBeCloseTo(-5.35, 2);
    expect(d.enthalpy).toBeCloseTo(-41.2, 6);
    expect(d.entropy).toBeCloseTo(-115.4, 6);
    expect(d.selfComplementary).toBe(false);
  });
  it("computes a nearest-neighbour Tm with the sodium correction", () => {
    // M13 forward (−20), 17 nt, 250 nM strands, 50 mM Na⁺ (separate calculation):
    //   ΔH° = −133.6, ΔS° = −360.7
    //   ΔS° + 0.368·16·ln(0.05) = −378.339
    //   Tm = −133600 / (−378.339 + 1.987·ln(250e−9 / 4)) − 273.15 = 51.67 °C
    expect(meltingTemperature("GTAAAACGACGGCCAGT", 250e-9, 0.05)).toBeCloseTo(
      51.67,
      1
    );
    // More salt and more oligo both raise Tm.
    expect(meltingTemperature("GTAAAACGACGGCCAGT", 250e-9, 0.1)).toBeGreaterThan(
      51.67
    );
    expect(meltingTemperature("GTAAAACGACGGCCAGT", 1e-6, 0.05)).toBeGreaterThan(
      51.67
    );
  });
  it("treats a self-complementary oligo with the symmetry term", () => {
    // GAATTC is its own reverse complement: ΔS° gains −1.4 and C is not divided by 4.
    const d = duplexThermodynamics("GAATTC");
    expect(d.selfComplementary).toBe(true);
    expect(d.entropy).toBeCloseTo(-116.2, 6);
    expect(meltingTemperature("GAATTC", 250e-9, 0.05)).toBeCloseTo(-15.12, 1);
  });
  it("counts composition, weight and the 2 + 4 rule", () => {
    expect(gcPercent("ACGT")).toBe(50);
    expect(wallaceTemperature("ACGT")).toBe(12); // 2·2 + 4·2
    // 313.2 + 289.2 + 329.2 + 304.2 = 1235.8; 5′-OH oligo: −61.96 → 1173.84.
    expect(oligoMolecularWeight("ACGT")).toBeCloseTo(1173.84, 6);
    // With a 5′ phosphate the chain keeps all four phosphates: +18.02 → 1253.82.
    expect(oligoMolecularWeight("ACGT", true)).toBeCloseTo(1253.82, 6);
    expect(reverseComplement("ATGC")).toBe("GCAT");
    expect(longestRun("ACGGGGT")).toBe(4);
  });
  it("cleans pasted sequences and reports what is not a base", () => {
    expect(cleanSequence("5'-gta aaa\ncga 3'")).toBe("GTAAAACGA");
    expect(cleanSequence("AUGC")).toBe("ATGC");
    expect(invalidBases("ACGTNRX")).toEqual(["N", "R", "X"]);
    expect(() => meltingTemperature("ACGN", 250e-9, 0.05)).toThrow(
      "only A, C, G and T"
    );
    expect(() => gcPercent("")).toThrow("Enter a sequence");
  });
  it("gives the volume that dissolves an oligo to a stock concentration", () => {
    // 25 nmol to 100 µM: 25 nmol / 100 µmol/L = 0.25 mL = 250 µL.
    expect(resuspensionVolume(25, 100)).toBeCloseTo(250, 9);
    expect(() => resuspensionVolume(0, 100)).toThrow();
  });
});

describe("nucleic acid quantitation", () => {
  it("uses the published average weights", () => {
    expect(nucleicAcidWeight("dsDNA", 1000)).toBeCloseTo(607557.9, 6); // 1000·607.4 + 157.9
    expect(nucleicAcidWeight("ssDNA", 20)).toBeCloseTo(6153.0, 6); // 20·303.7 + 79.0
    expect(nucleicAcidWeight("RNA", 100)).toBeCloseTo(32209.0, 6); // 100·320.5 + 159.0
    expect(() => nucleicAcidWeight("dsDNA", 0)).toThrow();
    expect(() => nucleicAcidWeight("dsDNA", 10.5)).toThrow("whole number");
  });
  it("converts between mass and moles and back", () => {
    // 1 µg of a 1000 bp fragment: 1000 ng / 607557.9 g/mol = 1.64593 pmol.
    expect(picomoles("dsDNA", 1000, 1000)).toBeCloseTo(1.64593, 4);
    expect(nanograms("dsDNA", 1000, 1.6459336632771953)).toBeCloseTo(1000, 6);
    // 1 ng of a 3000 bp plasmid: (1e−9 g / 1822357.9 g/mol) × 6.02214076e23 = 3.3046e8 molecules.
    expect(copyNumber("dsDNA", 3000, 1) / 1e8).toBeCloseTo(3.3046, 3);
  });
  it("sizes a ligation insert from the molar ratio", () => {
    // 50 ng of a 3000 bp vector, 1000 bp insert, 3:1.
    // The length-ratio shortcut gives 50 × (1000/3000) × 3 = 50 ng; from moles
    // with the weights above it is 50.0087 ng.
    expect(ligationInsertMass(3000, 50, 1000, 3)).toBeCloseTo(50.0087, 3);
    expect(ligationInsertMass(3000, 50, 1000, 1)).toBeCloseTo(50.0087 / 3, 3);
  });
  it("reads concentration and purity from absorbance", () => {
    // A260 0.25, dsDNA (50 µg/mL per unit), 10-fold dilution, 1 cm: 125 µg/mL.
    expect(concentrationFromA260(0.25, 50, 10)).toBeCloseTo(125, 9);
    // A 0.1 cm path reads a tenth of the absorbance for the same sample.
    expect(concentrationFromA260(0.025, 50, 10, 0.1)).toBeCloseTo(125, 9);
    expect(concentrationFromA260(0, 40)).toBe(0);
    expect(purityRatio(0.9, 0.5)).toBeCloseTo(1.8, 9);
    expect(() => purityRatio(0.9, 0)).toThrow();
    expect(() => concentrationFromA260(-0.1, 50)).toThrow();
  });
});
