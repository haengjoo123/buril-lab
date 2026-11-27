/**
 * What the lab tools will alert about, and when. Pure: documents and a point
 * in time go in, a list of alerts comes out, so the schedule can be tested
 * without a clock, a browser or a phone. `notifications.ts` delivers the
 * result (system notifications, sound) and `ToolsRuntime` drives both.
 */
import type { ScheduleOn, Weekday } from "@capacitor/local-notifications";
import { nextAlarm, type Alarm, type Clock } from "./clock";
import { occurrences, type CalendarEvent } from "./calendar";

export type PlanTool = "timer" | "alarm" | "calendar" | "cell-culture";

/** One alert that is still to come. */
export interface PlannedNotification {
  /** Unique per occurrence: the same key is never alerted twice. */
  key: string;
  /** The timer, alarm, event or culture timer it belongs to. */
  source: string;
  /** The name the user gave it. */
  title: string;
  /** What kind of alert it is, in the app language. */
  body: string;
  /** When it is due (epoch ms). */
  at: number;
  tool: PlanTool;
  /** In-app route of the tool it came from. */
  path: string;
  /** Set when the system can repeat it by itself (native schedules only). */
  repeat?: ScheduleOn;
}

export interface PlanLabels {
  timer: string;
  alarm: string;
  snooze: string;
  culture: string;
  /** A calendar reminder `minutes` before the event starts (0: at the start). */
  event: (minutes: number) => string;
  /**
   * A whole-day event's reminder, `minutes` before its first midnight;
   * negative when it reminds during the day itself.
   */
  allDay: (minutes: number) => string;
}

