import { describe, expect, it } from "vitest";
import { dilution } from "./labMath";
import {
  convertConcentration,
  convertVolume,
  followStockUnit,
  matchConcentrationUnit,
  needsMolecularWeight,
  pipettingAdvice,
  readableVolume,
  solveDilution,
  targetUnitsFor,
} from "./dilution";

// Reference values are worked by hand from C1·V1 = C2·V2 and from the volume
// balance of the tubes, not taken from the functions under test.
describe("single dilution", () => {
  it("solves for the stock volume", () => {
    // 100 mM → 10 mM in 10 mL: V1 = 10 × 10 / 100 = 1 mL, diluent 10 − 1 = 9 mL.
    expect(
      solveDilution("stockVolume", { stock: 100, target: 10, volume: 10 })
    ).toMatchObject({
      stockVolume: 1,
      diluentVolume: 9,
      volume: 10,
      target: 10,
      fold: 10,
      relative: false,
    });
  });
  it("solves for the final concentration", () => {
    // 2 mL of 100 mM made up to 50 mL: C2 = 100 × 2 / 50 = 4 mM, 25-fold,
    // diluent 50 − 2 = 48 mL.
    const result = solveDilution("target", {
      stock: 100,
      stockVolume: 2,
      volume: 50,
    });
    expect(result.target).toBeCloseTo(4, 12);
    expect(result.fold).toBeCloseTo(25, 12);
    expect(result.diluentVolume).toBe(48);
    expect(result.stockVolume).toBe(2);
  });
  it("solves for the final volume", () => {
    // 3 mL of 5 M diluted to 0.25 M: V2 = 5 × 3 / 0.25 = 60 mL, 20-fold,
    // diluent 60 − 3 = 57 mL.
    const result = solveDilution("volume", {
      stock: 5,
      target: 0.25,
      stockVolume: 3,
    });
    expect(result.volume).toBeCloseTo(60, 12);
    expect(result.fold).toBeCloseTo(20, 12);
    expect(result.diluentVolume).toBeCloseTo(57, 12);
  });
  it("takes the target as a 1 : N fold, with or without a stock concentration", () => {
    // 1 : 5 to 200 µL: 200 / 5 = 40 µL stock + 160 µL diluent.
    expect(
      solveDilution("stockVolume", { fold: 5, volume: 200 })
    ).toMatchObject({
      stockVolume: 40,
      diluentVolume: 160,
      fold: 5,
      relative: true,
    });
    // With a 50 mM stock the same dilution ends at 50 / 5 = 10 mM.
    expect(
      solveDilution("stockVolume", { stock: 50, fold: 5, volume: 200 })
    ).toMatchObject({ stockVolume: 40, target: 10, relative: false });
    // 25 µL diluted 1 : 4 gives 25 × 4 = 100 µL.
    expect(solveDilution("volume", { fold: 4, stockVolume: 25 })).toMatchObject(
      { volume: 100, diluentVolume: 75, fold: 4 }
    );
    // 1 : 1 is the stock itself.
    expect(solveDilution("stockVolume", { fold: 1, volume: 10 })).toMatchObject(
      { stockVolume: 10, diluentVolume: 0 }
    );
  });
  it("rejects concentrating, overfilling and non-positive inputs", () => {
    expect(() =>
      solveDilution("stockVolume", { stock: 1, target: 10, volume: 10 })
    ).toThrow("Target exceeds stock concentration");
    expect(() =>
      solveDilution("volume", { stock: 1, target: 10, stockVolume: 1 })
    ).toThrow("Target exceeds stock concentration");
    expect(() =>
      solveDilution("target", { stock: 10, stockVolume: 11, volume: 10 })
    ).toThrow("Stock volume exceeds final volume");
    expect(() =>
      solveDilution("stockVolume", { fold: 0.5, volume: 10 })
    ).toThrow("Dilution factor must be at least 1");
    expect(() =>
      solveDilution("stockVolume", { stock: 0, target: 1, volume: 10 })
    ).toThrow("Enter positive finite values");
    expect(() =>
      solveDilution("target", { stock: 10, stockVolume: 1 })
    ).toThrow("Enter positive finite values");
  });
});

