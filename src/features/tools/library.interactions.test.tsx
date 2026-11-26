// @vitest-environment jsdom
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolContext } from "./ui";
import type { Handoff } from "./handoff";
import type { ToolDocument, ToolId } from "./registry";
import type { ToolRepository } from "./repository";
import AminoTool from "./AminoTool";
import CodonTool from "./CodonTool";
import PeriodicTool from "./PeriodicTool";
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
  vi.unstubAllGlobals();
});

/** Where the router is, and a way to go back, for the tests to read. */
const address = { path: "", back: () => {} };
function Probe() {
  const location = useLocation(),
    navigate = useNavigate();
  useEffect(() => {
    address.path = location.pathname + location.search;
    address.back = () => navigate(-1);
  });
  return null;
}
async function mount(
  children: ReactNode,
  {
    at,
    sendTo,
  }: { at?: string; sendTo?: (tool: ToolId, handoff: Handoff) => void } = {}
) {
  const doc: ToolDocument = {
    id: "reference",
    owner_id: "owner",
    tool_id: "periodic-table",
    title: "Test",
    data: {},
    schema_version: 1,
    engine_version: "1",
    revision: 0,
    updated_at: "",
  };
  const repo = { owner: "owner", items: [] } as unknown as ToolRepository;
  const element = document.createElement("div");
  document.body.appendChild(element);
  root = createRoot(element);
  const screen = (
    <ToolContext.Provider value={{ doc, repo, documents: [], sendTo }}>
      {children}
    </ToolContext.Provider>
  );
  await act(() =>
    root!.render(
      at ? (
        <MemoryRouter initialEntries={[at]}>
          <Probe />
          {screen}
        </MemoryRouter>
      ) : (
        screen
      )
    )
  );
  const all = <T extends Element>(selector: string) => [
    ...element.querySelectorAll<T>(selector),
  ];
  const control = (label: string) =>
    all<HTMLLabelElement>("label").find(
      (candidate) => candidate.querySelector("span")?.textContent === label
    )?.control as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  return {
    element,
    all,
    control,
    text: () => element.textContent ?? "",
    type: (label: string, value: string) =>
      act(() => {
        const field = control(label);
        Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(field),
          "value"
        )!.set!.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }),
    choose: (label: string, value: string) =>
      act(() => {
        const field = control(label) as HTMLSelectElement;
        field.value = value;
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }),
    /** Clicks the button or link with this text or accessible name. */
    press: (name: string) =>
      act(() => {
        const target = all<HTMLElement>("button, a, [role=button]").find(
          (candidate) =>
            candidate.textContent === name ||
            candidate.getAttribute("aria-label") === name
        );
        if (!target) throw Error(`No control named "${name}"`);
        target.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
        );
      }),
    key: (key: string, target: Element = document.activeElement!) =>
      act(() => {
        target.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
        );
      }),
  };
}
const tools = (
  <Routes>
    <Route path="/app/tools/amino-acids" element={<AminoTool />} />
    <Route path="/app/tools/codons" element={<CodonTool />} />
  </Routes>
);

