import { describe, expect, it } from "vitest";
import { cellCount, growthHours, seeding } from "./labMath";
import { IncompleteInput } from "./format";
import {
  CHAMBER_SOURCE,
  DEFAULT_CHAMBER,
  VESSEL_SOURCE,
  cellsPerMlFactor,
  chamberOf,
  chamberPresets,
  countSpread,
  densityPerMl,
  fromLocalInput,
  growthCurve,
  growthPlan,
  growthTable,
  growthValue,
  latestPassage,
  localInput,
  localStamp,
  mediumRange,
  microlitresOf,
  millilitresOf,
  nextPassageNumber,
  oneDecimal,
  passageCsvRows,
  passageNumber,
  presetVolume,
  scientific,
  seedingProfile,
  seedingVessel,
  snapshotSummary,
  sortPassages,
  totalCells,
  vesselPresetOf,
  vesselPresets,
  type Passage,
  type StoredVessel,
} from "./culture";

// The worked count used below. Improved Neubauer, four large squares, sample
// mixed 1 : 1 with trypan blue (dilution factor 2):
//   live 52, 48, 50, 54 → 204      dead 3, 2, 4, 3 → 12      all 216
// One large square is 1 mm × 1 mm × 0.1 mm deep = 0.1 mm³ = 0.1 µL = 10⁻⁴ mL.
//   live per square 204 ÷ 4 = 51 → 51 × 10⁴ × 2 = 1,020,000 viable cells/mL
//   all  per square 216 ÷ 4 = 54 → 54 × 10⁴ × 2 = 1,080,000 cells/mL
//   dead per square  12 ÷ 4 =  3 →  3 × 10⁴ × 2 =    60,000 cells/mL
//   viability 204 ÷ 216 = 0.94444… = 94.44%
const live = [52, 48, 50, 54],
  dead = [3, 2, 4, 3];

