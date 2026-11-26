// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { ToolContext } from "./ui";
import type { ToolDocument } from "./registry";
import type { ToolRepository } from "./repository";
import type { CalendarEvent } from "./calendar";
import CalendarTool from "./CalendarTool";

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

// Friday 27 November 2026, 10:03 on this device. November 2026 begins on a
// Sunday, so the month view runs from 1 November to 12 December.
const NOW = +new Date(2026, 10, 27, 10, 3, 0);
const local = (day: number, hour = 0, minute = 0, month = 10) =>
  new Date(2026, month, day, hour, minute).toISOString();
const event = (more: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "e1",
  title: "Seminar",
  start: local(27, 14),
  end: local(27, 15),
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  repeat: "none",
  exceptions: [],
  reminderMinutes: 0,
  ...more,
});

let root: Root | null = null;
beforeEach(() => {
  // Only the clock is fixed; the undo bar keeps its real timeout.
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  localStorage.clear();
  exported.files.length = 0;
});
afterEach(async () => {
  if (root) await act(() => root?.unmount());
  document.body.innerHTML = "";
  root = null;
  vi.useRealTimers();
});

async function mount(events: CalendarEvent[] = []) {
  let doc: ToolDocument = {
    id: "calendar",
    owner_id: "owner",
    tool_id: "calendar",
    title: "Calendar",
    data: { _workspace: true, events },
    schema_version: 1,
    engine_version: "1",
    revision: 0,
    updated_at: "",
  };
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
        <CalendarTool />
      </ToolContext.Provider>
    );
  }
  const element = document.createElement("div");
  document.body.appendChild(element);
  root = createRoot(element);
  await act(() => root!.render(<Harness />));
  return {
    element,
    events: () => doc.data.events as CalendarEvent[],
  };
}
const click = (element: Element) =>
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
const button = (container: Element, text: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === text
  )!;
const field = (container: Element, label: string) =>
  [...container.querySelectorAll("label")]
    .find((l) => l.querySelector("span")?.textContent === label)
    ?.querySelector<HTMLInputElement | HTMLSelectElement>("input, select");
