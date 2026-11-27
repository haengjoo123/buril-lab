import { describe, it, expect } from "vitest";
import {
  divideLanes,
  splitRegion,
  estimateSize,
  roundEstimate,
  groupColumns,
  nearestColumn,
  readGel,
} from "./gel";
import type { Shape, View } from "./geometry";

const size = (ladder: [number, number][], position: number) => {
  const result = estimateSize(
    ladder.map(([bandSize, bandPosition]) => ({
      size: bandSize,
      position: bandPosition,
    })),
    position
  );
  if (!result.ok) throw Error(result.reason);
  return result;
};
const reason = (ladder: [number, number][], position = 0) => {
  const result = estimateSize(
    ladder.map(([bandSize, bandPosition]) => ({
      size: bandSize,
      position: bandPosition,
    })),
    position
  );
  return result.ok ? "ok" : result.reason;
};

describe("band size from a ladder", () => {
  // Every expected value below was worked out by hand from
  //   log10(size) = log10(s1) + (d − d1) / (d2 − d1) × (log10(s2) − log10(s1))
  // for the two ladder bands (s1 at d1, s2 at d2) on either side of the band.
  it("interpolates log size in a straight line between two ladder bands", () => {
    // 1000 bp at 100 px, 100 bp at 300 px: one decade over 200 px.
    const ladder: [number, number][] = [
      [1000, 100],
      [100, 300],
    ];
    // 200 px is halfway: log10 = (3 + 2) / 2 = 2.5 → 10^2.5 = √100000 = 316.2278.
    expect(size(ladder, 200).size).toBeCloseTo(316.2278, 3);
    expect(size(ladder, 200).extrapolated).toBe(false);
    // 150 px is a quarter of the way: log10 = 3 − 0.25 = 2.75
    // → 1000 / 10^0.25 = 1000 / 1.778279 = 562.3413.
    expect(size(ladder, 150).size).toBeCloseTo(562.3413, 3);
    // On a ladder band the answer is that band, and it is not extrapolated.
    expect(size(ladder, 100)).toEqual({
      ok: true,
      size: 1000,
      extrapolated: false,
    });
    expect(size(ladder, 300).size).toBeCloseTo(100, 9);
    expect(size(ladder, 300).extrapolated).toBe(false);
  });
  it("works for sizes that are not powers of ten", () => {
    // 500 bp at 120 px, 200 bp at 260 px; a band at 155 px is 35 / 140 = 0.25
    // of the way: 500 × (200 / 500)^0.25 = 500 × 0.4^0.25.
    // 0.4^0.5 = 0.6324555, and its square root is 0.7952707 → 397.635 bp.
    expect(
      size(
        [
          [500, 120],
          [200, 260],
        ],
        155
      ).size
    ).toBeCloseTo(397.635, 2);
    // Protein: 75 kDa at 80 px, 50 kDa at 140 px; a band at 100 px is
    // 20 / 60 = 1/3 of the way: 75 × (50 / 75)^(1/3) = 75 × 0.8735805 = 65.5185.
    expect(
      size(
        [
          [75, 80],
          [50, 140],
        ],
        100
      ).size
    ).toBeCloseTo(65.5185, 3);
  });
  it("uses the two neighbouring bands, not one line through the whole ladder", () => {
    // The spacing differs between the two segments: a decade over 100 px,
    // then a decade over 200 px.
    const ladder: [number, number][] = [
      [1000, 150],
      [10000, 50],
      [100, 350],
    ];
    // 100 px: halfway between 10000 (50 px) and 1000 (150 px)
    // → 10^3.5 = 3162.278.
    expect(size(ladder, 100).size).toBeCloseTo(3162.278, 2);
    // 250 px: halfway between 1000 (150 px) and 100 (350 px) → 10^2.5 = 316.2278.
    expect(size(ladder, 250).size).toBeCloseTo(316.2278, 3);
  });
  it("extends the nearest two bands outside the ladder and says so", () => {
    const ladder: [number, number][] = [
      [10000, 50],
      [1000, 150],
      [100, 350],
    ];
    // Past the last band: 1000 (150 px) and 100 (350 px) fall one decade per
    // 200 px, so 50 px further is log10 = 2 − 50 / 200 = 1.75 → 56.2341.
    const below = size(ladder, 400);
    expect(below.size).toBeCloseTo(56.2341, 3);
    expect(below.extrapolated).toBe(true);
    // Before the first band: 10000 (50 px) and 1000 (150 px) fall one decade
    // per 100 px, so 50 px earlier is log10 = 4 + 0.5 = 4.5 → 31622.78.
    const above = size(ladder, 0);
    expect(above.size).toBeCloseTo(31622.78, 1);
    expect(above.extrapolated).toBe(true);
  });
  it("does not depend on where the distance is measured from, or in which direction", () => {
    // The same gel photographed upside down: positions run the other way.
    // 100 bp at 100 px, 1000 bp at 300 px; 200 px is still halfway → 316.2278.
    expect(
      size(
        [
          [100, 100],
          [1000, 300],
        ],
        200
      ).size
    ).toBeCloseTo(316.2278, 3);
    // Shifting every position by the same amount changes nothing.
    expect(
      size(
        [
          [1000, 1100],
          [100, 1300],
        ],
        1150
      ).size
    ).toBeCloseTo(562.3413, 3);
  });
  it("gives no estimate, and the reason, when the ladder cannot be read", () => {
    expect(reason([])).toBe("few");
    expect(reason([[1000, 100]])).toBe("few");
    // A size of zero, a negative size or a missing position is not a band.
    expect(
      reason([
        [1000, 100],
        [0, 200],
        [-5, 300],
        [100, NaN],
      ])
    ).toBe("few");
    // Two different sizes at one place: the slope between them is undefined.
    expect(
      reason([
        [1000, 100],
        [500, 100],
        [100, 300],
      ])
    ).toBe("overlap");
    // Size must fall (or rise) all the way down the lane.
    expect(
      reason([
        [1000, 100],
        [100, 200],
        [500, 300],
      ])
    ).toBe("order");
    // The same size at two different places is out of order as well.
    expect(
      reason([
        [1000, 100],
        [1000, 200],
        [100, 300],
      ])
    ).toBe("order");
  });
  it("reads a ladder marked twice in the same place as one ladder", () => {
    const ladder: [number, number][] = [
      [1000, 100],
      [100, 300],
      [1000, 100],
      [100, 300],
    ];
    expect(size(ladder, 200).size).toBeCloseTo(316.2278, 3);
  });
  it("quotes three significant figures between bands and two beyond them", () => {
    expect(roundEstimate(316.2278, false)).toBe(316);
    expect(roundEstimate(3162.278, false)).toBe(3160);
    expect(roundEstimate(65.5185, false)).toBe(65.5);
    expect(roundEstimate(56.2341, true)).toBe(56);
    expect(roundEstimate(31622.78, true)).toBe(32000);
  });
});

