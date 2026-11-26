// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolContext } from "./ui";
import type { Handoff } from "./handoff";
import type { ToolDocument } from "./registry";
import type { ToolRepository } from "./repository";
import DilutionTool from "./DilutionTool";
import { exportBlobPartAsFile } from "../../utils/fileExport";
vi.mock("../../utils/fileExport", () => ({
  exportBlobPartAsFile: vi.fn(async () => {}),
}));
const locale = vi.hoisted(() => ({ language: "en" }));
vi.mock("../../services/searchService", () => ({ searchChemical: vi.fn() }));
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
  vi.unstubAllGlobals();
});
async function mount(
  data: Record<string, unknown> = {},
  handoff: Handoff | null = null
) {
  let doc: ToolDocument = {
    id: "doc",
    owner_id: "owner",
    tool_id: "dilution",
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
        <DilutionTool />
      </ToolContext.Provider>
    );
  }
  root = createRoot(element);
  await act(() => root!.render(<Harness />));
  const labelled = (label: string) =>
    [...element.querySelectorAll("label")].find(
      (candidate) => candidate.querySelector("span")?.textContent === label
    );
  return {
    element,
    data: () => doc.data,
    field: (label: string) => labelled(label)?.querySelector("input") ?? null,
    type: (label: string, value: string) =>
      act(() => {
        const control = labelled(label)!.querySelector("input")!;
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )!.set!.call(control, value);
        control.dispatchEvent(new Event("input", { bubbles: true }));
      }),
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
    result: () => element.querySelector("output")?.textContent ?? null,
    alert: () => element.querySelector('[role="alert"]')?.textContent ?? null,
  };
}
const clipboard = () => {
  const writeText = vi.fn(async (text: string) => void text);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  return writeText;
};

