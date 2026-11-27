/**
 * Gel and blot arithmetic with no UI: dividing a region into lanes, and
 * estimating the size of a band from the ladder bands beside it.
 *
 * Band brightness (densitometry) and automatic lane or band detection are
 * deliberately not here: the user marks every lane and band by hand.
 */
import {
  fromDisplay,
  toDisplay,
  type Shape,
  type View,
  type XY,
} from "./geometry";

/** `count` equal slices of the span between two edges, first edge first. */
export function divideLanes(
  from: number,
  to: number,
  count: number
): { from: number; to: number }[] {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from === to
  )
    return [];
  const width = (to - from) / count;
  return Array.from({ length: count }, (_, index) => ({
    from: from + index * width,
    // The last slice ends on the edge itself, not on a rounded sum.
    to: index === count - 1 ? to : from + (index + 1) * width,
  }));
}
/**
 * The rectangle spanned by two corners (source image coordinates) as `count`
 * equal lanes, each given by two corners. Lanes run left to right as the
 * picture is displayed, so lane 1 is the leftmost one on screen even when the
 * image is turned or mirrored.
 */
export function splitRegion(
  a: XY,
  b: XY,
  count: number,
  view: View
): [XY, XY][] {
  const p = toDisplay(a, view),
    q = toDisplay(b, view),
    top = Math.min(p.y, q.y),
    bottom = Math.max(p.y, q.y);
  return divideLanes(Math.min(p.x, q.x), Math.max(p.x, q.x), count).map(
    ({ from, to }) => [
      fromDisplay({ x: from, y: top }, view),
      fromDisplay({ x: to, y: bottom }, view),
    ]
  );
}

export type LadderBand = {
  /** How far the band ran, in pixels along the direction of migration. */
  position: number;
  /** Its known size (bp, nt, kDa …). */
  size: number;
};
export type SizeEstimate =
  | { ok: true; size: number; extrapolated: boolean }
  | {
      ok: false;
      /**
       * `few`: fewer than two ladder bands with a size.
       * `overlap`: two ladder bands of different size at the same place.
       * `order`: size does not fall (or rise) steadily with distance, so the
       * ladder was marked or labelled out of order.
       */
      reason: "few" | "overlap" | "order";
    };
// Bands closer than this cannot be told apart on the image.
const SAME_PLACE = 0.5;
/**
 * The size of a band from how far it ran, read off the ladder: between the two
 * ladder bands on either side of it, log10(size) is taken to change in a
 * straight line with distance. Outside the ladder the nearest two bands are
 * extended and the result is marked `extrapolated`, since the relation bends
 * there and the figure is only a rough guide.
 *
 * Only differences in position matter, so the distance may be measured from
 * any fixed line across the gel (the wells, or the top of the picture).
 */
export function estimateSize(
  ladder: readonly LadderBand[],
  position: number
): SizeEstimate {
  const bands = ladder
    .filter(
      (band) =>
        Number.isFinite(band.position) &&
        Number.isFinite(band.size) &&
        band.size > 0
    )
    .sort((a, b) => a.position - b.position)
    // The same band marked twice (a ladder loaded twice) is one reference.
    .filter(
      (band, index, all) =>
        index === 0 ||
        band.size !== all[index - 1].size ||
        band.position - all[index - 1].position >= SAME_PLACE
    );
  if (bands.length < 2) return { ok: false, reason: "few" };
  let direction = 0;
  for (let index = 1; index < bands.length; index++) {
    const before = bands[index - 1],
      band = bands[index];
    if (band.position - before.position < SAME_PLACE)
      return { ok: false, reason: "overlap" };
    const step = Math.sign(band.size - before.size);
    if (!step || (direction && step !== direction))
      return { ok: false, reason: "order" };
    direction = step;
  }
  const first = bands[0],
    last = bands[bands.length - 1],
    beyond = bands.findIndex((band) => band.position >= position),
    upper = beyond === -1 ? bands.length - 1 : Math.max(1, beyond),
    a = bands[upper - 1],
    b = bands[upper],
    log =
      Math.log10(a.size) +
      ((position - a.position) / (b.position - a.position)) *
        (Math.log10(b.size) - Math.log10(a.size));
  return {
    ok: true,
    size: 10 ** log,
    extrapolated: position < first.position || position > last.position,
  };
}
/**
 * An estimate as it should be quoted: three significant figures between
 * ladder bands, two beyond them. The marks are placed by eye, so more digits
 * would claim a precision the reading does not have.
 */
export function roundEstimate(size: number, extrapolated: boolean) {
  return Number(size.toPrecision(extrapolated ? 2 : 3));
}

type Span = { left: number; right: number };
/**
 * Bands sorted into columns: bands whose horizontal extents overlap run in the
 * same lane. This is what tells two ladders on one gel apart without relying
 * on lane rectangles having been drawn around them.
 */
