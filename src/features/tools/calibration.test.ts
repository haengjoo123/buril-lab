import { describe, expect, it } from "vitest";
import {
  AmbiguousNumber,
  fitCalibration,
  parseSampleRows,
  parseStandardRows,
  replicateGroups,
  type Model,
} from "./calibration";

const pairs = (points: [number, number][]) =>
  points.map(([x, y]) => ({ x, y }));

describe("replicate measurements", () => {
  // Three levels measured twice, ±0.1 about y = 2x.
  const duplicate = pairs([
    [1, 1.9],
    [1, 2.1],
    [2, 3.9],
    [2, 4.1],
    [3, 5.9],
    [3, 6.1],
  ]);
  it("fits every measurement rather than the mean of each level", () => {
    const fit = fitCalibration(duplicate, "linear");
    expect(fit.params[0]).toBeCloseTo(2, 12);
    expect(fit.params[1]).toBeCloseTo(0, 12);
    expect(fit.n).toBe(6);
    // Each point is 0.1 from the line: SSE = 6 × 0.01, on 6 − 2 degrees of
    // freedom. A fit to the three means would report no scatter at all.
    expect(fit.rmse).toBeCloseTo(Math.sqrt(0.06 / 4), 12);
    expect(fit.residuals.map((r) => Number(r.toFixed(6)))).toEqual([
      -0.1, 0.1, -0.1, 0.1, -0.1, 0.1,
    ]);
    // SST about the grand mean 4 is 16.06.
    expect(fit.r2).toBeCloseTo(1 - 0.06 / 16.06, 12);
  });
  it("needs two different x however many times each was measured", () => {
    expect(() =>
      fitCalibration(
        pairs([
          [1, 3],
          [1, 4],
          [1, 5],
        ]),
        "linear"
      )
    ).toThrow("At least 2 distinct standards required");
    // Four levels in duplicate are eight points, but still four x.
    expect(() =>
      fitCalibration(
        [1, 2, 3, 4].flatMap((x) => pairs([
          [x, x],
          [x, x + 0.1],
        ])),
        "hill"
      )
    ).toThrow("at least 5 distinct");
  });
  it("summarises each level with its mean, sample SD and n", () => {
    // The textbook set: mean 5, population SD 2, sample SD √(32/7).
    const level = [2, 4, 4, 4, 5, 5, 7, 9].map((y) => ({ x: 10, y }));
    expect(
      replicateGroups([
        ...level,
        { x: 0, y: 1 },
        { x: 10, y: 1000, excluded: true },
        { x: NaN, y: 3 },
      ])
    ).toEqual([
      { x: 0, n: 1, mean: 1, sd: null },
      { x: 10, n: 8, mean: 5, sd: Math.sqrt(32 / 7) },
    ]);
    expect(replicateGroups(level)[0].sd).toBeCloseTo(2.13809, 5);
  });
});

describe("RMSE on n − p degrees of freedom", () => {
  // By hand: slope 19.6 / 10 = 1.96, intercept 6.1 − 1.96 × 3 = 0.22,
  // residuals 0.02, −0.04, 0.1, −0.16, 0.08, SSE = 0.044.
  const five = pairs([
    [1, 2.2],
    [2, 4.1],
    [3, 6.2],
    [4, 7.9],
    [5, 10.1],
  ]);
  it("divides the squared residuals by n − p, not by n", () => {
    const fit = fitCalibration(five, "linear");
    expect(fit.params[0]).toBeCloseTo(1.96, 12);
    expect(fit.params[1]).toBeCloseTo(0.22, 12);
    expect([fit.n, fit.parameters]).toEqual([5, 2]);
    expect(fit.rmse).toBeCloseTo(Math.sqrt(0.044 / 3), 10);
    expect(fit.rmse).toBeCloseTo(0.121106, 6);
    // The earlier definition, √(SSE / n), gave 0.0938.
    expect(fit.rmse).not.toBeCloseTo(0.0938083, 3);
  });
  it("counts one parameter for a line through the origin and four for Hill", () => {
    const origin = fitCalibration(five, "origin");
    expect(origin.parameters).toBe(1);
    const sse = origin.residuals.reduce((s, r) => s + r * r, 0);
    expect(origin.rmse).toBeCloseTo(Math.sqrt(sse / 4), 12);
    const hill = fitCalibration(
      [0.1, 0.3, 1, 3, 10, 30, 100].map((x) => ({
        x,
        y: 5 + (95 * x ** 1.4) / (4 ** 1.4 + x ** 1.4),
      })),
      "hill"
    );
    expect([hill.n, hill.parameters]).toEqual([7, 4]);
    expect(hill.rmse).not.toBeNull();
  });
  it("reports no RMSE when the points do not outnumber the parameters", () => {
    const two = fitCalibration(five.slice(0, 2), "linear");
    expect(two.rmse).toBeNull();
    expect(two.r2).toBeCloseTo(1, 12);
    // One degree of freedom is enough.
    expect(fitCalibration(five.slice(0, 3), "linear").rmse).not.toBeNull();
    expect(fitCalibration(five.slice(0, 2), "origin").rmse).not.toBeNull();
  });
});