describe("amino acid reference", () => {
  it("shows an amino acid's properties, sources and codons", async () => {
    const screen = await mount(<AminoTool />);
    await screen.press("LysineLys · KC6H14N2O2146.19 g/mol");
    const row = (label: string) =>
      screen
        .all("dl.tool-property-list > div")
        .find((item) => item.querySelector("dt")?.textContent === label)
        ?.querySelector("dd")?.textContent;
    expect(row("Residue mass (average, −H₂O)")).toBe("128.1741 g/mol");
    expect(row("pKa (α-COOH)")).toBe("2.18");
    expect(row("pKa (α-NH₃⁺)")).toBe("8.95");
    expect(row("pKa (side chain)")).toBe("10.53");
    expect(row("Isoelectric point (pI)")).toBe("9.74");
    expect(row("Hydropathy index (Kyte–Doolittle)")).toBe("-3.9");
    expect(
      screen.all(".tool-lib-x-codons code").map((code) => code.textContent)
    ).toEqual(["AAA", "AAG"]);
    // Each added value names where it was read.
    const sources = screen
      .all<HTMLAnchorElement>(".tool-lib-x-sources a")
      .map((link) => link.href);
    expect(sources).toEqual(
      expect.arrayContaining([
        "https://openstax.org/books/organic-chemistry/pages/26-1-structures-of-amino-acids",
        "https://web.expasy.org/findmod/findmod_masses.html",
        "https://web.expasy.org/protscale/pscale/Hphob.Doolittle.html",
      ])
    );
    // An amino acid without an ionizable side chain says so instead of a value.
    await screen.press("Back to list");
    await screen.press("GlycineGly · GC2H5NO275.07 g/mol");
    expect(row("pKa (side chain)")).toBe("No ionizable side chain");
  });
  it("marks the chosen amino acid among the 20 in words, not only by colour", async () => {
    const screen = await mount(<AminoTool />);
    await screen.press("LysineLys · KC6H14N2O2146.19 g/mol");
    const bars = () => screen.all(".tool-chart-bar-track");
    expect(bars()).toHaveLength(20);
    const chosen = bars().filter((bar) => !bar.hasAttribute("data-muted"));
    expect(chosen.map((bar) => bar.getAttribute("aria-label"))).toEqual([
      "Lysine (K) · selected 128.1741",
    ]);
    // Largest first: tryptophan leads the residue masses, glycine ends them.
    expect(bars()[0].getAttribute("aria-label")).toBe("Tryptophan (W) 186.2132");
    expect(bars()[19].getAttribute("aria-label")).toBe("Glycine (G) 57.0519");
    // The hydropathy index runs both ways from zero.
    await screen.choose("Property to compare", "hydropathy");
    expect(bars()[0].getAttribute("aria-label")).toBe("Isoleucine (I) 4.5");
    expect(bars()[19].getAttribute("aria-label")).toBe("Arginine (R) -4.5");
    expect(
      bars().filter((bar) => bar.hasAttribute("data-negative"))
    ).toHaveLength(13);
    await screen.choose("Sort", "name");
    expect(bars()[0].getAttribute("aria-label")).toBe("Alanine (A) 1.8");
    // The same values as a table.
    expect(screen.all(".tool-chart-table tbody tr")).toHaveLength(20);
  });
  it("compares only the amino acids the list is filtered to", async () => {
    const screen = await mount(<AminoTool />);
    await screen.choose("Side-chain class", "basic");
    await screen.press("Compare properties");
    await screen.choose("Property to compare", "pI");
    expect(
      screen
        .all(".tool-chart-bar-track")
        .map((bar) => bar.getAttribute("aria-label"))
    ).toEqual(["Arginine (R) 10.76", "Lysine (K) 9.74", "Histidine (H) 7.59"]);
  });
  it("opens on the amino acid named in the address and links to its codons", async () => {
    const screen = await mount(tools, { at: "/app/tools/amino-acids?aa=K" });
    expect(screen.element.querySelector("h2")?.textContent).toBe(
      "Lysine Lys · K"
    );
    const link = screen
      .all<HTMLAnchorElement>("a")
      .find((item) => item.textContent === "Open in the codon tool")!;
    expect(link.getAttribute("href")).toBe("/app/tools/codons?q=Lys");
    await screen.press("Open in the codon tool");
    expect(address.path).toBe("/app/tools/codons?q=Lys");
    expect(
      (screen.control("Search codon or amino acid") as HTMLInputElement).value
    ).toBe("Lys");
    expect(
      screen.all(".tool-codon-entry strong").map((item) => item.textContent)
    ).toEqual(["AAA", "AAG"]);
    // Back returns to the amino acid, not to the list.
    await act(() => address.back());
    expect(address.path).toBe("/app/tools/amino-acids?aa=K");
    expect(screen.element.querySelector("h2")?.textContent).toBe(
      "Lysine Lys · K"
    );
  });
  it("keeps the open amino acid in the address without adding history", async () => {
    const screen = await mount(tools, { at: "/app/tools/amino-acids" });
    await screen.press("LysineLys · KC6H14N2O2146.19 g/mol");
    expect(address.path).toBe("/app/tools/amino-acids?aa=K");
    await screen.press("Back to list");
    expect(address.path).toBe("/app/tools/amino-acids");
    expect(screen.all(".tool-amino-card")).toHaveLength(20);
  });
});

