import { describe, it, expect } from "vitest";
import {
  units,
  unitCategories,
  conversionNeeds,
  convertAll,
  convertCentrifuge,
  convertUnit,
} from "./units";

// Reference values are written out by hand from the SI definitions (BIPM, The
// International System of Units, 9th edition: prefixes k = 10³, c = 10⁻²,
// m = 10⁻³, µ = 10⁻⁶, n = 10⁻⁹, p = 10⁻¹²), never read back from the module.
describe("unit factors against their SI definitions", () => {
  // Each unit expressed in the base unit of its dimension.
  const reference: Record<string, number> = {
    // Mass, in g.
    kg: 1e3,
    g: 1,
    mg: 1e-3,
    µg: 1e-6,
    ng: 1e-9,
    pg: 1e-12,
    // Volume, in L.
    L: 1,
    mL: 1e-3,
    µL: 1e-6,
    nL: 1e-9,
    // Length, in m.
    m: 1,
    cm: 1e-2,
    mm: 1e-3,
    µm: 1e-6,
    nm: 1e-9,
    // Area, in m²: the prefix is squared. 1 cm² = (10⁻² m)² = 10⁻⁴ m².
    "m²": 1,
    "cm²": 1e-4,
    "mm²": 1e-6,
    "µm²": 1e-12,
    // Time, in s: 1 min = 60 s, 1 h = 60 min = 3600 s, 1 d = 24 h = 86 400 s.
    ms: 1e-3,
    s: 1,
    min: 60,
    h: 3600,
    day: 86400,
    // Amount of substance, in mol.
    mol: 1,
    mmol: 1e-3,
    µmol: 1e-6,
    nmol: 1e-9,
    pmol: 1e-12,
    // Temperature, size of one degree in K: 1 °C = 1 K, 1 °F = 5/9 K.
    K: 1,
    "°C": 1,
    "°F": 5 / 9,
    // Molar concentration, in mol/L.
    M: 1,
    mM: 1e-3,
    µM: 1e-6,
    nM: 1e-9,
    pM: 1e-12,
    // Mass concentration, in g/L: mass prefix over volume prefix.
    // mg/mL = 10⁻³ g / 10⁻³ L = 1; µg/mL = 10⁻⁶ / 10⁻³ = 10⁻³;
    // µg/µL = 10⁻⁶ / 10⁻⁶ = 1; ng/µL = 10⁻⁹ / 10⁻⁶ = 10⁻³;
    // % w/v = 1 g per 100 mL = 10 g/L.
    "g/L": 1,
    "mg/mL": 1,
    "µg/mL": 1e-3,
    "µg/µL": 1,
    "ng/µL": 1e-3,
    "% w/v": 10,
    // Fractions, in %: ppm = 10⁻⁶ = 10⁻⁴ %, ppb = 10⁻⁹ = 10⁻⁷ %.
    "% w/w": 1,
    "ppm w/w": 1e-4,
    "ppb w/w": 1e-7,
    "% v/v": 1,
    "ppm v/v": 1e-4,
  };
  it("has a reference for every unit, and every factor matches it", () => {
    expect(Object.keys(units).sort()).toEqual(Object.keys(reference).sort());
    for (const [unit, expected] of Object.entries(reference))
      expect(units[unit].factor / expected, unit).toBeCloseTo(1, 12);
  });
  it("offers every unit in exactly one conversion type", () => {
    const offered = unitCategories.flatMap((category) => category.units);
    expect(new Set(offered).size).toBe(offered.length);
    // RPM and RCF convert through the rotor radius, not a factor.
    expect(offered.filter((unit) => !units[unit]).sort()).toEqual([
      "RCF",
      "RPM",
    ]);
    expect(Object.keys(units).filter((unit) => !offered.includes(unit))).toEqual(
      []
    );
  });
  it("can convert between any two units of one type", () => {
    for (const category of unitCategories) {
      if (category.id === "centrifuge") continue;
      for (const from of category.units)
        for (const to of category.units)
          // 300 is a valid value in every unit here, including K, °C and °F.
          expect(
            Number.isFinite(convertUnit(300, from, to, 100, 1)),
            `${from} → ${to}`
          ).toBe(true);
    }
  });
});
describe("unit conversions", () => {
  it("converts the small units of the bench", () => {
    // 1 g = 10¹² pg; 250 pg = 0.25 ng.
    expect(convertUnit(1, "g", "pg")).toBeCloseTo(1e12, 0);
    expect(convertUnit(250, "pg", "ng")).toBeCloseTo(0.25, 12);
    // 500 nm = 0.5 µm; 1 mm = 10⁶ nm.
    expect(convertUnit(500, "nm", "µm")).toBeCloseTo(0.5, 12);
    expect(convertUnit(1, "mm", "nm")).toBeCloseTo(1e6, 6);
    // 1 nM = 1000 pM; 50 pM = 0.05 nM.
    expect(convertUnit(1, "nM", "pM")).toBeCloseTo(1000, 9);
    expect(convertUnit(50, "pM", "nM")).toBeCloseTo(0.05, 12);
    // 1 µmol = 1000 nmol; 250 pmol = 0.25 nmol.
    expect(convertUnit(1, "µmol", "nmol")).toBeCloseTo(1000, 9);
    expect(convertUnit(250, "pmol", "nmol")).toBeCloseTo(0.25, 12);
    // 1500 ms = 1.5 s; 1 min = 60 000 ms.
    expect(convertUnit(1500, "ms", "s")).toBeCloseTo(1.5, 12);
    expect(convertUnit(1, "min", "ms")).toBeCloseTo(60000, 6);
  });
  it("treats ng/µL as µg/mL and µg/µL as mg/mL", () => {
    // 50 ng/µL = 50 × 10⁻⁹ g / 10⁻⁶ L = 0.05 g/L = 50 µg/mL = 0.05 mg/mL.
    expect(convertUnit(50, "ng/µL", "µg/mL")).toBeCloseTo(50, 10);
    expect(convertUnit(50, "ng/µL", "mg/mL")).toBeCloseTo(0.05, 12);
    // 1 µg/µL = 1 g/L = 1 mg/mL = 1000 ng/µL.
    expect(convertUnit(1, "µg/µL", "mg/mL")).toBeCloseTo(1, 12);
    expect(convertUnit(1, "µg/µL", "ng/µL")).toBeCloseTo(1000, 9);
  });
  it("goes between molar and mass concentration through the molecular weight", () => {
    // A 10 µM oligo of 6000 g/mol: 10⁻⁵ mol/L × 6000 g/mol = 0.06 g/L = 60 ng/µL.
    expect(convertUnit(10, "µM", "ng/µL", 6000)).toBeCloseTo(60, 10);
    // 66 ng/µL of a 3.3 × 10⁶ g/mol plasmid: 0.066 g/L ÷ 3.3 × 10⁶ = 2 × 10⁻⁸ M = 20 nM.
    expect(convertUnit(66, "ng/µL", "nM", 3.3e6)).toBeCloseTo(20, 10);
    // 1 M NaCl (58.44 g/mol) = 58.44 g/L; at 1.0 g/mL that is 5.844 % w/w.
    expect(convertUnit(1, "M", "% w/w", 58.44, 1)).toBeCloseTo(5.844, 10);
  });
  it("converts temperatures, including negative ones", () => {
    // 37 °C = 310.15 K = 37 × 9/5 + 32 = 98.6 °F.
    expect(convertUnit(37, "°C", "K")).toBeCloseTo(310.15, 10);
    expect(convertUnit(37, "°C", "°F")).toBeCloseTo(98.6, 10);
    // The scales cross at −40; −80 °C = −112 °F.
    expect(convertUnit(-40, "°C", "°F")).toBeCloseTo(-40, 10);
    expect(convertUnit(-80, "°C", "°F")).toBeCloseTo(-112, 10);
    // 0 K = −273.15 °C = −459.67 °F, and nothing is colder.
    expect(convertUnit(0, "K", "°C")).toBeCloseTo(-273.15, 10);
    expect(convertUnit(0, "K", "°F")).toBeCloseTo(-459.67, 10);
    expect(() => convertUnit(-273.16, "°C", "K")).toThrow("Below absolute zero");
    expect(() => convertUnit(-1, "K", "°C")).toThrow("Below absolute zero");
  });
  it("rejects a negative amount of anything but temperature", () => {
    for (const [from, to] of [
      ["g", "mg"],
      ["mL", "µL"],
      ["mol", "mmol"],
      ["m", "cm"],
      ["m²", "cm²"],
      ["s", "min"],
      ["M", "mM"],
      ["g/L", "mg/mL"],
      ["% w/w", "ppm w/w"],
      ["% v/v", "ppm v/v"],
    ])
      expect(() => convertUnit(-1, from, to), from).toThrow(
        "Enter non-negative values"
      );
    expect(() => convertUnit(-1, "M", "g/L", 58.44)).toThrow(
      "Enter non-negative values"
    );
    // Zero is a value, not a missing one.
    expect(convertUnit(0, "g", "mg")).toBe(0);
  });
  it("says what a conversion needs besides the value", () => {
    expect(conversionNeeds("M", "mM")).toEqual({ mw: false, density: false });
    expect(conversionNeeds("M", "g/L")).toEqual({ mw: true, density: false });
    expect(conversionNeeds("ng/µL", "nM")).toEqual({ mw: true, density: false });
    expect(conversionNeeds("g/L", "% w/w")).toEqual({
      mw: false,
      density: true,
    });
    expect(conversionNeeds("M", "ppm w/w")).toEqual({ mw: true, density: true });
    expect(conversionNeeds("mL", "µL")).toEqual({ mw: false, density: false });
  });
  it("lists a value in every other unit it can reach", () => {
    // 1 mL = 1000 µL = 0.001 L = 10⁶ nL.
    const volume = convertAll(1, "mL", ["mL", "µL", "L", "nL"]);
    expect(volume.map((row) => row.unit)).toEqual(["µL", "L", "nL"]);
    expect(volume[0].value).toBeCloseTo(1000, 9);
    expect(volume[1].value).toBeCloseTo(0.001, 12);
    expect(volume[2].value).toBeCloseTo(1e6, 6);
    const concentration = unitCategories.find(
      (category) => category.id === "concentration"
    )!.units;
    // Without a molecular weight only the molar units can be reached.
    expect(convertAll(1, "M", concentration).map((row) => row.unit)).toEqual([
      "mM",
      "µM",
      "nM",
      "pM",
    ]);
    // With one, the mass concentrations follow; mass fractions need a density.
    const withWeight = convertAll(1, "M", concentration, 58.44);
    expect(withWeight.map((row) => row.unit)).toEqual([
      "mM",
      "µM",
      "nM",
      "pM",
      "g/L",
      "mg/mL",
      "µg/mL",
      "µg/µL",
      "ng/µL",
      "% w/v",
    ]);
    // 1 M NaCl = 58.44 g/L = 58 440 µg/mL = 5.844 % w/v.
    const value = (unit: string) =>
      withWeight.find((row) => row.unit === unit)!.value;
    expect(value("g/L")).toBeCloseTo(58.44, 10);
    expect(value("µg/mL")).toBeCloseTo(58440, 6);
    expect(value("% w/v")).toBeCloseTo(5.844, 10);
    expect(
      convertAll(1, "M", concentration, 58.44, 1).map((row) => row.unit)
    ).toContain("ppm w/w");
    expect(() => convertAll(-1, "mL", ["µL"])).toThrow(
      "Enter non-negative values"
    );
  });
  it("matches the centrifugal force derived from the rotor's motion", () => {
    // RCF = ω²r / g₀, with ω = 2π × RPM / 60, r in metres and standard
    // gravity g₀ = 9.80665 m/s². At 13 000 RPM and r = 8 cm:
    // ω = 1361.357 rad/s, ω²r = 148 263.4 m/s², RCF = 15 118.7.
    // The rounded textbook constant 1.118 × 10⁻⁵ gives 15 115.36.
    const omega = (2 * Math.PI * 13000) / 60;
    const physical = (omega ** 2 * 0.08) / 9.80665;
    const converted = convertCentrifuge(13000, "RPM", 8);
    expect(converted).toBeCloseTo(15115.36, 6);
    expect(Math.abs(converted / physical - 1)).toBeLessThan(5e-4);
    expect(convertCentrifuge(15115.36, "RCF", 8)).toBeCloseTo(13000, 6);
  });
});
