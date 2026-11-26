// @vitest-environment jsdom
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolContext } from "./ui";
import type { Handoff } from "./handoff";
import type { ToolDocument, ToolId } from "./registry";
import type { ToolRepository } from "./repository";
import type { CalendarEvent } from "./calendar";
import CellCounterTool from "./CellCounterTool";
import CultureTool from "./CultureTool";
import { exportBlobPartAsFile } from "../../utils/fileExport";
import { enableNotifications, setDeviceEnabled } from "./notifications";

const locale = vi.hoisted(() => ({ language: "en" }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: locale, t: (s: string) => s }),
}));
vi.mock("../../locales/i18n", () => ({ default: locale }));
vi.mock("../../services/supabaseClient", () => ({ supabase: {} }));
vi.mock("../../utils/fileExport", () => ({
  exportBlobPartAsFile: vi.fn(async () => {}),
}));
// Asking for permission needs a browser or a phone; what the tool stores does not.
vi.mock("./notifications", async (original) => ({
  ...(await original<typeof import("./notifications")>()),
  enableNotifications: vi.fn(async () => ({ display: "granted", exact: true })),
  setDeviceEnabled: vi.fn(),
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
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function mount(
  tool: ReactNode,
  {
    id = "cell-counter",
    data = {},
    handoff = null,
    sendTo,
    others = [],
  }: {
    id?: ToolId;
    data?: Record<string, unknown>;
    handoff?: Handoff | null;
    sendTo?: (tool: ToolId, handoff: Handoff) => void;
    /** Other documents of the account, such as the calendar. */
    others?: ToolDocument[];
  } = {}
) {
  const base: ToolDocument = {
    id: "doc",
    owner_id: "owner",
    tool_id: id,
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
  const items = [{ doc: base }, ...others.map((doc) => ({ doc }))];
  const repo = {
    owner: "owner",
    items,
    update: vi.fn(async (docId: string, patch: Partial<ToolDocument>) => {
      const row = items.find((item) => item.doc.id === docId)!;
      row.doc = { ...row.doc, ...patch };
      renderDoc(items[0].doc);
    }),
    create: vi.fn(
      async (
        toolId: ToolId,
        title: string,
        created: Record<string, unknown>,
        options?: { id?: string }
      ) => {
        const doc = {
          ...base,
          id: options?.id ?? `new-${items.length}`,
          tool_id: toolId,
          title,
          data: created,
        };
        items.push({ doc });
        return doc;
      }
    ),
  };
  function Harness() {
    const [state, setState] = useState(items[0].doc);
    const [offer, setOffer] = useState(handoff);
    useEffect(() => {
      renderDoc = setState;
    }, []);
    return (
      <ToolContext.Provider
        value={{
          doc: state,
          repo: repo as unknown as ToolRepository,
          documents: [],
          handoff: offer,
          clearHandoff: () => setOffer(null),
          sendTo,
        }}
      >
        {tool}
      </ToolContext.Provider>
    );
  }
  root = createRoot(element);
  await act(() => root!.render(<Harness />));
  const labelled = (label: string, within: ParentNode = element) =>
    [...within.querySelectorAll("label")].find(
      (candidate) => candidate.querySelector("span")?.textContent === label
    );
  const field = (label: string, within?: ParentNode) =>
    labelled(label, within)?.querySelector<HTMLInputElement>("input") ?? null;
  const select = (label: string, within?: ParentNode) =>
    labelled(label, within)?.querySelector<HTMLSelectElement>("select") ?? null;
  const buttons = (text: string, within: ParentNode = element) =>
    [...within.querySelectorAll("button")].filter(
      (candidate) => candidate.textContent === text
    );
  const named = (name: string) =>
    element.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  return {
    element,
    repo,
    items,
    data: () => items[0].doc.data,
    field,
    select,
    named,
    button: (text: string, within?: ParentNode) => buttons(text, within)[0],
    type: (label: string, value: string, within?: ParentNode) =>
      act(() => {
        const control = field(label, within)!;
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )!.set!.call(control, value);
        control.dispatchEvent(new Event("input", { bubbles: true }));
      }),
    choose: (label: string, value: string, within?: ParentNode) =>
      act(() => {
        const control = select(label, within)!;
        control.value = value;
        control.dispatchEvent(new Event("change", { bubbles: true }));
      }),
    press: (text: string, within?: ParentNode) =>
      act(async () => buttons(text, within)[0].click()),
    tap: (name: string, times = 1) =>
      act(() => {
        // Several presses before React draws again, as fast fingers do.
        for (let i = 0; i < times; i++) named(name)!.click();
      }),
    result: () => element.querySelector("output")?.textContent ?? null,
    alert: () => element.querySelector('[role="alert"]')?.textContent ?? null,
    /** The figure under a caption in the result list. */
    figure: (caption: string) =>
      [...element.querySelectorAll("dt")].find(
        (term) => term.textContent === caption
      )?.nextElementSibling?.textContent ?? null,
    text: () => element.textContent ?? "",
  };
}

// The count worked by hand in cells.test.ts: 204 live and 12 dead in four
// large squares, dilution factor 2 → 1,020,000 viable cells/mL, 94.4% viable.
const counted = {
  rows: [
    { live: 52, dead: 3 },
    { live: 48, dead: 2 },
    { live: 50, dead: 4 },
    { live: 54, dead: 3 },
  ],
  factor: 2,
  volume: 0.0001,
};

describe("cell counter", () => {
  it("counts by tapping, square by square, and takes a slip back", async () => {
    const screen = await mount(<CellCounterTool />);
    await screen.tap("Square 1 Live +1", 3);
    await screen.tap("Square 1 Dead +1");
    expect(screen.data().rows).toEqual([{ live: 3, dead: 1 }]);
    // One too many: −1 on that count, or undo for the last press of any kind.
    await screen.tap("Square 1 Live −1");
    expect(screen.data().rows).toEqual([{ live: 2, dead: 1 }]);
    await screen.press("Undo");
    expect(screen.data().rows).toEqual([{ live: 3, dead: 1 }]);
    await screen.press("Undo");
    expect(screen.data().rows).toEqual([{ live: 3, dead: 0 }]);
    // − at zero neither saves nor leaves something to undo.
    expect(screen.named("Square 1 Dead −1")!.disabled).toBe(true);
    // On the last square, "next" opens a new one and moves to it.
    expect(screen.named("Previous square")!.disabled).toBe(true);
    await screen.tap("Add the next square");
    expect(screen.text()).toContain("Square 2 of 2");
    await screen.tap("Square 2 Live +1", 2);
    expect(screen.data().rows).toEqual([
      { live: 3, dead: 0 },
      { live: 2, dead: 0 },
    ]);
    await screen.tap("Previous square");
    expect(screen.text()).toContain("Square 1 of 2");
    expect(screen.named("Next square")).not.toBeNull();
    // Undo goes back to the square the press was made on.
    await screen.press("Undo");
    expect(screen.text()).toContain("Square 2 of 2");
    expect(screen.data().rows).toEqual([
      { live: 3, dead: 0 },
      { live: 1, dead: 0 },
    ]);
    // Every bench-side target announces itself to a screen reader.
    expect(screen.element.querySelector("[aria-live]")?.textContent).toBe(
      "Square 2 Live 1"
    );
  });
  it("still takes typed counts, and treats an empty one as not yet entered", async () => {
    const screen = await mount(<CellCounterTool />, { data: counted });
    expect(screen.result()).toBe("1,020,000 cells/mL");
    expect(screen.figure("Viability")).toBe("94.4%");
    expect(screen.figure("Scientific")).toBe("1.02 × 10⁶ cells/mL");
    expect(screen.figure("All cells (live + dead)")).toBe("1,080,000 cells/mL");
    // 4 more live cells in square 4: 208 ÷ 4 = 52 → 1,040,000 cells/mL.
    await screen.type("4 · Live", "58");
    expect((screen.data().rows as unknown[])[3]).toEqual({ live: 58, dead: 3 });
    expect(screen.result()).toBe("1,040,000 cells/mL");
    await screen.type("4 · Live", "");
    expect((screen.data().rows as unknown[])[3]).toEqual({
      live: null,
      dead: 3,
    });
    expect(screen.result()).toBeNull();
    expect(screen.alert()).toBeNull();
    expect(
      screen.element.querySelector('.tool-panel [role="status"]')?.textContent
    ).toContain("Enter 0 where there were no cells");
    await screen.type("4 · Live", "2.5");
    expect(screen.result()).toBeNull();
    expect(screen.alert()).toBe("Invalid counts");
  });
  it("offers verified chambers and a custom volume in µL", async () => {
    const screen = await mount(<CellCounterTool />, { data: counted });
    const chamber = "Chamber and counted square";
    expect(screen.select(chamber)!.value).toBe("neubauer-improved");
    expect(screen.field("Volume above one square (µL)")).toBeNull();
    expect(screen.text()).toContain("stands for 10,000 cells/mL before dilution");
    // The same counts in a chamber twice as deep are half the density.
    await screen.choose(chamber, "fuchs-rosenthal");
    expect(screen.data()).toMatchObject({
      chamber: "fuchs-rosenthal",
      volume: 0.0002,
    });
    expect(screen.result()).toBe("510,000 cells/mL");
    expect(screen.text()).toContain("Side 1 mm × depth 0.2 mm = 0.2 µL");
    // A typed volume: 0.25 µL is stored as mL, where older builds read it.
    await screen.choose(chamber, "custom");
    expect(screen.field("Volume above one square (µL)")!.value).toBe("0.2");
    await screen.type("Volume above one square (µL)", "0.25");
    expect(screen.data()).toMatchObject({ chamber: "custom", volume: 0.00025 });
    // 51 per square ÷ 0.00025 mL × 2 = 408,000 cells/mL.
    expect(screen.result()).toBe("408,000 cells/mL");
    // Where the figures come from is on screen, as a link.
    const source = screen.element.querySelector<HTMLAnchorElement>(
      'a[href^="https://www.marienfeld-superior.com/"]'
    );
    expect(source?.textContent).toContain("Marienfeld");
    expect(source?.rel).toContain("noopener");
  });
  it("opens a count saved before presets existed with the volume it has", async () => {
    // No `chamber` field, and a volume that is not the default preset's.
    const old = await mount(<CellCounterTool />, {
      data: { ...counted, volume: 0.0004 },
    });
    expect(old.select("Chamber and counted square")!.value).toBe("custom");
    expect(old.field("Volume above one square (µL)")!.value).toBe("0.4");
    // 51 ÷ 0.0004 mL × 2 = 255,000 cells/mL, as the old build showed.
    expect(old.result()).toBe("255,000 cells/mL");
  });
  it("gives the total for a suspension volume and copies one sentence", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const screen = await mount(<CellCounterTool />, { data: counted });
    expect(screen.figure("Total viable cells (5 mL)")).toBeNull();
    await screen.press("Copy result");
    expect(writeText).toHaveBeenLastCalledWith(
      "Viable cells 1020000 cells/mL, viability 94.4%, dilution factor 2 (4 squares of 0.1 µL)"
    );
    // 1,020,000 cells/mL × 5 mL = 5,100,000 cells.
    await screen.type("Suspension volume (optional)", "5");
    expect(screen.data().suspensionVolume).toBe("5");
    expect(screen.figure("Total viable cells (5 mL)")).toBe(
      "5,100,000 (5.10 × 10⁶)"
    );
    await screen.press("Copy result");
    expect(writeText).toHaveBeenLastCalledWith(
      "Viable cells 1020000 cells/mL, viability 94.4%, dilution factor 2, total viable cells 5100000 in 5 mL (4 squares of 0.1 µL)"
    );
    // 500 µL of the same suspension holds 510,000 cells.
    await screen.type("Suspension volume (optional)", "500");
    await screen.choose("Suspension volume unit", "µL");
    expect(screen.figure("Total viable cells (500 µL)")).toBe(
      "510,000 (5.10 × 10⁵)"
    );
    await screen.type("Suspension volume (optional)", "abc");
    expect(screen.alert()).toBe("Invalid number");
  });
  it("sends the viable density to cell culture when the shell can", async () => {
    const sendTo = vi.fn();
    const screen = await mount(<CellCounterTool />, { data: counted, sendTo });
    await screen.press("Send to Cell Culture");
    expect(sendTo).toHaveBeenCalledWith("cell-culture", {
      kind: "cell-density",
      value: 1020000,
      unit: "cells/mL",
      label: "Viable cell density",
      source: "cell-counter",
    });
    // Outside the shell there is nowhere to send it.
    await act(() => root!.unmount());
    root = null;
    const alone = await mount(<CellCounterTool />, { data: counted });
    expect(alone.button("Send to Cell Culture")).toBeUndefined();
    // And nothing to send when no live cell was counted.
    await act(() => root!.unmount());
    root = null;
    const none = await mount(<CellCounterTool />, {
      data: { ...counted, rows: [{ live: 0, dead: 4 }] },
      sendTo,
    });
    expect(none.result()).toBe("0 cells/mL");
    expect(none.button("Send to Cell Culture")).toBeUndefined();
  });
  it("draws viability and the spread between squares, each with a table", async () => {
    const screen = await mount(<CellCounterTool />, { data: counted });
    const segments = [
      ...screen.element.querySelectorAll(
        '[aria-label="Share of live and dead cells"] [role="listitem"]'
      ),
    ].map((node) => node.getAttribute("aria-label"));
    // 204 of 216 is 94.4%, which the bar rounds to whole percent.
    expect(segments).toEqual(["Live 204, 94%", "Dead 12, 5.6%"]);
    const list = screen.element.querySelector(".tool-chart-bars")!;
    expect(list.getAttribute("aria-label")).toBe(
      "Cells counted per square (live + dead)"
    );
    const bars = [...list.querySelectorAll('[role="listitem"]')].map((node) =>
      node.getAttribute("aria-label")
    );
    expect(bars).toEqual([
      "Square 1 55 (live 52 · dead 3)",
      "Square 2 50 (live 48 · dead 2)",
      "Square 3 54 (live 50 · dead 4)",
      "Square 4 57 (live 54 · dead 3)",
    ]);
    // Mean 54 per square, CV 5.5% (worked in cells.test.ts).
    expect(screen.text()).toContain("Mean 54 · CV 5.5%");
    const tables = [...screen.element.querySelectorAll(".tool-chart table")];
    expect(tables).toHaveLength(2);
    expect(
      [...tables[0].querySelectorAll("tbody tr")].map((row) => row.textContent)
    ).toEqual(["Live20494.4", "Dead125.6"]);
    expect(tables[1].querySelectorAll("tbody tr")).toHaveLength(4);
    // One square has nothing to compare with.
    await act(() => root!.unmount());
    root = null;
    const single = await mount(<CellCounterTool />, {
      data: { ...counted, rows: [{ live: 52, dead: 3 }] },
    });
    expect(single.element.querySelectorAll(".tool-chart")).toHaveLength(1);
  });
  it("removes a square at once with a way back, and warns about an uncounted one", async () => {
    const screen = await mount(<CellCounterTool />, { data: counted });
    await screen.tap("Remove square 2");
    expect(screen.data().rows).toHaveLength(3);
    expect(screen.text()).toContain("Square 2 removed.");
    // The square comes back where it was.
    await screen.press("Undo", screen.element.querySelector(".tool-undo")!);
    expect(screen.data().rows).toEqual(counted.rows);
    await screen.press("Add square");
    expect(screen.data().rows).toHaveLength(5);
    expect(screen.text()).toContain(
      "Square 5 has no cells and counts as zero in the mean."
    );
    // 204 live over five squares: 40.8 → 816,000 cells/mL.
    expect(screen.result()).toBe("816,000 cells/mL");
  });
  it("counts full screen in focus mode, with keys, until Escape", async () => {
    const screen = await mount(<CellCounterTool />);
    await screen.press("Focus mode");
    const dialog = screen.element.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Square 1 Live +1"
    );
    const key = (init: KeyboardEventInit) =>
      act(() => window.dispatchEvent(new KeyboardEvent("keydown", init)));
    await key({ key: "1", code: "Digit1" });
    await key({ key: "1", code: "Digit1" });
    await key({ key: "2", code: "Digit2" });
    // A held key counts once.
    await key({ key: "2", code: "Digit2", repeat: true });
    expect(screen.data().rows).toEqual([{ live: 2, dead: 1 }]);
    // Shift turns the key into "!"; the physical key still says which count.
    await key({ key: "!", code: "Digit1", shiftKey: true });
    expect(screen.data().rows).toEqual([{ live: 1, dead: 1 }]);
    await key({ key: "Backspace" });
    expect(screen.data().rows).toEqual([{ live: 2, dead: 1 }]);
    await key({ key: "Escape" });
    expect(screen.element.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement?.textContent).toBe("Focus mode");
  });
  it("is in Korean on a Korean screen", async () => {
    locale.language = "ko";
    const screen = await mount(<CellCounterTool />, { data: counted });
    expect(screen.named("구획 1 생존 +1")).not.toBeNull();
    expect(screen.figure("생존율")).toBe("94.4%");
    expect(screen.text()).toContain("평균 54 · 변동계수 5.5%");
  });
});

describe("cell culture", () => {
  const density: Handoff = {
    kind: "cell-density",
    value: 1020000,
    unit: "cells/mL",
    label: "Viable cell density",
    source: "cell-counter",
  };
  const seedingSection = (element: HTMLElement) =>
    element.querySelectorAll<HTMLDetailsElement>("details.culture-section")[1];

  it("takes the density the cell counter sent, where the density goes", async () => {
    const screen = await mount(<CultureTool />, {
      id: "cell-culture",
      handoff: density,
    });
    const section = seedingSection(screen.element);
    // The seeding section is folded away; an offer opens it.
    expect(section.open).toBe(true);
    expect(section.querySelector(".tool-handoff")?.textContent).toContain(
      "From Cell Counter: Viable cell density 1,020,000 cells/mL"
    );
    await screen.press("Apply");
    expect(screen.data().concentration).toBe(1020000);
    expect(
      screen.field("Viable cell concentration (cells/mL)")!.value
    ).toBe("1020000");
    expect(screen.element.querySelector(".tool-handoff")).toBeNull();
    // 1:5 split of 10 mL into a T-25: 2 mL of stock, 2,040,000 cells.
    expect(section.querySelector("tbody td:nth-child(2)")?.textContent).toBe(
      "2,040,000"
    );
  });
  it("does not take a density in a unit it cannot read", async () => {
    const screen = await mount(<CultureTool />, {
      id: "cell-culture",
      handoff: { ...density, unit: "OD600" },
    });
    await screen.press("Apply");
    expect(screen.data().concentration ?? 1000000).toBe(1000000);
    expect(screen.alert()).toContain("its unit (OD600) cannot be read");
    // Without an offer the section stays folded.
    await act(() => root!.unmount());
    root = null;
    const plain = await mount(<CultureTool />, { id: "cell-culture" });
    expect(seedingSection(plain.element).open).toBe(false);
  });
  it("fills a vessel from a verified preset and lets every figure be changed", async () => {
    const screen = await mount(<CultureTool />, { id: "cell-culture" });
    const vessels = () => screen.data().vessels as Record<string, unknown>[];
    expect(screen.select("Vessel preset")!.value).toBe("t25");
    expect(screen.text()).toContain("T-25 flask · 25 cm² · growth medium 3–5 mL");
    await screen.choose("Vessel preset", "plate-6");
    expect(vessels()[0]).toMatchObject({
      preset: "plate-6",
      name: "6-well",
      area: 9.6,
      volume: 3,
      // What the user set stays.
      count: 1,
      mode: "split",
      target: 5,
    });
    expect(screen.text()).toContain(
      "6-well plate (per well) · 9.6 cm² · growth medium 1–3 mL per well"
    );
    // The volume is the user's to change; the preset still names the vessel.
    await screen.type("Final volume per vessel (mL)", "2");
    expect(vessels()[0]).toMatchObject({ preset: "plate-6", volume: 2 });
    expect(screen.select("Vessel preset")!.value).toBe("plate-6");
    // Another maker's well: with its own area it is no longer the preset.
    await screen.type("Vessel area (cm²)", "9.5");
    expect(vessels()[0].area).toBe(9.5);
    expect(screen.select("Vessel preset")!.value).toBe("custom");
    const source = screen.element.querySelector<HTMLAnchorElement>(
      'a[href^="https://www.thermofisher.com/"]'
    );
    expect(source?.textContent).toContain("Useful Numbers for Cell Culture");
    // A new group starts on a preset too, and removing one can be undone.
    await screen.press("Add vessel group");
    expect(vessels()).toHaveLength(2);
    expect(vessels()[1]).toMatchObject({ preset: "t25", area: 25, volume: 5 });
    await screen.press("Remove vessel group");
    expect(vessels().map((row) => row.name)).toEqual(["T-25"]);
    await screen.press("Undo", screen.element.querySelector(".tool-undo")!);
    expect(vessels().map((row) => row.name)).toEqual(["6-well", "T-25"]);
  });
  it("asks for an empty seeding field instead of reporting an error", async () => {
    const screen = await mount(<CultureTool />, { id: "cell-culture" });
    const section = seedingSection(screen.element);
    expect(section.querySelector("table")).not.toBeNull();
    await screen.type("Available stock (mL)", "");
    expect(screen.data().available).toBeNull();
    expect(section.querySelector("table")).toBeNull();
    expect(screen.alert()).toBeNull();
    expect(section.querySelector('[role="status"]')?.textContent).toContain(
      "Enter the cell concentration"
    );
    // The doubling time is not part of seeding: empty, it stops only the estimate.
    await screen.type("Available stock (mL)", "10");
    await screen.type("Doubling time (h)", "");
    expect(section.querySelector("table")).not.toBeNull();
    expect(screen.element.querySelector(".tool-chart")).toBeNull();
  });
  it("numbers records from a starting passage, and corrects, dates and deletes them", async () => {
    const screen = await mount(<CultureTool />, { id: "cell-culture" });
    const numbers = () =>
      (screen.data().passages as { number: number }[]).map((row) => row.number);
    await screen.type("Starting passage number (of the first record)", "12");
    expect(screen.data().startPassage).toBe(12);
    // Not a passage number: the field keeps the last valid one.
    await screen.type("Starting passage number (of the first record)", "1.5");
    expect(screen.data().startPassage).toBe(12);
    await screen.type("Medium", "DMEM + 10% FBS");
    // A passage done earlier, entered now.
    await screen.type("Passage date and time (empty: now)", "2026-11-20T14:30");
    await screen.press("Add passage record (P12)");
    expect(numbers()).toEqual([12]);
    expect((screen.data().passages as { at: string }[])[0].at).toBe(
      new Date(2026, 10, 20, 14, 30).toISOString()
    );
    // Once there is a record, the next number follows from it.
    expect(
      screen.field("Starting passage number (of the first record)")
    ).toBeNull();
    const before = Date.now();
    await screen.press("Add passage record (P13)");
    expect(numbers()).toEqual([12, 13]);
    expect(
      +new Date((screen.data().passages as { at: string }[])[1].at)
    ).toBeGreaterThanOrEqual(before);
    expect(screen.text()).toContain("Latest passage: P13");

    // Correct the older record: it was really P11, a day earlier.
    // The log shows the newest passage first.
    const records = () =>
      [...screen.element.querySelectorAll<HTMLElement>("details.tool-panel")];
    expect(
      records().map((row) => row.querySelector("summary")!.textContent!.slice(0, 3))
    ).toEqual(["P13", "P12"]);
    const older = () => records()[1];
    await screen.press("Edit", older());
    expect(screen.field("Passage number", older())!.value).toBe("12");
    expect(screen.field("Passage date and time", older())!.value).toBe(
      "2026-11-20T14:30"
    );
    await screen.type("Passage number", "eleven", older());
    await screen.press("Save record", older());
    expect(screen.alert()).toBe("Invalid number");
    expect(numbers()).toEqual([12, 13]);
    await screen.type("Passage number", "11", older());
    await screen.type("Passage date and time", "2026-11-19T09:00", older());
    await screen.type("Passage notes", "split 1:5", older());
    await screen.press("Save record", older());
    expect(screen.data().passages).toMatchObject([
      {
        number: 11,
        at: new Date(2026, 10, 19, 9, 0).toISOString(),
        medium: "DMEM + 10% FBS",
        notes: "split 1:5",
      },
      { number: 13 },
    ]);
    expect(screen.alert()).toBeNull();

    // Delete at once, with a way back to the same place in the log.
    await screen.press("Delete", older());
    expect(numbers()).toEqual([13]);
    expect(screen.text()).toContain("Passage P11 deleted.");
    await screen.press("Undo", screen.element.querySelector(".tool-undo")!);
    expect(numbers()).toEqual([11, 13]);
  });
  it("exports the passage log as CSV under a name of its own", async () => {
    const screen = await mount(<CultureTool />, {
      id: "cell-culture",
      data: {
        passages: [
          {
            id: "a",
            number: 12,
            at: new Date(2026, 10, 20, 14, 30).toISOString(),
            medium: "DMEM",
            antibiotics: "P/S",
            conditions: "37 °C",
            notes: "=split 1:5",
            snapshot: null,
          },
        ],
      },
    });
    await screen.press("Export records as CSV");
    const [text, options] = vi.mocked(exportBlobPartAsFile).mock.calls[0];
    expect(options).toMatchObject({ mimeType: "text/csv" });
    expect(options.fileName).toMatch(
      /^buril-cell-culture-passages-Test-\d{8}-\d{4}\.csv$/
    );
    expect(String(text).split("\r\n")).toEqual([
      '﻿"Passage","Date and time","Medium","Antibiotics","Culture conditions","Notes","Seeding density (cells/mL)","Seeding (vessel: stock + medium)"',
      // A note that looks like a formula is exported as text.
      '"12","2026-11-20 14:30","DMEM","P/S","37 °C","\'=split 1:5","",""',
    ]);
    // Nothing to export from an empty log.
    await act(() => root!.unmount());
    root = null;
    const empty = await mount(<CultureTool />, { id: "cell-culture" });
    expect(empty.button("Export records as CSV").disabled).toBe(true);
    expect(empty.text()).toContain("No passage records yet");
  });
  it("warns at the passage limit by passage number, not by how many were recorded", async () => {
    const record = (number: number) => ({
      id: `p${number}`,
      number,
      at: "2026-11-20T05:30:00.000Z",
      medium: "",
      antibiotics: "",
      conditions: "",
      notes: "",
      snapshot: null,
    });
    // Two records, but the line is already at P30 of 30.
    const screen = await mount(<CultureTool />, {
      id: "cell-culture",
      data: { maxPassages: 30, passages: [record(29), record(30)] },
    });
    expect(screen.text()).toContain("Passage limit reached.");
    await act(() => root!.unmount());
    root = null;
    const early = await mount(<CultureTool />, {
      id: "cell-culture",
      data: { maxPassages: 30, passages: [record(28), record(29)] },
    });
    expect(early.text()).not.toContain("Passage limit reached.");
  });
  it("plots the estimate on axes and says it is a model", async () => {
    // 25% → 100% with a 24 h doubling time: two doublings, 48 h.
    const screen = await mount(<CultureTool />, {
      id: "cell-culture",
      data: { start: 25, target: 100 },
    });
    expect(screen.result()).toBe("Estimated time to target: 48 h (about 2 days)");
    const chart = screen.element.querySelector(".tool-chart")!;
    expect(chart.querySelector("figcaption")?.textContent).toContain(
      "Model estimate (exponential growth, no lag phase), not a measurement"
    );
    const plot = chart.querySelector('svg[role="img"]')!;
    expect(plot.getAttribute("aria-label")).toBe(
      "Estimated confluence over time"
    );
    const labels = [...plot.querySelectorAll("text")].map(
      (node) => node.textContent
    );
    // Both axes are named, the target is a line and the moment it is reached
    // a named point.
    expect(labels).toContain("Time from now (h)");
    expect(labels).toContain("Confluence (%)");
    expect(labels).toContain("Now");
    expect(labels).toContain("Target 100% in 48 h");
    expect(plot.querySelectorAll(".tool-chart-rule")).toHaveLength(1);
    expect(plot.querySelectorAll(".tool-chart-line")).toHaveLength(1);
    // The same estimate as a table, at round times (every 10 h over 48 h)
    // and at the moment the target is reached.
    const rows = [...chart.querySelectorAll("tbody tr")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => cell.textContent)
    );
    expect(rows[0]).toEqual(["0", "25", "Now"]);
    expect(rows.at(-1)).toEqual(["48", "100", "Target reached (estimate)"]);
    // 20 h in: 25 × 2^(20 ÷ 24) = 44.5%.
    expect(rows.find((row) => row[0] === "20")).toEqual(["20", "44.5", ""]);
  });
  it("uses days on the time axis for a slow culture and density for a suspension", async () => {
    // 100,000 → 800,000 cells/mL is three doublings of 40 h = 120 h = 5 days.
    const screen = await mount(<CultureTool />, {
      id: "cell-culture",
      data: {
        profile: {
          kind: "suspension",
          doublingHours: 40,
          density: 100000,
          maxDensity: 1000000,
        },
        start: 100000,
        target: 800000,
      },
    });
    expect(screen.result()).toBe(
      "Estimated time to target: 120 h (about 5 days)"
    );
    const labels = [
      ...screen.element.querySelectorAll('.tool-chart svg[role="img"] text'),
    ].map((node) => node.textContent);
    expect(labels).toContain("Time from now (days)");
    expect(labels).toContain("Density (cells/mL)");
    expect(labels).toContain("Target 800,000 cells/mL in 120 h");
    // Above the cell line's maximum density there is no estimate.
    await screen.type("Target cells/mL", "2000000");
    expect(screen.alert()).toBe("Density cannot exceed the maximum density");
    expect(screen.element.querySelector(".tool-chart")).toBeNull();
    expect(screen.button("Start target timer").disabled).toBe(true);
  });
  it("explains what is missing or impossible instead of drawing a curve", async () => {
    const screen = await mount(<CultureTool />, { id: "cell-culture" });
    await screen.type("Target confluence (%)", "120");
    expect(screen.alert()).toBe("Confluence cannot exceed 100%");
    expect(screen.element.querySelector(".tool-chart")).toBeNull();
    await screen.type("Target confluence (%)", "");
    expect(screen.alert()).toBeNull();
    expect(screen.element.querySelector(".tool-chart")).toBeNull();
    expect(screen.text()).toContain(
      "Enter the current and target confluence and the doubling time"
    );
    expect(
      screen.button("Add next passage to calendar").disabled
    ).toBe(true);
  });
  it("adds the next passage to the calendar under the cell line's name", async () => {
    const screen = await mount(<CultureTool />, {
      id: "cell-culture",
      data: { name: "HeLa", start: 25, target: 100 },
    });
    const before = Date.now();
    await screen.press("Add next passage to calendar");
    // No calendar document yet: one is made, holding the event.
    expect(screen.repo.create).toHaveBeenCalledTimes(1);
    const [tool, , created] = screen.repo.create.mock.calls[0];
    expect(tool).toBe("calendar");
    const [event] = created.events as CalendarEvent[];
    expect(event.title).toBe("HeLa: passage due");
    // 48 h from now, on the minute, lasting an hour.
    const start = +new Date(event.start);
    expect(Math.abs(start - (before + 48 * 3600000))).toBeLessThanOrEqual(61000);
    expect(start % 60000).toBe(0);
    expect(+new Date(event.end) - start).toBe(3600000);
    expect(event.repeat).toBe("none");
    // The user is told, and the same estimate is not added twice.
    expect(
      screen.element.querySelector(".tool-cells-added")?.textContent
    ).toContain("Added to the calendar");
    expect(screen.text()).toContain("“HeLa: passage due”");
    expect(screen.button("Added to calendar").disabled).toBe(true);
    // A changed estimate is another event.
    await screen.type("Target confluence (%)", "50");
    expect(screen.button("Add next passage to calendar").disabled).toBe(false);
  });
  it("adds to the calendar the account already has", async () => {
    const calendar: ToolDocument = {
      id: "calendar",
      owner_id: "owner",
      tool_id: "calendar",
      title: "Calendar",
      data: { _workspace: true, events: [{ id: "existing" }] },
      schema_version: 1,
      engine_version: "1",
      revision: 3,
      updated_at: "",
    };
    const screen = await mount(<CultureTool />, {
      id: "cell-culture",
      others: [calendar],
    });
    await screen.press("Add next passage to calendar");
    expect(screen.repo.create).not.toHaveBeenCalled();
    const events = screen.items[1].doc.data.events as CalendarEvent[];
    expect(events.map((event) => event.id)[0]).toBe("existing");
    expect(events).toHaveLength(2);
    // Without a cell line name the event still says what it is.
    expect(events[1].title).toBe("Cell passage due");
  });
  it("starts the timer with the cell line's name and cancels it", async () => {
    const screen = await mount(<CultureTool />, {
      id: "cell-culture",
      data: { name: "HeLa", start: 25, target: 100 },
    });
    const before = Date.now();
    await screen.press("Start target timer");
    const timer = screen.data().timer as {
      id: string;
      end: number;
      name: string;
    };
    expect(timer.name).toBe("HeLa");
    expect(Math.abs(timer.end - (before + 48 * 3600000))).toBeLessThan(5000);
    expect(enableNotifications).toHaveBeenCalledTimes(1);
    expect(setDeviceEnabled).toHaveBeenLastCalledWith("owner", timer.id, true);
    expect(
      screen.element.querySelector(".tool-cells-timer-name")?.textContent
    ).toBe("HeLa");
    expect(screen.text()).toContain("Timer ends");
    // With a timer running, the calendar event is at the timer's end.
    await screen.press("Add next passage to calendar");
    const [, , created] = screen.repo.create.mock.calls[0];
    expect(+new Date((created.events as CalendarEvent[])[0].start)).toBe(
      Math.round(timer.end / 60000) * 60000
    );
    await screen.press("Cancel timer");
    expect(screen.data().timer).toBeNull();
    expect(setDeviceEnabled).toHaveBeenLastCalledWith("owner", timer.id, false);
  });
  it("opens work saved by an older build unchanged", async () => {
    // Numbers everywhere, no presets, no starting passage, a timer without a name.
    const screen = await mount(<CultureTool />, {
      id: "cell-culture",
      data: {
        name: "CHO",
        profile: {
          kind: "adherent",
          doublingHours: 24,
          density: 100000,
          maxDensity: 1000000,
        },
        maxPassages: 30,
        concentration: 1000000,
        available: 10,
        vessels: [
          {
            id: "t25",
            name: "T25",
            area: 25,
            volume: 5,
            count: 1,
            mode: "split",
            target: 5,
          },
        ],
        start: 30,
        target: 80,
        timer: { id: "old", end: Date.now() + 3600000 },
        passages: [],
      },
    });
    expect(screen.select("Vessel preset")!.value).toBe("custom");
    expect(screen.field("Vessel")!.value).toBe("T25");
    // 1:5 of 10 mL → 2 mL of stock + 3 mL of medium, 80% confluence.
    expect(
      [...seedingSection(screen.element).querySelectorAll("tbody td")].map(
        (cell) => cell.textContent
      )
    ).toEqual(["T25 ×1", "2,000,000", "2 / 3", "80%"]);
    // 30% → 80%: 24 h × log2(80 ÷ 30) = 33.96 h → 34 h.
    expect(screen.result()).toBe("Estimated time to target: 34 h");
    expect(
      screen.element.querySelector(".tool-cells-timer-name")?.textContent
    ).toBe("CHO");
    expect(screen.button("Add passage record (P0)")).toBeDefined();
  });
  it("is in Korean on a Korean screen", async () => {
    locale.language = "ko";
    const screen = await mount(<CultureTool />, {
      id: "cell-culture",
      data: { name: "HeLa", start: 25, target: 100 },
      handoff: density,
    });
    expect(screen.text()).toContain("모델 예상 (지연기 없는 지수 성장) · 실측값이 아닙니다");
    expect(screen.text()).toContain("세포 계수에서 가져온 값");
    await screen.press("다음 계대를 캘린더에 추가");
    const [, , created] = screen.repo.create.mock.calls[0];
    expect((created.events as CalendarEvent[])[0].title).toBe("HeLa 계대 예정");
  });
});
