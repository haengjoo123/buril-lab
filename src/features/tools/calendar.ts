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
}
const escape = (s: string) =>
  s
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
const stamp = (s: string) =>
  new Date(s)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
const wallParts = (date: Date, timezone: string) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
const wallStamp = (date: string, timezone: string) => {
  const p = wallParts(new Date(date), timezone);
  return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`;
};
export async function exportICS(events: CalendarEvent[]) {
  const timezones = (await import("./data/timezones.json")).default as Record<
    string,
    string
  >;
  for (const e of events) {
    if (!timezones[e.timezone]) throw Error("Unsupported ICS timezone");
    if (new Date(e.end) <= new Date(e.start))
      throw Error("Invalid event dates");
  }
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Buril Lab//Tools//EN",
    ...[...new Set(events.map((e) => e.timezone))].map(
      (zone) => timezones[zone]
    ),
    ...events.flatMap((e) => [
      "BEGIN:VEVENT",
      `UID:${e.id}@burillab`,
      `DTSTAMP:${stamp(new Date().toISOString())}`,
      `DTSTART;TZID=${e.timezone}:${wallStamp(e.start, e.timezone)}`,
      `DTEND;TZID=${e.timezone}:${wallStamp(e.end, e.timezone)}`,
      `SUMMARY:${escape(e.title)}`,
      `X-BURIL-TIMEZONE:${e.timezone}`,
      ...(e.repeat === "none"
        ? []
        : [
            `RRULE:FREQ=${e.repeat.toUpperCase()}${
              e.until ? `;UNTIL=${stamp(e.until)}` : ""
            }`,
          ]),
      ...(e.exceptions.length
        ? [
            `EXDATE;TZID=${e.timezone}:${e.exceptions
              .map((s) => wallStamp(s, e.timezone))
              .join(",")}`,
          ]
        : []),
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ].join("\r\n");
}
export function importICS(text: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const parseDate = (s: string, zone = "UTC") => {
    const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
    if (!m) throw Error("Unsupported timezone or all-day ICS format");
    const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    if (m[7]) return new Date(wall).toISOString();
    let utc = wall;
    for (let i = 0; i < 4; i++) {
      const p = wallParts(new Date(utc), zone);
      utc +=
        wall -
        Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    }
    return new Date(utc).toISOString();
  };
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const props = Object.fromEntries(
      block
        .split(/\r?\n/)
        .filter((l) => l.includes(":"))
        .map((l) => {
          const i = l.indexOf(":");
          return [l.slice(0, i), l.slice(i + 1)];
        })
    );
    if (
      Object.keys(props).some(
        (k) =>
          /^(DTSTART|DTEND|EXDATE);/.test(k) &&
          !/^(DTSTART|DTEND|EXDATE);TZID=[A-Za-z0-9_+\-/]+$/.test(k)
      )
    )
      throw Error("Unsupported timezone or all-day ICS format");
    if (props.RDATE || props.EXRULE || props["RECURRENCE-ID"])
      throw Error("Unsupported recurrence rule");
    const read = (name: string) => {
      const key = Object.keys(props).find(
        (k) => k === name || k.startsWith(`${name};TZID=`)
      );
      return {
        value: key ? props[key] : "",
        zone: key?.includes(";TZID=") ? key.split(";TZID=")[1] : "UTC",
      };
    };
    const rule = props.RRULE
      ? Object.fromEntries(props.RRULE.split(";").map((v) => v.split("=")))
      : {};
    if (
      Object.keys(rule).some((k) => !["FREQ", "UNTIL"].includes(k)) ||
      (rule.FREQ && !["DAILY", "WEEKLY", "MONTHLY"].includes(rule.FREQ))
    )
      throw Error("Unsupported recurrence rule");
    const a = read("DTSTART"),
      b = read("DTEND"),
      ex = read("EXDATE");
    const start = parseDate(a.value, a.zone),
      end = parseDate(b.value, b.zone);
    if (new Date(end) <= new Date(start)) throw Error("Invalid event dates");
    events.push({
      id: crypto.randomUUID(),
      title: (props.SUMMARY ?? "Event")
        .replace(/\\n/g, "\n")
        .replace(/\\([,;\\])/g, "$1"),
      start,
      end,
      timezone: props["X-BURIL-TIMEZONE"] || a.zone,
      repeat: (rule.FREQ?.toLowerCase() ?? "none") as CalendarEvent["repeat"],
      until: rule.UNTIL ? parseDate(rule.UNTIL) : undefined,
      exceptions: ex.value
        ? ex.value.split(",").map((s) => parseDate(s, ex.zone))
        : [],
      reminderMinutes: 0,
    });
  }
  return events;
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
  const parts = (date: Date) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: event.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(date)
        .map((p) => [p.type, p.value])
    );
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
