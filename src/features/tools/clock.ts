export type Clock = {
  id: string;
  name: string;
  color: string;
  duration: number;
  remaining: number;
  end: number | null;
  running: boolean;
  elapsed: number;
  started: number | null;
  /** Stopwatch laps: the elapsed time (ms) at each press, oldest first. */
  laps?: number[];
};
export const elapsedTime = (clock: Clock, now: number) =>
  clock.elapsed + (clock.running && clock.started ? now - clock.started : 0);
export const remainingTime = (clock: Clock, now: number) =>
  clock.running && clock.end ? Math.max(0, clock.end - now) : clock.remaining;
/**
 * What the start/pause button does to a clock. A countdown that has run out
 * starts over from its full duration: `remaining` still holds whatever was
 * left at the last resume, which is not what "restart" means.
 */
export function toggleClock(
  clock: Clock,
  now: number,
  stopwatch: boolean
): Partial<Clock> {
  if (clock.running && (stopwatch || remainingTime(clock, now) > 0))
    return {
      running: false,
      remaining: remainingTime(clock, now),
      elapsed: elapsedTime(clock, now),
      started: null,
      end: null,
    };
  const from = clock.running
    ? clock.duration
    : clock.remaining || clock.duration;
  return { running: true, started: now, end: now + from, remaining: from };
}
export const clockText = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((seconds / 60) % 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
};

// ---- Countdowns ----

/**
 * A countdown that reached zero and has not been restarted, reset or
 * dismissed since. It stays `running` in the document, so every device shows
 * the same finished state. Countdowns only: a stopwatch has no end to reach.
 */
export const isFinished = (clock: Pick<Clock, "running" | "end">, now: number) =>
  clock.running && clock.end != null && now >= clock.end;
/**
 * How long a finished countdown has been over. `remainingTime` stays at 0 for
 * it; this is the time counted past zero, and 0 for any other clock.
 */
export const overtime = (clock: Pick<Clock, "running" | "end">, now: number) =>
  isFinished(clock, now) ? now - clock.end! : 0;
/** Overtime as "+00:35", with hours only once there are any ("+01:02:03"). */
export const overtimeText = (ms: number) => {
  const text = clockText(ms);
  return `+${text.startsWith("00:") ? text.slice(3) : text}`;
};
/**
 * The order of the timer list: countdowns still running first, the one that
 * ends soonest on top; then finished ones, the longest overdue first; then
 * stopped ones as they were stored. Sorting by the same `end` in the first
 * two groups means a timer that finishes drops below the running ones without
 * reshuffling those already finished.
 */
export function sortClocks<T extends Pick<Clock, "running" | "end">>(
  clocks: readonly T[],
  now: number
): T[] {
  const rank = (clock: T) =>
    !clock.running ? 2 : isFinished(clock, now) ? 1 : 0;
  return [...clocks].sort((a, b) => {
    const group = rank(a);
    return (
      group - rank(b) ||
      (group === 2 ? 0 : (a.end ?? Infinity) - (b.end ?? Infinity))
    );
  });
}
/** A duration as whole hours, minutes and seconds. */
export const durationParts = (ms: number): [number, number, number] => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ];
};
export const durationFromParts = (
  hours: number,
  minutes: number,
  seconds: number
) => (hours * 3600 + minutes * 60 + seconds) * 1000;
/** The quick durations a timer document starts with: 1, 5, 10 and 30 min. */
export const DEFAULT_PRESETS: readonly number[] = [
  60000, 300000, 600000, 1800000,
];
export const MAX_PRESETS = 12;
export const MAX_RECENT_DURATIONS = 5;
const durations = (stored: unknown) =>
  Array.isArray(stored)
    ? [
        ...new Set(
          stored.filter(
            (value): value is number =>
              typeof value === "number" && Number.isFinite(value) && value > 0
          )
        ),
      ]
    : [];
/**
 * The stored quick durations. A document saved before presets could be edited
 * has none and gets the defaults; a list the user emptied stays empty.
 */
export const timerPresets = (stored: unknown): number[] =>
  Array.isArray(stored) ? durations(stored) : [...DEFAULT_PRESETS];
/** Adds a quick duration, keeping the list distinct and shortest first. */
export const addPreset = (presets: readonly number[], ms: number) =>
  ms > 0 && Number.isFinite(ms) && !presets.includes(ms)
    ? [...presets, ms].sort((a, b) => a - b)
    : [...presets];
/** The stored durations last started, newest first. */
export const recentDurations = (stored: unknown, max = MAX_RECENT_DURATIONS) =>
  durations(stored).slice(0, max);
/** The recent durations after one is started: it moves to the front, once. */
export const rememberDuration = (
  recent: unknown,
  ms: number,
  max = MAX_RECENT_DURATIONS
) =>
  ms > 0 && Number.isFinite(ms)
    ? [ms, ...durations(recent).filter((value) => value !== ms)].slice(0, max)
    : recentDurations(recent, max);

