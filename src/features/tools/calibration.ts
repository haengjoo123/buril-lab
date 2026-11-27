export type Point = { x: number; y: number; excluded?: boolean };
/**
 * "hill" rises with x and "hill-decreasing" falls. Both are the
 * four-parameter logistic (4PL) between a bottom and a top plateau.
 */
export type Model =
  | "linear"
  | "origin"
  | "exponential"
  | "hill"
  | "hill-decreasing";
export interface Fit {
  model: Model;
  /**
   * linear and origin: [slope, intercept]; exponential: [a, b] of a · exp(bx);
   * both Hill models: [bottom, top, K, n], with K the x at half height.
   */
  params: number[];
  predict: (x: number) => number;
  inverse: (y: number) => number;
  /** Measured y − fitted y for each point used, in the order given. */
  residuals: number[];
  r2: number | null;
  /**
   * √(SSE / (n − p)): the scatter of the points about the curve, with the
   * fitted parameters taken off the count. Null when n ≤ p, where the curve
   * passes through every point whatever the scatter is.
   */
  rmse: number | null;
  /** Points used in the fit; replicates count one each. */
  n: number;
  /** Parameters fitted (p). */
  parameters: number;
  min: number;
  max: number;
  equation: string;
}
const parameterCount: Record<Model, number> = {
  linear: 2,
  origin: 1,
  exponential: 2,
  hill: 4,
  "hill-decreasing": 4,
};
function solve(a: number[][], b: number[]): number[] | null {
  const m = a.map((r, i) => [...r, b[i]]),
    n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let j = i + 1; j < n; j++)
      if (Math.abs(m[j][i]) > Math.abs(m[p][i])) p = j;
    if (Math.abs(m[p][i]) < 1e-18) return null;
    [m[i], m[p]] = [m[p], m[i]];
    const divisor = m[i][i];
    for (let k = i; k <= n; k++) m[i][k] /= divisor;
    for (let j = 0; j < n; j++)
      if (j !== i) {
        const f = m[j][i];
        for (let k = i; k <= n; k++) m[j][k] -= f * m[i][k];
      }
  }
  return m.map((r) => r[n]);
}
const logistic = (x: number) =>
  x > 40 ? 1 : x < -40 ? 0 : 1 / (1 + Math.exp(-x));
/**
 * Fits every included point as given. Points that share an x are replicates:
 * each one enters the fit, so the degrees of freedom count measurements, and
 * a mean per x is never substituted for them.
 */
