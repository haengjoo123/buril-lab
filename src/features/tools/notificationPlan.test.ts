import { describe, expect, it } from "vitest";
import {
  LATE_MS,
  MISSED_LIMIT,
  catchUpFrom,
  diffScheduled,
  dueBetween,
  planLabels,
  planToolNotifications,
  scheduleKey,
  scheduleSignature,
  splitDue,
  withinBudget,
  type PlanSource,
  type PlannedNotification,
} from "./notificationPlan";

const labels = planLabels((ko) => ko);
const MINUTE = 60_000,
  HOUR = 3_600_000,
  DAY = 86_400_000;
// Times are written in the machine's own zone (alarms ring by the device
// clock), on dates with no daylight-saving change anywhere near them.
// 9 November 2026 is a Monday.
const local = (day: number, hour: number, minute = 0) =>
  +new Date(2026, 10, day, hour, minute);
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const doc = (
  tool_id: string,
  data: Record<string, unknown>,
  more: Partial<PlanSource["doc"]> & { draft?: boolean } = {}
): PlanSource => {
  const { draft, ...rest } = more;
  return {
    doc: { id: `${tool_id}-doc`, tool_id, title: "Document", data, ...rest },
    draft,
  };
};
const clock = (id: string, more: Record<string, unknown>) => ({
  id,
  name: id,
  color: "#2563eb",
  duration: 600000,
  remaining: 600000,
  end: null,
  running: false,
  elapsed: 0,
  started: null,
  ...more,
});
const entry = (
  key: string,
  at: number,
  more: Partial<PlannedNotification> = {}
): PlannedNotification => ({
  key,
  source: key,
  title: key,
  body: "타이머 종료",
  at,
  tool: "timer",
  path: "/app/tools/timer",
  ...more,
});