describe("decreasing Hill (4PL)", () => {
  // y = d + (a − d) / (1 + (x / c)^b) with a = 100, d = 5, c = 4, b = 1.4.
  const curve = (x: number) => 5 + 95 / (1 + (x / 4) ** 1.4);
  const xs = [0.1, 0.3, 1, 3, 10, 30, 100];
  const exact = xs.map((x) => ({ x, y: curve(x) }));
  it("recovers the parameters that made the data", () => {
    const fit = fitCalibration(exact, "hill-decreasing");
    const [bottom, top, K, n] = fit.params;
    expect(bottom).toBeCloseTo(5, 4);
    expect(top).toBeCloseTo(100, 4);
    expect(K).toBeCloseTo(4, 5);
    expect(n).toBeCloseTo(1.4, 5);
    expect(fit.r2).toBeGreaterThan(0.999999);
    expect(fit.rmse).toBeLessThan(1e-4);
    expect(fit.equation).toBe("y = 5 + (100 − 5) / (1 + (x / 4)^1.4)");
  });
  it("predicts and inverts against values worked out from the formula", () => {
    const fit = fitCalibration(exact, "hill-decreasing");
    // At x = c the curve is halfway: (100 + 5) / 2.
    expect(fit.predict(4)).toBeCloseTo(52.5, 3);
    expect(fit.inverse(52.5)).toBeCloseTo(4, 3);
    // (1/4)^1.4 = 0.1435873, so y(1) = 5 + 95 / 1.1435873 = 88.07193.
    expect(fit.predict(1)).toBeCloseTo(88.07193, 3);
    // 2^1.4 = 2.6390158, so y(8) = 5 + 95 / 3.6390158 = 31.10596.
    expect(fit.inverse(31.10596)).toBeCloseTo(8, 3);
    // More signal means less analyte.
    expect(fit.inverse(90)).toBeLessThan(fit.inverse(20));
    // Zero dose sits on the top plateau; outside the plateaus nothing inverts.
    expect(fit.predict(0)).toBeCloseTo(100, 3);
    expect(fit.predict(-1)).toBeNaN();
    expect(fit.inverse(101)).toBeNaN();
    expect(fit.inverse(4.9)).toBeNaN();
  });
  it("is the mirror image of the increasing fit", () => {
    // d + (a − d) / (1 + (x/c)^b) = (a + d) − [d + (a − d) x^b / (c^b + x^b)]
    const mirrored = fitCalibration(
      exact.map((p) => ({ x: p.x, y: 105 - p.y })),
      "hill"
    );
    const falling = fitCalibration(exact, "hill-decreasing");
    expect(mirrored.params[2]).toBeCloseTo(falling.params[2], 6);
    expect(mirrored.params[3]).toBeCloseTo(falling.params[3], 6);
    expect(mirrored.predict(2.5)).toBeCloseTo(105 - falling.predict(2.5), 4);
  });
  it("recovers a competitive-assay curve from noisy duplicates", () => {
    // a = 2.1, d = 0.08, c = 12.5, b = 0.9; duplicates 1% above and below.
    const truth = (x: number) => 0.08 + 2.02 / (1 + (x / 12.5) ** 0.9);
    const doses = [0.39, 0.78, 1.56, 3.13, 6.25, 12.5, 25, 50, 100, 200];
    const fit = fitCalibration(
      doses.flatMap((x) => [
        { x, y: truth(x) * 1.01 },
        { x, y: truth(x) * 0.99 },
      ]),
      "hill-decreasing"
    );
    expect(fit.n).toBe(20);
    expect(fit.params[0]).toBeCloseTo(0.08, 1);
    expect(fit.params[1]).toBeCloseTo(2.1, 1);
    expect(Math.abs(fit.params[2] - 12.5) / 12.5).toBeLessThan(0.02);
    expect(Math.abs(fit.params[3] - 0.9) / 0.9).toBeLessThan(0.02);
    expect(fit.inverse(truth(20))).toBeCloseTo(20, 0);
  });
  it("refuses data that run the other way, in either model", () => {
    expect(() => fitCalibration(exact, "hill")).toThrow(
      "Standards do not describe an increasing Hill curve"
    );
    expect(() =>
      fitCalibration(
        exact.map((p) => ({ x: p.x, y: 105 - p.y })),
        "hill-decreasing"
      )
    ).toThrow("Standards do not describe a decreasing Hill curve");
    expect(() =>
      fitCalibration([{ x: 0, y: 100 }, ...exact], "hill-decreasing")
    ).toThrow("Hill requires x > 0");
    expect(() => fitCalibration(exact.slice(0, 4), "hill-decreasing")).toThrow(
      "at least 5 distinct"
    );
  });
  it("still reads the increasing model as before", () => {
    const rising = xs.map((x) => ({
      x,
      y: 5 + (95 * x ** 1.4) / (4 ** 1.4 + x ** 1.4),
    }));
    const fit = fitCalibration(rising, "hill");
    expect(fit.params[0]).toBeCloseTo(5, 4);
    expect(fit.params[1]).toBeCloseTo(100, 4);
    expect(fit.params[2]).toBeCloseTo(4, 5);
    expect(fit.params[3]).toBeCloseTo(1.4, 5);
    expect(fit.equation).toBe("y = 5 + (100 − 5) · x^1.4 / (4^1.4 + x^1.4)");
  });
  it("does not fit a model it does not know as a straight line", () => {
    expect(() =>
      fitCalibration(
        pairs([
          [0, 1],
          [1, 3],
        ]),
        "five-parameter" as Model
      )
    ).toThrow("Unknown fit model");
  });
});