export function fitCalibration(points: Point[], model: Model): Fit {
  // A model saved by a newer version must not be fitted as a straight line.
  if (!Object.hasOwn(parameterCount, model)) throw Error("Unknown fit model");
  const p = points.filter((v) => !v.excluded);
  if (p.some((v) => !Number.isFinite(v.x) || !Number.isFinite(v.y)))
    throw Error("Invalid standard row");
  const hill = model === "hill" || model === "hill-decreasing";
  // What identifies a curve is how many different x there are, not how many
  // times each was measured.
  if (new Set(p.map((v) => v.x)).size < (hill ? 5 : 2))
    throw Error(
      hill
        ? "Hill requires at least 5 distinct positive x values"
        : "At least 2 distinct standards required"
    );
  if (model === "exponential" && p.some((v) => v.y <= 0))
    throw Error("Exponential requires y > 0; explicitly exclude invalid rows");
  if (hill && p.some((v) => v.x <= 0)) throw Error("Hill requires x > 0");
  const mean = p.reduce((s, v) => s + v.y, 0) / p.length,
    sst = p.reduce((s, v) => s + (v.y - mean) ** 2, 0);
  if (sst < 1e-20)
    throw Error("Flat standards cannot identify this calibration");
  let params: number[],
    predict: (x: number) => number,
    inverse: (y: number) => number,
    equation: string;
  const fmt = (v: number) => Number(v.toPrecision(6));
  if (!hill) {
    const ys = p.map((v) => (model === "exponential" ? Math.log(v.y) : v.y)),
      xm = p.reduce((s, v) => s + v.x, 0) / p.length,
      ym = ys.reduce((s, v) => s + v, 0) / p.length;
    const xx = p.reduce(
      (s, v) => s + (model === "origin" ? v.x : v.x - xm) ** 2,
      0
    );
    if (xx === 0) throw Error("Singular standards");
    const a =
        p.reduce(
          (s, v, i) =>
            s +
            (model === "origin" ? v.x : v.x - xm) *
              (model === "origin" ? ys[i] : ys[i] - ym),
          0
        ) / xx,
      b = model === "origin" ? 0 : ym - a * xm;
    if (model === "exponential") {
      const c = Math.exp(b);
      params = [c, a];
      predict = (x) => c * Math.exp(a * x);
      inverse = (y) => (y > 0 && a !== 0 ? Math.log(y / c) / a : NaN);
      equation = `y = ${fmt(c)} · exp(${fmt(a)}x)`;
    } else {
      params = [a, b];
      predict = (x) => a * x + b;
      inverse = (y) => (a !== 0 ? (y - b) / a : NaN);
      // "y = 2x − 1", not "y = 2x + -1"; a line through the origin has no
      // intercept to print. An intercept that is only rounding residue of the
      // sums (−8.9e-16 beside y values near 5) is written as the zero it is.
      const shown =
        Math.abs(b) <= 1e-12 * Math.max(...p.map((v) => Math.abs(v.y)))
          ? 0
          : b;
      equation =
        model === "origin"
          ? `y = ${fmt(a)}x`
          : `y = ${fmt(a)}x ${shown < 0 ? "−" : "+"} ${fmt(Math.abs(shown))}`;
    }
  } else {
    // A falling curve in x is a rising one in −ln x, so one fit serves both:
    // the falling model only mirrors the x axis going in and K coming out.
    const direction = model === "hill" ? 1 : -1;
    if (
      direction *
        p.reduce(
          (sum, v) =>
            sum +
            (v.x - p.reduce((s, q) => s + q.x, 0) / p.length) * (v.y - mean),
          0
        ) <=
      0
    )
      throw Error(
        direction > 0
          ? "Standards do not describe an increasing Hill curve"
          : "Standards do not describe a decreasing Hill curve"
      );
    const lo = Math.min(...p.map((v) => v.y)),
      range = Math.max(...p.map((v) => v.y)) - lo;
    const normalized = p.map((v) => ({
      x: direction * Math.log(v.x),
      y: (v.y - lo) / range,
    }));
    const mid = normalized[Math.floor(p.length / 2)].x;
    const f = (q: number[], x: number) =>
      q[0] + Math.exp(q[1]) * logistic(Math.exp(q[3]) * (x - q[2]));
    const loss = (q: number[]) =>
      normalized.reduce((s, v) => s + (f(q, v.x) - v.y) ** 2, 0);
    let best: number[] | null = null,
      bestLoss = Infinity;
    for (const slope of [0.3, 1, 3])
      for (const k of [
        Math.min(...normalized.map((v) => v.x)),
        mid,
        Math.max(...normalized.map((v) => v.x)),
      ]) {
        let q = [-0.05, Math.log(1.1), k, Math.log(slope)],
          lambda = 0.001,
          converged = false;
        for (let iter = 0; iter < 300; iter++) {
          const a = Array.from({ length: 4 }, () => [0, 0, 0, 0]),
            b = [0, 0, 0, 0];
          for (const v of normalized) {
            const sig = logistic(Math.exp(q[3]) * (v.x - q[2])),
              span = Math.exp(q[1]),
              n = Math.exp(q[3]),
              d = [
                1,
                span * sig,
                -span * sig * (1 - sig) * n,
                span * sig * (1 - sig) * n * (v.x - q[2]),
              ],
              r = v.y - f(q, v.x);
            for (let i = 0; i < 4; i++) {
              b[i] += d[i] * r;
              for (let j = 0; j < 4; j++) a[i][j] += d[i] * d[j];
            }
          }
          if (Math.max(...b.map(Math.abs)) < 1e-10) {
            converged = true;
            break;
          }
          const step = solve(
            a.map((r, i) =>
              r.map((v, j) => v + (i === j ? lambda * (a[i][i] + 1e-8) : 0))
            ),
            b
          );
          if (!step) break;
          const next = q.map((v, i) => v + step[i]);
          next[1] = Math.max(-10, Math.min(10, next[1]));
          next[3] = Math.max(Math.log(0.01), Math.min(Math.log(100), next[3]));
          const old = loss(q),
            fresh = loss(next);
          if (fresh < old) {
            q = next;
            lambda = Math.max(1e-12, lambda / 3);
            if (old - fresh < 1e-13 || Math.max(...step.map(Math.abs)) < 1e-8) {
              converged = true;
              break;
            }
          } else lambda *= 10;
          if (lambda > 1e14) break;
        }
        const l = loss(q);
        if (converged && Number.isFinite(l) && l < bestLoss) {
          best = q;
          bestLoss = l;
        }
      }
    if (!best) throw Error("Hill fit did not converge");
    const bottom = lo + range * best[0],
      top = bottom + range * Math.exp(best[1]),
      K = Math.exp(direction * best[2]),
      n = Math.exp(best[3]);
    if (![bottom, top, K, n].every(Number.isFinite) || K <= 0 || n <= 0)
      throw Error("Unidentifiable Hill fit");
    params = [bottom, top, K, n];
    // "−5 + (100 + 5)", not "-5 + (100 − -5)".
    const from = `${bottom < 0 ? "−" : ""}${fmt(Math.abs(bottom))}`,
      span = `(${fmt(top)} ${bottom < 0 ? "+" : "−"} ${fmt(Math.abs(bottom))})`;
    if (direction > 0) {
      predict = (x) =>
        x >= 0
          ? bottom +
            (top - bottom) *
              (x === 0 ? 0 : logistic(n * (Math.log(x) - Math.log(K))))
          : NaN;
      inverse = (y) =>
        y > bottom && y < top ? K * ((y - bottom) / (top - y)) ** (1 / n) : NaN;
      equation = `y = ${from} + ${span} · x^${fmt(n)} / (${fmt(K)}^${fmt(
        n
      )} + x^${fmt(n)})`;
    } else {
      // 4PL as y = d + (a − d) / (1 + (x/c)^b): a = top, d = bottom, c = K, b = n.
      predict = (x) =>
        x >= 0
          ? bottom +
            (top - bottom) *
              (x === 0 ? 1 : logistic(n * (Math.log(K) - Math.log(x))))
          : NaN;
      inverse = (y) =>
        y > bottom && y < top ? K * ((top - y) / (y - bottom)) ** (1 / n) : NaN;
      equation = `y = ${from} + ${span} / (1 + (x / ${fmt(K)})^${fmt(n)})`;
    }
  }
  const residuals = p.map((v) => v.y - predict(v.x)),
    sse = residuals.reduce((s, v) => s + v * v, 0);
  if (!Number.isFinite(sse)) throw Error("Non-finite fit");
  const parameters = parameterCount[model];
  return {
    model,
    params,
    predict,
    inverse,
    residuals,
    r2: model === "origin" ? null : 1 - sse / sst,
    rmse: p.length > parameters ? Math.sqrt(sse / (p.length - parameters)) : null,
    n: p.length,
    parameters,
    min: Math.min(...p.map((v) => v.x)),
    max: Math.max(...p.map((v) => v.x)),
    equation,
  };
}