export function groupColumns<T extends Span>(bands: readonly T[]): T[][] {
  const groups: { right: number; bands: T[] }[] = [];
  for (const band of [...bands].sort((a, b) => a.left - b.left)) {
    const current = groups[groups.length - 1];
    if (current && band.left <= current.right) {
      current.bands.push(band);
      current.right = Math.max(current.right, band.right);
    } else groups.push({ right: band.right, bands: [band] });
  }
  return groups.map((group) => group.bands);
}
/** Index of the column nearest to a band horizontally; −1 when there is none. */
export function nearestColumn(columns: readonly Span[][], band: Span) {
  const centre = (band.left + band.right) / 2;
  let best = -1,
    gap = Infinity;
  columns.forEach((column, index) => {
    const left = Math.min(...column.map((entry) => entry.left)),
      right = Math.max(...column.map((entry) => entry.right)),
      distance = centre < left ? left - centre : centre > right ? centre - right : 0;
    if (distance < gap) {
      gap = distance;
      best = index;
    }
  });
  return best;
}

export type GelLane = {
  id: string;
  name: string;
  /** Left edge as displayed, for ordering lanes the way they are seen. */
  left: number;
};
export type GelBand = Span & {
  id: string;
  name: string;
  /** Id of the lane whose rectangle holds the band's centre; "" for none. */
  lane: string;
  /**
   * Distance from the top edge of the whole picture as displayed, in source
   * pixels. Cropping does not move it.
   */
  position: number;
  /** A ladder band's known size; null for a sample band. */
  known: number | null;
  /** A sample band's estimate, or why there is none; null for a ladder band. */
  estimate: SizeEstimate | null;
  /** Which of `ladders` the band belongs to or was read against; −1 for none. */
  ladder: number;
};
export type GelReading = {
  lanes: GelLane[];
  /** In the order of the shapes they came from. */
  bands: GelBand[];
  /** Each ladder's bands from the top of the picture down. */
  ladders: GelBand[][];
};
/**
 * Reads a gel's annotations: rectangles are lanes, lines are bands, and a band
 * with a `size` is a ladder band. Every other band gets a size estimated from
 * the ladder nearest to it. Migration is taken to run down the picture as it
 * is displayed, so an image photographed sideways is turned first.
 */
export function readGel(
  shapes: readonly Shape[],
  image: {
    width: number;
    height: number;
    rotation: number;
    flipX: boolean;
    flipY: boolean;
  }
): GelReading {
  const view: View = {
    rotation: image.rotation,
    flipX: image.flipX,
    flipY: image.flipY,
    crop: { x: 0, y: 0, width: image.width, height: image.height },
  };
  const boxes = shapes
    .filter((shape) => shape.kind === "rectangle" && shape.points.length > 1)
    .map((shape) => {
      const [a, b] = shape.points;
      return {
        id: shape.id,
        name: shape.name,
        x0: Math.min(a.x, b.x),
        x1: Math.max(a.x, b.x),
        y0: Math.min(a.y, b.y),
        y1: Math.max(a.y, b.y),
        left: Math.min(toDisplay(a, view).x, toDisplay(b, view).x),
      };
    });
  const bands: GelBand[] = shapes
    .filter((shape) => shape.kind === "line" && shape.points.length > 0)
    .map((shape) => {
      const a = shape.points[0],
        b = shape.points[1] ?? a,
        middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        p = toDisplay(a, view),
        q = toDisplay(b, view),
        // The smallest rectangle around the band's centre is its lane.
        lane = boxes
          .filter(
            (box) =>
              middle.x >= box.x0 &&
              middle.x <= box.x1 &&
              middle.y >= box.y0 &&
              middle.y <= box.y1
          )
          .sort(
            (m, n) =>
              (m.x1 - m.x0) * (m.y1 - m.y0) - (n.x1 - n.x0) * (n.y1 - n.y0)
          )[0];
      return {
        id: shape.id,
        name: shape.name,
        lane: lane?.id ?? "",
        left: Math.min(p.x, q.x),
        right: Math.max(p.x, q.x),
        position: (p.y + q.y) / 2,
        known:
          typeof shape.size === "number" &&
          Number.isFinite(shape.size) &&
          shape.size > 0
            ? shape.size
            : null,
        estimate: null,
        ladder: -1,
      };
    })
    .filter(
      (band) => Number.isFinite(band.position) && Number.isFinite(band.left)
    );
  const ladders = groupColumns(bands.filter((band) => band.known !== null)).map(
    (column) => [...column].sort((a, b) => a.position - b.position)
  );
  ladders.forEach((column, index) =>
    column.forEach((band) => {
      band.ladder = index;
    })
  );
  const references = ladders.map((column) =>
    column.map((band) => ({ position: band.position, size: band.known ?? 0 }))
  );
  // A band is read against the nearest ladder that can be read at all: one
  // sized band standing alone (a control of known size, say) must not take the
  // bands around it away from the real ladder. Only when no ladder is usable
  // does the nearest one supply the reason.
  const usable = references
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => estimateSize(column, column[0].position).ok);
  for (const band of bands) {
    if (band.known !== null) continue;
    const choice = usable.length
      ? usable[
          nearestColumn(
            usable.map(({ index }) => ladders[index]),
            band
          )
        ].index
      : nearestColumn(ladders, band);
    band.ladder = choice;
    band.estimate = estimateSize(references[choice] ?? [], band.position);
  }
  return {
    lanes: boxes
      .map(({ id, name, left }) => ({ id, name, left }))
      .sort((a, b) => a.left - b.left),
    bands,
    ladders,
  };
}
