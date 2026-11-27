import { describe, expect, it } from "vitest";
import {
  applyChange,
  applyToWells,
  calibrationRows,
  clearWells,
  commonFields,
  compactNumber,
  concentrationScale,
  diffWells,
  dilutionSeries,
  invertChange,
  lineWells,
  moveCell,
  numberedSamples,
  patchWell,
  patchWells,
  plateShape,
  rangeWells,
  readFields,
  sortWells,
  toggleWells,
  wellNames,
  wellPosition,
  type Well,
  type Wells,
} from "./plate";

const well = (fields: Partial<Well> = {}): Well => ({
  sample: "",
  condition: "",
  replicate: "",
  color: "#bfdbfe",
  ...fields,
});

describe("plate coordinates and ranges", () => {
  it("names wells row by row and reads a name back", () => {
    expect(wellNames(2, 3)).toEqual(["A1", "A2", "A3", "B1", "B2", "B3"]);
    expect(wellNames(16, 24)).toHaveLength(384);
    expect(wellNames(16, 24).at(-1)).toBe("P24");
    expect(wellPosition("H12")).toEqual({ row: 7, col: 11 });
    expect(wellPosition("P24")).toEqual({ row: 15, col: 23 });
    for (const name of ["A0", "a1", "AA1", "A", "12", "A1 "])
      expect(wellPosition(name)).toBeNull();
    expect(plateShape("384")).toEqual({ rows: 16, cols: 24 });
    expect(plateShape("24")).toEqual({ rows: 4, cols: 6 });
    // An unknown size falls back to a 96-well plate.
    expect(plateShape("1536")).toEqual({ rows: 8, cols: 12 });
  });
  it("selects the rectangle between two corners whichever was picked first", () => {
    const block = ["A1", "A2", "A3", "B1", "B2", "B3"];
    expect(rangeWells("A1", "B3")).toEqual(block);
    expect(rangeWells("B3", "A1")).toEqual(block);
    expect(rangeWells("B1", "A3")).toEqual(block);
    expect(rangeWells("C5", "C5")).toEqual(["C5"]);
    expect(rangeWells("A1", "nowhere")).toEqual([]);
  });
  it("selects whole rows and columns", () => {
    expect(lineWells("row", 1, 4, 6)).toEqual([
      "B1",
      "B2",
      "B3",
      "B4",
      "B5",
      "B6",
    ]);
    expect(lineWells("column", 5, 4, 6)).toEqual(["A6", "B6", "C6", "D6"]);
  });
  it("keeps a selection distinct and in row order (B2 before B10)", () => {
    expect(sortWells(["B10", "A2", "B2", "A2", "A1"])).toEqual([
      "A1",
      "A2",
      "B2",
      "B10",
    ]);
  });
  it("adds wells to a selection, or removes them when all are already in it", () => {
    expect(toggleWells(["A1"], ["B1"])).toEqual(["A1", "B1"]);
    expect(toggleWells(["A1", "B1"], ["B1"])).toEqual(["A1"]);
    // A partly selected line is completed, not removed.
    expect(toggleWells(["A2"], ["A1", "A2", "A3"])).toEqual(["A1", "A2", "A3"]);
    expect(toggleWells(["A1", "A2", "A3", "B1"], ["A1", "A2", "A3"])).toEqual([
      "B1",
    ]);
  });
  it("moves through wells and headers and stops at the edges", () => {
    const move = (row: number, col: number, key: string, ctrl = false) =>
      moveCell({ row, col }, key, 8, 12, ctrl);
    expect(move(0, 0, "ArrowRight")).toEqual({ row: 0, col: 1 });
    expect(move(0, 11, "ArrowRight")).toEqual({ row: 0, col: 11 });
    expect(move(7, 3, "ArrowDown")).toEqual({ row: 7, col: 3 });
    // Up from the first row is the column header; left from the first column the row header.
    expect(move(0, 4, "ArrowUp")).toEqual({ row: -1, col: 4 });
    expect(move(2, 0, "ArrowLeft")).toEqual({ row: 2, col: -1 });
    // There is no cell in the corner between the headers.
    expect(move(-1, 0, "ArrowLeft")).toEqual({ row: -1, col: 0 });
    expect(move(0, -1, "ArrowUp")).toEqual({ row: 0, col: -1 });
    expect(move(3, 5, "Home")).toEqual({ row: 3, col: 0 });
    expect(move(3, 5, "End")).toEqual({ row: 3, col: 11 });
    expect(move(3, 5, "Home", true)).toEqual({ row: 0, col: 0 });
    expect(move(3, 5, "End", true)).toEqual({ row: 7, col: 11 });
    expect(move(3, 5, "a")).toBeNull();
    expect(move(3, 5, "Enter")).toBeNull();
  });
});