describe("lanes", () => {
  it("divides a span into equal lanes from the first edge", () => {
    expect(divideLanes(100, 500, 4)).toEqual([
      { from: 100, to: 200 },
      { from: 200, to: 300 },
      { from: 300, to: 400 },
      { from: 400, to: 500 },
    ]);
    // The last lane ends on the edge itself, whatever the rounding.
    const thirds = divideLanes(0, 100, 3);
    expect(thirds).toHaveLength(3);
    expect(thirds[1].from).toBeCloseTo(33.3333, 3);
    expect(thirds[2].to).toBe(100);
  });
  it("makes no lanes from a count or a span that cannot be divided", () => {
    expect(divideLanes(0, 100, 0)).toEqual([]);
    expect(divideLanes(0, 100, 2.5)).toEqual([]);
    expect(divideLanes(0, 100, -3)).toEqual([]);
    expect(divideLanes(40, 40, 4)).toEqual([]);
    expect(divideLanes(0, NaN, 4)).toEqual([]);
  });
  const view = (patch: Partial<View> = {}): View => ({
    rotation: 0,
    flipX: false,
    flipY: false,
    crop: { x: 0, y: 0, width: 1000, height: 700 },
    ...patch,
  });
  const box = ([a, b]: [{ x: number; y: number }, { x: number; y: number }]) => [
    Math.min(a.x, b.x),
    Math.max(a.x, b.x),
    Math.min(a.y, b.y),
    Math.max(a.y, b.y),
  ];
  it("numbers lanes from the left of the picture as displayed", () => {
    const corners = [
      { x: 100, y: 50 },
      { x: 500, y: 650 },
    ] as const;
    // Unturned: lane 1 is the leftmost 100 px of the region.
    const plain = splitRegion(corners[0], corners[1], 4, view());
    expect(plain.map(box)).toEqual([
      [100, 200, 50, 650],
      [200, 300, 50, 650],
      [300, 400, 50, 650],
      [400, 500, 50, 650],
    ]);
    // Dragging from the other corner gives the same lanes.
    expect(splitRegion(corners[1], corners[0], 4, view()).map(box)).toEqual(
      plain.map(box)
    );
    // Mirrored left to right: what is shown on the left is the right of the
    // source image, so lane 1 is source x 400–500.
    expect(
      splitRegion(corners[0], corners[1], 4, view({ flipX: true })).map(box)[0]
    ).toEqual([400, 500, 50, 650]);
  });
  it("splits along the displayed width when the image is turned", () => {
    // Turned a quarter clockwise, a 1000 × 700 image is shown 700 wide: a
    // source point (x, y) lands at display (700 − y, x). The region
    // x 100–300, y 100–500 therefore spans display x 200–600; its left half
    // (display x 200–400) is source y 300–500.
    const lanes = splitRegion(
      { x: 100, y: 100 },
      { x: 300, y: 500 },
      2,
      view({ rotation: 90 })
    ).map(box);
    expect(lanes).toEqual([
      [100, 300, 300, 500],
      [100, 300, 100, 300],
    ]);
  });
});