describe("cell count", () => {
  it("gives viable, dead and total cells per mL from the mean of the squares", () => {
    const counted = cellCount(live, dead, 2, 0.0001);
    expect(counted.concentration).toBe(1020000);
    expect(counted.totalConcentration).toBe(1080000);
    expect(counted.deadConcentration).toBe(60000);
    expect(counted.live).toBe(204);
    expect(counted.dead).toBe(12);
    expect(counted.total).toBe(216);
    expect(counted.viability).toBeCloseTo(94.4444, 3);
  });
  it("scales with the volume above a square", () => {
    // Fuchs-Rosenthal large square: 1 mm² × 0.2 mm = 0.2 µL = 2 × 10⁻⁴ mL.
    // 51 per square ÷ 2 × 10⁻⁴ mL = 255,000; × 2 = 510,000 cells/mL.
    expect(cellCount(live, dead, 2, 0.0002).concentration).toBeCloseTo(510000, 6);
    // Neubauer group square: 0.2 mm × 0.2 mm × 0.1 mm = 0.004 µL.
    // 12 cells in one group square, undiluted: 12 ÷ 4 × 10⁻⁶ mL = 3,000,000.
    expect(cellCount([12], [0], 1, 0.000004).concentration).toBeCloseTo(3e6, 6);
  });
  it("reports no viability when nothing was counted and rejects impossible counts", () => {
    expect(cellCount([0], [0], 2, 0.0001)).toMatchObject({
      concentration: 0,
      viability: null,
      total: 0,
    });
    expect(() => cellCount([1.5], [0], 2, 0.0001)).toThrow("Invalid counts");
    expect(() => cellCount([-1], [0], 2, 0.0001)).toThrow("Invalid counts");
    expect(() => cellCount([1], [0], 0, 0.0001)).toThrow(
      "Enter positive finite values"
    );
    expect(() => cellCount([1], [0], 2, 0)).toThrow(
      "Enter positive finite values"
    );
  });
  it("turns a density into the cells of a suspension", () => {
    // 1,020,000 cells/mL × 5 mL = 5,100,000 cells.
    expect(totalCells(1020000, 5, "mL")).toBe(5100000);
    // 500 µL = 0.5 mL → 510,000 cells; 0.002 L = 2 mL → 2,040,000 cells.
    expect(totalCells(1020000, 500, "µL")).toBe(510000);
    expect(totalCells(1020000, 0.002, "L")).toBeCloseTo(2040000, 6);
    expect(totalCells(1020000, 0, "mL")).toBe(0);
    expect(() => totalCells(1020000, -1, "mL")).toThrow(
      "Enter non-negative values"
    );
    expect(() => totalCells(1020000, 1, "gal")).toThrow("Invalid unit or value");
  });
  it("measures how evenly the squares were loaded", () => {
    // Cells per square (live + dead): 55, 50, 54, 57. Mean 216 ÷ 4 = 54.
    // Deviations 1, −4, 0, 3 → squares 1 + 16 + 0 + 9 = 26.
    // Sample variance 26 ÷ 3 = 8.6667, SD 2.9439, CV 2.9439 ÷ 54 = 5.4517%.
    const spread = countSpread(live.map((count, i) => count + dead[i]));
    expect(spread.mean).toBe(54);
    expect(spread.cv).toBeCloseTo(5.4517, 3);
    // Identical squares do not vary; one square, or none counted, has no spread.
    expect(countSpread([40, 40, 40]).cv).toBe(0);
    expect(countSpread([40])).toEqual({ mean: 40, cv: null });
    expect(countSpread([0, 0])).toEqual({ mean: 0, cv: null });
    expect(countSpread([])).toEqual({ mean: 0, cv: null });
  });
  it("writes cell numbers the way a notebook does", () => {
    expect(scientific(1020000)).toBe("1.02 × 10⁶");
    expect(scientific(5100000)).toBe("5.10 × 10⁶");
    // Rounding can carry into the next power of ten.
    expect(scientific(999999)).toBe("1.00 × 10⁶");
    expect(scientific(15000000000)).toBe("1.50 × 10¹⁰");
    expect(scientific(10000)).toBe("1.00 × 10⁴");
    // Below 10,000 the number itself is easier to read.
    expect(scientific(9500)).toBe("9500");
    expect(scientific(0)).toBe("0");
    expect(scientific(NaN)).toBe("—");
    expect(oneDecimal(94.4444)).toBe(94.4);
    expect(oneDecimal(100)).toBe(100);
  });
  it("reads a density sent by another tool only in a unit it knows", () => {
    expect(densityPerMl(1020000, "cells/mL")).toBe(1020000);
    // 1,500 cells/µL × 1,000 µL/mL = 1,500,000 cells/mL.
    expect(densityPerMl(1500, "cells/µL")).toBe(1500000);
    expect(densityPerMl(2e9, "cells / L")).toBe(2000000);
    expect(densityPerMl(5, "g/L")).toBeNull();
    expect(densityPerMl(0, "cells/mL")).toBeNull();
    expect(densityPerMl(NaN, "cells/mL")).toBeNull();
  });
});

