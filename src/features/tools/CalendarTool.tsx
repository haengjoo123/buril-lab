import { useState } from "react";
import {
  useText,
  useToolData,
  Panel,
  Field,
  Select,
  ErrorMessage,
  download,
} from "./ui";
import {
  type CalendarEvent,
  occurrences,
  exportICS,
  importICS,
} from "./calendar";
import { DeviceToggle, localDateInput } from "./TimeTools";
export default function CalendarTool() {
  const t = useText();
  const [d, set] = useToolData<{ events: CalendarEvent[] }>({ events: [] });
  const [view, setView] = useState("month"),
    [anchor, setAnchor] = useState(new Date()),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [search, setSearch] = useState("");
  const event = d.events.find((e) => e.id === selected);
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  if (view === "month") start.setDate(1);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(end.getDate() + (view === "week" ? 7 : 42));
  const list = d.events
    .flatMap((e) => occurrences(e, start, end))
    .filter((e) => e.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.start.localeCompare(b.start));
  const update = (patch: Partial<CalendarEvent>) =>
    set({
      ...d,
      events: d.events.map((e) => (e.id === selected ? { ...e, ...patch } : e)),
    });
  return (
    <>
      <Panel>
        <div className="tool-toolbar">
          <h2>
            {anchor.toLocaleDateString(t("ko-KR", "en-US"), {
              year: "numeric",
              month: "long",
            })}
          </h2>
          <button
            onClick={() => {
              const date = new Date(anchor);
              if (view === "week") date.setDate(date.getDate() - 7);
              else date.setMonth(date.getMonth() - 1);
              setAnchor(date);
            }}
          >
            ‹
          </button>
          <button onClick={() => setAnchor(new Date())}>
            {t("오늘", "Today")}
          </button>
          <button
            onClick={() => {
              const date = new Date(anchor);
              if (view === "week") date.setDate(date.getDate() + 7);
              else date.setMonth(date.getMonth() + 1);
              setAnchor(date);
            }}
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
          list.map((e) => (
            <button
              key={`${e.id}:${e.start}`}
              onClick={() => setSelected(e.id)}
            >
              {new Date(e.start).toLocaleString(t("ko-KR", "en-US"))} ·{" "}
              {e.title}
            </button>
          ))
        ) : (
          <div className="tool-calendar">
            {Array.from({ length: view === "week" ? 7 : 42 }, (_, i) => {
              const date = new Date(start);
              date.setDate(date.getDate() + i);
              return (
                <div className="tool-day" key={i}>
                  <span>
                    {date.toLocaleDateString(t("ko-KR", "en-US"), {
                      day: "numeric",
                      weekday: "short",
                    })}
                  </span>
                  {list
                    .filter(
                      (e) =>
                        new Date(e.start).toDateString() === date.toDateString()
                    )
                    .map((e) => (
                      <button
                        key={`${e.id}:${e.start}`}
                        onClick={() => setSelected(e.id)}
                      >
                        {e.title}
                        <br />
                        {new Date(e.start).toLocaleTimeString(
                          t("ko-KR", "en-US"),
                          {
                            hour: "2-digit",
                            minute: "2-digit",
                          }
                        )}
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
        )}
        <div className="tool-actions">
          <button
            className="primary"
            onClick={() => {
              const at = new Date();
              at.setMinutes(0, 0, 0);
              at.setHours(at.getHours() + 1);
              const e: CalendarEvent = {
                id: crypto.randomUUID(),
                title: t("새 일정", "New event"),
                start: at.toISOString(),
                end: new Date(+at + 3600000).toISOString(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                repeat: "none",
                exceptions: [],
                reminderMinutes: 0,
              };
              set({ ...d, events: [...d.events, e] });
              setSelected(e.id);
            }}
          >
            {t("일정 추가", "Add event")}
          </button>
          <button
            onClick={async () => {
              try {
                await download(
                  await exportICS(d.events),
                  "calendar.ics",
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
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const events = importICS(await file.text());
                  set({ ...d, events: [...d.events, ...events] });
                  setError("");
                } catch (e) {
                  setError(String(e));
                }
              }}
            />
          </label>
        </div>
        <ErrorMessage message={error} />
      </Panel>
      {event && (
        <Panel title={t("일정 편집", "Edit event")}>
          <Field
            type="text"
            label={t("제목", "Title")}
            value={event.title}
            onChange={(title) => update({ title })}
          />
          <div className="tool-grid">
            <Field
              type="datetime-local"
              label={t("시작 (기기 시간대)", "Start (device timezone)")}
              value={localDateInput(new Date(event.start))}
              onChange={(start) => {
                if (start) update({ start: new Date(start).toISOString() });
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
            <Field
              type="text"
              label={t("반복 기준 시간대 (IANA)", "Recurrence timezone (IANA)")}
              value={event.timezone}
              onChange={(timezone) => {
                try {
                  new Intl.DateTimeFormat("en", { timeZone: timezone });
                  update({ timezone });
                  setError("");
                } catch {
                  setError(
                    t(
                      "올바른 IANA 시간대를 입력하세요.",
                      "Enter a valid IANA timezone."
                    )
                  );
                }
              }}
            />
            <Select
              label={t("반복", "Repeat")}
              value={event.repeat}
              onChange={(repeat) =>
                update({ repeat: repeat as CalendarEvent["repeat"] })
              }
              options={["none", "daily", "weekly", "monthly"]}
            />
            <Field
              type="datetime-local"
              label={t("반복 종료 (선택)", "Repeat until (optional)")}
              value={event.until ? localDateInput(new Date(event.until)) : ""}
              onChange={(until) =>
                update({
                  until: until ? new Date(until).toISOString() : undefined,
                })
              }
            />
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
          <label className="tool-field">
            <span>
              {t(
                "제외할 발생 시각 (현재 기기 시간대)",
                "Occurrence to exclude (device timezone)"
              )}
            </span>
            <input
              type="datetime-local"
              onChange={(e) => {
                if (e.target.value)
                  update({
                    exceptions: [
                      ...new Set([
                        ...event.exceptions,
                        new Date(e.target.value).toISOString(),
                      ]),
                    ],
                  });
              }}
            />
          </label>
          {event.exceptions.map((ex) => (
            <div key={ex}>
              {new Date(ex).toLocaleString(t("ko-KR", "en-US"))}{" "}
              <button
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
              set({ ...d, events: d.events.filter((e) => e.id !== selected) });
              setSelected("");
            }}
          >
            {t("일정 삭제", "Delete event")}
          </button>
        </Panel>
      )}
    </>
  );
}
