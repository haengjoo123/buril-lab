// @vitest-environment jsdom
import { act, useState, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it, expect, vi } from "vitest";
import { ToolContext } from "./ui";
import type { ToolDocument, ToolId } from "./registry";
import type { ToolRepository } from "./repository";
import type { Handoff } from "./handoff";
import MixTool from "./MixTool";
import { searchChemical } from "../../services/searchService";
import { exportBlobPartAsFile } from "../../utils/fileExport";
vi.mock("../../services/searchService", () => ({ searchChemical: vi.fn() }));
vi.mock("../../utils/fileExport", () => ({ exportBlobPartAsFile: vi.fn() }));
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

type Row = Record<string, unknown>;
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(() => root?.unmount());
  document.body.innerHTML = "";
  root = null;
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
async function mount(
  children: ReactNode,
  {
    data = {},
    toolId = "master-mix",
    documents = [],
    handoff = null,
  }: {
    data?: Record<string, unknown>;
    toolId?: ToolId;
    documents?: ToolDocument[];
    handoff?: Handoff | null;
  } = {}
) {
  let doc = document_("doc", toolId, "Test", data);
  const element = document.createElement("div");
  document.body.appendChild(element);
  let renderDoc: (next: ToolDocument) => void = () => {};
  const clearHandoff = vi.fn();
  const repo = {
    owner: "owner",
    items: [{ doc }],
    create: vi.fn(async () => {}),
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
      <ToolContext.Provider
        value={{ doc: state, repo, documents, handoff, clearHandoff }}
      >
        {children}
      </ToolContext.Provider>
    );
  }
  root = createRoot(element);
  await act(() => root!.render(<Harness />));
  return {
    element,
    clearHandoff,
    data: () => doc.data,
    rows: () => doc.data.rows as Row[],
  };
}
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
const mixRows = (element: Element) => [
  ...element.querySelectorAll(".tool-mix-x-row"),
];
const totals = (element: Element) =>
  [...element.querySelectorAll(".tool-mix-total output")].map(
    (node) => node.textContent
  );
const summary = (element: Element) =>
  Object.fromEntries(
    [...element.querySelectorAll(".tool-mix-x-summary > div")].map((div) => [
      div.querySelector("dt")!.textContent,
      div.querySelector("dd")!.textContent,
    ])
  );
const statuses = (element: Element) =>
  [...element.querySelectorAll('[role="status"]')]
    .map((node) => node.textContent)
    .join(" | ");

