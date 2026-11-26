// @vitest-environment jsdom
import { act, useEffect, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolContext, csv } from "./ui";
import type { ToolDocument } from "./registry";
import type { ToolRepository } from "./repository";
import CounterTool from "./CounterTool";
import ToolGuide from "./ToolGuide";
import {
  MAX_ITEMS,
  UNDO_LIMIT,
  changeText,
  countBy,
  counterGroups,
  counterShortcut,
  csvRows,
  fileNamePart,
  insertGroup,
  insertItem,
  percentText,
  removeItem,
  renameGroup,
  resetGroup,
  setValue,
  stepOf,
  summaryText,
  undoLast,
  wholeCount,
  type CountGroup,
  type CountItem,
} from "./counter";
import { exportBlobPartAsFile } from "../../utils/fileExport";
vi.mock("../../utils/fileExport", () => ({ exportBlobPartAsFile: vi.fn() }));
const locale = vi.hoisted(() => ({ language: "en" }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: locale, t: (s: string) => s }),
}));
vi.mock("../../locales/i18n", () => ({
  default: { language: "en", t: (s: string) => s },
}));
vi.mock("../../services/supabaseClient", () => ({ supabase: {} }));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const item = (id: string, name: string, value: number): CountItem => ({
  id,
  name,
  value,
  color: "#bfdbfe",
});
const viability = (): CountGroup => ({
  id: "viability",
  name: "Viability",
  items: [item("live", "Live", 182), item("dead", "Dead", 18)],
});
const colonies = (value = 3): CountGroup => ({
  id: "colonies",
  name: "Colonies",
  items: [item("colonies-item", "Colonies", value)],
});

