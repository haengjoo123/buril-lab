// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolContext } from "./ui";
import type { ToolDocument } from "./registry";
import type { ToolRepository } from "./repository";
import ToolsRuntime from "./ToolsRuntime";
import DeviceToggle from "./DeviceToggle";

type Item = { doc: ToolDocument; generation: number; draft?: boolean };
const repo = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    owner: "owner",
    items: [] as unknown[],
    ready: true,
    hydrated: true,
    listeners,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    sync: vi.fn(async () => {}),
    flush: vi.fn(async () => {}),
  };
});
vi.mock("./repository", () => ({ getToolRepository: () => repo }));
const locale = vi.hoisted(() => ({ language: "en" }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: locale, t: (s: string) => s }),
}));
type Held = {
  id: number;
  title: string;
  body: string;
  extra: { path: string };
};
type Tap = (action: {
  actionId: string;
  notification: { extra?: unknown };
}) => void;
/** The phone the app runs on, for the tests of the native apps. */
const phone = vi.hoisted(() => ({
  native: false,
  display: "granted",
  held: [] as unknown[],
  taps: [] as unknown[],
  channels: [] as string[],
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => phone.native,
    getPlatform: () => (phone.native ? "android" : "web"),
  },
}));
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    checkPermissions: async () => ({ display: phone.display }),
    checkExactNotificationSetting: async () => ({ exact_alarm: "granted" }),
    createChannel: async (channel: { name: string }) => {
      phone.channels.push(channel.name);
    },
    getAll: async () => ({ notifications: [...phone.held] }),
    getPending: async () => ({ notifications: [...phone.held] }),
    cancel: async ({ notifications }: { notifications: { id: number }[] }) => {
      const ids = notifications.map((entry) => entry.id);
      phone.held = (phone.held as Held[]).filter(
        (entry) => !ids.includes(entry.id)
      );
    },
    schedule: async ({ notifications }: { notifications: Held[] }) => {
      const ids = notifications.map((entry) => entry.id);
      phone.held = [
        ...(phone.held as Held[]).filter((entry) => !ids.includes(entry.id)),
        ...notifications,
      ];
      return { notifications: [] };
    },
    addListener: async (_event: string, listener: Tap) => {
      phone.taps.push(listener);
      return {
        remove: async () => {
          phone.taps = phone.taps.filter((entry) => entry !== listener);
        },
      };
    },
  },
}));
vi.mock("../../locales/i18n", () => ({
  default: { language: "en", t: (s: string) => s },
}));
vi.mock("../../services/supabaseClient", () => ({ supabase: {} }));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// 10 November 2026, 12:00 on this machine.
const T0 = +new Date(2026, 10, 10, 12);
const SECOND = 1000,
  HOUR = 3_600_000;
let version = 0;
const timers = (...clocks: [name: string, end: number, title?: string][]) => {
  version++;
  const item: Item = {
    doc: {
      id: "timer-doc",
      owner_id: "owner",
      tool_id: "timer",
      title: "Timer",
      data: {
        _workspace: true,
        clocks: clocks.map(([name, end, title]) => ({
          id: name,
          name: title ?? name,
          color: "#2563eb",
          duration: 60000,
          remaining: 60000,
          end,
          running: true,
          elapsed: 0,
          started: end - 60000,
        })),
      },
      schema_version: 1,
      engine_version: "1",
      revision: version,
      updated_at: `v${version}`,
    },
    generation: version,
  };
  repo.items = [item];
  localStorage.setItem(
    "buril-tools-notifications:owner",
    JSON.stringify(clocks.map(([name]) => name))
  );
};
/** What the fake audio output was asked to play. */
let beeps = 0;
class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  resume = async () => {
    this.state = "running";
  };
  suspend = async () => {
    this.state = "suspended";
  };
  createOscillator() {
    beeps++;
    return {
      type: "",
      frequency: { value: 0 },
      connect: () => {},
      start: () => {},
      stop: () => {},
    };
  }
  createGain() {
    return {
      gain: {
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      },
      connect: () => {},
    };
  }
}

let root: Root | null = null,
  host: HTMLElement,
  path = "";
function Probe() {
  const { pathname } = useLocation();
  useEffect(() => {
    path = pathname;
  }, [pathname]);
  return null;
}
const render = () =>
  act(async () =>
    root!.render(
      <MemoryRouter initialEntries={["/app/search"]}>
        <Probe />
        <ToolsRuntime ownerId="owner" />
      </MemoryRouter>
    )
  );