// ---- Stopwatch ----

/** Hundredths of a second, as the two digits after the seconds. */
export const centiseconds = (ms: number) =>
  Math.floor((Math.max(0, ms) % 1000) / 10)
    .toString()
    .padStart(2, "0");
/** A stopwatch time with hundredths: "00:01:05.25". */
export const stopwatchText = (ms: number) =>
  `${clockText(ms)}.${centiseconds(ms)}`;
export const MAX_LAPS = 999;
export interface LapRow {
  number: number;
  /** This lap alone: the time since the previous lap (or the start). */
  lap: number;
  /** Elapsed time when the lap was taken. */
  total: number;
}
/** Laps as rows, oldest first. */
export const lapRows = (laps: readonly number[] = []): LapRow[] =>
  laps.map((total, index) => ({
    number: index + 1,
    lap: total - (index ? laps[index - 1] : 0),
    total,
  }));
/** The laps after one more is taken now. */
export const addLap = (clock: Clock, now: number) => [
  ...(clock.laps ?? []),
  elapsedTime(clock, now),
];

// ---- Alarms ----

export interface Alarm {
  id: string;
  name: string;
  at: string;
  weekdays: number[];
  active: boolean;
  /**
   * One extra ring at this time (ISO), set by "snooze". It is not part of the
   * schedule: once the time has passed it is ignored.
   */
  snoozeUntil?: string;
}
/** How long after an alarm was due a snooze is still offered. */
export const SNOOZE_WINDOW_MS = 600000;
/** The alarm's own next time, without any snooze. */
export function nextRegularAlarm(alarm: Alarm, now: number) {
  if (!alarm.active) return null;
  if (!alarm.weekdays.length)
    return +new Date(alarm.at) > now ? +new Date(alarm.at) : null;
  const original = new Date(alarm.at);
  for (let i = 0; i < 8; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() + i);
    date.setHours(original.getHours(), original.getMinutes(), 0, 0);
    if (+date > now && alarm.weekdays.includes(date.getDay())) return +date;
  }
  return null;
}
/** The snooze still waiting to ring, if the alarm is on and has one. */
export function snoozeTime(alarm: Alarm, now: number) {
  if (!alarm.active || !alarm.snoozeUntil) return null;
  const at = +new Date(alarm.snoozeUntil);
  return at > now ? at : null;
}
/**
 * When the alarm rings next: its own next time or a waiting snooze, whichever
 * comes first. Null when it is off, or is a one-off whose time has passed.
 */
export function nextAlarm(alarm: Alarm, now: number) {
  const regular = nextRegularAlarm(alarm, now),
    snooze = snoozeTime(alarm, now);
  return regular == null
    ? snooze
    : snooze == null
    ? regular
    : Math.min(regular, snooze);
}
/**
 * When the alarm was last due, at or before now: its own time or a snooze
 * that has rung. Null when it is off or has never been due.
 */
export function lastAlarm(alarm: Alarm, now: number) {
  if (!alarm.active) return null;
  let last: number | null = null;
  const original = new Date(alarm.at);
  if (!alarm.weekdays.length) {
    if (+original <= now) last = +original;
  } else
    for (let i = 0; i < 8; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(original.getHours(), original.getMinutes(), 0, 0);
      if (+date <= now && alarm.weekdays.includes(date.getDay())) {
        last = +date;
        break;
      }
    }
  const snooze = alarm.snoozeUntil ? +new Date(alarm.snoozeUntil) : NaN;
  return snooze <= now && (last == null || snooze > last) ? snooze : last;
}
/**
 * The time the alarm rang, if that was recent enough to offer a snooze and
 * none is waiting already.
 */
export function snoozeOffer(
  alarm: Alarm,
  now: number,
  windowMs = SNOOZE_WINDOW_MS
) {
  if (snoozeTime(alarm, now) != null) return null;
  const last = lastAlarm(alarm, now);
  return last != null && now - last < windowMs ? last : null;
}
/** A one-off alarm with nothing left to ring: its time and any snooze are past. */
export const isPastOneOff = (alarm: Alarm, now: number) =>
  !alarm.weekdays.length &&
  !(+new Date(alarm.at) > now) &&
  snoozeTime(alarm, now) == null;
/**
 * The order of the alarm list: by the next time each will ring, soonest
 * first. Alarms with no next time (off, or past) go last, as they were stored.
 */
export function sortAlarms<T extends Alarm>(alarms: readonly T[], now: number) {
  return alarms
    .map((alarm) => ({ alarm, next: nextAlarm(alarm, now) ?? Infinity }))
    .sort((a, b) => (a.next === b.next ? 0 : a.next - b.next))
    .map((entry) => entry.alarm);
}
export const localDateInput = (date: Date) =>
  new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