describe("counter arithmetic", () => {
  it("rounds a share to one decimal, half up", () => {
    expect(percentText(182, 200)).toBe("91.0");
    expect(percentText(18, 200)).toBe("9.0");
    expect(percentText(1, 3)).toBe("33.3");
    expect(percentText(2, 3)).toBe("66.7");
    // 49 / 400 = 12.25 %, exactly half way between 12.2 and 12.3.
    expect(percentText(49, 400)).toBe("12.3");
    // 1 / 2000 = 0.05 %.
    expect(percentText(1, 2000)).toBe("0.1");
    expect(percentText(5, 5)).toBe("100.0");
    expect(percentText(0, 0)).toBe("0.0");
  });
  it("writes the summary line and the CSV rows with the same percentages", () => {
    expect(summaryText(viability(), "Total")).toBe(
      "Live 182 (91.0%) · Dead 18 (9.0%) · Total 200"
    );
    expect(summaryText(colonies(37), "Total")).toBe("Colonies 37");
    const rows = csvRows(viability(), ["Item", "Count", "Percentage (%)"]);
    expect(rows).toEqual([
      ["Item", "Count", "Percentage (%)"],
      ["Live", 182, "91.0"],
      ["Dead", 18, "9.0"],
    ]);
    expect(csv(rows)).toBe(
      '﻿"Item","Count","Percentage (%)"\r\n"Live","182","91.0"\r\n"Dead","18","9.0"'
    );
  });
  it("opens counters saved before multi-item counters existed", () => {
    expect(
      counterGroups(
        {
          groups: [],
          counters: [
            { id: "a", name: "Colonies", value: 7 },
            { id: "b", name: "Plaques", value: 3 },
            { id: "c", name: "Mitoses", value: 0 },
          ],
        },
        ["#111111", "#222222"]
      )
    ).toEqual([
      {
        id: "a",
        name: "Colonies",
        items: [{ id: "a", name: "Colonies", value: 7, color: "#111111" }],
      },
      {
        id: "b",
        name: "Plaques",
        items: [{ id: "b", name: "Plaques", value: 3, color: "#222222" }],
      },
      {
        id: "c",
        name: "Mitoses",
        items: [{ id: "c", name: "Mitoses", value: 0, color: "#111111" }],
      },
    ]);
    // Once counters are saved in the newer shape, the old field is not read.
    const groups = [viability()];
    expect(
      counterGroups(
        { groups, counters: [{ id: "a", name: "Old", value: 1 }] },
        ["#111111"]
      )
    ).toBe(groups);
  });
  it("counts by the counter's step and never goes below zero", () => {
    const byFive = { ...colonies(3), step: 5 };
    expect(countBy(byFive, "colonies-item", 1).items[0].value).toBe(8);
    const floored = countBy(byFive, "colonies-item", -1);
    expect(floored.items[0].value).toBe(0);
    expect(undoLast(floored).items[0].value).toBe(3);
    // Nothing left to take away: the same object says nothing changed.
    expect(countBy(floored, "colonies-item", -1)).toBe(floored);
    expect(countBy(byFive, "missing", 1)).toBe(byFive);
    for (const step of [undefined, null, 0, -5, 2.5, 5000, Number.NaN])
      expect(stepOf({ ...colonies(), step })).toBe(1);
    expect(stepOf({ ...colonies(), step: "5" as unknown as number })).toBe(1);
    expect(stepOf({ ...colonies(), step: 1000 })).toBe(1000);
  });
  it("keeps only the last 20 changes and stores them compactly", () => {
    let group: CountGroup = {
      id: "g",
      name: "Cells",
      items: [item("0f8fad5b-d9cb-469f-a165-70867728950e", "Cells", 0)],
    };
    for (let press = 0; press < 25; press++)
      group = countBy(group, group.items[0].id, 1);
    expect(group.items[0].value).toBe(25);
    expect(group.undo).toHaveLength(UNDO_LIMIT);
    // 20 steps of {"<36-character id>":<1-2 digits>}: at most 20 × 43
    // characters, 19 commas and 2 brackets.
    expect(JSON.stringify(group.undo).length).toBeLessThanOrEqual(881);
    for (let press = 0; press < 20; press++) group = undoLast(group);
    expect(group.items[0].value).toBe(5);
    expect(group.undo).toEqual([]);
    expect(undoLast(group)).toBe(group);
  });
  it("resets as one change that undo puts back", () => {
    const counted: CountGroup = {
      ...viability(),
      items: [...viability().items, item("debris", "Debris", 0)],
    };
    const reset = resetGroup(counted);
    expect(reset.items.map((row) => row.value)).toEqual([0, 0, 0]);
    expect(reset.undo).toEqual([{ live: 182, dead: 18 }]);
    expect(undoLast(reset).items.map((row) => row.value)).toEqual([182, 18, 0]);
    expect(resetGroup(reset)).toBe(reset);
  });
  it("sets a typed value as an undoable change and rejects what is not a count", () => {
    const typed = setValue(colonies(3), "colonies-item", 42);
    expect(typed.items[0].value).toBe(42);
    expect(typed.undo).toEqual([{ "colonies-item": 3 }]);
    expect(setValue(typed, "colonies-item", 42)).toBe(typed);
    expect(wholeCount(0)).toBe(0);
    expect(wholeCount(9_999_999)).toBe(9_999_999);
    for (const bad of [1.5, -1, 10_000_000, Number.NaN])
      expect(() => wholeCount(bad)).toThrow(
        "Count must be a whole number from 0 to 9,999,999"
      );
  });
  it("removes and restores items, keeping one item and at most twelve", () => {
    const group: CountGroup = {
      ...viability(),
      undo: [{ live: 1 }, { dead: 3 }, { live: 2, dead: 4 }],
    };
    const removed = removeItem(group, "dead");
    expect(removed.items.map((row) => row.id)).toEqual(["live"]);
    // Steps that only concerned the removed item are gone with it.
    expect(removed.undo).toEqual([{ live: 1 }, { live: 2 }]);
    expect(removeItem(removed, "live")).toBe(removed);
    const restored = insertItem(removed, group.items[1], 1);
    expect(restored.items).toEqual(group.items);
    expect(insertItem(restored, group.items[1], 0)).toBe(restored);
    const first = insertItem(removed, item("debris", "Debris", 5), 0);
    expect(first.items.map((row) => row.id)).toEqual(["debris", "live"]);
    let full = removed;
    for (let n = 1; n < MAX_ITEMS; n++)
      full = insertItem(full, item(`extra-${n}`, `Extra ${n}`, 0));
    expect(full.items).toHaveLength(12);
    expect(insertItem(full, item("one-more", "One more", 0))).toBe(full);
  });
  it("puts a deleted counter back in its place once", () => {
    const groups = [colonies(), viability()];
    const without = [groups[1]];
    expect(insertGroup(without, groups[0], 0)).toEqual(groups);
    expect(insertGroup(groups, groups[0], 0)).toBe(groups);
    expect(insertGroup([], groups[1], 5)).toEqual([groups[1]]);
  });
  it("renames the only item with its counter while they share a name", () => {
    const renamed = renameGroup(colonies(), "Plate 3");
    expect([renamed.name, renamed.items[0].name]).toEqual([
      "Plate 3",
      "Plate 3",
    ]);
    const own = renameGroup(
      { ...colonies(), items: [item("i", "CFU", 3)] },
      "Plate 3"
    );
    expect([own.name, own.items[0].name]).toEqual(["Plate 3", "CFU"]);
    expect(
      renameGroup(viability(), "Day 2").items.map((row) => row.name)
    ).toEqual(["Live", "Dead"]);
  });
  it("describes a change for screen readers", () => {
    const before = viability();
    expect(changeText(before, countBy(before, "live", 1), "Total")).toBe(
      "Live 183"
    );
    expect(changeText(before, resetGroup(before), "Total")).toBe("Total 0");
    expect(changeText(before, before, "Total")).toBe("");
  });
  it("reads counting shortcuts from key presses", () => {
    expect(counterShortcut({ key: "1", code: "Digit1" })).toEqual({
      action: "count",
      index: 0,
      direction: 1,
    });
    // Shift turns the character into a symbol; the physical key still counts.
    expect(
      counterShortcut({ key: "#", code: "Digit3", shiftKey: true })
    ).toEqual({ action: "count", index: 2, direction: -1 });
    expect(counterShortcut({ key: "9", code: "Numpad9" })).toEqual({
      action: "count",
      index: 8,
      direction: 1,
    });
    // Shift + number pad arrives as a navigation key without Shift.
    expect(counterShortcut({ key: "End", code: "Numpad1" })).toBeNull();
    expect(counterShortcut({ key: "0", code: "Digit0" })).toBeNull();
    expect(counterShortcut({ key: " ", code: "Space" })).toEqual({
      action: "count-selected",
    });
    expect(counterShortcut({ key: "Enter", code: "Enter" })).toEqual({
      action: "count-selected",
    });
    expect(counterShortcut({ key: "Backspace", code: "Backspace" })).toEqual({
      action: "undo",
    });
    expect(
      counterShortcut({ key: "1", code: "Digit1", ctrlKey: true })
    ).toBeNull();
    expect(
      counterShortcut({ key: "1", code: "Digit1", metaKey: true })
    ).toBeNull();
    expect(counterShortcut({ key: "a", code: "KeyA" })).toBeNull();
  });
  it("makes a counter name safe inside a file name", () => {
    expect(fileNamePart(" Live / dead: plate 1 ")).toBe("Live-dead-plate-1");
    expect(fileNamePart("///")).toBeUndefined();
    expect(fileNamePart("x".repeat(60))).toHaveLength(40);
  });
});

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(() => root?.unmount());
  document.body.innerHTML = "";
  root = null;
  locale.language = "en";
  localStorage.clear();
  Reflect.deleteProperty(navigator, "vibrate");
  Reflect.deleteProperty(navigator, "clipboard");
  vi.mocked(exportBlobPartAsFile).mockClear();
});
async function mount(children: ReactNode, initialData: Record<string, unknown>) {
  let doc: ToolDocument = {
    id: "doc",
    owner_id: "owner",
    tool_id: "counter",
    title: "Counter",
    data: { _workspace: true, ...initialData },
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
      <ToolContext.Provider value={{ doc: state, repo, documents: [] }}>
        {children}
      </ToolContext.Provider>
    );
  }
  root = createRoot(element);
  await act(() => root!.render(<Harness />));
  return {
    element,
    getDoc: () => doc,
    groups: () => doc.data.groups as CountGroup[],
  };
}
async function type(element: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const field = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll("label")]
    .find((l) => l.querySelector("span")?.textContent === label)
    ?.querySelector("input") as HTMLInputElement;