async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await render();
  // The first check runs right after mounting.
  await pass(0);
}
async function unmount() {
  if (root) await act(() => root!.unmount());
  root = null;
  host?.remove();
}
const pass = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
/** The repository reports a change; the runtime takes it up after a pause. */
async function changed() {
  await act(async () => repo.listeners.forEach((listener) => listener()));
  await pass(300);
}
const alerts = () => [...host.querySelectorAll(".tool-notification")];
/**
 * How often the runtime has checked for due alerts: each check reads the
 * list of things switched on for this device exactly once more.
 */
function countChecks() {
  const reads = vi.spyOn(Storage.prototype, "getItem");
  return () =>
    reads.mock.calls.filter(
      ([key]) => key === "buril-tools-notifications:owner"
    ).length;
}
const button = (label: string) =>
  [...host.querySelectorAll("button")].find(
    (element) => element.textContent === label
  )!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
  repo.items = [];
  repo.hydrated = true;
  repo.listeners.clear();
  locale.language = "en";
  Object.assign(phone, {
    native: false,
    display: "granted",
    held: [],
    taps: [],
    channels: [],
  });
  beeps = 0;
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});
afterEach(async () => {
  await unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("tool alerts on the web", () => {
  it("sleeps until the next alert, shows it with a sound, then stops", async () => {
    const checks = countChecks();
    timers(["PCR", T0 + 90 * SECOND]);
    await mount();
    await pass(89 * SECOND);
    expect(alerts()).toHaveLength(0);
    await pass(SECOND);
    expect(alerts()).toHaveLength(1);
    const alert = alerts()[0];
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("PCR");
    expect(alert.textContent).toContain("Timer finished");
    expect(alert.querySelector("time")?.getAttribute("dateTime")).toBe(
      new Date(T0 + 90 * SECOND).toISOString()
    );
    expect(alert.textContent).not.toContain("Missed");
    await pass(200);
    expect(beeps).toBe(6);
    // Nothing left to wait for: it does not wake again.
    const done = checks();
    await pass(30 * 60 * SECOND);
    expect(checks()).toBe(done);
    // "Open" goes to the tool and takes the alert away.
    const link = alert.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/app/tools/timer");
    await act(async () => link.click());
    expect(path).toBe("/app/tools/timer");
    expect(host.querySelector(".tool-notifications")).toBeNull();
  });

  it("wakes at most a minute apart while waiting, and not at all with nothing planned", async () => {
    const checks = countChecks();
    await mount();
    const idle = checks();
    await pass(30 * 60 * SECOND);
    expect(checks()).toBe(idle);
    // A timer is started, an hour long.
    const end = Date.now() + 60 * 60 * SECOND;
    timers(["Gel", end]);
    await changed();
    const started = checks();
    await pass(5 * 60 * SECOND);
    expect(checks() - started).toBe(5);
    // The computer sleeps through most of the rest. The next wake-up, a
    // minute at most after it resumes, finds the timer just over.
    vi.setSystemTime(end - 500);
    await pass(60 * SECOND);
    expect(alerts()).toHaveLength(1);
    // Under a minute late still counts as ringing now.
    expect(alerts()[0].textContent).not.toContain("Missed");
    await pass(200);
    expect(beeps).toBe(6);
  });

  it("does not ring again, or spin, when the clock is set back past an alert", async () => {
    const checks = countChecks();
    timers(["PCR", T0 + 5 * SECOND]);
    await mount();
    await pass(6 * SECOND);
    expect(alerts()).toHaveLength(1);
    await act(async () => button("Dismiss").click());
    // The clock goes back a minute; the timer's end comes round once more.
    vi.setSystemTime(T0 - 54 * SECOND);
    await act(async () => window.dispatchEvent(new Event("focus")));
    const before = checks();
    await pass(10 * 60 * SECOND);
    expect(host.querySelector(".tool-notifications")).toBeNull();
    expect(beeps).toBe(6);
    // It woke for the end, found it already rung, and went back to sleep.
    expect(checks() - before).toBeLessThan(5);
  });

  it("does not report something created for a time already past", async () => {
    // Nothing is planned for two hours, so nothing is checked either.
    await mount();
    await pass(2 * HOUR);
    // An entry is typed in with a time ten minutes ago, and one just ahead.
    const now = Date.now();
    timers(["Backdated", now - 10 * 60 * SECOND], ["Soon", now + 5 * SECOND]);
    await changed();
    expect(host.querySelector(".tool-notifications")).toBeNull();
    await pass(5 * SECOND);
    expect(alerts().map((alert) => alert.textContent)).toEqual([
      expect.stringContaining("Soon"),
    ]);
  });

  it("does not ring for a timer stopped a moment before its end", async () => {
    timers(["Stopped", T0 + 5 * SECOND], ["Renamed", T0 + 5 * SECOND]);
    await mount();
    await pass(4900);
    // One is deleted and the other renamed; the runtime has not yet taken
    // the change up when their time comes.
    timers(["Renamed", T0 + 5 * SECOND, "Gel run"]);
    await act(async () => repo.listeners.forEach((listener) => listener()));
    await pass(100);
    expect(alerts().map((alert) => alert.textContent)).toEqual([
      expect.stringContaining("Gel run"),
    ]);
    await pass(SECOND);
    expect(alerts()).toHaveLength(1);
  });

  it("shows several alerts at once, three of them in view", async () => {
    timers(
      ["A", T0 + SECOND],
      ["B", T0 + SECOND],
      ["C", T0 + 2 * SECOND],
      ["D", T0 + 2 * SECOND],
      ["E", T0 + 3 * SECOND]
    );
    await mount();
    await pass(3 * SECOND);
    expect(alerts()).toHaveLength(3);
    // Newest first.
    expect(alerts()[0].textContent).toContain("E");
    expect(host.textContent).toContain("+2 more");
    await act(async () => button("Dismiss").click());
    expect(alerts()).toHaveLength(3);
    expect(host.textContent).toContain("+1 more");
    expect(
      alerts()[0].querySelector("button")?.getAttribute("aria-label")
    ).toMatch(/^Dismiss [A-E]$/);
    await act(async () => button("Dismiss all").click());
    expect(host.querySelector(".tool-notifications")).toBeNull();
  });

  it("reports what came due while the app was closed as missed, silently and once", async () => {
    localStorage.setItem("buril-tools-last-seen:owner", String(T0 - 2 * HOUR));
    timers(
      ["Overnight", T0 - 30 * HOUR],
      ["Before lunch", T0 - 3 * HOUR],
      ["Incubation", T0 - HOUR]
    );
    await mount();
    await pass(300);
    // "Before lunch" rang while the app was still open three hours ago.
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0].className).toContain("missed");
    expect(alerts()[0].textContent).toContain("Missed");
    expect(alerts()[0].textContent).toContain("Incubation");
    expect(beeps).toBe(0);
    expect(localStorage.getItem("buril-tools-last-seen:owner")).toBe(
      String(T0)
    );
    // Opened again later: it is not reported a second time.
    await unmount();
    vi.setSystemTime(T0 + 5 * 60 * SECOND);
    await mount();
    await pass(300);
    expect(host.querySelector(".tool-notifications")).toBeNull();
  });

  it("looks back one day at most after a long absence", async () => {
    localStorage.setItem(
      "buril-tools-last-seen:owner",
      String(T0 - 5 * 24 * HOUR)
    );
    timers(["Three days ago", T0 - 72 * HOUR], ["Last night", T0 - 15 * HOUR]);
    await mount();
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0].textContent).toContain("Last night");
  });

  it("waits for the account's documents before deciding what was missed", async () => {
    localStorage.setItem("buril-tools-last-seen:owner", String(T0 - HOUR));
    repo.hydrated = false;
    await mount();
    await pass(5 * SECOND);
    expect(host.querySelector(".tool-notifications")).toBeNull();
    // The documents arrive; one timer ended while the app was closed and one
    // just now, during the wait.
    timers(["Earlier", T0 - 20 * 60 * SECOND], ["Just now", T0 + 2 * SECOND]);
    repo.hydrated = true;
    await changed();
    await pass(200);
    expect(alerts().map((alert) => alert.className)).toEqual([
      "tool-notification",
      "tool-notification missed",
    ]);
    expect(beeps).toBe(6);
  });

  it("leaves the noise to the tab that claimed the alert first", async () => {
    const end = T0 + 5 * SECOND;
    timers(["PCR", end]);
    await mount();
    localStorage.setItem(
      "buril-tools-alert-claims:owner",
      JSON.stringify({ [`PCR:${end}`]: ["another-tab", end] })
    );
    await pass(6 * SECOND);
    expect(alerts()).toHaveLength(1);
    expect(beeps).toBe(0);
  });

  it("stays quiet when the alert sound is switched off on this device", async () => {
    localStorage.setItem("buril-tools-alert-sound", "off");
    timers(["PCR", T0 + SECOND]);
    await mount();
    await pass(2 * SECOND);
    expect(alerts()).toHaveLength(1);
    expect(beeps).toBe(0);
  });

  it("also raises a browser notification when the page is not being looked at", async () => {
    const shown: {
      title: string;
      options: NotificationOptions;
      self: FakeNotification;
    }[] = [];
    class FakeNotification {
      static permission = "granted";
      onclick: (() => void) | null = null;
      close = vi.fn();
      constructor(title: string, options: NotificationOptions) {
        shown.push({ title, options, self: this });
      }
    }
    vi.stubGlobal("Notification", FakeNotification);
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    const end = T0 + SECOND;
    timers(["PCR", end]);
    await mount();
    await pass(2 * SECOND);
    expect(shown.map(({ title, options }) => [title, options])).toEqual([
      ["PCR", { body: "Timer finished", tag: `PCR:${end}` }],
    ]);
    expect(alerts()).toHaveLength(1);
    // Clicking it opens the tool.
    await act(async () => shown[0].self.onclick?.());
    expect(path).toBe("/app/tools/timer");
    expect(host.querySelector(".tool-notifications")).toBeNull();
    expect(focus).toHaveBeenCalled();
    expect(shown[0].self.close).toHaveBeenCalled();
  });

  it("keeps the alert in the page when the browser refuses the notification", async () => {
    class Refusing {
      static permission = "granted";
      constructor() {
        throw new TypeError("Illegal constructor");
      }
    }
    vi.stubGlobal("Notification", Refusing);
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    timers(["PCR", T0 + SECOND]);
    await mount();
    await pass(2 * SECOND);
    expect(alerts()).toHaveLength(1);
    expect(beeps).toBe(6);
  });

  it("does not raise one while the page is in view, or without permission", async () => {
    const created = vi.fn();
    class FakeNotification {
      static permission = "granted";
      constructor() {
        created();
      }
    }
    vi.stubGlobal("Notification", FakeNotification);
    timers(["Seen", T0 + SECOND]);
    await mount();
    await pass(2 * SECOND);
    expect(alerts()).toHaveLength(1);
    expect(created).not.toHaveBeenCalled();
    FakeNotification.permission = "denied";
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    timers(["Seen", T0 + SECOND], ["Unseen", T0 + 4 * SECOND]);
    await changed();
    await pass(3 * SECOND);
    expect(alerts()).toHaveLength(2);
    expect(created).not.toHaveBeenCalled();
  });
});

