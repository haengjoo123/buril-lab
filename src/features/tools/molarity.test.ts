import { describe, expect, it } from "vitest";
import {
  fromMolarityBase,
  molecularWeightText,
  pureMass,
  solveMolarity,
  storeMolecularWeight,
  toMolarityBase,
  type MolarityTarget,
} from "./molarity";

const standard: Record<MolarityTarget, number> = {
  mass: 0.05844,
  concentration: 0.01,
  volume: 0.1,
  mw: 58.44,
  amount: 0.001,
  massConcentration: 0.5844,
};
describe("molarity calculations", () => {
  // Independent preparation example: 58.44 mg NaCl, 100 mL final volume, 10 mM.
  it.each(["mass", "concentration", "volume", "mw"] as const)(
    "solves %s from the solution preparation reference",
    (target) => {
      expect(solveMolarity("mass", target, standard)).toBeCloseTo(
        standard[target],
        10
      );
    }
  );
  it.each(["amount", "concentration", "volume"] as const)(
    "solves %s from one mmol in 100 mL without a molecular weight",
    (target) => {
      expect(
        solveMolarity("amount", target, { ...standard, mw: NaN, mass: NaN })
      ).toBeCloseTo(standard[target], 10);
    }
  );
  it.each(["massConcentration", "concentration", "mw"] as const)(
    "solves %s from mass per volume without requiring solution volume",
    (target) => {
      expect(
        solveMolarity("massConcentration", target, {
          ...standard,
          volume: NaN,
          mass: NaN,
        })
      ).toBeCloseTo(standard[target], 10);
    }
  );
  it("accepts zero solute concentration and rejects zero divisors and non-finite inputs", () => {
    expect(
      solveMolarity("mass", "concentration", { ...standard, mass: 0 })
    ).toBe(0);
    expect(() =>
      solveMolarity("mass", "volume", { ...standard, concentration: 0 })
    ).toThrow();
    expect(() =>
      solveMolarity("mass", "concentration", { ...standard, volume: 0 })
    ).toThrow();
    expect(() =>
      solveMolarity("mass", "concentration", { ...standard, mw: -1 })
    ).toThrow();
    expect(() =>
      solveMolarity("amount", "concentration", { ...standard, amount: NaN })
    ).toThrow();
    expect(() =>
      solveMolarity("massConcentration", "mw", {
        ...standard,
        massConcentration: 0,
      })
    ).toThrow();
  });
});
describe("purity correction", () => {
  it("weighs more of a reagent that is not pure", () => {
    // 10 mM NaCl in 100 mL needs 0.05844 g of solute. From a 98 % reagent
    // that is 0.05844 / 0.98 = 0.0596326530612… g to weigh.
    expect(solveMolarity("mass", "mass", standard, 98)).toBeCloseTo(
      0.0596326530612,
      12
    );
    // A pure reagent is weighed as it is.
    expect(solveMolarity("mass", "mass", standard, 100)).toBeCloseTo(
      0.05844,
      12
    );
  });
  it("counts only the pure part of a mass that was weighed", () => {
    // 1 g of an 80 % reagent holds 0.8 g of solute. With 40 g/mol that is
    // 0.02 mol; in 0.5 L it is 0.04 M.
    const weighed = {
      ...standard,
      mass: 1,
      mw: 40,
      volume: 0.5,
      concentration: 0.04,
    };
    expect(solveMolarity("mass", "concentration", weighed, 80)).toBeCloseTo(
      0.04,
      12
    );
    // The same solution read the other ways round: 0.02 mol / 0.04 M = 0.5 L,
    // and 0.8 g / 0.02 mol = 40 g/mol.
    expect(solveMolarity("mass", "volume", weighed, 80)).toBeCloseTo(0.5, 12);
    expect(solveMolarity("mass", "mw", weighed, 80)).toBeCloseTo(40, 12);
    // And back: 0.04 M × 40 g/mol × 0.5 L = 0.8 g pure, 0.8 / 0.8 = 1 g weighed.
    expect(solveMolarity("mass", "mass", weighed, 80)).toBeCloseTo(1, 12);
    expect(pureMass(1, 80)).toBeCloseTo(0.8, 12);
  });
  it("applies only where a mass is weighed and rejects impossible purities", () => {
    // 1 mmol in 100 mL is 10 mM whatever the purity field says.
    expect(
      solveMolarity(
        "amount",
        "concentration",
        { ...standard, mw: NaN, mass: NaN },
        50
      )
    ).toBeCloseTo(0.01, 12);
    for (const purity of [0, -5, 100.1, NaN])
      expect(() => solveMolarity("mass", "mass", standard, purity)).toThrow(
        "Purity must be between 0 and 100"
      );
  });
});
describe("molarity units", () => {
  it("reads and writes molecular weight in g/mol or kDa", () => {
    // 1 kDa = 1000 g/mol.
    expect(toMolarityBase("mw", 66.5, "kDa")).toBeCloseTo(66500, 9);
    expect(fromMolarityBase("mw", 66500, "kDa")).toBeCloseTo(66.5, 12);
    expect(toMolarityBase("mw", 58.44, "g/mol")).toBe(58.44);
    expect(fromMolarityBase("mw", 58.44, "g/mol")).toBe(58.44);
    expect(() => toMolarityBase("mw", 1, "Da")).toThrow(
      "Invalid unit or value"
    );
  });
  it("keeps the stored molecular weight in g/mol when it is typed in kDa", () => {
    // Builds from before kDa read `mw` as g/mol, so 66.5 kDa is stored as
    // 66 500 with the typed text beside it.
    expect(storeMolecularWeight("66.5", "kDa")).toEqual({
      mw: "66500",
      mwTyped: "66.5",
    });
    expect(molecularWeightText("66500", "kDa", "66.5")).toBe("66.5");
    // Text still being typed is shown as typed.
    expect(storeMolecularWeight("66.", "kDa")).toEqual({
      mw: "66000",
      mwTyped: "66.",
    });
    expect(molecularWeightText("66000", "kDa", "66.")).toBe("66.");
    expect(storeMolecularWeight("", "kDa")).toEqual({ mw: "", mwTyped: "" });
    expect(molecularWeightText("", "kDa", "")).toBe("");
    expect(storeMolecularWeight("x", "kDa")).toEqual({ mw: "", mwTyped: "x" });
    expect(molecularWeightText("", "kDa", "x")).toBe("x");
    // In g/mol the field is the stored value itself.
    expect(storeMolecularWeight("58.44", "g/mol")).toEqual({
      mw: "58.44",
      mwTyped: "",
    });
    expect(molecularWeightText("58.44", "g/mol", "")).toBe("58.44");
    // An older build changed the g/mol value to 150 000: that is 150 kDa,
    // whatever was typed before.
    expect(molecularWeightText("150000", "kDa", "66.5")).toBe("150");
  });
  it("converts the other quantities through their base units", () => {
    expect(toMolarityBase("mass", 5, "mg")).toBeCloseTo(0.005, 12);
    expect(toMolarityBase("volume", 250, "µL")).toBeCloseTo(0.00025, 12);
    expect(fromMolarityBase("concentration", 0.01, "mM")).toBeCloseTo(10, 12);
    expect(fromMolarityBase("amount", 0.002, "mmol")).toBeCloseTo(2, 12);
    // 1 % w/v is 1 g per 100 mL, 10 g/L.
    expect(toMolarityBase("massConcentration", 1, "% w/v")).toBeCloseTo(10, 12);
  });
  it("solves a protein solution given in kDa", () => {
    // 1 mg of a 66.5 kDa protein in 1 mL: 0.001 g / 66 500 g/mol / 0.001 L
    // = 1 / 66 500 M = 15.0375939… µM.
    const molar = solveMolarity("mass", "concentration", {
      ...standard,
      mass: toMolarityBase("mass", 1, "mg"),
      mw: toMolarityBase("mw", 66.5, "kDa"),
      volume: toMolarityBase("volume", 1, "mL"),
    });
    expect(fromMolarityBase("concentration", molar, "µM")).toBeCloseTo(
      15.0375939849,
      8
    );
  });
});
