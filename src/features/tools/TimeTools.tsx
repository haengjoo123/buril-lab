/* eslint-disable react-refresh/only-export-components -- Time widgets share clock and notification primitives. */
import { useContext, useEffect, useState } from "react";
import {
  ToolContext,
  Field,
  Panel,
  Select,
  useText,
  useToolData,
  ErrorMessage,
  ColorField,
} from "./ui";
import {
  deviceEnabled,
  enableNotifications,
  setDeviceEnabled,
} from "./notifications";
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
};
export const elapsedTime = (clock: Clock, now: number) =>
  clock.elapsed + (clock.running && clock.started ? now - clock.started : 0);
export const remainingTime = (clock: Clock, now: number) =>
  clock.running && clock.end ? Math.max(0, clock.end - now) : clock.remaining;
export function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  return now;
}
export const clockText = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((seconds / 60) % 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
};
function DurationInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (milliseconds: number) => void;
}) {
  const t = useText(),
    seconds = Math.floor(value / 1000),
    parts = [
      Math.floor(seconds / 3600),
      Math.floor(seconds / 60) % 60,
      seconds % 60,
    ];
  return (
    <div className="tool-duration-input">
      {parts.map((part, index) => (
        <Field
          key={index}
          label={t(
            ["시간", "분", "초"][index],
            ["Hours", "Minutes", "Seconds"][index]
          )}
          min={0}
          step="1"
          value={part}
          onChange={(text) => {
            const next = [...parts];
            next[index] = Math.max(0, Math.floor(Number(text) || 0));
            onChange((next[0] * 3600 + next[1] * 60 + next[2]) * 1000);
          }}
        />
      ))}
    </div>
  );
}
export function DeviceToggle({ id }: { id: string }) {
  const ctx = useContext(ToolContext)!,
    t = useText();
  const [enabled, setEnabled] = useState(() =>
      deviceEnabled(ctx.repo.owner, id)
    ),
    [error, setError] = useState("");
  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={async (e) => {
            const on = e.target.checked;
            try {
              if (on) await enableNotifications();
              setDeviceEnabled(ctx.repo.owner, id, on);
              setEnabled(on);
              setError("");
            } catch (e) {
              setError(String(e));
            }
          }}
        />
        {t("이 기기에서 알림", "Notify on this device")}
      </label>
      <ErrorMessage message={error} />
    </>
  );
}
export function TimerTool({ stopwatch = false }: { stopwatch?: boolean }) {
  const t = useText(),
    now = useNow(),
    ctx = useContext(ToolContext)!;
  const initialClock: Clock = {
    id: `stopwatch-${ctx.doc.id}`,
    name: t("스톱워치", "Stopwatch"),
    color: "#2563eb",
    duration: 0,
    remaining: 0,
    end: null,
    running: false,
    elapsed: 0,
    started: null,
  };
  const [d, set] = useToolData<{ clocks: Clock[] }>({
    clocks: stopwatch ? [initialClock] : [],
  });
  const clocks = stopwatch && !d.clocks.length ? [initialClock] : d.clocks;
  const [permissionError, setPermissionError] = useState("");
  const [duration, setDuration] = useState(60000),
    [timerName, setTimerName] = useState("");
  const update = (id: string, patch: Partial<Clock>) =>
    set({
      ...d,
      clocks: clocks.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  return (
    <>
      {!stopwatch && (
        <section className="tool-timer-create">
          <Field
            label={t("타이머 이름", "Timer name")}
            type="text"
            value={timerName}
            onChange={setTimerName}
          />
          <DurationInput value={duration} onChange={setDuration} />
          <div className="tool-actions tool-duration-presets">
            {[1, 5, 10, 30].map((minutes) => (
              <button
                key={minutes}
                aria-pressed={duration === minutes * 60000}
                onClick={() => setDuration(minutes * 60000)}
              >
                {minutes}
                {t("분", " min")}
              </button>
            ))}
          </div>
          <button
            className="primary"
            disabled={duration <= 0 || !Number.isFinite(duration)}
            onClick={() => {
              const id = crypto.randomUUID();
              set({
                ...d,
                clocks: [
                  ...d.clocks,
                  {
                    id,
                    name:
                      timerName.trim() ||
                      `${t("타이머", "Timer")} ${d.clocks.length + 1}`,
                    color: "#2563eb",
                    duration,
                    remaining: duration,
                    end: null,
                    running: false,
                    elapsed: 0,
                    started: null,
                  },
                ],
              });
              if (!stopwatch) setDeviceEnabled(ctx.repo.owner, id, true);
              setTimerName("");
            }}
          >
            {t("타이머 추가", "Add timer")}
          </button>
        </section>
      )}
      {clocks.map((c) => (
        <Panel key={c.id}>
          <h2 className="tool-timer-name">
            <span style={{ background: c.color }} />
            {c.name}
          </h2>
          <details className="tool-guide tool-timer-settings">
            <summary>{t("이름·시간·색상", "Name, duration and color")}</summary>
            <div className="tool-grid">
              <Field
                label={t("이름", "Name")}
                type="text"
                value={c.name}
                onChange={(name) => update(c.id, { name })}
              />
              <ColorField
                label={t("색상", "Color")}
                value={c.color}
                onChange={(color) => update(c.id, { color })}
              />
              {!stopwatch && !c.running && (
                <DurationInput
                  value={c.duration}
                  onChange={(duration) =>
                    update(c.id, { duration, remaining: duration })
                  }
                />
              )}
            </div>
          </details>
          <div className="tool-clock">
            {clockText(stopwatch ? elapsedTime(c, now) : remainingTime(c, now))}
            {stopwatch && (
              <small style={{ fontSize: "40%" }}>
                .
                {Math.floor((elapsedTime(c, now) % 1000) / 10)
                  .toString()
                  .padStart(2, "0")}
              </small>
            )}
          </div>
          <div className="tool-actions">
            <button
              className="primary"
              disabled={!stopwatch && c.duration <= 0}
              onClick={async () => {
                if (
                  !stopwatch &&
                  !c.running &&
                  deviceEnabled(ctx.repo.owner, c.id)
                ) {
                  try {
                    await enableNotifications();
                    setPermissionError("");
                  } catch (e) {
                    setPermissionError(String(e));
                  }
                }
                const time = Date.now();
                update(
                  c.id,
                  c.running && (stopwatch || remainingTime(c, time) > 0)
                    ? {
                        running: false,
                        remaining: remainingTime(c, time),
                        elapsed: elapsedTime(c, time),
                        started: null,
                        end: null,
                      }
                    : {
                        running: true,
                        started: time,
                        end: time + (c.remaining || c.duration),
                        remaining: c.remaining || c.duration,
                      }
                );
              }}
            >
              {!stopwatch && c.running && remainingTime(c, now) === 0
                ? t("다시 시작", "Restart")
                : c.running
                ? t("정지", "Pause")
                : (stopwatch ? c.elapsed > 0 : c.remaining < c.duration)
                ? t("재개", "Resume")
                : t("시작", "Start")}
            </button>
            <button
              onClick={() =>
                update(c.id, {
                  running: false,
                  remaining: c.duration,
                  end: null,
                  elapsed: 0,
                  started: null,
                })
              }
            >
              {t("초기화", "Reset")}
            </button>
            {!stopwatch && (
              <button
                onClick={() => {
                  setDeviceEnabled(ctx.repo.owner, c.id, false);
                  set({
                    ...d,
                    clocks: d.clocks.filter((row) => row.id !== c.id),
                  });
                }}
              >
                {t("삭제", "Delete")}
              </button>
            )}
          </div>
          {!stopwatch && <DeviceToggle id={c.id} />}
          <ErrorMessage message={permissionError} />
        </Panel>
      ))}
    </>
  );
}
export interface Alarm {
  id: string;
  name: string;
  at: string;
  weekdays: number[];
  active: boolean;
}
export function nextAlarm(alarm: Alarm, now: number) {
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
export const localDateInput = (date: Date) =>
  new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export function AlarmTool() {
  const t = useText(),
    ctx = useContext(ToolContext)!,
    now = useNow();
  const [d, set] = useToolData<{ alarms: Alarm[] }>({ alarms: [] });
  const [permissionError, setPermissionError] = useState("");
  const update = (id: string, patch: Partial<Alarm>) =>
    set({
      ...d,
      alarms: d.alarms.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    });
  return (
    <>
      <button
        className="primary"
        onClick={async () => {
          try {
            await enableNotifications();
            setPermissionError("");
          } catch (e) {
            setPermissionError(String(e));
          }
          const id = crypto.randomUUID();
          set({
            ...d,
            alarms: [
              ...d.alarms,
              {
                id,
                name: t("알람", "Alarm"),
                at: new Date(Date.now() + 3600000).toISOString(),
                weekdays: [],
                active: true,
              },
            ],
          });
          setDeviceEnabled(ctx.repo.owner, id, true);
        }}
      >
        {t("알람 추가", "Add alarm")}
      </button>
      {d.alarms.map((a) => (
        <Panel key={a.id}>
          <Field
            label={t("이름", "Name")}
            type="text"
            value={a.name}
            onChange={(name) => update(a.id, { name })}
          />
          <Field
            label={t(
              "날짜와 시각 (현재 기기 시간대)",
              "Date and time (device timezone)"
            )}
            type="datetime-local"
            value={localDateInput(new Date(a.at))}
            onChange={(at) => {
              if (at) update(a.id, { at: new Date(at).toISOString() });
            }}
          />
          <div className="tool-weekdays">
            {[
              t("일", "Sun"),
              t("월", "Mon"),
              t("화", "Tue"),
              t("수", "Wed"),
              t("목", "Thu"),
              t("금", "Fri"),
              t("토", "Sat"),
            ].map((label, i) => (
              <label key={i}>
                <input
                  type="checkbox"
                  checked={a.weekdays.includes(i)}
                  onChange={(e) =>
                    update(a.id, {
                      weekdays: e.target.checked
                        ? [...a.weekdays, i]
                        : a.weekdays.filter((v) => v !== i),
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <label>
            <input
              type="checkbox"
              checked={a.active}
              onChange={(e) => update(a.id, { active: e.target.checked })}
            />
            {t("활성화", "Active")}
          </label>
          <DeviceToggle id={a.id} />
          <p className="tool-muted">
            {nextAlarm(a, now)
              ? new Date(nextAlarm(a, now)!).toLocaleString(t("ko-KR", "en-US"))
              : "—"}
          </p>
          <button
            onClick={() => {
              setDeviceEnabled(ctx.repo.owner, a.id, false);
              set({ ...d, alarms: d.alarms.filter((r) => r.id !== a.id) });
            }}
          >
            {t("삭제", "Delete")}
          </button>
        </Panel>
      ))}
      <ErrorMessage message={permissionError} />
      <p className="tool-muted">
        {t(
          "웹 알림은 페이지가 열려 있을 때 제공됩니다.",
          "Web alerts require the page to remain open."
        )}
      </p>
    </>
  );
}
export function NotesTool() {
  const t = useText(),
    ctx = useContext(ToolContext)!;
  const [query, setQuery] = useState(""),
    [activeId, setActiveId] = useState(
      ctx.doc.data._workspace ? "" : ctx.doc.id
    );
  const notes = ctx.documents.filter((doc) => doc.tool_id === "notes"),
    note = notes.find((doc) => doc.id === activeId);
  const content = note?.data as
    | { body?: string; tags?: string; links?: string[] }
    | undefined;
  const patch = (data: Record<string, unknown>) => {
    if (note)
      void ctx.repo.update(note.id, { data: { ...note.data, ...data } });
  };
  return (
    <div className={`tool-notes-layout ${note ? "editing" : ""}`}>
      <aside className="tool-note-list">
        <div className="tool-actions">
          <button
            className="primary"
            onClick={async () => {
              const doc = await ctx.repo.create(
                "notes",
                t("새 메모", "New note"),
                { body: "", tags: "", links: [] }
              );
              setActiveId(doc.id);
            }}
          >
            {t("메모 추가", "Add note")}
          </button>
        </div>
        <Field
          type="search"
          label={t("메모 검색", "Search notes")}
          value={query}
          onChange={setQuery}
        />
        {notes
          .filter((doc) =>
            `${doc.title} ${doc.data.body ?? ""} ${doc.data.tags ?? ""}`
              .toLowerCase()
              .includes(query.toLowerCase())
          )
          .map((doc) => (
            <button
              className="tool-note-item"
              key={doc.id}
              aria-current={note?.id === doc.id ? "true" : undefined}
              onClick={() => setActiveId(doc.id)}
            >
              <strong>{doc.title}</strong>
              <span>{String(doc.data.body ?? "").slice(0, 90)}</span>
            </button>
          ))}
        {notes.length === 0 && (
          <p className="tool-empty">
            {t("첫 메모를 추가하세요.", "Add your first note.")}
          </p>
        )}
        {ctx.repo.items.some(
          (row) => row.doc.tool_id === "notes" && row.doc.deleted_at
        ) && (
          <details className="tool-guide">
            <summary>{t("휴지통", "Trash")}</summary>
            {ctx.repo.items
              .filter(
                (row) => row.doc.tool_id === "notes" && row.doc.deleted_at
              )
              .map((row) => (
                <div className="tool-actions" key={row.doc.id}>
                  <span>{row.doc.title}</span>
                  <button
                    onClick={() =>
                      ctx.repo.update(row.doc.id, { deleted_at: null })
                    }
                  >
                    {t("복원", "Restore")}
                  </button>
                </div>
              ))}
          </details>
        )}
      </aside>
      <section className="tool-note-editor">
        {note ? (
          <>
            <button className="tool-note-back" onClick={() => setActiveId("")}>
              {t("메모 목록", "Back to notes")}
            </button>
            <Field
              type="text"
              label={t("제목", "Title")}
              value={note.title}
              onChange={(title) => {
                if (title.trim())
                  void ctx.repo.update(note.id, { title: title.slice(0, 200) });
              }}
            />
            <Field
              type="text"
              label={t("태그 (쉼표 구분)", "Tags (comma separated)")}
              value={content?.tags ?? ""}
              onChange={(tags) => patch({ tags })}
            />
            <label className="tool-field">
              <span>{t("본문", "Body")}</span>
              <textarea
                rows={16}
                maxLength={200000}
                value={content?.body ?? ""}
                onChange={(e) => patch({ body: e.target.value })}
              />
            </label>
            <Select
              label={t("저장한 작업 연결", "Link saved work")}
              value=""
              options={[
                "",
                ...ctx.documents
                  .filter((doc) => doc.id !== note.id)
                  .map((doc) => [doc.id, doc.title] as const),
              ]}
              onChange={(id) => {
                if (id)
                  patch({
                    links: [...new Set([...(content?.links ?? []), id])],
                  });
              }}
            />
            {(content?.links ?? []).map((id) => {
              const doc = ctx.documents.find((row) => row.id === id);
              return (
                <div className="tool-actions" key={id}>
                  {doc ? (
                    <a href={`/app/tools/${doc.tool_id}/${id}`}>{doc.title}</a>
                  ) : (
                    <span>{t("삭제된 작업", "Deleted work")}</span>
                  )}
                  <button
                    aria-label={t("연결 해제", "Remove link")}
                    onClick={() =>
                      patch({
                        links: content?.links?.filter((value) => value !== id),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <div className="tool-actions">
              <button
                onClick={() =>
                  import("./ui").then(({ download }) =>
                    download(content?.body ?? "", `${note.title}.txt`)
                  )
                }
              >
                {t("텍스트 내보내기", "Export text")}
              </button>
              <button
                onClick={async () => {
                  await ctx.repo.update(note.id, {
                    deleted_at: new Date().toISOString(),
                  });
                  setActiveId("");
                }}
              >
                {t("휴지통으로", "Move to trash")}
              </button>
            </div>
          </>
        ) : (
          <p className="tool-empty">
            {t(
              "메모를 선택하거나 새 메모를 추가하세요.",
              "Select a note or add a new one."
            )}
          </p>
        )}
      </section>
    </div>
  );
}
