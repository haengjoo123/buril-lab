import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import {
  foldParts,
  heatStep,
  nearestIndex,
  niceTicks,
  scale,
  shares,
} from "./chartMath";
import { BarList, ChartFrame, Meter, Plot, SegmentedBar } from "./charts";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" }, t: (s: string) => s }),
}));
vi.mock("../../services/supabaseClient", () => ({ supabase: {} }));
vi.mock("../../locales/i18n", () => ({
  default: { language: "en", t: (s: string) => s },
}));

describe("chart scales", () => {
  it("chooses round ticks that enclose the data", () => {
    expect(niceTicks(0, 100)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(3, 47)).toEqual([0, 10, 20, 30, 40, 50]);
    // Range 0.26 over ~5 ticks is 0.052 per tick; the next round step up is 0.1.
    expect(niceTicks(0.12, 0.38)).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(niceTicks(-1.2, 1.9)).toEqual([-2, -1, 0, 1, 2]);
    // A single value still gets an axis around it.
    expect(niceTicks(5, 5)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(niceTicks(0, 0)).toEqual([-1, -0.5, 0, 0.5, 1]);
  });
  it("maps values linearly and centres a flat domain", () => {
    const px = scale(0, 10, 100, 300);
    expect(px(0)).toBe(100);
    expect(px(5)).toBe(200);
    expect(px(10)).toBe(300);
    expect(scale(4, 4, 0, 50)(4)).toBe(25);
  });
  it("splits a whole into shares and ignores what cannot be a part", () => {
    expect(shares([1, 9])).toEqual([0.1, 0.9]);
    expect(shares([2, 0, -3, 2])).toEqual([0.5, 0, 0, 0.5]);
    expect(shares([0, 0])).toEqual([0, 0]);
  });
  it("folds the smallest parts into one when there are too many", () => {
    const parts = [5, 1, 30, 2, 20, 3, 10, 4].map((value, i) => ({
      label: `p${i}`,
      value,
    }));
    const folded = foldParts(parts, 6, (value, count) => ({
      label: `other(${count})`,
      value,
    }));
    // The five largest keep their order; 1 + 2 + 3 = 6 goes to "other".
    expect(folded.map((p) => p.label)).toEqual([
      "p0",
      "p2",
      "p4",
      "p6",
      "p7",
      "other(3)",
    ]);
    expect(folded[5].value).toBe(6);
    expect(foldParts(parts.slice(0, 3), 6, () => parts[0])).toHaveLength(3);
  });
  it("assigns heat steps across a range and clamps outside it", () => {
    expect(heatStep(0, 0, 70)).toBe(0);
    expect(heatStep(35, 0, 70)).toBe(3);
    expect(heatStep(70, 0, 70)).toBe(6);
    expect(heatStep(-5, 0, 70)).toBe(0);
    expect(heatStep(999, 0, 70)).toBe(6);
    expect(heatStep(4, 4, 4)).toBe(3);
    expect(heatStep(NaN, 0, 1)).toBeNull();
  });
  it("finds the nearest stop", () => {
    expect(nearestIndex([0, 10, 20], 14)).toBe(1);
    expect(nearestIndex([0, 10, 20], 16)).toBe(2);
    expect(nearestIndex([], 1)).toBe(-1);
  });
});

describe("chart parts", () => {
  it("prints shares on a segmented bar and names amounts in its legend", () => {
    const html = renderToStaticMarkup(
      <SegmentedBar
        label="Final volume"
        parts={[
          { label: "Stock", value: 1 },
          { label: "Diluent", value: 9 },
        ]}
        text={(value) => `${value} mL`}
      />
    );
    // 10% is too narrow for a printed figure; it goes to the legend instead.
    expect(html).toContain(">90%<");
    expect(html).toContain("Stock <b>1 mL</b> (10%)");
    expect(html).toContain('aria-label="Diluent 9 mL, 90%"');
    expect(html).toContain("tool-chart-fill-1");
    expect(html).toContain("tool-chart-fill-2");
  });
  it("keeps a part's colour when another part drops to zero", () => {
    const bar = (first: number) =>
      renderToStaticMarkup(
        <SegmentedBar
          label="x"
          parts={[
            { label: "A", value: first },
            { label: "B", value: 5 },
          ]}
        />
      );
    // B is the second part and stays in slot 2 whether or not A is drawn.
    expect(bar(3)).toContain('tool-chart-fill-2" style="flex:0.625');
    expect(bar(0)).toContain('tool-chart-fill-2" style="flex:1');
    expect(bar(0)).not.toContain("tool-chart-fill-1");
  });
  it("draws nothing for an empty whole", () => {
    expect(
      renderToStaticMarkup(
        <SegmentedBar label="x" parts={[{ label: "a", value: 0 }]} />
      )
    ).toBe("");
  });
  it("exposes a meter's value and clamps its fill", () => {
    const html = renderToStaticMarkup(
      <Meter label="Steps done" value={7} max={5} text="5 / 5" marks={[2.5]} />
    );
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuetext="5 / 5"');
    expect(html).toContain("width:100%");
    expect(html).toContain("left:50%");
  });
  it("lists bars with their figures and turns diverging around zero", () => {
    const html = renderToStaticMarkup(
      <BarList
        label="Hydropathy"
        rows={[
          { label: "Ile", value: 4.5 },
          { label: "Arg", value: -4.5 },
        ]}
      />
    );
    expect(html).toContain('aria-label="Ile 4.5"');
    expect(html).toContain("data-negative");
    expect(html).toContain("right:50%;width:50%");
  });
  it("gives a plot an accessible name, axis titles and a table twin", () => {
    const html = renderToStaticMarkup(
      <ChartFrame
        title="Growth"
        table={{ headers: ["h", "%"], rows: [[0, 20], [24, 40]] }}
      >
        <Plot
          label="Estimated confluence over time"
          xTitle="Hours"
          yTitle="Confluence (%)"
          series={[
            {
              name: "Estimate",
              points: [
                { x: 0, y: 20 },
                { x: 24, y: 40 },
              ],
            },
          ]}
          rules={[{ axis: "y", at: 80, label: "Target 80%" }]}
          marks={[{ x: 48, y: 80, label: "48 h" }]}
        />
      </ChartFrame>
    );
    expect(html).toContain('aria-label="Estimated confluence over time"');
    expect(html).toContain("Target 80%");
    expect(html).toContain("View as table");
    expect(html).toContain("<td>24</td>");
    // One series: no legend box.
    expect(html).not.toContain("tool-chart-legend");
  });
  it("breaks a line where a point has no value", () => {
    const html = renderToStaticMarkup(
      <Plot
        label="y over x"
        series={[
          {
            name: "y",
            points: [
              { x: 0, y: 1 },
              { x: 1, y: 2 },
              { x: 2, y: NaN },
              { x: 3, y: 4 },
              { x: 4, y: 5 },
            ],
          },
        ]}
      />
    );
    const line = /class="tool-chart-line[^"]*" d="([^"]+)"/.exec(html)?.[1];
    // Two strokes: 0–1 and 3–4, with nothing drawn across x = 2.
    expect(line?.match(/M/g)).toHaveLength(2);
    expect(line?.match(/L/g)).toHaveLength(2);
  });
});