describe("tool notification plan", () => {
  it("plans a timer only while it is running and switched on for this device", () => {
    const now = local(10, 12);
    const sources = [
      doc("timer", {
        clocks: [
          clock("incubation", { running: true, end: now + 10 * MINUTE }),
          clock("not-on-this-device", { running: true, end: now + MINUTE }),
          clock("paused", { remaining: 30000 }),
          clock("already-over", { running: true, end: now - 1000 }),
        ],
      }),
      doc(
        "timer",
        { clocks: [clock("in-trash", { running: true, end: now + MINUTE })] },
        { id: "trashed", deleted_at: "2026-11-09T00:00:00.000Z" }
      ),
      // A stopwatch runs without an end and never alerts.
      doc("stopwatch", {
        clocks: [clock("lap", { running: true, started: now - 5000 })],
      }),
    ];
    const enabled = new Set([
      "incubation",
      "paused",
      "already-over",
      "in-trash",
      "lap",
    ]);
    expect(planToolNotifications(sources, enabled, now, labels)).toEqual([
      {
        key: `incubation:${now + 10 * MINUTE}`,
        source: "incubation",
        title: "incubation",
        body: "타이머 종료",
        at: now + 10 * MINUTE,
        tool: "timer",
        path: "/app/tools/timer",
      },
    ]);
    expect(planToolNotifications(sources, new Set(), now, labels)).toEqual([]);
  });

  it("gives a weekly alarm one entry per chosen weekday, each at its next time", () => {
    const alarm = {
      id: "standup",
      name: "Stand-up",
      at: new Date(local(9, 10)).toISOString(),
      weekdays: [1, 3, 5],
      active: true,
    };
    // Tuesday noon: Wednesday the 11th, Friday the 13th, then Monday the 16th.
    const plan = planToolNotifications(
      [doc("alarm", { alarms: [alarm] })],
      new Set(["standup"]),
      local(10, 12),
      labels
    );
    expect(plan.map((item) => [item.key, item.at, item.repeat])).toEqual([
      [
        `standup:3:${local(11, 10)}`,
        local(11, 10),
        { weekday: 4, hour: 10, minute: 0, second: 0 },
      ],
      [
        `standup:5:${local(13, 10)}`,
        local(13, 10),
        { weekday: 6, hour: 10, minute: 0, second: 0 },
      ],
      [
        `standup:1:${local(16, 10)}`,
        local(16, 10),
        { weekday: 2, hour: 10, minute: 0, second: 0 },
      ],
    ]);
    expect(plan[0]).toMatchObject({
      title: "Stand-up",
      body: "알람",
      tool: "alarm",
      path: "/app/tools/alarm",
    });
  });

  it("plans a one-off alarm once, and nothing for one that is past, off or not switched on here", () => {
    const alarm = (id: string, at: number, active = true) => ({
      id,
      name: id,
      at: new Date(at).toISOString(),
      weekdays: [],
      active,
    });
    const plan = planToolNotifications(
      [
        doc("alarm", {
          alarms: [
            alarm("later", local(12, 9, 30)),
            alarm("past", local(10, 11)),
            alarm("off", local(12, 9), false),
            alarm("elsewhere", local(12, 9)),
          ],
        }),
      ],
      new Set(["later", "past", "off"]),
      local(10, 12),
      labels
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      key: `later:null:${local(12, 9, 30)}`,
      at: local(12, 9, 30),
    });
    expect(plan[0].repeat).toBeUndefined();
  });

  it("adds a snooze as one extra ring without moving the alarm's own times", () => {
    const snoozeUntil = local(10, 12, 5);
    const plan = planToolNotifications(
      [
        doc("alarm", {
          alarms: [
            {
              id: "a",
              name: "Feed cells",
              at: new Date(local(9, 12)).toISOString(),
              weekdays: [2],
              active: true,
              snoozeUntil: new Date(snoozeUntil).toISOString(),
            },
          ],
        }),
      ],
      new Set(["a"]),
      local(10, 12, 1),
      labels
    );
    expect(plan.map((item) => [item.key, item.body, item.repeat])).toEqual([
      [`a:snooze:${snoozeUntil}`, "다시 알림", undefined],
      // Next Tuesday at 12:00, not at the snoozed 12:05.
      [
        `a:2:${local(17, 12)}`,
        "알람",
        { weekday: 3, hour: 12, minute: 0, second: 0 },
      ],
    ]);
  });

  it("reminds of a calendar event its lead time before the start", () => {
    const start = Date.UTC(2026, 10, 20, 5);
    const event = {
      id: "seminar",
      title: "Seminar",
      start: new Date(start).toISOString(),
      end: new Date(start + HOUR).toISOString(),
      timezone: "Asia/Seoul",
      repeat: "none",
      exceptions: [],
      reminderMinutes: 10,
    };
    const sources = [doc("calendar", { events: [event] })];
    const enabled = new Set(["seminar"]);
    const at = start - 10 * MINUTE;
    expect(
      planToolNotifications(sources, enabled, at - 1, labels, "Asia/Seoul")
    ).toEqual([
      {
        key: `seminar:${at}`,
        source: "seminar",
        title: "Seminar",
        body: "일정 10분 전",
        at,
        tool: "calendar",
        path: "/app/tools/calendar",
      },
    ]);
    // Once the reminder time has come there is nothing left to plan, even
    // though the event itself has not started.
    expect(
      planToolNotifications(sources, enabled, at, labels, "Asia/Seoul")
    ).toEqual([]);
    // No lead: at the start itself.
    const atStart = planToolNotifications(
      [doc("calendar", { events: [{ ...event, reminderMinutes: 0 }] })],
      enabled,
      start - DAY,
      labels,
      "Asia/Seoul"
    );
    expect(atStart.map((item) => [item.at, item.body])).toEqual([
      [start, "일정 시작"],
    ]);
    // An event that ends before it starts is the editor's to report.
    expect(
      planToolNotifications(
        [doc("calendar", { events: [{ ...event, end: event.start }] })],
        enabled,
        at - 1,
        labels,
        "Asia/Seoul"
      )
    ).toEqual([]);
  });

  it("lets the system repeat a calendar series only once it has begun and has no gaps", () => {
    const weekly = (start: number, more: Record<string, unknown> = {}) => ({
      id: "journal-club",
      title: "Journal club",
      start: new Date(start).toISOString(),
      end: new Date(start + HOUR).toISOString(),
      timezone: zone,
      repeat: "weekly",
      exceptions: [],
      reminderMinutes: 30,
      ...more,
    });
    const plan = (event: unknown, from: number) =>
      planToolNotifications(
        [doc("calendar", { events: [event] })],
        new Set(["journal-club"]),
        from,
        labels,
        zone
      ).map((item) => [item.at, item.repeat]);
    // Mondays at 14:00 since the 2nd; on Tuesday the 10th the next reminder is
    // Monday the 16th at 13:30, and the system repeats it weekly from there.
    expect(plan(weekly(local(2, 14)), local(10, 12))).toEqual([
      [local(16, 13, 30), { weekday: 2, hour: 13, minute: 30, second: 0 }],
    ]);
    // First held on the 23rd: a weekly repeat would already ring on the 16th,
    // so each occurrence in the next 31 days is planned on its own.
    expect(plan(weekly(local(23, 14)), local(10, 12))).toEqual([
      [local(23, 13, 30), undefined],
      [local(30, 13, 30), undefined],
      [+new Date(2026, 11, 7, 13, 30), undefined],
    ]);
    // A skipped week, likewise.
    const skipped = new Date(local(16, 14)).toISOString();
    expect(
      plan(weekly(local(2, 14), { exceptions: [skipped] }), local(10, 12))
    ).toEqual([
      [local(23, 13, 30), undefined],
      [local(30, 13, 30), undefined],
      [+new Date(2026, 11, 7, 13, 30), undefined],
    ]);
    // Kept in another time zone, the device's wall clock is not the event's.
    const elsewhere =
      zone === "Pacific/Kiritimati" ? "UTC" : "Pacific/Kiritimati";
    const abroad = plan(
      weekly(local(2, 14), { timezone: elsewhere }),
      local(10, 12)
    );
    expect(abroad.length).toBeGreaterThan(1);
    for (const [, repeat] of abroad) expect(repeat).toBeUndefined();
  });

  it("opens a culture timer on its saved work, or on the tool for a draft", () => {
    const end = local(12, 9);
    const culture = (more: Partial<PlanSource["doc"]> & { draft?: boolean }) =>
      planToolNotifications(
        [doc("cell-culture", { timer: { id: "t", end } }, more)],
        new Set(["t"]),
        local(10, 12),
        labels
      );
    expect(culture({ id: "hela", title: "HeLa P12" })).toEqual([
      {
        key: `t:${end}`,
        source: "t",
        title: "HeLa P12",
        body: "세포 배양 타이머",
        at: end,
        tool: "cell-culture",
        path: "/app/tools/cell-culture/hela",
      },
    ]);
    expect(culture({ id: "draft", draft: true })[0].path).toBe(
      "/app/tools/cell-culture"
    );
    expect(
      planToolNotifications(
        [
          doc("cell-culture", {
            _workspace: true,
            timer: { id: "t", end },
          }),
        ],
        new Set(["t"]),
        local(10, 12),
        labels
      )[0].path
    ).toBe("/app/tools/cell-culture");
    // No timer set, or one that is not switched on for this device.
    expect(
      planToolNotifications(
        [doc("cell-culture", { timer: null })],
        new Set(["t"]),
        local(10, 12),
        labels
      )
    ).toEqual([]);
    expect(culture({ id: "hela" }).length).toBe(1);
    expect(
      planToolNotifications(
        [doc("cell-culture", { timer: { id: "t", end } })],
        new Set(),
        local(10, 12),
        labels
      )
    ).toEqual([]);
  });

  it("returns the plan soonest first and survives documents with unexpected data", () => {
    const now = local(10, 12);
    const plan = planToolNotifications(
      [
        doc("timer", { clocks: "not a list" }),
        doc("alarm", {
          alarms: [
            null,
            { id: "broken", at: "nonsense", weekdays: [1], active: true },
          ],
        }),
        doc("calendar", {}),
        doc("cell-culture", { timer: { id: 7, end: "soon" } }),
        doc("timer", {
          clocks: [
            clock("second", { running: true, end: now + 2 * MINUTE }),
            clock("first", { running: true, end: now + MINUTE }),
            clock("", { running: true, end: now + 3 * MINUTE, name: "  " }),
          ],
        }),
      ],
      new Set(["broken", "first", "second", ""]),
      now,
      labels
    );
    expect(plan.map((item) => item.title)).toEqual([
      "first",
      "second",
      // A blank name falls back to what the alert is.
      "타이머 종료",
    ]);
  });

  it("describes each kind of alert in the app language", () => {
    const english = planLabels((_ko, en) => en);
    expect(labels.event(10)).toBe("일정 10분 전");
    expect(english.event(10)).toBe("Event in 10 min");
    expect(labels.event(90)).toBe("일정 1시간 30분 전");
    expect(english.event(90)).toBe("Event in 1 h 30 min");
    expect(labels.event(1440)).toBe("일정 1일 전");
    expect(english.event(2880)).toBe("Event in 2 days");
    expect(english.event(0)).toBe("Event starting");
    expect([english.timer, english.alarm, english.culture]).toEqual([
      "Timer finished",
      "Alarm",
      "Cell culture timer",
    ]);
  });
});

