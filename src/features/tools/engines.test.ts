import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { tools } from "./registry";
import { searchTools, touchRecent, mergeRecent } from "./catalog";
import { evaluateExpression, parseExpression } from "./expression";
import { convertUnit, convertCentrifuge } from "./units";
import { dilution, molarity, seeding, growthHours, cellCount } from "./labMath";
import { fitCalibration } from "./calibration";
import {
  measure,
  ladderPositions,
  colorFraction,
  colorCoverage,
} from "./geometry";
import { plainNumber } from "./format";
import {
  exportICS,
  importICS,
  mergeImported,
  shiftAnchor,
  occurrences,
  type CalendarEvent,
} from "./calendar";
describe("safe equation engine", () => {
  it("converts rotor speed using radius and keeps ppm mass fractions distinct from volume fractions", () => {
    expect(convertCentrifuge(1000, "RPM", 10)).toBeCloseTo(111.8, 10);
    expect(convertCentrifuge(111.8, "RCF", 10)).toBeCloseTo(1000, 10);
    expect(() => convertCentrifuge(1000, "RPM", 0)).toThrow();
    expect(() => convertCentrifuge(-1, "RCF", 10)).toThrow();
    expect(convertUnit(1, "% w/w", "ppm w/w")).toBe(10000);
    expect(convertUnit(1000, "ppm w/w", "g/L", undefined, 1)).toBeCloseTo(1);
    expect(() => convertUnit(1, "% v/v", "% w/w")).toThrow("Incompatible");
  });
  it("extracts variables and shows substituted expression", () => {
    expect(parseExpression("a*b+c").variables).toEqual(["a", "b", "c"]);
    expect(evaluateExpression("a*b+c", { a: 2, b: 3, c: 1 })).toMatchObject({
      result: 7,
      substituted: "(2)*(3)+(1)",
    });
  });
  it("distinguishes blank, zero, grammar and domain errors", () => {
    expect(evaluateExpression("a", { a: 0 }).result).toBe(0);
    expect(() => evaluateExpression("a", { a: "" })).toThrow("Enter a");
    expect(() => evaluateExpression("2+")).toThrow();
    expect(() => evaluateExpression("1/0")).toThrow("Division by zero");
    expect(() => evaluateExpression("sqrt(-1)")).toThrow("domain");
    expect(() => evaluateExpression("exp(1000)")).toThrow("finite");
  });
  it("uses mathematical precedence and right associative powers", () => {
    expect(evaluateExpression("-2^2").result).toBe(-4);
    expect(evaluateExpression("2^3^2").result).toBe(512);
    expect(evaluateExpression("25%*200").result).toBe(50);
    expect(evaluateExpression("sin(90)", {}, "DEG").result).toBeCloseTo(1);
  });
  it("rejects executable JavaScript and prototype names", () => {
    for (const expression of [
      "window.alert(1)",
      "a=1",
      "(()=>7)()",
      "constructor(1)",
      "__proto__(1)",
      "[1][0]",
    ])
      expect(() => evaluateExpression(expression)).toThrow();
  });
});
describe("laboratory calculations", () => {
  it("conserves dilution volumes and rejects concentrating", () => {
    expect(dilution(100, 10, 10)).toMatchObject({
      stockVolume: 1,
      diluentVolume: 9,
      factor: 10,
    });
    expect(() => dilution(1, 10, 10)).toThrow();
  });
  it("converts dimensions and requires concentration context", () => {
    expect(convertUnit(1, "g", "mg")).toBe(1000);
    expect(convertUnit(32, "°F", "°C")).toBeCloseTo(0);
    expect(convertUnit(convertUnit(3.4, "µL", "L"), "L", "µL")).toBeCloseTo(
      3.4
    );
    expect(convertUnit(1, "M", "g/L", 58.44)).toBeCloseTo(58.44);
    expect(convertUnit(10, "% w/w", "g/L", undefined, 1.2)).toBeCloseTo(120);
    expect(() => convertUnit(1, "g", "mL")).toThrow();
    expect(() => convertUnit(1, "M", "g/L")).toThrow();
    expect(() => convertUnit(-300, "°C", "K")).toThrow();
  });
  it("computes molarity and hemocytometer results", () => {
    expect(molarity(58.44, 58.44, 1)).toBe(1);
    expect(cellCount([100, 100], [0, 0], 2, 0.0001)).toMatchObject({
      concentration: 2000000,
      viability: 100,
    });
  });
  it("separates per-vessel cells from totals and stops insufficient dispensing", () => {
    const profile = {
        kind: "adherent" as const,
        doublingHours: 24,
        density: 100000,
        maxDensity: 1000000,
      },
      v = {
        id: "1",
        name: "T25",
        area: 25,
        volume: 5,
        count: 1,
        mode: "split" as const,
        target: 5,
      };
    const r = seeding(profile, 1000000, 10, [v]);
    expect(r.rows[0]).toMatchObject({
      stock: 2,
      medium: 3,
      cells: 2000000,
      confluence: 80,
    });
    expect(seeding(profile, 1000000, 10, [{ ...v, count: 6 }]).valid).toBe(
      false
    );
    expect(seeding(profile, 1000000, 10, [{ ...v, target: 1 }]).valid).toBe(
      false
    );
    expect(growthHours(30, 80, 24)).toBeCloseTo(33.9609, 3);
    expect(
      seeding({ ...profile, kind: "suspension" }, 1000000, 10, [v]).rows[0]
        .stock
    ).toBe(1);
  });
});
describe("calibration models", () => {
  it("fits linear and inverse, retains original-space residuals", () => {
    const f = fitCalibration(
      [
        { x: 0, y: 1 },
        { x: 1, y: 3 },
        { x: 2, y: 5 },
      ],
      "linear"
    );
    expect(f.params).toEqual([2, 1]);
    expect(f.inverse(6)).toBe(2.5);
    expect(f.r2).toBe(1);
  });
  it("fits exponential and refuses silently excluded rows", () => {
    const p = [
      { x: 0, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 4 },
    ];
    const f = fitCalibration(p, "exponential");
    expect(f.predict(3)).toBeCloseTo(8);
    expect(f.inverse(2)).toBeCloseTo(1);
    expect(() =>
      fitCalibration([{ x: 0, y: -1 }, ...p.slice(1)], "exponential")
    ).toThrow("y > 0");
    expect(
      fitCalibration(
        [{ x: 0, y: -1, excluded: true }, ...p.slice(1)],
        "exponential"
      ).predict(3)
    ).toBeCloseTo(8);
  });
  it("recovers a known Hill curve independently of competitor output", () => {
    const p = [0.1, 0.3, 1, 3, 10, 30, 100].map((x) => ({
      x,
      y: 5 + (95 * x ** 1.4) / (4 ** 1.4 + x ** 1.4),
    }));
    const f = fitCalibration(p, "hill");
    expect(f.predict(4)).toBeCloseTo(52.5, 3);
    expect(f.inverse(52.5)).toBeCloseTo(4, 3);
    expect(f.r2).toBeGreaterThan(0.999999);
    expect(f.inverse(101)).toBeNaN();
  });
  it("rejects degenerate and underspecified data", () => {
    expect(() =>
      fitCalibration(
        [
          { x: 1, y: 3 },
          { x: 1, y: 4 },
        ],
        "linear"
      )
    ).toThrow("Duplicate");
    expect(() =>
      fitCalibration(
        [
          { x: 1, y: 3 },
          { x: 2, y: 3 },
        ],
        "linear"
      )
    ).toThrow("Flat");
    expect(() =>
      fitCalibration(
        [1, 2, 3, 4].map((x) => ({ x, y: x })),
        "hill"
      )
    ).toThrow("5");
    expect(
      fitCalibration(
        [
          { x: 1, y: 2 },
          { x: 2, y: 4 },
        ],
        "origin"
      ).r2
    ).toBeNull();
  });
});
describe("image geometry", () => {
  const base = {
    id: "1",
    name: "test",
    color: "#000000",
    points: [
      { x: 100, y: 200 },
      { x: 300, y: 240 },
    ],
  };
  it("calibrates rectangles, ellipses, polygons and lines in source pixels", () => {
    expect(measure({ ...base, kind: "rectangle" }, 0.05)).toMatchObject({
      width: 10,
      height: 2,
      area: 20,
    });
    expect(measure({ ...base, kind: "ellipse" }, 0.05).area).toBeCloseTo(
      5 * Math.PI
    );
    expect(measure({ ...base, kind: "line" }, 0.05).length).toBeCloseTo(
      Math.hypot(200, 40) * 0.05
    );
    expect(
      measure(
        {
          ...base,
          kind: "freehand",
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 40 },
            { x: 0, y: 40 },
          ],
        },
        0.05
      ).area
    ).toBeCloseTo(20);
  });
  it("excludes transparency from the sample denominator", () => {
    expect(
      colorCoverage(
        new Uint8ClampedArray([0, 255, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255]),
        [0, 255, 0],
        0
      )
    ).toEqual({ fraction: 0.5, areaFraction: 1 / 3 });
    expect(
      colorFraction(
        new Uint8ClampedArray([0, 255, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255]),
        [0, 255, 0],
        0
      )
    ).toBe(0.5);
  });
});
describe("measurement and ladder geometry", () => {
  it("places ladder bands by log size with the largest at the top", () => {
    const [top, middle, bottom] = ladderPositions([10000, 1000, 100]);
    expect(top).toBe(0);
    expect(middle).toBeCloseTo(0.5, 10);
    expect(bottom).toBe(1);
    // Stored order does not matter, and an unreadable size keeps its slot.
    expect(ladderPositions([100, 10000])).toEqual([1, 0]);
    expect(ladderPositions([500])).toEqual([0.5]);
    expect(ladderPositions([1000, null, 100])[1]).toBe(0.5);
  });
  it("reports no length or area for labels and colour matches", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 30, y: 40 },
    ];
    const shape = { id: "1", name: "n", color: "#000", points };
    expect(measure({ ...shape, kind: "text" }, 2)).toEqual({});
    expect(measure({ ...shape, kind: "color" }, 2)).toEqual({});
    expect(measure({ ...shape, kind: "line" }, 2)).toEqual({ length: 100 });
  });
  it("writes a fitted line with a signed intercept", () => {
    const line = (points: [number, number][], model: "linear" | "origin") =>
      fitCalibration(
        points.map(([x, y]) => ({ x, y })),
        model
      ).equation;
    expect(
      line(
        [
          [1, 1],
          [2, 3],
          [3, 5],
        ],
        "linear"
      )
    ).toBe("y = 2x − 1");
    expect(
      line(
        [
          [1, 3],
          [2, 5],
          [3, 7],
        ],
        "linear"
      )
    ).toBe("y = 2x + 1");
    expect(
      line(
        [
          [1, 2],
          [2, 4],
        ],
        "origin"
      )
    ).toBe("y = 2x");
  });
});
describe("plain numbers for copy and export", () => {
  it("drops binary floating-point residue and grouping", () => {
    expect(plainNumber(convertUnit(1, "mL", "µL"))).toBe("1000");
    expect(plainNumber(0.1 + 0.2)).toBe("0.3");
    expect(plainNumber(1234567.5)).toBe("1234567.5");
    expect(plainNumber(1e-9)).toBe("1e-9");
    expect(plainNumber(NaN)).toBe("NaN");
  });
  it("names the value a centrifuge conversion is missing", () => {
    expect(() => convertCentrifuge(1000, "RPM", 0)).toThrow(
      "Enter a positive rotor radius"
    );
    expect(() => convertCentrifuge(-1, "RPM", 8)).toThrow(
      "Enter a non-negative speed or force"
    );
  });
});
describe("calendar interoperability", () => {
  const event: CalendarEvent = {
    id: "1",
    title: "A, B; C\nD",
    start: "2026-11-09T00:00:00.000Z",
    end: "2026-11-09T01:00:00.000Z",
    timezone: "Asia/Seoul",
    repeat: "weekly",
    exceptions: ["2026-11-16T00:00:00.000Z"],
    reminderMinutes: 0,
  };
  it("round-trips supported ICS and recurrence exceptions", async () => {
    const [back] = importICS(await exportICS([event]));
    expect(back.title).toBe(event.title);
    expect(back.repeat).toBe("weekly");
    expect(
      occurrences(
        event,
        new Date("2026-11-09"),
        new Date("2026-11-23T23:00Z")
      ).map((e) => e.start)
    ).toEqual(["2026-11-09T00:00:00.000Z", "2026-11-23T00:00:00.000Z"]);
  });
  it("rejects unsupported recurrence without changing the imported schedule", async () => {
    const ics = await exportICS([event]);
    expect(() =>
      importICS(ics.replace("FREQ=WEEKLY", "FREQ=WEEKLY;BYDAY=MO"))
    ).toThrow("Unsupported recurrence");
  });
  it("steps one month at a time from the last day of a month", () => {
    expect(shiftAnchor(new Date(2026, 0, 31), "month", 1).getMonth()).toBe(1);
    expect(shiftAnchor(new Date(2026, 2, 31), "month", -1).getMonth()).toBe(1);
    expect(shiftAnchor(new Date(2026, 0, 31), "list", 1).getMonth()).toBe(1);
    expect(shiftAnchor(new Date(2026, 11, 31), "month", 1).getFullYear()).toBe(
      2027
    );
    const week = shiftAnchor(new Date(2026, 0, 31), "week", 1);
    expect([week.getMonth(), week.getDate()]).toEqual([1, 7]);
  });
  it("updates events imported before instead of adding copies", async () => {
    const own = {
      ...event,
      id: "0b0f5a52-3d3c-4d8e-9a58-0c2f1f7b9a11",
      reminderMinutes: 15,
    };
    const ics = await exportICS([own]);
    expect(importICS(ics)[0].id).toBe(own.id);
    const merged = mergeImported(
      [own],
      importICS(ics.replace("SUMMARY:", "SUMMARY:Moved "))
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].title.startsWith("Moved ")).toBe(true);
    // ICS carries no reminder lead time; the one set here survives.
    expect(merged[0].reminderMinutes).toBe(15);
    const foreign = ics.replace(
      `UID:${own.id}@burillab`,
      "UID:abc-123@example.org"
    );
    const [first] = importICS(foreign),
      [again] = importICS(foreign);
    expect(first.id).toBe(again.id);
    expect(first.id).not.toBe(own.id);
    expect(mergeImported([own], [first])).toHaveLength(2);
    expect(mergeImported(mergeImported([own], [first]), [again])).toHaveLength(
      2
    );
  });
  it("keeps local meeting time across DST", () => {
    const e = {
      ...event,
      start: "2026-10-31T13:00:00.000Z",
      end: "2026-10-31T14:00:00.000Z",
      timezone: "America/New_York",
      repeat: "daily" as const,
      exceptions: [],
    };
    expect(
      occurrences(e, new Date("2026-10-31"), new Date("2026-11-02T23:00Z")).map(
        (e) => e.start
      )
    ).toEqual([
      "2026-10-31T13:00:00.000Z",
      "2026-11-01T14:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
    ]);
  });
});
describe("tool list search and recently used", () => {
  const names = (query: string) => searchTools(query, tools).map((t) => t.id);
  it("finds tools by keyword and abbreviation in either language", () => {
    expect(names("RCF")).toEqual(["unit-converter"]);
    expect(names("원심")).toEqual(["unit-converter"]);
    expect(names("c1v1")).toEqual(["dilution"]);
    expect(names("표준곡선")).toEqual(["calibration-curve"]);
    expect(names("hemocytometer")).toEqual(["cell-counter"]);
    expect(names("없는도구")).toEqual([]);
    expect(names("  ")).toHaveLength(tools.length);
  });
  it("ranks a name match above a keyword or description match and ignores spaces", () => {
    // "희석" names the dilution tool; other tools only mention it.
    expect(names("희석")[0]).toBe("dilution");
    expect(names("단위변환")).toEqual(["unit-converter"]);
    expect(names("cell")[0]).toBe("cell-culture");
  });
  it("keeps the recently used list short, newest first, one entry per tool", () => {
    const list = touchRecent(
      touchRecent(touchRecent([], "timer", 1), "dilution", 2),
      "timer",
      3
    );
    expect(list).toEqual([
      { id: "timer", at: 3 },
      { id: "dilution", at: 2 },
    ]);
    expect(
      mergeRecent(list, [
        { id: "dilution", at: 9 },
        { id: "notes", at: 1 },
      ]).map((entry) => entry.id)
    ).toEqual(["dilution", "timer", "notes"]);
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, at: i }));
    expect(touchRecent(many, "x", 99)).toHaveLength(8);
    expect(mergeRecent(undefined, "junk")).toEqual([]);
  });
  it("keeps every tool id the server accepts, and no other", () => {
    const sql = readFileSync(
      "supabase/migrations/20261109011725_personal_lab_tools.sql",
      "utf8"
    );
    const allowed = [...sql.match(/tool_id in \(([^)]+)\)/)![1].matchAll(/'([^']+)'/g)]
      .map((m) => m[1])
      .sort();
    expect(tools.map((tool) => tool.id).sort()).toEqual(allowed);
  });
});
