export type Point = { x: number; y: number; excluded?: boolean };
export type Model = "linear" | "origin" | "exponential" | "hill";
export interface Fit {
  model: Model;
  params: number[];
  predict: (x: number) => number;
  inverse: (y: number) => number;
  residuals: number[];
  r2: number | null;
  rmse: number;
  min: number;
  max: number;
  equation: string;
}
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
export function fitCalibration(points: Point[], model: Model): Fit {
  const p = points.filter((v) => !v.excluded);
  if (p.some((v) => !Number.isFinite(v.x) || !Number.isFinite(v.y)))
    throw Error("Invalid standard row");
  if (new Set(p.map((v) => v.x)).size < p.length)
    throw Error("Duplicate x values: combine replicates first");
  if (p.length < (model === "hill" ? 5 : 2))
    throw Error(
      model === "hill"
        ? "Hill requires at least 5 distinct positive x values"
        : "At least 2 distinct standards required"
    );
  if (model === "exponential" && p.some((v) => v.y <= 0))
    throw Error("Exponential requires y > 0; explicitly exclude invalid rows");
  if (model === "hill" && p.some((v) => v.x <= 0))
    throw Error("Hill requires x > 0");
  const mean = p.reduce((s, v) => s + v.y, 0) / p.length,
    sst = p.reduce((s, v) => s + (v.y - mean) ** 2, 0);
  if (sst < 1e-20)
    throw Error("Flat standards cannot identify this calibration");
  let params: number[],
    predict: (x: number) => number,
    inverse: (y: number) => number,
    equation: string;
  const fmt = (v: number) => Number(v.toPrecision(6));
  if (model !== "hill") {
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
      equation = `y = ${fmt(a)}x + ${fmt(b)}`;
    }
  } else {
    if (
      p.reduce(
        (sum, v) =>
          sum +
          (v.x - p.reduce((s, q) => s + q.x, 0) / p.length) * (v.y - mean),
        0
      ) <= 0
    )
      throw Error("Standards do not describe an increasing Hill curve");
    const lo = Math.min(...p.map((v) => v.y)),
      range = Math.max(...p.map((v) => v.y)) - lo;
    const normalized = p.map((v) => ({
      x: Math.log(v.x),
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
      K = Math.exp(best[2]),
      n = Math.exp(best[3]);
    if (![bottom, top, K, n].every(Number.isFinite) || K <= 0 || n <= 0)
      throw Error("Unidentifiable Hill fit");
    params = [bottom, top, K, n];
    predict = (x) =>
      x >= 0
        ? bottom +
          (top - bottom) *
            (x === 0 ? 0 : logistic(n * (Math.log(x) - Math.log(K))))
        : NaN;
    inverse = (y) =>
      y > bottom && y < top ? K * ((y - bottom) / (top - y)) ** (1 / n) : NaN;
    equation = `y = ${fmt(bottom)} + (${fmt(top)} − ${fmt(bottom)}) · x^${fmt(
      n
    )} / (${fmt(K)}^${fmt(n)} + x^${fmt(n)})`;
  }
  const residuals = p.map((v) => v.y - predict(v.x)),
    sse = residuals.reduce((s, v) => s + v * v, 0);
  if (!Number.isFinite(sse)) throw Error("Non-finite fit");
  return {
    model,
    params,
    predict,
    inverse,
    residuals,
    r2: model === "origin" ? null : 1 - sse / sst,
    rmse: Math.sqrt(sse / p.length),
    min: Math.min(...p.map((v) => v.x)),
    max: Math.max(...p.map((v) => v.x)),
    equation,
  };
}