describe("what is due", () => {
  const plan = [entry("a", 1000), entry("b", 2000), entry("c", 3000)];
  const keys = (list: PlannedNotification[]) => list.map((item) => item.key);

  it("takes what came due after the previous check, up to and including now", () => {
    expect(keys(dueBetween(plan, 1000, 2000))).toEqual(["b"]);
    expect(keys(dueBetween(plan, 999, 1000))).toEqual(["a"]);
    expect(keys(dueBetween(plan, 1000, 1999))).toEqual([]);
    expect(keys(dueBetween(plan, 0, 3000))).toEqual(["a", "b", "c"]);
  });

  it("alerts everything once and nothing twice over consecutive checks", () => {
    const seen: string[] = [];
    let previous = 0;
    for (const now of [500, 1000, 1000, 2500, 2999, 3000, 9000]) {
      seen.push(...keys(dueBetween(plan, previous, now)));
      previous = now;
    }
    expect(seen).toEqual(["a", "b", "c"]);
  });
});

describe("missed alerts", () => {
  const now = local(10, 12);

  it("looks back to the last check, but no more than a day and never ahead", () => {
    expect(catchUpFrom(now - HOUR, now)).toBe(now - HOUR);
    expect(catchUpFrom(now - 3 * DAY, now)).toBe(now - DAY);
    // The clock was set back since the last check.
    expect(catchUpFrom(now + 5 * MINUTE, now)).toBe(now);
  });

  it("reports what came due while the app was closed, within the last day", () => {
    const sources = [
      doc("timer", {
        clocks: [
          clock("two-days-ago", { running: true, end: now - 2 * DAY }),
          clock("last-night", { running: true, end: now - 14 * HOUR }),
          clock("this-morning", { running: true, end: now - 3 * HOUR }),
          clock("still-running", { running: true, end: now + HOUR }),
        ],
      }),
    ];
    const enabled = new Set([
      "two-days-ago",
      "last-night",
      "this-morning",
      "still-running",
    ]);
    // Last open three days ago; opened again now.
    const from = catchUpFrom(now - 3 * DAY, now);
    const due = dueBetween(
      planToolNotifications(sources, enabled, from, labels),
      from,
      now
    );
    const { live, missed } = splitDue(due, now, now);
    expect(live).toEqual([]);
    expect(missed.map((item) => item.source)).toEqual([
      "this-morning",
      "last-night",
    ]);
    // Last open an hour ago: nothing came due since.
    const recent = catchUpFrom(now - HOUR, now);
    expect(
      dueBetween(
        planToolNotifications(sources, enabled, recent, labels),
        recent,
        now
      )
    ).toEqual([]);
  });

  it("keeps the latest few missed alerts, and sounds only what is due now", () => {
    const startedAt = now - 10 * MINUTE;
    const before = Array.from({ length: 12 }, (_, index) =>
      entry(`old-${index}`, startedAt - (index + 1) * HOUR)
    );
    const { live, missed } = splitDue(
      [
        ...before,
        entry("at-start", startedAt),
        entry("slept-through", now - LATE_MS - 1),
        entry("just-late", now - LATE_MS),
        entry("now", now),
      ],
      now,
      startedAt
    );
    expect(live.map((item) => item.key)).toEqual(["just-late", "now"]);
    expect(missed).toHaveLength(MISSED_LIMIT);
    expect(missed.map((item) => item.key)).toEqual([
      "slept-through",
      "at-start",
      "old-0",
      "old-1",
      "old-2",
      "old-3",
      "old-4",
      "old-5",
      "old-6",
      "old-7",
    ]);
  });
});

