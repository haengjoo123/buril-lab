// @vitest-environment jsdom
import { act, useState, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { ToolContext } from "./ui";
import type { ToolDocument, ToolId } from "./registry";
import type { ToolRepository } from "./repository";
import type { Alarm, Clock } from "./clock";
import { deviceEnabled, setDeviceEnabled } from "./notifications";
import TimerTool from "./TimerTool";
import AlarmTool from "./AlarmTool";

// The device switches are the real ones (kept in localStorage); only asking
// for permission is replaced, so that a refusal can be played.
const notify = vi.hoisted(() => ({ deny: false }));
vi.mock("./notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./notifications")>()),
  enableNotifications: async () => {
    if (notify.deny) throw Error("Notification permission denied");
    return { display: "granted", exact: true };
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

// Monday 9 November 2026, 10:03:00 local time.
const START = +new Date(2026, 10, 9, 10, 3, 0);
let root: Root | null = null;
beforeEach(() => {
  // The clock and the screen's own ticks move only when a test moves them.
  vi.useFakeTimers({
    now: START,
    toFake: [
      "Date",
      "setInterval",
      "clearInterval",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
  localStorage.clear();
  notify.deny = false;
});
afterEach(async () => {
  if (root) await act(() => root?.unmount());
  document.body.innerHTML = "";
  root = null;
  vi.useRealTimers();
});
const toolDoc = (
  tool_id: ToolId,
  data: Record<string, unknown>,
  id = "doc",
  title = "Test"
): ToolDocument => ({
  id,
  owner_id: "owner",
  tool_id,
  title,
  data,
  schema_version: 1,
  engine_version: "1",
  revision: 0,
  updated_at: "",
});
async function mount(
  children: ReactNode,
  tool: ToolId,
  data: Record<string, unknown>,
  others: { doc: ToolDocument; draft?: boolean }[] = []
) {
  let doc = toolDoc(tool, data);
  const element = document.createElement("div");
  document.body.appendChild(element);
  let renderDoc: (next: ToolDocument) => void = () => {};
  const repo = {
    owner: "owner",
    items: [{ doc }, ...others],
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
      <MemoryRouter>
        <ToolContext.Provider value={{ doc: state, repo, documents: [] }}>
          {children}
        </ToolContext.Provider>
      </MemoryRouter>
    );
  }
  root = createRoot(element);
  await act(() => root!.render(<Harness />));
  return { element, getDoc: () => doc };
}
const button = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === text
  )!;
const labelled = (container: HTMLElement, label: string) =>
  container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
const fields = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll("label")]
    .filter((l) => l.querySelector("span")?.textContent === label)
    .map((l) => l.querySelector("input")!);
async function type(element: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
/** Lets time pass, with the screen's ticks. */
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const clock = (patch: Partial<Clock>): Clock => ({
  id: "1",
  name: "Incubation",
  color: "#2563eb",
  duration: 60000,
  remaining: 60000,
  end: null,
  running: false,
  elapsed: 0,
  started: null,
  ...patch,
});
const notifies = (id: string) => deviceEnabled("owner", id);
const names = (container: HTMLElement) =>
  [...container.querySelectorAll("h2")].map((h) => h.textContent);

describe("stopwatch", () => {
  it("records laps newest first, exports them and restores them after a reset", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { element, getDoc } = await mount(<TimerTool stopwatch />, "stopwatch", {
      clocks: [],
    });
    const stored = () => (getDoc().data.clocks as Clock[])[0];
    expect(button(element, "Lap").disabled).toBe(true);
    await act(() => button(element, "Start").click());
    await wait(1500);
    await act(() => button(element, "Lap").click());
    await wait(2500);
    await act(() => button(element, "Lap").click());
    expect(stored().laps).toEqual([1500, 4000]);
    const rows = [...element.querySelectorAll("tbody tr")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => cell.textContent)
    );
    expect(rows).toEqual([
      ["2", "00:00:02.50", "00:00:04.00"],
      ["1", "00:00:01.50", "00:00:01.50"],
    ]);
    await act(() => button(element, "Copy").click());
    expect(writeText).toHaveBeenCalledWith(
      "Lap\tLap time\tTotal\n1\t00:00:01.50\t00:00:01.50\n2\t00:00:02.50\t00:00:04.00"
    );
    await act(() => button(element, "Reset").click());
    expect(stored()).toMatchObject({ running: false, elapsed: 0, laps: [] });
    expect(element.querySelector("tbody")).toBeNull();
    await act(() => button(element, "Undo").click());
    expect(stored()).toMatchObject({
      running: true,
      started: START,
      laps: [1500, 4000],
    });
    vi.unstubAllGlobals();
  });
  it("shows hundredths from animation frames while running", async () => {
    const { element } = await mount(<TimerTool stopwatch />, "stopwatch", {
      clocks: [],
    });
    await act(() => button(element, "Start").click());
    // 1.23 s later, with the frames in between drawn.
    await wait(1230);
    expect(element.querySelector('[role="timer"]')?.textContent).toMatch(
      /^00:00:01\.2\d$/
    );
  });
});