const button = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === text
  )!;
const labelled = (container: HTMLElement, label: string) =>
  container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
const click = (target: HTMLElement) => act(() => target.click());
const openCounter = (container: HTMLElement, name: string) =>
  click(
    [...container.querySelectorAll<HTMLElement>(".tool-counter-preview")].find(
      (preview) => preview.querySelector("strong")?.textContent === name
    )!
  );
const press = (
  target: EventTarget,
  key: string,
  code: string,
  more: KeyboardEventInit = {}
) =>
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        code,
        bubbles: true,
        cancelable: true,
        ...more,
      })
    );
  });

describe("counter screen", () => {
  it("opens a legacy document and saves it in the current shape", async () => {
    const { element, getDoc, groups } = await mount(<CounterTool />, {
      counters: [{ id: "a", name: "Colonies", value: 7 }],
    });
    await openCounter(element, "Colonies");
    await click(labelled(element, "Colonies +1"));
    expect(groups()[0].items[0]).toMatchObject({
      id: "a",
      name: "Colonies",
      value: 8,
    });
    expect(getDoc().data.counters).toEqual([]);
    expect(getDoc().data._workspace).toBe(true);
  });
  it("deletes a counter and puts it back with its values", async () => {
    const counted = { ...colonies(7), step: 5, undo: [{ "colonies-item": 2 }] };
    const { element, groups } = await mount(<CounterTool />, {
      groups: [counted, viability()],
    });
    await openCounter(element, "Colonies");
    await click(button(element, "Delete counter"));
    expect(groups()).toEqual([viability()]);
    // Back on the list, with the offer to undo.
    expect(element.querySelector(".tool-counter-list")).not.toBeNull();
    const bar = element.querySelector<HTMLElement>(".tool-undo")!;
    expect(bar.textContent).toContain("Counter “Colonies” deleted.");
    await click(button(bar, "Undo"));
    expect(groups()).toEqual([counted, viability()]);
    expect(element.querySelector(".tool-undo")).toBeNull();
  });
  it("adds, renames and removes items after creation, up to twelve", async () => {
    const { element, groups } = await mount(<CounterTool />, {
      groups: [viability()],
    });
    await openCounter(element, "Viability");
    await click(button(element, "Add item"));
    expect(groups()[0].items).toHaveLength(3);
    expect(groups()[0].items[2]).toMatchObject({ name: "Item 3", value: 0 });
    await type(field(element, "Item 3"), "Debris");
    expect(groups()[0].items[2].name).toBe("Debris");
    expect(labelled(element, "Debris +1")).not.toBeNull();

    await click(labelled(element, "Remove item: Dead"));
    expect(groups()[0].items.map((row) => row.name)).toEqual([
      "Live",
      "Debris",
    ]);
    const bar = element.querySelector<HTMLElement>(".tool-undo")!;
    expect(bar.textContent).toContain("Item “Dead” removed.");
    await click(button(bar, "Undo"));
    expect(
      groups()[0].items.map((row) => [row.name, row.value])
    ).toEqual([
      ["Live", 182],
      ["Dead", 18],
      ["Debris", 0],
    ]);

    expect(element.textContent).not.toContain("up to 12 items");
    for (let n = 3; n < 12; n++) await click(button(element, "Add item"));
    expect(groups()[0].items).toHaveLength(12);
    expect(button(element, "Add item").disabled).toBe(true);
    expect(element.textContent).toContain("A counter can have up to 12 items.");
  });
  it("says so when a new counter reaches twelve items", async () => {
    const { element } = await mount(<CounterTool />, {});
    await click(button(element, "Multi counter"));
    for (let n = 2; n < 12; n++) await click(button(element, "Add item"));
    expect(field(element, "Item 12")).not.toBeUndefined();
    expect(button(element, "Add item").disabled).toBe(true);
    expect(element.textContent).toContain("A counter can have up to 12 items.");
  });
  it("takes a typed value and counts by the chosen step, never below zero", async () => {
    const { element, groups } = await mount(<CounterTool />, {
      groups: [colonies(3)],
    });
    const value = () => groups()[0].items[0].value;
    await openCounter(element, "Colonies");
    await click(labelled(element, "Type a value for Colonies"));
    const entry = field(element, "Colonies value");
    expect(entry.value).toBe("3");
    expect(document.activeElement).toBe(entry);
    // The big button gives way to the field, so typing cannot count.
    expect(element.querySelector(".tool-counting-hit")).toBeNull();

    await type(entry, "1.5");
    expect(element.querySelector("[role=alert]")?.textContent).toBe(
      "Count must be a whole number from 0 to 9,999,999"
    );
    expect(button(element, "Apply").disabled).toBe(true);
    await type(entry, "");
    expect(element.querySelector("[role=alert]")).toBeNull();
    expect(button(element, "Apply").disabled).toBe(true);
    await type(entry, "42");
    await click(button(element, "Apply"));
    expect(value()).toBe(42);
    expect(document.activeElement).toBe(
      labelled(element, "Type a value for Colonies")
    );

    await click(button(element, "±5"));
    expect(groups()[0].step).toBe(5);
    expect(button(element, "±5").getAttribute("aria-pressed")).toBe("true");
    expect(labelled(element, "Colonies +5").textContent).toContain(
      "Tap to count +5"
    );
    await click(labelled(element, "Colonies +5"));
    expect(value()).toBe(47);

    await click(labelled(element, "Type a value for Colonies"));
    await type(field(element, "Colonies value"), "3");
    await click(button(element, "Apply"));
    await click(labelled(element, "Colonies −5"));
    expect(value()).toBe(0);
    expect(labelled(element, "Colonies −5").disabled).toBe(true);
    // The disabled button does not keep focus: the keys must go on working.
    expect(document.activeElement).toBe(labelled(element, "Colonies +5"));
    await click(button(element, "Undo"));
    expect(value()).toBe(3);

    // A step that is not a whole number from 1 to 1000 is not kept.
    const step = field(element, "Count by");
    await type(step, "10");
    expect(groups()[0].step).toBe(10);
    await type(step, "0");
    expect(groups()[0].step).toBe(10);
    await type(step, "2.5");
    expect(groups()[0].step).toBe(10);
    await type(step, "");
    expect(groups()[0].step).toBeNull();
    expect(labelled(element, "Colonies +1")).not.toBeNull();
  });
  it("announces each count and vibrates unless turned off on this device", async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: vibrate,
    });
    const first = await mount(<CounterTool />, { groups: [viability()] });
    await openCounter(first.element, "Viability");
    const live = first.element.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe("");
    const hit = labelled(first.element, "Live +1");
    await click(hit);
    expect(live.textContent).toBe("Live 183");
    // The button's description is the value now on it.
    expect(
      document.getElementById(hit.getAttribute("aria-describedby")!)
        ?.textContent
    ).toBe("183");
    expect(vibrate).toHaveBeenLastCalledWith(12);
    await click(labelled(first.element, "Dead −1"));
    expect(live.textContent).toBe("Dead 17");
    expect(vibrate).toHaveBeenLastCalledWith([12, 60, 12]);
    expect(vibrate).toHaveBeenCalledTimes(2);

    const toggle = [...first.element.querySelectorAll("label")]
      .find((l) => l.textContent === "Vibrate on each count (this device)")!
      .querySelector("input")!;
    expect(toggle.checked).toBe(true);
    await click(toggle);
    expect(localStorage.getItem("buril-tools-counter-haptics")).toBe("off");
    await click(hit);
    expect(live.textContent).toBe("Live 184");
    expect(vibrate).toHaveBeenCalledTimes(2);

    // The choice belongs to the device: it is still off when the tool reopens.
    await act(() => root!.unmount());
    const second = await mount(<CounterTool />, first.getDoc().data);
    await openCounter(second.element, "Viability");
    await click(labelled(second.element, "Live +1"));
    expect(second.groups()[0].items[0].value).toBe(185);
    expect(vibrate).toHaveBeenCalledTimes(2);
  });
  it("offers no vibration setting where the device cannot vibrate", async () => {
    const { element } = await mount(<CounterTool />, { groups: [colonies()] });
    await openCounter(element, "Colonies");
    expect(element.textContent).not.toContain("Vibrate");
    await click(labelled(element, "Colonies +1"));
    expect(element.querySelector('[aria-live="polite"]')?.textContent).toBe(
      "Colonies 4"
    );
  });
  it("counts from the keyboard in the counting area and in focus mode", async () => {
    const { element, getDoc, groups } = await mount(<CounterTool />, {
      groups: [
        {
          id: "g",
          name: "Differential",
          items: [item("a", "A", 0), item("b", "B", 0), item("c", "C", 0)],
        },
      ],
    });
    const values = () => groups()[0].items.map((row) => row.value);
    await openCounter(element, "Differential");
    const area = element.querySelector<HTMLElement>(
      '[role=group][aria-label="Counting area"]'
    )!;
    // Opened with focus in the area, so the keys work at once.
    expect(document.activeElement).toBe(area);
    expect(element.querySelector(".tool-counter-x-keys")?.textContent).toContain(
      "Shift+1–9"
    );

    // Nothing is selected yet, so Space has no item to count.
    const untouched = getDoc();
    await press(area, " ", "Space");
    expect(getDoc()).toBe(untouched);

    await press(area, "2", "Digit2");
    expect(values()).toEqual([0, 1, 0]);
    // Focus follows the count, so Space on the button presses the same item.
    expect(document.activeElement).toBe(labelled(element, "B +1"));
    await press(area, "@", "Digit2", { shiftKey: true });
    expect(values()).toEqual([0, 0, 0]);
    // Subtracting at zero changes nothing and is not saved.
    const atZero = getDoc();
    await press(area, "@", "Digit2", { shiftKey: true });
    expect(getDoc()).toBe(atZero);

    await press(area, "3", "Numpad3");
    expect(values()).toEqual([0, 0, 1]);
    // Space and Enter add to the item last counted.
    await press(area, " ", "Space");
    await press(area, "Enter", "Enter");
    expect(values()).toEqual([0, 0, 3]);
    await press(area, "Backspace", "Backspace");
    expect(values()).toEqual([0, 0, 2]);

    const settled = getDoc();
    await press(area, "9", "Digit9");
    await press(area, "1", "Digit1", { ctrlKey: true });
    await press(area, "1", "Digit1", { repeat: true });
    await press(area, "Backspace", "Backspace", { repeat: true });
    // A focused button acts on Space itself; the shortcut must not add too.
    await press(labelled(element, "A +1"), " ", "Space");
    expect(getDoc()).toBe(settled);

    // Digits typed into the value field are text, not counts.
    await click(labelled(element, "Type a value for A"));
    await press(field(element, "A value"), "2", "Digit2");
    await press(field(element, "A value"), "Backspace", "Backspace");
    expect(getDoc()).toBe(settled);
    await press(field(element, "A value"), "Escape", "Escape");
    expect(field(element, "A value")).toBeUndefined();

    // Outside the counting area the keys do nothing.
    await press(field(element, "Counter name"), "1", "Digit1");
    await press(document.body, "1", "Digit1");
    expect(getDoc()).toBe(settled);

    await click(labelled(element, "C +1"));
    expect(values()).toEqual([0, 0, 3]);
    await click(button(element, "Focus mode"));
    // Focus lands on the selected item's button, not on "exit".
    expect(document.activeElement).toBe(labelled(element, "C +1"));
    expect(element.querySelector(".tool-counter-x-keys")?.textContent).toContain(
      "Esc"
    );
    await press(document.body, "1", "Digit1");
    expect(values()).toEqual([1, 0, 3]);
    await press(document.body, "!", "Digit1", { shiftKey: true });
    expect(values()).toEqual([0, 0, 3]);
    // The item last counted is the selected one.
    await press(document.body, " ", "Space");
    expect(values()).toEqual([1, 0, 3]);
    await press(document.body, "Backspace", "Backspace");
    expect(values()).toEqual([0, 0, 3]);
    await press(window, "Escape", "Escape");
    expect(element.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(button(element, "Focus mode"));
  });
  it("counts the only item of a single counter with Space, Enter and 1", async () => {
    const { element, groups } = await mount(<CounterTool />, {});
    await click(button(element, "Single counter"));
    const area = element.querySelector<HTMLElement>("[role=group]")!;
    expect(document.activeElement).toBe(area);
    await press(area, " ", "Space");
    await press(area, "Enter", "Enter");
    await press(area, "1", "Digit1");
    expect(groups()[0].items[0].value).toBe(3);
    await press(area, "2", "Digit2");
    expect(groups()[0].items[0].value).toBe(3);
  });
  it("can still undo after the counter is closed and the tool reopened", async () => {
    const first = await mount(<CounterTool />, {});
    await click(button(first.element, "Single counter"));
    const hit = labelled(first.element, "Counter 1 +1");
    for (let n = 0; n < 25; n++) await click(hit);
    expect(first.groups()[0].items[0].value).toBe(25);
    expect(first.groups()[0].undo).toHaveLength(20);

    await click(labelled(first.element, "Counter list"));
    await openCounter(first.element, "Counter 1");
    expect(button(first.element, "Undo").disabled).toBe(false);
    await click(button(first.element, "Undo"));
    expect(first.groups()[0].items[0].value).toBe(24);

    // Another tool was opened in between: the screen starts from the document.
    await act(() => root!.unmount());
    const second = await mount(<CounterTool />, first.getDoc().data);
    await openCounter(second.element, "Counter 1");
    await click(button(second.element, "Undo"));
    expect(second.groups()[0].items[0].value).toBe(23);
    for (let n = 0; n < 18; n++) await click(button(second.element, "Undo"));
    expect(second.groups()[0].items[0].value).toBe(5);
    expect(button(second.element, "Undo").disabled).toBe(true);
    expect(document.activeElement).toBe(
      second.element.querySelector('[aria-label="Counting area"]')
    );
  });
  it("lists every counter with its total and all items of a multi counter", async () => {
    const differential: CountGroup = {
      id: "diff",
      name: "Differential",
      items: [
        item("n", "Neutrophil", 58),
        item("l", "Lymphocyte", 30),
        item("m", "Monocyte", 6),
        item("e", "Eosinophil", 3),
        item("b", "Basophil", 1),
        item("x", "Blast", 2),
      ],
    };
    const { element } = await mount(<CounterTool />, {
      groups: [differential, colonies(1234)],
    });
    const [multi, single] = element.querySelectorAll<HTMLElement>(
      ".tool-counter-preview"
    );
    expect(multi.querySelector("strong")?.textContent).toBe("Differential");
    expect(multi.querySelector(".tool-counter-x-total")?.textContent).toBe(
      "Total 100"
    );
    expect(
      [...multi.querySelectorAll(".tool-counter-x-items > span")].map((cell) => [
        cell.querySelector("small")?.textContent,
        cell.querySelector("b")?.textContent,
      ])
    ).toEqual([
      ["Neutrophil", "58"],
      ["Lymphocyte", "30"],
      ["Monocyte", "6"],
      ["Eosinophil", "3"],
      ["Basophil", "1"],
      ["Blast", "2"],
    ]);
    expect(single.textContent).toBe("Colonies1,234");
  });
  it("exports one-decimal percentages under a dated name and copies a summary", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { element } = await mount(<CounterTool />, {
      groups: [{ ...viability(), name: "Viability / day 2" }],
    });
    await openCounter(element, "Viability / day 2");
    await click(button(element, "Export CSV"));
    expect(exportBlobPartAsFile).toHaveBeenCalledTimes(1);
    const [text, options] = vi.mocked(exportBlobPartAsFile).mock.calls[0];
    expect(text).toBe(
      '﻿"Item","Count","Percentage (%)"\r\n"Live","182","91.0"\r\n"Dead","18","9.0"'
    );
    expect(options.mimeType).toBe("text/csv");
    expect(options.fileName).toMatch(
      /^buril-counter-Viability-day-2-\d{8}-\d{4}\.csv$/
    );

    await act(async () => button(element, "Copy result").click());
    expect(writeText).toHaveBeenCalledWith(
      "Live 182 (91.0%) · Dead 18 (9.0%) · Total 200"
    );
  });
  it("leaves no Korean on the English counting screen, labels included", async () => {
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: () => true,
    });
    const { element } = await mount(<CounterTool />, {
      groups: [viability()],
    });
    await openCounter(element, "Viability");
    expect(element.innerHTML).not.toMatch(/[가-힣]/);
    await click(labelled(element, "Type a value for Live"));
    await type(field(element, "Live value"), "x");
    expect(element.innerHTML).not.toMatch(/[가-힣]/);
    await click(button(element, "Cancel"));
    await click(button(element, "Reset"));
    await click(labelled(element, "Remove item: Dead"));
    expect(element.innerHTML).not.toMatch(/[가-힣]/);
    await click(button(element, "Focus mode"));
    expect(element.innerHTML).not.toMatch(/[가-힣]/);
    await press(window, "Escape", "Escape");
    await click(button(element, "Delete counter"));
    expect(element.innerHTML).not.toMatch(/[가-힣]/);
    // Every button on the way had a name: text or an aria-label.
    for (const control of element.querySelectorAll("button"))
      expect(
        control.textContent || control.getAttribute("aria-label")
      ).toBeTruthy();
  });
  it("has a guide with the same number of steps in both languages", async () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    root = createRoot(element);
    await act(() => root!.render(<ToolGuide id="counter" />));
    const english = element.querySelectorAll("li").length;
    expect(english).toBeGreaterThanOrEqual(3);
    expect(english).toBeLessThanOrEqual(4);
    expect(element.textContent).not.toMatch(/[가-힣]/);
    locale.language = "ko";
    await act(() => root!.render(<ToolGuide id="counter" key="ko" />));
    expect(element.querySelectorAll("li")).toHaveLength(english);
    expect(element.textContent).toMatch(/[가-힣]/);
  });
});