describe("tool alerts in the native apps", () => {
  const held = () =>
    (phone.held as Held[]).map((entry) => [
      entry.title,
      entry.body,
      entry.extra.path,
    ]);

  it("hands the plan to the system and shows nothing itself", async () => {
    phone.native = true;
    // The system delivered what came due while the app was closed.
    localStorage.setItem("buril-tools-last-seen:owner", String(T0 - HOUR));
    timers(["Ended", T0 - 30 * 60 * SECOND], ["PCR", T0 + 60 * SECOND]);
    await mount();
    await pass(10);
    expect(held()).toEqual([["PCR", "Timer finished", "/app/tools/timer"]]);
    expect(phone.channels.at(-1)).toBe("Lab tool alerts");
    expect(host.querySelector(".tool-notifications")).toBeNull();
    await pass(61 * SECOND);
    expect(host.querySelector(".tool-notifications")).toBeNull();
    expect(beeps).toBe(0);
    // Nothing is recorded for a later "missed" report either.
    expect(localStorage.getItem("buril-tools-last-seen:owner")).toBe(
      String(T0 - HOUR)
    );
  });

  it("schedules again in the new language when the app language changes", async () => {
    phone.native = true;
    timers(["PCR", T0 + 60 * 60 * SECOND]);
    await mount();
    await pass(10);
    expect(held()).toEqual([["PCR", "Timer finished", "/app/tools/timer"]]);
    locale.language = "ko";
    await render();
    await pass(10);
    expect(held()).toEqual([["PCR", "타이머 종료", "/app/tools/timer"]]);
    // The channel is created once and only renamed after that.
    expect(phone.channels.at(-1)).toBe("실험 도구 알림");
  });

  it("opens the tool when its notification is tapped, until it is unmounted", async () => {
    phone.native = true;
    await mount();
    await pass(10);
    expect(phone.taps).toHaveLength(1);
    const tap = (owner: string, target: string) =>
      act(async () =>
        (phone.taps as Tap[]).forEach((listener) =>
          listener({
            actionId: "tap",
            notification: {
              extra: { burilTool: true, owner, path: target },
            },
          })
        )
      );
    await tap("someone-else", "/app/tools/timer");
    expect(path).toBe("/app/search");
    await tap("owner", "/app/tools/alarm");
    expect(path).toBe("/app/tools/alarm");
    await unmount();
    await pass(10);
    expect(phone.taps).toHaveLength(0);
  });

  it("shows alerts in the app when the system may not notify", async () => {
    phone.native = true;
    phone.display = "denied";
    timers(["PCR", T0 + 60 * SECOND]);
    await mount();
    await pass(10);
    expect(held()).toEqual([]);
    await pass(60 * SECOND);
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0].textContent).toContain("PCR");
  });
});