describe("well fields", () => {
  it("reads a well saved before roles and concentrations existed", () => {
    expect(
      readFields({
        sample: "Drug X",
        condition: "1 μM",
        replicate: "1",
        color: "#fecaca",
      })
    ).toEqual({
      sample: "Drug X",
      condition: "1 μM",
      replicate: "1",
      role: "",
      concentration: null,
      color: "#fecaca",
    });
    expect(readFields(undefined).color).toBe("#bfdbfe");
  });
  it("ignores a role or concentration it does not understand", () => {
    const odd = {
      ...well(),
      role: "control",
      concentration: "5",
    } as unknown as Well;
    expect(readFields(odd).role).toBe("");
    expect(readFields(odd).concentration).toBeNull();
    expect(readFields(well({ concentration: NaN })).concentration).toBeNull();
    expect(readFields(well({ concentration: 0 })).concentration).toBe(0);
  });
  it("writes a well without the optional keys when they are empty", () => {
    const saved = well({ sample: "Drug X", condition: "1 μM", replicate: "1" });
    // Copying every field of an old well onto a new one gives the same object.
    expect(patchWell(undefined, readFields(saved))).toEqual(saved);
    expect(Object.keys(patchWell(undefined, readFields(saved)))).toEqual([
      "sample",
      "condition",
      "replicate",
      "color",
    ]);
    const labelled = patchWell(saved, { role: "standard", concentration: 2.5 });
    expect(labelled).toEqual({ ...saved, role: "standard", concentration: 2.5 });
    // Clearing them removes the keys again.
    expect(patchWell(labelled, { role: "", concentration: null })).toEqual(
      saved
    );
  });
  it("keeps keys of a saved well that this version does not know", () => {
    const newer = { ...well({ sample: "S1" }), volume: 20 } as Well;
    expect(patchWell(newer, { color: "#fde68a" })).toEqual({
      ...newer,
      color: "#fde68a",
    });
  });
  it("applies one field to many wells and leaves the others as they were", () => {
    const wells: Wells = {
      A1: well({ sample: "Std 1", color: "#fecaca", role: "standard" }),
      A2: well({ sample: "Std 2", color: "#bbf7d0", concentration: 5 }),
    };
    const recoloured = applyToWells(wells, ["A1", "A2", "A3"], {
      color: "#fde68a",
    });
    expect(recoloured.A1).toEqual({ ...wells.A1, color: "#fde68a" });
    expect(recoloured.A2).toEqual({ ...wells.A2, color: "#fde68a" });
    // A well that did not exist starts empty and takes the one field.
    expect(recoloured.A3).toEqual(well({ color: "#fde68a" }));
    const roles = applyToWells(wells, ["A2"], { role: "blank" });
    expect(roles.A1).toBe(wells.A1);
    expect(roles.A2).toEqual({ ...wells.A2, role: "blank" });
    // The input is not changed.
    expect(wells.A2.role).toBeUndefined();
  });
  it("writes each well its own fields and removes cleared wells", () => {
    const wells: Wells = { A1: well({ sample: "kept" }), B1: well() };
    expect(
      patchWells(wells, { A1: { concentration: 10 }, A2: { concentration: 5 } })
    ).toEqual({
      A1: well({ sample: "kept", concentration: 10 }),
      A2: well({ concentration: 5 }),
      B1: well(),
    });
    expect(clearWells(wells, ["A1", "H12"])).toEqual({ B1: well() });
  });
  it("reports what a selection shares and which fields differ", () => {
    const wells: Wells = {
      A1: well({ sample: "Std", role: "standard", concentration: 10 }),
      A2: well({ sample: "Std", role: "standard", concentration: 5 }),
      A3: well({ sample: "Std", role: "blank", color: "#fecaca" }),
    };
    expect(commonFields(wells, ["A1", "A2"])).toEqual({
      values: {
        sample: "Std",
        condition: "",
        replicate: "",
        role: "standard",
        concentration: null,
        color: "#bfdbfe",
      },
      mixed: ["concentration"],
    });
    const three = commonFields(wells, ["A1", "A2", "A3"]);
    expect(three.mixed).toEqual(["role", "concentration", "color"]);
    expect(three.values.role).toBe("");
    // A colour input cannot be empty, so the first well's colour stands in.
    expect(three.values.color).toBe("#bfdbfe");
    // An empty well in the selection counts as a well with empty fields.
    expect(commonFields(wells, ["A1", "B1"]).mixed).toEqual([
      "sample",
      "role",
      "concentration",
    ]);
    expect(commonFields(wells, [])).toEqual({
      values: readFields(undefined),
      mixed: [],
    });
  });
});