export interface ReplicateGroup {
  x: number;
  n: number;
  mean: number;
  /** Sample standard deviation (n − 1); null for a single measurement. */
  sd: number | null;
}
/**
 * The included points gathered by x, lowest x first. For showing how far
 * replicates spread; the fit itself uses the single points.
 */
export function replicateGroups(points: Point[]): ReplicateGroup[] {
  const groups = new Map<number, number[]>();
  for (const point of points) {
    if (
      point.excluded ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y)
    )
      continue;
    groups.set(point.x, [...(groups.get(point.x) ?? []), point.y]);
  }
  return [...groups]
    .sort((a, b) => a[0] - b[0])
    .map(([x, ys]) => {
      const mean = ys.reduce((s, y) => s + y, 0) / ys.length;
      return {
        x,
        n: ys.length,
        mean,
        sd:
          ys.length > 1
            ? Math.sqrt(
                ys.reduce((s, y) => s + (y - mean) ** 2, 0) / (ys.length - 1)
              )
            : null,
      };
    });
}

/* ---- Pasted tables ---- */

/** Which character marks the decimals of pasted figures. */
export type DecimalMark = "auto" | "," | ".";
/**
 * A pasted figure such as "1,234" reads as 1.234 or as 1234, and nothing else
 * in the paste says which. The caller asks instead of guessing: the two
 * readings differ a thousandfold.
 */
