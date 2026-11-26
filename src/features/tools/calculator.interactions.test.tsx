// @vitest-environment jsdom
import { act, useState, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it, expect, vi } from "vitest";
import { ToolContext } from "./ui";
import type { ToolDocument } from "./registry";
import type { ToolRepository } from "./repository";
import type { Handoff } from "./handoff";
import CalculatorTool from "./CalculatorTool";
import EquationTool from "./EquationTool";
import UnitTool from "./UnitTool";
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount(
  children: ReactNode,
  initialData: Record<string, unknown> = {},
  offer: Handoff | null = null
) {
  let doc: ToolDocument = {
    id: "doc",
    owner_id: "owner",
    tool_id: "calculator",
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
    create: async () => doc,
  } as unknown as ToolRepository;
  function Harness() {
    const [state, setState] = useState(doc);
    const [handoff, setHandoff] = useState(offer);
    useEffect(() => {
      renderDoc = setState;
    }, []);
    return (
      <ToolContext.Provider
        value={{
          doc: state,
          repo,
          documents: [],
          handoff,
          clearHandoff: () => setHandoff(null),
        }}
      >
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
const field = (container: Element, label: string) =>
  [...container.querySelectorAll("label")]
    .find((l) => l.querySelector("span")?.textContent === label)!
    .querySelector("input") as HTMLInputElement;
const button = (container: Element, text: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === text
  )!;
const labelled = (container: Element, label: string) =>
  container.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const click = (target: HTMLElement) => act(() => target.click());
const choose = (select: HTMLSelectElement, value: string) =>
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
const press = (target: HTMLElement, key: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
const copied = () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  return writeText;
};

describe("calculator", () => {
  it("inserts the previous answer and multiplies it when it follows a digit", async () => {
    const { element, getDoc } = await mount(<CalculatorTool />, {
      expression: "0.1+0.2",
    });
    const ans = labelled(element, "Insert previous answer") as HTMLButtonElement;
    expect(ans.disabled).toBe(true);
    await click(button(element, "="));
    expect(getDoc().data.ans).toBe("0.3");
    expect(ans.disabled).toBe(false);
    await click(labelled(element, "Clear all"));
    await click(button(element, "2"));
    await click(labelled(element, "×"));
    await click(ans);
    expect(getDoc().data.expression).toBe("2*0.3");
    // 2 × 0.3
    expect(element.querySelector("output")?.textContent).toBe("0.6");
    await click(labelled(element, "Clear all"));
    await click(button(element, "5"));
    await click(ans);
    // "5" then ANS is 5 × 0.3, never the number 50.3.
    expect(getDoc().data.expression).toBe("5(0.3)");
    expect(element.querySelector("output")?.textContent).toBe("1.5");
  });
  it("offers the answer of history saved before answers were stored", async () => {
    const { element, getDoc } = await mount(<CalculatorTool />, {
      history: ["4*5 = 20"],
    });
    await click(labelled(element, "Insert previous answer"));
    expect(getDoc().data.expression).toBe("20");
  });
  it("reads a percentage as a share of the value before it", async () => {
    const { element } = await mount(<CalculatorTool />, {
      expression: "50+10%",
    });
    // 50 + 10 % of 50
    expect(element.querySelector("output")?.textContent).toBe("55");
  });
  it("remembers the scientific keys and labels log as base 10", async () => {
    const { element, getDoc } = await mount(<CalculatorTool />);
    expect(button(element, "abs")).toBeUndefined();
    await click(button(element, "Scientific"));
    expect(getDoc().data.scientific).toBe(true);
    await click(button(element, "log₁₀"));
    await click(button(element, "1"));
    await click(button(element, "0"));
    await click(button(element, "0"));
    await click(button(element, ")"));
    expect(getDoc().data.expression).toBe("log(100)");
    // log₁₀ 100 = 2
    expect(element.querySelector("output")?.textContent).toBe("2");
    await click(labelled(element, "Clear all"));
    await click(button(element, "abs"));
    await click(labelled(element, "−"));
    await click(button(element, "3"));
    await click(button(element, ")"));
    expect(getDoc().data.expression).toBe("abs(-3)");
    expect(element.querySelector("output")?.textContent).toBe("3");
  });
  it("opens with the scientific keys when they were left on", async () => {
    const { element } = await mount(<CalculatorTool />, { scientific: true });
    expect(button(element, "abs")).toBeDefined();
    expect(
      button(element, "Scientific").getAttribute("aria-pressed")
    ).toBe("true");
  });
  it("clears the history at once and puts it back on undo", async () => {
    const writeText = copied();
    const history = ["1+1 = 2", "2*3 = 6"];
    const { element, getDoc } = await mount(<CalculatorTool />, { history });
    await click(
      element.querySelectorAll<HTMLElement>(
        '[aria-label="Copy history entry"]'
      )[1]
    );
    expect(writeText).toHaveBeenCalledWith("2*3 = 6");
    await click(button(element, "Clear history"));
    expect(getDoc().data.history).toEqual([]);
    expect(element.textContent).toContain("History cleared.");
    await click(button(element, "Undo"));
    expect(getDoc().data.history).toEqual(history);
  });
  it("takes a hardware keyboard: typing, Enter for the answer, Escape to clear", async () => {
    const { element, getDoc } = await mount(<CalculatorTool />);
    const expression = labelled(element, "Expression") as HTMLInputElement;
    // inputMode="none" hides the on-screen keyboard only; the field is an
    // ordinary editable text input.
    expect(expression.readOnly).toBe(false);
    expect(expression.getAttribute("inputmode")).toBe("none");
    await input(expression, "2*(3+4)/7");
    // 2 × 7 ÷ 7
    expect(element.querySelector("output")?.textContent).toBe("2");
    await press(expression, "Enter");
    expect(getDoc().data.expression).toBe("2");
    expect(getDoc().data.history).toEqual(["2*(3+4)/7 = 2"]);
    // "=" again on the bare answer adds nothing.
    await press(expression, "Enter");
    expect(getDoc().data.history).toHaveLength(1);
    await press(expression, "Escape");
    expect(getDoc().data.expression).toBe("");
  });
  it("does not ask for a variable", async () => {
    const { element } = await mount(<CalculatorTool />, { expression: "2x" });
    expect(element.querySelector('[role="alert"]')?.textContent).toBe(
      "Incomplete or invalid equation"
    );
  });
  it("continues after an expression kept from last time", async () => {
    const { element, getDoc } = await mount(<CalculatorTool />, {
      expression: "12",
    });
    await click(button(element, "3"));
    expect(getDoc().data.expression).toBe("123");
  });
});

describe("unit converter", () => {
  const toSelect = (element: Element) =>
    [...element.querySelectorAll("select")].at(-1)!;
  it("names the field a conversion is waiting for", async () => {
    const { element } = await mount(<UnitTool />);
    await click(button(element, "Concentration"));
    await choose(toSelect(element), "ng/µL");
    expect(element.querySelector("output")).toBeNull();
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(element.querySelector('[role="status"]')?.textContent).toBe(
      "Enter the molecular weight (g/mol) to convert."
    );
    await choose(toSelect(element), "ppm w/w");
    expect(element.querySelector('[role="status"]')?.textContent).toBe(
      "Enter the molecular weight (g/mol) and the solution density (g/mL) to convert."
    );
    await choose(toSelect(element), "ng/µL");
    await input(field(element, "Molecular weight (g/mol)"), "6000");
    await input(field(element, "Value to convert"), "0.00001");
    // 10 µM of a 6000 g/mol oligo: 10⁻⁵ mol/L × 6000 g/mol = 0.06 g/L = 60 ng/µL.
    expect(element.querySelector("output")?.textContent).toBe("60 ng/µL");
    await input(field(element, "Value to convert"), "");
    expect(element.querySelector('[role="status"]')?.textContent).toBe(
      "Enter a value to convert."
    );
  });
  it("rejects a negative amount but converts a negative temperature", async () => {
    const { element } = await mount(<UnitTool />);
    await input(field(element, "Value to convert"), "-5");
    expect(element.querySelector('[role="alert"]')?.textContent).toBe(
      "Enter non-negative values"
    );
    expect(element.querySelector("output")?.textContent).toBe("—");
    await click(button(element, "Temperature"));
    await input(field(element, "Value to convert"), "-40");
    // −40 °C is −40 °F.
    expect(element.querySelector("output")?.textContent).toBe("-40 °F");
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });
  it("picks RCF as “RCF (× g)” and writes × g after the number", async () => {
    const writeText = copied();
    const { element, getDoc } = await mount(<UnitTool />);
    await click(button(element, "RPM / RCF"));
    expect(
      [...toSelect(element).options].map((option) => option.textContent)
    ).toEqual(["RPM", "RCF (× g)"]);
    expect(element.querySelector('[role="status"]')?.textContent).toBe(
      "Enter the rotor radius (cm) to convert."
    );
    await input(field(element, "Rotor radius (cm)"), "8");
    await input(field(element, "Value to convert"), "13000");
    // 1.118 × 10⁻⁵ × 8 × 13 000² = 15 115.36
    expect(element.querySelector("output")?.textContent).toBe("15,115.36 × g");
    expect(element.querySelector(".tool-unit-result")?.textContent).toContain(
      "13000 RPM = 15,115.36 × g"
    );
    await click(labelled(element, "Copy result"));
    expect(writeText).toHaveBeenCalledWith("15115.36 × g");
    // Changing the unit keeps the typed number.
    await choose(toSelect(element), "RPM");
    expect(getDoc().data).toMatchObject({
      value: "13000",
      from: "RCF",
      to: "RPM",
    });
    expect(element.querySelector(".tool-unit-result")?.textContent).toContain(
      "13000 × g ="
    );
  });
  it("shows the value in the other units of the type", async () => {
    const { element } = await mount(<UnitTool />);
    const rows = () =>
      [...element.querySelectorAll(".tool-unit-x-all dl > div")].map(
        (row) => row.textContent
      );
    // 1 mL → µL is the result itself; the rest are 0.001 L and 10⁶ nL.
    expect(rows()).toEqual(["L0.001", "nL1,000,000"]);
    await click(button(element, "Concentration"));
    // M → mM needs no molecular weight, so mass concentrations are left out.
    expect(rows()).toEqual(["µM1,000,000", "nM1,000,000,000", "pM1,000,000,000,000"]);
    expect(element.querySelector(".tool-unit-x-all")?.textContent).toContain(
      "are left out"
    );
    await click(button(element, "RPM / RCF"));
    expect(element.querySelector(".tool-unit-x-all")).toBeNull();
  });
  it("keeps the last five conversions that stayed on screen and restores one", async () => {
    vi.useFakeTimers();
    const { element, getDoc } = await mount(<UnitTool />);
    const wait = () => act(() => vi.advanceTimersByTime(1600));
    await wait();
    // Opening the tool is not a conversion.
    expect(getDoc().data.recent).toBeUndefined();
    const value = field(element, "Value to convert");
    // Typed in quick succession: one conversion, not three.
    await input(value, "2");
    await input(value, "25");
    await input(value, "250");
    await wait();
    expect(getDoc().data.recent).toEqual([
      { value: "250", from: "mL", to: "µL", category: "volume" },
    ]);
    for (const next of ["1", "2", "3", "4", "5"]) {
      await input(value, next);
      await wait();
    }
    const recent = () =>
      (getDoc().data.recent as { value: string }[]).map((row) => row.value);
    expect(recent()).toEqual(["5", "4", "3", "2", "1"]);
    // A conversion seen again moves to the front instead of repeating.
    await input(value, "3");
    await wait();
    expect(recent()).toEqual(["3", "5", "4", "2", "1"]);
    await click(button(element, "Mass"));
    await wait();
    await click(button(element, "2 mL → µL"));
    expect(getDoc().data).toMatchObject({
      value: "2",
      from: "mL",
      to: "µL",
      category: "volume",
    });
    expect(recent()[0]).toBe("2");
    expect(getDoc().data.recent).toHaveLength(5);
  });
  it("takes a molecular weight sent from another tool and opens the conversion that uses it", async () => {
    const { element, getDoc } = await mount(
      <UnitTool />,
      { value: "2" },
      {
        kind: "molecular-weight",
        value: 58.44,
        unit: "g/mol",
        label: "NaCl",
        source: "molarity",
      }
    );
    expect(element.querySelector(".tool-handoff")?.textContent).toContain(
      "NaCl 58.44 g/mol"
    );
    await click(button(element, "Apply"));
    expect(getDoc().data).toMatchObject({
      value: "2",
      mw: "58.44",
      category: "concentration",
      from: "M",
      to: "mg/mL",
    });
    // 2 mol/L × 58.44 g/mol
    expect(element.querySelector("output")?.textContent).toBe("116.88 mg/mL");
    expect(element.querySelector(".tool-handoff")).toBeNull();
  });
  it("looks a molecular weight up beside its field", async () => {
    vi.mocked(searchChemical).mockResolvedValueOnce({
      id: "glucose",
      name: "D-Glucose",
      casNumber: "50-99-7",
      molecularFormula: "C6H12O6",
      molecularWeight: 180.156,
    });
    const { element, getDoc } = await mount(<UnitTool />);
    expect(element.textContent).not.toContain("Find reagent molecular weight");
    await click(button(element, "Concentration"));
    await choose(toSelect(element), "g/L");
    expect(element.textContent).toContain("Find reagent molecular weight");
    await input(labelled(element, "Search reagent") as HTMLInputElement, "glucose");
    await act(async () => {
      element
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await click(button(element, "Use this molecular weight"));
    expect(getDoc().data.mw).toBe("180.156");
    // 1 mol/L × 180.156 g/mol
    expect(element.querySelector("output")?.textContent).toBe("180.156 g/L");
  });
});

describe("custom equation", () => {
  const group = (element: Element, name: string) =>
    element.querySelector<HTMLElement>(`[role="group"][aria-label="${name}"]`)!;
  it("steps each variable by its own amount", async () => {
    const { element, getDoc } = await mount(<EquationTool />, {
      expression: "rate*t",
      values: { rate: "1", t: "2" },
    });
    const values = () => getDoc().data.values as Record<string, string>;
    // Nothing set: the step is 1.
    await click(labelled(element, "t −"));
    expect(values().t).toBe("1");
    await input(field(group(element, "rate"), "Step for − and +"), "0.1");
    expect(getDoc().data.steps).toEqual({ rate: "0.1" });
    await click(labelled(element, "rate +"));
    await click(labelled(element, "rate +"));
    // 1 + 0.1 + 0.1, without the binary residue of 1.2000000000000002.
    expect(values().rate).toBe("1.2");
    await click(labelled(element, "rate −"));
    expect(values().rate).toBe("1.1");
    // 1.1 × 1
    expect(element.querySelector("output")?.textContent).toBe("1.1");
    await input(field(group(element, "rate"), "Step for − and +"), "0");
    expect((labelled(element, "rate +") as HTMLButtonElement).disabled).toBe(
      true
    );
    expect((labelled(element, "t +") as HTMLButtonElement).disabled).toBe(
      false
    );
  });
  it("shows a description beside the name and drops it with the variable", async () => {
    const { element, getDoc } = await mount(<EquationTool />, {
      expression: "rate*t",
      values: { rate: "1", t: "2" },
    });
    await input(
      field(group(element, "rate"), "Description or unit"),
      "mM/min"
    );
    await input(field(group(element, "t"), "Step for − and +"), "5");
    expect(getDoc().data.labels).toEqual({ rate: "mM/min" });
    expect(field(element, "rate · mM/min").value).toBe("1");
    await input(labelled(element, "Equation") as HTMLInputElement, "t*2");
    expect(getDoc().data.values).toEqual({ t: "2" });
    expect(getDoc().data.labels).toEqual({});
    expect(getDoc().data.steps).toEqual({ t: "5" });
  });
  it("opens a document saved before labels and steps existed", async () => {
    const { element, getDoc } = await mount(<EquationTool />, {
      expression: "a*b+c",
      values: { a: "2", b: "3", c: "1" },
      locked: { a: true, b: false, c: false },
      round: "2",
      angle: "RAD",
      notes: "",
      history: [],
    });
    // 2 × 3 + 1, shown with two decimals as saved.
    expect(element.querySelector("output")?.textContent).toBe("7.00");
    expect(field(element, "a").disabled).toBe(true);
    await click(labelled(element, "b +"));
    expect((getDoc().data.values as Record<string, string>).b).toBe("4");
    // Fields this version does not use are kept as they were.
    expect(getDoc().data.history).toEqual([]);
  });
  it("puts variable keys on the keypad, apart from their neighbours", async () => {
    const { element, getDoc } = await mount(<EquationTool />, {
      expression: "농도",
      values: { 농도: "2" },
    });
    await click(button(element, "Math keypad"));
    expect(
      labelled(element, "Equation").getAttribute("inputmode")
    ).toBe("none");
    const key = () =>
      button(labelled(element, "Insert a variable"), "농도");
    await click(button(element, "*"));
    await click(key());
    expect(getDoc().data.expression).toBe("농도*농도");
    await click(key());
    // A name next to a name multiplies; it does not become "농도농도".
    expect(getDoc().data.expression).toBe("농도*농도 농도");
    // 2 × 2 × 2
    expect(element.querySelector("output")?.textContent).toBe("8");
  });
  it("asks for a variable written in any script and accepts a decimal comma", async () => {
    const { element } = await mount(<EquationTool />, {
      expression: "2농도 + 1",
    });
    expect(element.querySelector('[role="alert"]')?.textContent).toBe(
      "Enter 농도"
    );
    await input(field(element, "농도"), "0,5");
    expect(element.querySelector('[role="alert"]')).toBeNull();
    // 2 × 0.5 + 1
    expect(element.querySelector("output")?.textContent).toBe("2");
    await input(field(element, "농도"), "abc");
    expect(element.querySelector('[role="alert"]')?.textContent).toBe(
      "Invalid number"
    );
  });
  it("keeps a hundredth for % and copies a plain number", async () => {
    const writeText = copied();
    const { element } = await mount(<EquationTool />, {
      expression: "a+10%",
      values: { a: "1234.5" },
    });
    // 1234.5 + 0.1: a saved equation does not turn into "plus ten percent".
    expect(element.querySelector("output")?.textContent).toBe("1,234.6");
    await click(button(element, "Copy result"));
    expect(writeText).toHaveBeenCalledWith("(1234.5)+10% = 1234.6");
  });
});