describe("series fills", () => {
  it("fills a two-fold dilution along a row", () => {
    expect(dilutionSeries(["A1", "A2", "A3", "A4"], 100, 2, "row")).toEqual({
      A1: 100,
      A2: 50,
      A3: 25,
      A4: 12.5,
    });
  });
  it("gives every selected row the same series, so rows are replicates", () => {
    expect(
      dilutionSeries(["A1", "A2", "A3", "B1", "B2", "B3"], 10, 10, "row")
    ).toEqual({ A1: 10, A2: 1, A3: 0.1, B1: 10, B2: 1, B3: 0.1 });
  });
  it("runs down the columns when asked", () => {
    expect(
      dilutionSeries(["A1", "A2", "B1", "B2", "C1", "C2"], 8, 2, "column")
    ).toEqual({ A1: 8, A2: 8, B1: 4, B2: 4, C1: 2, C2: 2 });
  });
  it("steps by selected column, so skipped columns do not skip a dilution", () => {
    // Columns 1, 3 and 5 are three steps; B3 lines up with A3.
    expect(dilutionSeries(["A1", "A3", "A5", "B3"], 90, 3, "row")).toEqual({
      A1: 90,
      A3: 30,
      A5: 10,
      B3: 30,
    });
  });
  it("leaves no floating-point residue in the concentrations", () => {
    // 0.3 / 3 is 0.09999999999999999 in binary floating point.
    expect(dilutionSeries(["A1", "A2"], 0.3, 3, "row").A2).toBe(0.1);
    expect(dilutionSeries(["A1", "A2", "A3", "A4"], 90, 3, "row").A4).toBe(
      3.33333333333
    );
  });
  it("rejects a start or factor that cannot make a dilution", () => {
    expect(() => dilutionSeries(["A1"], 0, 2, "row")).toThrow(
      "Concentration must be positive"
    );
    expect(() => dilutionSeries(["A1"], -5, 2, "row")).toThrow(
      "Concentration must be positive"
    );
    expect(() => dilutionSeries(["A1"], 10, 1, "row")).toThrow(
      "Serial dilution factor must exceed 1"
    );
    expect(() => dilutionSeries(["A1"], 10, 0.5, "row")).toThrow(
      "Serial dilution factor must exceed 1"
    );
    expect(dilutionSeries([], 10, 2, "row")).toEqual({});
  });
  it("numbers samples along the rows with replicates side by side", () => {
    expect(
      numberedSamples(["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4"], {
        prefix: "S",
        first: 1,
        replicates: 2,
        direction: "row",
      })
    ).toEqual({
      A1: { sample: "S1", replicate: "1" },
      A2: { sample: "S1", replicate: "2" },
      A3: { sample: "S2", replicate: "1" },
      A4: { sample: "S2", replicate: "2" },
      B1: { sample: "S3", replicate: "1" },
      B2: { sample: "S3", replicate: "2" },
      B3: { sample: "S4", replicate: "1" },
      B4: { sample: "S4", replicate: "2" },
    });
  });
  it("numbers samples down the columns: triplicates in A–C, one sample per column", () => {
    const filled = numberedSamples(
      ["A1", "A2", "B1", "B2", "C1", "C2"],
      { prefix: "Mouse ", first: 7, replicates: 3, direction: "column" }
    );
    expect(filled).toEqual({
      A1: { sample: "Mouse 7", replicate: "1" },
      B1: { sample: "Mouse 7", replicate: "2" },
      C1: { sample: "Mouse 7", replicate: "3" },
      A2: { sample: "Mouse 8", replicate: "1" },
      B2: { sample: "Mouse 8", replicate: "2" },
      C2: { sample: "Mouse 8", replicate: "3" },
    });
  });
  it("leaves the replicate field alone when there is one well per sample", () => {
    expect(
      numberedSamples(["B2", "A1", "A2"], {
        prefix: "S",
        first: 10,
        replicates: 1,
        direction: "row",
      })
    ).toEqual({
      A1: { sample: "S10" },
      A2: { sample: "S11" },
      B2: { sample: "S12" },
    });
  });
  it("rejects replicate counts and start numbers that are not whole", () => {
    const fill = (first: number, replicates: number) => () =>
      numberedSamples(["A1"], {
        prefix: "S",
        first,
        replicates,
        direction: "row",
      });
    expect(fill(1, 0)).toThrow("Replicates must be a whole number of 1 or more");
    expect(fill(1, 2.5)).toThrow(
      "Replicates must be a whole number of 1 or more"
    );
    expect(fill(-1, 1)).toThrow(
      "Start number must be a whole number of 0 or more"
    );
    expect(fill(1.5, 1)).toThrow(
      "Start number must be a whole number of 0 or more"
    );
    expect(fill(0, 1)()).toEqual({ A1: { sample: "S0" } });
  });
});