describe("codon reference", () => {
  it("lists exact matches before partial ones", async () => {
    const screen = await mount(<CodonTool />);
    await screen.type("Search codon or amino acid", "leu");
    const groups = screen
      .all(".tool-codon-results h3")
      .map((heading) => heading.textContent);
    expect(groups).toEqual(["Exact match · 6", "Partial match · 3"]);
    const grids = screen.all(".tool-codon-match-grid");
    expect(grids[0].textContent).toContain("Leucine");
    expect(grids[0].textContent).not.toContain("Isoleucine");
    expect(grids[1].textContent).toContain("Isoleucine");
    // A codon typed in DNA letters is the same codon.
    await screen.type("Search codon or amino acid", "ATG");
    expect(screen.all(".tool-codon-entry")).toHaveLength(1);
    expect(screen.text()).toContain("1 codon");
  });
  it("translates a pasted sequence in three frames and copies a frame", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const screen = await mount(<CodonTool />);
    await screen.press("Translate");
    await screen.type(
      "DNA or RNA sequence (5′→3′)",
      "ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG"
    );
    const outputs = () =>
      screen.all(".tool-lib-x-frame > output").map((item) => item.textContent);
    expect(outputs()).toEqual([
      "MAIVMGR*KGAR*",
      "WPL*WAAERVPD",
      "GHCNGPLKGCPI",
      "CTATCGGGCACCCTTTCAGCGGCCCATTACAATGGCCAT",
    ]);
    expect(screen.text()).toContain("DNA · 39 nt");
    expect(screen.text()).toContain("12 codons · 2 bases left over");
    await screen.press("Copy frame +1 translation");
    expect(writeText).toHaveBeenCalledWith("MAIVMGR*KGAR*");
    await screen.press("Copy reverse complement");
    expect(writeText).toHaveBeenLastCalledWith(
      "CTATCGGGCACCCTTTCAGCGGCCCATTACAATGGCCAT"
    );
    // The other strand's frames are one press away.
    await screen.press(
      "Also translate the reverse-complement frames (−1, −2, −3)"
    );
    expect(outputs()).toHaveLength(7);
    expect(outputs()[4]).toBe("LSGTLSAAHYNGH");
  });
  it("moves around the wheel with the arrow keys and selects with Enter", async () => {
    const screen = await mount(<CodonTool />);
    await screen.press("Codon wheel");
    const sectors = screen.all<SVGGElement>(".tool-codon-wheel [role=button]");
    expect(sectors).toHaveLength(84);
    // One sector is in the tab order.
    expect(sectors.filter((sector) => sector.tabIndex === 0)).toHaveLength(1);
    const focused = () => document.activeElement?.getAttribute("aria-label");
    await act(() => sectors[0].focus());
    expect(focused()).toBe("Codons starting with U");
    await screen.key("ArrowRight");
    expect(focused()).toBe("Codons starting with C");
    await screen.key("ArrowDown");
    expect(focused()).toBe("Codons starting with CU");
    await screen.key("ArrowDown");
    expect(focused()).toBe("CUU Leucine (Leu)");
    await screen.key("ArrowLeft");
    expect(focused()).toBe("UGG Tryptophan (Trp)");
    await screen.key("ArrowUp");
    expect(focused()).toBe("Codons starting with UG");
    // The focus ring is drawn for the sector the keyboard is on.
    expect(screen.all(".tool-lib-x-wheel-focus")).toHaveLength(1);
    await screen.key("Enter");
    expect(
      (screen.control("Search codon or amino acid") as HTMLInputElement).value
    ).toBe("UGN");
    expect(
      screen.all(".tool-codon-entry strong").map((item) => item.textContent)
    ).toEqual(["UGU", "UGC", "UGA", "UGG"]);
    expect(
      document.activeElement?.getAttribute("aria-pressed")
    ).toBe("true");
    // The outer ring names start and stop codons.
    expect(
      screen
        .all(".tool-codon-wheel [role=button]")
        .map((sector) => sector.getAttribute("aria-label"))
    ).toEqual(
      expect.arrayContaining([
        "AUG Methionine (Met), start codon",
        "UAA stop codon",
      ])
    );
  });
  it("opens the amino acid of a search and returns to the same results", async () => {
    const screen = await mount(tools, { at: "/app/tools/codons" });
    await screen.type("Search codon or amino acid", "AUG");
    await screen.press("Methionine (Met) amino acid details");
    expect(address.path).toBe("/app/tools/amino-acids?aa=M");
    expect(screen.element.querySelector("h2")?.textContent).toBe(
      "Methionine Met · M"
    );
    await act(() => address.back());
    expect(address.path).toBe("/app/tools/codons?q=AUG");
    expect(
      (screen.control("Search codon or amino acid") as HTMLInputElement).value
    ).toBe("AUG");
  });
});

