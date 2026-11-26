import { describe, it, expect } from "vitest";
import {
  type CalendarEvent,
  addDays,
  allDayRange,
  dateKey,
  dayStart,
  eventSpan,
  exportICS,
  importICS,
  mergeImported,
  occurrences,
  occurrencesTouching,
  readICS,
  retimeAllDay,
  spanDays,
} from "./calendar";

const SEOUL = "Asia/Seoul",
  NEW_YORK = "America/New_York";
const timed = (
  start: string,
  end: string,
  more: Partial<CalendarEvent> = {}
): CalendarEvent => ({
  id: "0b0f5a52-3d3c-4d8e-9a58-0c2f1f7b9a11",
  title: "Event",
  start,
  end,
  timezone: SEOUL,
  repeat: "none",
  exceptions: [],
  reminderMinutes: 0,
  ...more,
});
const wholeDays = (
  first: string,
  last: string,
  timezone = SEOUL,
  more: Partial<CalendarEvent> = {}
) => {
  const range = allDayRange(first, last, timezone);
  return timed(range.start, range.end, { timezone, allDay: true, ...more });
};

describe("calendar days", () => {
  it("names the day of an instant in a timezone and steps between days", () => {
    expect(dateKey("2026-11-26T15:00:00.000Z", SEOUL)).toBe("2026-11-27");
    expect(dateKey("2026-11-26T14:59:59.000Z", SEOUL)).toBe("2026-11-26");
    expect(dateKey("2026-11-27T04:59:00.000Z", NEW_YORK)).toBe("2026-11-26");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(spanDays({ first: "2026-11-27", last: "2026-11-27" })).toBe(1);
    expect(spanDays({ first: "2026-10-30", last: "2026-11-02" })).toBe(4);
  });

  it("keeps a whole-day event as instants: midnight to the midnight after its last day", () => {
    expect(dayStart("2026-11-27", SEOUL).toISOString()).toBe(
      "2026-11-26T15:00:00.000Z"
    );
    expect(allDayRange("2026-11-27", "2026-11-29", SEOUL)).toEqual({
      start: "2026-11-26T15:00:00.000Z",
      end: "2026-11-29T15:00:00.000Z",
    });
    // The day the clocks go back in New York lasts 25 hours.
    expect(allDayRange("2026-11-01", "2026-11-01", NEW_YORK)).toEqual({
      start: "2026-11-01T04:00:00.000Z",
      end: "2026-11-02T05:00:00.000Z",
    });
  });

  it("puts a timed event on the days it touches, as seen by the viewer", () => {
    const morning = timed("2026-11-27T00:00:00.000Z", "2026-11-27T01:00:00.000Z");
    expect(eventSpan(morning, SEOUL)).toEqual({
      first: "2026-11-27",
      last: "2026-11-27",
    });
    // 09:00 in Seoul is the evening before in New York.
    expect(eventSpan(morning, NEW_YORK).first).toBe("2026-11-26");
    // Ending at midnight does not reach into the next day; a minute more does.
    const evening = timed("2026-11-27T13:00:00.000Z", "2026-11-27T15:00:00.000Z");
    expect(eventSpan(evening, SEOUL).last).toBe("2026-11-27");
    expect(
      eventSpan({ ...evening, end: "2026-11-27T15:01:00.000Z" }, SEOUL).last
    ).toBe("2026-11-28");
    const trip = timed("2026-11-27T00:00:00.000Z", "2026-11-30T03:00:00.000Z");
    expect(eventSpan(trip, SEOUL)).toEqual({
      first: "2026-11-27",
      last: "2026-11-30",
    });
    // An event whose end is not after its start is still on its first day.
    expect(eventSpan({ ...morning, end: morning.start }, SEOUL)).toEqual({
      first: "2026-11-27",
      last: "2026-11-27",
    });
  });

  it("keeps a whole-day event on its own dates wherever it is viewed", () => {
    const conference = wholeDays("2026-11-27", "2026-11-29");
    for (const viewer of [SEOUL, NEW_YORK, "Pacific/Auckland"])
      expect(eventSpan(conference, viewer)).toEqual({
        first: "2026-11-27",
        last: "2026-11-29",
      });
    expect(spanDays(eventSpan(conference))).toBe(3);
    expect(eventSpan(wholeDays("2026-11-01", "2026-11-01", NEW_YORK))).toEqual({
      first: "2026-11-01",
      last: "2026-11-01",
    });
  });

  it("repeats a whole-day event day by day across a clock change", () => {
    const daily = wholeDays("2026-10-31", "2026-10-31", NEW_YORK, {
      repeat: "daily",
    });
    const days = occurrences(
      daily,
      new Date("2026-10-30T00:00:00Z"),
      new Date("2026-11-03T00:00:00Z")
    );
    expect(days.map((day) => day.start)).toEqual([
      "2026-10-31T04:00:00.000Z",
      "2026-11-01T04:00:00.000Z",
      "2026-11-02T05:00:00.000Z",
    ]);
    // Each is one day, though the 1st is an hour longer than the event.
    expect(days.map((day) => eventSpan(day))).toEqual(
      ["2026-10-31", "2026-11-01", "2026-11-02"].map((key) => ({
        first: key,
        last: key,
      }))
    );
  });

  it("finds an event that began before the window and runs into it", () => {
    const trip = timed("2026-11-28T00:00:00.000Z", "2026-12-02T09:00:00.000Z");
    const from = new Date("2026-12-01T00:00:00.000Z"),
      to = new Date("2026-12-31T00:00:00.000Z");
    expect(occurrences(trip, from, to)).toEqual([]);
    expect(occurrencesTouching(trip, from, to).map((e) => e.start)).toEqual([
      trip.start,
    ]);
    // One that ended exactly when the window opens is over.
    expect(
      occurrencesTouching({ ...trip, end: from.toISOString() }, from, to)
    ).toEqual([]);
    const weekly = wholeDays("2026-11-06", "2026-11-08", SEOUL, {
      repeat: "weekly",
    });
    expect(
      occurrencesTouching(
        weekly,
        dayStart("2026-11-15", SEOUL),
        dayStart("2026-11-21", SEOUL)
      ).map((e) => eventSpan(e))
    ).toEqual([
      { first: "2026-11-13", last: "2026-11-15" },
      { first: "2026-11-20", last: "2026-11-22" },
    ]);
  });

  it("moves a whole-day event's midnights with its timezone and keeps its dates", () => {
    const event = wholeDays("2026-11-27", "2026-11-28", SEOUL, {
      repeat: "weekly",
      exceptions: [dayStart("2026-12-04", SEOUL).toISOString()],
      until: dayStart("2026-12-25", SEOUL).toISOString(),
    });
    const moved = { ...event, ...retimeAllDay(event, NEW_YORK) };
    expect(moved.timezone).toBe(NEW_YORK);
    expect(moved.start).toBe("2026-11-27T05:00:00.000Z");
    expect(eventSpan(moved)).toEqual(eventSpan(event));
    expect(moved.exceptions).toEqual([
      dayStart("2026-12-04", NEW_YORK).toISOString(),
    ]);
    expect(moved.until).toBe(dayStart("2026-12-25", NEW_YORK).toISOString());
    // The excluded day is still excluded.
    expect(
      occurrences(
        moved,
        new Date("2026-11-20T00:00:00Z"),
        new Date("2026-12-31T00:00:00Z")
      ).map((e) => eventSpan(e).first)
    ).toEqual(["2026-11-27", "2026-12-11", "2026-12-18", "2026-12-25"]);
    expect(retimeAllDay(wholeDays("2026-11-27", "2026-11-27"), NEW_YORK)).not.toHaveProperty(
      "until"
    );
  });
});

