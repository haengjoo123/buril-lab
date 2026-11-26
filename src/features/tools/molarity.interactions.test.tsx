// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolContext } from "./ui";
import type { Handoff } from "./handoff";
import type { ToolDocument, ToolId } from "./registry";
import type { ToolRepository } from "./repository";
import MolarityTool from "./MolarityTool";
const locale = vi.hoisted(() => ({ language: "en" }));
vi.mock("../../services/searchService", () => ({ searchChemical: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: locale, t: (s: string) => s }),
}));
vi.mock("../../locales/i18n", () => ({
  default: locale,
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
  locale.language = "en";
  vi.unstubAllGlobals();
});
async function mount({
  data = {},
  handoff = null,
  sendTo,
  preferences,
}: {
  data?: Record<string, unknown>;
  handoff?: Handoff | null;
  sendTo?: (tool: ToolId, handoff: Handoff) => void;
  /** The account's hidden preferences document, when it exists. */
  preferences?: Record<string, unknown>;
} = {}) {
  const base: ToolDocument = {
    id: "doc",
    owner_id: "owner",
    tool_id: "molarity",
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
  const items = [
    { doc: base },
    ...(preferences
      ? [
          {
            doc: {
              ...base,
              id: "preferences",
              tool_id: "notes" as const,
              data: { _preferences: true, ...preferences },
            },
          },
        ]
      : []),
  ];
  const repo = {
    owner: "owner",
    items,
    update: async (id: string, patch: Partial<ToolDocument>) => {
      const row = items.find((item) => item.doc.id === id)!;
      row.doc = { ...row.doc, ...patch };
      renderDoc(items[0].doc);
    },
  } as unknown as ToolRepository;
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
          repo,
          documents: [],
          handoff: offer,
          clearHandoff: () => setOffer(null),
          sendTo,
        }}
      >
        <MolarityTool />
      </ToolContext.Provider>
    );
  }
  root = createRoot(element);
  await act(() => root!.render(<Harness />));
  const field = (label: string) =>
    [...element.querySelectorAll("label")].find(
      (candidate) => candidate.querySelector("span")?.textContent === label
    )?.control as HTMLInputElement | undefined;
  return {
    element,
    data: () => items[0].doc.data,
    preferences: () => items[1]?.doc.data,
    field,
    type: (label: string, value: string) =>
      act(() => {
        const control = field(label)!;
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )!.set!.call(control, value);
        control.dispatchEvent(new Event("input", { bubbles: true }));
      }),
    choose: (label: string, value: string) =>
      act(() => {
        const control = element.querySelector<HTMLSelectElement>(
          `select[aria-label="${label}"]`
        )!;
        control.value = value;
        control.dispatchEvent(new Event("change", { bubbles: true }));
      }),
    press: (text: string) =>
      act(() =>
        [...element.querySelectorAll("button")]
          .find((candidate) => candidate.textContent === text)!
          .click()
      ),
    has: (text: string) =>
      [...element.querySelectorAll("button")].some(
        (candidate) => candidate.textContent === text
      ),
    result: () => element.querySelector("output")?.textContent ?? null,
    alert: () => element.querySelector('[role="alert"]')?.textContent ?? null,
    sentence: () =>
      element.querySelector(".tool-molarity-sentence p")?.textContent ?? null,
  };
}
// 100 mM NaCl in 10 mL, solving for the mass in mg:
// 0.1 mol/L × 58.44 g/mol × 0.01 L = 0.05844 g = 58.44 mg.
const saline = {
  solve: "mass",
  concentration: "100",
  concentrationUnit: "mM",
  volume: "10",
  volumeUnit: "mL",
  massUnit: "mg",
  mw: "58.44",
  reagent: { name: "NaCl", molecularWeight: 58.44 },
};