describe("dilution screen", () => {
  it("solves for the final concentration or the final volume and names the result", async () => {
    const screen = await mount();
    // Defaults: 100 mM stock, 10 mM target, 10 mL.
    expect(screen.result()).toContain("Stock volume: 1 mL");
    await screen.press("Final concentration");
    expect(screen.field("Target concentration")).toBeNull();
    await screen.type("Stock volume", "2");
    await screen.type("Final volume", "50");
    // 100 mM × 2 mL / 50 mL = 4 mM; 50 − 2 = 48 mL diluent; 25-fold.
    expect(screen.result()).toContain("Final concentration: 4 mM");
    expect(screen.result()).toContain("Diluent: 48 mL");
    expect(screen.result()).toContain("Dilution factor: 25");
    await screen.press("Final volume");
    expect(screen.field("Final volume")).toBeNull();
    await screen.type("Target concentration", "5");
    // 100 mM × 2 mL / 5 mM = 40 mL.
    expect(screen.result()).toContain("Final volume: 40 mL");
    expect(screen.data().solve).toBe("volume");
  });
  it("takes the target as a 1 : N fold, with the stock concentration optional", async () => {
    const screen = await mount();
    await screen.press("Fold (1 : N)");
    expect(screen.field("Target concentration")).toBeNull();
    await screen.type("Dilution fold N (1 : N)", "5");
    await screen.type("Final volume", "200");
    await screen.choose("Final volume unit", "µL");
    // 200 µL / 5 = 40 µL stock + 160 µL diluent; 100 mM / 5 = 20 mM.
    expect(screen.result()).toContain("Stock volume: 40 µL");
    expect(screen.result()).toContain("Diluent: 160 µL");
    expect(screen.result()).toContain("Final concentration: 20 mM");
    await screen.type("Stock concentration (optional)", "");
    expect(screen.alert()).toBeNull();
    expect(screen.result()).toContain("Stock volume: 40 µL");
    expect(screen.result()).not.toContain("Final concentration");
    expect(
      screen.element.querySelector(".tool-dilution-sentence p")?.textContent
    ).toBe("40 µL stock + 160 µL diluent → 200 µL (1 : 5)");
    await screen.type("Dilution fold N (1 : N)", "0.5");
    expect(screen.alert()).toContain("Dilution factor must be at least 1");
    expect(screen.element.textContent).not.toMatch(/[가-힣]/);
  });
  it("dilutes a concentrate given in X", async () => {
    const screen = await mount();
    await screen.type("Stock concentration", "10");
    await screen.choose("Stock unit", "X");
    // The target can only be X as well.
    const targetUnit = [...screen.element.querySelectorAll("label")]
      .find(
        (label) => label.querySelector("span")?.textContent === "Target unit"
      )!
      .querySelector("select")!;
    expect(targetUnit.value).toBe("X");
    expect([...targetUnit.options].map((option) => option.value)).toEqual([
      "X",
    ]);
    // X is stored as a flag; the unit fields keep units that builds from
    // before it can look up.
    expect(screen.data()).toMatchObject({
      strength: true,
      stockUnit: "mM",
      targetUnit: "mM",
    });
    await screen.type("Target concentration", "1");
    await screen.type("Final volume", "500");
    // 10X → 1X in 500 mL: 50 mL concentrate + 450 mL diluent.
    expect(screen.result()).toContain("Stock volume: 50 mL");
    expect(
      screen.element.querySelector(".tool-dilution-sentence p")?.textContent
    ).toBe("50 mL stock + 450 mL diluent → 500 mL (1 X)");
    // Back to a real unit: the target follows it out of X.
    await screen.choose("Stock unit", "mg/mL");
    expect(screen.data()).toMatchObject({
      strength: false,
      stockUnit: "mg/mL",
      targetUnit: "mg/mL",
    });
    expect(targetUnit.value).toBe("mg/mL");
  });
  it("asks for a molecular weight when molar and mass units are mixed", async () => {
    const screen = await mount();
    expect(screen.field("Molecular weight (g/mol)")).toBeNull();
    await screen.choose("Target unit", "mg/mL");
    expect(screen.alert()).toBeNull();
    expect(screen.result()).toBeNull();
    expect(screen.element.querySelector('[role="status"]')?.textContent).toBe(
      "Enter the molecular weight to calculate."
    );
    await screen.type("Molecular weight (g/mol)", "500");
    // 100 mM × 500 g/mol = 50 mg/mL; 10 mg/mL in 10 mL takes 10 × 10 / 50 = 2 mL.
    expect(screen.result()).toContain("Stock volume: 2 mL");
    // The reverse: a mass-per-volume stock and a molar target.
    await screen.choose("Stock unit", "mg/mL");
    await screen.choose("Target unit", "mM");
    // 100 mg/mL ÷ 500 g/mol = 200 mM; 10 mM in 10 mL takes 10 × 10 / 200 = 0.5 mL.
    expect(screen.result()).toContain("Stock volume: 0.5 mL");
  });
  it("keeps the typed number when a unit changes and lets the result follow", async () => {
    const screen = await mount();
    await screen.choose("Target unit", "µM");
    expect(screen.field("Target concentration")?.value).toBe("10");
    expect(screen.data().target ?? "10").toBe("10");
    // 10 µM from 100 mM in 10 mL: 0.01 × 10 / 100 = 0.001 mL = 1 µL.
    expect(screen.result()).toContain("Stock volume: 0.001 mL");
    await screen.choose("Result unit", "µL");
    expect(screen.result()).toContain("Stock volume: 1 µL");
    await screen.choose("Final volume unit", "L");
    expect(screen.field("Final volume")?.value).toBe("10");
    // 10 L now: 1 mL of stock, still shown in the unit chosen for it.
    expect(screen.result()).toContain("Stock volume: 1,000 µL");
  });
  it("keeps a typed stock volume in its unit when the final volume's unit changes", async () => {
    const screen = await mount();
    await screen.press("Final concentration");
    await screen.choose("Final volume unit", "L");
    expect(screen.field("Stock volume")?.value).toBe("1");
    expect(screen.data().stockVolumeUnit).toBe("mL");
    // 100 mM × 1 mL / 10 L = 0.01 mM.
    expect(screen.result()).toContain("Final concentration: 0.01 mM");
  });
  it("copies the instruction with plain numbers", async () => {
    const writeText = clipboard();
    const screen = await mount();
    await screen.type("Final volume", "10000");
    expect(screen.result()).toContain("Stock volume: 1,000 mL");
    await act(() =>
      screen.element
        .querySelector<HTMLButtonElement>('[aria-label="Copy instruction"]')!
        .click()
    );
    expect(writeText).toHaveBeenCalledWith(
      "1000 mL stock + 9000 mL diluent → 10000 mL (10 mM)"
    );
  });
  it("writes the Korean instruction and warning", async () => {
    locale.language = "ko";
    const screen = await mount();
    expect(
      screen.element.querySelector(".tool-dilution-sentence p")?.textContent
    ).toBe("원액 1 mL + 희석액 9 mL → 10 mL (10 mM)");
    // 100 mM → 10 mM in 0.002 mL: 0.2 µL of stock, a 10-fold dilution into
    // 2 µL, which only a larger volume (0.5 µL × 10 = 5 µL) can fix.
    await screen.type("최종 부피", "0.002");
    expect(
      screen.element.querySelector(".tool-dilution-warning")?.textContent
    ).toBe(
      "취할 원액이 0.2 µL로 0.5 µL보다 적어 정확히 분주하기 어렵습니다. 최종 부피를 5 µL 이상으로 늘리면 원액을 0.5 µL 이상 취할 수 있습니다."
    );
    // 10 mM → 1 µM in 1 mL: the same case as the English test below.
    await screen.type("원액 농도", "10");
    await screen.choose("목표 단위", "µM");
    await screen.type("목표 농도", "1");
    await screen.type("최종 부피", "1");
    expect(
      screen.element.querySelector(".tool-dilution-warning")?.textContent
    ).toBe(
      "취할 원액이 0.1 µL로 0.5 µL보다 적어 정확히 분주하기 어렵습니다. 먼저 원액 2 µL에 희석액 198 µL를 넣어 100배 중간 희석액(100 µM)을 만들고, 그 10 µL에 희석액 990 µL를 더하세요."
    );
  });
  it("warns below 0.5 µL and suggests an intermediate dilution with numbers", async () => {
    const screen = await mount();
    expect(screen.element.querySelector(".tool-dilution-warning")).toBeNull();
    // 10 mM → 1 µM in 1 mL is 10 000-fold: 0.1 µL of stock.
    await screen.type("Stock concentration", "10");
    await screen.choose("Target unit", "µM");
    await screen.type("Target concentration", "1");
    await screen.type("Final volume", "1");
    const warning = screen.element.querySelector(
      ".tool-dilution-warning"
    )?.textContent;
    expect(warning).toContain("0.1 µL, below 0.5 µL");
    // 100-fold intermediate (100 µM): 10 µL of it carries what 0.1 µL of
    // stock would, and 1000 − 10 = 990 µL diluent completes the volume.
    expect(warning).toContain("100-fold intermediate dilution (100 µM)");
    expect(warning).toContain("2 µL stock + 198 µL diluent");
    expect(warning).toContain("add 10 µL of it to 990 µL diluent");
    // 10-fold into 2 µL cannot be rescued by an intermediate.
    await screen.type("Target concentration", "1000");
    await screen.type("Final volume", "0.002");
    expect(
      screen.element.querySelector(".tool-dilution-warning")?.textContent
    ).toContain("Increase the final volume to at least 5 µL");
    expect(screen.element.textContent).not.toMatch(/[가-힣]/);
  });
  it("builds the serial dilution table with totals, CSV rows and a tab-separated copy", async () => {
    const writeText = clipboard();
    const screen = await mount();
    // The serial dilution table, as opposed to a chart's "view as table".
    const serialTable = () =>
      [...screen.element.querySelectorAll("table")].find(
        (table) => !table.closest(".tool-chart")
      ) ?? null;
    expect(serialTable()).toBeNull();
    await screen.type("Serial steps", "4");
    const cells = () =>
      [...(serialTable()?.querySelectorAll("tbody tr") ?? [])].map((row) =>
        [...row.querySelectorAll("td")].map((cell) => cell.textContent)
      );
    // 1 mL stock + 9 mL, then 5 mL carried into 5 mL three times. Tubes
    // 1–3 keep 5 mL, the last keeps 10 mL.
    expect(cells()).toEqual([
      ["1", "10", "1", "9", "5"],
      ["2", "5", "5", "5", "5"],
      ["3", "2.5", "5", "5", "5"],
      ["4", "1.25", "5", "5", "10"],
    ]);
    expect(
      screen.element.querySelector(".tool-dilution-totals")?.textContent
    ).toBe("Total diluent: 24 mL · Stock for step 1: 1 mL");
    expect(serialTable()?.parentElement?.className).toBe("tool-table-wrap");
    // The same series as a row of tubes: the stock, then one per step.
    expect(
      [...screen.element.querySelectorAll(".tool-chart-chain > li")].map(
        (item) => item.getAttribute("aria-label")
      )
    ).toEqual([
      null,
      "Step 1: carry 1 mL from the stock, add 9 mL of diluent, giving 10 mM",
      "Step 2: carry 5 mL from step 1, add 5 mL of diluent, giving 5 mM",
      "Step 3: carry 5 mL from step 2, add 5 mL of diluent, giving 2.5 mM",
      "Step 4: carry 5 mL from step 3, add 5 mL of diluent, giving 1.25 mM",
    ]);
    await screen.press("Copy table");
    expect(writeText).toHaveBeenCalledWith(
      [
        "#\tmM\tTransfer (mL)\tDiluent (mL)\tLeft in tube (mL)",
        "1\t10\t1\t9\t5",
        "2\t5\t5\t5\t5",
        "3\t2.5\t5\t5\t5",
        "4\t1.25\t5\t5\t10",
        "Total diluent (mL)\t24",
        "Stock for step 1 (mL)\t1",
      ].join("\n")
    );
    await screen.press("CSV");
    expect(exportBlobPartAsFile).toHaveBeenCalledWith(
      "\uFEFF" +
        [
          '"#","mM","Transfer (mL)","Diluent (mL)","Left in tube (mL)"',
          '"1","10","1","9","5"',
          '"2","5","5","5","5"',
          '"3","2.5","5","5","5"',
          '"4","1.25","5","5","10"',
          '"Total diluent (mL)","24"',
          '"Stock for step 1 (mL)","1"',
        ].join("\r\n"),
      {
        // Named after the tool, the saved work and the minute it was made.
        fileName: expect.stringMatching(
          /^buril-dilution-Test-\d{8}-\d{4}\.csv$/
        ),
        mimeType: "text/csv",
      }
    );
    // A wrong step count is reported without taking the result away.
    await screen.type("Serial steps", "2.5");
    expect(screen.alert()).toContain("Steps: 1–100");
    expect(serialTable()).toBeNull();
    expect(screen.result()).toContain("Stock volume: 1 mL");
    // An empty per-step fold is asked for, not reported.
    await screen.type("Serial steps", "3");
    await screen.type("Dilution per step", "");
    expect(screen.alert()).toBeNull();
    expect(screen.element.textContent).toContain("Enter the dilution per step");
    await screen.type("Dilution per step", "2");
    // Every label, the table and its totals are English on the English screen.
    expect(screen.element.textContent).not.toMatch(/[가-힣]/);
  });
  it("opens work saved before the new fields with the result it always gave", async () => {
    const screen = await mount({
      stock: "2",
      target: "50",
      volume: "25",
      stockUnit: "M",
      targetUnit: "mM",
      volumeUnit: "mL",
      steps: "1",
      factor: "2",
    });
    // 50 mM from 2 M in 25 mL: 0.05 × 25 / 2 = 0.625 mL, shown in mL.
    expect(screen.result()).toContain("Stock volume: 0.625 mL");
    expect(screen.result()).toContain("Diluent: 24.375 mL");
    expect(screen.result()).toContain("Dilution factor: 40");
  });
  it("takes a concentration sent by another tool as the stock", async () => {
    const screen = await mount(
      {},
      {
        kind: "concentration",
        value: 50,
        unit: "ng/µL",
        label: "Plasmid",
        source: "calibration-curve",
      }
    );
    expect(
      screen.element.querySelector(".tool-handoff")?.textContent
    ).toContain("Plasmid");
    await screen.press("Apply");
    expect(screen.element.querySelector(".tool-handoff")).toBeNull();
    // ng/µL is µg/mL; the target unit follows the stock into mass per volume.
    expect(screen.data()).toMatchObject({
      stock: "50",
      stockUnit: "µg/mL",
      targetUnit: "µg/mL",
    });
    // 10 µg/mL from 50 µg/mL in 10 mL: 2 mL.
    expect(screen.result()).toContain("Stock volume: 2 mL");
  });
  it("applies only the number when the received unit is not one it knows", async () => {
    const screen = await mount(
      {},
      {
        kind: "concentration",
        value: 250,
        unit: "U/mL",
        label: "Enzyme",
        source: "calibration-curve",
      }
    );
    await screen.press("Apply");
    expect(screen.data()).toMatchObject({ stock: "250" });
    expect(screen.data().stockUnit ?? "mM").toBe("mM");
    expect(screen.element.textContent).toContain("The received unit (U/mL)");
  });
  it("takes a molecular weight sent by another tool", async () => {
    const screen = await mount(
      {},
      {
        kind: "molecular-weight",
        value: 58.44,
        unit: "g/mol",
        label: "NaCl",
        source: "periodic-table",
      }
    );
    await screen.press("Apply");
    expect(screen.data().mw).toBe("58.44");
    expect(screen.field("Molecular weight (g/mol)")?.value).toBe("58.44");
  });
});