describe("undo records", () => {
  const before: Wells = {
    A1: well({ sample: "one" }),
    A2: well({ sample: "two" }),
    A3: well({ sample: "three" }),
  };
  const after: Wells = {
    A1: well({ sample: "one" }),
    A2: well({ sample: "two", role: "sample" }),
    B1: well({ sample: "new" }),
  };
  it("records only the wells that changed, appeared or went away", () => {
    expect(diffWells(before, after)).toEqual({
      A2: { before: before.A2, after: after.A2 },
      A3: { before: before.A3 },
      B1: { after: after.B1 },
    });
    expect(diffWells(before, { ...before })).toEqual({});
    // Equal content in a different object is not a change.
    expect(diffWells({ A1: well() }, { A1: well() })).toEqual({});
  });
  it("undoes and redoes a change", () => {
    const change = diffWells(before, after);
    expect(applyChange(after, change, "before")).toEqual(before);
    expect(applyChange(before, change, "after")).toEqual(after);
  });
  it("leaves wells edited since the change alone when undoing it", () => {
    const change = diffWells(before, after);
    const later = { ...after, H12: well({ sample: "later" }) };
    expect(applyChange(later, change, "before")).toEqual({
      ...before,
      H12: well({ sample: "later" }),
    });
  });
  it("inverts a change, so restoring can itself be recorded", () => {
    const change = diffWells(before, after);
    expect(invertChange(change)).toEqual(diffWells(after, before));
    expect(applyChange(after, invertChange(change), "after")).toEqual(before);
  });
});

