import { v5 } from "uuid";
/**
 * Moves the calendar by one week, or by one month for the month and list
 * views. Months are stepped from the 1st: stepping from the 31st overflows
 * into the month after next (31 January + 1 month is 3 March).
 */
export function shiftAnchor(anchor: Date, view: string, direction: 1 | -1) {
  const date = new Date(anchor);
  if (view === "week") date.setDate(date.getDate() + 7 * direction);
  else {
    date.setDate(1);
    date.setMonth(date.getMonth() + direction);
  }
  return date;
}
/**
 * A stable id for an imported event, so importing the same file again updates
 * the events it brought in before instead of adding copies. Our own exports
 * carry the event id in the UID; any other UID maps to the same id each time.
 */
function importedEventId(uid: string | undefined) {
  if (!uid) return crypto.randomUUID();
  const own = uid.match(
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@burillab$/i
  );
  return own ? own[1].toLowerCase() : v5(`burillab:ics:${uid}`, v5.URL);
}
export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  timezone: string;
  repeat: "none" | "daily" | "weekly" | "monthly";
  until?: string;
  exceptions: string[];
  reminderMinutes: number;
  /**
   * A whole-day event. `start` and `end` stay instants, as for every other
   * event: midnight of the first day and midnight after the last day, both in
   * `timezone`. Code that does not know this field (earlier versions of the
   * app, the notification plan) therefore reads an event from 00:00 to 00:00.
   */
  allDay?: boolean;
}
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const deviceTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;
const escape = (s: string) =>
  s
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
const unescape = (s: string) =>
  s.replace(/\\([\\;,nN])/g, (_, c: string) =>
    c === "n" || c === "N" ? "\n" : c
  );
const stamp = (s: string) =>
  new Date(s)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
