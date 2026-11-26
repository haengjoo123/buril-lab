// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { ToolContext } from "./ui";
import type { ToolDocument, ToolId } from "./registry";
import type { ToolRepository } from "./repository";
import NotesTool from "./NotesTool";
import {
  addTags,
  firstLine,
  formatTags,
  matchesNote,
  noteText,
  parseTags,
  sortNotes,
  tagCounts,
} from "./notes";

const exported = vi.hoisted(() => ({
  files: [] as { text: unknown; fileName: string }[],
}));
vi.mock("../../utils/fileExport", () => ({
  exportBlobPartAsFile: async (text: unknown, options: { fileName: string }) => {
    exported.files.push({ text, fileName: options.fileName });
  },
}));
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

const doc = (
  id: string,
  tool_id: ToolId,
  title: string,
  data: Record<string, unknown> = {},
  updated_at = "2026-11-01T00:00:00.000Z"
): ToolDocument => ({
  id,
  owner_id: "owner",
  tool_id,
  title,
  data,
  schema_version: 1,
  engine_version: "1",
  revision: 0,
  updated_at,
});

describe("note tags, titles and export text", () => {
  it("reads tags from the stored comma-separated string", () => {
    expect(parseTags("pcr, 2026 ,, PCR,western")).toEqual([
      "pcr",
      "2026",
      "western",
    ]);
    expect(parseTags("")).toEqual([]);
    expect(parseTags(undefined)).toEqual([]);
    expect(parseTags(["a", 1, "b"])).toEqual(["a", "b"]);
    // Written back in the same form the first version of the tool wrote.
    expect(formatTags(parseTags(" pcr ,gel"))).toBe("pcr, gel");
    expect(formatTags([])).toBe("");
  });

  it("adds typed tags without repeating one, whatever its case", () => {
    expect(addTags(["pcr"], "gel")).toEqual(["pcr", "gel"]);
    expect(addTags(["pcr"], "gel, blot，PCR,")).toEqual(["pcr", "gel", "blot"]);
    expect(addTags(["pcr"], "  ")).toEqual(["pcr"]);
    expect(addTags([], "x".repeat(60))[0]).toHaveLength(40);
  });

  it("takes the first line that says something as a title", () => {
    expect(firstLine("\n\n  PCR conditions  \nsecond line")).toBe(
      "PCR conditions"
    );
    expect(firstLine("# Heading\nbody")).toBe("Heading");
    expect(firstLine("- first item")).toBe("first item");
    expect(firstLine("   \n")).toBe("");
    expect(firstLine(undefined)).toBe("");
    expect(firstLine("a".repeat(120))).toHaveLength(80);
    // A minus sign or a hashtag is part of the line, not a list or heading mark.
    expect(firstLine("-20 °C storage")).toBe("-20 °C storage");
    expect(firstLine("#pcr notes")).toBe("#pcr notes");
  });

  it("exports the title and tags above the body", () => {
    expect(
      noteText({ title: "Gel run", tags: ["pcr", "gel"], body: "line 1\nline 2" }, "Tags")
    ).toBe("Gel run\nTags: pcr, gel\n\nline 1\nline 2");
    expect(noteText({ title: "Plain", tags: [], body: "text" }, "Tags")).toBe(
      "Plain\n\ntext"
    );
  });

  it("sorts by last edit or by title, and filters by tag and text", () => {
    const notes = [
      doc("a", "notes", "Note 10", { tags: "pcr", body: "alpha" }, "2026-11-03T00:00:00.000Z"),
      doc("b", "notes", "note 2", { tags: "PCR, gel", body: "beta" }, "2026-11-05T00:00:00.000Z"),
      doc("c", "notes", "Apple", { body: "gamma" }, "2026-11-04T00:00:00.000Z"),
    ];
    expect(sortNotes(notes, "updated").map((n) => n.id)).toEqual(["b", "c", "a"]);
    // "note 2" comes before "Note 10": numbers are compared as numbers.
    expect(sortNotes(notes, "title").map((n) => n.id)).toEqual(["c", "b", "a"]);
    expect(notes.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(tagCounts(notes)).toEqual([
      { tag: "gel", count: 1 },
      { tag: "pcr", count: 2 },
    ]);
    const ids = (query: string, tag: string) =>
      notes.filter((n) => matchesNote(n, query, tag)).map((n) => n.id);
    expect(ids("", "pcr")).toEqual(["a", "b"]);
    expect(ids("", "gel")).toEqual(["b"]);
    expect(ids("BETA", "")).toEqual(["b"]);
    expect(ids("gel", "")).toEqual(["b"]);
    expect(ids("alpha", "gel")).toEqual([]);
    expect(ids(" ", "")).toEqual(["a", "b", "c"]);
  });
});

describe("notes screen", () => {
  let root: Root | null = null;
  beforeEach(() => {
    exported.files.length = 0;
  });
  afterEach(async () => {
    if (root) await act(() => root?.unmount());
    document.body.innerHTML = "";
    root = null;
  });
  /** The notes workspace with named documents of the account around it. */
  async function mount(initial: ToolDocument[]) {
    const workspace = doc("workspace", "notes", "Notes", { _workspace: true });
    let rows = initial.map((row) => ({ doc: row }));
    let render: () => void = () => {};
    const repo = {
      owner: "owner",
      get items() {
        return [{ doc: workspace }, ...rows];
      },
      create: async (
        tool_id: ToolId,
        title: string,
        data: Record<string, unknown>
      ) => {
        const created = doc(`new-${rows.length}`, tool_id, title, data);
        rows = [{ doc: created }, ...rows];
        render();
        return created;
      },
      update: async (id: string, patch: Partial<ToolDocument>) => {
        rows = rows.map((row) =>
          row.doc.id === id ? { doc: { ...row.doc, ...patch } } : row
        );
        render();
      },
    } as unknown as ToolRepository;
    function Harness() {
      const [, setVersion] = useState(0);
      useEffect(() => {
        render = () => setVersion((n) => n + 1);
      }, []);
      return (
        <MemoryRouter>
          <ToolContext.Provider
            value={{
              doc: workspace,
              repo,
              documents: rows
                .map((row) => row.doc)
                .filter((row) => !row.deleted_at),
            }}
          >
            <NotesTool />
          </ToolContext.Provider>
        </MemoryRouter>
      );
    }
    const element = document.createElement("div");
    document.body.appendChild(element);
    root = createRoot(element);
    await act(() => root!.render(<Harness />));
    return {
      element,
      note: (id: string) => rows.find((row) => row.doc.id === id)!.doc,
    };
  }
  const button = (container: Element, text: string) =>
    [...container.querySelectorAll("button")].find(
      (b) => b.textContent === text
    )!;
  const labelled = (container: Element, label: string) =>
    container.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
  const field = (container: Element, label: string) =>
    [...container.querySelectorAll("label")]
      .find((l) => l.querySelector("span")?.textContent === label)!
      .querySelector<HTMLInputElement | HTMLSelectElement>("input, select")!;
  const click = (element: Element) =>
    act(() => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  async function type(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string
  ) {
    await act(() => {
      Object.getOwnPropertyDescriptor(
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        "value"
      )!.set!.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  const choose = (select: HTMLSelectElement, value: string) =>
    act(() => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  const titles = (container: Element) =>
    [...container.querySelectorAll(".tool-note-item strong")].map(
      (item) => item.textContent
    );
  const open = (container: Element, title: string) =>
    click(
      [...container.querySelectorAll(".tool-note-item")].find(
        (item) => item.querySelector("strong")?.textContent === title
      )!
    );
  const tagInput = (container: Element) =>
    container.querySelector<HTMLInputElement>(".tool-notes-x-tagbox input")!;
  const chips = (container: Element) =>
    [...container.querySelectorAll(".tool-notes-x-chip")].map(
      (chip) => chip.textContent
    );

  it("adds tags with a comma or Enter, removes them with ×, and stores one string", async () => {
    const { element, note } = await mount([
      doc("n1", "notes", "Gel run", { body: "", tags: "pcr", links: [] }),
    ]);
    await open(element, "Gel run");
    expect(chips(element)).toEqual(["pcr"]);
    // A comma ends the tag being typed.
    await type(tagInput(element), "gel,");
    expect(note("n1").data.tags).toBe("pcr, gel");
    expect(tagInput(element).value).toBe("");
    // Enter adds what is typed; a tag already there is not added twice.
    await type(tagInput(element), "western");
    await act(() => {
      tagInput(element).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
    });
    await type(tagInput(element), "PCR,");
    expect(note("n1").data.tags).toBe("pcr, gel, western");
    expect(chips(element)).toEqual(["pcr", "gel", "western"]);
    await click(labelled(element, "Remove tag: gel"));
    expect(note("n1").data.tags).toBe("pcr, western");
    // Backspace in the empty field takes the last tag away.
    await act(() => {
      tagInput(element).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Backspace", bubbles: true })
      );
    });
    expect(note("n1").data.tags).toBe("pcr");
  });

  it("filters the list by tag and sorts it by last edit or title", async () => {
    const { element } = await mount([
      doc("a", "notes", "Zebra", { body: "", tags: "pcr" }, "2026-11-05T00:00:00.000Z"),
      doc("b", "notes", "Apple", { body: "", tags: "pcr, gel" }, "2026-11-03T00:00:00.000Z"),
      doc("c", "notes", "Mango", { body: "" }, "2026-11-04T00:00:00.000Z"),
    ]);
    // Newest edit first.
    expect(titles(element)).toEqual(["Zebra", "Mango", "Apple"]);
    await choose(field(element, "Sort by") as HTMLSelectElement, "title");
    expect(titles(element)).toEqual(["Apple", "Mango", "Zebra"]);
    const filter = element.querySelector(".tool-notes-x-filter")!;
    expect(
      [...filter.querySelectorAll("button")].map((b) => b.textContent)
    ).toEqual(["gel1", "pcr2"]);
    await click(button(filter, "pcr2"));
    expect(titles(element)).toEqual(["Apple", "Zebra"]);
    expect(button(filter, "pcr2").getAttribute("aria-pressed")).toBe("true");
    await click(button(filter, "gel1"));
    expect(titles(element)).toEqual(["Apple"]);
    // Pressing the chosen tag again shows every note.
    await click(button(filter, "gel1"));
    expect(titles(element)).toHaveLength(3);
    // A search that finds nothing says so and can be cleared.
    await type(field(element, "Search notes") as HTMLInputElement, "nothing");
    expect(element.textContent).toContain("No notes match");
    await click(button(element, "Clear search and tag"));
    expect(titles(element)).toHaveLength(3);
  });

  it("exports the title and tags with the body, under a name of its own", async () => {
    const { element } = await mount([
      doc("n1", "notes", "Gel run 3", {
        body: "Loaded 5 µL\n120 V",
        tags: "pcr, gel",
      }),
    ]);
    await open(element, "Gel run 3");
    await click(button(element, "Export text"));
    expect(exported.files).toHaveLength(1);
    expect(exported.files[0].text).toBe(
      "Gel run 3\nTags: pcr, gel\n\nLoaded 5 µL\n120 V"
    );
    expect(exported.files[0].fileName).toMatch(
      /^buril-notes-Gel-run-3-\d{8}-\d{4}\.txt$/
    );
  });

  it("lists linked work with the tool it belongs to", async () => {
    const { element, note } = await mount([
      doc("n1", "notes", "Plan", { body: "", tags: "", links: ["d1", "gone"] }),
      doc("d1", "dilution", "Stock 10x"),
      doc("m1", "master-mix", "qPCR mix"),
    ]);
    await open(element, "Plan");
    const links = element.querySelector(".tool-notes-x-links")!;
    const rows = [...links.querySelectorAll("li")];
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector(".tool-notes-x-linktool")?.textContent).toBe(
      "Dilution"
    );
    expect(rows[0].querySelector("svg")).not.toBeNull();
    expect(rows[0].querySelector("a")?.getAttribute("href")).toBe(
      "/app/tools/dilution/d1"
    );
    expect(rows[1].textContent).toContain("Deleted work");
    // Work that can still be linked is offered with its tool's name; work
    // already linked, and the note itself, are not offered again.
    const select = field(element, "Link saved work") as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "Select",
      "Master Mix · qPCR mix",
    ]);
    await choose(select, "m1");
    expect(note("n1").data.links).toEqual(["d1", "gone", "m1"]);
    await click(labelled(element, "Remove link: Stock 10x"));
    expect(note("n1").data.links).toEqual(["gone", "m1"]);
  });

  it("offers the first line as the title of an untitled note and never sets it by itself", async () => {
    const { element, note } = await mount([]);
    await click(button(element, "Add note"));
    const created = "new-0";
    expect(note(created).title).toBe("New note");
    const body = element.querySelector("textarea")!;
    await type(body, "PCR conditions for lot 12\nanneal at 58 °C");
    // Typing the body left the title alone.
    expect(note(created).title).toBe("New note");
    await click(button(element, "Use first line as title"));
    expect(note(created).title).toBe("PCR conditions for lot 12");
    const title = field(element, "Title") as HTMLInputElement;
    expect(title.value).toBe("PCR conditions for lot 12");
    // A note with a title of its own is not offered a replacement...
    expect(button(element, "Use first line as title")).toBeUndefined();
    // ...until its title field has been emptied; the saved title stays then.
    await type(title, "");
    expect(note(created).title).toBe("PCR conditions for lot 12");
    await type(body, "New first line\nrest");
    await act(() => {
      title.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(title.value).toBe("");
    await click(button(element, "Use first line as title"));
    expect(note(created).title).toBe("New first line");
    expect(title.value).toBe("New first line");
  });

  it("moves a note to the trash and brings it back with undo", async () => {
    const { element, note } = await mount([
      doc("n1", "notes", "Keep me", { body: "text", tags: "" }),
    ]);
    await open(element, "Keep me");
    await click(button(element, "Move to trash"));
    expect(note("n1").deleted_at).toBeTruthy();
    expect(titles(element)).toEqual([]);
    expect(element.textContent).toContain("No notes yet");
    await click(button(element, "Undo"));
    expect(note("n1").deleted_at).toBeNull();
    expect(titles(element)).toEqual(["Keep me"]);
  });
});