describe("the device switch on the web", () => {
  const doc: ToolDocument = {
    id: "doc",
    owner_id: "owner",
    tool_id: "timer",
    title: "Timer",
    data: {},
    schema_version: 1,
    engine_version: "1",
    revision: 0,
    updated_at: "",
  };
  async function mountToggle() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <ToolContext.Provider
          value={{
            doc,
            repo: repo as unknown as ToolRepository,
            documents: [],
          }}
        >
          <DeviceToggle id="clock-1" />
        </ToolContext.Provider>
      )
    );
  }
  const boxes = () => [
    ...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ];

  it("switches on even when browser notifications are blocked, and says how alerts arrive", async () => {
    const request = vi.fn();
    vi.stubGlobal(
      "Notification",
      class {
        static permission = "denied";
        static requestPermission = request;
      }
    );
    await mountToggle();
    expect(boxes()).toHaveLength(1);
    expect(boxes()[0].checked).toBe(false);
    await act(async () => boxes()[0].click());
    expect(boxes()[0].checked).toBe(true);
    expect(localStorage.getItem("buril-tools-notifications:owner")).toBe(
      '["clock-1"]'
    );
    // Already answered: the browser is not asked again.
    expect(request).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain("open in a browser tab");
    expect(host.textContent).toContain("background tab");
    expect(host.textContent).toContain("Browser notifications are blocked");
    // The sound has its own switch, kept on this device.
    expect(boxes()).toHaveLength(2);
    expect(boxes()[1].checked).toBe(true);
    await act(async () => boxes()[1].click());
    expect(boxes()[1].checked).toBe(false);
    expect(localStorage.getItem("buril-tools-alert-sound")).toBe("off");
    await act(async () => boxes()[1].click());
    expect(localStorage.getItem("buril-tools-alert-sound")).toBeNull();
    // Switching it on plays it once, from the click.
    expect(beeps).toBe(6);
    await act(async () => boxes()[0].click());
    expect(boxes()).toHaveLength(1);
    expect(localStorage.getItem("buril-tools-notifications:owner")).toBe("[]");
  });

  it("asks the browser from the click without waiting for the answer", async () => {
    let answer: (value: string) => void = () => {};
    const permission = { value: "default" };
    const request = vi.fn(
      () => new Promise<string>((resolve) => (answer = resolve))
    );
    vi.stubGlobal(
      "Notification",
      class {
        static get permission() {
          return permission.value;
        }
        static requestPermission = request;
      }
    );
    await mountToggle();
    await act(async () => boxes()[0].click());
    expect(request).toHaveBeenCalledTimes(1);
    // On at once: the question may never be answered.
    expect(boxes()[0].checked).toBe(true);
    expect(host.textContent).not.toContain("Browser notifications are blocked");
    permission.value = "denied";
    await act(async () => answer("denied"));
    expect(boxes()[0].checked).toBe(true);
    expect(host.textContent).toContain("Browser notifications are blocked");
  });
});