describe("serial dilution", () => {
  it("lists transfer, diluent and what is left in each tube", () => {
    // 100 → 10 in 10 mL, then three 2-fold steps.
    // Tube 1: 1 mL stock + 9 mL diluent. Tubes 2–4: 10 / 2 = 5 mL from the
    // tube before + 5 mL diluent. Tubes 1–3 give 5 mL away and keep 5 mL;
    // the last keeps all 10 mL.
    const plan = dilution(100, 10, 10, 4, 2);
    expect(plan.series).toEqual([
      {
        step: 1,
        concentration: 10,
        transferVolume: 1,
        diluentVolume: 9,
        remainingVolume: 5,
      },
      {
        step: 2,
        concentration: 5,
        transferVolume: 5,
        diluentVolume: 5,
        remainingVolume: 5,
      },
      {
        step: 3,
        concentration: 2.5,
        transferVolume: 5,
        diluentVolume: 5,
        remainingVolume: 5,
      },
      {
        step: 4,
        concentration: 1.25,
        transferVolume: 5,
        diluentVolume: 5,
        remainingVolume: 10,
      },
    ]);
    // Diluent: 9 + 3 × 5 = 24 mL. Everything that went in (1 mL stock +
    // 24 mL diluent) is what the tubes hold at the end (5 + 5 + 5 + 10).
    expect(plan.totalDiluent).toBe(24);
    expect(plan.stockVolume + plan.totalDiluent).toBe(25);
    expect(plan.series.reduce((sum, row) => sum + row.remainingVolume, 0)).toBe(
      25
    );
  });
  it("handles a ten-fold series", () => {
    // 1 M → 0.1 M in 1000 µL, three steps of 10: every tube takes 100 µL
    // into 900 µL; diluent 3 × 900 = 2700 µL.
    const plan = dilution(1, 0.1, 1000, 3, 10);
    expect(plan.series.map((row) => row.transferVolume)).toEqual([
      100, 100, 100,
    ]);
    expect(plan.series.map((row) => row.remainingVolume)).toEqual([
      900, 900, 1000,
    ]);
    expect(plan.series[2].concentration).toBeCloseTo(0.001, 12);
    expect(plan.totalDiluent).toBe(2700);
  });
  it("keeps the single dilution when no series is asked for", () => {
    const plan = dilution(100, 10, 10);
    expect(plan.series).toHaveLength(1);
    expect(plan.series[0].remainingVolume).toBe(10);
    expect(plan.totalDiluent).toBe(9);
  });
  it("rejects step counts and factors that make no series", () => {
    expect(() => dilution(100, 10, 10, 2.5, 2)).toThrow("Steps: 1–100");
    expect(() => dilution(100, 10, 10, 101, 2)).toThrow("Steps: 1–100");
    expect(() => dilution(100, 10, 10, 3, 1)).toThrow(
      "Serial dilution factor must exceed 1"
    );
    expect(() => dilution(100, 10, 10, 3, NaN)).toThrow(
      "Serial dilution factor must exceed 1"
    );
  });
});

