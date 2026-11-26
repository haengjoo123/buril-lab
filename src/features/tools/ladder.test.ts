// @vitest-environment jsdom
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { ToolContext } from "./ui";
import type { ToolDocument } from "./registry";
import type { ToolRepository } from "./repository";
import LadderTool from "./LadderTool";
import {
  type LadderBand,
  type LadderCanvas,
  PNG_FOOTER,
  autoLabel,
  httpUrl,
  ladderDiagram,
  paintLadder,
  parseBandList,
  pngHeader,
  rescaleBands,
  resizeBand,
  spreadLabels,
} from "./ladder";

const exported = vi.hoisted(() => ({
  files: [] as { content: unknown; fileName: string; mimeType: string }[],
}));
vi.mock("../../utils/fileExport", () => ({
  exportBlobPartAsFile: async (
    content: unknown,
    options: { fileName: string; mimeType: string }
  ) => {
    exported.files.push({ content, ...options });
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" }, t: (s: string) => s }),
}));
vi.mock("../../locales/i18n", () => ({
  default: { language: "en", t: (s: string) => s },
}));
vi.mock("../../services/supabaseClient", () => ({ supabase: {} }));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const band = (size: number | null, more: Partial<LadderBand> = {}): LadderBand => ({
  size,
  label: autoLabel(size),
  color: "#2563eb",
  ...more,
});

describe("pasted band lists", () => {
  const sizes = (text: string, unit = "bp") => parseBandList(text, unit).sizes;

  it("splits at line breaks, commas, tabs, spaces, semicolons and slashes", () => {
    expect(sizes("1000\n750\r\n500")).toEqual([1000, 750, 500]);
    expect(sizes("1000, 750, 500")).toEqual([1000, 750, 500]);
    expect(sizes("1000\t750\t500")).toEqual([1000, 750, 500]);
    expect(sizes("1000 750  500")).toEqual([1000, 750, 500]);
    expect(sizes("1000; 750; 500/517")).toEqual([1000, 750, 500, 517]);
    // A list written without spaces, where a value has four digits.
    expect(sizes("100,200,300,1000,1500")).toEqual([100, 200, 300, 1000, 1500]);
  });

  it("reads a comma before three digits as a thousands separator", () => {
    expect(sizes("10,000\n8,000\n1,500\n500")).toEqual([10000, 8000, 1500, 500]);
    expect(sizes("10,000, 8,000, 6,000 and 1,517")).toEqual([
      10000, 8000, 6000, 1517,
    ]);
    expect(sizes("1,000,000")).toEqual([1000000]);
    // Three values, not one of a hundred million.
    expect(sizes("100,200,300")).toEqual([100, 200, 300]);
  });

  it("converts sizes written with a unit to the ladder's unit", () => {
    expect(sizes("1.5 kb, 500 bp, 250bp")).toEqual([1500, 500, 250]);
    expect(sizes("10 kb\n3kb\n0.5 kb", "bp")).toEqual([10000, 3000, 500]);
    expect(sizes("1500 bp, 500 bp", "kb")).toEqual([1.5, 0.5]);
    expect(sizes("250 kDa, 37kDa, 15000 Da", "kDa")).toEqual([250, 37, 15]);
    expect(sizes("9000 nt, 1 kb", "nt")).toEqual([9000, 1000]);
    // 0.1 kb is 100 bp, not 100.00000000000001.
    expect(sizes("0.1 kb")).toEqual([100]);
  });

  it("gives a value without a unit the next unit written after it", () => {
    expect(sizes("0.5, 1, 1.5, 2 and 3 kb")).toEqual([500, 1000, 1500, 2000, 3000]);
    expect(sizes("10, 15, 25, 37 kDa", "kDa")).toEqual([10, 15, 25, 37]);
    // After the last unit, values are already in the ladder's own.
    expect(sizes("10, 8 kb, 500, 250 bp, 100")).toEqual([
      10000, 8000, 500, 250, 100,
    ]);
    expect(sizes("3 kb\n1000\n500")).toEqual([3000, 1000, 500]);
  });

  it("reads a column line by line and a wrapped list as one", () => {
    // One value per line: the unit of a later line does not reach back.
    expect(sizes("10,000\n3 kb\n1,000\n500 bp")).toEqual([
      10000, 3000, 1000, 500,
    ]);
    // A list broken after a comma, or over lines of several values, goes on.
    expect(sizes("0.5, 1, 1.5,\n3 kb")).toEqual([500, 1000, 1500, 3000]);
    expect(sizes("10 8 6 5\n4 3 2 kb")).toEqual([
      10000, 8000, 6000, 5000, 4000, 3000, 2000,
    ]);
    // A blank line ends the list.
    expect(sizes("100 200\n\n1 2 kb")).toEqual([100, 200, 1000, 2000]);
  });

  it("reports what it could not read instead of guessing", () => {
    const result = parseBandList("Size (bp)\n1,000\nabc\n12x\n0\n-\n500", "bp");
    expect(result.sizes).toEqual([1000, 500]);
    expect(result.skipped).toEqual(["Size", "abc", "12x", "0"]);
    expect(result.unitMismatch).toBe(0);
    // A grouped list that cannot be told apart is not half-imported.
    expect(parseBandList("10,000,8,000", "bp")).toMatchObject({
      sizes: [],
      skipped: ["10,000,8,000"],
    });
    expect(parseBandList("", "bp")).toEqual({
      sizes: [],
      skipped: [],
      unitMismatch: 0,
      duplicates: 0,
    });
  });

  it("does not import masses into a length ladder, or the reverse", () => {
    const result = parseBandList("250 kDa, 100 kDa", "bp");
    expect(result.sizes).toEqual([]);
    expect(result.unitMismatch).toBe(2);
    expect(result.skipped).toHaveLength(2);
    expect(parseBandList("500 bp", "kDa").unitMismatch).toBe(1);
  });

  it("keeps the written order and adds a repeated size once", () => {
    const result = parseBandList("500, 1000, 500 bp, 1 kb, 250", "bp");
    expect(result.sizes).toEqual([500, 1000, 250]);
    expect(result.duplicates).toBe(2);
  });
});

describe("band sizes and their labels", () => {
  it("lets a label that repeats the size follow a new size", () => {
    expect(resizeBand(band(1000), 750)).toMatchObject({ size: 750, label: "750" });
    expect(resizeBand(band(null, { label: "" }), 500).label).toBe("500");
    expect(resizeBand(band(500), null)).toMatchObject({ size: null, label: "" });
    // A label the user wrote stays.
    expect(resizeBand(band(3000, { label: "3 kb (ref)" }), 2000).label).toBe(
      "3 kb (ref)"
    );
  });

  it("rescales every band without binary residue and keeps the rest", () => {
    const bands = [
      band(1500, { highlight: true, color: "#dc2626" }),
      band(100),
      band(null),
    ];
    expect(rescaleBands(bands, 0.001)).toEqual([
      { size: 1.5, label: "1.5", color: "#dc2626", highlight: true },
      { size: 0.1, label: "0.1", color: "#2563eb" },
      { size: null, label: "", color: "#2563eb" },
    ]);
    expect(rescaleBands(rescaleBands(bands, 0.001), 1000)).toEqual(bands);
    expect(rescaleBands(bands, 1)).toBe(bands);
  });
});

describe("ladder diagram", () => {
  it("moves labels apart from the top down, and back up at the bottom", () => {
    expect(spreadLabels([10, 12, 13, 60], 15, 400)).toEqual([10, 25, 40, 60]);
    // No room below: the labels stack upwards from the limit.
    expect(spreadLabels([80, 95, 99], 15, 100)).toEqual([70, 85, 100]);
    expect(spreadLabels([], 15, 100)).toEqual([]);
  });

  it("places bands by log size with the largest at the top", () => {
    const diagram = ladderDiagram(
      [band(100), band(10000, { highlight: true }), band(1000)],
      "bp"
    );
    expect(diagram.bands.map((b) => b.index)).toEqual([1, 2, 0]);
    const [top, middle, bottom] = diagram.bands;
    expect(top.y).toBe(35);
    expect(bottom.y).toBe(diagram.height - 35);
    expect(middle.y).toBeCloseTo((top.y + bottom.y) / 2, 8);
    expect(top).toMatchObject({ stroke: 7, bold: true, text: "10000 bp" });
    expect(bottom).toMatchObject({ stroke: 3, bold: false, text: "100 bp" });
    // Nothing overlapped, so every label sits on its band.
    expect(diagram.bands.every((b) => b.labelY === b.y)).toBe(true);
  });

  it("leaves out bands without a positive size and centres a single band", () => {
    const diagram = ladderDiagram([band(null), band(0), band(-5), band(500)], "bp");
    expect(diagram.bands).toHaveLength(1);
    expect(diagram.bands[0]).toMatchObject({ index: 3, y: diagram.height / 2 });
    expect(ladderDiagram([], "bp").bands).toEqual([]);
  });

  it("keeps the labels of crowded bands readable and grows when it must", () => {
    // 500 and 517 bp lie on almost the same line.
    const close = ladderDiagram([band(1000), band(517), band(500), band(100)], "bp");
    const ys = close.bands.map((b) => b.labelY);
    for (let i = 1; i < ys.length; i++)
      expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(15);
    expect(close.height).toBe(420);
    const many = ladderDiagram(
      Array.from({ length: 40 }, (_, i) => band(100 * (i + 1))),
      "bp"
    );
    expect(many.height).toBeGreaterThan(420);
    const labels = many.bands.map((b) => b.labelY);
    for (let i = 1; i < labels.length; i++)
      expect(labels[i] - labels[i - 1]).toBeGreaterThanOrEqual(15 - 1e-9);
    expect(labels[labels.length - 1]).toBeLessThanOrEqual(many.height - 35 + 1e-9);
    expect(labels[0]).toBeGreaterThanOrEqual(35 - 1e-9);
  });

  it("writes the user's label, shortened when it is too long for the picture", () => {
    const [first] = ladderDiagram(
      [band(3000, { label: "3 kb reference band of the ladder" })],
      "bp"
    ).bands;
    expect(first.text).toHaveLength(22);
    expect(first.text.endsWith("…")).toBe(true);
    expect(ladderDiagram([band(250, { label: " " })], "kDa").bands[0].text).toBe(
      "250 kDa"
    );
  });

  it("paints one coloured line and one label per band, dark on white", () => {
    const calls: unknown[][] = [];
    const record =
      (name: string) =>
      (...args: unknown[]) => {
        calls.push([name, ...args]);
      };
    // The styles in force when a line or a text is drawn are recorded with it.
    const style = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      font: "",
      textBaseline: "alphabetic",
    };
    const canvas = Object.assign(style, {
      fillRect: record("fillRect"),
      fillText: (text: string, x: number, y: number) => {
        calls.push(["fillText", text, x, y, style.fillStyle, style.font]);
      },
      beginPath: record("beginPath"),
      moveTo: record("moveTo"),
      lineTo: (x: number, y: number) => {
        calls.push(["lineTo", x, y, style.strokeStyle, style.lineWidth]);
      },
      stroke: record("stroke"),
      setTransform: record("setTransform"),
    }) as unknown as LadderCanvas;
    const diagram = ladderDiagram(
      [band(1000, { color: "#dc2626", highlight: true }), band(100)],
      "bp"
    );
    const title = "NEB N3232";
    paintLadder(canvas, diagram, { scale: 2, title, caption: "Schematic" });
    const header = pngHeader(title);
    expect(header).toBe(30);
    expect(pngHeader("  ")).toBe(0);
    expect(calls[0]).toEqual(["setTransform", 2, 0, 0, 2, 0, 0]);
    // The white background covers the title, the diagram and the caption.
    expect(calls[1]).toEqual([
      "fillRect",
      0,
      0,
      diagram.width,
      diagram.height + header + PNG_FOOTER,
    ]);
    const lines = calls.filter((call) => call[0] === "lineTo");
    // Band, then the leader to its label, for each band.
    expect(lines[0]).toEqual(["lineTo", diagram.x2, 35 + header, "#dc2626", 7]);
    expect(lines[2]).toEqual([
      "lineTo",
      diagram.x2,
      diagram.height - 35 + header,
      "#2563eb",
      3,
    ]);
    const texts = calls.filter((call) => call[0] === "fillText");
    expect(texts.map((call) => call[1])).toEqual([
      title,
      "1000 bp",
      "100 bp",
      "Schematic",
    ]);
    expect(texts[1][3]).toBe(35 + header);
    expect(String(texts[1][5])).toMatch(/^700 12px/);
    expect(String(texts[2][5])).toMatch(/^400 12px/);
    expect(texts[1][4]).toBe("#172238");
  });
});