describe("periodic table", () => {
  const cell = (
    screen: Awaited<ReturnType<typeof mount>>,
    z: number
  ) => screen.element.querySelector<HTMLElement>(`[data-z="${z}"]`)!;
  it("weighs a formula and sends the weight to the molarity tool", async () => {
    const sendTo = vi.fn();
    const screen = await mount(<PeriodicTool />, { sendTo });
    const panel = () =>
      screen.element.querySelector(".tool-lib-x-formula")!.parentElement!;
    // The calculator is the tool's second view; the table is the first.
    expect(panel().hidden).toBe(true);
    await screen.press("Molecular weight");
    expect(panel().hidden).toBe(false);
    expect(
      screen.element.querySelector("[role=grid]")!.closest("[hidden]")
    ).not.toBeNull();
    await screen.type("Formula → molecular weight", "CuSO4·5H2O");
    expect(screen.element.querySelector("output")?.textContent).toBe(
      "249.69 g/mol"
    );
    const rows = screen
      .all(".tool-lib-x-formula tbody tr")
      .map((row) => [...row.children].map((item) => item.textContent));
    expect(rows).toEqual([
      ["Cu Copper", "1", "63.55", "25.45"],
      ["S Sulfur", "1", "32.07", "12.84"],
      ["O Oxygen", "9", "143.991", "57.67"],
      ["H Hydrogen", "10", "10.08", "4.04"],
    ]);
    await screen.press("Send to Molarity");
    expect(sendTo).toHaveBeenCalledWith("molarity", {
      kind: "molecular-weight",
      value: 249.69,
      unit: "g/mol",
      label: "CuSO4·5H2O",
      source: "periodic-table",
    });
    // The formula is still there after a look at the table.
    await screen.press("Periodic table");
    await screen.press("Molecular weight");
    expect(
      (screen.control("Formula → molecular weight") as HTMLInputElement).value
    ).toBe("CuSO4·5H2O");
  });
  it("explains a formula it cannot read, in the screen's language", async () => {
    const screen = await mount(<PeriodicTool />);
    await screen.press("Molecular weight");
    await screen.type("Formula → molecular weight", "Ca(OH");
    expect(screen.element.querySelector("[role=alert]")?.textContent).toBe(
      "Unbalanced brackets in formula"
    );
    expect(screen.element.querySelector("output")).toBeNull();
    // Outside the shell there is nowhere to send a weight.
    await screen.type("Formula → molecular weight", "NaCl");
    expect(screen.element.querySelector("output")?.textContent).toBe(
      "58.44 g/mol"
    );
    expect(screen.text()).not.toContain("Send to Molarity");
    await act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    locale.language = "ko";
    const korean = await mount(<PeriodicTool />);
    await korean.press("분자량 계산");
    await korean.type("화학식 → 분자량", "Xx2");
    expect(korean.element.querySelector("[role=alert]")?.textContent).toBe(
      "알 수 없는 원소 기호입니다. 대소문자를 확인하세요."
    );
    expect(korean.text()).toContain("확인할 부분: Xx");
  });
  it("is a grid that the arrow keys move through, skipping empty cells", async () => {
    const screen = await mount(<PeriodicTool />);
    const grid = screen.element.querySelector("[role=grid]")!;
    expect(grid.querySelectorAll("[role=row]")).toHaveLength(10);
    expect(grid.querySelectorAll("button[role=gridcell]")).toHaveLength(118);
    expect(
      screen
        .all<HTMLElement>("[role=gridcell]")
        .filter((item) => item.tabIndex === 0)
    ).toHaveLength(1);
    expect(cell(screen, 17).getAttribute("aria-label")).toBe(
      "17 Chlorine Cl, Halogen, group 17, period 3"
    );
    expect(cell(screen, 92).getAttribute("aria-label")).toBe(
      "92 Uranium U, Actinide, period 7"
    );
    await act(() => cell(screen, 1).focus());
    await screen.key("ArrowRight");
    expect(document.activeElement).toBe(cell(screen, 2));
    await screen.key("ArrowDown");
    expect(document.activeElement).toBe(cell(screen, 10));
    await screen.key("Home");
    expect(document.activeElement).toBe(cell(screen, 3));
    // The key moved the tab stop with it.
    expect(cell(screen, 3).tabIndex).toBe(0);
    expect(cell(screen, 1).tabIndex).toBe(-1);
    // Moving does not select; a press does.
    expect(screen.element.querySelector(".tool-element-detail")).toBeNull();
    await act(() => cell(screen, 3).click());
    expect(cell(screen, 3).getAttribute("aria-selected")).toBe("true");
    const detail = screen.element.querySelector(".tool-element-detail")!;
    const row = (label: string) =>
      [...detail.querySelectorAll("dl > div")]
        .find((item) => item.querySelector("dt")?.textContent === label)
        ?.querySelector("dd")?.textContent;
    expect(row("Group")).toBe("1");
    expect(row("Period")).toBe("2");
    // English labels keep their units.
    expect(row("Melting Point (K)")).toBe("453.65");
  });
  it("steps to the previous and next element within the filter", async () => {
    const screen = await mount(<PeriodicTool />);
    await screen.choose("Element family", "Noble gas");
    await act(() => cell(screen, 10).click());
    const step = (name: string) =>
      screen
        .all<HTMLButtonElement>("button")
        .find((button) => button.getAttribute("aria-label") === name)!;
    // Neon's neighbours among the noble gases are helium and argon.
    expect(step("Previous element").textContent).toBe("He");
    expect(step("Next element").textContent).toBe("Ar");
    await screen.press("Next element");
    expect(cell(screen, 18).getAttribute("aria-selected")).toBe("true");
    await screen.press("Previous element");
    await screen.press("Previous element");
    expect(cell(screen, 2).getAttribute("aria-selected")).toBe("true");
    expect(step("Previous element").disabled).toBe(true);
    // Without a filter the steps are the neighbours by atomic number.
    await screen.choose("Element family", "all");
    expect(step("Previous element").textContent).toBe("H");
    expect(step("Next element").textContent).toBe("Li");
  });
  it("shades the cells by a property and leaves elements without a value blank", async () => {
    const screen = await mount(<PeriodicTool />);
    expect(screen.element.querySelector(".tool-chart-scale")).toBeNull();
    await screen.choose("Cell colour", "Density");
    // Osmium is the densest element in the table; hydrogen the least dense.
    expect(cell(screen, 76).className).toContain("tool-chart-heat-6");
    expect(cell(screen, 1).className).toContain("tool-chart-heat-0");
    expect(cell(screen, 76).getAttribute("aria-label")).toBe(
      "76 Osmium Os, Transition metal, group 8, period 6, Density (g/cm³): 22.57"
    );
    // Oganesson has no measured density.
    expect(cell(screen, 118).className).toContain("tool-lib-x-blank");
    expect(cell(screen, 118).className).not.toContain("tool-chart-heat");
    expect(cell(screen, 118).getAttribute("aria-label")).toContain(
      "Density (g/cm³): no value"
    );
    // The scale names the property and both ends of its range.
    expect(
      screen.element.querySelector(".tool-chart-scale")?.textContent
    ).toBe("Density (g/cm³)0.0000898822.57");
    await screen.choose("Cell colour", "family");
    expect(cell(screen, 76).className).not.toContain("tool-chart-heat");
  });
});