describe("dilution units", () => {
  it("converts between molar and mass concentration with a molecular weight", () => {
    // 5 mg/mL = 5 g/L; ÷ 250 g/mol = 0.02 M = 20 mM.
    expect(convertConcentration(5, "mg/mL", "mM", 250)).toBeCloseTo(20, 10);
    // 2 mM = 0.002 mol/L; × 250 g/mol = 0.5 g/L = 500 µg/mL.
    expect(convertConcentration(2, "mM", "µg/mL", 250)).toBeCloseTo(500, 10);
    expect(() => convertConcentration(5, "mg/mL", "mM")).toThrow(
      "Molecular weight required"
    );
    // A 5 mg/mL stock (20 mM) to 2 mM in 10 mL needs 2 × 10 / 20 = 1 mL.
    expect(
      solveDilution("stockVolume", {
        stock: 5,
        target: convertConcentration(2, "mM", "mg/mL", 250),
        volume: 10,
      }).stockVolume
    ).toBeCloseTo(1, 10);
  });
  it("treats X as a strength that converts only to itself", () => {
    expect(convertConcentration(10, "X", "X")).toBe(10);
    expect(() => convertConcentration(10, "X", "mM", 100)).toThrow(
      "Incompatible dimensions"
    );
    expect(targetUnitsFor("X")).toEqual(["X"]);
    expect(targetUnitsFor("mM")).not.toContain("X");
    expect(targetUnitsFor("mM")).toContain("mg/mL");
    expect(needsMolecularWeight("mM", "mg/mL")).toBe(true);
    expect(needsMolecularWeight("mM", "µM")).toBe(false);
    expect(needsMolecularWeight("X", "X")).toBe(false);
  });
  it("leaves a value alone when the unit does not change, and knows nL", () => {
    expect(convertConcentration(0.3, "mM", "mM")).toBe(0.3);
    expect(convertVolume(0.3, "µL", "µL")).toBe(0.3);
    // 250 nL = 0.25 µL.
    expect(convertVolume(250, "nL", "µL")).toBeCloseTo(0.25, 12);
  });
  it("moves the target unit with the stock unit unless it was set apart", () => {
    // Both molar: the target follows the stock into mass per volume.
    expect(followStockUnit("mM", "mg/mL", "µM")).toBe("mg/mL");
    // Same family before and after: the target keeps its own unit.
    expect(followStockUnit("mM", "M", "µM")).toBe("µM");
    // The target was deliberately mass per volume against a molar stock.
    expect(followStockUnit("mM", "µM", "mg/mL")).toBe("mg/mL");
    expect(followStockUnit("mM", "g/L", "mg/mL")).toBe("mg/mL");
  });
  it("recognises other spellings of its units and refuses the rest", () => {
    expect(matchConcentrationUnit("mM")).toBe("mM");
    expect(matchConcentrationUnit(" μM ")).toBe("µM");
    expect(matchConcentrationUnit("uM")).toBe("µM");
    expect(matchConcentrationUnit("ug/mL")).toBe("µg/mL");
    // 1 ng/µL = 1000 ng/mL = 1 µg/mL; 1 mg/L = 1 µg/mL.
    expect(matchConcentrationUnit("ng/uL")).toBe("µg/mL");
    expect(matchConcentrationUnit("mg/L")).toBe("µg/mL");
    expect(matchConcentrationUnit("mmol/L")).toBe("mM");
    expect(matchConcentrationUnit("x")).toBe("X");
    // Units that would need the number rescaled, or are not concentrations.
    expect(matchConcentrationUnit("ng/mL")).toBeNull();
    expect(matchConcentrationUnit("cells/mL")).toBeNull();
    expect(matchConcentrationUnit("")).toBeNull();
  });
});