describe("official reference link", () => {
  it("links only http and https addresses", () => {
    expect(httpUrl("https://www.neb.com/products/n3232")).toBe(
      "https://www.neb.com/products/n3232"
    );
    expect(httpUrl("  http://example.com/a b ")).toBe("http://example.com/a%20b");
    expect(httpUrl("javascript:alert(1)")).toBeNull();
    expect(httpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(httpUrl("ftp://example.com/file")).toBeNull();
    expect(httpUrl("www.neb.com")).toBeNull();
    expect(httpUrl("")).toBeNull();
    expect(httpUrl(undefined)).toBeNull();
    expect(httpUrl(42)).toBeNull();
  });
});

describe("ladder screen", () => {
  let root: Root | null = null;
  beforeEach(() => {
    exported.files.length = 0;
  });
  afterEach(async () => {
    if (root) await act(() => root?.unmount());
    document.body.innerHTML = "";
    root = null;
    vi.restoreAllMocks();
  });
  /** A ladder being made, not yet saved under a name. */
  async function mount(data: Record<string, unknown> = {}) {
    let doc: ToolDocument = {
      id: "draft",
      owner_id: "owner",
      tool_id: "ladders",
      title: "Ladders",
      data,
      schema_version: 1,
      engine_version: "1",
      revision: 0,
      updated_at: "",
    };
    let renderDoc: (next: ToolDocument) => void = () => {};
    const repo = {
      owner: "owner",
      items: [{ doc }],
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
      return createElement(
        ToolContext.Provider,
        { value: { doc: state, repo, documents: [], draft: true } },
        createElement(LadderTool)
      );
    }
    const element = document.createElement("div");
    document.body.appendChild(element);
    root = createRoot(element);
    await act(() => root!.render(createElement(Harness)));
    return { element, bands: () => doc.data.bands as LadderBand[] };
  }
  const click = (element: Element) =>
    act(() => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  const button = (container: Element, text: string) =>
    [...container.querySelectorAll("button")].find(
      (b) => b.textContent === text
    )!;
  const field = (container: Element, label: string) =>
    [...container.querySelectorAll("label")]
      .find((l) => l.querySelector("span")?.textContent === label)!
      .querySelector<HTMLInputElement | HTMLSelectElement>("input, select")!;
  async function type(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string
  ) {
    await act(() => {
      Object.getOwnPropertyDescriptor(
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        "value"
      )!.set!.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  const choose = (select: HTMLSelectElement, value: string) =>
    act(() => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  const blue = (size: number): LadderBand => ({
    size,
    label: String(size),
    color: "#2563eb",
  });

  it("imports a pasted list, says what it could not read, and can be undone", async () => {
    const { element, bands } = await mount();
    await click(button(element, "Paste a list"));
    await type(
      element.querySelector("textarea")!,
      "10,000\n3 kb\n1,000\nabc\n500 bp\n250 kDa"
    );
    const status = element.querySelector(".tool-ladder-x-parsed")!;
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toContain(
      "Bands read: 4 — 10,000, 3,000, 1,000, 500 bp"
    );
    expect(status.textContent).toContain("Not read: 2 — abc, 250 (kDa)");
    expect(status.textContent).toContain("Change the ladder type first");
    await click(button(element, "Replace bands"));
    expect(bands()).toEqual([blue(10000), blue(3000), blue(1000), blue(500)]);
    // The paste box closes; the message keeps the count of unread items.
    expect(element.querySelector("textarea")).toBeNull();
    expect(element.querySelector(".tool-undo")!.textContent).toContain(
      "Bands imported: 4. Not read: 2."
    );
    // All four are drawn, the largest at the top.
    expect(
      [...element.querySelectorAll("svg text")].map((text) => text.textContent)
    ).toEqual(["10000 bp", "3000 bp", "1000 bp", "500 bp"]);
    await click(button(element, "Undo"));
    expect(bands()).toEqual([blue(1000)]);
  });

  it("adds pasted sizes to the bands already there, each size once", async () => {
    const { element, bands } = await mount({ bands: [blue(1000)] });
    await click(button(element, "Paste a list"));
    expect(button(element, "Add to bands").disabled).toBe(true);
    await type(element.querySelector("textarea")!, "1000, 750, 500");
    await click(button(element, "Add to bands"));
    expect(bands()).toEqual([blue(1000), blue(750), blue(500)]);
  });

  it("edits a band's size, label, colour and emphasis without touching the others", async () => {
    const { element, bands } = await mount({
      bands: [blue(1000), { ...blue(500), highlight: true }],
    });
    // The label repeated the size, so it follows the new one.
    await type(field(element, "Band size 1") as HTMLInputElement, "750");
    expect(bands()[0]).toEqual(blue(750));
    await type(field(element, "Band label 1") as HTMLInputElement, "3/4 kb");
    await type(field(element, "Band size 1") as HTMLInputElement, "800");
    expect(bands()[0]).toEqual({ ...blue(800), label: "3/4 kb" });
    // An emptied size is null, never 0.
    await type(field(element, "Band size 1") as HTMLInputElement, "");
    expect(bands()[0].size).toBeNull();
    expect(element.textContent).toContain("Enter positive band sizes.");
    await type(field(element, "Band size 1") as HTMLInputElement, "800");
    const colour = field(element, "Band color 1") as HTMLSelectElement;
    expect([...colour.options].map((option) => option.textContent)).toEqual([
      "Blue",
      "Red",
      "Orange",
      "Green",
      "Purple",
      "Gray",
    ]);
    await choose(colour, "#dc2626");
    await click(element.querySelector('[aria-label="Highlight 1"]')!);
    expect(bands()).toEqual([
      { size: 800, label: "3/4 kb", color: "#dc2626", highlight: true },
      { ...blue(500), highlight: true },
    ]);
    // The diagram draws the chosen colour, heavier for an emphasised band.
    const line = element.querySelector("svg line")!;
    expect(line.getAttribute("stroke")).toBe("#dc2626");
    expect(line.getAttribute("stroke-width")).toBe("7");
    await click(element.querySelector('[aria-label="Remove band 1"]')!);
    expect(bands()).toHaveLength(1);
    await click(button(element, "Undo"));
    expect(bands()).toHaveLength(2);
  });

  it("converts sizes and their labels when the unit changes", async () => {
    const { element, bands } = await mount({
      bands: [blue(1500), { ...blue(500), label: "half" }],
    });
    await choose(field(element, "Band size unit") as HTMLSelectElement, "kb");
    expect(bands()).toEqual([
      { size: 1.5, label: "1.5", color: "#2563eb" },
      { size: 0.5, label: "half", color: "#2563eb" },
    ]);
    await choose(field(element, "Band size unit") as HTMLSelectElement, "bp");
    expect(bands()).toEqual([blue(1500), { ...blue(500), label: "half" }]);
  });

  it("links the official page only when it is a web address", async () => {
    const first = await mount({
      vendor: "NEB",
      catalog: "N3232",
      source: "https://www.neb.com/products/n3232",
    });
    const link = first.element.querySelector<HTMLAnchorElement>(
      ".tool-ladder-x-source a"
    )!;
    expect(link.getAttribute("href")).toBe("https://www.neb.com/products/n3232");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(link.textContent).toContain("www.neb.com");
    expect(first.element.querySelector(".tool-ladder-x-source")!.textContent).toContain(
      "NEB · N3232"
    );
    await act(() => root?.unmount());
    const second = await mount({ source: "javascript:alert(1)" });
    expect(second.element.querySelector("a")).toBeNull();
    expect(second.element.textContent).toContain(
      "starting with https:// or http://"
    );
  });

  it("exports the diagram as a PNG and the bands as CSV under dated names", async () => {
    const drawn: [number, number][] = [];
    const context = new Proxy(
      {},
      { get: () => () => undefined, set: () => true }
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as never
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      function (this: HTMLCanvasElement, callback: BlobCallback) {
        drawn.push([this.width, this.height]);
        callback(new Blob(["png"], { type: "image/png" }));
      }
    );
    const { element } = await mount({ bands: [blue(1000), blue(500)] });
    await act(async () => {
      button(element, "Diagram PNG").dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // Twice the 280 × 420 diagram, with room for the title and the caption.
    expect(drawn).toEqual([[560, (420 + 30 + 28) * 2]]);
    expect(exported.files[0].fileName).toMatch(
      /^buril-ladders-\d{8}-\d{4}\.png$/
    );
    expect(exported.files[0].mimeType).toBe("image/png");
    await act(async () => {
      button(element, "CSV").dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(exported.files[1].fileName).toMatch(
      /^buril-ladders-\d{8}-\d{4}\.csv$/
    );
    expect(String(exported.files[1].content)).toContain(
      '"Size","Label","Unit","Reference band","Color"\r\n"1000","1000","bp","0","#2563eb"'
    );
  });
});
