// @vitest-environment jsdom
import { act, useState, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, it, expect, vi } from "vitest";
import { ToolContext } from "./ui";
import type { ToolDocument, ToolId } from "./registry";
import type { ToolRepository } from "./repository";
import ImageTool from "./ImageTool";
import {
  angleDegrees,
  fromDisplay,
  measure,
  summarize,
  toDisplay,
  type Shape,
  type View,
} from "./geometry";
import { exportBlobPartAsFile } from "../../utils/fileExport";
const locale = vi.hoisted(() => ({ language: "en" }));
vi.mock("../../utils/fileExport", () => ({ exportBlobPartAsFile: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: locale, t: (s: string) => s }),
}));
vi.mock("../../locales/i18n", () => ({
  default: {
    get language() {
      return locale.language;
    },
    t: (s: string) => s,
  },
}));
vi.mock("../../services/supabaseClient", () => ({ supabase: {} }));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout: the editor's screen-to-image matrix is stood in for by
// the identity, so a pointer at (x, y) is the image point (x, y).
beforeAll(() => {
  Object.assign(Element.prototype, { setPointerCapture: () => {} });
  Object.assign(SVGElement.prototype, {
    getScreenCTM: () => ({ inverse: () => ({}) }),
  });
});
class Point {
  x: number;
  y: number;
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
  matrixTransform() {
    return this;
  }
}

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(() => root?.unmount());
  document.body.innerHTML = "";
  root = null;
  locale.language = "en";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const document_ = (
  id: string,
  toolId: ToolId,
  title: string,
  data: Record<string, unknown>
): ToolDocument => ({
  id,
  owner_id: "owner",
  tool_id: toolId,
  title,
  data,
  schema_version: 1,
  engine_version: "1",
  revision: 0,
  updated_at: "",
});
const EDITOR = ".tool-image-stage > svg";
/** Mounts the editor on a 1000 × 700 image that has already been uploaded. */
async function mount(
  data: Record<string, unknown> = {},
  {
    gel = false,
    documents = [],
  }: { gel?: boolean; documents?: ToolDocument[] } = {}
) {
  vi.stubGlobal("DOMPoint", Point);
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  let doc = document_("doc", gel ? "gel-blot" : "image-measurer", "Test", {
    asset: "asset-1",
    width: 1000,
    height: 700,
    ...data,
  });
  const element = document.createElement("div");
  document.body.appendChild(element);
  let renderDoc: (next: ToolDocument) => void = () => {};
  const repo = {
    owner: "owner",
    items: [{ doc }],
    getImage: vi.fn(async () => new Blob(["image"], { type: "image/png" })),
    putImage: vi.fn(async () => "asset-2"),
    update: async (_id: string, patch: Partial<ToolDocument>) => {
      doc = { ...doc, ...patch };
      repo.items[0].doc = doc;
      renderDoc(doc);
    },
  } as unknown as ToolRepository;
  function Harness() {
    const [state, setState] = useState(doc);
    useEffect(() => {
      renderDoc = setState;
    }, []);
    return (
      <ToolContext.Provider value={{ doc: state, repo, documents }}>
        <ImageTool gel={gel} />
      </ToolContext.Provider>
    );
  }
  root = createRoot(element);
  await act(() => root!.render(<Harness />));
  // The image arrives through a FileReader, a few tasks later.
  for (let tries = 0; tries < 50 && !element.querySelector(EDITOR); tries++)
    await act(() => new Promise((resolve) => setTimeout(resolve, 2)));
  const editor = element.querySelector<SVGSVGElement>(EDITOR)!;
  expect(editor).not.toBeNull();
  return {
    element,
    editor,
    data: () => doc.data,
    shapes: () => doc.data.shapes as Shape[],
  };
}
const pointer = (target: Element, type: string, x: number, y: number) =>
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })
    );
  });
/** Presses at one point, moves to another and releases there. */
async function drag(
  target: Element,
  from: [number, number],
  to: [number, number]
) {
  await pointer(target, "pointerdown", ...from);
  await pointer(target, "pointermove", ...to);
  await pointer(target.closest(EDITOR) ?? target, "pointerup", ...to);
}
const tap = (target: Element, x: number, y: number) =>
  drag(target, [x, y], [x, y]);
async function input(element: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function choose(element: HTMLSelectElement, value: string) {
  await act(() => {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const field = <T extends HTMLElement = HTMLInputElement>(
  container: Element,
  label: string
) =>
  [...container.querySelectorAll("label")]
    .find((l) => l.querySelector("span")?.textContent === label)
    ?.querySelector("input, select") as unknown as T;
const button = (container: Element, text: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === text
  )!;
const click = (target: HTMLElement) => act(() => target.click());
const keys = (init: KeyboardEventInit, target: EventTarget = document.body) =>
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })
    );
  });
