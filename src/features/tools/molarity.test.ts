import { describe, expect, it } from "vitest";
import { solveMolarity, type MolarityTarget } from "./molarity";

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
