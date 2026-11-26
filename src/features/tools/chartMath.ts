/** Pure geometry and scale helpers for the tool charts. */

/**
 * Round tick values covering [min, max]: steps of 1, 2 or 5 × 10ⁿ, about
 * `target` of them. The first and last tick enclose the data.
 */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.5 : 1;
    min -= pad;
    max += pad;
  }
  if (min > max) [min, max] = [max, min];
  const rough = (max - min) / Math.max(1, target),
    power = 10 ** Math.floor(Math.log10(rough)),
    unit = rough / power,
    step = (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
  const first = Math.floor(min / step) * step,
    last = Math.ceil(max / step) * step,
    ticks: number[] = [];
  // Multiply rather than accumulate, so 0.1-wide steps do not drift.
  for (let i = 0; first + i * step <= last + step / 2; i++)
    ticks.push(Number((first + i * step).toPrecision(12)));
  return ticks;
}
/** Maps a value in [d0, d1] to [r0, r1]; a flat domain maps to the middle. */
export function scale(d0: number, d1: number, r0: number, r1: number) {
  return (value: number) =>
    d1 === d0 ? (r0 + r1) / 2 : r0 + ((value - d0) / (d1 - d0)) * (r1 - r0);
}
/** Each part's share of the total. Zero and negative parts take no share. */
export function shares(values: readonly number[]): number[] {
  const positive = values.map((value) =>
      Number.isFinite(value) && value > 0 ? value : 0
    ),
    total = positive.reduce((sum, value) => sum + value, 0);
  return positive.map((value) => (total > 0 ? value / total : 0));
}
/**
 * Keeps the largest `limit − 1` parts and folds the rest into one "other"
 * part, so a part-to-whole bar never needs more colours than can be told
 * apart. Order of the kept parts is unchanged.
 */
export function foldParts<T extends { value: number }>(
  parts: readonly T[],
  limit: number,
  other: (value: number, count: number) => T
): T[] {
  const shown = parts.filter((part) => part.value > 0);
  if (shown.length <= limit) return [...shown];
  const keep = new Set(
    [...shown].sort((a, b) => b.value - a.value).slice(0, limit - 1)
  );
  const rest = shown.filter((part) => !keep.has(part));
  return [
    ...shown.filter((part) => keep.has(part)),
    other(
      rest.reduce((sum, part) => sum + part.value, 0),
      rest.length
    ),
  ];
}
export const HEAT_STEPS = 7;
/**
 * Step (0 … HEAT_STEPS − 1) of the one-hue ramp for a value within
 * [min, max]. Values outside the range clamp; a flat range uses the middle.
 */
export function heatStep(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return null;
  if (max === min) return Math.floor(HEAT_STEPS / 2);
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return Math.min(HEAT_STEPS - 1, Math.floor(t * HEAT_STEPS));
}
/** Index of the point whose x is nearest to `x`. */
export function nearestIndex(xs: readonly number[], x: number) {
  let best = -1,
    distance = Infinity;
  xs.forEach((value, index) => {
    const d = Math.abs(value - x);
    if (d < distance) {
      distance = d;
      best = index;
    }
  });
  return best;
}