const previews = (editor: Element) => [
  ...editor.querySelectorAll("[data-preview]"),
];
/** The measurement table as rows of cell text, without the header. */
const cells = (tableRows: Iterable<Element>) =>
  [...tableRows].map((row) =>
    [...row.children].map((cell) => cell.textContent)
  );
const rows = (element: Element) => {
  const tables = element.querySelectorAll(".tool-panel > .tool-table-wrap");
  return cells(tables[tables.length - 1].querySelectorAll("tbody tr"));
};
const statistics = (element: Element) =>
  cells(
    element.querySelectorAll(".tool-image-x-stats > .tool-table-wrap tbody tr")
  );
const line = (
  id: string,
  from: [number, number],
  to: [number, number],
  extra: Partial<Shape> = {}
): Shape => ({
  id,
  kind: "line",
  name: id,
  color: "#2563eb",
  points: [
    { x: from[0], y: from[1] },
    { x: to[0], y: to[1] },
  ],
  ...extra,
});
const exported = () => {
  const [text, options] = vi.mocked(exportBlobPartAsFile).mock.calls[0];
  return { text: String(text), name: options.fileName };
};

describe("image geometry", () => {
  it("measures the angle at the middle of three points", () => {
    const o = { x: 0, y: 0 };
    // Arms along +x and +y are perpendicular.
    expect(angleDegrees({ x: 10, y: 0 }, o, { x: 0, y: 5 })).toBeCloseTo(90, 10);
    // Along +x and the diagonal: 45°.
    expect(angleDegrees({ x: 1, y: 0 }, o, { x: 1, y: 1 })).toBeCloseTo(45, 10);
    // (2, 0) and (1, √3): cos θ = 2 / (2 × 2) = 0.5 → 60°.
    expect(
      angleDegrees({ x: 2, y: 0 }, o, { x: 1, y: Math.sqrt(3) })
    ).toBeCloseTo(60, 10);
    // Opposite arms are a straight line; the same direction is no angle.
    expect(angleDegrees({ x: -3, y: 0 }, o, { x: 7, y: 0 })).toBe(180);
    expect(angleDegrees({ x: 3, y: 0 }, o, { x: 7, y: 0 })).toBe(0);
    // The vertex need not be the origin, and the order of the arms is free.
    expect(
      angleDegrees({ x: 100, y: 300 }, { x: 100, y: 100 }, { x: 300, y: 100 })
    ).toBeCloseTo(90, 10);
    // An arm with no length has no direction.
    expect(angleDegrees(o, o, { x: 1, y: 1 })).toBeNull();
  });
  it("reports an angle in degrees whatever the scale, and a count of points", () => {
    const shape = {
      id: "1",
      name: "n",
      color: "#000",
      points: [
        { x: 300, y: 100 },
        { x: 100, y: 100 },
        { x: 100, y: 300 },
      ],
    };
    expect(measure({ ...shape, kind: "angle" }, 1).angle).toBeCloseTo(90, 10);
    expect(measure({ ...shape, kind: "angle" }, 0.05).angle).toBeCloseTo(90, 10);
    // Two corners are not an angle yet.
    expect(
      measure({ ...shape, kind: "angle", points: shape.points.slice(0, 2) }, 1)
    ).toEqual({});
    expect(measure({ ...shape, kind: "count" }, 0.05)).toEqual({ count: 3 });
  });
  it("summarises measurements with the sample standard deviation", () => {
    // Mean (10 + 12 + 14) / 3 = 12; squared deviations 4 + 0 + 4 = 8;
    // 8 / (3 − 1) = 4 → SD 2.
    expect(summarize([10, 12, 14])).toEqual({ n: 3, mean: 12, sd: 2 });
    // Mean 40 / 8 = 5; squared deviations 9 + 1 + 1 + 1 + 0 + 0 + 4 + 16 = 32;
    // 32 / 7 = 4.571429 → SD 2.138090.
    const eight = summarize([2, 4, 4, 4, 5, 5, 7, 9])!;
    expect(eight.mean).toBe(5);
    expect(eight.sd).toBeCloseTo(2.13809, 5);
    // One value has a mean and no spread; none has neither.
    expect(summarize([7])).toEqual({ n: 1, mean: 7, sd: null });
    expect(summarize([])).toBeNull();
    expect(summarize([3, NaN, 5])).toEqual({
      n: 2,
      mean: 4,
      // (1 + 1) / (2 − 1) = 2 → √2.
      sd: Math.SQRT2,
    });
  });
  it("maps image points to the displayed picture and back", () => {
    const full = { x: 0, y: 0, width: 1000, height: 700 };
    const view = (patch: Partial<View>): View => ({
      rotation: 0,
      flipX: false,
      flipY: false,
      crop: full,
      ...patch,
    });
    const shown = (p: { x: number; y: number }, patch: Partial<View>) => {
      const q = toDisplay(p, view(patch));
      // -0 and 0 are the same place.
      return { x: q.x + 0, y: q.y + 0 };
    };
    const p = { x: 100, y: 500 };
    expect(shown(p, {})).toEqual(p);
    // A quarter turn clockwise shows the image 700 wide: (x, y) → (700 − y, x).
    expect(shown(p, { rotation: 90 })).toEqual({ x: 200, y: 100 });
    // A half turn: (1000 − x, 700 − y).
    expect(shown(p, { rotation: 180 })).toEqual({ x: 900, y: 200 });
    // Three quarters: (y, 1000 − x).
    expect(shown(p, { rotation: 270 })).toEqual({ x: 500, y: 900 });
    expect(shown(p, { flipX: true })).toEqual({ x: 900, y: 500 });
    expect(shown(p, { flipY: true })).toEqual({ x: 100, y: 200 });
    // Cropped to x 100–500, y 50–350 and mirrored: (500 − x, y − 50).
    const crop = { x: 100, y: 50, width: 400, height: 300 };
    expect(shown({ x: 150, y: 80 }, { crop, flipX: true })).toEqual({
      x: 350,
      y: 30,
    });
    for (const patch of [
      {},
      { rotation: 90 },
      { rotation: 270, flipX: true },
      { rotation: 180, flipY: true, crop },
    ]) {
      const back = fromDisplay(toDisplay(p, view(patch)), view(patch));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });
});

describe("image measurer", () => {
  it("opens a document saved before the new tools and offers nm", async () => {
    const { element } = await mount({
      shapes: [
        line("L1", [100, 100], [400, 500]),
        {
          id: "R1",
          kind: "rectangle",
          name: "R1",
          color: "#2563eb",
          points: [
            { x: 100, y: 200 },
            { x: 300, y: 240 },
          ],
        },
        { ...line("T1", [10, 10], [20, 20]), kind: "text", text: "note" },
      ],
    });
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(rows(element)).toEqual([
      ["L1", "500 px", "Visible"],
      ["R1", "8,000 px²", "Visible"],
      ["T1", "note", "Visible"],
    ]);
    expect(
      [...field<HTMLSelectElement>(element, "Unit").options].map(
        (option) => option.value
      )
    ).toEqual(["m", "cm", "mm", "µm", "nm"]);
    expect(element.textContent).not.toMatch(/[가-힣]/);
  });
  it("shows a shape while it is being dragged, with its measurement", async () => {
    const { element, editor, shapes } = await mount({ shapes: [] });
    await click(button(element, "Line"));
    await pointer(editor, "pointerdown", 100, 100);
    expect(previews(editor)).toHaveLength(0);
    await pointer(editor, "pointermove", 250, 300);
    await pointer(editor, "pointermove", 400, 500);
    const [preview] = previews(editor);
    const drawn = preview.querySelector("line")!;
    expect(
      ["x1", "y1", "x2", "y2"].map((name) => drawn.getAttribute(name))
    ).toEqual(["100", "100", "400", "500"]);
    // 300 across and 400 down: 500 px.
    expect(preview.querySelector("text")?.textContent).toBe("500 px");
    // Nothing is saved until the pointer is released.
    expect(shapes()).toEqual([]);
    await pointer(editor, "pointerup", 400, 500);
    expect(previews(editor)).toHaveLength(0);
    expect(shapes()).toHaveLength(1);
    expect(shapes()[0]).toMatchObject({
      kind: "line",
      name: "Line 1",
      points: [
        { x: 100, y: 100 },
        { x: 400, y: 500 },
      ],
    });
    // Rectangles, ellipses and the crop area preview the same way.
    for (const [tool, tag] of [
      ["Rectangle", "rect"],
      ["Ellipse", "ellipse"],
      ["Crop", "rect"],
    ]) {
      await click(button(element, tool));
      await pointer(editor, "pointerdown", 200, 200);
      await pointer(editor, "pointermove", 300, 260);
      expect(previews(editor)[0].querySelector(tag)).not.toBeNull();
      await keys({ key: "Escape" });
      expect(previews(editor)).toHaveLength(0);
    }
    // Escape left nothing behind.
    expect(shapes()).toHaveLength(1);
  });
  it("moves a shape with the pointer and saves it on release", async () => {
    const { editor, shapes } = await mount({
      shapes: [line("L1", [100, 100], [400, 100])],
    });
    const drawn = () => editor.querySelector('line[data-shape="L1"]')!;
    await pointer(drawn(), "pointerdown", 200, 100);
    await pointer(editor, "pointermove", 250, 160);
    // The line itself follows the pointer; the document has not changed yet.
    expect(drawn().getAttribute("x1")).toBe("150");
    expect(drawn().getAttribute("y1")).toBe("160");
    expect(shapes()[0].points[0]).toEqual({ x: 100, y: 100 });
    await pointer(editor, "pointerup", 250, 160);
    expect(shapes()[0].points).toEqual([
      { x: 150, y: 160 },
      { x: 450, y: 160 },
    ]);
    // Dragging a handle moves that end only, and the length follows live.
    const handle = editor.querySelector('[data-handle="1"]')!;
    await pointer(handle, "pointerdown", 450, 160);
    await pointer(editor, "pointermove", 150, 560);
    expect(editor.querySelector('text[data-shape="L1"]')?.textContent).toBe(
      "400 px"
    );
    await pointer(editor, "pointerup", 150, 560);
    expect(shapes()[0].points[1]).toEqual({ x: 150, y: 560 });
  });
  it("measures an angle from three clicks", async () => {
    const { element, editor, shapes } = await mount({ shapes: [] });
    await click(button(element, "Angle"));
    expect(element.textContent).toContain("(0/3)");
    await tap(editor, 300, 100);
    await tap(editor, 100, 100);
    expect(element.textContent).toContain("(2/3)");
    expect(shapes()).toEqual([]);
    // The second arm follows the pointer before the last click.
    await pointer(editor, "pointermove", 100, 200);
    expect(previews(editor)[0].querySelector("text")?.textContent).toBe("90°");
    await tap(editor, 100, 300);
    expect(shapes()).toHaveLength(1);
    expect(shapes()[0]).toMatchObject({
      kind: "angle",
      name: "Angle 1",
      points: [
        { x: 300, y: 100 },
        { x: 100, y: 100 },
        { x: 100, y: 300 },
      ],
    });
    expect(rows(element)).toEqual([["Angle 1", "90°", "Visible"]]);
    expect(editor.querySelector('text[data-shape]')?.textContent).toBe("90°");
    // Moving the vertex changes the angle: arms to (300, 100) and (100, 300)
    // from (300, 300) are again perpendicular; from (200, 200) they are
    // opposite.
    const vertex = editor.querySelector('[data-handle="1"]')!;
    await drag(vertex, [100, 100], [200, 200]);
    expect(rows(element)[0][1]).toBe("180°");
  });
  it("counts clicked points in numbered groups", async () => {
    const { element, editor, shapes } = await mount({ shapes: [] });
    await click(button(element, "Count points"));
    await tap(editor, 100, 100);
    await tap(editor, 200.26, 150);
    await tap(editor, 300, 220);
    expect(shapes()).toHaveLength(1);
    expect(shapes()[0]).toMatchObject({ kind: "count", name: "Count points 1" });
    // Positions are kept to a tenth of a pixel.
    expect(shapes()[0].points).toEqual([
      { x: 100, y: 100 },
      { x: 200.3, y: 150 },
      { x: 300, y: 220 },
    ]);
    const numbers = [...editor.querySelectorAll("g > g > g > text")].map(
      (node) => node.textContent
    );
    expect(numbers).toEqual(["1", "2", "3"]);
    expect(rows(element)).toEqual([["Count points 1", "3 points", "Visible"]]);
    expect(element.textContent).toContain('Adding to "Count points 1": 3');
    await click(button(element, "Remove last point"));
    expect(shapes()[0].points).toHaveLength(2);
    // The tool stays on after "Remove last point" is used from the panel.
    await click(button(element, "Keep counting"));
    await click(button(element, "Start a new group"));
    await tap(editor, 500, 500);
    expect(shapes().map((shape) => shape.points.length)).toEqual([2, 1]);
    expect(shapes()[1].name).toBe("Count points 2");
    // Two groups of 2 and 1: mean 1.5, SD √0.5 = 0.7071, total 3.
    expect(statistics(element)).toEqual([
      ["Point count", "2", "1.5 · Total 3", "0.7071"],
    ]);
    expect(element.innerHTML).not.toMatch(/[가-힣]/);
    expect(element.innerHTML).not.toContain("NaN");
  });
  it("shows angles and counts in Korean on the Korean screen", async () => {
    locale.language = "ko";
    const { element } = await mount({
      shapes: [
        {
          id: "A",
          kind: "angle",
          name: "각도 1",
          color: "#2563eb",
          points: [
            { x: 300, y: 100 },
            { x: 100, y: 100 },
            { x: 100, y: 300 },
          ],
        },
        {
          id: "C",
          kind: "count",
          name: "점 계수 2",
          color: "#2563eb",
          points: [
            { x: 10, y: 10 },
            { x: 20, y: 20 },
            { x: 30, y: 30 },
          ],
        },
      ],
    });
    expect(rows(element)).toEqual([
      ["각도 1", "90°", "표시됨"],
      ["점 계수 2", "3개", "표시됨"],
    ]);
    expect(statistics(element)).toEqual([
      ["각도", "1", "90°", "—"],
      ["점 계수", "1", "3 · 합계 3", "—"],
    ]);
  });
  it("gives the count, mean and deviation of each kind, and bars from three measurements", async () => {
    const one = [line("a", [0, 100], [100, 100])],
      two = [...one, line("b", [0, 200], [120, 200])],
      three = [...two, line("c", [0, 300], [140, 300])];
    const single = await mount({ shapes: one });
    // One measurement has a mean and no deviation.
    expect(statistics(single.element)).toEqual([
      ["Line length", "1", "100 px", "—"],
    ]);
    expect(single.element.textContent).toContain(
      "needs two or more measurements"
    );
    expect(single.element.querySelector(".tool-chart-bars")).toBeNull();
    await act(() => root?.unmount());
    document.body.innerHTML = "";
    const pair = await mount({ shapes: two });
    // 100 and 120: mean 110; (100 + 100) / 1 = 200 → SD 14.14.
    expect(statistics(pair.element)).toEqual([
      ["Line length", "2", "110 px", "14.14 px"],
    ]);
    expect(pair.element.querySelector(".tool-chart-bars")).toBeNull();
    await act(() => root?.unmount());
    document.body.innerHTML = "";
    // Calibrated: the 100 px reference is 10 µm, so 0.1 µm per pixel.
    const { element } = await mount({
      shapes: [
        ...three,
        {
          id: "r",
          kind: "rectangle",
          name: "r",
          color: "#2563eb",
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 50 },
          ],
        },
      ],
      known: 10,
      unit: "µm",
      calibration: "reference",
      reference: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    });
    // 10, 12 and 14 µm: mean 12, SD 2. One rectangle of 10 × 5 µm.
    expect(statistics(element)).toEqual([
      ["Line length", "3", "12 µm", "2 µm"],
      ["Rectangle area", "1", "50 µm²", "—"],
    ]);
    const bars = element.querySelector(".tool-chart-bars")!;
    expect(bars.getAttribute("aria-label")).toBe(
      "Line length of each measurement"
    );
    expect(
      [...bars.querySelectorAll('[role="listitem"]')].map((bar) =>
        bar.getAttribute("aria-label")
      )
    ).toEqual(["a 10 µm", "b 12 µm", "c 14 µm"]);
    // Only the kind with three measurements gets a chart, and its table.
    expect(element.querySelectorAll(".tool-image-x-stats .tool-chart")).toHaveLength(
      1
    );
    expect(
      [...element.querySelectorAll(".tool-chart-table tbody tr")].map(
        (row) => row.textContent
      )
    ).toEqual(["a10 µm", "b12 µm", "c14 µm"]);
    await click(button(element, "CSV"));
    expect(exported().name).toMatch(
      /^buril-image-measurer-Test-\d{8}-\d{4}\.csv$/
    );
    expect(exported().text).toContain(
      '"Name","Length","Width","Height","Area","Unit","Angle (°)","Points"'
    );
    expect(exported().text).toContain('"a","10","","","","µm","",""');
    expect(exported().text).toContain('"r","","10","5","50","µm","",""');
    expect(element.innerHTML).not.toMatch(/[가-힣]/);
    expect(element.innerHTML).not.toContain("NaN");
  });
  it("undoes typing in one step and redoes with the keyboard", async () => {
    const { element, shapes } = await mount({
      shapes: [line("L1", [100, 100], [400, 100])],
    });
    await click(button(element, "L1"));
    const name = () => field(element, "Name");
    for (const text of ["A", "AB", "ABC"]) await input(name(), text);
    expect(shapes()[0].name).toBe("ABC");
    // Shortcuts typed inside a field are the field's own.
    await keys({ key: "z", ctrlKey: true }, name());
    expect(shapes()[0].name).toBe("ABC");
    // One undo takes back the whole name, not its last letter.
    await keys({ key: "z", ctrlKey: true });
    expect(shapes()[0].name).toBe("L1");
    expect(button(element, "Undo").disabled).toBe(true);
    await keys({ key: "Z", ctrlKey: true, shiftKey: true });
    expect(shapes()[0].name).toBe("ABC");
    await keys({ key: "z", metaKey: true });
    expect(shapes()[0].name).toBe("L1");
    await keys({ key: "Z", metaKey: true, shiftKey: true });
    expect(shapes()[0].name).toBe("ABC");
    await keys({ key: "z", ctrlKey: true });
    await keys({ key: "y", ctrlKey: true });
    expect(shapes()[0].name).toBe("ABC");
    expect(button(element, "Redo").disabled).toBe(true);
    // Leaving the field ends the run: later typing is a step of its own.
    await act(() => {
      name().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await input(name(), "ABCD");
    await keys({ key: "z", ctrlKey: true });
    expect(shapes()[0].name).toBe("ABC");
    // A different field starts a new step as well.
    await input(name(), "X");
    await input(field(element, "Length (px)"), "150");
    await keys({ key: "z", ctrlKey: true });
    expect(shapes()[0]).toMatchObject({ name: "X" });
    expect(shapes()[0].points[1]).toEqual({ x: 400, y: 100 });
  });
});

describe("gel / blot", () => {
  const lane = (id: string, x: number, width = 100): Shape => ({
    id,
    kind: "rectangle",
    name: id,
    color: "#dc2626",
    points: [
      { x, y: 50 },
      { x: x + width, y: 650 },
    ],
  });
  it("opens a gel saved before sizes existed and exports it without pixel columns", async () => {
    const { element } = await mount(
      {
        shapes: [
          lane("L1", 100),
          line("1000 bp", [110, 100], [190, 100]),
          line("band", [110, 300], [190, 300]),
        ],
      },
      { gel: true }
    );
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(rows(element)).toEqual([
      ["L1", "Lane", "—", "—", "Visible"],
      ["1000 bp", "Band", "L1", "—", "Visible"],
      ["band", "Band", "L1", "—", "Visible"],
    ]);
    expect(element.textContent).toContain("Load a ladder, or select a ladder band");
    expect(element.querySelector(".tool-chart")).toBeNull();
    // Statistics of pixel lengths mean nothing on a gel.
    expect(element.querySelector(".tool-image-x-stats")).toBeNull();
    await click(button(element, "CSV"));
    expect(exported().name).toMatch(/^buril-gel-blot-Test-\d{8}-\d{4}\.csv$/);
    expect(exported().text.split("\r\n")).toEqual([
      '﻿"Lane","Name","Type","Migration distance (px)","Size","Unit","Size source","Extrapolated"',
      '"L1","1000 bp","Band","100","","","",""',
      '"L1","band","Band","300","","","",""',
    ]);
    expect(element.textContent).not.toMatch(/[가-힣]/);
  });
  it("splits a dragged region into numbered lanes, previewing them", async () => {
    const { element, editor, shapes } = await mount(
      { shapes: [] },
      { gel: true }
    );
    await click(button(element, "Split lanes"));
    await input(field(element, "Number of lanes"), "4");
    expect(element.textContent).toContain("make 4 lanes of equal width");
    await pointer(editor, "pointerdown", 100, 50);
    await pointer(editor, "pointermove", 500, 650);
    expect(
      previews(editor).map((preview) => [
        preview.querySelector("rect")?.getAttribute("x"),
        preview.querySelector("rect")?.getAttribute("width"),
        preview.querySelector("text")?.textContent,
      ])
    ).toEqual([
      ["100", "100", "1"],
      ["200", "100", "2"],
      ["300", "100", "3"],
      ["400", "100", "4"],
    ]);
    expect(shapes()).toEqual([]);
    await pointer(editor, "pointerup", 500, 650);
    expect(shapes().map((shape) => [shape.kind, shape.name])).toEqual([
      ["rectangle", "1"],
      ["rectangle", "2"],
      ["rectangle", "3"],
      ["rectangle", "4"],
    ]);
    expect(shapes()[3].points).toEqual([
      { x: 400, y: 50 },
      { x: 500, y: 650 },
    ]);
    // One undo removes the lanes together.
    await keys({ key: "z", ctrlKey: true });
    expect(shapes()).toEqual([]);
    await keys({ key: "y", ctrlKey: true });
    // A lane keeps the number as its name until it is renamed.
    await click(button(element, "2"));
    await input(field(element, "Name"), "Sample A");
    expect(shapes().map((shape) => shape.name)).toEqual([
      "1",
      "Sample A",
      "3",
      "4",
    ]);
    // A count that cannot be used makes nothing and says what to enter.
    await click(button(element, "Split lanes"));
    await input(field(element, "Number of lanes"), "2.5");
    expect(element.textContent).toContain("whole number of lanes from 1 to 60");
    await drag(editor, [600, 50], [900, 650]);
    expect(shapes()).toHaveLength(4);
  });
  it("splits the selected rectangle into equal lanes", async () => {
    const { element, shapes } = await mount(
      {
        shapes: [lane("region", 100, 600), line("b", [10, 10], [20, 10])],
      },
      { gel: true }
    );
    await click(button(element, "region"));
    await input(field(element, "Lanes to split into"), "3");
    await click(button(element, "Split into equal lanes"));
    expect(shapes().map((shape) => shape.name)).toEqual(["1", "2", "3", "b"]);
    expect(
      shapes()
        .slice(0, 3)
        .map((shape) => [shape.points[0].x, shape.points[1].x])
    ).toEqual([
      [100, 300],
      [300, 500],
      [500, 700],
    ]);
  });
  it("loads a ladder with its sizes and estimates the bands drawn beside it", async () => {
    const { element, editor, shapes, data } = await mount(
      { shapes: [lane("S1", 280, 140)] },
      {
        gel: true,
        documents: [
          document_("ladder", "ladders", "1 kb ladder", {
            unit: "bp",
            bands: [
              // A field from a newer build is ignored.
              { label: "1000", size: 1000, color: "#000", highlight: true, tint: 3 },
              { label: "100", size: 100, color: "#000" },
              { label: "?", size: null, color: "#000" },
            ],
          }),
        ],
      }
    );
    await choose(
      field<HTMLSelectElement>(element, "Load custom ladder"),
      "ladder"
    );
    expect(data().sizeUnit).toBe("bp");
    // Largest at 10 % of the height (70 px), smallest at 90 % (630 px).
    expect(
      shapes()
        .slice(1)
        .map((shape) => [
          shape.name,
          Math.round(shape.points[0].y),
          shape.size,
        ])
    ).toEqual([
      ["1000 bp", 70, 1000],
      ["100 bp", 630, 100],
      ["? bp", 630, undefined],
    ]);
    expect(element.querySelector('[role="alert"]')).toBeNull();
    // 350 px is halfway between 1000 bp (70 px) and 100 bp (630 px):
    // 10^2.5 = 316.2 → 316 bp. The size shows while the band is still drawn.
    await click(button(element, "Band"));
    await pointer(editor, "pointerdown", 300, 350);
    await pointer(editor, "pointermove", 400, 350);
    expect(previews(editor)[0].querySelector("text")?.textContent).toBe(
      "≈ 316 bp"
    );
    await pointer(editor, "pointerup", 400, 350);
    // 665 px is 35 px past the 100 bp band: log10 = 2 − 35 / 560 = 1.9375
    // → 86.6, quoted to two figures as 87 bp and marked extrapolated.
    await click(button(element, "Band"));
    await drag(editor, [300, 665], [400, 665]);
    expect(rows(element)).toEqual([
      ["S1", "Lane", "—", "—", "Visible"],
      ["1000 bp", "Ladder band", "—", "1,000 bp", "Visible"],
      ["100 bp", "Ladder band", "—", "100 bp", "Visible"],
      ["? bp", "Band", "—", "≈ 100 bp", "Visible"],
      ["Band 5", "Band", "S1", "≈ 316 bp", "Visible"],
      ["Band 6", "Band", "—", "≈ 87 bp · extrapolated", "Visible"],
    ]);
    expect(
      editor.querySelector(`text[data-shape="${shapes()[4].id}"]`)?.textContent
    ).toBe("Band 5 ≈ 316 bp");
    expect(element.textContent).toContain("A band outside the ladder");
    // The chart plots log size against distance, with the same values as a table.
    const plot = element.querySelector(".tool-chart-plot svg")!;
    expect(plot.getAttribute("aria-label")).toContain(
      "Size against migration distance"
    );
    expect(plot.textContent).toContain("Size (bp, log)");
    expect(plot.textContent).toContain("Band 6 (extrapolated)");
    expect(
      [...element.querySelectorAll(".tool-chart-table tbody tr")].map((row) =>
        [...row.children].map((cell) => cell.textContent)
      )
    ).toEqual([
      ["Ladder", "1000 bp", "70", "1,000", ""],
      ["Ladder", "100 bp", "630", "100", ""],
      ["Estimated", "? bp", "630", "≈ 100", ""],
      ["Estimated", "Band 5", "350", "≈ 316", ""],
      ["Estimated", "Band 6", "665", "≈ 87", "Extrapolated"],
    ]);
    await click(button(element, "CSV"));
    expect(exported().text.split("\r\n")).toEqual([
      '﻿"Lane","Name","Type","Migration distance (px)","Size","Unit","Size source","Extrapolated"',
      '"S1","Band 5","Band","350","316","bp","Estimated","No"',
      '"","1000 bp","Ladder band","70","1000","bp","Ladder",""',
      '"","100 bp","Ladder band","630","100","bp","Ladder",""',
      '"","? bp","Band","630","100","bp","Estimated","No"',
      '"","Band 6","Band","665","87","bp","Estimated","Yes"',
    ]);
    // Entering a size turns a band into a ladder band. Standing alone in its
    // own column it is no ladder to read against, so the band above it keeps
    // the estimate from the real ladder.
    await click(button(element, "Band 6"));
    await input(field(element, "Ladder band size (bp)"), "20");
    expect(shapes()[5].size).toBe(20);
    expect(rows(element).slice(4)).toEqual([
      ["Band 5", "Band", "S1", "≈ 316 bp", "Visible"],
      ["Band 6", "Ladder band", "—", "20 bp", "Visible"],
    ]);
    expect(element.textContent).toContain(
      "Ladder 2: at least two bands with a size are needed."
    );
    // Emptying the field makes it a sample band again.
    await input(field(element, "Ladder band size (bp)"), "");
    expect(shapes()[5].size).toBeNull();
    expect(rows(element)[5][3]).toBe("≈ 87 bp · extrapolated");
    // Nothing on the English screen is left in Korean, labels included.
    expect(element.innerHTML).not.toMatch(/[가-힣]/);
    expect(element.innerHTML).not.toContain("NaN");
    // Hiding the sizes on the image leaves the names.
    await click(
      [...element.querySelectorAll<HTMLElement>('[role="checkbox"]')].find(
        (node) => node.textContent === "Show estimated sizes on the image"
      )!
    );
    expect(data().sizeLabels).toBe(false);
    expect(
      editor.querySelector(`text[data-shape="${shapes()[4].id}"]`)?.textContent
    ).toBe("Band 5");
  });
  it("says why nothing is estimated instead of guessing", async () => {
    const few = await mount(
      {
        shapes: [
          line("1000", [100, 100], [200, 100], { size: 1000 }),
          line("band", [300, 200], [400, 200]),
        ],
      },
      { gel: true }
    );
    expect(few.element.textContent).toContain(
      "Ladder: at least two bands with a size are needed."
    );
    expect(few.element.querySelector('[role="alert"]')).toBeNull();
    expect(rows(few.element)[1]).toEqual(["band", "Band", "—", "—", "Visible"]);
    expect(few.element.querySelector(".tool-chart")).toBeNull();
    await act(() => root?.unmount());
    document.body.innerHTML = "";
    const overlap = await mount(
      {
        shapes: [
          line("1000", [100, 100], [200, 100], { size: 1000 }),
          line("500", [100, 100], [200, 100], { size: 500 }),
          line("band", [300, 200], [400, 200]),
        ],
      },
      { gel: true }
    );
    expect(
      overlap.element.querySelector('[role="alert"]')?.textContent
    ).toContain("sit at the same position");
    expect(overlap.element.querySelector(".tool-chart")).toBeNull();
    await act(() => root?.unmount());
    document.body.innerHTML = "";
    locale.language = "ko";
    const order = await mount(
      {
        sizeUnit: "kDa",
        shapes: [
          line("75", [100, 100], [200, 100], { size: 75 }),
          line("25", [100, 200], [200, 200], { size: 25 }),
          line("50", [100, 300], [200, 300], { size: 50 }),
          line("band", [300, 200], [400, 200]),
        ],
      },
      { gel: true }
    );
    expect(order.element.querySelector('[role="alert"]')?.textContent).toContain(
      "순서가 크기와 맞지 않아"
    );
    expect(rows(order.element)[0]).toEqual([
      "75",
      "래더 밴드",
      "—",
      "75 kDa",
      "표시됨",
    ]);
  });
});
