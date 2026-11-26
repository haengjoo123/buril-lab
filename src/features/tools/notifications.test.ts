// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlannedNotification } from "./notificationPlan";

type Stored = {
  id: number;
  title?: string;
  body?: string;
  schedule?: { at?: Date; on?: object; repeats?: boolean };
  channelId?: string;
  sound?: string;
  isExactNotification?: boolean;
  extra?: Record<string, unknown>;
};
type Tap = (action: {
  actionId: string;
  notification: { extra?: unknown };
}) => void;
/** A phone: its permissions, and the notifications its system holds. */
const device = vi.hoisted(() => ({
  native: true,
  platform: "android",
  display: "granted",
  exact: "granted",
  exactAfterSettings: "granted",
  held: [] as unknown[],
  calls: [] as string[],
  taps: [] as unknown[],
}));
const held = () => device.held as Stored[];
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => device.native,
    getPlatform: () => device.platform,
  },
}));
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    checkPermissions: async () => ({ display: device.display }),
    requestPermissions: async () => {
      device.calls.push("ask");
      return { display: device.display };
    },
    checkExactNotificationSetting: async () => ({ exact_alarm: device.exact }),
    changeExactNotificationSetting: async () => {
      device.calls.push("settings");
      device.exact = device.exactAfterSettings;
      return { exact_alarm: device.exact };
    },
    createChannel: async (channel: Record<string, unknown>) => {
      device.calls.push(
        `channel ${channel.id} "${channel.name}" importance=${channel.importance} vibration=${channel.vibration}`
      );
    },
    getAll: async () => ({ notifications: [...held()] }),
    getPending: async () => ({ notifications: [...held()] }),
    cancel: async ({ notifications }: { notifications: { id: number }[] }) => {
      const ids = notifications.map((entry) => entry.id);
      device.calls.push(`cancel ${ids.length}`);
      device.held = held().filter((entry) => !ids.includes(entry.id));
    },
    schedule: async ({ notifications }: { notifications: Stored[] }) => {
      const ids = notifications.map((entry) => entry.id);
      device.calls.push(`schedule ${ids.length}`);
      device.held = [
        ...held().filter((entry) => !ids.includes(entry.id)),
        ...notifications,
      ];
      return { notifications: ids.map((id) => ({ id })) };
    },
    addListener: async (event: string, listener: Tap) => {
      device.calls.push(`listen ${event}`);
      device.taps.push(listener);
      return {
        remove: async () => {
          device.taps = device.taps.filter((entry) => entry !== listener);
        },
      };
    },
  },
}));

const HOUR = 3_600_000;
const channel = { name: "Lab tool alerts", description: "Timers and alarms" };
const timer = (name: string, at: number): PlannedNotification => ({
  key: `${name}:${at}`,
  source: name,
  title: name,
  body: "Timer finished",
  at,
  tool: "timer",
  path: "/app/tools/timer",
});
const weekly = (name: string, at: number): PlannedNotification => ({
  key: `standup:1:${at}`,
  source: "standup",
  title: name,
  body: "Alarm",
  at,
  tool: "alarm",
  path: "/app/tools/alarm",
  repeat: { weekday: 2, hour: 10, minute: 0, second: 0 },
});
const ours = () =>
  held().filter(
    (entry) => entry.extra?.burilTool === true && entry.extra.owner === "owner"
  );
const titles = () =>
  ours()
    .map((entry) => entry.title)
    .sort();
/** A fresh copy of the module: it remembers permissions, the channel and sign-outs. */
const load = () => import("./notifications");

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  Object.assign(device, {
    native: true,
    platform: "android",
    display: "granted",
    exact: "granted",
    exactAfterSettings: "granted",
    held: [],
    calls: [],
    taps: [],
  });
});