describe("reading a gel's annotations", () => {
  const image = {
    width: 1000,
    height: 700,
    rotation: 0,
    flipX: false,
    flipY: false,
  };
  const band = (
    id: string,
    x: number,
    y: number,
    known?: number | null,
    extra: object = {}
  ): Shape => ({
    id,
    kind: "line",
    name: id,
    color: "#dc2626",
    points: [
      { x, y },
      { x: x + 100, y },
    ],
    ...(known === undefined ? {} : { size: known }),
    ...extra,
  });
  const lane = (id: string, x: number): Shape => ({
    id,
    kind: "rectangle",
    name: id,
    color: "#dc2626",
    points: [
      { x, y: 20 },
      { x: x + 120, y: 680 },
    ],
  });
  it("sorts bands into columns and finds the nearest one", () => {
    const columns = groupColumns([
      { left: 800, right: 900 },
      { left: 100, right: 200 },
      { left: 150, right: 230 },
      { left: 225, right: 260 },
    ]);
    // 100–200, 150–230 and 225–260 chain into one column; 800–900 stands alone.
    expect(columns.map((column) => column.length)).toEqual([3, 1]);
    expect(nearestColumn(columns, { left: 300, right: 400 })).toBe(0);
    expect(nearestColumn(columns, { left: 700, right: 760 })).toBe(1);
    expect(nearestColumn(columns, { left: 120, right: 180 })).toBe(0);
    expect(nearestColumn([], { left: 0, right: 1 })).toBe(-1);
  });
  it("estimates sample bands from the ladder and names their lane", () => {
    const reading = readGel(
      [
        lane("L1", 90),
        lane("L2", 290),
        band("1000 bp", 100, 100, 1000),
        band("100 bp", 100, 300, 100),
        band("sample", 300, 200),
        // Outside every lane, past the end of the ladder.
        band("far", 600, 400),
        { ...band("label", 0, 0), kind: "text" },
      ],
      image
    );
    expect(reading.lanes.map((entry) => entry.name)).toEqual(["L1", "L2"]);
    expect(reading.ladders).toHaveLength(1);
    expect(reading.ladders[0].map((entry) => entry.known)).toEqual([1000, 100]);
    const [first, second, sample, far] = reading.bands;
    expect([first.lane, second.lane, sample.lane, far.lane]).toEqual([
      "L1",
      "L1",
      "L2",
      "",
    ]);
    expect(first.estimate).toBeNull();
    // 200 px is halfway between 1000 bp (100 px) and 100 bp (300 px) → 316.2.
    expect(sample.position).toBe(200);
    expect(sample.estimate).toMatchObject({ ok: true, extrapolated: false });
    expect(sample.estimate?.ok && sample.estimate.size).toBeCloseTo(316.2278, 3);
    // 400 px is 100 px past the 100 bp band: log10 = 2 − 100 / 200 = 1.5 → 31.62.
    expect(far.estimate).toMatchObject({ ok: true, extrapolated: true });
    expect(far.estimate?.ok && far.estimate.size).toBeCloseTo(31.6228, 3);
  });
  it("reads each band against the ladder nearest to it", () => {
    // Two ladders on one gel, the right one running 20 px lower (a smile).
    const reading = readGel(
      [
        band("left 1000", 100, 100, 1000),
        band("left 100", 100, 300, 100),
        band("right 1000", 800, 120, 1000),
        band("right 100", 800, 320, 100),
        band("near left", 250, 200),
        band("near right", 650, 220),
      ],
      image
    );
    expect(reading.ladders).toHaveLength(2);
    const [, , , , left, right] = reading.bands;
    expect([left.ladder, right.ladder]).toEqual([0, 1]);
    // Each is halfway down its own ladder → 316.2 bp. Read against the other
    // ladder, 200 px and 220 px would give 398 and 251 bp.
    expect(left.estimate?.ok && left.estimate.size).toBeCloseTo(316.2278, 3);
    expect(right.estimate?.ok && right.estimate.size).toBeCloseTo(316.2278, 3);
  });
  it("does not let a lone sized band take samples away from the real ladder", () => {
    const reading = readGel(
      [
        band("1000 bp", 100, 100, 1000),
        band("100 bp", 100, 300, 100),
        // A control of known size, alone in the sample's own lane.
        band("control", 500, 150, 400),
        band("sample", 500, 200),
      ],
      image
    );
    expect(reading.ladders).toHaveLength(2);
    const sample = reading.bands[3];
    expect(sample.ladder).toBe(0);
    expect(sample.estimate?.ok && sample.estimate.size).toBeCloseTo(316.2278, 3);
  });
  it("gives the same sizes however the image is turned or mirrored", () => {
    const shapes = [
      band("1000 bp", 100, 100, 1000),
      band("100 bp", 100, 300, 100),
      band("sample", 300, 150),
    ];
    for (const turned of [
      { rotation: 180 },
      { flipY: true },
      { flipX: true },
      { rotation: 180, flipX: true, flipY: true },
    ]) {
      const sample = readGel(shapes, { ...image, ...turned }).bands[2];
      // A quarter of the way from 1000 bp to 100 bp → 562.3 bp.
      expect(sample.estimate?.ok && sample.estimate.size).toBeCloseTo(
        562.3413,
        3
      );
    }
    // Upside down, distance is measured from the other edge: 700 − 150.
    expect(readGel(shapes, { ...image, rotation: 180 }).bands[2].position).toBe(
      550
    );
  });
  it("treats a band without a usable size as a sample and reports why none is estimated", () => {
    const reading = readGel(
      [
        band("only", 100, 100, 1000),
        band("emptied", 100, 200, null),
        band("zero", 100, 300, 0),
        // A field this build does not know is ignored.
        band("unknown field", 100, 400, undefined, { intensity: 12 }),
      ],
      image
    );
    expect(reading.ladders).toHaveLength(1);
    expect(reading.bands.map((entry) => entry.known)).toEqual([
      1000,
      null,
      null,
      null,
    ]);
    expect(reading.bands[1].estimate).toEqual({ ok: false, reason: "few" });
    // With no ladder at all there is nothing to read against either.
    expect(readGel([band("alone", 100, 100)], image).bands[0]).toMatchObject({
      ladder: -1,
      estimate: { ok: false, reason: "few" },
    });
  });
});
