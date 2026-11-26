// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolContext, format } from "./ui";
import type { Handoff } from "./handoff";
import type { ToolDocument } from "./registry";
import type { ToolRepository } from "./repository";
import CalibrationTool from "./CalibrationTool";
import { exportBlobPartAsFile } from "../../utils/fileExport";
vi.mock("../../utils/fileExport", () => ({
  exportBlobPartAsFile: vi.fn(async () => {}),
}));
const locale = vi.hoisted(() => ({ language: "en" }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: locale, t: (s: string) => s }),
}));
vi.mock("../../locales/i18n", () => ({ default: locale }));
vi.mock("../../services/supabaseClient", () => ({ supabase: {} }));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(() => root?.unmount());
  document.body.innerHTML = "";
  root = null;
  locale.language = "en";
  vi.mocked(exportBlobPartAsFile).mockClear();
});
type Row = { x: string; y: string; excluded: boolean; label?: string };
type SampleRow = { name: string; direction: string; input: string };
const standards = (points: [string, string][]): Row[] =>
  points.map(([x, y]) => ({ x, y, excluded: false }));
async function mount(
  data: Record<string, unknown> = {},
  handoff: Handoff | null = null
) {
  let doc: ToolDocument = {
    id: "doc",
    owner_id: "owner",
    tool_id: "calibration-curve",
    title: "Test",
    data,
    schema_version: 1,
    engine_version: "1",
    revision: 0,
    updated_at: "",
  };
  const element = document.createElement("div");
  document.body.appendChild(element);
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
    const [offer, setOffer] = useState(handoff);
    useEffect(() => {
      renderDoc = setState;
    }, []);
    return (
      <ToolContext.Provider
        value={{
          doc: state,
          repo,
          documents: [],
          handoff: offer,
          clearHandoff: () => setOffer(null),
        }}
      >
        <CalibrationTool />
      </ToolContext.Provider>
    );
  }
  root = createRoot(element);
  await act(() => root!.render(<Harness />));
  const labelled = (label: string) =>
    [...element.querySelectorAll("label")].find(
      (candidate) => candidate.querySelector("span")?.textContent === label
    );
  const setValue = (
    control: HTMLInputElement | HTMLTextAreaElement,
    value: string
  ) =>
    act(() => {
      Object.getOwnPropertyDescriptor(
        control instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        "value"
      )!.set!.call(control, value);
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const screen = {
    element,
    data: () =>
      doc.data as {
        model?: string;
        hillDecreasing?: boolean;
        standards?: Row[];
        samples?: SampleRow[];
        xUnit?: string;
      },
    type: (label: string, value: string) =>
      setValue(
        (labelled(label)!.querySelector("input, textarea") as
          | HTMLInputElement
          | HTMLTextAreaElement)!,
        value
      ),
    typeInto: (ariaLabel: string, value: string) =>
      setValue(
        element.querySelector<HTMLInputElement>(
          `[aria-label="${ariaLabel}"]`
        )!,
        value
      ),
    choose: (label: string, value: string) =>
      act(() => {
        const control = labelled(label)!.querySelector("select")!;
        control.value = value;
        control.dispatchEvent(new Event("change", { bubbles: true }));
      }),
    press: (text: string) =>
      act(() =>
        [...element.querySelectorAll("button")]
          .find((candidate) => candidate.textContent === text)!
          .click()
      ),
    pressLabel: (ariaLabel: string) =>
      act(() =>
        element
          .querySelector<HTMLButtonElement>(`[aria-label="${ariaLabel}"]`)!
          .click()
      ),
    alerts: () =>
      [...element.querySelectorAll('[role="alert"]')].map(
        (node) => node.textContent
      ),
    equation: () =>
      element.querySelector(".tool-calibration-equation")?.textContent ?? null,
    /** The R², RMSE and n figures under the equation, by name. */
    figure: (name: string) =>
      [...element.querySelectorAll(".tool-calibration-fit dl > div")]
        .find((node) => node.querySelector("dt")?.textContent === name)
        ?.querySelector("dd")?.textContent ?? null,
    results: () =>
      [...element.querySelectorAll(".tool-calibration-sample output")].map(
        (node) => node.textContent
      ),
    graph: () =>
      element.querySelector<SVGSVGElement>(
        'svg[aria-label="Calibration graph"]'
      )!,
    residualPlot: () =>
      element.querySelector<SVGSVGElement>('svg[aria-label^="Residuals"]'),
    /** Rows of the table whose header row starts with `first`. */
    table: (first: string) => {
      const table = [...element.querySelectorAll("table")].find(
        (node) => node.querySelector("th")?.textContent === first
      );
      return table
        ? [...table.querySelectorAll("tbody tr")].map((row) =>
            [...row.querySelectorAll("td")].map((cell) => cell.textContent)
          )
        : null;
    },
  };
  return screen;
}

describe("calibration curve", () => {
  it("opens work saved before the new fields with the result it always gave", async () => {
    const screen = await mount({
      model: "linear",
      standards: standards([
        ["0", "1"],
        ["1", "3"],
        ["2", "5"],
      ]),
      samples: [{ name: "Sample 1", direction: "inverse", input: "4" }],
      xLabel: "Concentration",
      yLabel: "Signal",
      xUnit: "",
      yUnit: "",
      logX: false,
      logY: false,
    });
    expect(screen.equation()).toBe("y = 2x + 1");
    expect(screen.results()).toEqual(["1.5"]);
    expect(screen.alerts()).toEqual([]);
    // A saved "hill" stays the increasing curve.
    const hill = await mount({
      model: "hill",
      standards: [0.1, 0.3, 1, 3, 10, 30, 100].map((x) => ({
        x: String(x),
        y: String(5 + (95 * x ** 1.4) / (4 ** 1.4 + x ** 1.4)),
        excluded: false,
      })),
      samples: [{ name: "Sample 1", direction: "inverse", input: "52.5" }],
    });
    expect(hill.equation()).toContain("x^1.4 / (4^1.4 + x^1.4)");
    expect(hill.results()[0]).toBe("4");
  });

  it("treats rows that share an X as replicates and fits every one of them", async () => {
    const screen = await mount({
      standards: standards([
        ["1", "1.9"],
        ["1", "2.1"],
        ["2", "3.9"],
        ["2", "4.1"],
        ["3", "5.9"],
        ["3", "6.1"],
        ["4", "8"],
      ]),
      samples: [{ name: "Sample 1", direction: "inverse", input: "5" }],
    });
    // No complaint about repeated X, and no row marked wrong.
    expect(screen.alerts()).toEqual([]);
    expect(screen.element.querySelector(".is-invalid")).toBeNull();
    expect(screen.element.textContent).toContain("7 included · 4 X levels");
    // Only the levels measured more than once are summarised:
    // SD of 1.9 and 2.1 is √(0.02 / 1) = 0.1414214, CV 7.07%.
    expect(screen.table("Concentration")).toEqual([
      ["1", "2", "2", "0.1414214", "7.07"],
      ["2", "2", "4", "0.1414214", "3.54"],
      ["3", "2", "6", "0.1414214", "2.36"],
    ]);
    expect(screen.element.textContent).toContain(
      "The fit uses every measurement, not the means."
    );
    // All seven measurements are fitted and drawn (the eighth circle is the legend's).
    expect(screen.figure("n")).toBe("7");
    expect(screen.graph().querySelectorAll("circle")).toHaveLength(8);
    // The means lie exactly on y = 2x, so a fit of means would have no RMSE to show.
    expect(screen.equation()).toBe("y = 2x + 0");
    expect(Number(screen.figure("RMSE"))).toBeCloseTo(
      Math.sqrt(0.06 / 5),
      6
    );
  });

  it("reports RMSE on n − p, the same figure on screen and in the CSV, and none when n ≤ p", async () => {
    const screen = await mount({
      standards: standards([
        ["1", "2.2"],
        ["2", "4.1"],
        ["3", "6.2"],
        ["4", "7.9"],
        ["5", "10.1"],
      ]),
    });
    // SSE = 0.044 on 5 − 2 degrees of freedom; √(0.044 / 5) would be 0.0938.
    expect(screen.figure("RMSE")).toBe("0.121106");
    expect(screen.element.textContent).toContain(
      "n − p = 3 degrees of freedom"
    );
    await screen.press("Standards CSV");
    const [text, options] = vi.mocked(exportBlobPartAsFile).mock.calls[0];
    expect(options.fileName).toMatch(
      /^buril-calibration-curve-standards-Test-\d{8}-\d{4}\.csv$/
    );
    const cells = String(text)
      .split("\r\n")
      .map((line) => line.split(",").map((cell) => cell.replaceAll('"', "")));
    const rmse = Number(cells.find((row) => row[0] === "RMSE")![1]);
    expect(rmse).toBeCloseTo(Math.sqrt(0.044 / 3), 10);
    expect(format(rmse)).toBe(screen.figure("RMSE"));
    // Each fitted row carries its fitted value and residual: 2.2 − 2.18.
    expect(cells[0]).toEqual([
      "\uFEFFConcentration",
      "Signal",
      "Excluded",
      "Fitted Y",
      "Residual",
    ]);
    expect(cells[1].slice(0, 4)).toEqual(["1", "2.2", "No", "2.18"]);
    expect(Number(cells[1][4])).toBeCloseTo(0.02, 10);
    expect(cells.find((row) => row[0] === "Points fitted (n)")![1]).toBe("5");
    expect(cells.find((row) => row[0] === "Parameters (p)")![1]).toBe("2");
    // Two points, two parameters: the line passes through both.
    for (const row of [3, 4, 5])
      await screen.pressLabel(`Standard ${row} included in fit`);
    expect(screen.figure("n")).toBe("2");
    expect(screen.figure("RMSE")).toBeNull();
    expect(screen.element.textContent).toContain("RMSE is not shown");
    vi.mocked(exportBlobPartAsFile).mockClear();
    await screen.press("Standards CSV");
    expect(String(vi.mocked(exportBlobPartAsFile).mock.calls[0][0])).not.toContain(
      "RMSE"
    );
  });

  it("fits a decreasing Hill curve and saves it in a form older apps refuse rather than misread", async () => {
    const falling = [0.1, 0.3, 1, 3, 10, 30, 100].map((x) => ({
      x: String(x),
      y: String(5 + 95 / (1 + (x / 4) ** 1.4)),
      excluded: false,
    }));
    const screen = await mount({
      model: "hill",
      standards: falling,
      samples: [{ name: "Sample 1", direction: "inverse", input: "52.5" }],
    });
    // Read as the increasing model, the data are refused.
    expect(screen.alerts()[0]).toBe(
      "Standards do not describe an increasing Hill curve"
    );
    await screen.choose("Fit model", "hill-decreasing");
    expect(screen.data().model).toBe("hill");
    expect(screen.data().hillDecreasing).toBe(true);
    expect(screen.alerts()).toEqual([]);
    expect(screen.equation()).toBe("y = 5 + (100 − 5) / (1 + (x / 4)^1.4)");
    // Halfway between the plateaus is x = K.
    expect(screen.results()).toEqual(["4"]);
    // Above the top plateau there is nothing to invert.
    await screen.type("Signal", "101");
    expect(screen.results()).toEqual(["—"]);
    expect(screen.alerts()).toEqual([
      "Cannot calculate or invert in this range.",
    ]);
    await screen.choose("Fit model", "linear");
    expect(screen.data().model).toBe("linear");
    expect(screen.data().hillDecreasing).toBe(false);
  });

  it("pastes standards with decimal commas and offers to undo the replacement", async () => {
    const screen = await mount();
    await screen.type(
      "Paste two columns",
      "0,5\t0,125\n1\t0,25\n1\t0,27\n2\t0,5"
    );
    await screen.press("Apply standards");
    expect(screen.data().standards).toEqual(
      standards([
        ["0.5", "0.125"],
        ["1", "0.25"],
        ["1", "0.27"],
        ["2", "0.5"],
      ])
    );
    expect(screen.alerts()).toEqual([]);
    expect(screen.figure("n")).toBe("4");
    await screen.press("Undo");
    expect(screen.data().standards).toEqual(
      standards([
        ["0", "1"],
        ["1", "3"],
        ["2", "5"],
      ])
    );
  });

  it("asks how to read 1,000 instead of guessing, then reads the whole paste that way", async () => {
    const screen = await mount();
    await screen.type("Paste two columns", "1,000\t15,234\n2,000\t31,871");
    await screen.press("Apply standards");
    // Nothing is applied until the question is answered.
    expect(screen.data().standards).toBeUndefined();
    expect(screen.alerts()[0]).toContain("“1,000” could be a decimal");
    await screen.press("Thousands: 1000");
    expect(screen.data().standards).toEqual(
      standards([
        ["1000", "15234"],
        ["2000", "31871"],
      ])
    );
    expect(screen.element.querySelector(".tool-calibration-x-ask")).toBeNull();
    await screen.press("Apply standards");
    await screen.press("Decimal: 1.000");
    expect(screen.data().standards![1]).toMatchObject({
      x: "2.000",
      y: "31.871",
    });
  });

  it("reads a typed decimal comma and waits for empty cells without calling them errors", async () => {
    const screen = await mount();
    await screen.typeInto("Standard 2 x", "0,5");
    // (0, 1), (0.5, 3), (2, 5): slope 22/13, as a decimal comma, not as "0" and "5".
    expect(screen.alerts()).toEqual([]);
    expect(screen.figure("n")).toBe("3");
    await screen.type("Signal", "2,5");
    expect(screen.results()[0]).not.toBe("—");
    // A grouped thousand is not guessed.
    await screen.typeInto("Standard 2 x", "1,000");
    expect(screen.alerts()).toContain("Invalid standard row");
    expect(
      screen.element
        .querySelector('[aria-label="Standard 2 x"]')
        ?.getAttribute("aria-invalid")
    ).toBe("true");
    // An empty cell is something still to enter.
    await screen.typeInto("Standard 2 x", "");
    expect(screen.alerts()).toEqual([]);
    expect(screen.element.querySelector(".is-invalid")).toBeNull();
    expect(screen.element.textContent).toContain(
      "1 standard has an empty value."
    );
    expect(screen.equation()).toBeNull();
    // Switched off, the row no longer holds the fit back.
    await screen.pressLabel("Standard 2 included in fit");
    expect(screen.equation()).toBe("y = 2x + 1");
  });

  it("adds several pasted samples at once", async () => {
    const screen = await mount({
      samples: [{ name: "Sample 1", direction: "inverse", input: "3" }],
    });
    await screen.type(
      "One sample per line (Y, or name and Y)",
      "Serum A\t2\nSerum B\t4,5\n\t5\nSerum C\tOVER"
    );
    await screen.press("Add pasted samples");
    expect(screen.data().samples).toEqual([
      { name: "Sample 1", direction: "inverse", input: "3" },
      { name: "Serum A", direction: "inverse", input: "2" },
      { name: "Serum B", direction: "inverse", input: "4.5" },
      // No name on the line: numbered after the ones before it.
      { name: "Sample 4", direction: "inverse", input: "5" },
      { name: "Serum C", direction: "inverse", input: "OVER" },
    ]);
    // y = 2x + 1: 3 → 1, 2 → 0.5, 4.5 → 1.75, 5 → 2.
    expect(screen.results()).toEqual(["1", "0.5", "1.75", "2", "—"]);
    expect(screen.alerts()).toEqual(["Invalid number"]);
    // The results are also one table, ready to copy back to a spreadsheet.
    expect(screen.table("Sample")).toEqual([
      ["Sample 1", "Y → X", "3", "1", ""],
      ["Serum A", "Y → X", "2", "0.5", ""],
      ["Serum B", "Y → X", "4.5", "1.75", ""],
      ["Sample 4", "Y → X", "5", "2", ""],
      ["Serum C", "Y → X", "OVER", "—", "Cannot calculate"],
    ]);
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await screen.press("Copy results table");
    expect(writeText).toHaveBeenCalledWith(
      [
        "Sample\tDirection\tInput\tResult\tNote",
        "Sample 1\tY → X\t3\t1\t",
        "Serum A\tY → X\t2\t0.5\t",
        "Serum B\tY → X\t4.5\t1.75\t",
        "Sample 4\tY → X\t5\t2\t",
        "Serum C\tY → X\tOVER\t\tCannot calculate",
      ].join("\n")
    );
    vi.unstubAllGlobals();
    await screen.press("Undo");
    expect(screen.data().samples).toHaveLength(1);
  });

  it("marks samples outside the standards on the graph and in the tables", async () => {
    const screen = await mount({
      samples: [
        { name: "Inside", direction: "inverse", input: "4" },
        { name: "Beyond", direction: "inverse", input: "6" },
        { name: "Below", direction: "forward", input: "-0.5" },
      ],
    });
    const diamonds = () =>
      [...screen.graph().querySelectorAll("g[clip-path] rect")].map((mark) => ({
        title: mark.querySelector("title")?.textContent,
        hollow: mark.getAttribute("data-extrapolated") === "",
        fill: mark.getAttribute("fill"),
      }));
    // x = 1.5 is between the standards (0 … 2); 2.5 and −0.5 are not.
    expect(diamonds()).toEqual([
      { title: "Inside: X = 1.5, Y = 4", hollow: false, fill: "#d97706" },
      {
        title: "Beyond: X = 2.5, Y = 6 · Extrapolated",
        hollow: true,
        fill: "white",
      },
      {
        title: "Below: X = -0.5, Y = 0 · Extrapolated",
        hollow: true,
        fill: "white",
      },
    ]);
    const texts = () =>
      [...screen.graph().querySelectorAll("text")].map(
        (node) => node.textContent
      );
    // One label per hollow diamond, and the legend names the shape.
    expect(texts().filter((text) => text === "Extrapolated")).toHaveLength(3);
    // The curve runs on to them dashed, since nothing was measured there.
    expect(
      screen.graph().querySelectorAll("polyline[stroke-dasharray]")
    ).toHaveLength(2);
    expect(screen.table("Sample")).toEqual([
      ["Inside", "Y → X", "4", "1.5", ""],
      ["Beyond", "Y → X", "6", "2.5", "Outside standard range (extrapolation)"],
      ["Below", "X → Y", "-0.5", "0", "Outside standard range (extrapolation)"],
    ]);
    // The graph's own table lists standards and samples with the same mark.
    expect(screen.table("Kind")).toEqual([
      ["Standard", "1", "0", "1", ""],
      ["Standard", "2", "1", "3", ""],
      ["Standard", "3", "2", "5", ""],
      ["Sample", "Inside", "1.5", "4", ""],
      ["Sample", "Beyond", "2.5", "6", "Extrapolated"],
      ["Sample", "Below", "-0.5", "0", "Extrapolated"],
    ]);
    // With every sample inside, no hollow mark, dash or legend entry is left.
    await screen.typeInto("Sample name 2", "Beyond");
    for (const input of screen.element.querySelectorAll<HTMLInputElement>(
      ".tool-calibration-conversion input"
    ))
      await act(() => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )!.set!.call(input, "1");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    expect(diamonds().some((mark) => mark.hollow)).toBe(false);
    expect(texts()).not.toContain("Extrapolated");
    expect(
      screen.graph().querySelectorAll("polyline[stroke-dasharray]")
    ).toHaveLength(0);
  });

  it("leaves a sample far beyond the standards off the graph and says so", async () => {
    const screen = await mount({
      samples: [{ name: "Far", direction: "inverse", input: "101" }],
    });
    // x = 50 against standards from 0 to 2.
    expect(screen.results()).toEqual(["50"]);
    expect(screen.graph().querySelectorAll("g[clip-path] rect")).toHaveLength(
      0
    );
    expect(screen.element.textContent).toContain(
      "1 sample far outside the standard range is not drawn."
    );
    expect(
      screen.element.querySelector(".tool-calibration-extrapolation")
    ).not.toBeNull();
  });

  it("plots residuals against X in a figure of its own, with a table", async () => {
    const screen = await mount({
      standards: standards([
        ["1", "2.2"],
        ["2", "4.1"],
        ["3", "6.2"],
        ["4", "7.9"],
        ["5", "10.1"],
        ["9", ""],
      ]).map((row, index) => (index === 5 ? { ...row, excluded: true } : row)),
    });
    const plot = screen.residualPlot()!;
    expect(plot).not.toBe(screen.graph());
    expect(plot.querySelectorAll("circle.tool-chart-dot")).toHaveLength(5);
    // A zero line to judge the scatter against, and no line through the dots.
    expect(plot.querySelectorAll("line.tool-chart-rule")).toHaveLength(1);
    expect(plot.querySelector("path.tool-chart-line")).toBeNull();
    // Fitted y = 1.96x + 0.22; residual = measured − fitted.
    expect(screen.table("Standard")).toEqual([
      ["1", "1", "2.2", "2.18", "0.02"],
      ["2", "2", "4.1", "4.14", "-0.04"],
      ["3", "3", "6.2", "6.1", "0.1"],
      ["4", "4", "7.9", "8.06", "-0.16"],
      ["5", "5", "10.1", "10.02", "0.08"],
    ]);
    // An exact fit shows zeros, not floating-point residue.
    const exact = await mount();
    expect(exact.table("Standard")!.map((row) => row[4])).toEqual([
      "0",
      "0",
      "0",
    ]);
    expect(exact.element.innerHTML).not.toContain("NaN");
  });

  it("adds a plate layout as standards to measure and samples to name, and can undo it", async () => {
    const screen = await mount(
      {
        standards: standards([
          ["0", "1"],
          ["1", "3"],
        ]),
        samples: [{ name: "Old", direction: "inverse", input: "2" }],
      },
      {
        kind: "table",
        value: 0,
        unit: "µg/mL",
        label: "96-well layout",
        source: "plate-labelling",
        rows: [
          ["blank", "A1", ""],
          ["standard", "A2", "125"],
          ["standard", "A3", "125"],
          ["standard", "A4 · BSA", "250"],
          ["sample", "B1 · Serum 7", ""],
          ["sample", "B2", ""],
          ["other", "C1", "9"],
        ],
      }
    );
    expect(
      screen.element.querySelector(".tool-handoff")?.textContent
    ).toContain("96-well layout");
    await screen.press("Apply");
    expect(screen.element.querySelector(".tool-handoff")).toBeNull();
    // What was there stays; each well is a row, so one X repeats.
    expect(screen.data().standards).toEqual([
      { x: "0", y: "1", excluded: false },
      { x: "1", y: "3", excluded: false },
      { x: "0", y: "", excluded: false, label: "A1" },
      { x: "125", y: "", excluded: false, label: "A2" },
      { x: "125", y: "", excluded: false, label: "A3" },
      { x: "250", y: "", excluded: false, label: "A4 · BSA" },
    ]);
    expect(screen.data().samples).toEqual([
      { name: "Old", direction: "inverse", input: "2" },
      { name: "B1 · Serum 7", direction: "inverse", input: "" },
      { name: "B2", direction: "inverse", input: "" },
    ]);
    expect(screen.data().xUnit).toBe("µg/mL");
    // The rows wait for their Y values; that is not an error.
    expect(screen.alerts()).toEqual([]);
    expect(screen.element.textContent).toContain(
      "4 standards have an empty value."
    );
    expect(
      [...screen.element.querySelectorAll(".tool-calibration-x-well")].map(
        (node) => node.textContent
      )
    ).toEqual(["A1", "A2", "A3", "A4 · BSA"]);
    await screen.press("Undo");
    expect(screen.data().standards).toHaveLength(2);
    expect(screen.data().samples).toHaveLength(1);
    expect(screen.data().xUnit).toBe("");
  });

  it("lets a plate layout or pasted samples take the place of the untouched example", async () => {
    const layout: Handoff = {
      kind: "table",
      value: 0,
      unit: "ng/mL",
      label: "Layout",
      source: "plate-labelling",
      rows: [
        ["standard", "A1", "10"],
        ["sample", "B1", ""],
      ],
    };
    // A new document shows three made-up standards and one sample. They are
    // not the user's, and must not sit in a fit beside real wells.
    const fresh = await mount({}, layout);
    await fresh.press("Apply");
    expect(fresh.data().standards).toEqual([
      { x: "10", y: "", excluded: false, label: "A1" },
    ]);
    expect(fresh.data().samples).toEqual([
      { name: "B1", direction: "inverse", input: "" },
    ]);
    expect(
      fresh.element.querySelector(".tool-undo")?.textContent
    ).toContain("The example values were removed.");
    await fresh.press("Undo");
    expect(fresh.data().standards).toHaveLength(3);
    expect(fresh.data().samples).toEqual([
      { name: "Sample 1", direction: "inverse", input: "6" },
    ]);
    // One edited value makes the rows the user's own: they are kept.
    const edited = await mount({}, layout);
    await edited.typeInto("Standard 3 y", "5.2");
    await edited.press("Apply");
    expect(edited.data().standards).toHaveLength(4);
    // A layout with standards only leaves the samples alone, example or not.
    const standardsOnly = await mount(
      {},
      { ...layout, rows: [["standard", "A1", "10"]] }
    );
    await standardsOnly.press("Apply");
    expect(standardsOnly.data().samples).toHaveLength(1);
    // Pasted samples replace the example sample the same way.
    const pasted = await mount();
    await pasted.type("One sample per line (Y, or name and Y)", "3\n4");
    await pasted.press("Add pasted samples");
    expect(pasted.data().samples).toEqual([
      { name: "Sample 1", direction: "inverse", input: "3" },
      { name: "Sample 2", direction: "inverse", input: "4" },
    ]);
  });

  it("offers nothing for a value that is not a table", async () => {
    const screen = await mount(
      {},
      {
        kind: "concentration",
        value: 5,
        unit: "mM",
        label: "Stock",
        source: "molarity",
      }
    );
    expect(screen.element.querySelector(".tool-handoff")).toBeNull();
  });

  it("shows no Korean on the English screen and no English sentences on the Korean one", async () => {
    const data = {
      model: "hill",
      hillDecreasing: true,
      standards: [0.1, 0.3, 1, 3, 10, 30, 100].flatMap((x) =>
        [1.01, 0.99].map((noise) => ({
          x: String(x),
          y: String((5 + 95 / (1 + (x / 4) ** 1.4)) * noise),
          excluded: false,
        }))
      ),
      samples: [
        { name: "S1", direction: "inverse", input: "50" },
        { name: "S2", direction: "inverse", input: "5.2" },
      ],
    };
    const english = await mount(data);
    expect(english.equation()).toContain("/ (1 + (x / ");
    expect(english.element.textContent).not.toMatch(/[가-힣]/);
    locale.language = "ko";
    const korean = await mount(data);
    const text = korean.element.textContent ?? "";
    expect(text).toContain("감소형 Hill (4PL)");
    expect(text).toContain("반복 측정");
    expect(text).toContain("적합에는 평균이 아니라 측정값을 하나씩 모두 사용합니다.");
    expect(text).toContain("잔차");
    expect(text).not.toMatch(
      /Replicates|Residuals|Extrapolated|measurements|Paste several/
    );
  });
});
