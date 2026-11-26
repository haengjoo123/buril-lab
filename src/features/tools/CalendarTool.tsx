import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  useText,
  useToolData,
  useUndo,
  useExportName,
  Panel,
  Field,
  Select,
  CheckButton,
  EmptyState,
  ErrorMessage,
  download,
} from "./ui";
import {
  type CalendarEvent,
  type IcsSkipped,
  type IcsSkipReason,
  addDays,
  allDayRange,
  dateKey,
  dayStart,
  deviceTimeZone,
  eventSpan,
  occurrencesTouching,
  exportICS,
  readICS,
  mergeImported,
  retimeAllDay,
  shiftAnchor,
  spanDays,
} from "./calendar";
import DeviceToggle from "./DeviceToggle";
import { localDateInput } from "./clock";
const DAY = 86_400_000;
const two = (n: number) => String(n).padStart(2, "0");
/** The calendar day of a date on this device, as "YYYY-MM-DD". */
const localKey = (date: Date) =>
  `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
/** A time on a calendar day, on this device. */
const localTime = (key: string, hour = 0) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, hour);
};
/**
 * When a whole-day event reminds, as minutes before its first midnight. The
 * reminder is planned from the start of the event, which for a whole day is
 * 00:00, so "09:00 the day before" is 15 hours ahead of it and "09:00 on the
 * day" is nine hours after it (a negative lead).
 */
const allDayReminders = [
  [-540, "당일 오전 9시", "At 09:00 on the day"],
  [0, "당일 0시", "At 00:00 on the day"],
  [360, "전날 오후 6시", "At 18:00 the day before"],
  [900, "전날 오전 9시", "At 09:00 the day before"],
  [2340, "이틀 전 오전 9시", "At 09:00 two days before"],
] as const;
const validTimezone = (timezone: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return timezone.trim() !== "";
  } catch {
    return false;
  }
};
/**
 * "Asia/Seoul" is only valid once it is complete, so the text being typed is
 * kept here and the event is updated when it names a real timezone. Leaving the
 * field with an invalid name restores the saved one.
 */
function TimezoneField({
  label,
  invalid,
  timezone,
  onCommit,
}: {
  label: string;
  invalid: string;
  timezone: string;
  onCommit: (timezone: string) => void;
}) {
  const [text, setText] = useState(timezone);
  const zones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  return (
    <label className="tool-field">
      <span>{label}</span>
      <input
        type="text"
        list="tool-calendar-timezones"
        autoCapitalize="none"
        spellCheck={false}
        value={text}
        aria-invalid={!validTimezone(text)}
        onChange={(e) => {
          setText(e.target.value);
          if (validTimezone(e.target.value)) onCommit(e.target.value);
        }}
        onBlur={() => {
          if (!validTimezone(text)) setText(timezone);
        }}
      />
      <datalist id="tool-calendar-timezones">
        {zones.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      {!validTimezone(text) && (
        <small className="tool-error" role="alert">
          {invalid}
        </small>
      )}
    </label>
  );
}
/**
 * A date-time field reports a change for every part typed, so excluding on
 * change added one exclusion per keystroke. The value is collected here and
 * added once, on request. A whole-day event is excluded by its date.
 */
function ExceptionField({
  label,
  add,
  type,
  onAdd,
}: {
  label: string;
  add: string;
  type: "date" | "datetime-local";
  /** The field's value: "YYYY-MM-DD", or with "THH:mm" for a date and time. */
  onAdd: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  const usable = value !== "" && !Number.isNaN(+new Date(value));
  return (
    <div className="tool-actions">
      <label className="tool-field">
        <span>{label}</span>
        <input
          type={type}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <button
        disabled={!usable}
        onClick={() => {
          if (!usable) return;
          onAdd(value);
          setValue("");
        }}
      >
        {add}
      </button>
    </div>
  );
}
export default function CalendarTool() {
  const t = useText(),
    exportName = useExportName();
  const [d, set] = useToolData<{ events: CalendarEvent[] }>({ events: [] });
  const [undoBar, offerUndo] = useUndo();
  const [view, setView] = useState("month"),
    [anchor, setAnchor] = useState(new Date()),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [report, setReport] = useState<{
      imported: number;
      updated: number;
      skipped: IcsSkipped[];
    } | null>(null);
  const editor = useRef<HTMLDivElement>(null),
    titleInput = useRef<HTMLInputElement>(null),
    // The event that was just made: its title is selected, ready to be named.
    fresh = useRef("");
  const event = d.events.find((e) => e.id === selected);
  const editing = !!event;
  useEffect(() => {
    if (!selected || !editing) return;
    const panel = editor.current;
    // The editor is below the grid; on a phone that is off the screen.
    if (panel && typeof panel.scrollIntoView === "function")
      panel.scrollIntoView({ block: "nearest" });
    if (fresh.current === selected) {
      fresh.current = "";
      titleInput.current?.focus();
      titleInput.current?.select();
    }
  }, [selected, editing]);
  const locale = t("ko-KR", "en-US");
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  if (view === "month") start.setDate(1);
  start.setDate(start.getDate() - start.getDay());
  const cells = Array.from({ length: view === "week" ? 7 : 42 }, (_, i) => {
    const date = new Date(start);
    date.setDate(date.getDate() + i);
    return { date, key: localKey(date) };
  });
  const end = new Date(start);
  end.setDate(end.getDate() + cells.length);
  const firstKey = cells[0].key,
    lastKey = cells[cells.length - 1].key,
    today = localKey(new Date()),
    zone = deviceTimeZone();
  // A day is added on each side because a whole-day event keeps the dates of
  // its own timezone, which may begin up to a day away from this device's.
  const list = d.events
    .flatMap((e) =>
      occurrencesTouching(e, new Date(+start - DAY), new Date(+end + DAY))
    )
    .filter((e) => e.title.toLowerCase().includes(search.trim().toLowerCase()))
    .map((e) => ({ event: e, span: eventSpan(e, zone) }))
    .filter(({ span }) => span.first <= lastKey && span.last >= firstKey)
    .sort(
      (a, b) =>
        a.event.start.localeCompare(b.event.start) ||
        a.event.title.localeCompare(b.event.title)
    );
  const dayText = (key: string) =>
      localTime(key).toLocaleDateString(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        weekday: "short",
      }),
    timeText = (iso: string) =>
      new Date(iso).toLocaleTimeString(locale, {
        hour: "2-digit",
        minute: "2-digit",
      });
  const whenText = ({ event: e, span }: (typeof list)[number]) =>
    e.allDay
      ? `${dayText(span.first)}${
          span.last === span.first ? "" : ` – ${dayText(span.last)}`
        } · ${t("종일", "All day")}`
      : span.first === span.last
      ? `${dayText(span.first)} ${timeText(e.start)}`
      : `${dayText(span.first)} ${timeText(e.start)} – ${dayText(
          span.last
        )} ${timeText(e.end)}`;
  const update = (patch: Partial<CalendarEvent>) =>
    set({
      ...d,
      events: d.events.map((e) => (e.id === selected ? { ...e, ...patch } : e)),
    });
  const addEvent = (at: Date) => {
    const e: CalendarEvent = {
      id: crypto.randomUUID(),
      title: t("새 일정", "New event"),
      start: at.toISOString(),
      end: new Date(+at + 3600000).toISOString(),
      timezone: zone,
      repeat: "none",
      exceptions: [],
      reminderMinutes: 0,
    };
    set({ ...d, events: [...d.events, e] });
    fresh.current = e.id;
    setSelected(e.id);
  };
  const span = event ? eventSpan(event, zone) : null;
  // Only a whole-day event can remind after its start (see allDayReminders).
  const reminder =
    event && Number.isFinite(event.reminderMinutes)
      ? Math.max(event.allDay ? -1439 : 0, event.reminderMinutes)
      : 0;
  const reasonText = (reason: IcsSkipReason) =>
    ({
      start: t(
        "시작 일시가 없거나 읽을 수 없습니다.",
        "The start is missing or cannot be read."
      ),
      end: t(
        "종료 일시나 기간이 없거나 읽을 수 없습니다.",
        "The end or duration is missing or cannot be read."
      ),
      timezone: t(
        "지원하지 않는 시간대 이름입니다. Asia/Seoul 같은 IANA 이름만 읽습니다.",
        "The timezone name is not supported. Only IANA names such as Asia/Seoul are read."
      ),
      recurrence: t(
        "지원하지 않는 반복 규칙입니다. 매일·매주·매월 반복과 종료일만 지원합니다.",
        "The repeat rule is not supported. Daily, weekly or monthly repeats with an end date are."
      ),
      override: t(
        "반복 일정에서 따로 바꾼 회차는 가져오지 않습니다.",
        "A changed occurrence of a repeating event is not imported."
      ),
      dates: t("종료가 시작보다 빠릅니다.", "It ends before it starts."),
      duplicate: t(
        "파일 안에 같은 일정이 한 번 더 있습니다.",
        "The same event appears earlier in the file."
      ),
    }[reason]);
  return (
    <>
      {undoBar}
      <Panel>
        <div className="tool-toolbar">
          <h2>
            {anchor.toLocaleDateString(locale, {
              year: "numeric",
              month: "long",
            })}
          </h2>
          <button
            aria-label={
              view === "week"
                ? t("이전 주", "Previous week")
                : t("이전 달", "Previous month")
            }
            onClick={() => setAnchor(shiftAnchor(anchor, view, -1))}
          >
            ‹
          </button>
          <button onClick={() => setAnchor(new Date())}>
            {t("오늘", "Today")}
          </button>
          <button
            aria-label={
              view === "week"
                ? t("다음 주", "Next week")
                : t("다음 달", "Next month")
            }
            onClick={() => setAnchor(shiftAnchor(anchor, view, 1))}
          >
            ›
          </button>
        </div>
        <div className="tool-grid">
          <Select
            label={t("보기", "View")}
            value={view}
            onChange={setView}
            options={[
              ["month", t("월", "Month")],
              ["week", t("주", "Week")],
              ["list", t("목록", "List")],
            ]}
          />
          <Field
            label={t("일정 검색", "Search events")}
            type="search"
            value={search}
            onChange={setSearch}
          />
        </div>
        {view === "list" ? (
          <div className="tool-calendar-x-list">
            {list.map((item) => (
              <button
                className="tool-calendar-x-row"
                key={`${item.event.id}:${item.event.start}`}
                aria-pressed={item.event.id === selected}
                onClick={() => setSelected(item.event.id)}
              >
                <span>{whenText(item)}</span>
                <strong>{item.event.title}</strong>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="tool-calendar">
              {cells.map(({ date, key }) => {
                const isToday = key === today,
                  outside =
                    view === "month" && date.getMonth() !== anchor.getMonth();
                // Whole-day and multi-day events first, so that one event
                // tends to sit at the same height across the days it covers.
                const dayEvents = list
                  .filter(({ span }) => span.first <= key && span.last >= key)
                  .sort(
                    (a, b) =>
                      Number(!!b.event.allDay || b.span.first !== b.span.last) -
                      Number(!!a.event.allDay || a.span.first !== a.span.last)
                  );
                return (
                  <div
                    className={`tool-day tool-calendar-x-day${
                      isToday ? " tool-calendar-x-today" : ""
                    }${outside ? " tool-calendar-x-outside" : ""}`}
                    key={key}
                  >
                    <button
                      className="tool-calendar-x-date"
                      aria-current={isToday ? "date" : undefined}
                      aria-label={`${date.toLocaleDateString(locale, {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        weekday: "long",
                      })}${isToday ? `, ${t("오늘", "today")}` : ""} · ${t(
                        "일정 추가",
                        "add event"
                      )}`}
                      onClick={() => addEvent(localTime(key, 9))}
                    >
                      <span>
                        {date.toLocaleDateString(
                          locale,
                          date.getDate() === 1
                            ? { month: "short", day: "numeric" }
                            : { day: "numeric" }
                        )}
                      </span>
                      <span className="tool-calendar-x-weekday">
                        {date.toLocaleDateString(locale, { weekday: "short" })}
                      </span>
                      {isToday && <small>{t("오늘", "Today")}</small>}
                    </button>
                    {dayEvents.map(({ event: e, span }) => {
                      const total = spanDays(span),
                        detail =
                          total > 1
                            ? [
                                t(
                                  `${spanDays({
                                    first: span.first,
                                    last: key,
                                  })}/${total}일`,
                                  `Day ${spanDays({
                                    first: span.first,
                                    last: key,
                                  })}/${total}`
                                ),
                                !e.allDay && key === span.first
                                  ? timeText(e.start)
                                  : "",
                                !e.allDay && key === span.last
                                  ? `~${timeText(e.end)}`
                                  : "",
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            : e.allDay
                            ? t("종일", "All day")
                            : timeText(e.start);
                      return (
                        <button
                          className={`tool-calendar-x-event${
                            e.allDay || total > 1 ? " is-whole" : ""
                          }${span.first < key ? " is-before" : ""}${
                            span.last > key ? " is-after" : ""
                          }`}
                          key={`${e.id}:${e.start}`}
                          aria-label={`${e.title}, ${detail}`}
                          aria-pressed={e.id === selected}
                          onClick={() => setSelected(e.id)}
                        >
                          <span>{e.title}</span>
                          <small>{detail}</small>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <p className="tool-muted tool-calendar-x-hint">
              {t(
                "날짜를 누르면 그 날짜에 새 일정을 만듭니다.",
                "Press a date to add an event on that day."
              )}
            </p>
          </>
        )}
        {d.events.length === 0 ? (
          <EmptyState title={t("일정이 없습니다", "No events yet")}>
            <p>
              {t(
                "‘일정 추가’를 누르거나 월·주 보기에서 날짜를 눌러 첫 일정을 만드세요. ICS 파일에서 가져올 수도 있습니다.",
                "Press Add event, or a date in the month or week view, to make your first one. You can also import an ICS file."
              )}
            </p>
          </EmptyState>
        ) : (
          view === "list" &&
          list.length === 0 && (
            <EmptyState
              title={
                search.trim()
                  ? t("검색에 맞는 일정이 없습니다", "No events match")
                  : t("이 기간에 일정이 없습니다", "No events in this period")
              }
            >
              <p>
                {t(
                  "목록은 표시한 달의 이번 주부터 6주 동안의 일정을 보여 줍니다. ‹ ›로 기간을 옮기세요.",
                  "The list shows six weeks from the week shown. Use ‹ and › to move."
                )}
              </p>
            </EmptyState>
          )
        )}
        <div className="tool-actions">
          <button
            className="primary"
            onClick={() => {
              const at = new Date();
              at.setMinutes(0, 0, 0);
              at.setHours(at.getHours() + 1);
              // Shows the new event if another month was being looked at.
              setAnchor(at);
              addEvent(at);
            }}
          >
            {t("일정 추가", "Add event")}
          </button>
          <button
            onClick={async () => {
              try {
                await download(
                  await exportICS(d.events),
                  exportName("ics"),
                  "text/calendar"
                );
                setError("");
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            {t("ICS 내보내기", "Export ICS")}
          </button>
          <label>
            {t("ICS 가져오기", "Import ICS")}
            <input
              type="file"
              accept=".ics,text/calendar"
              onChange={async (e) => {
                const input = e.target,
                  file = input.files?.[0];
                if (!file) return;
                try {
                  const { events, skipped } = readICS(await file.text());
                  const before = d.events,
                    known = new Set(before.map((old) => old.id));
                  if (events.length) {
                    set((old) => ({
                      ...old,
                      events: mergeImported(old.events, events),
                    }));
                    offerUndo(
                      t(
                        `일정 ${events.length}개를 가져왔습니다.`,
                        `Events imported: ${events.length}.`
                      ),
                      () => set((old) => ({ ...old, events: before }))
                    );
                  }
                  setReport({
                    imported: events.length,
                    updated: events.filter((item) => known.has(item.id)).length,
                    skipped,
                  });
                  setError("");
                } catch (e) {
                  setReport(null);
                  setError(String(e));
                } finally {
                  // Otherwise choosing the same file again fires no change.
                  input.value = "";
                }
              }}
            />
          </label>
        </div>
        <ErrorMessage message={error} />
        {report && (
          <div className="tool-calendar-x-report" role="status">
            <div>
              <strong>
                {report.imported + report.skipped.length === 0
                  ? t(
                      "이 파일에서 일정을 찾지 못했습니다.",
                      "No events were found in this file."
                    )
                  : [
                      t(
                        `가져온 일정 ${report.imported}개 (새 일정 ${
                          report.imported - report.updated
                        }개, 기존 일정 갱신 ${report.updated}개).`,
                        `Imported: ${report.imported} (new ${
                          report.imported - report.updated
                        }, updated ${report.updated}).`
                      ),
                      report.skipped.length
                        ? t(
                            `가져오지 못한 일정 ${report.skipped.length}개:`,
                            `Not imported: ${report.skipped.length}:`
                          )
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
              </strong>
              <button
                aria-label={t("가져오기 결과 닫기", "Dismiss import result")}
                onClick={() => setReport(null)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            {report.skipped.length > 0 && (
              <ul>
                {report.skipped.slice(0, 50).map((entry, index) => (
                  <li key={index}>
                    <strong>
                      {entry.title || t("(제목 없음)", "(untitled)")}
                    </strong>
                    {entry.when && <span> · {entry.when}</span>}
                    {" — "}
                    {reasonText(entry.reason)}
                  </li>
                ))}
                {report.skipped.length > 50 && (
                  <li>
                    {t(
                      `외 ${report.skipped.length - 50}개`,
                      `and ${report.skipped.length - 50} more`
                    )}
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </Panel>
      {event && span && (
        <div ref={editor}>
          <Panel title={t("일정 편집", "Edit event")}>
            <label className="tool-field">
              <span>{t("제목", "Title")}</span>
              <input
                ref={titleInput}
                type="text"
                value={event.title}
                onChange={(e) => update({ title: e.target.value })}
              />
            </label>
            <CheckButton
              checked={!!event.allDay}
              onChange={(allDay) => {
                if (allDay) {
                  // The days it is on as seen here become its dates.
                  const days = eventSpan({ ...event, allDay: false }, zone);
                  update({
                    allDay: true,
                    ...allDayRange(days.first, days.last, event.timezone),
                  });
                } else
                  update({
                    allDay: undefined,
                    start: localTime(span.first, 9).toISOString(),
                    end: localTime(span.last, 10).toISOString(),
                    // A timed event cannot remind after it has started.
                    reminderMinutes: Math.max(0, reminder),
                  });
              }}
            >
              {t("종일", "All day")}
            </CheckButton>
            <div className="tool-grid">
              {event.allDay ? (
                <>
                  <Field
                    type="date"
                    label={t("시작일", "Start date")}
                    value={span.first}
                    onChange={(first) => {
                      // Moving the start keeps the number of days.
                      if (first)
                        update(
                          allDayRange(
                            first,
                            addDays(first, spanDays(span) - 1),
                            event.timezone
                          )
                        );
                    }}
                  />
                  <Field
                    type="date"
                    label={t("종료일 (포함)", "End date (inclusive)")}
                    value={span.last}
                    onChange={(last) => {
                      // An end before the start makes it that one day.
                      if (last)
                        update(
                          allDayRange(
                            last < span.first ? last : span.first,
                            last,
                            event.timezone
                          )
                        );
                    }}
                  />
                </>
              ) : (
                <>
                  <Field
                    type="datetime-local"
                    label={t("시작 (기기 시간대)", "Start (device timezone)")}
                    value={localDateInput(new Date(event.start))}
                    onChange={(start) => {
                      if (start)
                        update({ start: new Date(start).toISOString() });
                    }}
                  />
                  <Field
                    type="datetime-local"
                    label={t("종료 (기기 시간대)", "End (device timezone)")}
                    value={localDateInput(new Date(event.end))}
                    onChange={(end) => {
                      if (end) update({ end: new Date(end).toISOString() });
                    }}
                  />
                </>
              )}
              <TimezoneField
                key={event.id}
                label={
                  event.allDay
                    ? t("날짜 기준 시간대 (IANA)", "Timezone of the dates (IANA)")
                    : t("반복 기준 시간대 (IANA)", "Recurrence timezone (IANA)")
                }
                invalid={t(
                  "올바른 IANA 시간대를 입력하세요. 예: Asia/Seoul",
                  "Enter a valid IANA timezone, for example Asia/Seoul."
                )}
                timezone={event.timezone}
                onCommit={(timezone) =>
                  // A whole day keeps its dates: its midnights move with the zone.
                  update(
                    event.allDay ? retimeAllDay(event, timezone) : { timezone }
                  )
                }
              />
              <Select
                label={t("반복", "Repeat")}
                value={event.repeat}
                onChange={(repeat) =>
                  update({ repeat: repeat as CalendarEvent["repeat"] })
                }
                options={["none", "daily", "weekly", "monthly"]}
              />
              {event.allDay ? (
                <Field
                  type="date"
                  label={t("반복 종료일 (선택)", "Repeat until (optional)")}
                  value={
                    event.until ? dateKey(event.until, event.timezone) : ""
                  }
                  onChange={(until) =>
                    update({
                      until: until
                        ? dayStart(until, event.timezone).toISOString()
                        : undefined,
                    })
                  }
                />
              ) : (
                <Field
                  type="datetime-local"
                  label={t("반복 종료 (선택)", "Repeat until (optional)")}
                  value={
                    event.until ? localDateInput(new Date(event.until)) : ""
                  }
                  onChange={(until) =>
                    update({
                      until: until ? new Date(until).toISOString() : undefined,
                    })
                  }
                />
              )}
              {event.allDay ? (
                <Select
                  label={t("알림 시각", "Reminder time")}
                  value={String(reminder)}
                  onChange={(minutes) =>
                    update({ reminderMinutes: Number(minutes) })
                  }
                  options={[
                    ...allDayReminders.map(
                      ([minutes, ko, en]) =>
                        [String(minutes), t(ko, en)] as const
                    ),
                    ...(allDayReminders.some(
                      ([minutes]) => minutes === reminder
                    )
                      ? []
                      : [
                          [
                            String(reminder),
                            t(
                              `첫날 0시 ${reminder}분 전`,
                              `${reminder} min before 00:00 on the first day`
                            ),
                          ] as const,
                        ]),
                  ]}
                />
              ) : (
                <Field
                  label={t(
                    "시작 몇 분 전 알림 (0: 시작 시각)",
                    "Reminder minutes before start (0: at start)"
                  )}
                  value={event.reminderMinutes}
                  onChange={(v) =>
                    update({ reminderMinutes: Math.max(0, Number(v)) })
                  }
                />
              )}
            </div>
            {new Date(event.end) <= new Date(event.start) && (
              <ErrorMessage
                message={t(
                  "종료는 시작 이후여야 합니다.",
                  "End must follow start."
                )}
              />
            )}
            <DeviceToggle id={event.id} />
            <ExceptionField
              key={`${event.id}:${event.allDay ? "date" : "time"}`}
              type={event.allDay ? "date" : "datetime-local"}
              label={
                event.allDay
                  ? t("제외할 날짜", "Date to exclude")
                  : t(
                      "제외할 발생 시각 (현재 기기 시간대)",
                      "Occurrence to exclude (device timezone)"
                    )
              }
              add={t("제외 추가", "Add exclusion")}
              onAdd={(value) =>
                update({
                  exceptions: [
                    ...new Set([
                      ...event.exceptions,
                      (event.allDay
                        ? dayStart(value, event.timezone)
                        : new Date(value)
                      ).toISOString(),
                    ]),
                  ],
                })
              }
            />
            {event.exceptions.map((ex) => (
              <div key={ex}>
                {event.allDay
                  ? dayText(dateKey(+new Date(ex) + DAY / 4, event.timezone))
                  : new Date(ex).toLocaleString(locale)}{" "}
                <button
                  aria-label={t("제외 취소", "Remove exclusion")}
                  onClick={() =>
                    update({
                      exceptions: event.exceptions.filter((v) => v !== ex),
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <button
              onClick={() => {
                const before = d.events;
                set({ ...d, events: before.filter((e) => e.id !== selected) });
                setSelected("");
                offerUndo(
                  t("일정을 삭제했습니다.", "Event deleted."),
                  () => set((old) => ({ ...old, events: before }))
                );
              }}
            >
              {t("일정 삭제", "Delete event")}
            </button>
          </Panel>
        </div>
      )}
    </>
  );
}
