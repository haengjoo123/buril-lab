export type XY = { x: number; y: number };
export type Shape = {
  id: string;
  /**
   * `angle` holds three points (end, vertex, end) and `count` one point per
   * counted object. Both were added after the first release: builds of the app
   * from before then draw only their label, so nothing else may depend on a
   * reader knowing them.
   */
  kind:
    | "line"
    | "rectangle"
    | "ellipse"
    | "freehand"
    | "color"
    | "text"
    | "angle"
    | "count";
  name: string;
  color: string;
  points: XY[];
  fraction?: number;
  areaFraction?: number;
  tolerance?: number;
  text?: string;
  /**
   * Gel only: the known size of a ladder band, in the document's size unit.
   * A band without one is a sample band whose size is estimated.
   */
  size?: number | null;
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
/**
 * The angle at `vertex` between the arms to `a` and `b`, in degrees from 0 to
 * 180. Null while an arm has no length. Rotating, mirroring or uniformly
 * scaling the image does not change it, so it needs no calibration.
 */
export function angleDegrees(a: XY, vertex: XY, b: XY): number | null {
  const ux = a.x - vertex.x,
    uy = a.y - vertex.y,
    vx = b.x - vertex.x,
    vy = b.y - vertex.y;
  if (!Math.hypot(ux, uy) || !Math.hypot(vx, vy)) return null;
  // atan2 of the cross and dot products stays accurate near 0° and 180°,
  // where acos of a rounded cosine does not.
  return (
    (Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy) * 180) / Math.PI
  );
}
export function measure(
  shape: Shape,
  scale: number
): {
  length?: number;
  width?: number;
  height?: number;
  area?: number;
  angle?: number;
  count?: number;
} {
  // A label and a colour match have no outline to measure.
  if (shape.kind === "text" || shape.kind === "color") return {};
  if (shape.kind === "count") return { count: shape.points.length };
  if (shape.kind === "angle") {
    const [first, vertex, last] = shape.points,
      angle =
        first && vertex && last ? angleDegrees(first, vertex, last) : null;
    return angle == null ? {} : { angle };
  }
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
/**
 * Count, mean and sample standard deviation (n − 1) of a set of measurements.
 * The deviation is null for fewer than two values: one value has no spread.
 * Values that are not finite are left out.
 */
export function summarize(
  values: readonly number[]
): { n: number; mean: number; sd: number | null } | null {
  const finite = values.filter((value) => Number.isFinite(value)),
    n = finite.length;
  if (!n) return null;
  const mean = finite.reduce((sum, value) => sum + value, 0) / n;
  return {
    n,
    mean,
    sd:
      n < 2
        ? null
        : Math.sqrt(
            finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
              (n - 1)
          ),
  };
}
/** How the image is shown: quarter turns, mirroring and the cropped part. */
export type View = {
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  crop: { x: number; y: number; width: number; height: number };
};
// Quarter turns only, so the sine and cosine are exact.
const turn = (rotation: number) => {
  const quarter = ((Math.round(rotation / 90) % 4) + 4) % 4;
  return { cos: [1, 0, -1, 0][quarter], sin: [0, 1, 0, -1][quarter] };
};
const displaySize = (view: View) =>
  turn(view.rotation).sin
    ? { width: view.crop.height, height: view.crop.width }
    : { width: view.crop.width, height: view.crop.height };
/**
 * A point of the source image in the coordinates of the picture as displayed:
 * x from its left edge, y from its top edge. This is the editor's own SVG
 * transform (mirror, then turn about the centre of the crop) as arithmetic.
 */
export function toDisplay(p: XY, view: View): XY {
  const { cos, sin } = turn(view.rotation),
    size = displaySize(view),
    u = (p.x - view.crop.x - view.crop.width / 2) * (view.flipX ? -1 : 1),
    v = (p.y - view.crop.y - view.crop.height / 2) * (view.flipY ? -1 : 1);
  return {
    x: u * cos - v * sin + size.width / 2,
    y: u * sin + v * cos + size.height / 2,
  };
}
/** The inverse of `toDisplay`. */
export function fromDisplay(p: XY, view: View): XY {
  const { cos, sin } = turn(view.rotation),
    size = displaySize(view),
    x = p.x - size.width / 2,
    y = p.y - size.height / 2;
  return {
    x:
      (x * cos + y * sin) * (view.flipX ? -1 : 1) +
      view.crop.x +
      view.crop.width / 2,
    y:
      (-x * sin + y * cos) * (view.flipY ? -1 : 1) +
      view.crop.y +
      view.crop.height / 2,
  };
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