describe("pipetting advice", () => {
  const microlitre = 1e-6;
  it("says nothing from 0.5 µL up", () => {
    expect(pipettingAdvice(0.5 * microlitre, 1000 * microlitre)).toBeNull();
    // 0.0005 mL arrives as 5.000000000000001e-7 L or similar.
    expect(pipettingAdvice(0.0005 * 0.001, 0.01)).toBeNull();
    expect(pipettingAdvice(1e-3, 1e-2)).toBeNull();
  });
  it("suggests a one-step intermediate dilution", () => {
    // 10 mM → 1 µM in 1 mL is 10 000-fold: 0.1 µL of stock. A 100-fold
    // intermediate (2 µL + 198 µL, 100 µM) is used at 0.1 × 100 = 10 µL,
    // with 1000 − 10 = 990 µL diluent. Check: 10 µL × 100 µM / 1000 µL = 1 µM.
    const advice = pipettingAdvice(0.1 * microlitre, 1000 * microlitre);
    expect(advice).toMatchObject({ kind: "intermediate", fold: 100, steps: 1 });
    if (advice?.kind !== "intermediate") throw Error("unexpected advice");
    expect(advice.takeVolume / microlitre).toBeCloseTo(2, 9);
    expect(advice.diluentVolume / microlitre).toBeCloseTo(198, 9);
    expect(advice.transferVolume / microlitre).toBeCloseTo(10, 9);
    expect(advice.finalDiluentVolume / microlitre).toBeCloseTo(990, 9);
  });
  it("uses the smallest power of ten that reaches 2 µL", () => {
    // 0.3 µL into 10 µL: ten-fold gives 3 µL (2 µL + 18 µL intermediate),
    // then 3 µL + 7 µL.
    const advice = pipettingAdvice(0.3 * microlitre, 10 * microlitre);
    expect(advice).toMatchObject({ kind: "intermediate", fold: 10, steps: 1 });
    if (advice?.kind !== "intermediate") throw Error("unexpected advice");
    expect(advice.diluentVolume / microlitre).toBeCloseTo(18, 9);
    expect(advice.transferVolume / microlitre).toBeCloseTo(3, 9);
    expect(advice.finalDiluentVolume / microlitre).toBeCloseTo(7, 9);
    // 0.02 µL needs exactly 100-fold to reach 2 µL, not 1000-fold.
    expect(pipettingAdvice(0.02 * microlitre, 1000 * microlitre)).toMatchObject(
      { fold: 100 }
    );
  });
  it("makes a very dilute intermediate ten-fold at a time", () => {
    // 10 mM → 1 nM in 1 mL is 10⁷-fold: 0.0001 µL of stock. 10⁵-fold
    // (five 10 µL + 90 µL steps, 100 nM) is used at 10 µL + 990 µL.
    const advice = pipettingAdvice(0.0001 * microlitre, 1000 * microlitre);
    expect(advice).toMatchObject({
      kind: "intermediate",
      fold: 100000,
      steps: 5,
    });
    if (advice?.kind !== "intermediate") throw Error("unexpected advice");
    expect(advice.takeVolume / microlitre).toBeCloseTo(10, 9);
    expect(advice.diluentVolume / microlitre).toBeCloseTo(90, 9);
    expect(advice.transferVolume / microlitre).toBeCloseTo(10, 9);
    expect(advice.finalDiluentVolume / microlitre).toBeCloseTo(990, 9);
  });
  it("asks for a larger final volume when an intermediate cannot help", () => {
    // 0.2 µL into 2 µL is 10-fold. A ten-fold intermediate would be the
    // final solution itself; 0.5 µL of stock needs 0.5 × 10 = 5 µL.
    const advice = pipettingAdvice(0.2 * microlitre, 2 * microlitre);
    expect(advice?.kind).toBe("larger-volume");
    if (advice?.kind !== "larger-volume") throw Error("unexpected advice");
    expect(advice.minimumVolume / microlitre).toBeCloseTo(5, 9);
  });
  it("names volumes in the unit a person would use", () => {
    const named = (litres: number) => {
      const { value, unit } = readableVolume(litres);
      return `${Number(value.toPrecision(9))} ${unit}`;
    };
    expect(named(2e-6)).toBe("2 µL");
    expect(named(1.98e-4)).toBe("198 µL");
    expect(named(0.002)).toBe("2 mL");
    expect(named(1.5)).toBe("1.5 L");
    expect(named(5e-10)).toBe("0.5 nL");
    // 1 mL that arrives with floating-point residue is still 1 mL.
    expect(named(0.0009999999999999998)).toBe("1 mL");
  });
});
