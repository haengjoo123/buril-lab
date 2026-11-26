// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolContext, download, report } from "./ui";
import type { Handoff } from "./handoff";
import type { ToolDocument, ToolId } from "./registry";
import type { ToolRepository } from "./repository";
import type { Well } from "./plate";
import PlateTool from "./PlateTool";
const locale = vi.hoisted(() => ({ language: "en" }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: locale, t: (s: string) => s }),
}));
vi.mock("../../locales/i18n", () => ({ default: locale }));
vi.mock("../../services/supabaseClient", () => ({ supabase: {} }));
// The exports are checked by what they are asked to write, not by writing files.
vi.mock("./ui", async (original) => ({
  ...(await original<typeof import("./ui")>()),
  report: vi.fn(async () => {}),
  download: vi.fn(async () => {}),
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(() => root?.unmount());
  document.body.innerHTML = "";
  root = null;
  locale.language = "en";
  vi.clearAllMocks();
});
const well = (fields: Partial<Well> = {}): Well => ({
  sample: "",
  condition: "",
  replicate: "",
  color: "#bfdbfe",
  ...fields,
});
async function mount({
  data = {},
  sendTo,
  draft = false,
}: {
  data?: Record<string, unknown>;
  sendTo?: (tool: ToolId, handoff: Handoff) => void;
  draft?: boolean;
} = {}) {
  let doc: ToolDocument = {
    id: "doc",
    owner_id: "owner",
    tool_id: "plate-labelling",
    title: "Run 3",
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
    useEffect(() => {
      renderDoc = setState;
    }, []);
    return (
      <ToolContext.Provider
        value={{ doc: state, repo, documents: [], draft, sendTo }}
      >
        <PlateTool />
      </ToolContext.Provider>
    );
  }
  root = createRoot(element);
  await act(() => root!.render(<Harness />));
  const cell = (name: string) =>
    element.querySelector<HTMLButtonElement>(`[data-well="${name}"]`)!;
  const buttons = (within: ParentNode = element) => [
    ...within.querySelectorAll("button"),
  ];
  const button = (text: string, within: ParentNode = element) =>
    buttons(within).find((candidate) => candidate.textContent === text)!;
  const labelled = (label: string) =>
    element.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  /** The group of buttons under a legend ("Role", "Fields to apply"). */
  const group = (legend: string) =>
    [...element.querySelectorAll("fieldset")].find(
      (candidate) => candidate.querySelector("legend")?.textContent === legend
    )!;
  const field = (label: string) =>
    [...element.querySelectorAll("label")].find(
      (candidate) => candidate.querySelector("span")?.textContent === label
    )?.control as HTMLInputElement;
  const pointer = (
    type: string,
    target: EventTarget,
    init: MouseEventInit & { pointerType?: string } = {}
  ) =>
    act(() => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, ...init });
      Object.defineProperty(event, "pointerType", {
        value: init.pointerType ?? "mouse",
      });
      target.dispatchEvent(event);
    });
  return {
    element,
    data: () => doc.data,
    wells: () => doc.data.wells as Record<string, Well>,
    cell,
    button,
    labelled,
    group,
    field,
    selected: () =>
      [
        ...element.querySelectorAll<HTMLElement>(
          '[role="gridcell"][aria-selected="true"]'
        ),
      ].map((node) => node.dataset.well),
    count: () =>
      element.querySelector(".tool-actions > [role=status]")?.textContent,
    status: () => element.querySelector(".plate-editor-status")?.textContent,
    click: (target: HTMLElement, init: MouseEventInit = {}) =>
      act(() => {
        target.dispatchEvent(
          new MouseEvent("click", { bubbles: true, ...init })
        );
      }),
    press: (name: string, init?: MouseEventInit & { pointerType?: string }) =>
      pointer("pointerdown", cell(name), init),
    drag: (name: string, init?: MouseEventInit & { pointerType?: string }) =>
      pointer("pointermove", cell(name), { buttons: 1, ...init }),
    release: () => pointer("pointerup", window),
    key: (
      key: string,
      init: KeyboardEventInit = {},
      target: EventTarget = document.activeElement ?? document.body
    ) =>
      act(() => {
        target.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, ...init })
        );
      }),
    type: (label: string, value: string) =>
      act(() => {
        const control = field(label);
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )!.set!.call(control, value);
        control.dispatchEvent(new Event("input", { bubbles: true }));
      }),
  };
}
const row = (letter: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${letter}${index + 1}`);

describe("plate range selection", () => {
  it("selects the rectangle a pointer is dragged across and counts its wells", async () => {
    const plate = await mount();
    await plate.press("A1");
    expect(plate.selected()).toEqual(["A1"]);
    await plate.drag("B3");
    expect(plate.selected()).toEqual(["A1", "A2", "A3", "B1", "B2", "B3"]);
    // Dragging back shrinks the range: it follows the pointer, it does not accumulate.
    await plate.drag("A2");
    await plate.release();
    expect(plate.selected()).toEqual(["A1", "A2"]);
    expect(plate.count()).toBe("2 selected");
    // Once released, moving the pointer no longer changes the selection.
    await plate.drag("H12");
    expect(plate.selected()).toEqual(["A1", "A2"]);
    // A button let go outside the window sends no release; the next move without a button ends the drag.
    await plate.press("C1");
    await plate.drag("C2");
    await plate.drag("D4", { buttons: 0 });
    await plate.drag("D5");
    expect(plate.selected()).toEqual(["C1", "C2"]);
  });
  it("extends from the last picked well on Shift+click and toggles one on Ctrl+click", async () => {
    const plate = await mount();
    await plate.click(plate.cell("B2"));
    await plate.click(plate.cell("C4"), { shiftKey: true });
    expect(plate.selected()).toEqual([
      "B2",
      "B3",
      "B4",
      "C2",
      "C3",
      "C4",
    ]);
    // The range pivots on the same well.
    await plate.click(plate.cell("A1"), { shiftKey: true });
    expect(plate.selected()).toEqual(["A1", "A2", "B1", "B2"]);
    await plate.click(plate.cell("H12"), { ctrlKey: true });
    expect(plate.selected()).toEqual(["A1", "A2", "B1", "B2", "H12"]);
    await plate.click(plate.cell("A2"), { ctrlKey: true });
    expect(plate.selected()).toEqual(["A1", "B1", "B2", "H12"]);
    // A plain click starts over.
    await plate.click(plate.cell("D5"));
    expect(plate.selected()).toEqual(["D5"]);
  });
  it("selects a line from its header and adds further lines while multi-select is on", async () => {
    const plate = await mount({ data: { size: "24" } });
    await plate.click(plate.labelled("Select row A"));
    expect(plate.selected()).toEqual(row("A", 6));
    expect(
      plate.element.querySelector('[role="switch"]')?.getAttribute("aria-checked")
    ).toBe("true");
    await plate.click(plate.labelled("Select column 2"));
    expect(plate.selected()).toEqual([...row("A", 6), "B2", "C2", "D2"]);
    // A line that is already selected comes off again.
    await plate.click(plate.labelled("Select row A"));
    expect(plate.selected()).toEqual(["B2", "C2", "D2"]);
    expect(plate.count()).toBe("3 selected");
  });
  it("does not count the click that ends a press as a second pick", async () => {
    const plate = await mount();
    await plate.click(plate.element.querySelector('[role="switch"]')!);
    await plate.press("A1");
    await plate.release();
    // The browser sends this click for the press above; it must not toggle A1 off.
    await plate.click(plate.cell("A1"), { detail: 1 });
    expect(plate.selected()).toEqual(["A1"]);
    // A click that no press came before (a screen reader's) is a pick of its own.
    await plate.click(plate.cell("A1"));
    expect(plate.selected()).toEqual([]);
    await plate.click(plate.cell("A1"));
    await plate.press("B1");
    await plate.drag("B2");
    await plate.release();
    expect(plate.selected()).toEqual(["A1", "B1", "B2"]);
  });
  it("lets a finger scroll the plate unless multi-select is on", async () => {
    const plate = await mount();
    const grid = plate.element.querySelector('[role="grid"]')!;
    // Multi-select off: a touch that starts on a well is left to the browser, and only a tap selects.
    await plate.press("A1", { pointerType: "touch" });
    await plate.drag("B2", { pointerType: "touch" });
    await plate.release();
    expect(plate.selected()).toEqual([]);
    expect(grid.hasAttribute("data-multi")).toBe(false);
    await plate.press("A1", { pointerType: "touch" });
    await plate.release();
    await plate.click(plate.cell("A1"), { detail: 1 });
    expect(plate.selected()).toEqual(["A1"]);
    // Multi-select on: the wells stop scrolling (touch-action) and a drag selects.
    await plate.click(plate.element.querySelector('[role="switch"]')!);
    expect(grid.hasAttribute("data-multi")).toBe(true);
    // Turning it on keeps what was selected.
    expect(plate.selected()).toEqual(["A1"]);
    await plate.press("C1", { pointerType: "touch" });
    await plate.drag("D2", { pointerType: "touch" });
    await plate.release();
    expect(plate.selected()).toEqual(["A1", "C1", "C2", "D1", "D2"]);
  });
});

describe("plate keyboard", () => {
  it("is a grid with one tab stop that the arrow keys move", async () => {
    const plate = await mount({ data: { size: "24" } });
    const grid = plate.element.querySelector('[role="grid"]')!;
    expect(grid.getAttribute("aria-multiselectable")).toBe("true");
    expect(grid.querySelectorAll('[role="row"]')).toHaveLength(5);
    expect(grid.querySelectorAll('[role="gridcell"]')).toHaveLength(24);
    expect(grid.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    plate.cell("A1").focus();
    await plate.key("ArrowRight");
    expect(document.activeElement).toBe(plate.cell("A2"));
    await plate.key("ArrowDown");
    expect(document.activeElement).toBe(plate.cell("B2"));
    // Moving does not select, and the tab stop follows the focus.
    expect(plate.selected()).toEqual([]);
    expect(plate.cell("B2").tabIndex).toBe(0);
    expect(plate.cell("A1").tabIndex).toBe(-1);
    await plate.key("End");
    expect(document.activeElement).toBe(plate.cell("B6"));
    await plate.key("ArrowRight");
    expect(document.activeElement).toBe(plate.cell("B6"));
    await plate.key("Home", { ctrlKey: true });
    expect(document.activeElement).toBe(plate.cell("A1"));
    // Above the first row are the column headers.
    await plate.key("ArrowUp");
    expect(document.activeElement).toBe(plate.labelled("Select column 1"));
  });
  it("extends a range with Shift+arrows and toggles a well with Enter or Space", async () => {
    const plate = await mount({ data: { size: "24" } });
    plate.cell("B2").focus();
    await plate.key("ArrowRight", { shiftKey: true });
    await plate.key("ArrowDown", { shiftKey: true });
    expect(plate.selected()).toEqual(["B2", "B3", "C2", "C3"]);
    expect(document.activeElement).toBe(plate.cell("C3"));
    // Shrinks again from the same corner.
    await plate.key("ArrowLeft", { shiftKey: true });
    expect(plate.selected()).toEqual(["B2", "C2"]);
    // Without Shift the keys only move; Enter and Space then pick single wells.
    await plate.key("ArrowDown");
    await plate.key("ArrowRight");
    expect(plate.selected()).toEqual(["B2", "C2"]);
    await plate.key("Enter");
    expect(plate.selected()).toEqual(["B2", "C2", "D3"]);
    await plate.key(" ");
    expect(plate.selected()).toEqual(["B2", "C2"]);
    // A new range starts from where the focus is now.
    await plate.key("ArrowRight", { shiftKey: true });
    expect(plate.selected()).toEqual(["D3", "D4"]);
  });
});

describe("plate fields", () => {
  const standards = {
    size: "24",
    wells: {
      A1: well({ sample: "Std 1", color: "#fecaca" }),
      A2: well({ sample: "Std 2", color: "#bbf7d0", replicate: "1" }),
    },
  };
  it("applies only the colour when only the colour was changed", async () => {
    const plate = await mount({ data: standards });
    await plate.click(plate.cell("A1"));
    await plate.click(plate.cell("A2"), { shiftKey: true });
    // The wells disagree on three fields; none of them is shown as one value.
    expect(plate.element.textContent).toContain(
      "These differ between the selected wells: Sample, Replicate, Color"
    );
    expect(plate.field("Sample").value).toBe("");
    expect(plate.field("Sample").placeholder).toBe("Mixed");
    expect(plate.button("Apply to selected wells").disabled).toBe(true);
    await plate.click(plate.labelled("Color #fde68a"));
    expect(
      [...plate.group("Fields to apply").querySelectorAll("button")]
        .filter((chip) => chip.getAttribute("aria-pressed") === "true")
        .map((chip) => chip.textContent)
    ).toEqual(["Color"]);
    await plate.click(plate.button("Apply to selected wells"));
    expect(plate.wells()).toEqual({
      A1: well({ sample: "Std 1", color: "#fde68a" }),
      A2: well({ sample: "Std 2", color: "#fde68a", replicate: "1" }),
    });
    expect(plate.status()).toBe("Applied to 2 wells: Color");
  });
  it("applies a role, a concentration or a name on their own, and clears them the same way", async () => {
    const plate = await mount({ data: standards });
    await plate.click(plate.labelled("Select row A"));
    await plate.click(plate.button("Standard", plate.group("Role")));
    await plate.click(plate.button("Apply to selected wells"));
    expect(plate.wells().A1).toEqual({ ...standards.wells.A1, role: "standard" });
    expect(plate.wells().A2).toEqual({ ...standards.wells.A2, role: "standard" });
    // A well with nothing in it is created with just the role.
    expect(plate.wells().A6).toEqual(well({ role: "standard" }));
    expect(plate.cell("A1").textContent).toContain("STD");
    expect(plate.cell("A1").getAttribute("aria-label")).toBe(
      "A1 · Std 1 · Standard"
    );

    // Picking a line turned multi-select on. Turning it off keeps the
    // selection, and the next plain click starts a new one.
    await plate.click(plate.element.querySelector('[role="switch"]')!);
    expect(plate.selected()).toHaveLength(6);
    await plate.click(plate.cell("A1"));
    await plate.click(plate.cell("A2"), { shiftKey: true });
    expect(plate.selected()).toEqual(["A1", "A2"]);
    await plate.type("Concentration", "2.5");
    await plate.click(plate.button("Apply to selected wells"));
    expect(plate.wells().A1).toEqual({
      ...standards.wells.A1,
      role: "standard",
      concentration: 2.5,
    });
    expect(plate.wells().A2.sample).toBe("Std 2");
    expect(plate.wells().A3.concentration).toBeUndefined();

    await plate.type("Sample", "Standard");
    await plate.click(plate.button("None", plate.group("Role")));
    await plate.click(plate.button("Apply to selected wells"));
    // The role key is removed, not saved as an empty value.
    expect(plate.wells().A1).toEqual({
      ...standards.wells.A1,
      sample: "Standard",
      concentration: 2.5,
    });
    expect(plate.wells().A2).toEqual({
      ...standards.wells.A2,
      sample: "Standard",
      concentration: 2.5,
    });
  });
  it("leaves a changed field out when its switch is turned off again", async () => {
    const plate = await mount({ data: standards });
    await plate.click(plate.cell("A1"));
    await plate.type("Sample", "Renamed");
    await plate.type("Condition", "37 °C");
    await plate.click(plate.button("Sample", plate.group("Fields to apply")));
    // The field goes back to what the well holds.
    expect(plate.field("Sample").value).toBe("Std 1");
    await plate.click(plate.button("Apply to selected wells"));
    expect(plate.wells().A1).toEqual({
      ...standards.wells.A1,
      condition: "37 °C",
    });
  });
  it("refuses a negative concentration", async () => {
    const plate = await mount({ data: standards });
    await plate.click(plate.cell("A1"));
    await plate.type("Concentration", "-1");
    await plate.click(plate.button("Apply to selected wells"));
    expect(plate.element.querySelector("[role=alert]")?.textContent).toBe(
      "Enter non-negative values"
    );
    expect(plate.wells().A1).toEqual(standards.wells.A1);
  });
  it("shows the plate's concentration unit beside the field and keeps it in the document", async () => {
    const plate = await mount({ data: standards });
    await plate.type("Concentration unit", "ng/mL");
    expect(plate.data().concentrationUnit).toBe("ng/mL");
    await plate.click(plate.cell("A1"));
    expect(plate.field("Concentration (ng/mL)")).toBeTruthy();
    await plate.type("Concentration (ng/mL)", "40");
    await plate.click(plate.button("Apply to selected wells"));
    expect(plate.cell("A1").getAttribute("aria-label")).toBe(
      "A1 · Std 1 · 40 ng/mL"
    );
  });
  it("reads a document saved before roles and concentrations and keeps its fields", async () => {
    const saved = {
      sample: "Drug X",
      condition: "1 μM",
      replicate: "1",
      color: "#ddd6fe",
    };
    const plate = await mount({ data: { size: "24", wells: { A1: saved } } });
    expect(plate.cell("A1").getAttribute("aria-label")).toBe(
      "A1 · Drug X · 1 μM · 1"
    );
    await plate.click(plate.cell("A1"));
    expect(plate.field("Condition").value).toBe("1 μM");
    await plate.click(plate.button("Blank", plate.group("Role")));
    await plate.click(plate.button("Apply to selected wells"));
    expect(plate.wells().A1).toEqual({ ...saved, role: "blank" });
  });
  it("still says how many labelled wells a smaller plate hides", async () => {
    const plate = await mount({
      data: { size: "6", wells: { A1: well(), H12: well({ sample: "kept" }) } },
    });
    expect(plate.element.textContent).toContain(
      "1 labelled well is outside this plate size"
    );
    expect(plate.element.querySelectorAll('[role="gridcell"]')).toHaveLength(6);
  });
});

describe("plate series fills", () => {
  it("fills a dilution series along the selected row", async () => {
    const plate = await mount({ data: { size: "24" } });
    await plate.click(plate.labelled("Select row A"));
    expect(plate.button("Fill concentrations").disabled).toBe(true);
    await plate.type("Starting concentration", "100");
    // The factor starts at 2; the preview says what will be written.
    expect(plate.element.textContent).toContain("6 steps: 100 → 3.125");
    await plate.click(plate.button("Fill concentrations"));
    expect(
      row("A", 6).map((name) => plate.wells()[name].concentration)
    ).toEqual([100, 50, 25, 12.5, 6.25, 3.125]);
    expect(plate.wells().B1).toBeUndefined();
    expect(plate.status()).toBe("Filled concentrations in 6 wells.");
  });
  it("fills down the columns and gives each column the same series", async () => {
    const plate = await mount({ data: { size: "24" } });
    await plate.press("A1");
    await plate.drag("C2");
    await plate.release();
    await plate.click(plate.button("Down columns ↓"));
    await plate.type("Starting concentration", "9");
    await plate.type("Dilution factor", "3");
    await plate.click(plate.button("Fill concentrations"));
    expect(
      ["A1", "A2", "B1", "B2", "C1", "C2"].map(
        (name) => plate.wells()[name].concentration
      )
    ).toEqual([9, 9, 3, 3, 1, 1]);
  });
  it("reports a factor that does not dilute instead of filling", async () => {
    const plate = await mount({ data: { size: "24" } });
    await plate.click(plate.labelled("Select row A"));
    await plate.type("Starting concentration", "100");
    await plate.type("Dilution factor", "1");
    expect(plate.element.querySelector("[role=alert]")?.textContent).toBe(
      "Serial dilution factor must exceed 1"
    );
    expect(plate.button("Fill concentrations").disabled).toBe(true);
  });
  it("numbers samples with replicates and leaves other fields alone", async () => {
    const plate = await mount({
      data: {
        size: "24",
        wells: { A1: well({ color: "#fecaca", concentration: 5 }) },
      },
    });
    await plate.click(plate.labelled("Select row A"));
    await plate.type("Replicates per sample", "2");
    expect(plate.element.textContent).toContain("3 samples: S1 – S3");
    await plate.click(plate.button("Fill numbers"));
    expect(
      row("A", 6).map((name) => [
        plate.wells()[name].sample,
        plate.wells()[name].replicate,
      ])
    ).toEqual([
      ["S1", "1"],
      ["S1", "2"],
      ["S2", "1"],
      ["S2", "2"],
      ["S3", "1"],
      ["S3", "2"],
    ]);
    expect(plate.wells().A1).toEqual(
      well({ sample: "S1", replicate: "1", color: "#fecaca", concentration: 5 })
    );
    // Four replicates do not divide six wells.
    await plate.type("Replicates per sample", "4");
    expect(plate.element.textContent).toContain(
      "the last sample has fewer replicates"
    );
    await plate.type("Replicates per sample", "0");
    expect(plate.button("Fill numbers").disabled).toBe(true);
  });
});

describe("plate undo", () => {
  it("steps back and forward through several changes with the keyboard and the buttons", async () => {
    const plate = await mount({ data: { size: "24" } });
    await plate.click(plate.labelled("Select row A"));
    await plate.type("Starting concentration", "8");
    await plate.click(plate.button("Fill concentrations"));
    await plate.click(plate.button("Fill numbers"));
    await plate.click(plate.button("Standard", plate.group("Role")));
    await plate.click(plate.button("Apply to selected wells"));
    expect(plate.wells().A2).toEqual(
      well({ sample: "S2", concentration: 4, role: "standard" })
    );
    await plate.key("z", { ctrlKey: true }, document.body);
    expect(plate.wells().A2).toEqual(well({ sample: "S2", concentration: 4 }));
    await plate.key("z", { metaKey: true }, document.body);
    expect(plate.wells().A2).toEqual(well({ concentration: 4 }));
    await plate.click(plate.button("Undo"));
    expect(plate.wells()).toEqual({});
    expect(plate.button("Undo").disabled).toBe(true);
    await plate.key("z", { ctrlKey: true, shiftKey: true }, document.body);
    expect(plate.wells().A2).toEqual(well({ concentration: 4 }));
    await plate.key("y", { ctrlKey: true }, document.body);
    expect(plate.wells().A2).toEqual(well({ sample: "S2", concentration: 4 }));
    await plate.click(plate.button("Redo"));
    expect(plate.wells().A2.role).toBe("standard");
    expect(plate.button("Redo").disabled).toBe(true);
    // A new change after an undo drops what could have been redone.
    await plate.click(plate.button("Undo"));
    await plate.click(plate.button("Blank", plate.group("Role")));
    await plate.click(plate.button("Apply to selected wells"));
    expect(plate.button("Redo").disabled).toBe(true);
    expect(plate.wells().A2.role).toBe("blank");
  });
  it("keeps the history on the screen, not in the saved document", async () => {
    const plate = await mount({ data: { size: "24" } });
    await plate.click(plate.cell("A1"));
    await plate.type("Sample", "one");
    await plate.click(plate.button("Apply to selected wells"));
    expect(Object.keys(plate.data()).sort()).toEqual([
      "concentrationUnit",
      "size",
      "wells",
    ]);
  });
  it("leaves Ctrl+Z in a text field to the field", async () => {
    const plate = await mount({ data: { size: "24" } });
    await plate.click(plate.cell("A1"));
    await plate.type("Sample", "one");
    await plate.click(plate.button("Apply to selected wells"));
    await plate.key("z", { ctrlKey: true }, plate.field("Sample"));
    expect(plate.wells().A1.sample).toBe("one");
  });
  it("clears wells at once and offers to put them back", async () => {
    const wells = { A1: well({ sample: "one" }), A2: well({ sample: "two" }) };
    const plate = await mount({ data: { size: "24", wells } });
    await plate.click(plate.labelled("Select row A"));
    await plate.click(plate.button("Clear selected wells"));
    expect(plate.wells()).toEqual({});
    const bar = plate.element.querySelector<HTMLElement>(".tool-undo")!;
    expect(bar.textContent).toContain("Cleared 2 wells.");
    await plate.click(plate.button("Undo", bar));
    expect(plate.wells()).toEqual(wells);
    // Putting them back was an undo: the clearing can be redone, and nothing is left to undo.
    expect(plate.button("Undo").disabled).toBe(true);
    await plate.click(plate.button("Redo"));
    expect(plate.wells()).toEqual({});
  });
});

describe("plate concentration view", () => {
  const twoFold = [100, 50, 25, 12.5, 6.25, 3.125, 1.5625, 0.78125];
  const series = {
    concentrationUnit: "µM",
    wells: {
      ...Object.fromEntries(
        twoFold.map((concentration, index) => [
          `A${index + 1}`,
          well({ role: "standard", concentration }),
        ])
      ),
      B1: well({ sample: "Serum", color: "#fecaca" }),
    },
  };
  const heat = (node: Element) =>
    [...node.classList].find((name) => name.startsWith("tool-chart-heat-"));
  it("paints wells by their colour until the concentration view is chosen", async () => {
    const plate = await mount({ data: series });
    expect(plate.element.querySelector("[class*=tool-chart-heat-]")).toBeNull();
    expect(plate.element.querySelector(".tool-chart-scale")).toBeNull();
    expect(plate.cell("B1").style.background).toBe("rgb(254, 202, 202)");
    expect(plate.cell("B1").textContent).toContain("Serum");
  });
  it("shades a dilution series on a log scale and says so on the legend", async () => {
    const plate = await mount({ data: series });
    await plate.click(plate.button("Concentrations"));
    expect(
      twoFold.map((_, index) => heat(plate.cell(`A${index + 1}`)))
    ).toEqual([
      "tool-chart-heat-6",
      "tool-chart-heat-6",
      "tool-chart-heat-5",
      "tool-chart-heat-4",
      "tool-chart-heat-3",
      "tool-chart-heat-2",
      "tool-chart-heat-1",
      "tool-chart-heat-0",
    ]);
    // The value is printed in the well and is in its name, not only in its shade.
    expect(plate.cell("A3").textContent).toContain("25");
    expect(plate.cell("A8").getAttribute("aria-label")).toBe(
      "A8 · Standard · 0.78125 µM"
    );
    // A well without a concentration is left empty.
    expect(heat(plate.cell("B1"))).toBeUndefined();
    expect(heat(plate.cell("C1"))).toBeUndefined();
    expect(plate.cell("B1").style.background).not.toBe("rgb(254, 202, 202)");
    const legend = plate.element.querySelector(".tool-chart-scale")!;
    expect(
      [...legend.querySelectorAll(":scope > span")].map(
        (part) => part.textContent
      )
    ).toEqual(["Concentration (log)", "0.78125 µM", "100 µM"]);
    expect(legend.querySelectorAll("i")).toHaveLength(7);
  });
  it("keeps evenly spaced concentrations on a linear scale", async () => {
    const plate = await mount({
      data: {
        wells: {
          A1: well({ concentration: 0 }),
          A2: well({ concentration: 5 }),
          A3: well({ concentration: 10 }),
        },
      },
    });
    await plate.click(plate.button("Concentrations"));
    expect(["A1", "A2", "A3"].map((name) => heat(plate.cell(name)))).toEqual([
      "tool-chart-heat-0",
      "tool-chart-heat-3",
      "tool-chart-heat-6",
    ]);
    expect(
      plate.element.querySelector(".tool-chart-scale")?.textContent
    ).toBe("Concentration010");
  });
  it("says what to do when no well has a concentration", async () => {
    const plate = await mount({ data: { wells: { A1: well() } } });
    await plate.click(plate.button("Concentrations"));
    expect(plate.element.querySelector(".tool-chart-scale")).toBeNull();
    expect(plate.element.textContent).toContain(
      "No well has a concentration yet."
    );
  });
});

describe("plate exports and hand-offs", () => {
  const layout = {
    size: "24",
    concentrationUnit: "µM",
    wells: {
      A1: well({ sample: "Std", role: "standard", concentration: 10 }),
      A2: well({ role: "blank", concentration: 0, replicate: "1" }),
      B1: well({ sample: "Serum 1", role: "sample", condition: "1:10" }),
      B2: well({ sample: "note only" }),
      // Outside a 24-well plate: kept in the document, left out of everything sent.
      H12: well({ sample: "outside", role: "standard", concentration: 1 }),
    },
  };
  it("writes the layout, its key and the well list to a PDF named after the work", async () => {
    const plate = await mount({ data: layout });
    await plate.click(plate.button("PDF"));
    expect(report).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(report).mock.calls[0][0];
    expect(sent.name).toMatch(/^buril-plate-labelling-Run-3-\d{8}-\d{4}\.pdf$/);
    expect(sent.title).toBe("Plate layout · Run 3");
    expect(sent.headers).toEqual([
      "Well",
      "Sample",
      "Condition",
      "Replicate",
      "Role",
      "Concentration (µM)",
    ]);
    expect(sent.rows).toEqual([
      ["A1", "Std", "", "", "Standard", 10],
      ["A2", "", "", "1", "Blank", 0],
      ["B1", "Serum 1", "1:10", "", "Sample", ""],
      ["B2", "note only", "", "", "", ""],
    ]);
    expect(sent.lines).toEqual([
      "24-well plate · 4 wells in use",
      "Role marks: STD = Standard, SMP = Sample, BLK = Blank",
      "Concentration unit: µM",
    ]);
    const svg = sent.svg!;
    const texts = [...svg.querySelectorAll("text")].map(
      (node) => node.textContent
    );
    // 24 wells and the three role marks of the key.
    expect(svg.querySelectorAll("circle")).toHaveLength(27);
    expect(svg.getAttribute("viewBox")).toMatch(/^0 0 \d+ \d+$/);
    // Name, role mark, sample and concentration are printed in the well.
    expect(texts).toEqual(
      expect.arrayContaining(["A1 STD", "Std", "10", "A2 BLK", "0", "B1 SMP"])
    );
    // The key spells the marks out, and the colour key names the samples.
    expect(texts).toEqual(
      expect.arrayContaining(["STD Standard", "SMP Sample", "BLK Blank"])
    );
    expect(texts).toContain("Std, Serum 1, note only");
    expect(texts).not.toContain("outside");
  });
  it("draws the concentration scale in the PDF when that view is showing", async () => {
    const plate = await mount({ data: layout, draft: true });
    await plate.click(plate.button("Concentrations"));
    await plate.click(plate.button("PDF"));
    const sent = vi.mocked(report).mock.calls[0][0];
    // A draft has no name yet.
    expect(sent.name).toMatch(/^buril-plate-labelling-\d{8}-\d{4}\.pdf$/);
    expect(sent.title).toBe("Plate layout");
    expect(sent.lines).toContain("Shading: Concentration, 0 µM – 10 µM");
    const texts = [...sent.svg!.querySelectorAll("text")].map(
      (node) => node.textContent
    );
    expect(texts).toEqual(
      expect.arrayContaining(["Concentration", "0 µM", "10 µM"])
    );
    // The seven steps of the scale.
    expect(
      [...sent.svg!.querySelectorAll("rect")].filter(
        (node) => node.getAttribute("height") === "12"
      )
    ).toHaveLength(7);
    expect(
      sent.svg!.querySelector("circle")!.getAttribute("fill")
    ).toBe("#0d366b");
  });
  it("names its CSV by tool and time and adds the role and concentration columns", async () => {
    const plate = await mount({ data: layout });
    await plate.click(plate.button("CSV"));
    const [text, name, type] = vi.mocked(download).mock.calls[0];
    expect(name).toMatch(/^buril-plate-labelling-Run-3-\d{8}-\d{4}\.csv$/);
    expect(type).toBe("text/csv");
    const lines = String(text).split("\r\n");
    expect(lines).toHaveLength(25);
    expect(lines[0]).toBe(
      '﻿"Well","Sample","Condition","Replicate","Role","Concentration (µM)","Color"'
    );
    expect(lines[1]).toBe('"A1","Std","","","Standard","10","#bfdbfe"');
    expect(lines[3]).toBe('"A3","","","","","",""');
  });
  it("sends the number of wells in use to the master mix", async () => {
    const sendTo = vi.fn();
    const plate = await mount({ data: layout, sendTo });
    await plate.click(plate.button("Send well count to Master Mix"));
    expect(sendTo).toHaveBeenCalledWith("master-mix", {
      kind: "count",
      value: 4,
      unit: "",
      label: "Wells in use",
      source: "plate-labelling",
    });
  });
  it("sends wells with a role to the calibration curve, one row each in row order", async () => {
    const sendTo = vi.fn();
    const plate = await mount({ data: layout, sendTo });
    await plate.click(
      plate.button("Send standards and samples to Calibration")
    );
    expect(sendTo).toHaveBeenCalledWith("calibration-curve", {
      kind: "table",
      value: 3,
      unit: "µM",
      label: "Plate standards and samples",
      source: "plate-labelling",
      rows: [
        ["standard", "A1 · Std", "10"],
        ["blank", "A2", "0"],
        ["sample", "B1 · Serum 1", ""],
      ],
    });
  });
  it("offers the hand-offs only inside the tools shell and only when there is something to send", async () => {
    const outside = await mount({ data: layout });
    expect(outside.button("Send well count to Master Mix")).toBeUndefined();
    await act(() => root?.unmount());
    const empty = await mount({ data: { size: "24" }, sendTo: vi.fn() });
    expect(empty.button("Send well count to Master Mix").disabled).toBe(true);
    expect(
      empty.button("Send standards and samples to Calibration").disabled
    ).toBe(true);
  });
});