describe("pasted standards", () => {
  it("splits on tab, comma or spaces", () => {
    const expected = [
      ["0", "1"],
      ["1", "3"],
      ["2.5", "5"],
    ];
    expect(parseStandardRows("0\t1\n1\t3\n2.5\t5")).toEqual(expected);
    expect(parseStandardRows("0,1\r\n1,3\r\n2.5, 5\r\n")).toEqual(expected);
    expect(parseStandardRows("0 1\n1   3\n  2.5 5\n\n")).toEqual(expected);
    expect(parseStandardRows("0;1\n1;3\n2.5;5")).toEqual(expected);
  });
  it("reads a comma inside a tab- or semicolon-separated cell as the decimal mark", () => {
    expect(parseStandardRows("0,5\t0,125\n1\t0,25")).toEqual([
      ["0.5", "0.125"],
      ["1", "0.25"],
    ]);
    expect(parseStandardRows("0,5;1,25\n-2,5;3")).toEqual([
      ["0.5", "1.25"],
      ["-2.5", "3"],
    ]);
  });
  it("takes a lone comma as the column separator when there is no tab", () => {
    // "0,5" with nothing else on the line is x 0 and y 5, as it always was.
    expect(parseStandardRows("0,5\n1,7")).toEqual([
      ["0", "5"],
      ["1", "7"],
    ]);
    // With a space between the columns the commas can only be decimals.
    expect(parseStandardRows("0,5 1,2\n1,0 2,3")).toEqual([
      ["0.5", "1.2"],
      ["1.0", "2.3"],
    ]);
  });
  it("lets the rest of the paste decide what 1,234 means", () => {
    // A decimal comma elsewhere: 1,234 is 1.234.
    expect(parseStandardRows("1\t0,125\n2\t1,234")).toEqual([
      ["1", "0.125"],
      ["2", "1.234"],
    ]);
    // A decimal period elsewhere: 1,000 is one thousand.
    expect(parseStandardRows("1,000\t0.52\n2,000\t1.04")).toEqual([
      ["1000", "0.52"],
      ["2000", "1.04"],
    ]);
    // Figures that carry both marks say so themselves.
    expect(parseStandardRows("1,234.5\t2\n1.234,5\t2")).toEqual([
      ["1234.5", "2"],
      ["1234.5", "2"],
    ]);
    expect(parseStandardRows("1,234,567\t1,000")).toEqual([
      ["1234567", "1000"],
    ]);
    // With decimal commas in the sheet, a period can only be grouping.
    expect(parseStandardRows("1.000\t0,5")).toEqual([["1000", "0.5"]]);
  });
  it("asks instead of guessing when nothing settles 1,234", () => {
    const paste = "1,000\t15,234\n2,000\t31,871";
    let thrown: unknown;
    try {
      parseStandardRows(paste);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AmbiguousNumber);
    expect((thrown as AmbiguousNumber).example).toBe("1,000");
    // The answer is then applied to the whole paste.
    expect(parseStandardRows(paste, ".")).toEqual([
      ["1000", "15234"],
      ["2000", "31871"],
    ]);
    expect(parseStandardRows(paste, ",")).toEqual([
      ["1.000", "15.234"],
      ["2.000", "31.871"],
    ]);
    // Both marks used as decimals in one paste leaves 1,234 undecided too.
    expect(() => parseStandardRows("0,5\t0.5\n1,234\t2")).toThrow(
      AmbiguousNumber
    );
  });
  it("leaves 1.234 alone: a period is the app's own decimal mark", () => {
    expect(parseStandardRows("1.234\t2.345\n3\t4")).toEqual([
      ["1.234", "2.345"],
      ["3", "4"],
    ]);
  });
  it("keeps column names and unreadable cells as typed", () => {
    expect(
      // A CSV file saved by a spreadsheet starts with a byte-order mark.
      parseStandardRows("\uFEFFConc (mg/mL)\tA562\n0,5\toops")
    ).toEqual([
      ["Conc (mg/mL)", "A562"],
      ["0.5", "oops"],
    ]);
    expect(parseStandardRows('"0,5","1,25"')).toEqual([["0.5", "1.25"]]);
  });
  it("requires exactly two columns", () => {
    for (const text of ["", "1\n2", "1\t2\t3", "1,2,3", "1 2 3", "1\t2\n3"])
      expect(() => parseStandardRows(text)).toThrow(
        "Exactly two columns required"
      );
  });
});

