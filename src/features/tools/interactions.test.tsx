// @vitest-environment jsdom
import { act, useState, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it, expect, vi } from "vitest";
import { ToolContext } from "./ui";
import type { ToolDocument } from "./registry";
import type { ToolRepository } from "./repository";
import Equation from "./EquationTool";
import Plate from "./PlateTool";
import UnitTool from "./UnitTool";
import CounterTool from "./CounterTool";
import { TimerTool } from "./TimeTools";
import CalibrationTool from "./CalibrationTool";
import MolarityTool from "./MolarityTool";
import { searchChemical } from "../../services/searchService";
vi.mock("../../services/searchService", () => ({ searchChemical: vi.fn() }));
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
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(() => root?.unmount());
  document.body.innerHTML = "";
  root = null;
});
async function mount(
  children: ReactNode,
  initialData: Record<string, unknown> = {}
) {
  let doc: ToolDocument = {
    id: "doc",
    owner_id: "owner",
    tool_id: "custom-equation",
    title: "Test",
    data: initialData,
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
  return { element, getDoc: () => doc };
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
const field = (container: HTMLElement, label: string) => {
  const element = [...container.querySelectorAll("label")].find(
    (l) => l.querySelector("span")?.textContent === label
  );
  return (element?.querySelector("input") ??
    element?.control) as HTMLInputElement;
};
const button = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === text
  )!;
describe("tool input workflows", () => {
  it("opens an existing empty stopwatch workspace with a working start control", async () => {
    const { element, getDoc } = await mount(<TimerTool stopwatch />, {
      clocks: [],
    });
    await act(() => button(element, "Start").click());
    expect(getDoc().data.clocks as { running: boolean }[]).toHaveLength(1);
    expect((getDoc().data.clocks as { running: boolean }[])[0].running).toBe(
      true
    );
    await act(() => button(element, "Pause").click());
    expect((getDoc().data.clocks as { running: boolean }[])[0].running).toBe(
      false
    );
  });
  it("keeps an invalid first standard instead of silently treating it as a header", async () => {
    const { element, getDoc } = await mount(<CalibrationTool />);
    await act(() => element.querySelector("summary")!.click());
    const textarea = element.querySelector("textarea")!;
    await act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )!.set!.call(textarea, "oops,1\n1,3\n2,5");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => button(element, "Apply standards").click());
    expect((getDoc().data.standards as { x: string }[])[0].x).toBe("oops");
    expect(element.querySelector("[role=alert]")?.textContent).toContain(
      "Invalid standard row"
    );
  });
  it("keeps standards while switching mobile views and distinguishes blank sample input from zero", async () => {
    const { element, getDoc } = await mount(<CalibrationTool />);
    await act(() =>
      element
        .querySelector<HTMLButtonElement>(
          '[aria-label="Standard 1 included in fit"]'
        )!
        .click()
    );
    await act(() => button(element, "Curve & samples").click());
    expect(
      (getDoc().data.standards as { excluded: boolean }[])[0].excluded
    ).toBe(true);
    expect(
      element
        .querySelector("[role=tabpanel]:not([hidden])")
        ?.getAttribute("aria-labelledby")
    ).toContain("analysis-tab");
    expect(
      element.querySelector(".tool-calibration-equation")?.textContent
    ).toBe("y = 2x + 1");
    const sampleInput = field(element, "Signal");
    await input(sampleInput, "");
    expect(element.querySelector("output")?.textContent).toBe("—");
    expect(element.querySelector(".tool-calibration-extrapolation")).toBeNull();
    await input(sampleInput, "0");
    expect(element.querySelector("output")?.textContent).toBe("-0.5");
    await act(() => button(element, "Standards").click());
    expect(
      element.querySelector<HTMLInputElement>('[aria-label="Standard 2 y"]')!
        .value
    ).toBe("3");
  });
  it("prepares a 10 mM solution, preserves quantities on unit changes and supports mole-based calculations", async () => {
    const { element } = await mount(<MolarityTool />);
    const select = async (label: string, value: string) =>
      act(() => {
        const control = element.querySelector<HTMLSelectElement>(
          `select[aria-label="${label}"]`
        )!;
        control.value = value;
        control.dispatchEvent(new Event("change", { bubbles: true }));
      });
    await act(() => button(element, "Mass").click());
    await input(field(element, "Molarity"), "0.01");
    await input(field(element, "Final volume"), "0.1");
    await select("Molarity unit", "mM");
    expect(field(element, "Molarity").value).toBe("10");
    await select("Final volume unit", "mL");
    expect(field(element, "Final volume").value).toBe("100");
    await select("Result unit", "mg");
    expect(element.querySelector("output")?.textContent).toBe("58.44");
    await act(() => button(element, "From moles").click());
    expect(element.textContent).not.toContain("Find reagent molecular weight");
    await input(field(element, "Amount"), "2");
    expect(element.querySelector("output")?.textContent).toBe("20");
    await input(field(element, "Amount"), "");
    expect(element.querySelector("output")?.textContent).toBe("—");
    await input(field(element, "Amount"), "0");
    expect(element.querySelector("output")?.textContent).toBe("0");
  });
  it("previews a matched reagent before applying its molecular weight and reuses it from recent reagents", async () => {
    vi.mocked(searchChemical).mockResolvedValueOnce({
      id: "water",
      name: "Water",
      casNumber: "7732-18-5",
      molecularFormula: "H2O",
      molecularWeight: 18.015,
    });
    const { element, getDoc } = await mount(<MolarityTool />);
    await act(() => element.querySelector("summary")!.click());
    await input(
      element.querySelector<HTMLInputElement>('[aria-label="Search reagent"]')!,
      "water"
    );
    await act(async () =>
      element
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
    expect(
      element.querySelector(".tool-molarity-found")?.textContent
    ).toContain("7732-18-5");
    expect(getDoc().data.mw).toBe("58.44");
    await act(() => button(element, "Use this molecular weight").click());
    expect(getDoc().data.mw).toBe("18.015");
    expect(getDoc().data.recentReagents).toHaveLength(1);
    await input(field(element, "Molecular weight"), "20");
    expect(getDoc().data.reagent).toBeNull();
    await act(() =>
      element
        .querySelector<HTMLButtonElement>(".tool-molarity-recents button")!
        .click()
    );
    expect(getDoc().data.mw).toBe("18.015");
  });
  it("filters conversion units and asks for molecular weight only when needed", async () => {
    const { element } = await mount(<UnitTool />);
    expect(element.querySelector("output")?.textContent).toContain("1,000");
    expect(element.textContent).not.toContain("Molecular weight (g/mol)");
    await act(() => button(element, "Concentration").click());
    await act(() => {
      const select = [...element.querySelectorAll("select")].at(-1)!;
      select.value = "mg/mL";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(element.textContent).toContain("Molecular weight (g/mol)");
    await input(field(element, "Molecular weight (g/mol)"), "180");
    expect(element.querySelector("output")?.textContent).toContain("180");
    await act(() => button(element, "Swap").click());
    expect(element.querySelector("output")?.textContent).toContain("1");
  });
  it("counts rapid taps without dropping increments and restores the last count with undo", async () => {
    const { element, getDoc } = await mount(<CounterTool />);
    await act(() => button(element, "Single counter").click());
    const hit = element.querySelector<HTMLButtonElement>(
      '[aria-label="Counter 1 +1"]'
    )!;
    await act(() => {
      hit.click();
      hit.click();
      hit.click();
    });
    const groups = getDoc().data.groups as { items: { value: number }[] }[];
    expect(groups[0].items[0].value).toBe(3);
    await act(() => button(element, "Undo").click());
    expect((getDoc().data.groups as typeof groups)[0].items[0].value).toBe(2);
    await act(() => button(element, "Focus mode").click());
    expect(
      element.querySelector("[role=dialog]")?.getAttribute("aria-modal")
    ).toBe("true");
    await act(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    );
    expect(element.querySelector("[role=dialog]")).toBeNull();
  });
  it("calculates an equation, locks a constant and resets only unlocked values", async () => {
    const { element, getDoc } = await mount(<Equation />);
    await input(element.querySelector('[aria-label="Equation"]')!, "a*b+c");
    for (const [key, value] of Object.entries({ a: "2", b: "3", c: "1" }))
      await input(field(element, key), value);
    expect(element.querySelector("output")?.textContent).toBe("7");
    await act(() =>
      element.querySelector<HTMLInputElement>("input[type=checkbox]")!.click()
    );
    await act(() => button(element, "Reset unlocked").click());
    expect(getDoc().data.values).toEqual({ a: "2", b: "", c: "" });
    expect(field(element, "a").disabled).toBe(true);
    expect(element.querySelector("[role=alert]")?.textContent).toContain(
      "Enter b"
    );
    await input(element.querySelector('[aria-label="Equation"]')!, "b+c");
    await input(element.querySelector('[aria-label="Equation"]')!, "a*b+c");
    expect((getDoc().data.values as Record<string, string>).a).toBe("");
    expect((getDoc().data.locked as Record<string, boolean>).a).toBe(false);
  });
  it("applies a sample to multiple wells and retains the annotations when changing plate size", async () => {
    const { element, getDoc } = await mount(<Plate />);
    await act(() => element.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    await act(() => element.querySelector<HTMLButtonElement>('[aria-label="A1"]')!.click());
    await act(() => element.querySelector<HTMLButtonElement>('[aria-label="A2"]')!.click());
    await input(field(element, "Sample"), "Control");
    await input(field(element, "Condition / concentration"), "Vehicle");
    await act(() => button(element, "Apply to selected wells").click());
    const wells = getDoc().data.wells as Record<
      string,
      { sample: string; condition: string }
    >;
    expect(wells.A1).toMatchObject({ sample: "Control", condition: "Vehicle" });
    expect(wells.A2.sample).toBe("Control");
    await act(() => {
      const select = element.querySelector("select")!;
      select.value = "24";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect((getDoc().data.wells as typeof wells).A1.sample).toBe("Control");
  });
  it("loads a saved well, pastes its draft only on apply, and selects a whole row", async () => {
    const saved = { sample: "Drug X", condition: "1 μM", replicate: "1", color: "#bfdbfe" };
    const { element, getDoc } = await mount(<Plate />, { size: "24", wells: { A1: saved } });
    const clickLabel = async (label: string) => act(() => {
      element.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
    });
    await clickLabel("A1 · Drug X · 1 μM · 1");
    expect(field(element, "Sample").value).toBe("Drug X");
    await clickLabel("Copy content");
    await clickLabel("A2");
    expect(element.querySelectorAll('.tool-plate [aria-pressed="true"]')).toHaveLength(1);
    expect(field(element, "Sample").value).toBe("");
    await clickLabel("Paste");
    expect((getDoc().data.wells as Record<string, unknown>).A2).toBeUndefined();
    await act(() => button(element, "Apply to selected wells").click());
    expect((getDoc().data.wells as Record<string, unknown>).A2).toEqual(saved);
    await clickLabel("Select row B");
    expect(element.querySelectorAll('.tool-plate [aria-pressed="true"]')).toHaveLength(6);
    expect(element.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
  });

});