async function type(element: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
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
/** The cell of a day, found by the date its button announces. */
const day = (container: Element, date: string) =>
  [...container.querySelectorAll(".tool-calendar-x-day")].find((cell) =>
    cell
      .querySelector(".tool-calendar-x-date")
      ?.getAttribute("aria-label")
      ?.startsWith(date)
  )!;
const chips = (cell: Element) =>
  [...cell.querySelectorAll(".tool-calendar-x-event")].map((chip) =>
    chip.getAttribute("aria-label")
  );
async function importFile(container: Element, text: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [{ name: "events.ics", text: async () => text }],
  });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
    // The file is read, then the document is written, each in its own turn.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("calendar days", () => {
  it("adds an event on the date that is pressed and opens it for naming", async () => {
    const { element, events } = await mount();
    expect(element.textContent).toContain("No events yet");
    await click(
      day(element, "Monday, November 30, 2026").querySelector(
        ".tool-calendar-x-date"
      )!
    );
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      title: "New event",
      start: local(30, 9),
      end: local(30, 10),
      repeat: "none",
    });
    expect(events()[0].allDay).toBeUndefined();
    // It shows on that day, and the editor opens with the title ready to type over.
    expect(chips(day(element, "Monday, November 30, 2026"))).toHaveLength(1);
    expect(chips(day(element, "Friday, November 27, 2026"))).toEqual([]);
    const title = field(element, "Title") as HTMLInputElement;
    expect(title.value).toBe("New event");
    expect(document.activeElement).toBe(title);
    expect(element.textContent).not.toContain("No events yet");
    await type(title, "Western blot");
    expect(events()[0].title).toBe("Western blot");
  });

  it("marks today with a label as well as a border, and dims the days of other months", async () => {
    const { element } = await mount();
    const current = [...element.querySelectorAll('[aria-current="date"]')];
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute("aria-label")).toBe(
      "Friday, November 27, 2026, today · add event"
    );
    expect(current[0].textContent).toContain("Today");
    expect(
      current[0].closest(".tool-calendar-x-day")!.className
    ).toContain("tool-calendar-x-today");
    expect(element.querySelectorAll(".tool-calendar-x-today")).toHaveLength(1);
    expect(element.querySelectorAll(".tool-calendar-x-day")).toHaveLength(42);
    // 1 to 12 December fill the last rows of the November grid.
    const outside = [...element.querySelectorAll(".tool-calendar-x-outside")];
    expect(outside).toHaveLength(12);
    expect(
      outside[0].querySelector(".tool-calendar-x-date")!.getAttribute("aria-label")
    ).toMatch(/^Tuesday, December 1, 2026/);
    // The first of a month names the month.
    expect(outside[0].textContent).toContain("Dec 1");
    // A week has no other month to set apart.
    await choose(field(element, "View") as HTMLSelectElement, "week");
    expect(element.querySelectorAll(".tool-calendar-x-day")).toHaveLength(7);
    expect(element.querySelectorAll(".tool-calendar-x-outside")).toHaveLength(0);
    expect(element.querySelectorAll('[aria-current="date"]')).toHaveLength(1);
    // Another month has no today in it.
    await choose(field(element, "View") as HTMLSelectElement, "month");
    await click(element.querySelector('[aria-label="Next month"]')!);
    await click(element.querySelector('[aria-label="Next month"]')!);
    expect(element.querySelectorAll('[aria-current="date"]')).toHaveLength(0);
  });

  it("turns an event into whole days, edits its dates and turns it back", async () => {
    const { element, events } = await mount([event()]);
    await click(
      day(element, "Friday, November 27, 2026").querySelector(
        ".tool-calendar-x-event"
      )!
    );
    expect(field(element, "Start (device timezone)")).toBeDefined();
    await click(button(element, "All day"));
    expect(events()[0]).toMatchObject({
      allDay: true,
      start: local(27),
      end: local(28),
    });
    // Dates replace the date-and-time fields.
    expect(field(element, "Start (device timezone)")).toBeUndefined();
    expect((field(element, "Start date") as HTMLInputElement).value).toBe(
      "2026-11-27"
    );
    const end = field(element, "End date (inclusive)") as HTMLInputElement;
    expect(end.type).toBe("date");
    expect(end.value).toBe("2026-11-27");
    expect(chips(day(element, "Friday, November 27, 2026"))).toEqual([
      "Seminar, All day",
    ]);
    await type(end, "2026-11-29");
    expect(events()[0]).toMatchObject({ start: local(27), end: local(30) });
    // Moving the start keeps the three days.
    await type(field(element, "Start date") as HTMLInputElement, "2026-11-30");
    expect(events()[0]).toMatchObject({
      start: local(30),
      end: local(3, 0, 0, 11),
    });
    expect(
      (field(element, "End date (inclusive)") as HTMLInputElement).value
    ).toBe("2026-12-02");
    // An end before the start makes it that one day.
    await type(
      field(element, "End date (inclusive)") as HTMLInputElement,
      "2026-11-28"
    );
    expect(events()[0]).toMatchObject({ start: local(28), end: local(29) });
    // The reminder of a whole day is chosen as a time, counted from 00:00.
    const reminder = field(element, "Reminder time") as HTMLSelectElement;
    await choose(reminder, "900");
    expect(events()[0].reminderMinutes).toBe(900);
    await click(button(element, "All day"));
    expect(events()[0]).toMatchObject({
      start: local(28, 9),
      end: local(28, 10),
    });
    expect(events()[0].allDay).toBeUndefined();
    expect(field(element, "Start (device timezone)")).toBeDefined();
  });

  it("shows an event of several days on every day it covers", async () => {
    const { element } = await mount([
      event({
        id: "trip",
        title: "Field trip",
        start: local(27),
        end: local(30),
        allDay: true,
      }),
      // Late on the 28th until early on the 29th.
      event({
        id: "run",
        title: "Overnight run",
        start: local(28, 22),
        end: local(29, 2, 30),
      }),
      event({ id: "seminar" }),
    ]);
    expect(chips(day(element, "Thursday, November 26, 2026"))).toEqual([]);
    expect(chips(day(element, "Friday, November 27, 2026"))).toEqual([
      "Field trip, Day 1/3",
      expect.stringMatching(/^Seminar, 0?2:00/),
    ]);
    expect(chips(day(element, "Saturday, November 28, 2026"))).toEqual([
      "Field trip, Day 2/3",
      expect.stringMatching(/^Overnight run, Day 1\/2 · 10:00/),
    ]);
    expect(chips(day(element, "Sunday, November 29, 2026"))).toEqual([
      "Field trip, Day 3/3",
      expect.stringMatching(/^Overnight run, Day 2\/2 · ~0?2:30/),
    ]);
    expect(chips(day(element, "Monday, November 30, 2026"))).toEqual([]);
    // Each piece says on which sides the event goes on.
    const pieces = ["Friday, November 27", "Saturday, November 28", "Sunday, November 29"].map(
      (date) =>
        day(element, date).querySelector(".tool-calendar-x-event")!.className
    );
    expect(pieces[0]).toContain("is-after");
    expect(pieces[0]).not.toContain("is-before");
    expect(pieces[1]).toContain("is-before");
    expect(pieces[1]).toContain("is-after");
    expect(pieces[2]).toContain("is-before");
    expect(pieces[2]).not.toContain("is-after");
    // The list names the range once.
    await choose(field(element, "View") as HTMLSelectElement, "list");
    const rows = [...element.querySelectorAll(".tool-calendar-x-row")].map(
      (row) => row.textContent
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/Nov 27, 2026.* – .*Nov 29, 2026.*All day.*Field trip/);
  });

  it("keeps an event that began last month on the days it still covers", async () => {
    const { element } = await mount([
      event({
        id: "long",
        title: "Incubation",
        start: local(28, 0, 0, 9),
        end: local(4, 0, 0, 10),
        allDay: true,
      }),
    ]);
    expect(chips(day(element, "Sunday, November 1, 2026"))).toEqual([
      "Incubation, Day 5/7",
    ]);
    expect(chips(day(element, "Tuesday, November 3, 2026"))).toEqual([
      "Incubation, Day 7/7",
    ]);
    expect(chips(day(element, "Wednesday, November 4, 2026"))).toEqual([]);
  });

  it("says so when the list has nothing to show", async () => {
    const { element } = await mount([event()]);
    await choose(field(element, "View") as HTMLSelectElement, "list");
    expect(element.querySelectorAll(".tool-calendar-x-row")).toHaveLength(1);
    await type(field(element, "Search events") as HTMLInputElement, "nothing");
    expect(element.querySelectorAll(".tool-calendar-x-row")).toHaveLength(0);
    expect(element.textContent).toContain("No events match");
    await type(field(element, "Search events") as HTMLInputElement, "");
    await click(element.querySelector('[aria-label="Next month"]')!);
    await click(element.querySelector('[aria-label="Next month"]')!);
    expect(element.textContent).toContain("No events in this period");
  });

  it("deletes an event at once and brings it back with undo", async () => {
    const { element, events } = await mount([event()]);
    await click(
      day(element, "Friday, November 27, 2026").querySelector(
        ".tool-calendar-x-event"
      )!
    );
    await click(button(element, "Delete event"));
    expect(events()).toEqual([]);
    expect(element.textContent).toContain("No events yet");
    await click(button(element, "Undo"));
    expect(events()).toHaveLength(1);
  });
});