describe("permission in the native apps", () => {
  it("treats a refused display permission as the only thing that stops an alert", async () => {
    const { enableNotifications, notificationAccess } = await load();
    device.display = "denied";
    await expect(enableNotifications()).rejects.toThrow(
      "Notification permission denied"
    );
    expect(notificationAccess()).toEqual({ display: "denied", exact: true });
    // Exact alarms refused: the alert still arrives, possibly late.
    device.display = "granted";
    device.exact = "denied";
    await expect(enableNotifications()).resolves.toEqual({
      display: "granted",
      exact: false,
    });
    // It asked for the notification permission and never sent the user to
    // the system settings on its own.
    expect(device.calls).toEqual(["ask", "ask"]);
  });

  it("opens the exact alarm setting only when asked, and reports what came of it", async () => {
    const { openExactAlarmSetting, notificationAccess } = await load();
    device.exact = "denied";
    const changed = vi.fn();
    window.addEventListener("buril:tool-notifications", changed);
    await expect(openExactAlarmSetting()).resolves.toEqual({
      display: "granted",
      exact: true,
    });
    window.removeEventListener("buril:tool-notifications", changed);
    expect(device.calls).toEqual(["settings"]);
    expect(notificationAccess()?.exact).toBe(true);
    // The runtime hears of it and schedules again with the new precision.
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("has no exact alarm setting to speak of on iOS", async () => {
    const { enableNotifications } = await load();
    device.platform = "ios";
    device.exact = "denied";
    await expect(enableNotifications()).resolves.toEqual({
      display: "granted",
      exact: true,
    });
  });
});

describe("scheduling with the system", () => {
  it("schedules into the alert channel with the tool's route, then changes only what changed", async () => {
    const { syncToolNotifications, notificationId, TOOL_CHANNEL_ID } =
      await load();
    const now = Date.now();
    // Not ours to touch: an expiry reminder and another account's timer.
    device.held = [
      { id: 1, extra: { burilReminder: true } },
      { id: 2, extra: { burilTool: true, owner: "someone-else" } },
    ];
    const pcr = timer("PCR", now + HOUR),
      standup = weekly("Stand-up", now + 2 * HOUR);
    const options = { since: now, channel };
    await expect(
      syncToolNotifications([pcr, standup], "owner", options)
    ).resolves.toEqual({ display: "granted", exact: true });
    expect(device.calls).toEqual([
      `channel ${TOOL_CHANNEL_ID} "Lab tool alerts" importance=4 vibration=true`,
      "schedule 2",
    ]);
    const scheduled = held().find((entry) => entry.title === "PCR")!;
    expect(scheduled).toMatchObject({
      id: notificationId(pcr.key),
      title: "PCR",
      body: "Timer finished",
      channelId: TOOL_CHANNEL_ID,
      isExactNotification: true,
      schedule: { at: new Date(pcr.at), allowWhileIdle: true },
      extra: {
        burilTool: true,
        owner: "owner",
        key: pcr.key,
        path: "/app/tools/timer",
      },
    });
    expect(held().find((entry) => entry.title === "Stand-up")).toMatchObject({
      body: "Alarm",
      schedule: {
        on: { weekday: 2, hour: 10, minute: 0, second: 0 },
        repeats: true,
      },
      extra: { path: "/app/tools/alarm" },
    });

    // The same plan again: nothing is cancelled, nothing is re-created.
    device.calls = [];
    await syncToolNotifications([pcr, standup], "owner", options);
    expect(device.calls).toEqual([]);

    // The weekly alarm's next occurrence is still the same notification.
    await syncToolNotifications(
      [pcr, weekly("Stand-up", now + 170 * HOUR)],
      "owner",
      options
    );
    expect(device.calls).toEqual([]);

    // PCR is stopped, a gel timer is started and the alarm is renamed.
    const gel = timer("Gel", now + 3 * HOUR);
    await syncToolNotifications(
      [gel, weekly("Lab meeting", now + 2 * HOUR)],
      "owner",
      options
    );
    expect(device.calls).toEqual(["cancel 1", "schedule 2"]);
    expect(titles()).toEqual(["Gel", "Lab meeting"]);
    expect(held().map((entry) => entry.id)).toEqual(
      expect.arrayContaining([1, 2])
    );

    // Everything switched off: only this account's are cancelled.
    device.calls = [];
    await syncToolNotifications([], "owner", options);
    expect(device.calls).toEqual(["cancel 2"]);
    expect(held().map((entry) => entry.id)).toEqual([1, 2]);
  });

  it("never asks the system for an exact alarm it may not set", async () => {
    const { syncToolNotifications } = await load();
    const now = Date.now();
    const pcr = timer("PCR", now + HOUR);
    device.exact = "denied";
    await expect(
      syncToolNotifications([pcr], "owner", { since: now, channel })
    ).resolves.toEqual({ display: "granted", exact: false });
    expect(ours()[0].isExactNotification).toBe(false);
    // Allowed later: the same alert is scheduled again, now exact.
    device.exact = "granted";
    device.calls = [];
    await syncToolNotifications([pcr], "owner", { since: now, channel });
    expect(device.calls).toEqual(["schedule 1"]);
    expect(ours()).toHaveLength(1);
    expect(ours()[0].isExactNotification).toBe(true);
  });

  it("leaves out an alert that is due this very moment", async () => {
    // The plugin fires a time that has passed at once: scheduling a timer
    // that has just rung would ring it a second time.
    const { syncToolNotifications } = await load();
    const now = Date.now();
    await syncToolNotifications(
      [timer("Ringing", now + 200), timer("Later", now + HOUR)],
      "owner",
      { since: now, channel }
    );
    expect(titles()).toEqual(["Later"]);
  });

  it("schedules nothing, and cancels nothing, without permission to notify", async () => {
    const { syncToolNotifications } = await load();
    const now = Date.now();
    device.display = "denied";
    device.held = [{ id: 7, extra: { burilTool: true, owner: "owner" } }];
    await expect(
      syncToolNotifications([timer("PCR", now + HOUR)], "owner", {
        since: now,
        channel,
      })
    ).resolves.toEqual({ display: "denied", exact: true });
    expect(device.calls).toEqual([]);
    expect(held()).toHaveLength(1);
  });

  it("gives iOS a sound and no channel", async () => {
    const { syncToolNotifications } = await load();
    const now = Date.now();
    device.platform = "ios";
    await syncToolNotifications([timer("PCR", now + HOUR)], "owner", {
      since: now,
      channel,
    });
    expect(device.calls).toEqual(["schedule 1"]);
    expect(ours()[0].sound).toBe("default");
    expect(ours()[0].channelId).toBeUndefined();
  });

  it("does nothing on the web", async () => {
    const { syncToolNotifications } = await load();
    device.native = false;
    const now = Date.now();
    await expect(
      syncToolNotifications([timer("PCR", now + HOUR)], "owner", {
        since: now,
        channel,
      })
    ).resolves.toBeNull();
    expect(device.calls).toEqual([]);
  });

  it("stops scheduling for an account once it has signed out", async () => {
    const { syncToolNotifications, cancelToolNotifications, writeLastSeen } =
      await load();
    const mounted = Date.now() - 1000,
      now = Date.now();
    const pcr = timer("PCR", now + HOUR);
    await syncToolNotifications([pcr], "owner", { since: mounted, channel });
    localStorage.setItem("buril-tools-last-seen:owner", "1");
    localStorage.setItem("buril-tools-alert-claims:owner", "{}");
    device.held.push({ id: 2, extra: { burilTool: true, owner: "other" } });
    await cancelToolNotifications("owner");
    expect(held().map((entry) => entry.id)).toEqual([2]);
    expect(localStorage.getItem("buril-tools-last-seen:owner")).toBeNull();
    expect(localStorage.getItem("buril-tools-alert-claims:owner")).toBeNull();
    // The runtime that was mounted before the sign-out is still winding down.
    await expect(
      syncToolNotifications([pcr], "owner", { since: mounted, channel })
    ).resolves.toBeNull();
    writeLastSeen("owner", now, mounted);
    expect(held().map((entry) => entry.id)).toEqual([2]);
    expect(localStorage.getItem("buril-tools-last-seen:owner")).toBeNull();
    // Signed in again: a new runtime schedules as usual.
    await syncToolNotifications([pcr], "owner", {
      since: Date.now() + 1,
      channel,
    });
    expect(titles()).toEqual(["PCR"]);
    expect(held()).toHaveLength(2);
  });
});

describe("tapping a notification", () => {
  it("opens the tool it came from, for the signed-in account only", async () => {
    const { onToolNotificationTap } = await load();
    const open = vi.fn();
    const stop = onToolNotificationTap("owner", open);
    await vi.waitFor(() => expect(device.taps).toHaveLength(1));
    const tap = (actionId: string, extra: unknown) =>
      (device.taps as Tap[]).forEach((listener) =>
        listener({ actionId, notification: { extra } })
      );
    const mine = { burilTool: true, owner: "owner" };
    tap("tap", { ...mine, path: "/app/tools/cell-culture/3f2a-77" });
    expect(open).toHaveBeenLastCalledWith("/app/tools/cell-culture/3f2a-77");
    tap("tap", { ...mine, path: "/app/tools/alarm" });
    expect(open).toHaveBeenCalledTimes(2);
    // Someone else's, an expiry reminder, a swipe, and a route that is not a tool's.
    tap("tap", { burilTool: true, owner: "other", path: "/app/tools/timer" });
    tap("tap", { burilReminder: true, path: "/app/tools/timer" });
    tap("dismiss", { ...mine, path: "/app/tools/timer" });
    tap("tap", { ...mine, path: "https://example.com/app/tools/timer" });
    tap("tap", { ...mine, path: "/app/admin" });
    tap("tap", mine);
    tap("tap", undefined);
    expect(open).toHaveBeenCalledTimes(2);
    stop();
    await vi.waitFor(() => expect(device.taps).toHaveLength(0));
  });

  it("stops listening even when stopped before the listener was in place", async () => {
    const { onToolNotificationTap } = await load();
    onToolNotificationTap("owner", vi.fn())();
    await vi.waitFor(() =>
      expect(device.calls).toEqual(["listen localNotificationActionPerformed"])
    );
    await vi.waitFor(() => expect(device.taps).toHaveLength(0));
  });
});

describe("what this device remembers", () => {
  it("keeps the things switched on for the device, per account", async () => {
    const { deviceEnabled, readDeviceEnabled, setDeviceEnabled } = await load();
    const changed = vi.fn();
    window.addEventListener("buril:tool-notifications", changed);
    expect(deviceEnabled("owner", "a")).toBe(false);
    setDeviceEnabled("owner", "a", true);
    setDeviceEnabled("owner", "b", true);
    setDeviceEnabled("owner", "a", true);
    setDeviceEnabled("other", "c", true);
    expect([...readDeviceEnabled("owner")]).toEqual(["a", "b"]);
    setDeviceEnabled("owner", "a", false);
    expect(deviceEnabled("owner", "a")).toBe(false);
    expect(deviceEnabled("owner", "b")).toBe(true);
    expect(deviceEnabled("owner", "c")).toBe(false);
    expect(localStorage.getItem("buril-tools-notifications:owner")).toBe(
      '["b"]'
    );
    expect(changed).toHaveBeenCalledTimes(5);
    window.removeEventListener("buril:tool-notifications", changed);
    // A list damaged by hand is an empty one, not an error.
    localStorage.setItem("buril-tools-notifications:owner", "{oops");
    expect(deviceEnabled("owner", "b")).toBe(false);
    localStorage.setItem("buril-tools-notifications:owner", '{"b":true}');
    expect(deviceEnabled("owner", "b")).toBe(false);
  });

  it("lets one tab make the noise for an alert", async () => {
    const first = await load();
    vi.resetModules();
    const second = await load();
    // Two tabs of the same account see the same two alerts come due.
    expect(await first.claimAlerts("owner", ["a", "b"])).toEqual(["a", "b"]);
    expect(await second.claimAlerts("owner", ["a", "b", "c"])).toEqual(["c"]);
    expect(await first.claimAlerts("owner", ["a", "c"])).toEqual([]);
    expect(await first.claimAlerts("other", ["a"])).toEqual(["a"]);
    expect(await first.claimAlerts("owner", [])).toEqual([]);
  });

  it("moves the last time alerts were checked forward only", async () => {
    const { readLastSeen, writeLastSeen } = await load();
    const now = Date.now();
    expect(readLastSeen("owner")).toBeNull();
    writeLastSeen("owner", now - 5000, now);
    expect(readLastSeen("owner")).toBe(now - 5000);
    // Another tab is behind: its older time does not replace this one.
    writeLastSeen("owner", now - 9000, now);
    expect(readLastSeen("owner")).toBe(now - 5000);
    writeLastSeen("owner", now, now);
    expect(readLastSeen("owner")).toBe(now);
    // A time from the future is a clock that was set back since.
    localStorage.setItem("buril-tools-last-seen:owner", String(now + HOUR));
    writeLastSeen("owner", now, now);
    expect(readLastSeen("owner")).toBe(now);
  });
});