// Building a formatter is slow and a recurring event asks for thousands of
// readings, so there is one per timezone.
const formats = new Map<string, Intl.DateTimeFormat>();
const wallParts = (date: Date, timezone: string) => {
  let format = formats.get(timezone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formats.set(timezone, format);
  }
  return Object.fromEntries(
    format.formatToParts(date).map((p) => [p.type, p.value])
  );
};
const isTimeZone = (timezone: string) => {
  try {
    wallParts(new Date(0), timezone);
    return timezone.trim() !== "";
  } catch {
    return false;
  }
};
const wallStamp = (date: string, timezone: string) => {
  const p = wallParts(new Date(date), timezone);
  return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`;
};
/** What clocks in a timezone show at an instant, written as if it were UTC. */
const wallTime = (instant: number, timezone: string) => {
  const p = wallParts(new Date(instant), timezone);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
};
/** The instant at which clocks in a timezone show `wall` (given as if UTC). */
const zonedInstant = (wall: number, timezone: string) => {
  let utc = wall;
  for (let i = 0; i < 4; i++) utc += wall - wallTime(utc, timezone);
  return utc;
};

/* ---- Calendar days ("YYYY-MM-DD") ---- */

/** The calendar day of an instant in a timezone (this device's by default). */
export function dateKey(
  at: Date | string | number,
  timezone: string = deviceTimeZone()
): string {
  const p = wallParts(new Date(at), timezone);
  return `${p.year}-${p.month}-${p.day}`;
}
const keyTime = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
};
export const addDays = (key: string, days: number) =>
  new Date(keyTime(key) + days * DAY).toISOString().slice(0, 10);
/** Midnight at the start of a calendar day in a timezone. */
export const dayStart = (key: string, timezone: string) =>
  new Date(zonedInstant(keyTime(key), timezone));
/** `start` and `end` of a whole-day event from its first to its last day. */
export function allDayRange(first: string, last: string, timezone: string) {
  return {
    start: dayStart(first, timezone).toISOString(),
    end: dayStart(addDays(last, 1), timezone).toISOString(),
  };
}
/**
 * The first and last calendar day an event (or one occurrence of it) is on.
 *
 * A timed event is on the days it touches as seen from `timeZone`, the
 * viewer's: one that ends at midnight does not reach into the next day. A
 * whole-day event keeps the dates it was given in its own timezone wherever
 * it is viewed. Its days are read six hours inside each end, so a midnight
 * that a daylight-saving change moved by an hour or two still gives the day
 * that was meant.
 */
export function eventSpan(
  event: Pick<CalendarEvent, "start" | "end" | "timezone" | "allDay">,
  timeZone: string = deviceTimeZone()
): { first: string; last: string } {
  const start = +new Date(event.start),
    end = +new Date(event.end);
  if (event.allDay) {
    const first = dateKey(start + 6 * HOUR, event.timezone),
      last = dateKey(end - 6 * HOUR, event.timezone);
    return { first, last: last < first ? first : last };
  }
  const first = dateKey(start, timeZone);
  return { first, last: end > start ? dateKey(end - 1, timeZone) : first };
}
/** How many calendar days a span covers. */
export const spanDays = (span: { first: string; last: string }) =>
  Math.round((keyTime(span.last) - keyTime(span.first)) / DAY) + 1;
/**
 * What changes when a whole-day event is given another timezone: it keeps its
 * dates, so every midnight it is made of (start, end, excluded days, the last
 * day of a repeat) is taken again in the new zone.
 */
export function retimeAllDay(
  event: CalendarEvent,
  timezone: string
): Partial<CalendarEvent> {
  const span = eventSpan(event);
  return {
    timezone,
    ...allDayRange(span.first, span.last, timezone),
    exceptions: event.exceptions.map((at) =>
      dayStart(
        dateKey(+new Date(at) + 6 * HOUR, event.timezone),
        timezone
      ).toISOString()
    ),
    ...(event.until
      ? {
          until: dayStart(
            dateKey(event.until, event.timezone),
            timezone
          ).toISOString(),
        }
      : {}),
  };
}

/* ---- ICS ---- */

const dateStamp = (key: string) => key.replaceAll("-", "");
export async function exportICS(events: CalendarEvent[]) {
  const timezones = (await import("./data/timezones.json")).default as Record<
    string,
    string
  >;
  for (const e of events) {
    // A whole-day event is written as dates and needs no timezone definition.
    if (!e.allDay && !timezones[e.timezone])
      throw Error("Unsupported ICS timezone");
    if (new Date(e.end) <= new Date(e.start))
      throw Error("Invalid event dates");
  }
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Buril Lab//Tools//EN",
    ...[
      ...new Set(events.filter((e) => !e.allDay).map((e) => e.timezone)),
    ].map((zone) => timezones[zone]),
    ...events.flatMap((e) => {
      const span = e.allDay ? eventSpan(e) : null;
      return [
        "BEGIN:VEVENT",
        `UID:${e.id}@burillab`,
        `DTSTAMP:${stamp(new Date().toISOString())}`,
        ...(span
          ? [
              // DTEND of a whole-day event is the day after its last day.
              `DTSTART;VALUE=DATE:${dateStamp(span.first)}`,
              `DTEND;VALUE=DATE:${dateStamp(addDays(span.last, 1))}`,
            ]
          : [
              `DTSTART;TZID=${e.timezone}:${wallStamp(e.start, e.timezone)}`,
              `DTEND;TZID=${e.timezone}:${wallStamp(e.end, e.timezone)}`,
            ]),
        `SUMMARY:${escape(e.title)}`,
        `X-BURIL-TIMEZONE:${e.timezone}`,
        ...(e.repeat === "none"
          ? []
          : [
              `RRULE:FREQ=${e.repeat.toUpperCase()}${
                e.until
                  ? `;UNTIL=${
                      span
                        ? dateStamp(dateKey(e.until, e.timezone))
                        : stamp(e.until)
                    }`
                  : ""
              }`,
            ]),
        ...(e.exceptions.length
          ? [
              span
                ? `EXDATE;VALUE=DATE:${e.exceptions
                    .map((s) =>
                      dateStamp(dateKey(+new Date(s) + 6 * HOUR, e.timezone))
                    )
                    .join(",")}`
                : `EXDATE;TZID=${e.timezone}:${e.exceptions
                    .map((s) => wallStamp(s, e.timezone))
                    .join(",")}`,
            ]
          : []),
        "END:VEVENT",
      ];
    }),
    "END:VCALENDAR",
  ].join("\r\n");
}

/** Why an event in an ICS file was not imported. */
export type IcsSkipReason =
  /** No start, or one that is not a date or a date and time. */
  | "start"
  /** A timed event with neither an end nor a duration, or an end that cannot be read. */
  | "end"
  /** A timezone name that is not an IANA zone (a Windows zone name, a custom one). */
  | "timezone"
  /** A repeat other than daily, weekly or monthly with an optional end date. */
  | "recurrence"
  /** One changed occurrence of a repeating event (RECURRENCE-ID). */
  | "override"
  /** It ends before it starts. */
  | "dates"
  /** The same UID as an earlier event in the file. */
  | "duplicate";
export interface IcsSkipped {
  /** The event's title, or "" when it has none. */
  title: string;
  /** Its start as written in the file ("2026-11-27 09:00"), or "" when unreadable. */
  when: string;
  reason: IcsSkipReason;
}
export interface IcsImport {
  events: CalendarEvent[];
  skipped: IcsSkipped[];
}

interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}
/** `NAME;PARAM=value;PARAM="quoted:value":content` as its parts. */
function parseProperty(line: string): IcsProperty | null {
  let quoted = false,
    colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon).match(/(?:[^;"]|"[^"]*")+/g) ?? [];
  const params: Record<string, string> = {};
  for (const part of head.slice(1)) {
    const equals = part.indexOf("=");
    if (equals > 0)
      params[part.slice(0, equals).trim().toUpperCase()] = part
        .slice(equals + 1)
        .replace(/^"|"$/g, "");
  }
  return {
    name: (head[0] ?? "").trim().toUpperCase(),
    params,
    value: line.slice(colon + 1),
  };
}
/**
 * The properties of each VEVENT. Components inside an event (alarms) are left
 * out: their DESCRIPTION or TRIGGER must not be read as the event's own.
 */
function eventBlocks(text: string): IcsProperty[][] {
  const blocks: IcsProperty[][] = [];
  let current: IcsProperty[] | null = null,
    nested = 0;
  for (const line of text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    const property = parseProperty(line);
    if (!property) continue;
    const component = property.value.trim().toUpperCase();
    if (property.name === "BEGIN") {
      if (current) nested++;
      else if (component === "VEVENT") {
        current = [];
        nested = 0;
      }
    } else if (property.name === "END") {
      if (current && nested > 0) nested--;
      else if (current && component === "VEVENT") {
        blocks.push(current);
        current = null;
      }
    } else if (current && nested === 0) current.push(property);
  }
  // A file cut off inside its last event still shows that event was there.
  if (current) blocks.push(current);
  return blocks;
}
type IcsTime =
  | { allDay: true; key: string }
  | { allDay: false; at: number; zone: string };
/**
 * A DATE or DATE-TIME value. A time with neither "Z" nor a TZID is a floating
 * one, the same clock time wherever it is read: it is taken in `floating`.
 */
function readTime(
  raw: string,
  params: Record<string, string>,
  floating: string
): IcsTime | "timezone" | null {
  const value = raw.trim();
  const day = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (day) {
    const key = `${day[1]}-${day[2]}-${day[3]}`;
    // 20260231 is not a date; Date would quietly roll it into March.
    return new Date(keyTime(key)).toISOString().slice(0, 10) === key
      ? { allDay: true, key }
      : null;
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/i);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  if (stamp(new Date(wall).toISOString()).slice(0, 15) !== value.slice(0, 15).toUpperCase())
    return null;
  if (m[7]) return { allDay: false, at: wall, zone: "UTC" };
  const zone = params.TZID ?? floating;
  if (!isTimeZone(zone)) return "timezone";
  return { allDay: false, at: zonedInstant(wall, zone), zone };
}
/** A positive DURATION ("PT1H30M", "P1D", "P1W") in milliseconds, or null. */
function readDuration(raw: string | undefined): number | null {
  const m = raw
    ?.trim()
    .match(
      /^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i
    );
  if (!m) return null;
  const ms =
    (+(m[1] ?? 0) * 7 + +(m[2] ?? 0)) * DAY +
    +(m[3] ?? 0) * HOUR +
    +(m[4] ?? 0) * 60_000 +
    +(m[5] ?? 0) * 1000;
  return ms > 0 ? ms : null;
}
const readableStart = (raw: string | undefined) => {
  const m = raw?.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
  return m
    ? `${m[1]}-${m[2]}-${m[3]}${m[4] ? ` ${m[4]}:${m[5]}` : ""}`
    : "";
};
/** One VEVENT as an event, or the reason it cannot be one. */
function toEvent(
  props: IcsProperty[],
  timeZone: string
): CalendarEvent | IcsSkipReason {
  const all = (name: string) => props.filter((p) => p.name === name),
    one = (name: string): IcsProperty | undefined => all(name)[0];
  if (one("RECURRENCE-ID")) return "override";
  if (one("RDATE") || one("EXRULE") || all("RRULE").length > 1)
    return "recurrence";
  // Rules are never approximated: BYDAY, COUNT, an interval and the like would
  // each put the event on other days than the file says.
  const rule: Record<string, string> = Object.fromEntries(
    (one("RRULE")?.value ?? "")
      .split(";")
      .filter((part) => part.includes("="))
      .map((part) => {
        const [key, value] = part.split("=");
        return [key.trim().toUpperCase(), value.trim().toUpperCase()];
      })
  );
  if (
    Object.keys(rule).some(
      (key) => !["FREQ", "UNTIL", "INTERVAL", "WKST"].includes(key)
    ) ||
    (one("RRULE") && !["DAILY", "WEEKLY", "MONTHLY"].includes(rule.FREQ)) ||
    (rule.INTERVAL !== undefined && rule.INTERVAL !== "1")
  )
    return "recurrence";
  const startProp = one("DTSTART");
  if (!startProp) return "start";
  const start = readTime(startProp.value, startProp.params, timeZone);
  if (start === "timezone") return "timezone";
  if (!start) return "start";
  const own = one("X-BURIL-TIMEZONE")?.value.trim() ?? "";
  const timezone = isTimeZone(own) ? own : start.allDay ? timeZone : start.zone;
  const endProp = one("DTEND"),
    duration = readDuration(one("DURATION")?.value);
  let range: { start: string; end: string };
  if (start.allDay) {
    let last = start.key;
    if (endProp) {
      const end = readTime(endProp.value, endProp.params, timeZone);
      if (end === "timezone" || !end || !end.allDay) return "end";
      if (end.key < start.key) return "dates";
      // The end date is the day after the last one; some files give the
      // start date again for a single day.
      if (end.key > start.key) last = addDays(end.key, -1);
    } else if (duration)
      last = addDays(start.key, Math.max(1, Math.round(duration / DAY)) - 1);
    range = allDayRange(start.key, last, timezone);
  } else {
    let endAt: number;
    if (endProp) {
      const end = readTime(endProp.value, endProp.params, timeZone);
      if (end === "timezone") return "timezone";
      if (!end || end.allDay) return "end";
      endAt = end.at;
    } else if (duration) endAt = start.at + duration;
    else return "end";
    if (endAt <= start.at) return "dates";
    range = {
      start: new Date(start.at).toISOString(),
      end: new Date(endAt).toISOString(),
    };
  }
  let until: string | undefined;
  if (rule.UNTIL) {
    const last = readTime(rule.UNTIL, {}, timezone);
    if (last === "timezone" || !last) return "recurrence";
    until = new Date(
      !last.allDay
        ? last.at
        : start.allDay
        ? +dayStart(last.key, timezone)
        : // A date ends a timed series at the end of that day.
          +dayStart(addDays(last.key, 1), timezone) - 1
    ).toISOString();
  }
  const exceptions: string[] = [];
  for (const property of all("EXDATE"))
    for (const value of property.value.split(",")) {
      const at = readTime(value, property.params, timezone);
      // Dropping an exclusion would bring back an occurrence the file removed.
      if (at === "timezone" || !at || at.allDay !== start.allDay)
        return "recurrence";
      exceptions.push(
        (at.allDay ? dayStart(at.key, timezone) : new Date(at.at)).toISOString()
      );
    }
  return {
    id: importedEventId(one("UID")?.value.trim()),
    title: unescape(one("SUMMARY")?.value ?? "Event"),
    ...range,
    timezone,
    repeat: (one("RRULE")
      ? rule.FREQ.toLowerCase()
      : "none") as CalendarEvent["repeat"],
    until,
    exceptions,
    reminderMinutes: 0,
    ...(start.allDay ? { allDay: true } : {}),
  };
}
/**
 * Reads the events of an ICS file. Events it cannot represent are left out
 * and listed in `skipped` with the reason, each on its own; the rest are
 * imported. Whole-day events and times without a timezone are taken in
 * `timeZone`, this device's by default.
 */
export function readICS(
  text: string,
  timeZone: string = deviceTimeZone()
): IcsImport {
  const events: CalendarEvent[] = [],
    skipped: IcsSkipped[] = [],
    seen = new Set<string>();
  for (const props of eventBlocks(text)) {
    const result = toEvent(props, timeZone);
    const value = (name: string) =>
      props.find((p) => p.name === name)?.value ?? "";
    const skip = (reason: IcsSkipReason) =>
      skipped.push({
        title: unescape(value("SUMMARY")).trim(),
        when: readableStart(value("DTSTART")),
        reason,
      });
    if (typeof result === "string") skip(result);
    else if (seen.has(result.id)) skip("duplicate");
    else {
      seen.add(result.id);
      events.push(result);
    }
  }
  return { events, skipped };
}
const strictMessages: Record<IcsSkipReason, string> = {
  start: "Unsupported timezone or all-day ICS format",
  end: "Unsupported timezone or all-day ICS format",
  timezone: "Unsupported timezone or all-day ICS format",
  recurrence: "Unsupported recurrence rule",
  override: "Unsupported recurrence rule",
  dates: "Invalid event dates",
  duplicate: "Invalid event dates",
};
/**
 * The events of an ICS file, all or nothing: throws when any event cannot be
 * imported. The calendar screen uses `readICS`, which imports what it can.
 */
export function importICS(text: string): CalendarEvent[] {
  const { events, skipped } = readICS(text);
  const failed = skipped.find((entry) => entry.reason !== "duplicate");
  if (failed) throw Error(strictMessages[failed.reason]);
  return events;
}
/**
 * Adds imported events to a calendar. An event that is already there (same id)
 * is replaced in place and keeps its reminder lead time, which ICS does not
 * carry.
 */
export function mergeImported(
  current: CalendarEvent[],
  imported: CalendarEvent[]
): CalendarEvent[] {
  const incoming = new Map(imported.map((event) => [event.id, event]));
  const merged = current.map((event) => {
    const next = incoming.get(event.id);
    if (!next) return event;
    incoming.delete(event.id);
    return { ...next, reminderMinutes: event.reminderMinutes };
  });
  return [...merged, ...incoming.values()];
}
export function occurrences(
  event: CalendarEvent,
  from: Date,
  to: Date
): CalendarEvent[] {
  const result: CalendarEvent[] = [],
    start = new Date(event.start),
    duration = +new Date(event.end) - +start;
  // Recurrence preserves local wall-clock time via Intl parts; DST changes must not shift meetings.
  const parts = (date: Date) => wallParts(date, event.timezone);
  const base = parts(start);
  const wall = Date.UTC(
    +base.year,
    +base.month - 1,
    +base.day,
    +base.hour,
    +base.minute,
    +base.second
  );
  for (let i = 0; i < 10000; i++) {
    const local = new Date(wall);
    if (event.repeat === "daily") local.setUTCDate(local.getUTCDate() + i);
    if (event.repeat === "weekly") local.setUTCDate(local.getUTCDate() + 7 * i);
    if (event.repeat === "monthly") {
      local.setUTCMonth(local.getUTCMonth() + i);
      if (local.getUTCDate() !== +base.day) continue;
    }
    let candidate = +local;
    for (let j = 0; j < 3; j++) {
      const p = parts(new Date(candidate)),
        actual = Date.UTC(
          +p.year,
          +p.month - 1,
          +p.day,
          +p.hour,
          +p.minute,
          +p.second
        );
      candidate += +local - actual;
    }
    const d = new Date(candidate);
    if (d > to || (event.until && d > new Date(event.until))) break;
    if (d >= from && !event.exceptions.includes(d.toISOString()))
      result.push({
        ...event,
        start: d.toISOString(),
        end: new Date(+d + duration).toISOString(),
      });
    if (event.repeat === "none") break;
  }
  return result;
}
/**
 * The occurrences that are still going on at `from` or begin before `to`.
 * `occurrences` goes by the start alone, which leaves out an event that
 * began before the window and runs into it (the last days of a week-long
 * trip, seen from the next month).
 */
export function occurrencesTouching(
  event: CalendarEvent,
  from: Date,
  to: Date
): CalendarEvent[] {
  const length = Math.max(0, +new Date(event.end) - +new Date(event.start));
  return occurrences(event, new Date(+from - length), to).filter(
    (occurrence) =>
      +new Date(occurrence.end) > +from || +new Date(occurrence.start) >= +from
  );
}