describe("ICS with whole-day events", () => {
  it("writes whole days as dates and reads them back unchanged", async () => {
    const conference = wholeDays("2026-11-27", "2026-11-29", SEOUL, {
      title: "Conference",
    });
    const ics = await exportICS([conference]);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261127");
    // The end date is the day after the last day.
    expect(ics).toContain("DTEND;VALUE=DATE:20261130");
    // Dates need no timezone definition.
    expect(ics).not.toContain("BEGIN:VTIMEZONE");
    const { events, skipped } = readICS(ics, NEW_YORK);
    expect(skipped).toEqual([]);
    expect(events).toEqual([{ ...conference, until: undefined }]);
    expect(importICS(ics)[0].allDay).toBe(true);
  });

  it("round-trips a repeating whole-day event with its end date and excluded days", async () => {
    const weekly = wholeDays("2026-11-27", "2026-11-27", SEOUL, {
      repeat: "weekly",
      until: dayStart("2026-12-25", SEOUL).toISOString(),
      exceptions: [dayStart("2026-12-04", SEOUL).toISOString()],
    });
    const ics = await exportICS([weekly]);
    expect(ics).toContain("RRULE:FREQ=WEEKLY;UNTIL=20261225");
    expect(ics).toContain("EXDATE;VALUE=DATE:20261204");
    expect(readICS(ics, "UTC").events).toEqual([weekly]);
  });

  it("still writes timed events with their timezone, beside whole-day ones", async () => {
    const meeting = timed("2026-11-27T00:00:00.000Z", "2026-11-27T01:00:00.000Z", {
      id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    });
    const ics = await exportICS([meeting, wholeDays("2026-11-28", "2026-11-28")]);
    expect(ics).toContain("DTSTART;TZID=Asia/Seoul:20261127T090000");
    expect(ics.match(/BEGIN:VTIMEZONE/g)).toHaveLength(1);
    expect(readICS(ics).events.map((e) => !!e.allDay)).toEqual([false, true]);
    // A whole-day event in a zone without a definition can still be written.
    await expect(
      exportICS([wholeDays("2026-11-28", "2026-11-28", "Etc/GMT-14")])
    ).resolves.toContain("DTSTART;VALUE=DATE:20261128");
    await expect(
      exportICS([{ ...meeting, timezone: "Etc/GMT-14" }])
    ).rejects.toThrow("Unsupported ICS timezone");
  });

  it("drops the whole-day mark when the same event comes back timed", () => {
    const before = wholeDays("2026-11-27", "2026-11-27", SEOUL, {
      reminderMinutes: 900,
    });
    const again = timed("2026-11-27T00:00:00.000Z", "2026-11-27T01:00:00.000Z");
    const [merged] = mergeImported([before], [again]);
    expect(merged.allDay).toBeUndefined();
    expect(merged.reminderMinutes).toBe(900);
    expect(mergeImported([again], [before])[0].allDay).toBe(true);
  });
});