describe("concentration scale", () => {
  it("has no scale without values", () => {
    expect(concentrationScale([])).toBeNull();
    expect(concentrationScale([NaN, Infinity])).toBeNull();
  });
  it("spreads a two-fold series over the steps on a log scale", () => {
    const series = [100, 50, 25, 12.5, 6.25, 3.125, 1.5625, 0.78125];
    const scale = concentrationScale(series)!;
    expect(scale.log).toBe(true);
    expect(scale.min).toBe(0.78125);
    expect(scale.max).toBe(100);
    expect(scale.belowMin).toBe(false);
    // Eight values a factor of two apart over seven steps: each value sits one
    // seventh of the range above the last, the top two share the darkest step.
    expect(series.map(scale.step)).toEqual([6, 6, 5, 4, 3, 2, 1, 0]);
  });
  it("keeps evenly spaced concentrations on a linear scale", () => {
    const scale = concentrationScale([0, 2, 4, 6, 8, 10])!;
    expect(scale.log).toBe(false);
    expect([scale.min, scale.max]).toEqual([0, 10]);
    // 0, 0.2, 0.4 … of the range times seven steps: 0, 1.4, 2.8, 4.2, 5.6, 7.
    expect([0, 2, 4, 6, 8, 10].map(scale.step)).toEqual([0, 1, 2, 4, 5, 6]);
    // Twenty-fold range, but arithmetic spacing: still linear.
    const counts = Array.from({ length: 20 }, (_, index) => index + 1);
    expect(concentrationScale(counts)!.log).toBe(false);
  });
  it("puts a series that lands on the step edges into steps the same way every time", () => {
    // 0, 2, … 14: each value is exactly k sevenths of the range.
    const scale = concentrationScale([0, 2, 4, 6, 8, 10, 12, 14])!;
    expect([0, 2, 4, 6, 8, 10, 12, 14].map(scale.step)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 6,
    ]);
  });
  it("draws a zero standard in the lightest step of a log scale", () => {
    const scale = concentrationScale([0, 1, 10, 100, 1000])!;
    expect(scale.log).toBe(true);
    expect([scale.min, scale.max]).toEqual([1, 1000]);
    expect(scale.belowMin).toBe(true);
    // Decades are thirds of the range: 0, 2.33, 4.67 and 7 of seven steps.
    expect([0, 1, 10, 100, 1000].map(scale.step)).toEqual([0, 0, 2, 4, 6]);
  });
  it("needs three distinct values over a decade before it goes logarithmic", () => {
    expect(concentrationScale([1, 1000])!.log).toBe(false);
    expect(concentrationScale([1, 1, 1000, 1000])!.log).toBe(false);
    // 1, 2, 4 is a ratio series but spans only a factor of four.
    expect(concentrationScale([1, 2, 4])!.log).toBe(false);
    expect(concentrationScale([1, 10, 100])!.log).toBe(true);
  });
  it("uses the middle step when every well has the same concentration", () => {
    const scale = concentrationScale([5, 5, 5])!;
    expect([scale.min, scale.max, scale.log]).toEqual([5, 5, false]);
    expect(scale.step(5)).toBe(3);
  });
  it("gives a well without a concentration no step", () => {
    const scale = concentrationScale([1, 2, 3])!;
    expect(scale.step(null)).toBeNull();
    expect(scale.step(undefined)).toBeNull();
    expect(scale.step(NaN)).toBeNull();
  });
});

describe("plate text", () => {
  it("shortens a number to fit a well without changing its size", () => {
    expect(compactNumber(100)).toBe("100");
    expect(compactNumber(12.5)).toBe("12.5");
    expect(compactNumber(0)).toBe("0");
    expect(compactNumber(3.33333333333)).toBe("3.333");
    expect(compactNumber(0.0123456)).toBe("0.01235");
    // Whole part kept in full below 100000, powers of ten beyond.
    expect(compactNumber(12345.6)).toBe("12346");
    expect(compactNumber(1234567)).toBe("1.23e6");
    expect(compactNumber(100000)).toBe("1e5");
    expect(compactNumber(0.00015258)).toBe("1.53e-4");
    expect(compactNumber(NaN)).toBe("");
  });
  it("sends the calibration curve one row per well that has a role, in row order", () => {
    const wells: Wells = {
      B1: well({ sample: "Serum 1", role: "sample" }),
      A2: well({ sample: " Std ", role: "standard", concentration: 0.1 + 0.2 }),
      A1: well({ role: "blank", concentration: 0 }),
      A3: well({ sample: "no role", concentration: 4 }),
      H12: well({ sample: "outside", role: "standard", concentration: 1 }),
    };
    // A 2 × 3 plate: H12 is kept in the document but is not on this plate.
    expect(calibrationRows(wells, wellNames(2, 3))).toEqual([
      ["blank", "A1", "0"],
      ["standard", "A2 · Std", "0.3"],
      ["sample", "B1 · Serum 1", ""],
    ]);
    expect(calibrationRows({}, wellNames(2, 3))).toEqual([]);
  });
});