describe("system schedule", () => {
  it("works out what to keep, cancel and add", () => {
    expect(
      diffScheduled(
        [
          { id: 1, signature: "a" },
          { id: 2, signature: "b" },
          { id: 3, signature: "c" },
        ],
        [
          { id: 1, signature: "a" },
          { id: 2, signature: "renamed" },
          { id: 4, signature: "d" },
        ]
      )
    ).toEqual({ keep: [1], cancel: [3], add: [2, 4] });
    expect(diffScheduled([{ id: 1, signature: "a" }], [])).toEqual({
      keep: [],
      cancel: [1],
      add: [],
    });
    expect(diffScheduled([], [{ id: 9, signature: "x" }])).toEqual({
      keep: [],
      cancel: [],
      add: [9],
    });
    // Nothing changed: nothing is touched.
    const same = [
      { id: 5, signature: "s" },
      { id: 6, signature: "t" },
    ];
    expect(diffScheduled(same, same)).toEqual({
      keep: [5, 6],
      cancel: [],
      add: [],
    });
  });

  it("keeps one system notification for a repeating alarm across its occurrences", () => {
    const alarm = {
      id: "a",
      name: "Stand-up",
      at: new Date(local(9, 10)).toISOString(),
      weekdays: [1],
      active: true,
    };
    const planAt = (from: number, name = alarm.name) =>
      planToolNotifications(
        [doc("alarm", { alarms: [{ ...alarm, name }] })],
        new Set(["a"]),
        from,
        labels
      )[0];
    const first = planAt(local(10, 12)),
      second = planAt(local(16, 10));
    // Two occurrences, a week apart...
    expect([first.at, second.at]).toEqual([local(16, 10), local(23, 10)]);
    expect(first.key).not.toBe(second.key);
    // ...are the same notification to the system, with the same content.
    expect(scheduleKey(second)).toBe(scheduleKey(first));
    expect(scheduleSignature(second, "exact")).toBe(
      scheduleSignature(first, "exact")
    );
    // A new name or a change in how it is delivered schedules it again.
    const renamed = planAt(local(10, 12), "Lab meeting");
    expect(scheduleKey(renamed)).toBe(scheduleKey(first));
    expect(scheduleSignature(renamed, "exact")).not.toBe(
      scheduleSignature(first, "exact")
    );
    expect(scheduleSignature(first, "inexact")).not.toBe(
      scheduleSignature(first, "exact")
    );
    // Something that rings once is its own notification each time.
    const timer = entry("t:1000", 1000);
    expect(scheduleKey(timer)).toBe("t:1000");
    expect(scheduleSignature(entry("t:2000", 2000), "exact")).not.toBe(
      scheduleSignature(timer, "exact")
    );
  });

  it("prefers timers, alarms and anything due within a day when the system keeps only so many", () => {
    const now = local(10, 12);
    const calendar = (key: string, at: number) =>
      entry(key, at, { tool: "calendar", path: "/app/tools/calendar" });
    const plan = [
      entry("timer-1h", now + HOUR),
      calendar("event-3h", now + 3 * HOUR),
      entry("timer-5h", now + 5 * HOUR),
      calendar("event-2d", now + 2 * DAY),
      calendar("event-3d", now + 3 * DAY),
      entry("alarm-6d", now + 6 * DAY, { tool: "alarm" }),
      entry("culture-8d", now + 8 * DAY, { tool: "cell-culture" }),
      calendar("event-10d", now + 10 * DAY),
    ];
    const keys = (budget: number) =>
      withinBudget(plan, now, budget).map((item) => item.key);
    // Room for five: the far calendar reminders are the ones left out, though
    // two of them come before the alarm and the culture timer.
    expect(keys(5)).toEqual([
      "timer-1h",
      "event-3h",
      "timer-5h",
      "alarm-6d",
      "culture-8d",
    ]);
    // More room: they come back in, soonest first.
    expect(keys(6)).toEqual([
      "timer-1h",
      "event-3h",
      "timer-5h",
      "event-2d",
      "alarm-6d",
      "culture-8d",
    ]);
    // Less: the soonest of the preferred ones.
    expect(keys(2)).toEqual(["timer-1h", "event-3h"]);
    expect(keys(0)).toEqual([]);
    expect(keys(99)).toEqual(plan.map((item) => item.key));
  });
});