export class AmbiguousNumber extends Error {
  example: string;
  constructor(example: string) {
    super("Ambiguous number");
    this.name = "AmbiguousNumber";
    this.example = example;
  }
}
const shapes = {
  /** 0,5 · 12,25 — and 1,234, which is also the shape of a grouped thousand. */
  commaDecimal: /^[-+]?\d+,\d+$/,
  /** 1,234 · 1,234,567 */
  commaGroups: /^[-+]?[1-9]\d{0,2}(,\d{3})+$/,
  /** 1,234.5 */
  commaGroupsPeriod: /^[-+]?[1-9]\d{0,2}(,\d{3})+\.\d+$/,
  /** 0.5 · .5 · 1.5e3 — and 1.234 */
  periodDecimal: /^[-+]?(\d+\.\d*|\.\d+)(e[-+]?\d+)?$/i,
  /** 1.234 · 1.234.567 */
  periodGroups: /^[-+]?[1-9]\d{0,2}(\.\d{3})+$/,
  /** 1.234,5 */
  periodGroupsComma: /^[-+]?[1-9]\d{0,2}(\.\d{3})+,\d+$/,
  plain: /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i,
};
const count = (text: string, mark: string) => text.split(mark).length - 1;
/** What a cell says about the paste's decimal mark, if anything. */
function evidence(cell: string): "," | "." | "ambiguous" | null {
  if (shapes.periodGroupsComma.test(cell)) return ",";
  if (shapes.commaGroupsPeriod.test(cell)) return ".";
  if (shapes.commaGroups.test(cell))
    return count(cell, ",") > 1 ? "." : "ambiguous";
  if (shapes.commaDecimal.test(cell)) return ",";
  if (shapes.periodGroups.test(cell))
    return count(cell, ".") > 1 ? "," : "ambiguous";
  if (shapes.periodDecimal.test(cell)) return ".";
  return null;
}
/**
 * Rewrites pasted figures with a period for the decimals and no grouping, so
 * they read the same on every device. A paste comes from one sheet, so it is
 * taken to use one decimal mark throughout:
 *
 * - "0,5", "12,25" and "1.234,5" can only be decimal commas; "0.5", "1,234.5"
 *   and "1,234,567" can only be decimal periods.
 * - "1,234" or "1.234" (one mark, three digits after it) is read the way the
 *   rest of the paste reads: a decimal comma elsewhere makes "1,234" 1.234 and
 *   "1.234" 1234; a decimal period elsewhere makes "1,234" 1234.
 * - With no such evidence "1.234" is 1.234, the notation of the app itself,
 *   and "1,234" is not guessed: `AmbiguousNumber` is thrown, and the caller
 *   reads again with the mark the user picks.
 *
 * Cells that are not figures are returned as typed.
 */
