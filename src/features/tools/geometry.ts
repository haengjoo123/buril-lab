export type XY = { x: number; y: number };
export type Shape = {
  id: string;
  kind: "line" | "rectangle" | "ellipse" | "freehand" | "color" | "text";
  name: string;
  color: string;
  points: XY[];
  fraction?: number;
  areaFraction?: number;
  tolerance?: number;
  text?: string;
};
export function distance(a: XY, b: XY) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
/**
 * Where each ladder band sits along a lane, from 0 (top) to 1 (bottom): the
 * largest band at the top and the rest spaced by log size, as in the ladder
 * tool's own diagram. It is a starting layout to drag onto the image, not a
 * prediction of migration.
 */
export function ladderPositions(sizes: (number | null)[]): number[] {
  const logs = sizes.map((size) =>
    size != null && Number.isFinite(size) && size > 0 ? Math.log(size) : null
  );
  const known = logs.filter((value): value is number => value !== null);
  const top = Math.max(...known),
    bottom = Math.min(...known);
  return logs.map((value, index) =>
    value === null || top === bottom
      ? sizes.length > 1
        ? index / (sizes.length - 1)
        : 0.5
      : (top - value) / (top - bottom)
  );
}
export function measure(
  shape: Shape,
  scale: number
): { length?: number; width?: number; height?: number; area?: number } {
  // A label and a colour match have no outline to measure.
  if (shape.kind === "text" || shape.kind === "color") return {};
  const a = shape.points[0] ?? { x: 0, y: 0 },
    b = shape.points[1] ?? a,
    w = Math.abs(b.x - a.x) * scale,
    h = Math.abs(b.y - a.y) * scale;
  if (shape.kind === "line") return { length: distance(a, b) * scale };
  if (shape.kind === "rectangle") return { width: w, height: h, area: w * h };
  if (shape.kind === "ellipse")
    return { width: w, height: h, area: (Math.PI * w * h) / 4 };
  let area = 0,
    perimeter = 0;
  shape.points.forEach((p, i) => {
    const q = shape.points[(i + 1) % shape.points.length];
    area += p.x * q.y - q.x * p.y;
    perimeter += distance(p, q);
  });
  return { area: (Math.abs(area) / 2) * scale ** 2, length: perimeter * scale };
}
export function colorCoverage(
  rgba: Uint8ClampedArray,
  rgb: number[],
  tolerance: number
) {
  let matched = 0,
    valid = 0;
  const threshold = (Math.max(0, Math.min(100, tolerance)) / 100) ** 2 * 195075;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    valid++;
    if (
      (rgba[i] - rgb[0]) ** 2 +
        (rgba[i + 1] - rgb[1]) ** 2 +
        (rgba[i + 2] - rgb[2]) ** 2 <=
      threshold
    )
      matched++;
  }
  return {
    fraction: valid ? matched / valid : 0,
    areaFraction: rgba.length ? matched / (rgba.length / 4) : 0,
  };
}
export function colorFraction(
  rgba: Uint8ClampedArray,
  rgb: number[],
  tolerance: number
) {
  return colorCoverage(rgba, rgb, tolerance).fraction;
}