describe("timer", () => {
  it("counts past zero with a finished state until it is dismissed", async () => {
    const { element, getDoc } = await mount(<TimerTool />, "timer", {
      clocks: [clock({})],
    });
    const stored = () => (getDoc().data.clocks as Clock[])[0];
    await act(() => button(element, "Start").click());
    expect(stored()).toMatchObject({ running: true, end: START + 60000 });
    // The duration that was started is remembered.
    expect(getDoc().data.recentDurations).toEqual([60000]);
    await wait(30000);
    expect(element.querySelector('[role="timer"]')?.textContent).toBe(
      "00:00:30"
    );
    expect(element.querySelector('[role="status"]')?.textContent).toBe("");
    await wait(65000);
    expect(element.querySelector('[role="timer"]')?.textContent).toBe("+00:35");
    expect(
      element.querySelector('[data-state="finished"]')?.textContent
    ).toContain("Finished");
    // Announced once, by name.
    expect(element.querySelector('[role="status"]')?.textContent).toBe(
      "Timer finished: Incubation"
    );
    expect(button(element, "Restart")).toBeTruthy();
    await act(() => button(element, "Dismiss").click());
    expect(stored()).toMatchObject({
      running: false,
      end: null,
      remaining: 60000,
    });
    expect(element.querySelector('[role="timer"]')?.textContent).toBe(
      "00:01:00"
    );
    // Undo puts the finished timer back, still counting from the same end.
    await act(() => button(element, "Undo").click());
    expect(stored()).toMatchObject({ running: true, end: START + 60000 });
    await wait(250);
    expect(element.querySelector('[role="timer"]')?.textContent).toBe("+00:35");
  });
  it("lists running timers first, then finished, then stopped, with timers from cell culture", async () => {
    const { element } = await mount(
      <TimerTool />,
      "timer",
      {
        clocks: [
          clock({ id: "idle", name: "Idle" }),
          clock({
            id: "late",
            name: "Late",
            running: true,
            end: START + 600000,
          }),
          clock({ id: "done", name: "Done", running: true, end: START - 5000 }),
          clock({ id: "soon", name: "Soon", running: true, end: START + 30000 }),
        ],
      },
      [
        {
          doc: toolDoc(
            "cell-culture",
            { timer: { id: "t1", end: START + 120000 } },
            "culture-1",
            "HeLa passage"
          ),
        },
        {
          doc: toolDoc(
            "cell-culture",
            { timer: { id: "t2", end: START + 900000 } },
            "culture-draft",
            "세포 배양"
          ),
          draft: true,
        },
        // No timer, and a trashed document: neither is listed.
        { doc: toolDoc("cell-culture", { timer: null }, "culture-2") },
        {
          doc: {
            ...toolDoc(
              "cell-culture",
              { timer: { id: "t3", end: START + 1000 } },
              "culture-3",
              "Trashed"
            ),
            deleted_at: "2026-11-01T00:00:00.000Z",
          },
        },
      ]
    );
    expect(names(element)).toEqual([
      "Soon",
      "HeLa passage",
      "Late",
      "Cell Culture",
      "Done",
      "Idle",
    ]);
    const links = [...element.querySelectorAll("a")].map((a) =>
      a.getAttribute("href")
    );
    expect(links).toEqual([
      "/app/tools/cell-culture/culture-1",
      "/app/tools/cell-culture",
    ]);
    // A timer kept by another tool has no controls here.
    const external = element.querySelector('a[href$="culture-1"]')!
      .closest("section")!;
    expect(external.querySelector("button")).toBeNull();
    // "Soon" runs out and drops below the timers still running.
    await wait(31000);
    expect(names(element).slice(0, 5)).toEqual([
      "HeLa passage",
      "Late",
      "Cell Culture",
      "Done",
      "Soon",
    ]);
  });
  it("keeps keyboard focus on a control whose timer moves in the list", async () => {
    const { element } = await mount(<TimerTool />, "timer", {
      clocks: [
        clock({ id: "a", name: "A" }),
        clock({ id: "b", name: "B", running: true, end: START + 30000 }),
      ],
    });
    expect(names(element)).toEqual(["B", "A"]);
    const pause = button(element, "Pause");
    pause.focus();
    // Paused, B goes back below A: its node is moved in the page, and a
    // moved node would be left without focus.
    await act(() => pause.click());
    expect(names(element)).toEqual(["A", "B"]);
    expect(pause.textContent).toBe("Resume");
    expect(document.activeElement).toBe(pause);
  });
  it("deletes a timer at once and puts it back in place on undo", async () => {
    setDeviceEnabled("owner", "b", true);
    const { element, getDoc } = await mount(<TimerTool />, "timer", {
      clocks: [
        clock({ id: "a", name: "A" }),
        clock({ id: "b", name: "B" }),
        clock({ id: "c", name: "C" }),
      ],
    });
    const ids = () => (getDoc().data.clocks as Clock[]).map((c) => c.id);
    await act(() => labelled(element, "Delete B").click());
    expect(ids()).toEqual(["a", "c"]);
    expect(notifies("b")).toBe(false);
    await act(() => button(element, "Undo").click());
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(notifies("b")).toBe(true);
  });
  it("restores a running timer after an accidental reset", async () => {
    const running = clock({
      running: true,
      started: START - 20000,
      end: START + 40000,
    });
    const { element, getDoc } = await mount(<TimerTool />, "timer", {
      clocks: [running],
    });
    await act(() => button(element, "Reset").click());
    expect((getDoc().data.clocks as Clock[])[0]).toMatchObject({
      running: false,
      end: null,
      remaining: 60000,
    });
    await act(() => button(element, "Undo").click());
    expect((getDoc().data.clocks as Clock[])[0]).toEqual(running);
  });
  it("edits the presets and adds a timer from typed hours, minutes and seconds", async () => {
    const { element, getDoc } = await mount(<TimerTool />, "timer", {
      clocks: [],
    });
    // A document saved before presets existed shows the original four.
    expect(button(element, "1 min")).toBeTruthy();
    expect(button(element, "30 min")).toBeTruthy();
    await act(() => button(element, "Edit presets").click());
    await act(() => labelled(element, "Remove the 1 min preset").click());
    expect(getDoc().data.presets).toEqual([300000, 600000, 1800000]);
    await type(fields(element, "Minutes")[0], "90");
    await type(fields(element, "Seconds")[0], "30");
    // What was typed stays as typed.
    expect(fields(element, "Minutes")[0].value).toBe("90");
    await act(() => button(element, "Add 1 h 30 min 30 s").click());
    expect(getDoc().data.presets).toEqual([300000, 600000, 1800000, 5430000]);
    await act(() => button(element, "5 min").click());
    expect(fields(element, "Minutes")[0].value).toBe("5");
    expect(fields(element, "Seconds")[0].value).toBe("0");
    await act(() => button(element, "Add timer").click());
    expect(getDoc().data.clocks).toMatchObject([
      { name: "Timer 1", duration: 300000, remaining: 300000, running: false },
    ]);
  });
  it("shows a notification permission error only on the timer it belongs to", async () => {
    setDeviceEnabled("owner", "b", true);
    notify.deny = true;
    const { element, getDoc } = await mount(<TimerTool />, "timer", {
      clocks: [clock({ id: "a", name: "A" }), clock({ id: "b", name: "B" })],
    });
    const panel = (name: string) =>
      [...element.querySelectorAll("section")].find(
        (section) => section.querySelector("h2")?.textContent === name
      )!;
    await act(async () => button(panel("B"), "Start").click());
    // The countdown starts either way.
    expect(
      (getDoc().data.clocks as Clock[]).find((c) => c.id === "b")?.running
    ).toBe(true);
    expect(panel("B").querySelector('[role="alert"]')?.textContent).toBe(
      "Notification permission denied"
    );
    expect(panel("A").querySelector('[role="alert"]')).toBeNull();
    expect(element.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });
});

describe("alarm", () => {
  const iso = (hour: number, minute = 0, day = 9) =>
    new Date(2026, 10, day, hour, minute).toISOString();
  const alarm = (patch: Partial<Alarm>): Alarm => ({
    id: "1",
    name: "Alarm",
    at: iso(12),
    weekdays: [],
    active: true,
    ...patch,
  });
  const shown = (container: HTMLElement) =>
    fields(container, "Name").map((input) => input.value);
  const stored = (doc: ToolDocument) =>
    (doc.data.alarms as Alarm[]).map((a) => a.id);

  it("orders alarms by their next ring, with off and past alarms last", async () => {
    const { element } = await mount(<AlarmTool />, "alarm", {
      alarms: [
        alarm({ id: "past", name: "Past", at: iso(9) }),
        alarm({ id: "off", name: "Off", at: iso(11), active: false }),
        alarm({ id: "noon", name: "Noon" }),
        alarm({ id: "tue", name: "Tuesday", at: iso(8), weekdays: [2] }),
        alarm({ id: "soon", name: "Soon", at: iso(10, 30) }),
      ],
    });
    expect(shown(element)).toEqual(["Soon", "Noon", "Tuesday", "Past", "Off"]);
  });
  it("keeps an alarm in place while its date is edited and re-sorts once the field is left", async () => {
    const { element, getDoc } = await mount(<AlarmTool />, "alarm", {
      alarms: [
        alarm({ id: "soon", name: "Soon", at: iso(10, 30) }),
        alarm({ id: "noon", name: "Noon" }),
      ],
    });
    const date = fields(element, "Date and time (device timezone)")[0];
    await act(() => date.focus());
    // Moved to 13:00, after the alarm at noon.
    await type(date, "2026-11-09T13:00");
    expect((getDoc().data.alarms as Alarm[])[0].at).toBe(iso(13));
    expect(shown(element)).toEqual(["Soon", "Noon"]);
    await act(async () => {
      date.blur();
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(shown(element)).toEqual(["Noon", "Soon"]);
  });
  it("snoozes an alarm that just rang, as a one-off that can be cancelled", async () => {
    const { element, getDoc } = await mount(<AlarmTool />, "alarm", {
      alarms: [
        alarm({ id: "rang", name: "Rang", at: iso(10) }),
        alarm({ id: "old", name: "Old", at: iso(9) }),
      ],
    });
    const first = () => (getDoc().data.alarms as Alarm[])[0];
    // Only the alarm from three minutes ago can be snoozed.
    expect(element.querySelectorAll('[aria-label="Snooze 5 min"]')).toHaveLength(
      1
    );
    expect(button(element, "10 min")).toBeTruthy();
    await act(() => button(element, "Snooze 5 min").click());
    expect(first().snoozeUntil).toBe(new Date(START + 300000).toISOString());
    expect(first().at).toBe(iso(10));
    expect(element.textContent).toContain("(snoozed)");
    expect(element.querySelector('[aria-label="Snooze 5 min"]')).toBeNull();
    await act(() => button(element, "Cancel snooze").click());
    expect(first().snoozeUntil).toBeUndefined();
    expect(element.textContent).toContain("This alarm has passed.");
  });
  it("clears every past one-off alarm in one action and restores them on undo", async () => {
    setDeviceEnabled("owner", "past-2", true);
    const { element, getDoc } = await mount(<AlarmTool />, "alarm", {
      alarms: [
        alarm({ id: "past-1", name: "Past 1", at: iso(9) }),
        alarm({ id: "future", name: "Future" }),
        alarm({ id: "weekly", name: "Weekly", at: iso(8), weekdays: [1] }),
        alarm({ id: "past-2", name: "Past 2", at: iso(7), active: false }),
      ],
    });
    await act(() => button(element, "Clear past alarms (2)").click());
    expect(stored(getDoc())).toEqual(["future", "weekly"]);
    expect(notifies("past-2")).toBe(false);
    expect(
      [...element.querySelectorAll("button")].some((b) =>
        b.textContent?.startsWith("Clear past alarms")
      )
    ).toBe(false);
    await act(() => button(element, "Undo").click());
    expect(stored(getDoc())).toEqual(["past-1", "future", "weekly", "past-2"]);
    expect(notifies("past-2")).toBe(true);
  });
  it("deletes one alarm with undo and adds a new one an hour ahead on the minute", async () => {
    const { element, getDoc } = await mount(<AlarmTool />, "alarm", {
      alarms: [alarm({ id: "a", name: "A" }), alarm({ id: "b", name: "B" })],
    });
    await act(() => labelled(element, "Delete A").click());
    expect(stored(getDoc())).toEqual(["b"]);
    await act(() => button(element, "Undo").click());
    expect(stored(getDoc())).toEqual(["a", "b"]);
    vi.setSystemTime(START + 42000);
    await act(async () => button(element, "Add alarm").click());
    const added = (getDoc().data.alarms as Alarm[])[2];
    expect(added.at).toBe(new Date(2026, 10, 9, 11, 3, 0).toISOString());
    expect(added).toMatchObject({ weekdays: [], active: true });
    expect(notifies(added.id)).toBe(true);
    // 11:03 comes before the two alarms at noon.
    expect(shown(element)[0]).toBe("Alarm");
  });
});