describe("calendar ICS import and export", () => {
  const file = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:kept@example.org",
    "DTSTART;VALUE=DATE:20261128",
    "DTEND;VALUE=DATE:20261130",
    "SUMMARY:Retreat",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:byday@example.org",
    "DTSTART:20261130T000000Z",
    "DTEND:20261130T010000Z",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
    "SUMMARY:Twice a week",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:noend@example.org",
    "DTSTART:20261201T000000Z",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("imports the events it can and lists each one it could not, with the reason", async () => {
    const { element, events } = await mount([event()]);
    await importFile(element, file);
    expect(events().map((e) => e.title)).toEqual(["Seminar", "Retreat"]);
    expect(events()[1]).toMatchObject({
      allDay: true,
      start: local(28),
      end: local(30),
    });
    const report = element.querySelector(".tool-calendar-x-report")!;
    expect(report.getAttribute("role")).toBe("status");
    expect(report.querySelector("strong")!.textContent).toBe(
      "Imported: 1 (new 1, updated 0). Not imported: 2:"
    );
    const rows = [...report.querySelectorAll("li")].map((li) => li.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Twice a week");
    expect(rows[0]).toContain("2026-11-30 00:00");
    expect(rows[0]).toContain("The repeat rule is not supported");
    expect(rows[1]).toContain("(untitled)");
    expect(rows[1]).toContain("The end or duration is missing");
    // Both days of the imported event show at once.
    expect(chips(day(element, "Saturday, November 28, 2026"))).toEqual([
      "Retreat, Day 1/2",
    ]);
    expect(chips(day(element, "Sunday, November 29, 2026"))).toEqual([
      "Retreat, Day 2/2",
    ]);
    // The same file again updates what it brought in before.
    await importFile(element, file);
    expect(events()).toHaveLength(2);
    expect(report.isConnected).toBe(true);
    expect(
      element.querySelector(".tool-calendar-x-report strong")!.textContent
    ).toBe("Imported: 1 (new 0, updated 1). Not imported: 2:");
    await click(
      element.querySelector('[aria-label="Dismiss import result"]')!
    );
    expect(element.querySelector(".tool-calendar-x-report")).toBeNull();
  });

  it("undoes an import, and says when a file has no events", async () => {
    const { element, events } = await mount([event()]);
    await importFile(element, file);
    expect(events()).toHaveLength(2);
    await click(button(element, "Undo"));
    expect(events().map((e) => e.title)).toEqual(["Seminar"]);
    await importFile(element, "just some text");
    expect(events()).toHaveLength(1);
    expect(
      element.querySelector(".tool-calendar-x-report strong")!.textContent
    ).toBe("No events were found in this file.");
  });

  it("exports whole days as dates under a dated file name", async () => {
    const { element } = await mount([
      event({
        id: "0b0f5a52-3d3c-4d8e-9a58-0c2f1f7b9a11",
        title: "Retreat",
        start: local(28),
        end: local(30),
        allDay: true,
      }),
    ]);
    await act(async () => {
      button(element, "Export ICS").dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
      await vi.dynamicImportSettled();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(exported.files).toHaveLength(1);
    expect(exported.files[0].fileName).toMatch(
      /^buril-calendar-20261127-1003\.ics$/
    );
    expect(String(exported.files[0].text)).toContain(
      "DTSTART;VALUE=DATE:20261128\r\nDTEND;VALUE=DATE:20261130"
    );
  });
});