describe("molarity screen", () => {
  it("corrects the mass to weigh for purity and asks for an empty purity", async () => {
    const screen = await mount({ data: saline });
    expect(screen.field("Purity")?.value).toBe("100");
    expect(screen.result()).toBe("58.44");
    await screen.type("Purity", "98");
    // 58.44 mg / 0.98 = 59.6326530… mg to weigh; 58.44 mg of it is solute.
    expect(screen.result()).toBe("59.63265");
    expect(screen.element.textContent).toContain(
      "Corrected for 98% purity · pure solute 58.44 mg"
    );
    expect(screen.element.textContent).toContain("m = C × MW × V / purity");
    await screen.type("Purity", "");
    expect(screen.result()).toBe("—");
    expect(screen.alert()).toBeNull();
    expect(screen.element.querySelector('[role="status"]')?.textContent).toBe(
      "Enter the purity to calculate instantly."
    );
    await screen.type("Purity", "120");
    expect(screen.alert()).toContain("Purity must be between 0 and 100");
    await screen.type("Purity", "98");
    // Sentence, purity note and formula are English on the English screen.
    expect(screen.sentence()).toBe(
      "Weigh 59.63265 mg of NaCl (98% purity) and dissolve to a final volume of 10 mL (100 mM)."
    );
    expect(screen.element.textContent).not.toMatch(/[가-힣]/);
  });
  it("uses purity when the mass is what was weighed", async () => {
    const screen = await mount({
      data: {
        solve: "concentration",
        mass: "1",
        massUnit: "g",
        mw: "40",
        volume: "500",
        volumeUnit: "mL",
        concentrationUnit: "mM",
        purity: "80",
      },
    });
    // 0.8 g of solute / 40 g/mol / 0.5 L = 0.04 M = 40 mM.
    expect(screen.result()).toBe("40");
    // Purity belongs to a weighed mass; the other bases do not ask for it.
    await screen.press("From moles");
    expect(screen.field("Purity")).toBeUndefined();
  });
  it("takes the molecular weight in kDa and keeps the number when the unit changes", async () => {
    const screen = await mount({
      data: {
        mass: "1",
        massUnit: "mg",
        mw: "66.5",
        volume: "1",
        volumeUnit: "mL",
        concentrationUnit: "µM",
      },
    });
    // 66.5 g/mol: 0.001 g / 66.5 g/mol / 0.001 L = 15 037.59… µM.
    expect(screen.result()).toBe("15,037.59");
    await screen.choose("Molecular weight unit", "kDa");
    expect(screen.field("Molecular weight")?.value).toBe("66.5");
    // 66.5 kDa is a thousand times heavier: 15.03759… µM.
    expect(screen.result()).toBe("15.03759");
    // The stored weight stays in g/mol for builds that do not know kDa.
    expect(screen.data()).toMatchObject({ mw: "66500", mwUnit: "kDa" });
    await screen.type("Molecular weight", "150");
    expect(screen.data()).toMatchObject({ mw: "150000", mwTyped: "150" });
    await screen.type("Molecular weight", "66.5");
    await screen.press("Molecular weight");
    await screen.type("Molarity", "15.037593985");
    // Solved back, in the unit chosen for the result.
    expect(screen.result()).toBe("66.5");
    await screen.choose("Result unit", "g/mol");
    expect(screen.result()).toBe("66,500");
  });
  it("writes the preparation as a sentence and copies it with plain numbers", async () => {
    const writeText = vi.fn(async (text: string) => void text);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const screen = await mount({ data: saline });
    expect(screen.sentence()).toBe(
      "Weigh 58.44 mg of NaCl and dissolve to a final volume of 10 mL (100 mM)."
    );
    // 5 M in 2000 mL: 5 × 58.44 × 2 = 584.4 g = 584 400 mg.
    await screen.type("Molarity", "5");
    await screen.choose("Molarity unit", "M");
    await screen.type("Final volume", "2000");
    expect(screen.result()).toBe("584,400");
    await act(() =>
      screen.element
        .querySelector<HTMLButtonElement>('[aria-label="Copy instruction"]')!
        .click()
    );
    expect(writeText).toHaveBeenLastCalledWith(
      "Weigh 584400 mg of NaCl and dissolve to a final volume of 2000 mL (5 M)."
    );
    await act(() =>
      screen.element
        .querySelector<HTMLButtonElement>('[aria-label="Copy result"]')!
        .click()
    );
    expect(writeText).toHaveBeenLastCalledWith("584400 mg");
    await screen.type("Purity", "99");
    expect(screen.sentence()).toContain("of NaCl (99% purity) and dissolve");
    // Mass per volume has no preparation to describe.
    await screen.press("From concentration");
    expect(screen.sentence()).toBeNull();
  });
  it("writes the Korean sentence with the reagent name first", async () => {
    locale.language = "ko";
    const screen = await mount({ data: saline });
    expect(screen.sentence()).toBe(
      "NaCl 58.44 mg을 달아 최종 부피 10 mL가 되도록 녹입니다. (100 mM)"
    );
  });
  it("sends the solution's concentration to the dilution tool", async () => {
    const sendTo = vi.fn();
    const screen = await mount({ data: saline, sendTo });
    await screen.press("Dilute this solution");
    expect(sendTo).toHaveBeenCalledWith("dilution", {
      kind: "concentration",
      value: 100,
      unit: "mM",
      label: "NaCl",
      source: "molarity",
    });
    // The calculated concentration is sent when that is the result.
    await screen.press("Molarity");
    await screen.type("Mass", "58.44");
    await screen.press("Dilute this solution");
    expect(sendTo).toHaveBeenLastCalledWith(
      "dilution",
      expect.objectContaining({ value: 100, unit: "mM" })
    );
  });
  it("offers no dilution outside the tools shell", async () => {
    const screen = await mount({ data: saline });
    expect(screen.has("Dilute this solution")).toBe(false);
  });
  it("takes a molecular weight sent by another tool and shows where it came from", async () => {
    const screen = await mount({
      data: { basis: "amount" },
      handoff: {
        kind: "molecular-weight",
        value: 18.015,
        unit: "g/mol",
        label: "Water",
        source: "periodic-table",
      },
    });
    await screen.press("Apply");
    expect(screen.data()).toMatchObject({
      basis: "mass",
      mw: "18.015",
      mwUnit: "g/mol",
      reagent: { name: "Water", molecularWeight: 18.015 },
    });
    expect(screen.field("Molecular weight")?.value).toBe("18.015");
    expect(
      screen.element.querySelector(".tool-molarity-selected strong")
        ?.textContent
    ).toBe("Water");
    expect(screen.element.querySelector(".tool-handoff")).toBeNull();
  });
  it("reuses a reagent from the account's recent list and leaves old document fields alone", async () => {
    const water = {
      name: "Water",
      casNumber: "7732-18-5",
      molecularFormula: "H2O",
      molecularWeight: 18.015,
    };
    const screen = await mount({
      // What a document saved by the previous version carries.
      data: { query: "wat", recentReagents: [water], mw: "58.44" },
      preferences: { reagents: [water], favorites: ["molarity"] },
    });
    await act(() =>
      screen.element
        .querySelector<HTMLButtonElement>(".tool-molarity-recents button")!
        .click()
    );
    expect(screen.data()).toMatchObject({
      mw: "18.015",
      reagent: { name: "Water" },
      query: "wat",
      recentReagents: [water],
    });
    expect(screen.preferences()).toMatchObject({
      reagents: [water],
      favorites: ["molarity"],
    });
  });
});