describe("pasted samples", () => {
  it("reads a column of values, or a name column and a value column", () => {
    expect(parseSampleRows("0.52\n0.61\n\n1.2\n")).toEqual([
      { name: "", input: "0.52" },
      { name: "", input: "0.61" },
      { name: "", input: "1.2" },
    ]);
    expect(parseSampleRows("Serum 1\t0.52\r\nSerum 2\t0,61\r\n\t1.2")).toEqual([
      { name: "Serum 1", input: "0.52" },
      { name: "Serum 2", input: "0.61" },
      { name: "", input: "1.2" },
    ]);
    expect(parseSampleRows("A;0,52\nB;0,61")).toEqual([
      { name: "A", input: "0.52" },
      { name: "B", input: "0.61" },
    ]);
  });
  it("reads a line that is one figure as a value, decimal comma included", () => {
    // A column copied from a sheet that writes 0,52 has no tabs in it.
    expect(parseSampleRows("0,52\n1,5\n12,25")).toEqual([
      { name: "", input: "0.52" },
      { name: "", input: "1.5" },
      { name: "", input: "12.25" },
    ]);
  });
  it("splits a typed line at the comma before the value, never at a space", () => {
    expect(parseSampleRows("Serum 1, 0.52\nS2,0,61\nSerum 3")).toEqual([
      { name: "Serum 1", input: "0.52" },
      { name: "S2", input: "0.61" },
      // No value: kept as typed, for the screen to flag.
      { name: "", input: "Serum 3" },
    ]);
  });
  it("keeps a name as typed and a value that is not a figure for the screen to flag", () => {
    expect(parseSampleRows("1,5\tOVER\nBlank\t")).toEqual([
      { name: "1,5", input: "OVER" },
      { name: "Blank", input: "" },
    ]);
  });
  it("asks about 1,234 the same way the standards do", () => {
    expect(() => parseSampleRows("A\t1,234\nB\t2,345")).toThrow(
      AmbiguousNumber
    );
    expect(parseSampleRows("A\t1,234\nB\t0,345")).toEqual([
      { name: "A", input: "1.234" },
      { name: "B", input: "0.345" },
    ]);
    expect(parseSampleRows("1,234\n2,345", ".")).toEqual([
      { name: "", input: "1234" },
      { name: "", input: "2345" },
    ]);
  });
  it("rejects more than a name and a value", () => {
    expect(() => parseSampleRows("A\t1\t2")).toThrow(
      "Sample rows need a value, or a name and a value"
    );
    expect(() => parseSampleRows("  \n")).toThrow(
      "Sample rows need a value, or a name and a value"
    );
  });
});
