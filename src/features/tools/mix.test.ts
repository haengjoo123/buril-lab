import { describe, expect, it } from "vitest";
import { mixAmounts } from "./labMath";
import {
  microlitres,
  mixFactor,
  readableMass,
  readableVolume,
  reactionVolumes,
  recipeAmount,
  recipeLitres,
  recipeScale,
  scaled,
  stockVolume,
} from "./mix";

// Every expected value below is worked out by hand in the comment beside it,
// not taken from what the functions return.
describe("master mix", () => {
  it("multiplies one reaction by reactions and overage", () => {
    // 8 reactions + 10 % = 8 × 1.1 = 8.8 reactions' worth.
    expect(mixFactor(8, 10)).toBeCloseTo(8.8, 12);
    // No overage: exactly the number of reactions.
    expect(mixFactor(24, 0)).toBe(24);
    // 2.5 µL per reaction × 8.8 = 22 µL.
    expect(scaled(2.5, 8, 10)).toBeCloseTo(22, 12);
    // The same arithmetic the tool has always used for a row.
    expect(
      mixAmounts([{ name: "Buffer", amount: 2.5, unit: "µL" }], 4, 0)[0].total
    ).toBe(10);
  });
  it("rejects a reaction count that is not a whole number of at least one, and a negative overage", () => {
    expect(() => mixFactor(2.5, 10)).toThrow(
      "Reaction count must be an integer"
    );
    expect(() => mixFactor(0, 10)).toThrow("Reaction count must be an integer");
    expect(() => mixFactor(-3, 10)).toThrow(
      "Reaction count must be an integer"
    );
    expect(() => mixFactor(8, -1)).toThrow("Overage must be zero or more");
    expect(() => mixFactor(8, NaN)).toThrow("Overage must be zero or more");
    expect(() => scaled(-1, 4)).toThrow("Invalid amount");
  });
  it("works out a stock volume from final ÷ stock × reaction volume", () => {
    // 10X buffer to 1X in 25 µL: 1/10 × 25 = 2.5 µL.
    expect(stockVolume(10, 1, 25)).toBeCloseTo(2.5, 12);
    // 10 µM primer to 0.4 µM in 20 µL: 0.04 × 20 = 0.8 µL.
    expect(stockVolume(10, 0.4, 20)).toBeCloseTo(0.8, 12);
    // 10 mM dNTP to 0.2 mM in 50 µL: 0.02 × 50 = 1 µL.
    expect(stockVolume(10, 0.2, 50)).toBeCloseTo(1, 12);
    // A component at zero final concentration takes no volume.
    expect(stockVolume(10, 0, 50)).toBe(0);
  });
  it("rejects a final concentration above the stock and values that cannot be a concentration or volume", () => {
    expect(() => stockVolume(1, 2, 25)).toThrow(
      "Final concentration exceeds the stock"
    );
    expect(() => stockVolume(0, 1, 25)).toThrow(
      "Invalid concentration or volume"
    );
    expect(() => stockVolume(10, -1, 25)).toThrow(
      "Invalid concentration or volume"
    );
    expect(() => stockVolume(10, 1, 0)).toThrow(
      "Invalid concentration or volume"
    );
  });
  it("fills a 25 µL reaction to volume and leaves out what is added per tube", () => {
    // 5X buffer 5 + dNTP 0.5 + primers 1.25 + 1.25 + polymerase 0.25 = 8.25 µL
    // in the mix; 2 µL template goes into each tube on its own.
    const reaction = reactionVolumes(
      [
        { volume: 5, perTube: false },
        { volume: 0.5, perTube: false },
        { volume: 1.25, perTube: false },
        { volume: 1.25, perTube: false },
        { volume: 0.25, perTube: false },
        { volume: 2, perTube: true },
      ],
      25
    );
    // Water: 25 − 8.25 − 2 = 14.75 µL.
    expect(reaction.fill).toBeCloseTo(14.75, 12);
    expect(reaction.perTube).toBe(2);
    // Dispensed per tube: 25 − 2 = 23 µL (8.25 + 14.75).
    expect(reaction.dispense).toBeCloseTo(23, 12);
    expect(reaction.perReaction).toBeCloseTo(25, 12);
    // For 8 reactions + 10 %: 23 × 8.8 = 202.4 µL of mix, 14.75 × 8.8 = 129.8 µL of water.
    const factor = mixFactor(8, 10);
    expect(reaction.dispense * factor).toBeCloseTo(202.4, 10);
    expect(reaction.fill! * factor).toBeCloseTo(129.8, 10);
  });
  it("adds up the components when no reaction volume is set, and ignores masses", () => {
    const reaction = reactionVolumes(
      [
        { volume: 5, perTube: false },
        { volume: 1.5, perTube: false },
        // 50 mg of a powder is not a volume.
        { volume: null, perTube: false },
        { volume: 2, perTube: true },
      ],
      null
    );
    expect(reaction.fill).toBeNull();
    // 5 + 1.5 = 6.5 µL of mix per tube, 8.5 µL with the 2 µL added per tube.
    expect(reaction.dispense).toBeCloseTo(6.5, 12);
    expect(reaction.perReaction).toBeCloseTo(8.5, 12);
  });
  it("reports components that exceed the reaction volume but not ones that fill it exactly", () => {
    // 12 + 10 = 22 µL does not fit in 20 µL.
    expect(() =>
      reactionVolumes(
        [
          { volume: 12, perTube: false },
          { volume: 10, perTube: true },
        ],
        20
      )
    ).toThrow("Components exceed the reaction volume");
    // 0.1 + 0.2 is 0.30000000000000004 in binary; it still fills 0.3 exactly.
    expect(
      reactionVolumes(
        [
          { volume: 0.1, perTube: false },
          { volume: 0.2, perTube: false },
        ],
        0.3
      ).fill
    ).toBe(0);
    expect(() => reactionVolumes([], 0)).toThrow("Enter positive finite values");
    expect(() =>
      reactionVolumes([{ volume: -1, perTube: false }], null)
    ).toThrow("Invalid amount");
  });
});
describe("volume and mass units", () => {
  it("normalises volumes to µL and leaves masses out", () => {
    expect(microlitres(1.5, "mL")).toBe(1500);
    expect(microlitres(2, "µL")).toBe(2);
    expect(microlitres(0.25, "L")).toBe(250000);
    expect(microlitres(5, "mg")).toBeNull();
    expect(microlitres(5, "g")).toBeNull();
  });
  it("shows a volume in µL below 1 mL, mL below 1 L and L above", () => {
    expect(readableVolume(202.4)).toEqual({ value: 202.4, unit: "µL" });
    expect(readableVolume(1500)).toEqual({ value: 1.5, unit: "mL" });
    expect(readableVolume(2_500_000)).toEqual({ value: 2.5, unit: "L" });
    // 1 mL that arrived as 1000.0000000000001 µL is still 1 mL.
    expect(readableVolume(1000.0000000000001)).toEqual({
      value: 1,
      unit: "mL",
    });
    expect(readableVolume(0)).toEqual({ value: 0, unit: "µL" });
  });
  it("shows a mass in g from 1 g, mg from 1 mg and µg below", () => {
    expect(readableMass(29.22)).toEqual({ value: 29.22, unit: "g" });
    // 0.05844 g = 58.44 mg.
    expect(readableMass(0.05844)).toEqual({ value: 58.44, unit: "mg" });
    // 0.0000005 g = 0.5 µg.
    expect(readableMass(0.0000005)).toEqual({ value: 0.5, unit: "µg" });
    expect(readableMass(0)).toEqual({ value: 0, unit: "g" });
  });
});
describe("medium and buffer recipes", () => {
  it("scales a reference recipe by target ÷ reference", () => {
    // A 100 mL recipe made up to 250 mL: ×2.5, so 8 g becomes 20 g.
    expect(recipeScale(100, 250)).toBe(2.5);
    expect(scaled(8, recipeScale(100, 250))).toBe(20);
    // Scaling down: 1 L recipe to 200 mL is ×0.2.
    expect(recipeScale(1000, 200)).toBeCloseTo(0.2, 12);
    expect(() => recipeScale(0, 250)).toThrow("Enter positive finite values");
    expect(() => recipeScale(-100, -250)).toThrow(
      "Enter positive finite values"
    );
  });
  it("reads the recipe volume in litres", () => {
    expect(recipeLitres(500, "mL")).toBe(0.5);
    expect(recipeLitres(2, "L")).toBe(2);
    expect(() => recipeLitres(0, "mL")).toThrow("Enter positive finite values");
  });
  it("converts mass concentrations to a mass for the volume", () => {
    // 8 g/L NaCl for 500 mL: 8 × 0.5 = 4 g.
    expect(recipeAmount("g/L", 8, 0.5)).toEqual({ kind: "mass", grams: 4 });
    // 0.1 mg/mL (= 0.1 g/L) for 50 mL: 0.1 × 0.05 = 0.005 g.
    const ampicillin = recipeAmount("mg/mL", 0.1, 0.05);
    expect(ampicillin.kind).toBe("mass");
    expect(ampicillin.kind === "mass" && ampicillin.grams).toBeCloseTo(
      0.005,
      12
    );
    // 1 % w/v agarose in 150 mL: 1 g per 100 mL × 150 mL = 1.5 g.
    const agarose = recipeAmount("% w/v", 1, 0.15);
    expect(agarose.kind === "mass" && agarose.grams).toBeCloseTo(1.5, 12);
  });
  it("converts molar concentrations with the molecular weight", () => {
    // 1 M Tris (121.14 g/mol) for 1 L: 121.14 g.
    expect(recipeAmount("M", 1, 1, { mw: 121.14 })).toEqual({
      kind: "mass",
      grams: 121.14,
    });
    // 0.5 M EDTA disodium dihydrate (372.24 g/mol) for 100 mL:
    // 0.5 × 372.24 × 0.1 = 18.612 g.
    const edta = recipeAmount("M", 0.5, 0.1, { mw: 372.24 });
    expect(edta.kind === "mass" && edta.grams).toBeCloseTo(18.612, 10);
    // 150 mM NaCl (58.44 g/mol) for 500 mL: 0.15 × 58.44 × 0.5 = 4.383 g.
    const saline = recipeAmount("mM", 150, 0.5, { mw: 58.44 });
    expect(saline.kind === "mass" && saline.grams).toBeCloseTo(4.383, 10);
    expect(() => recipeAmount("mM", 150, 0.5)).toThrow(
      "Molecular weight required"
    );
    expect(() => recipeAmount("M", 1, 1, { mw: 0 })).toThrow(
      "Molecular weight required"
    );
  });
  it("dilutes an X stock by volume", () => {
    // 1X from 50X TAE for 1 L: 1/50 × 1 L = 20 mL = 20 000 µL.
    const tae = recipeAmount("X", 1, 1, { stock: 50 });
    expect(tae.kind).toBe("volume");
    expect(tae.kind === "volume" && tae.microlitres).toBeCloseTo(20000, 8);
    // 1X from 10X PBS for 500 mL: 50 mL = 50 000 µL.
    const pbs = recipeAmount("X", 1, 0.5, { stock: 10 });
    expect(pbs.kind === "volume" && pbs.microlitres).toBeCloseTo(50000, 8);
    expect(() => recipeAmount("X", 20, 1, { stock: 10 })).toThrow(
      "Final concentration exceeds the stock"
    );
    expect(() => recipeAmount("X", 1, 1)).toThrow(
      "Invalid concentration or volume"
    );
  });
  it("rejects an unknown unit, a negative concentration and a volume that is not positive", () => {
    expect(() => recipeAmount("ppm", 1, 1)).toThrow("Invalid unit or value");
    expect(() => recipeAmount("g/L", -1, 1)).toThrow(
      "Invalid concentration or volume"
    );
    expect(() => recipeAmount("g/L", 1, 0)).toThrow(
      "Invalid concentration or volume"
    );
  });
});