describe("ICS import that takes what it can", () => {
  const file = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Seoul",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0900",
    "TZOFFSETTO:+0900",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    "UID:utc-1@example.org",
    "DTSTART:20261127T000000Z",
    "DTEND:20261127T010000Z",
    "SUMMARY:Lab meeting",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "SUMMARY:Alarm title",
    "DTSTART:20200101T000000Z",
    "TRIGGER:-PT15M",
    "END:VALARM",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:allday-1@example.org",
    "DTSTART;VALUE=DATE:20261127",
    "DTEND;VALUE=DATE:20261130",
    "SUMMARY:Conference",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:byday@example.org",
    "DTSTART;TZID=Asia/Seoul:20261109T090000",
    "DTEND;TZID=Asia/Seoul:20261109T100000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
    "SUMMARY:Twice a week",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:windows@example.org",
    'DTSTART;TZID="Korea Standard Time":20261110T090000',
    'DTEND;TZID="Korea Standard Time":20261110T100000',
    "SUMMARY:Outlook event",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:nostart@example.org",
    "SUMMARY:No start",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:noend@example.org",
    "DTSTART:20261111T000000Z",
    "SUMMARY:No end",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:backwards@example.org",
    "DTSTART:20261112T020000Z",
    "DTEND:20261112T010000Z",
    "SUMMARY:Backwards",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:utc-1@example.org",
    "RECURRENCE-ID:20261127T000000Z",
    "DTSTART:20261127T030000Z",
    "DTEND:20261127T040000Z",
    "SUMMARY:Moved once",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:allday-1@example.org",
    "DTSTART;VALUE=DATE:20261201",
    "SUMMARY:Same id again",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:duration@example.org",
    "DTSTART;TZID=Asia/Seoul:20261113T140000",
    "DURATION:PT1H30M",
    "SUMMARY:With\\, a duration and a long title that is fol",
    " ded",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:floating@example.org",
    "DTSTART:20261114T090000",
    "DTEND:20261114T100000",
    "RRULE:FREQ=DAILY;INTERVAL=1;UNTIL=20261120T000000Z",
    "EXDATE:20261115T090000",
    "EXDATE:20261116T090000,20261117T090000",
    "SUMMARY:Floating",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("imports every event it can read and says why it left each of the others", () => {
    const { events, skipped } = readICS(file, NEW_YORK);
    expect(events.map((e) => e.title)).toEqual([
      "Lab meeting",
      "Conference",
      "With, a duration and a long title that is folded",
      "Floating",
    ]);
    expect(skipped).toEqual([
      { title: "Twice a week", when: "2026-11-09 09:00", reason: "recurrence" },
      { title: "Outlook event", when: "2026-11-10 09:00", reason: "timezone" },
      { title: "No start", when: "", reason: "start" },
      { title: "No end", when: "2026-11-11 00:00", reason: "end" },
      { title: "Backwards", when: "2026-11-12 02:00", reason: "dates" },
      { title: "Moved once", when: "2026-11-27 03:00", reason: "override" },
      { title: "Same id again", when: "2026-12-01", reason: "duplicate" },
    ]);
  });

  it("reads each kind of time the way the file means it", () => {
    const [meeting, conference, withDuration, floating] = readICS(
      file,
      NEW_YORK
    ).events;
    // The alarm inside the event did not replace its title or its start.
    expect(meeting).toMatchObject({
      start: "2026-11-27T00:00:00.000Z",
      end: "2026-11-27T01:00:00.000Z",
      timezone: "UTC",
      repeat: "none",
    });
    expect(meeting.allDay).toBeUndefined();
    // Dates are whole days on this device's calendar.
    expect(conference).toMatchObject({
      allDay: true,
      timezone: NEW_YORK,
      ...allDayRange("2026-11-27", "2026-11-29", NEW_YORK),
    });
    expect(withDuration).toMatchObject({
      start: "2026-11-13T05:00:00.000Z",
      end: "2026-11-13T06:30:00.000Z",
      timezone: SEOUL,
    });
    // A time with no zone is that clock time here: 09:00 in New York.
    expect(floating).toMatchObject({
      start: "2026-11-14T14:00:00.000Z",
      end: "2026-11-14T15:00:00.000Z",
      timezone: NEW_YORK,
      repeat: "daily",
      until: "2026-11-20T00:00:00.000Z",
      exceptions: [
        "2026-11-15T14:00:00.000Z",
        "2026-11-16T14:00:00.000Z",
        "2026-11-17T14:00:00.000Z",
      ],
    });
    expect(
      occurrences(
        floating,
        new Date("2026-11-14T00:00:00Z"),
        new Date("2026-11-30T00:00:00Z")
      ).map((e) => e.start.slice(0, 10))
    ).toEqual(["2026-11-14", "2026-11-18", "2026-11-19"]);
  });

  it("gives the same ids on a second import, so nothing is added twice", () => {
    const first = readICS(file, NEW_YORK).events,
      again = readICS(file, NEW_YORK).events;
    expect(again.map((e) => e.id)).toEqual(first.map((e) => e.id));
    expect(mergeImported(first, again)).toHaveLength(first.length);
  });

  it("reads single-day and odd whole-day forms", () => {
    const event = (...lines: string[]) =>
      readICS(
        ["BEGIN:VEVENT", "UID:x", ...lines, "END:VEVENT"].join("\n"),
        SEOUL
      );
    const span = (...lines: string[]) => eventSpan(event(...lines).events[0]);
    expect(span("DTSTART;VALUE=DATE:20261127")).toEqual({
      first: "2026-11-27",
      last: "2026-11-27",
    });
    // Some calendars repeat the start date as the end of a single day.
    expect(
      span("DTSTART;VALUE=DATE:20261127", "DTEND;VALUE=DATE:20261127")
    ).toEqual({ first: "2026-11-27", last: "2026-11-27" });
    expect(span("DTSTART;VALUE=DATE:20261127", "DURATION:P3D").last).toBe(
      "2026-11-29"
    );
    expect(
      event("DTSTART;VALUE=DATE:20261127", "DTEND;VALUE=DATE:20261120").skipped
    ).toMatchObject([{ reason: "dates" }]);
    expect(
      event("DTSTART;VALUE=DATE:20261127", "DTEND:20261128T000000Z").skipped
    ).toMatchObject([{ reason: "end" }]);
    // 31 February is not a date, and is not rolled over into March.
    expect(event("DTSTART;VALUE=DATE:20260231").skipped).toMatchObject([
      { reason: "start", when: "2026-02-31" },
    ]);
    expect(
      event(
        "DTSTART;VALUE=DATE:20261127",
        "RRULE:FREQ=WEEKLY;UNTIL=20261211",
        "EXDATE;VALUE=DATE:20261204"
      ).events[0]
    ).toMatchObject({
      repeat: "weekly",
      until: dayStart("2026-12-11", SEOUL).toISOString(),
      exceptions: [dayStart("2026-12-04", SEOUL).toISOString()],
    });
  });

  it("never approximates a repeat rule", () => {
    const reason = (rule: string, ...more: string[]) =>
      readICS(
        [
          "BEGIN:VEVENT",
          "DTSTART:20261127T000000Z",
          "DTEND:20261127T010000Z",
          rule,
          ...more,
          "END:VEVENT",
        ].join("\n")
      ).skipped[0]?.reason;
    expect(reason("RRULE:FREQ=WEEKLY")).toBeUndefined();
    expect(reason("RRULE:FREQ=MONTHLY;WKST=MO;INTERVAL=1")).toBeUndefined();
    expect(reason("RRULE:FREQ=WEEKLY;INTERVAL=2")).toBe("recurrence");
    expect(reason("RRULE:FREQ=DAILY;COUNT=5")).toBe("recurrence");
    expect(reason("RRULE:FREQ=YEARLY")).toBe("recurrence");
    expect(reason("RRULE:UNTIL=20261231T000000Z")).toBe("recurrence");
    expect(reason("RRULE:FREQ=DAILY", "RDATE:20261201T000000Z")).toBe(
      "recurrence"
    );
    // An exclusion that cannot be read is not dropped: that would bring the
    // excluded occurrence back.
    expect(reason("RRULE:FREQ=DAILY", "EXDATE:someday")).toBe("recurrence");
  });

  it("finds nothing in a file without events, and keeps the strict reader strict", () => {
    expect(readICS("")).toEqual({ events: [], skipped: [] });
    expect(readICS("not a calendar\nat all")).toEqual({
      events: [],
      skipped: [],
    });
    expect(readICS("BEGIN:VCALENDAR\r\nEND:VCALENDAR")).toEqual({
      events: [],
      skipped: [],
    });
    expect(() => importICS(file)).toThrow("Unsupported recurrence rule");
  });
});