function readFigures(cells: string[], decimal: DecimalMark): string[] {
  const found = cells.map(evidence),
    ambiguous = cells.filter((_, index) => found[index] === "ambiguous");
  let mark: "," | "." | null = decimal === "auto" ? null : decimal;
  if (!mark && ambiguous.length) {
    const comma = found.includes(","),
      period = found.includes(".");
    if (comma !== period) mark = comma ? "," : ".";
    else if (!comma && ambiguous.every((cell) => !cell.includes(",")))
      mark = ".";
    else
      throw new AmbiguousNumber(
        ambiguous.find((cell) => cell.includes(",")) ?? ambiguous[0]
      );
  }
  return cells.map((cell, index) => {
    if (shapes.periodGroupsComma.test(cell))
      return cell.replaceAll(".", "").replace(",", ".");
    if (shapes.commaGroupsPeriod.test(cell)) return cell.replaceAll(",", "");
    if (found[index] === "ambiguous")
      return cell.includes(",")
        ? mark === ","
          ? cell.replace(",", ".")
          : cell.replace(",", "")
        : mark === ","
        ? cell.replace(".", "")
        : cell;
    if (shapes.commaGroups.test(cell)) return cell.replaceAll(",", "");
    if (shapes.commaDecimal.test(cell)) return cell.replace(",", ".");
    if (shapes.periodGroups.test(cell)) return cell.replaceAll(".", "");
    return cell;
  });
}
/** One line into cells; a cell in double quotes may hold the delimiter. */
function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "",
    quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && !cell.trim()) {
      quoted = true;
      cell = "";
    } else if (c === delimiter) {
      cells.push(cell);
      cell = "";
    } else cell += c;
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}
const linesOf = (text: string) =>
  text
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim());
/**
 * Pasted or imported standards as rows of [x, y], figures rewritten by
 * `readFigures`; a first row of column names passes through as typed.
 *
 * The columns are split by tab if the text has one, else by semicolon if it
 * has one, and in both cases a comma inside a cell belongs to the figure
 * ("0,5" is 0.5). Without either, a comma that splits every line in two is
 * the separator, so "0,5" alone is x 0 and y 5; failing that the columns are
 * split by spaces ("0,5 1,2" is 0.5 and 1.2).
 */
export function parseStandardRows(
  text: string,
  decimal: DecimalMark = "auto"
): string[][] {
  const lines = linesOf(text);
  let rows: string[][];
  if (text.includes("\t")) rows = lines.map((line) => splitLine(line, "\t"));
  else if (text.includes(";"))
    rows = lines.map((line) => splitLine(line, ";"));
  else {
    const byComma = lines.map((line) => splitLine(line, ","));
    rows =
      text.includes(",") && byComma.every((row) => row.length === 2)
        ? byComma
        : lines.map((line) => line.trim().split(/\s+/));
  }
  if (!rows.length || rows.some((row) => row.length !== 2))
    throw Error("Exactly two columns required");
  const figures = readFigures(rows.flat(), decimal);
  return rows.map((_, index) => [figures[index * 2], figures[index * 2 + 1]]);
}
const isFigure = (text: string) =>
  shapes.plain.test(text) ||
  shapes.commaDecimal.test(text) ||
  shapes.commaGroups.test(text) ||
  shapes.commaGroupsPeriod.test(text) ||
  shapes.periodGroups.test(text) ||
  shapes.periodGroupsComma.test(text);
/**
 * Pasted samples, one per line: a value alone, or a name and a value. The
 * name is "" where the line gives none.
 *
 * Tab, else semicolon, separates the name from the value. Without either, a
 * line that is a figure is a value ("1,5" is 1.5, not a sample named 1), and
 * any other line is split at the first comma that leaves a figure after it
 * ("S1, 0.52", "S1,0,52"). Spaces never split a line: names contain them.
 * A value that is not a figure is kept as typed for the screen to flag.
 */
export function parseSampleRows(
  text: string,
  decimal: DecimalMark = "auto"
): { name: string; input: string }[] {
  const lines = linesOf(text);
  const delimiter = text.includes("\t") ? "\t" : text.includes(";") ? ";" : "";
  const rows = lines.map((line) => {
    if (delimiter) return splitLine(line, delimiter);
    const whole = line.trim();
    if (isFigure(whole)) return [whole];
    for (const comma of whole.matchAll(/\s*,\s*/g)) {
      const value = whole.slice(comma.index + comma[0].length);
      if (isFigure(value)) return [whole.slice(0, comma.index).trim(), value];
    }
    return [whole];
  });
  if (!rows.length || rows.some((row) => row.length > 2))
    throw Error("Sample rows need a value, or a name and a value");
  const figures = readFigures(
    rows.map((row) => row[row.length - 1]),
    decimal
  );
  return rows.map((row, index) => ({
    name: row.length === 2 ? row[0] : "",
    input: figures[index],
  }));
}
