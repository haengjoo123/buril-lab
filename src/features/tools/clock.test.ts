import { describe, expect, it } from "vitest";
import {
  type Alarm,
  type Clock,
  DEFAULT_PRESETS,
  addLap,
  addPreset,
  centiseconds,
  durationFromParts,
  durationParts,
  isFinished,
  isPastOneOff,
  lapRows,
  lastAlarm,
  nextAlarm,
  nextRegularAlarm,
  overtime,
  overtimeText,
  recentDurations,
  rememberDuration,
  remainingTime,
  snoozeOffer,
  snoozeTime,
  sortAlarms,
  sortClocks,
  stopwatchText,
  timerPresets,
} from "./clock";

const MIN = 60000;
const clock = (patch: Partial<Clock>): Clock => ({
  id: "1",
  name: "Timer",
  color: "#000",
  duration: 5 * MIN,
  remaining: 5 * MIN,
  end: null,
  running: false,
  elapsed: 0,
  started: null,
  ...patch,
});

describe("countdown overtime", () => {
  // Started at 5 s for 60 s: it ends at 65 s.
  const running = clock({
    duration: MIN,
    remaining: MIN,
    running: true,
    started: 5000,
    end: 65000,
  });
  it("counts up from the moment a countdown reaches zero", () => {
    expect(isFinished(running, 64999)).toBe(false);
    expect(overtime(running, 64999)).toBe(0);
    expect(isFinished(running, 65000)).toBe(true);
    expect(overtime(running, 65000)).toBe(0);
    expect(overtime(running, 100000)).toBe(35000);
    // The remaining time does not go below zero for a finished clock.
    expect(remainingTime(running, 100000)).toBe(0);
  });
  it("is zero for a clock that is paused or was never started", () => {
    const paused = clock({ remaining: 2 * MIN, elapsed: 3 * MIN });
    expect(isFinished(paused, 10 ** 9)).toBe(false);
    expect(overtime(paused, 10 ** 9)).toBe(0);
    expect(overtime(clock({}), 10 ** 9)).toBe(0);
  });
  it("writes overtime with a plus sign, adding hours only when there are any", () => {
    expect(overtimeText(35000)).toBe("+00:35");
    expect(overtimeText(999)).toBe("+00:00");
    expect(overtimeText(59 * MIN + 59000)).toBe("+59:59");
    // 1 h 2 min 3 s
    expect(overtimeText(3723000)).toBe("+01:02:03");
  });
});

