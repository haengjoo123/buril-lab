import { describe, it, expect } from "vitest";
import {
  CalculationError,
  evaluateExpression,
  insertIntoExpression,
  parseExpression,
} from "./expression";

// Expected values are worked out by hand (shown beside each case), not read
// back from the engine.
const value = (
  input: string,
  values: Record<string, number | string> = {},
  percent?: "fraction" | "of-left"
) => evaluateExpression(input, values, "RAD", { percent }).result;

describe("implicit multiplication", () => {
  it("multiplies a factor written straight after another", () => {
    // 2π = 6.283185307…
    expect(value("2pi")).toBeCloseTo(6.283185307, 9);
    expect(value("2π")).toBeCloseTo(6.283185307, 9);
    expect(value("2(3)")).toBe(6);
    // (1+2)(3+4) = 3 × 7.
    expect(value("(1+2)(3+4)")).toBe(21);
    // 3√4 = 3 × 2.
    expect(value("3sqrt(4)")).toBe(6);
    expect(value("2x", { x: 5 })).toBe(10);
    expect(value("a b", { a: 2, b: 3 })).toBe(6);
    // 2πr with r = 3 is 6π = 18.8495559215…
    expect(value("2πr", { r: 3 })).toBeCloseTo(18.8495559215, 9);
    expect(parseExpression("2πr").variables).toEqual(["r"]);
    // (1+2)3 = 9; sin(0)cos(0) = 0 × 1.
    expect(value("(1+2)3")).toBe(9);
    expect(value("sin(0)cos(0)")).toBe(0);
  });
  it("ranks it with a written multiplication, below powers and signs", () => {
    // 2x² with x = 3 is 2 × 9.
    expect(value("2x^2", { x: 3 })).toBe(18);
    // 2³ × 4, not 2^(3 × 4).
    expect(value("2^3(4)")).toBe(32);
    // Left to right with "/": (1/2) × 4.
    expect(value("1/2x", { x: 4 })).toBe(2);
    expect(value("-2x", { x: 3 })).toBe(-6);
    // A sign starts a new term: 2 − 3, not 2 × (−3).
    expect(value("2 -3")).toBe(-1);
    expect(value("(2)(-3)")).toBe(-6);
  });
  it("keeps scientific notation and function calls", () => {
    expect(value("2e3")).toBe(2000);
    expect(value("2E3")).toBe(2000);
    expect(value("2e+3")).toBe(2000);
    expect(value("1.5e-3")).toBe(0.0015);
    // 2e3 × x, not 2 × e3x.
    expect(value("2e3x", { x: 2 })).toBe(4000);
    // sin(1 rad) = 0.8414709848…
    expect(value("sin(1)")).toBeCloseTo(0.8414709848, 9);
    // "2e" with no exponent is 2 × e = 5.436563656…
    expect(value("2e")).toBeCloseTo(5.436563657, 8);
  });
  it("does not guess at two numbers or an unknown function", () => {
    expect(() => value("2 3")).toThrow("Incomplete or invalid equation");
    expect(() => value("1.2.3")).toThrow("Incomplete or invalid equation");
    // "sqr(4)" is a mistyped function, not sqr × 4.
    expect(() => value("sqr(4)", { sqr: 2 })).toThrow(
      "Incomplete or invalid equation"
    );
    expect(() => value("x 2", { x: 3 })).toThrow(
      "Incomplete or invalid equation"
    );
    expect(() => value("sin")).toThrow("Incomplete or invalid equation");
  });
  it("substitutes whole names only", () => {
    expect(evaluateExpression("2x", { x: 5 }).substituted).toBe("2(5)");
    // The "e3" inside "2e3" is an exponent, not the variable e3: 1 + 2000.
    expect(evaluateExpression("e3 + 2e3", { e3: 1 })).toMatchObject({
      result: 2001,
      substituted: "(1) + 2e3",
    });
  });
});
describe("percent", () => {
  it("is a hundredth everywhere unless asked otherwise", () => {
    for (const percent of [undefined, "fraction"] as const) {
      // 50 + 0.1, 50 − 0.1.
      expect(value("50+10%", {}, percent)).toBeCloseTo(50.1, 12);
      expect(value("50-10%", {}, percent)).toBeCloseTo(49.9, 12);
      expect(value("200*10%", {}, percent)).toBeCloseTo(20, 12);
      expect(value("200/10%", {}, percent)).toBeCloseTo(2000, 9);
      expect(value("25%", {}, percent)).toBe(0.25);
      expect(value("25%*200", {}, percent)).toBe(50);
    }
  });
  it("is a share of the value before it on a pocket calculator", () => {
    // 50 + 10 % of 50 = 55; 50 − 10 % of 50 = 45.
    expect(value("50+10%", {}, "of-left")).toBeCloseTo(55, 12);
    expect(value("50-10%", {}, "of-left")).toBeCloseTo(45, 12);
    // Multiplying and dividing still use the hundredth: 200 × 0.1, 200 ÷ 0.1.
    expect(value("200*10%", {}, "of-left")).toBeCloseTo(20, 12);
    expect(value("200/10%", {}, "of-left")).toBeCloseTo(2000, 9);
    expect(value("25%", {}, "of-left")).toBe(0.25);
    // 200 + 15 % = 230; then + 10 % of 230 = 253.
    expect(value("200+15%+10%", {}, "of-left")).toBeCloseTo(253, 10);
    // The share is of everything before it: (2 × 50) + 10 % = 110.
    expect(value("2*50+10%", {}, "of-left")).toBeCloseTo(110, 12);
  });
  it("keeps the hundredth where the percentage is not simply added", () => {
    // Brackets close it off: 100 − 0.1.
    expect(value("100-(10%)", {}, "of-left")).toBeCloseTo(99.9, 12);
    // On the left it is a plain number: 0.1 + 50.
    expect(value("10%+50", {}, "of-left")).toBeCloseTo(50.1, 12);
    // 50 + (0.1 × 2).
    expect(value("50+10%*2", {}, "of-left")).toBeCloseTo(50.2, 12);
  });
});
describe("names", () => {
  it("accepts letters of any script", () => {
    expect(parseExpression("농도*부피").variables).toEqual(["농도", "부피"]);
    expect(evaluateExpression("농도*부피", { 농도: 2, 부피: 3 })).toMatchObject({
      result: 6,
      substituted: "(2)*(3)",
    });
    // 2 × 농도 + 최종_부피1 = 2 × 4 + 1.
    expect(value("2농도 + 최종_부피1", { 농도: 4, 최종_부피1: 1 })).toBe(9);
    expect(parseExpression("Δt/µ").variables).toEqual(["Δt", "µ"]);
    // Scripts that write vowels as combining marks keep a word in one name.
    expect(parseExpression("गति*2").variables).toEqual(["गति"]);
    expect(parseExpression("x1 + x_2").variables).toEqual(["x1", "x_2"]);
  });
  it("keeps constants and functions reserved", () => {
    expect(parseExpression("pi*e*r").variables).toEqual(["r"]);
    expect(parseExpression("sqrt(x)+abs(y)").variables).toEqual(["x", "y"]);
    // log is the base-10 logarithm, like log10; ln is natural.
    expect(value("log(1000)")).toBeCloseTo(3, 12);
    expect(value("log10(1000)")).toBeCloseTo(3, 12);
    expect(value("ln(e)")).toBeCloseTo(1, 12);
    expect(value("abs(-3)")).toBe(3);
  });
  it("names the variable that has no value", () => {
    let caught: unknown;
    try {
      evaluateExpression("농도*2", { 농도: "" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CalculationError);
    expect(caught).toMatchObject({ code: "missing", variable: "농도" });
    // A name that Object.prototype also has is still just an empty variable.
    expect(() => evaluateExpression("toString+1")).toThrow("Enter toString");
    expect(() => evaluateExpression("constructor")).toThrow(
      "Enter constructor"
    );
    expect(evaluateExpression("constructor", { constructor: 2 }).result).toBe(2);
  });
});
describe("inserting from a keypad", () => {
  it("keeps a name apart from its neighbours", () => {
    // "a" then the key for "b" is a × b, not a new name "ab".
    expect(insertIntoExpression("a", 1, 1, "b")).toEqual({
      expression: "a b",
      caret: 3,
    });
    expect(insertIntoExpression("xy", 0, 0, "a")).toEqual({
      expression: "a xy",
      caret: 2,
    });
    // "2" then "e" must not become the start of "2e3".
    expect(insertIntoExpression("2", 1, 1, "e").expression).toBe("2 e");
    expect(insertIntoExpression("2", 1, 1, "sqrt(").expression).toBe("2 sqrt(");
    // 2 √4 = 4.
    expect(value("2 sqrt(4)")).toBe(4);
    expect(insertIntoExpression("농도", 2, 2, "부피").expression).toBe(
      "농도 부피"
    );
  });
  it("puts everything else exactly at the caret", () => {
    expect(insertIntoExpression("2+", 2, 2, "x")).toEqual({
      expression: "2+x",
      caret: 3,
    });
    expect(insertIntoExpression("12", 1, 1, "5").expression).toBe("152");
    expect(insertIntoExpression("sin", 3, 3, "(").expression).toBe("sin(");
    // A selection is replaced.
    expect(insertIntoExpression("1+2", 1, 2, "*")).toEqual({
      expression: "1*2",
      caret: 2,
    });
  });
});