/** A stored document as the repository holds it; only what the plan reads. */
export interface PlanSource {
  doc: {
    id: string;
    tool_id: string;
    title: string;
    data: Record<string, unknown>;
    deleted_at?: string | null;
  };
  /** A device-only draft, which has no route of its own. */
  draft?: boolean;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

/** The alert descriptions in the app language; `t` is the tools' `useText()`. */
export function planLabels(t: (ko: string, en: string) => string): PlanLabels {
  const lead = (minutes: number) => {
    const days = Math.floor(minutes / 1440),
      hours = Math.floor((minutes % 1440) / 60),
      rest = minutes % 60;
    return [
      days ? t(`${days}일`, days === 1 ? "1 day" : `${days} days`) : "",
      hours ? t(`${hours}시간`, `${hours} h`) : "",
      rest ? t(`${rest}분`, `${rest} min`) : "",
    ]
      .filter(Boolean)
      .join(" ");
  };
  return {
    timer: t("타이머 종료", "Timer finished"),
    alarm: t("알람", "Alarm"),
    snooze: t("다시 알림", "Snoozed alarm"),
    culture: t("세포 배양 타이머", "Cell culture timer"),
    event: (minutes) => {
      const whole = Math.round(minutes);
      return whole > 0
        ? t(`일정 ${lead(whole)} 전`, `Event in ${lead(whole)}`)
        : t("일정 시작", "Event starting");
    },
    // A whole day has no start worth counting down to: say which day it is.
    allDay: (minutes) => {
      const days = Math.ceil(Math.round(minutes) / 1440);
      return days <= 0
        ? t("오늘 종일 일정", "All-day event today")
        : days === 1
        ? t("내일 종일 일정", "All-day event tomorrow")
        : t(`${days}일 뒤 종일 일정`, `All-day event in ${days} days`);
    },
  };
}

const list = <T>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

/** A blank name still needs something to show: the kind of alert stands in. */
const named = (name: unknown, fallback: string) =>
  (typeof name === "string" && name.trim()) || fallback;

/**
 * Every alert due after `from` for the things switched on for this device
 * (`enabledIds`), soonest first.
 *
 * Something that repeats is listed once, at its next time: after that has
 * passed, plan again from then. The exception is a calendar series the system
 * cannot repeat by itself (an end date, excluded days, another time zone, or
 * not yet begun), which is listed occurrence by occurrence for the next 31
 * days (a year when monthly).
 */
export function planToolNotifications(
  sources: readonly PlanSource[],
  enabledIds: ReadonlySet<string>,
  from: number,
  labels: PlanLabels,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone
): PlannedNotification[] {
  const plan = new Map<string, PlannedNotification>();
  const add = (entry: PlannedNotification) => {
    if (entry.at > from && !plan.has(entry.key)) plan.set(entry.key, entry);
  };
  for (const { doc, draft } of sources) {
    if (doc.deleted_at) continue;
    const data = doc.data ?? {};
    if (doc.tool_id === "timer")
      for (const clock of list<Clock>(data.clocks)) {
        if (!clock?.running || !clock.end || !enabledIds.has(clock.id))
          continue;
        add({
          key: `${clock.id}:${clock.end}`,
          source: clock.id,
          title: named(clock.name, labels.timer),
          body: labels.timer,
          at: clock.end,
          tool: "timer",
          path: "/app/tools/timer",
        });
      }
    else if (doc.tool_id === "cell-culture") {
      const timer = data.timer as {
        id?: unknown;
        end?: unknown;
        name?: unknown;
      } | null;
      if (
        timer &&
        typeof timer.id === "string" &&
        typeof timer.end === "number" &&
        enabledIds.has(timer.id)
      )
        add({
          key: `${timer.id}:${timer.end}`,
          source: timer.id,
          // The cell line the timer was started for, then the culture's
          // name, then the saved work's title.
          title: named(
            timer.name,
            named(data.name, named(doc.title, labels.culture))
          ),
          body: labels.culture,
          at: timer.end,
          tool: "cell-culture",
          // Only named work has a page of its own.
          path:
            draft || data._workspace === true
              ? "/app/tools/cell-culture"
              : `/app/tools/cell-culture/${doc.id}`,
        });
    } else if (doc.tool_id === "alarm")
      for (const alarm of list<Alarm>(data.alarms)) {
        if (!alarm || !enabledIds.has(alarm.id)) continue;
        const entry = {
          source: alarm.id,
          title: named(alarm.name, labels.alarm),
          tool: "alarm" as const,
          path: "/app/tools/alarm",
        };
        // A snooze is one extra ring, not part of the schedule: it is planned
        // on its own below, and left out of the regular times here.
        const regular = { ...alarm, snoozeUntil: undefined };
        const weekdays = list<number>(alarm.weekdays);
        for (const day of weekdays.length ? weekdays : [null]) {
          const at = nextAlarm(
            { ...regular, weekdays: day === null ? [] : [day] },
            from
          );
          if (!at) continue;
          const date = new Date(at);
          add({
            ...entry,
            key: `${alarm.id}:${day}:${at}`,
            body: labels.alarm,
            at,
            ...(day === null
              ? {}
              : {
                  repeat: {
                    weekday: (day + 1) as Weekday,
                    hour: date.getHours(),
                    minute: date.getMinutes(),
                    second: 0,
                  },
                }),
          });
        }
        const snooze = (alarm as { snoozeUntil?: unknown }).snoozeUntil;
        const snoozeAt = typeof snooze === "string" ? +new Date(snooze) : NaN;
        if (alarm.active && snoozeAt > from)
          add({
            ...entry,
            key: `${alarm.id}:snooze:${snoozeAt}`,
            body: labels.snooze,
            at: snoozeAt,
          });
      }
    else if (doc.tool_id === "calendar")
      for (const event of list<CalendarEvent>(data.events)) {
        if (
          !event ||
          !enabledIds.has(event.id) ||
          !(+new Date(event.end) > +new Date(event.start))
        )
          continue;
        // A whole-day event starts at midnight, so its reminder may come
        // after the start: "09:00 on the day" is nine hours past it.
        const minutes = !Number.isFinite(event.reminderMinutes)
          ? 0
          : event.allDay
          ? Math.max(-1439, event.reminderMinutes)
          : Math.max(0, event.reminderMinutes);
        const text = event.allDay
          ? labels.allDay(minutes)
          : labels.event(minutes);
        const lead = Math.round(minutes * MINUTE);
        // The system can take over a series only when every later ring at the
        // same local time is one of its occurrences.
        const series =
          event.repeat !== "none" &&
          !event.until &&
          !list(event.exceptions).length &&
          event.timezone === timeZone &&
          +new Date(event.start) - lead <= from;
        try {
          // The reminder is `lead` before the start, so an occurrence counts
          // for as long as its reminder is still ahead.
          for (const occurrence of occurrences(
            event,
            new Date(from + lead + 1),
            new Date(
              from + lead + (event.repeat === "monthly" ? 366 : 31) * DAY
            )
          )) {
            const start = new Date(occurrence.start),
              at = +start - lead,
              date = new Date(at);
            // "The 1st, ten minutes early" is the last day of a month, which
            // has no fixed number: such a series is listed one by one.
            const repeats =
              series &&
              (event.repeat !== "monthly" ||
                date.getDate() === start.getDate());
            add({
              key: `${event.id}:${at}`,
              source: event.id,
              title: named(event.title, text),
              body: text,
              at,
              tool: "calendar",
              path: "/app/tools/calendar",
              ...(repeats
                ? {
                    repeat: {
                      hour: date.getHours(),
                      minute: date.getMinutes(),
                      second: 0,
                      ...(event.repeat === "weekly"
                        ? { weekday: (date.getDay() + 1) as Weekday }
                        : event.repeat === "monthly"
                        ? { day: date.getDate() }
                        : {}),
                    },
                  }
                : {}),
            });
            if (repeats) break;
          }
        } catch {
          /* An event the calendar editor already reports as invalid. */
        }
      }
  }
  return [...plan.values()].sort(
    (a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}

/**
 * What came due after `previous`, up to and including `now`. Passing each
 * `now` as the next `previous` alerts everything once and nothing twice.
 */
export const dueBetween = (
  plan: readonly PlannedNotification[],
  previous: number,
  now: number
) => plan.filter((entry) => entry.at > previous && entry.at <= now);

/** How far back alerts that nobody saw are still reported. */
export const MISSED_WINDOW_MS = DAY;
export const MISSED_LIMIT = 10;
/** Later than this, an alert is reported as missed instead of sounding as if it were due now. */
export const LATE_MS = 2 * MINUTE;

/**
 * Where to pick up after a gap (the app was closed, the computer slept): the
 * last time alerts were checked, but no more than a day back, and never in
 * the future (a clock that was set back).
 */
export const catchUpFrom = (lastSeen: number, now: number) =>
  Math.min(now, Math.max(lastSeen, now - MISSED_WINDOW_MS));

/**
 * Splits what has come due into alerts to sound now and alerts that were
 * missed: due before this page was opened (`startedAt`), or too long ago to
 * present as happening now. Of the missed ones the latest few are kept,
 * newest first.
 */
export function splitDue(
  due: readonly PlannedNotification[],
  now: number,
  startedAt: number
) {
  const live: PlannedNotification[] = [],
    late: PlannedNotification[] = [];
  for (const entry of due)
    (entry.at <= startedAt || now - entry.at > LATE_MS ? late : live).push(
      entry
    );
  return {
    live,
    missed: late.sort((a, b) => b.at - a.at).slice(0, MISSED_LIMIT),
  };
}

/**
 * The alerts to hand to the system when it only keeps so many. Timers, alarms
 * and anything due within a day come first; calendar reminders further out
 * fill what is left, soonest first. Returned soonest first.
 */
export function withinBudget(
  plan: readonly PlannedNotification[],
  now: number,
  budget: number
): PlannedNotification[] {
  const later = (entry: PlannedNotification) =>
    entry.tool === "calendar" && entry.at - now > DAY ? 1 : 0;
  return [...plan]
    .sort((a, b) => later(a) - later(b) || a.at - b.at)
    .slice(0, Math.max(0, budget))
    .sort((a, b) => a.at - b.at);
}

/**
 * The identity of the system notification for an alert. A repeating one keeps
 * the same identity from one occurrence to the next, so the notification the
 * system is already repeating is left in place.
 */
export function scheduleKey(entry: PlannedNotification): string {
  const on = entry.repeat;
  return on
    ? `${entry.source}:repeat:${on.weekday ?? ""}:${on.day ?? ""}:${
        on.hour ?? ""
      }:${on.minute ?? ""}`
    : entry.key;
}

/**
 * Everything a system notification is built from. When it differs from what
 * is scheduled, the notification is scheduled again.
 */
export function scheduleSignature(
  entry: PlannedNotification,
  delivery: string
): string {
  return JSON.stringify([
    entry.title,
    entry.body,
    entry.path,
    entry.repeat ? scheduleKey(entry) : entry.at,
    delivery,
  ]);
}

export interface ScheduledNotification {
  id: number;
  signature: string;
}

/**
 * What to change so the system holds exactly `wanted`: ids to leave alone,
 * ids to cancel, and ids to schedule (new, or scheduled with other content;
 * scheduling an id again replaces it in place). Leaving the rest untouched
 * means nothing that is about to ring is ever cancelled and re-created.
 */
export function diffScheduled(
  pending: readonly ScheduledNotification[],
  wanted: readonly ScheduledNotification[]
): { keep: number[]; cancel: number[]; add: number[] } {
  const have = new Map(pending.map((entry) => [entry.id, entry.signature]));
  const want = new Map<number, string>();
  for (const entry of wanted)
    if (!want.has(entry.id)) want.set(entry.id, entry.signature);
  const keep: number[] = [],
    add: number[] = [];
  for (const [id, signature] of want)
    (have.get(id) === signature ? keep : add).push(id);
  return { keep, cancel: [...have.keys()].filter((id) => !want.has(id)), add };
}