describe("master mix", () => {
  it("opens a document saved before the new fields with the same totals and no fill row", async () => {
    const { element } = await mount(<MixTool />, {
      data: {
        count: 8,
        excess: 10,
        baseVolume: 100,
        targetVolume: 100,
        rows: [
          { id: "1", name: "Buffer", amount: 2.5, unit: "µL", checked: false },
          { id: "2", name: "Enzyme", amount: 0.25, unit: "µL", checked: false },
          { id: "3", name: "BSA", amount: 1, unit: "mg", checked: false },
        ],
      },
    });
    // 8 reactions + 10 % = ×8.8: 2.5 → 22 µL, 0.25 → 2.2 µL, 1 → 8.8 mg.
    expect(totals(element)).toEqual(["22 µL", "2.2 µL", "8.8 mg"]);
    expect(element.querySelector(".tool-mix-x-fill")).toBeNull();
    expect(element.querySelector('[role="alert"]')).toBeNull();
    // Volumes only: 2.5 + 0.25 = 2.75 µL per reaction, × 8.8 = 24.2 µL.
    expect(summary(element)).toEqual({
      "Total per reaction": "2.75 µL",
      "Master mix total": "24.2 µL",
      "Dispense per tube": "2.75 µL",
    });
    expect(element.textContent).toContain("not counted in the volumes");
  });
  it("asks for a value in a new row instead of reporting an error", async () => {
    const { element, rows } = await mount(<MixTool />, {
      data: {
        count: 4,
        excess: 0,
        rows: [
          { id: "1", name: "Buffer", amount: 2.5, unit: "µL", checked: false },
        ],
      },
    });
    expect(button(element, "CSV").disabled).toBe(false);
    await click(button(element, "Add component"));
    expect(rows()[1].amount).toBeNull();
    expect(totals(element)).toEqual(["10 µL", "— µL"]);
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(statuses(element)).toContain("Fill in the empty fields");
    expect(button(element, "CSV").disabled).toBe(true);
    // Clearing the number of reactions is also something to enter, not an error.
    await input(field(element, "Reactions"), "");
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(statuses(element)).toContain("Enter the number of reactions");
    await input(field(element, "Reactions"), "2.5");
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      "Reaction count must be an integer"
    );
  });
  it("enters a component by concentration, fills to the reaction volume and sets per-tube components apart", async () => {
    const { element, rows, data } = await mount(<MixTool />, {
      data: {
        count: 8,
        excess: 10,
        rows: [
          { id: "1", name: "Buffer", amount: 5, unit: "µL", checked: false },
        ],
      },
    });
    await input(field(element, "Reaction volume (µL, optional)"), "25");
    expect(data().reactionVolume).toBe(25);
    // Water: 25 − 5 = 20 µL per reaction, × 8.8 = 176 µL.
    expect(totals(element)).toEqual(["44 µL", "176 µL"]);
    await click(button(element, "Add component"));
    await click(button(mixRows(element)[1], "By concentration"));
    expect(element.querySelector('[role="alert"]')).toBeNull();
    await input(field(mixRows(element)[1], "Stock"), "10");
    await input(field(mixRows(element)[1], "Final"), "0.4");
    // 0.4 ÷ 10 × 25 µL = 1 µL per reaction, × 8.8 = 8.8 µL.
    expect(rows()[1]).toMatchObject({
      mode: "concentration",
      stock: 10,
      final: 0.4,
      concUnit: "X",
      // Kept for builds of the app that only read `amount` and `unit`.
      amount: 1,
      unit: "µL",
    });
    expect(mixRows(element)[1].textContent).toContain("Per reaction 1 µL");
    // Water is now 25 − 5 − 1 = 19 µL, × 8.8 = 167.2 µL.
    expect(totals(element)).toEqual(["44 µL", "8.8 µL", "167.2 µL"]);
    expect(summary(element)).toEqual({
      "Total per reaction": "25 µL",
      "Master mix total": "220 µL",
      "Dispense per tube": "25 µL",
    });
    await click(button(mixRows(element)[1], "Add per tube"));
    expect(rows()[1].perTube).toBe(true);
    // The row shows what goes into each tube; the mix is 24 µL × 8.8 = 211.2 µL.
    expect(totals(element)).toEqual(["44 µL", "1 µL", "167.2 µL"]);
    expect(summary(element)).toEqual({
      "Total per reaction": "25 µL",
      "Master mix total": "211.2 µL",
      "Dispense per tube": "24 µL",
      "Added per tube": "1 µL",
    });
    // 30 + 1 µL do not fit in 25 µL.
    await input(field(mixRows(element)[0], "Per reaction"), "30");
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      "Components exceed the reaction volume"
    );
    expect(button(element, "CSV").disabled).toBe(true);
  });
  it("marks master mix rows as done and clears the marks when the number of reactions changes", async () => {
    const { element, rows, data } = await mount(<MixTool />, {
      data: {
        count: 8,
        excess: 10,
        rows: [
          { id: "1", name: "Buffer", amount: 5, unit: "µL", checked: false },
        ],
      },
    });
    await click(button(mixRows(element)[0], "Done"));
    expect(rows()[0].checked).toBe(true);
    await input(field(element, "Reactions"), "16");
    expect(rows()[0].checked).toBe(false);
    expect(statuses(element)).toContain("Done marks were cleared");
    await click(button(element, "Undo"));
    expect(data().count).toBe(8);
    expect(rows()[0].checked).toBe(true);
  });
  it("applies a reaction count sent from another tool", async () => {
    const { element, data, clearHandoff } = await mount(<MixTool />, {
      handoff: {
        kind: "count",
        value: 24,
        unit: "wells",
        label: "Labelled wells",
        source: "plate-labelling",
      },
    });
    expect(element.querySelector(".tool-handoff")?.textContent).toContain(
      "Labelled wells 24 wells"
    );
    await click(button(element, "Apply"));
    expect(data().count).toBe(24);
    expect(clearHandoff).toHaveBeenCalled();
  });
  it("loads a composition from this tool's saved work and undoes it", async () => {
    const { element, rows, data } = await mount(<MixTool />, {
      data: {
        count: 2,
        excess: 0,
        rows: [{ id: "1", name: "Mine", amount: 1, unit: "µL", checked: true }],
      },
      documents: [
        document_("saved", "master-mix", "qPCR", {
          count: 12,
          excess: 5,
          reactionVolume: 20,
          fillChecked: true,
          rows: [
            { id: "a", name: "SYBR", amount: 10, unit: "µL", checked: true },
          ],
        }),
        document_("other", "medium-buffer", "PBS", { rows: [] }),
        // The open document is not a source for itself.
        document_("doc", "master-mix", "Test", {}),
      ],
    });
    const select = field<HTMLSelectElement>(
      element,
      "Load composition from saved work"
    );
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "Select",
      "qPCR",
    ]);
    await choose(select, "saved");
    expect(data()).toMatchObject({
      count: 12,
      excess: 5,
      reactionVolume: 20,
      fillChecked: false,
    });
    expect(rows()).toHaveLength(1);
    // The copy is a new preparation: its own row ids, nothing ticked.
    expect(rows()[0]).toMatchObject({ name: "SYBR", amount: 10, checked: false });
    expect(rows()[0].id).not.toBe("a");
    expect(statuses(element)).toContain('Loaded the composition of "qPCR"');
    await click(button(element, "Undo"));
    expect(data()).toMatchObject({ count: 2, excess: 0, reactionVolume: null });
    expect(rows()).toEqual([
      { id: "1", name: "Mine", amount: 1, unit: "µL", checked: true },
    ]);
  });
  it("removes a component, the last one included, and puts it back on undo", async () => {
    const { element, rows } = await mount(<MixTool />, {
      data: {
        rows: [
          { id: "1", name: "Buffer", amount: 5, unit: "µL", checked: false },
          { id: "2", name: "Enzyme", amount: 1, unit: "µL", checked: false },
        ],
      },
    });
    await click(
      element.querySelector<HTMLButtonElement>(
        '[aria-label="Remove component 1"]'
      )!
    );
    expect(rows().map((row) => row.name)).toEqual(["Enzyme"]);
    await click(button(element, "Undo"));
    expect(rows().map((row) => row.name)).toEqual(["Buffer", "Enzyme"]);
    for (let left = 2; left > 0; left--)
      await click(
        element.querySelector<HTMLButtonElement>(
          '[aria-label="Remove component 1"]'
        )!
      );
    expect(rows()).toEqual([]);
    expect(element.textContent).toContain("No components yet");
    expect(button(element, "CSV").disabled).toBe(true);
    await click(button(element, "Undo"));
    expect(rows().map((row) => row.name)).toEqual(["Enzyme"]);
  });
  it("exports the table under a dated file name and copies it as a table", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { element } = await mount(<MixTool />, {
      data: {
        count: 4,
        excess: 0,
        rows: [
          { id: "1", name: "Buffer", amount: 2.5, unit: "µL", checked: false },
        ],
      },
    });
    await click(button(element, "CSV"));
    const [text, options] = vi.mocked(exportBlobPartAsFile).mock.calls[0];
    expect(options.fileName).toMatch(
      /^buril-master-mix-Test-\d{8}-\d{4}\.csv$/
    );
    // The columns that were always there come first.
    expect(String(text)).toContain('"Component","Total","Unit","Per reaction"');
    expect(String(text)).toContain(
      '"Buffer","10","µL","2.5","µL","","","","No","No"'
    );
    expect(String(text)).toContain('"Master mix total","10","µL","2.5","µL"');
    await click(button(element, "Copy table"));
    // Columns no row uses (stock, final, concentration unit) are left out.
    expect(writeText).toHaveBeenCalledWith(
      [
        "Component\tTotal\tUnit\tPer reaction\tPer-reaction unit\tAdd per tube\tDone",
        "Buffer\t10\tµL\t2.5\tµL\tNo\tNo",
        "Master mix total\t10\tµL\t2.5\tµL\t\t",
      ].join("\n")
    );
  });
});
describe("medium / buffer", () => {
  it("scales a recipe saved before the new fields and clears done marks when the target volume changes", async () => {
    const { element, rows, data } = await mount(<MixTool medium />, {
      toolId: "medium-buffer",
      data: {
        count: 1,
        excess: 10,
        baseVolume: 100,
        targetVolume: 250,
        rows: [
          { id: "1", name: "NaCl", amount: 0.8, unit: "g", checked: true },
          { id: "2", name: "Tween", amount: 50, unit: "µL", checked: false },
        ],
      },
    });
    // ×2.5: 0.8 g → 2 g, 50 µL → 125 µL.
    expect(totals(element)).toEqual(["2 g", "125 µL"]);
    expect(field<HTMLSelectElement>(element, "Volume unit").value).toBe("mL");
    await input(field(element, "Target volume"), "500");
    // ×5: 0.8 g → 4 g.
    expect(totals(element)).toEqual(["4 g", "250 µL"]);
    expect(rows()[0].checked).toBe(false);
    expect(statuses(element)).toContain("Done marks were cleared");
    await click(button(element, "Undo"));
    expect(data().targetVolume).toBe(250);
    expect(rows()[0].checked).toBe(true);
    expect(totals(element)).toEqual(["2 g", "125 µL"]);
    // Clearing the field asks for the volume; the rows wait without an error.
    await input(field(element, "Target volume"), "");
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(statuses(element)).toContain(
      "Enter the reference and target volumes"
    );
    expect(totals(element)).toEqual(["— g", "— µL"]);
  });
  it("works out a mass from a molar concentration with a looked-up molecular weight", async () => {
    vi.mocked(searchChemical).mockResolvedValueOnce({
      id: "nacl",
      name: "Sodium chloride",
      casNumber: "7647-14-5",
      molecularFormula: "NaCl",
      molecularWeight: 58.44,
    });
    const { element, rows } = await mount(<MixTool medium />, {
      toolId: "medium-buffer",
      data: {
        baseVolume: 100,
        targetVolume: 500,
        rows: [{ id: "1", name: "", amount: 1, unit: "g", checked: false }],
      },
    });
    await click(button(element, "By final concentration"));
    // Nothing to work out yet, so the amount typed before is still there.
    expect(rows()[0]).toMatchObject({
      mode: "concentration",
      concUnit: "g/L",
      amount: 1,
    });
    expect(totals(element)).toEqual(["—"]);
    await input(field(element, "Final concentration"), "8");
    // 8 g/L for 500 mL = 4 g; for the 100 mL reference, 0.8 g.
    expect(totals(element)).toEqual(["4 g"]);
    expect(rows()[0]).toMatchObject({ amount: 0.8, unit: "g" });
    await choose(field<HTMLSelectElement>(element, "Unit"), "mM");
    await input(field(element, "Final concentration"), "150");
    // No molecular weight yet: something to enter, not an error.
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(totals(element)).toEqual(["—"]);
    expect(statuses(element)).toContain("Fill in the empty fields");
    await input(
      element.querySelector<HTMLInputElement>('[aria-label="Search reagent"]')!,
      "NaCl"
    );
    await act(async () =>
      element
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    await click(button(element, "Use this molecular weight"));
    expect(rows()[0]).toMatchObject({ mw: 58.44, name: "Sodium chloride" });
    expect(field(element, "MW (g/mol)").value).toBe("58.44");
    // 150 mM × 58.44 g/mol × 0.5 L = 4.383 g.
    expect(totals(element)).toEqual(["4.383 g"]);
    // In litres the same numbers mean 500 L: 0.15 × 58.44 × 500 = 4383 g.
    await choose(field<HTMLSelectElement>(element, "Volume unit"), "L");
    expect(totals(element)).toEqual(["4,383 g"]);
    // 1X from a 50X stock for 500 L: 500 ÷ 50 = 10 L.
    await choose(field<HTMLSelectElement>(element, "Unit"), "X");
    await input(field(element, "Final concentration"), "1");
    await input(field(element, "Stock (X)"), "50");
    expect(totals(element)).toEqual(["10 L"]);
  });
  it("shows the default preparation steps, stores them once used and resets every check with undo", async () => {
    const { element, rows, data } = await mount(<MixTool medium />, {
      toolId: "medium-buffer",
      data: {
        baseVolume: 100,
        targetVolume: 250,
        rows: [{ id: "1", name: "NaCl", amount: 0.8, unit: "g", checked: true }],
      },
    });
    const texts = () =>
      [
        ...element.querySelectorAll<HTMLTextAreaElement>(
          ".tool-mix-x-steps textarea"
        ),
      ].map((area) => area.value);
    expect(texts()).toEqual([
      "Dissolve the components in about 80% of the final volume.",
      "Adjust the pH.",
      "Bring to the final volume.",
      "Sterilise or filter.",
    ]);
    // A document without steps keeps none until one is used.
    expect(data().steps).toBeUndefined();
    expect(element.textContent).toContain("80% of the target volume: 200 mL");
    await click(
      element.querySelector<HTMLButtonElement>(
        '.tool-mix-x-steps [role="checkbox"]'
      )!
    );
    const steps = () => data().steps as { text: string; checked: boolean }[];
    expect(steps().map((step) => step.checked)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    await click(button(element, "Add step"));
    expect(steps()).toHaveLength(5);
    await click(
      element.querySelector<HTMLButtonElement>('[aria-label="Remove step 2"]')!
    );
    expect(steps().map((step) => step.text)).not.toContain("Adjust the pH.");
    await click(button(element, "Undo"));
    expect(steps()[1].text).toBe("Adjust the pH.");
    await click(button(element, "Reset all checks"));
    expect(rows()[0].checked).toBe(false);
    expect(steps().some((step) => step.checked)).toBe(false);
    expect(button(element, "Reset all checks").disabled).toBe(true);
    await click(button(element, "Undo"));
    expect(rows()[0].checked).toBe(true);
    expect(steps()[0].checked).toBe(true);
  });
});