describe("timer list order", () => {
  it("puts running timers first by end time, then finished, then stopped", () => {
    const now = 1000000;
    const list = [
      clock({ id: "idle" }),
      clock({ id: "run-late", running: true, end: 1600000 }),
      clock({ id: "done-long-ago", running: true, end: 400000 }),
      clock({ id: "paused", remaining: MIN }),
      clock({ id: "run-soon", running: true, end: 1060000 }),
      clock({ id: "done-just-now", running: true, end: 990000 }),
    ];
    expect(sortClocks(list, now).map((c) => c.id)).toEqual([
      "run-soon",
      "run-late",
      "done-long-ago",
      "done-just-now",
      "idle",
      "paused",
    ]);
    // The stored list is left as it was.
    expect(list[0].id).toBe("idle");
  });
  it("moves a timer from the running group to the finished group as it ends", () => {
    const list = [
      clock({ id: "a", running: true, end: 2000 }),
      clock({ id: "b", running: true, end: 5000 }),
    ];
    expect(sortClocks(list, 1000).map((c) => c.id)).toEqual(["a", "b"]);
    expect(sortClocks(list, 3000).map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("timer presets and recent durations", () => {
  it("falls back to 1, 5, 10 and 30 minutes only when no list was stored", () => {
    expect(timerPresets(undefined)).toEqual([60000, 300000, 600000, 1800000]);
    expect(DEFAULT_PRESETS).toEqual([60000, 300000, 600000, 1800000]);
    // A list the user emptied stays empty.
    expect(timerPresets([])).toEqual([]);
    expect(timerPresets([90000, "x", -1, 90000, 0, NaN, 45000])).toEqual([
      90000, 45000,
    ]);
  });
  it("adds a preset once, shortest first", () => {
    expect(addPreset([60000, 300000], 90000)).toEqual([60000, 90000, 300000]);
    expect(addPreset([60000, 300000], 300000)).toEqual([60000, 300000]);
    expect(addPreset([60000], 0)).toEqual([60000]);
  });
  it("keeps the five durations started last, newest first, each once", () => {
    expect(recentDurations(undefined)).toEqual([]);
    expect(rememberDuration(undefined, 5 * MIN)).toEqual([300000]);
    expect(rememberDuration([5 * MIN, MIN], MIN)).toEqual([60000, 300000]);
    expect(
      rememberDuration([5 * MIN, 4 * MIN, 3 * MIN, 2 * MIN, MIN], 6 * MIN)
    ).toEqual([360000, 300000, 240000, 180000, 120000]);
    expect(rememberDuration([MIN], 0)).toEqual([60000]);
  });
  it("splits a duration into hours, minutes and seconds and back", () => {
    expect(durationParts(5400000)).toEqual([1, 30, 0]);
    expect(durationParts(3723999)).toEqual([1, 2, 3]);
    expect(durationFromParts(1, 30, 0)).toBe(5400000);
    // 90 typed into the minutes field is an hour and a half.
    expect(durationFromParts(0, 90, 0)).toBe(5400000);
  });
});

describe("stopwatch laps", () => {
  it("reports each lap as the time since the previous one", () => {
    // Laps pressed at 1:01.25, 2:05.00 and 3:05.50.
    expect(lapRows([61250, 125000, 185500])).toEqual([
      { number: 1, lap: 61250, total: 61250 },
      { number: 2, lap: 63750, total: 125000 },
      { number: 3, lap: 60500, total: 185500 },
    ]);
    expect(lapRows(undefined)).toEqual([]);
  });
  it("records the elapsed time of a running stopwatch as the next lap", () => {
    // 30 s were on the clock when it was resumed at 100 s; 12.34 s later:
    const watch = clock({
      duration: 0,
      remaining: 0,
      running: true,
      elapsed: 30000,
      started: 100000,
      laps: [10000],
    });
    expect(addLap(watch, 112340)).toEqual([10000, 42340]);
    expect(addLap({ ...watch, laps: undefined }, 112340)).toEqual([42340]);
  });
  it("writes times with hundredths", () => {
    expect(centiseconds(999)).toBe("99");
    expect(centiseconds(1005)).toBe("00");
    expect(stopwatchText(65250)).toBe("00:01:05.25");
    expect(stopwatchText(3600000)).toBe("01:00:00.00");
  });
});

describe("alarms", () => {
  // 9 November 2026 is a Monday.
  const at = (hour: number, minute = 0, second = 0, day = 9) =>
    +new Date(2026, 10, day, hour, minute, second);
  const alarm = (patch: Partial<Alarm>): Alarm => ({
    id: "1",
    name: "Alarm",
    at: new Date(at(10)).toISOString(),
    weekdays: [],
    active: true,
    ...patch,
  });
  const snoozed = (until: number, patch: Partial<Alarm> = {}) =>
    alarm({ snoozeUntil: new Date(until).toISOString(), ...patch });

  it("rings a snoozed one-off alarm once more, then is past again", () => {
    const a = snoozed(at(10, 8));
    expect(nextRegularAlarm(a, at(10, 3))).toBeNull();
    expect(snoozeTime(a, at(10, 3))).toBe(at(10, 8));
    expect(nextAlarm(a, at(10, 3))).toBe(at(10, 8));
    // The snooze has rung at 10:08 and is not a schedule.
    expect(nextAlarm(a, at(10, 8))).toBeNull();
    expect(nextAlarm(a, at(11))).toBeNull();
  });
  it("takes the earlier of a snooze and the regular next time", () => {
    const weekly = snoozed(at(10, 7), { weekdays: [1] });
    expect(nextAlarm(weekly, at(10, 2))).toBe(at(10, 7));
    expect(nextAlarm(weekly, at(10, 7))).toBe(at(10, 0, 0, 16));
    // A snooze later than the alarm's own time does not delay the alarm.
    const early = snoozed(at(11, 30), {
      at: new Date(at(11)).toISOString(),
    });
    expect(nextAlarm(early, at(10))).toBe(at(11));
    expect(nextAlarm(early, at(11))).toBe(at(11, 30));
  });
  it("ignores a snooze on an alarm that is off, and one that is not a time", () => {
    expect(nextAlarm(snoozed(at(10, 8), { active: false }), at(10, 3))).toBe(
      null
    );
    expect(nextAlarm(alarm({ snoozeUntil: "soon" }), at(10, 3))).toBeNull();
    expect(nextAlarm(alarm({ snoozeUntil: "soon" }), at(9))).toBe(at(10));
  });
  it("finds when an alarm was last due", () => {
    expect(lastAlarm(alarm({}), at(9, 59))).toBeNull();
    expect(lastAlarm(alarm({}), at(10))).toBe(at(10));
    expect(lastAlarm(alarm({ active: false }), at(11))).toBeNull();
    const weekly = alarm({ weekdays: [1] });
    // Tuesday morning: it rang on Monday. Monday before ten: a week earlier.
    expect(lastAlarm(weekly, at(9, 0, 0, 10))).toBe(at(10));
    expect(lastAlarm(weekly, at(9, 59))).toBe(at(10, 0, 0, 2));
    // A snooze that has rung is the most recent ring.
    expect(lastAlarm(snoozed(at(10, 8)), at(10, 9))).toBe(at(10, 8));
    expect(lastAlarm(snoozed(at(10, 8)), at(10, 7))).toBe(at(10));
  });
  it("offers a snooze for ten minutes after an alarm rang", () => {
    expect(snoozeOffer(alarm({}), at(9, 59))).toBeNull();
    expect(snoozeOffer(alarm({}), at(10, 3))).toBe(at(10));
    expect(snoozeOffer(alarm({}), at(10, 9, 59))).toBe(at(10));
    expect(snoozeOffer(alarm({}), at(10, 10))).toBeNull();
    // Snoozed to 10:08: nothing to offer while it waits, then again after it
    // rings, until 10:18.
    const a = snoozed(at(10, 8));
    expect(snoozeOffer(a, at(10, 4))).toBeNull();
    expect(snoozeOffer(a, at(10, 8))).toBe(at(10, 8));
    expect(snoozeOffer(a, at(10, 17, 59))).toBe(at(10, 8));
    expect(snoozeOffer(a, at(10, 18))).toBeNull();
    expect(snoozeOffer(alarm({ active: false }), at(10, 3))).toBeNull();
  });
  it("counts a one-off alarm as past once nothing is left to ring", () => {
    expect(isPastOneOff(alarm({}), at(9, 59))).toBe(false);
    expect(isPastOneOff(alarm({}), at(10, 3))).toBe(true);
    expect(isPastOneOff(alarm({ active: false }), at(10, 3))).toBe(true);
    expect(isPastOneOff(snoozed(at(10, 8)), at(10, 3))).toBe(false);
    expect(isPastOneOff(snoozed(at(10, 8)), at(10, 8))).toBe(true);
    expect(isPastOneOff(alarm({ weekdays: [1] }), at(10, 3))).toBe(false);
  });
  it("orders alarms by next ring, with off and past alarms last", () => {
    const iso = (time: number) => new Date(time).toISOString();
    const list = [
      alarm({ id: "noon", at: iso(at(12)) }),
      alarm({ id: "off", at: iso(at(11)), active: false }),
      alarm({ id: "past", at: iso(at(9)) }),
      alarm({ id: "tuesday", at: iso(at(8)), weekdays: [2] }),
      snoozed(at(10, 8), { id: "snoozed" }),
    ];
    // At 10:03 on Monday: snooze 10:08, noon today, Tuesday 08:00.
    expect(sortAlarms(list, at(10, 3)).map((a) => a.id)).toEqual([
      "snoozed",
      "noon",
      "tuesday",
      "off",
      "past",
    ]);
    expect(list[0].id).toBe("noon");
  });
});