describe("counting chamber presets", () => {
  // Transcribed a second time from the maker's table (ruling: side of the
  // counted square in mm, chamber depth in mm, volume in µL).
  const table: Record<string, [side: number, depth: number, volume: number]> = {
    "neubauer-improved": [1, 0.1, 0.1],
    "neubauer-improved-group": [0.2, 0.1, 0.004],
    neubauer: [1, 0.1, 0.1],
    burker: [1, 0.1, 0.1],
    "burker-turk": [1, 0.1, 0.1],
    "fuchs-rosenthal": [1, 0.2, 0.2],
  };
  it("lists exactly the rulings whose volume the source prints", () => {
    expect(chamberPresets.map((row) => row.id).sort()).toEqual(
      Object.keys(table).sort()
    );
    for (const row of chamberPresets)
      expect([row.sideMm, row.depthMm, row.volumeUl]).toEqual(table[row.id]);
    expect(CHAMBER_SOURCE.url).toMatch(/^https:\/\/www\.marienfeld-superior\.com\//);
    expect(chamberPresets.some((row) => row.id === DEFAULT_CHAMBER)).toBe(true);
  });
  it("has volumes that are the square's area times the depth", () => {
    // mm² × mm = mm³ = µL: 1 × 1 × 0.1 = 0.1; 0.2 × 0.2 × 0.1 = 0.004;
    // 1 × 1 × 0.2 = 0.2.
    for (const row of chamberPresets)
      expect(row.sideMm * row.sideMm * row.depthMm).toBeCloseTo(
        row.volumeUl,
        12
      );
  });
  it("converts a square's volume to the multiplier used at the bench", () => {
    // 0.1 µL = 10⁻⁴ mL, so one cell is 1 ÷ 10⁻⁴ = 10⁴ cells/mL.
    expect(millilitresOf(0.1)).toBe(0.0001);
    expect(cellsPerMlFactor(millilitresOf(0.1))).toBe(10000);
    // 0.2 µL → 5,000; 0.004 µL → 250,000.
    expect(cellsPerMlFactor(millilitresOf(0.2))).toBe(5000);
    expect(cellsPerMlFactor(millilitresOf(0.004))).toBe(250000);
    expect(microlitresOf(0.0001)).toBe(0.1);
    expect(microlitresOf(millilitresOf(0.25))).toBe(0.25);
  });
  it("keeps a preset only while the stored volume is still that preset's", () => {
    expect(chamberOf("neubauer-improved", 0.0001)?.ruling).toBe(
      "Neubauer improved"
    );
    expect(chamberOf("fuchs-rosenthal", 0.0002)?.depthMm).toBe(0.2);
    // A volume typed over the preset, in this build or an older one.
    expect(chamberOf("neubauer-improved", 0.0002)).toBeUndefined();
    expect(chamberOf("custom", 0.0001)).toBeUndefined();
    expect(chamberOf(undefined, 0.0001)).toBeUndefined();
    expect(chamberOf("neubauer-improved", null)).toBeUndefined();
  });
});

describe("culture vessel presets", () => {
  // Transcribed a second time from the supplier's table: growth area in cm²
  // and growth medium in mL (lowest, highest), per well for the plates.
  const table: Record<string, [area: number, min: number, max: number]> = {
    "dish-35": [8.8, 2, 2],
    "dish-60": [21.5, 5, 5],
    "dish-100": [56.7, 12, 12],
    "dish-150": [145, 30, 30],
    "plate-6": [9.6, 1, 3],
    "plate-12": [3.5, 1, 2],
    "plate-24": [1.9, 0.5, 1],
    "plate-48": [1.1, 0.2, 0.4],
    "plate-96": [0.32, 0.1, 0.2],
    t25: [25, 3, 5],
    t75: [75, 8, 15],
    t175: [175, 35, 53],
    t225: [225, 45, 68],
  };
  it("holds the table's figures and nothing else", () => {
    expect(vesselPresets.map((row) => row.id).sort()).toEqual(
      Object.keys(table).sort()
    );
    for (const row of vesselPresets)
      expect([row.area, ...row.medium]).toEqual(table[row.id]);
    expect(VESSEL_SOURCE.url).toMatch(/^https:\/\/www\.thermofisher\.com\//);
  });
  it("is physically plausible", () => {
    for (const row of vesselPresets) {
      expect(row.medium[0]).toBeLessThanOrEqual(row.medium[1]);
      // Medium depth stays within 1 to 7 mm: 0.1 to 0.7 mL per cm².
      expect(row.medium[0] / row.area).toBeGreaterThanOrEqual(0.1);
      expect(row.medium[1] / row.area).toBeLessThanOrEqual(0.7);
      // A T-flask is named after its growth area.
      if (row.kind === "flask")
        expect(row.area).toBe(Number(row.name.replace("T-", "")));
      // A dish grows cells on less than the circle of its nominal diameter
      // (35 mm → π × 1.75² = 9.62 cm²), but on most of it.
      if (row.kind === "dish") {
        const circle = Math.PI * (parseFloat(row.name) / 20) ** 2;
        expect(row.area).toBeLessThan(circle);
        expect(row.area).toBeGreaterThan(0.7 * circle);
      }
    }
    // Wells shrink as their number grows.
    const wells = vesselPresets
      .filter((row) => row.kind === "plate")
      .map((row) => row.area);
    expect(wells).toEqual([...wells].sort((a, b) => b - a));
  });
  it("fills in the top of the medium range and shows the range", () => {
    const preset = (id: string) => vesselPresets.find((row) => row.id === id)!;
    expect(presetVolume(preset("t25"))).toBe(5);
    expect(presetVolume(preset("plate-6"))).toBe(3);
    expect(presetVolume(preset("dish-100"))).toBe(12);
    expect(mediumRange(preset("t75"))).toBe("8–15");
    expect(mediumRange(preset("plate-24"))).toBe("0.5–1");
    expect(mediumRange(preset("dish-60"))).toBe("5");
  });
  it("keeps a preset only while the area is still the preset's", () => {
    expect(vesselPresetOf("t75", 75)?.name).toBe("T-75");
    expect(vesselPresetOf("t75", 80)).toBeUndefined();
    expect(vesselPresetOf("custom", 75)).toBeUndefined();
    expect(vesselPresetOf(undefined, 25)).toBeUndefined();
    expect(vesselPresetOf("t75", null)).toBeUndefined();
  });
});

describe("seeding from stored inputs", () => {
  const well: StoredVessel = {
    id: "w",
    name: "6-well",
    area: 9.6,
    volume: 3,
    count: 6,
    mode: "confluence",
    target: 30,
    preset: "plate-6",
  };
  it("seeds six wells of a 6-well plate to 30% confluence", () => {
    // Per well: 30% × 9.6 cm² × 100,000 cells/cm² = 288,000 cells.
    // From 1,000,000 cells/mL that is 0.288 mL, topped up with 3 − 0.288 =
    // 2.712 mL of medium. Six wells: 1.728 mL of stock, 16.272 mL of medium.
    const result = seeding(
      seedingProfile({
        kind: "adherent",
        doublingHours: null,
        density: 100000,
        maxDensity: null,
      }),
      1000000,
      10,
      [seedingVessel(well)]
    );
    expect(result.rows[0].cells).toBeCloseTo(288000, 6);
    expect(result.rows[0].stock).toBeCloseTo(0.288, 9);
    expect(result.rows[0].medium).toBeCloseTo(2.712, 9);
    expect(result.rows[0].confluence).toBeCloseTo(30, 9);
    expect(result.stockTotal).toBeCloseTo(1.728, 9);
    expect(result.mediumTotal).toBeCloseTo(16.272, 9);
    expect(result.valid).toBe(true);
    // The preset the figures came from is not part of the calculation.
    expect(result.rows[0]).not.toHaveProperty("preset");
  });
  it("asks only for the fields the calculation uses", () => {
    // An adherent culture needs its density at confluence, not a maximum
    // suspension density; a suspension culture the other way round.
    expect(() =>
      seedingProfile({
        kind: "adherent",
        doublingHours: 24,
        density: null,
        maxDensity: 1e6,
      })
    ).toThrow(IncompleteInput);
    expect(
      seedingProfile({
        kind: "suspension",
        doublingHours: null,
        density: null,
        maxDensity: 2e6,
      })
    ).toEqual({
      kind: "suspension",
      doublingHours: 0,
      density: 0,
      maxDensity: 2e6,
    });
    // The area matters only to an area-based target.
    expect(() => seedingVessel({ ...well, area: null })).toThrow(
      IncompleteInput
    );
    expect(
      seedingVessel({ ...well, area: null, mode: "split", target: 5 }).area
    ).toBe(0);
    expect(() => seedingVessel({ ...well, volume: null })).toThrow(
      IncompleteInput
    );
    expect(() => seedingVessel({ ...well, count: null })).toThrow(
      IncompleteInput
    );
    expect(() => seedingVessel({ ...well, target: null })).toThrow(
      IncompleteInput
    );
  });
});

describe("growth estimate", () => {
  const adherent = { kind: "adherent" as const, doublingHours: 24, maxDensity: 0 };
  it("counts doublings to the target", () => {
    // 25% → 100% is two doublings: 2 × 24 h = 48 h.
    expect(growthPlan(adherent, 25, 100)).toEqual({ hours: 48, cap: 100 });
    // 30% → 80%: log2(80 ÷ 30) = 3 − log2(3) = 3 − 1.5849625 = 1.4150375
    // doublings × 24 h = 33.9609 h.
    expect(growthPlan(adherent, 30, 80).hours).toBeCloseTo(33.9609, 4);
    expect(growthHours(30, 80, 24)).toBeCloseTo(33.9609, 4);
    // Suspension: 200,000 → 800,000 cells/mL is two doublings of 20 h = 40 h.
    expect(
      growthPlan(
        { kind: "suspension", doublingHours: 20, maxDensity: 1e6 },
        2e5,
        8e5
      )
    ).toEqual({ hours: 40, cap: 1e6 });
  });
  it("refuses a target the culture cannot reach", () => {
    expect(() => growthPlan(adherent, 30, 120)).toThrow(
      "Confluence cannot exceed 100%"
    );
    expect(() =>
      growthPlan(
        { kind: "suspension", doublingHours: 20, maxDensity: 1e6 },
        2e5,
        2e6
      )
    ).toThrow("Density cannot exceed the maximum density");
    expect(() => growthPlan(adherent, 80, 30)).toThrow(
      "Target must exceed starting density"
    );
    expect(() => growthPlan(adherent, 0, 30)).toThrow(
      "Enter positive finite values"
    );
    expect(() =>
      growthPlan({ kind: "suspension", doublingHours: 20, maxDensity: 0 }, 1, 2)
    ).toThrow("Enter positive finite values");
  });
  it("follows the doubling model up to the ceiling", () => {
    // From 25%: 50% after one doubling time, 100% after two, and no higher.
    expect(growthValue(25, 24, 0, 100)).toBe(25);
    expect(growthValue(25, 24, 24, 100)).toBe(50);
    expect(growthValue(25, 24, 48, 100)).toBe(100);
    expect(growthValue(25, 24, 72, 100)).toBe(100);
    // Half a doubling time multiplies by √2: 25 × 1.41421 = 35.355.
    expect(growthValue(25, 24, 12, 100)).toBeCloseTo(35.3553, 4);
  });
  it("draws the curve from now until a quarter past the target time", () => {
    // 25% → 50% takes 24 h; the curve runs to 24 × 1.25 = 30 h, where the
    // model gives 25 × 2^(30 ÷ 24) = 25 × 2.378414 = 59.460%.
    const curve = growthCurve(25, 50, 24, 100);
    expect(curve.hours).toBe(24);
    expect(curve.end).toBe(30);
    expect(curve.points[0]).toEqual({ hours: 0, value: 25 });
    expect(curve.points.at(-1)!.hours).toBe(30);
    expect(curve.points.at(-1)!.value).toBeCloseTo(59.4604, 4);
    // The target time is a point of its own, at exactly the target.
    expect(curve.points.find((point) => point.hours === 24)?.value).toBe(50);
    // Time and value only ever go up.
    for (let i = 1; i < curve.points.length; i++) {
      expect(curve.points[i].hours).toBeGreaterThan(curve.points[i - 1].hours);
      expect(curve.points[i].value).toBeGreaterThanOrEqual(
        curve.points[i - 1].value
      );
    }
  });
  it("stops the curve at the ceiling when the target is the ceiling", () => {
    // 50% → 100% takes 24 h and there is nothing above 100% to show.
    const curve = growthCurve(50, 100, 24, 100);
    expect(curve.end).toBe(24);
    expect(curve.points.at(-1)).toEqual({ hours: 24, value: 100 });
    // 60% → 90% takes 24 × log2(1.5) = 14.04 h; a quarter more would be
    // 17.55 h, but 100% comes at 24 × log2(100 ÷ 60) = 17.69 h, later.
    const near = growthCurve(60, 90, 24, 100);
    expect(near.end).toBeCloseTo(17.5489, 3);
    expect(Math.max(...near.points.map((point) => point.value))).toBeLessThan(
      100
    );
  });
  it("tabulates the estimate at round times and at the target", () => {
    const curve = growthCurve(25, 50, 24, 100),
      table = growthTable(curve, 25, 50, 24, 100);
    expect(table.map((row) => row.hours)).toEqual([0, 5, 10, 15, 20, 24, 25, 30]);
    expect(table[0]).toEqual({ hours: 0, value: 25, reached: false });
    expect(table[5]).toEqual({ hours: 24, value: 50, reached: true });
    expect(table.filter((row) => row.reached)).toHaveLength(1);
    // 12 h would be 35.36%; at 10 h it is 25 × 2^(10 ÷ 24) = 33.371%.
    expect(table[2].value).toBeCloseTo(33.3710, 3);
  });
});

describe("passage log", () => {
  const record = (number: number, at: string, more: Partial<Passage> = {}) =>
    ({
      id: `p${number}`,
      number,
      at,
      medium: "",
      antibiotics: "",
      conditions: "",
      notes: "",
      snapshot: null,
      ...more,
    }) satisfies Passage;
  it("numbers the first record from the starting passage and the rest in sequence", () => {
    expect(nextPassageNumber([], 12)).toBe(12);
    expect(nextPassageNumber([], null)).toBe(0);
    expect(nextPassageNumber([], undefined)).toBe(0);
    // A starting number that is not a passage number counts from 0.
    expect(nextPassageNumber([], 2.5)).toBe(0);
    expect(nextPassageNumber([], -3)).toBe(0);
    // Once there are records the highest one decides, whatever the start.
    expect(nextPassageNumber([{ number: 12 }, { number: 14 }], 3)).toBe(15);
    expect(latestPassage([{ number: 12 }, { number: 14 }])).toBe(14);
    expect(latestPassage([])).toBeNull();
  });
  it("accepts only whole passage numbers from 0", () => {
    expect(passageNumber(0)).toBe(0);
    expect(passageNumber(37)).toBe(37);
    for (const bad of [-1, 1.5, 10000, NaN])
      expect(() => passageNumber(bad)).toThrow(
        "Passage number must be a whole number from 0 to 9999"
      );
  });
  it("lists the newest passage first, by date and then by number", () => {
    const list = [
      record(5, "2026-11-20T09:00:00.000Z"),
      record(7, "2026-11-27T09:00:00.000Z"),
      // Entered late with an earlier date.
      record(6, "2026-11-23T09:00:00.000Z"),
      record(8, "2026-11-27T09:00:00.000Z"),
      record(1, "not a date"),
    ];
    expect(sortPassages(list).map((row) => row.number)).toEqual([8, 7, 6, 5, 1]);
    // The stored order is left alone.
    expect(list.map((row) => row.number)).toEqual([5, 7, 6, 8, 1]);
  });
  it("converts between a date-time field and a stored moment in local time", () => {
    const morning = new Date(2026, 10, 27, 9, 5);
    expect(localInput(morning)).toBe("2026-11-27T09:05");
    expect(fromLocalInput("2026-11-27T09:05")).toBe(morning.toISOString());
    expect(localStamp(morning.toISOString())).toBe("2026-11-27 09:05");
    expect(localStamp("nonsense")).toBe("");
    expect(() => fromLocalInput("")).toThrow("Enter a valid date and time");
    expect(() => fromLocalInput("2026-13-45T99:99")).toThrow(
      "Enter a valid date and time"
    );
  });
  it("exports the log oldest first with the seeding done at each passage", () => {
    const snapshot = {
      concentration: 1000000,
      available: 10,
      result: {
        rows: [
          { name: "T-25", count: 2, stock: 2, medium: 3 },
          { name: "6-well", count: 6, stock: 0.288, medium: 2.712 },
        ],
      },
    };
    expect(snapshotSummary(snapshot)).toEqual({
      concentration: 1000000,
      vessels: "T-25 ×2: 2 + 3 mL; 6-well ×6: 0.288 + 2.712 mL",
    });
    expect(snapshotSummary(null)).toEqual({ concentration: "", vessels: "" });
    expect(snapshotSummary({ unexpected: true })).toEqual({
      concentration: "",
      vessels: "",
    });
    const first = new Date(2026, 10, 20, 14, 30),
      second = new Date(2026, 10, 24, 10, 0);
    const rows = passageCsvRows(
      [
        record(13, second.toISOString(), { snapshot, notes: "1:5" }),
        record(12, first.toISOString(), {
          medium: "DMEM + 10% FBS",
          antibiotics: "P/S",
          conditions: "37 °C, 5% CO2",
        }),
      ],
      ["Passage", "When", "Medium", "Antibiotics", "Conditions", "Notes", "Density", "Seeding"]
    );
    expect(rows).toEqual([
      ["Passage", "When", "Medium", "Antibiotics", "Conditions", "Notes", "Density", "Seeding"],
      [12, "2026-11-20 14:30", "DMEM + 10% FBS", "P/S", "37 °C, 5% CO2", "", "", ""],
      [
        13,
        "2026-11-24 10:00",
        "",
        "",
        "",
        "1:5",
        1000000,
        "T-25 ×2: 2 + 3 mL; 6-well ×6: 0.288 + 2.712 mL",
      ],
    ]);
  });
});
