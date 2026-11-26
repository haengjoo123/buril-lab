import { useContext, useState } from "react";
import { Link } from "react-router-dom";
import { Flag, Pause, Play, Plus, RotateCcw, Trash2, X } from "lucide-react";
import {
  ToolContext,
  Field,
  NumberField,
  Panel,
  useText,
  useToolData,
  ErrorMessage,
  ColorField,
  CopyButton,
  EmptyState,
  csv,
  download,
  useExportName,
  useUndo,
} from "./ui";
import {
  deviceEnabled,
  enableNotifications,
  setDeviceEnabled,
} from "./notifications";
import {
  type Clock,
  MAX_LAPS,
  MAX_PRESETS,
  addLap,
  addPreset,
  centiseconds,
  clockText,
  durationFromParts,
  durationParts,
  elapsedTime,
  isFinished,
  lapRows,
  overtime,
  overtimeText,
  recentDurations,
  rememberDuration,
  remainingTime,
  sortClocks,
  stopwatchText,
  timerPresets,
  toggleClock,
} from "./clock";
import { toolById } from "./registry";
import { useFrameNow, useNow } from "./useNow";
import DeviceToggle from "./DeviceToggle";
import { BarList, ChartFrame, Meter } from "./charts";

type TimerData = {
  clocks: Clock[];
  /** Quick durations in ms. Absent in documents saved before they could be edited. */
  presets?: number[];
  /** Durations last started, newest first. */
  recentDurations?: number[];
};
/** A countdown another tool keeps in its own document, listed read-only. */
type ListedClock = Clock & { source?: { to: string } };
type Text = (ko: string, en: string) => string;

/** A duration in words: "1시간 30분" / "1 h 30 min". */
const durationLabel = (ms: number, t: Text) => {
  const [hours, minutes, seconds] = durationParts(ms);
  return [
    hours ? t(`${hours}시간`, `${hours} h`) : "",
    minutes ? t(`${minutes}분`, `${minutes} min`) : "",
    seconds || !(hours || minutes) ? t(`${seconds}초`, `${seconds} s`) : "",
  ]
    .filter(Boolean)
    .join(" ");
};
const partsTotal = (parts: string[]) =>
  durationFromParts(
    Number(parts[0]) || 0,
    Number(parts[1]) || 0,
    Number(parts[2]) || 0
  );
/**
 * Hours, minutes and seconds as three text fields. What was typed is kept as
 * typed while it still adds up to the value ("90" minutes stays "90"); a
 * value set elsewhere, such as a preset, replaces it. A part is selected on
 * focus, so typing replaces it instead of being appended to its "0".
 */
function DurationFields({
  value,
  onChange,
}: {
  value: number;
  onChange: (milliseconds: number) => void;
}) {
  const t = useText();
  const [typed, setTyped] = useState(() => durationParts(value).map(String));
  const shown =
    partsTotal(typed) === value ? typed : durationParts(value).map(String);
  return (
    <div
      className="tool-duration-input"
      role="group"
      aria-label={t("시간 설정", "Duration")}
      onFocus={(event) => {
        if (event.target instanceof HTMLInputElement) event.target.select();
      }}
    >
      {shown.map((part, index) => (
        <NumberField
          key={index}
          label={t(
            ["시간", "분", "초"][index],
            ["Hours", "Minutes", "Seconds"][index]
          )}
          placeholder="0"
          value={part}
          onChange={(text) => {
            // Whole numbers only; an empty part counts as zero.
            const next = [...shown];
            next[index] = text.replace(/\D/g, "").slice(0, 4);
            setTyped(next);
            onChange(partsTotal(next));
          }}
        />
      ))}
    </div>
  );
}
/**
 * The stopwatch digits. Only this component follows the animation frames, so
 * a running stopwatch does not re-render the controls and the lap table 60
 * times a second.
 */
function StopwatchReadout({ clock }: { clock: Clock }) {
  const t = useText(),
    frame = useFrameNow(clock.running);
  // The frame time is from before the start until the first frame arrives.
  const elapsed = elapsedTime(clock, Math.max(frame, clock.started ?? 0)),
    laps = clock.laps ?? [];
  return (
    <>
      <div className="tool-clock" role="timer" aria-live="off">
        {clockText(elapsed)}
        <small className="tool-timer-x-centis">.{centiseconds(elapsed)}</small>
      </div>
      {laps.length > 0 && (
        <p className="tool-timer-x-status">
          {t(`랩 ${laps.length + 1}`, `Lap ${laps.length + 1}`)}
          {" · "}
          {stopwatchText(elapsed - laps[laps.length - 1])}
        </p>
      )}
    </>
  );
}
/** Laps drawn as bars; more than this and the bars stop being comparable at a glance. */
const LAP_BARS = 20;
function LapTable({ clock }: { clock: Clock }) {
  const t = useText(),
    exportName = useExportName();
  const rows = lapRows(clock.laps);
  if (!rows.length) return null;
  const headers = [t("랩", "Lap"), t("랩 시간", "Lap time"), t("누적", "Total")];
  return (
    <div className="tool-timer-x-laps">
      <div className="tool-actions">
        <h3>
          {t("랩 기록", "Laps")} ({rows.length})
        </h3>
        <CopyButton
          text={() =>
            [
              headers.join("\t"),
              ...rows.map((row) =>
                [
                  row.number,
                  stopwatchText(row.lap),
                  stopwatchText(row.total),
                ].join("\t")
              ),
            ].join("\n")
          }
        >
          {t("복사", "Copy")}
        </CopyButton>
        <button
          onClick={() =>
            download(
              csv([
                [
                  ...headers,
                  t("랩 시간 (초)", "Lap time (s)"),
                  t("누적 (초)", "Total (s)"),
                ],
                ...rows.map((row) => [
                  row.number,
                  stopwatchText(row.lap),
                  stopwatchText(row.total),
                  row.lap / 1000,
                  row.total / 1000,
                ]),
              ]),
              exportName("csv", "laps"),
              "text/csv"
            )
          }
        >
          CSV
        </button>
      </div>
      {rows.length >= 2 && (
        // Which stretch ran long. The table below is its exact twin.
        <ChartFrame
          title={t("랩별 시간", "Time per lap")}
          note={
            rows.length > LAP_BARS
              ? t(`최근 ${LAP_BARS}개`, `Latest ${LAP_BARS}`)
              : undefined
          }
        >
          <BarList
            label={t("랩별 걸린 시간", "Time taken by each lap")}
            rows={rows.slice(-LAP_BARS).map((row) => ({
              label: `${t("랩", "Lap")} ${row.number}`,
              value: row.lap,
              figure: stopwatchText(row.lap),
            }))}
          />
        </ChartFrame>
      )}
      <div className="tool-table-wrap tool-timer-x-lap-table">
        <table>
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header} scope="col">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((row) => (
              <tr key={row.number}>
                <td>{row.number}</td>
                <td>{stopwatchText(row.lap)}</td>
                <td>{stopwatchText(row.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
/** The time fields a reset clears, kept so that it can be undone. */
const timeFields = ({
  running,
  remaining,
  end,
  elapsed,
  started,
  laps,
}: Clock): Partial<Clock> => ({
  running,
  remaining,
  end,
  elapsed,
  started,
  laps,
});
export default function TimerTool({
  stopwatch = false,
}: {
  stopwatch?: boolean;
}) {
  const t = useText(),
    ctx = useContext(ToolContext)!,
    // The stopwatch draws its own digits; nothing else there changes with time.
    now = useNow(250, !stopwatch);
  const [undoBar, offerUndo] = useUndo();
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
  const [d, set] = useToolData<TimerData>({
    clocks: stopwatch ? [initialClock] : [],
  });
  // An empty stopwatch workspace still shows its one clock.
  const stored = (data: TimerData) =>
    stopwatch && !data.clocks.length ? [initialClock] : data.clocks;
  const clocks = stored(d);
  const [permissionErrors, setPermissionErrors] = useState<
    Record<string, string>
  >({});
  const [duration, setDuration] = useState(60000),
    [timerName, setTimerName] = useState(""),
    [editingPresets, setEditingPresets] = useState(false);
  const presets = timerPresets(d.presets),
    recent = recentDurations(d.recentDurations).filter(
      (ms) => !presets.includes(ms)
    );
  // Countdowns the cell culture tool keeps in its own documents.
  const culture = toolById("cell-culture");
  const external: ListedClock[] = stopwatch
    ? []
    : ctx.repo.items.flatMap((row) => {
        const timer =
          row.doc.tool_id === "cell-culture" && !row.doc.deleted_at
            ? (row.doc.data.timer as
                | { id?: unknown; end?: unknown; name?: unknown }
                | null
                | undefined)
            : null;
        if (
          !timer ||
          typeof timer.id !== "string" ||
          typeof timer.end !== "number"
        )
          return [];
        return [
          {
            id: timer.id,
            // The draft's own title was written in whichever language was in
            // use when it was first opened.
            // The cell line it was started for, then the culture's name.
            name:
              [timer.name, row.doc.data.name].find(
                (name): name is string =>
                  typeof name === "string" && !!name.trim()
              ) ??
              (row.draft
                ? t(culture?.ko ?? "세포 배양", culture?.en ?? "Cell Culture")
                : row.doc.title),
            color: "#0d9488",
            duration: 0,
            remaining: 0,
            end: timer.end,
            running: true,
            elapsed: 0,
            started: null,
            source: {
              to: row.draft
                ? "/app/tools/cell-culture"
                : `/app/tools/cell-culture/${row.doc.id}`,
            },
          },
        ];
      });
  const listed: ListedClock[] = stopwatch
    ? clocks
    : sortClocks([...clocks, ...external], now);
  // A countdown that runs out while the screen is open is announced once: the
  // text below changes only when the set of finished timers does.
  const finished = stopwatch
    ? []
    : listed.filter((clock) => isFinished(clock, now));
  const finishedIds = finished.map((clock) => clock.id).join("\n");
  const [seenFinished, setSeenFinished] = useState(finishedIds),
    [announcement, setAnnouncement] = useState("");
  if (finishedIds !== seenFinished) {
    const seen = new Set(seenFinished.split("\n"));
    const names = finished
      .filter((clock) => !seen.has(clock.id))
      .map((clock) => clock.name)
      .join(", ");
    setSeenFinished(finishedIds);
    setAnnouncement(
      names ? t(`타이머 종료: ${names}`, `Timer finished: ${names}`) : ""
    );
  }
  const update = (id: string, change: (clock: Clock) => Partial<Clock>) =>
    set((old) => ({
      ...old,
      clocks: stored(old).map((row) =>
        row.id === id ? { ...row, ...change(row) } : row
      ),
    }));
  const toggle = async (clock: Clock) => {
    if (
      !stopwatch &&
      !clock.running &&
      deviceEnabled(ctx.repo.owner, clock.id)
    ) {
      try {
        await enableNotifications();
        setPermissionErrors((old) => ({ ...old, [clock.id]: "" }));
      } catch (e) {
        setPermissionErrors((old) => ({ ...old, [clock.id]: String(e) }));
      }
    }
    const at = Date.now();
    set((old) => {
      const list = stored(old),
        latest = list.find((row) => row.id === clock.id);
      if (!latest) return old;
      const change = toggleClock(latest, at, stopwatch);
      return {
        ...old,
        clocks: list.map((row) =>
          row === latest ? { ...row, ...change } : row
        ),
        // Starting from the full duration is a use of it; resuming is not.
        ...(!stopwatch && change.running && change.remaining === latest.duration
          ? {
              recentDurations: rememberDuration(
                old.recentDurations,
                latest.duration
              ),
            }
          : {}),
      };
    });
  };
  const reset = (clock: Clock, over: boolean) => {
    const before = timeFields(clock);
    update(clock.id, (row) => ({
      running: false,
      remaining: row.duration,
      end: null,
      elapsed: 0,
      started: null,
      ...(row.laps ? { laps: [] } : {}),
    }));
    offerUndo(
      stopwatch
        ? t("스톱워치를 초기화했습니다.", "Stopwatch reset.")
        : over
        ? t(
            `“${clock.name}” 타이머의 종료를 확인했습니다.`,
            `Dismissed “${clock.name}”.`
          )
        : t(
            `“${clock.name}” 타이머를 초기화했습니다.`,
            `Reset “${clock.name}”.`
          ),
      () => update(clock.id, () => before)
    );
  };
  const remove = (clock: Clock) => {
    const index = d.clocks.findIndex((row) => row.id === clock.id),
      notified = deviceEnabled(ctx.repo.owner, clock.id);
    setDeviceEnabled(ctx.repo.owner, clock.id, false);
    set((old) => ({
      ...old,
      clocks: old.clocks.filter((row) => row.id !== clock.id),
    }));
    offerUndo(
      t(`“${clock.name}” 타이머를 삭제했습니다.`, `Deleted “${clock.name}”.`),
      () => {
        set((old) =>
          old.clocks.some((row) => row.id === clock.id)
            ? old
            : {
                ...old,
                clocks: [
                  ...old.clocks.slice(0, Math.max(0, index)),
                  clock,
                  ...old.clocks.slice(Math.max(0, index)),
                ],
              }
        );
        if (notified) setDeviceEnabled(ctx.repo.owner, clock.id, true);
      }
    );
  };
  const add = () => {
    if (!(duration > 0) || !Number.isFinite(duration)) return;
    const id = crypto.randomUUID();
    set((old) => ({
      ...old,
      clocks: [
        ...old.clocks,
        {
          id,
          name:
            timerName.trim() ||
            `${t("타이머", "Timer")} ${old.clocks.length + 1}`,
          color: "#2563eb",
          duration,
          remaining: duration,
          end: null,
          running: false,
          elapsed: 0,
          started: null,
        },
      ],
    }));
    setDeviceEnabled(ctx.repo.owner, id, true);
    setTimerName("");
  };
  const removePreset = (ms: number) => {
    const label = durationLabel(ms, t);
    set((old) => ({
      ...old,
      presets: timerPresets(old.presets).filter((value) => value !== ms),
    }));
    offerUndo(
      t(
        `빠른 시간 “${label}” 항목을 삭제했습니다.`,
        `Removed the ${label} preset.`
      ),
      () =>
        set((old) => ({
          ...old,
          presets: addPreset(timerPresets(old.presets), ms),
        }))
    );
  };
  const endText = (end: number) => {
    const date = new Date(end),
      locale = t("ko-KR", "en-US");
    return date.toDateString() === new Date(now).toDateString()
      ? date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
      : date.toLocaleString(locale, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
  };
  const countdown = (clock: ListedClock, over: boolean) => (
    <>
      <div
        className="tool-clock"
        role="timer"
        aria-live="off"
        aria-label={
          over
            ? t(
                `종료 후 ${durationLabel(overtime(clock, now), t)} 지남`,
                `${durationLabel(overtime(clock, now), t)} past the end`
              )
            : undefined
        }
      >
        {over
          ? overtimeText(overtime(clock, now))
          : clockText(remainingTime(clock, now))}
      </div>
      {clock.duration > 0 && (
        // Readable from across the bench: how much of the set time has gone.
        <Meter
          label={t("경과", "Elapsed")}
          value={over ? clock.duration : clock.duration - remainingTime(clock, now)}
          max={clock.duration}
          text={
            over
              ? "100%"
              : `${Math.floor(
                  ((clock.duration - remainingTime(clock, now)) /
                    clock.duration) *
                    100
                )}%`
          }
          tone={over ? "critical" : "accent"}
        />
      )}
      <p className="tool-timer-x-status">
        {over ? (
          <>
            <strong className="tool-timer-x-badge">
              {t("종료", "Finished")}
            </strong>
            {t(
              "설정한 시간이 지났습니다. 지난 시간을 표시합니다.",
              "Time is up. Showing the time past zero."
            )}
          </>
        ) : clock.running && clock.end ? (
          t(`${endText(clock.end)}에 종료`, `Ends at ${endText(clock.end)}`)
        ) : clock.remaining < clock.duration ? (
          `${t("일시정지", "Paused")} · ${durationLabel(clock.duration, t)}`
        ) : (
          durationLabel(clock.duration, t)
        )}
      </p>
    </>
  );
  return (
    <div className="tool-timer-x-root">
      {!stopwatch && (
        <form
          className="tool-timer-create"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <Field
            label={t("타이머 이름 (선택)", "Timer name (optional)")}
            type="text"
            value={timerName}
            onChange={setTimerName}
          />
          <DurationFields value={duration} onChange={setDuration} />
          <div
            className="tool-actions tool-duration-presets"
            role="group"
            aria-label={t("빠른 시간", "Quick durations")}
          >
            {presets.map((ms) => (
              <span className="tool-timer-x-chip" key={ms}>
                <button
                  type="button"
                  aria-pressed={duration === ms}
                  onClick={() => setDuration(ms)}
                >
                  {durationLabel(ms, t)}
                </button>
                {editingPresets && (
                  <button
                    type="button"
                    aria-label={t(
                      `빠른 시간 ${durationLabel(ms, t)} 삭제`,
                      `Remove the ${durationLabel(ms, t)} preset`
                    )}
                    onClick={() => removePreset(ms)}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                )}
              </span>
            ))}
            {editingPresets && (
              <button
                type="button"
                disabled={
                  !(duration > 0) ||
                  presets.includes(duration) ||
                  presets.length >= MAX_PRESETS
                }
                onClick={() =>
                  set((old) => ({
                    ...old,
                    presets: addPreset(timerPresets(old.presets), duration),
                  }))
                }
              >
                <Plus size={16} aria-hidden="true" />
                {t(
                  `${durationLabel(duration, t)} 추가`,
                  `Add ${durationLabel(duration, t)}`
                )}
              </button>
            )}
            <button
              type="button"
              aria-pressed={editingPresets}
              onClick={() => setEditingPresets(!editingPresets)}
            >
              {editingPresets
                ? t("편집 완료", "Done")
                : t("빠른 시간 편집", "Edit presets")}
            </button>
          </div>
          {recent.length > 0 && (
            <div
              className="tool-actions tool-duration-presets"
              role="group"
              aria-label={t("최근 사용한 시간", "Recently used durations")}
            >
              <span className="tool-muted">{t("최근", "Recent")}</span>
              {recent.map((ms) => (
                <button
                  type="button"
                  key={ms}
                  aria-pressed={duration === ms}
                  onClick={() => setDuration(ms)}
                >
                  {durationLabel(ms, t)}
                </button>
              ))}
            </div>
          )}
          <button
            className="primary tool-timer-x-add"
            type="submit"
            disabled={!(duration > 0) || !Number.isFinite(duration)}
          >
            {t("타이머 추가", "Add timer")}
          </button>
        </form>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {!listed.length && (
        <EmptyState title={t("타이머가 없습니다", "No timers yet")}>
          <p>
            {t(
              "위에서 시간을 정하고 타이머를 추가하세요.",
              "Set a duration above and add a timer."
            )}
          </p>
        </EmptyState>
      )}
      {listed.map((c) => {
        const over = !stopwatch && isFinished(c, now);
        if (c.source)
          return (
            <Panel key={c.id}>
              <div
                className="tool-timer-x-card"
                data-state={over ? "finished" : "running"}
              >
                <h2 className="tool-timer-name">
                  <span style={{ background: c.color }} />
                  {c.name}
                </h2>
                {countdown(c, over)}
                <div className="tool-actions">
                  <Link className="tool-button" to={c.source.to}>
                    {t("세포 배양에서 열기", "Open in Cell Culture")}
                  </Link>
                </div>
                <p className="tool-muted">
                  {t(
                    "세포 배양에서 시작한 타이머입니다. 취소와 알림 설정은 그 작업에서 합니다.",
                    "Started in Cell Culture. Cancel it or change its notification there."
                  )}
                </p>
              </div>
            </Panel>
          );
        const laps = c.laps?.length ?? 0;
        return (
          <Panel key={c.id}>
            <div
              className="tool-timer-x-card"
              data-state={over ? "finished" : c.running ? "running" : "idle"}
            >
              <h2 className="tool-timer-name">
                <span style={{ background: c.color }} />
                {c.name}
              </h2>
              {stopwatch ? <StopwatchReadout clock={c} /> : countdown(c, over)}
              <div className="tool-actions tool-timer-x-controls">
                <button
                  className="primary tool-timer-x-main"
                  disabled={!stopwatch && c.duration <= 0}
                  onClick={() => void toggle(c)}
                >
                  {over ? (
                    <RotateCcw size={22} aria-hidden="true" />
                  ) : c.running ? (
                    <Pause size={22} aria-hidden="true" />
                  ) : (
                    <Play size={22} aria-hidden="true" />
                  )}
                  {over
                    ? t("다시 시작", "Restart")
                    : c.running
                    ? t("정지", "Pause")
                    : (stopwatch ? c.elapsed > 0 : c.remaining < c.duration)
                    ? t("재개", "Resume")
                    : t("시작", "Start")}
                </button>
                {stopwatch && (
                  <button
                    className="tool-timer-x-side"
                    disabled={!c.running || laps >= MAX_LAPS}
                    onClick={() => {
                      const at = Date.now();
                      update(c.id, (row) =>
                        row.running && (row.laps?.length ?? 0) < MAX_LAPS
                          ? { laps: addLap(row, at) }
                          : {}
                      );
                    }}
                  >
                    <Flag size={20} aria-hidden="true" />
                    {t("랩", "Lap")}
                  </button>
                )}
                <button
                  className="tool-timer-x-side"
                  disabled={
                    !c.running &&
                    !c.elapsed &&
                    c.remaining === c.duration &&
                    !laps
                  }
                  onClick={() => reset(c, over)}
                >
                  {over ? t("종료 확인", "Dismiss") : t("초기화", "Reset")}
                </button>
                {!stopwatch && (
                  <button
                    className="tool-timer-x-side"
                    aria-label={t(`${c.name} 삭제`, `Delete ${c.name}`)}
                    onClick={() => remove(c)}
                  >
                    <Trash2 size={18} aria-hidden="true" />
                    {t("삭제", "Delete")}
                  </button>
                )}
              </div>
              {!stopwatch && (
                <div className="tool-timer-x-device">
                  <DeviceToggle id={c.id} />
                </div>
              )}
              <ErrorMessage message={permissionErrors[c.id] ?? ""} />
              {stopwatch && <LapTable clock={c} />}
              <details className="tool-timer-x-settings">
                <summary>
                  {stopwatch
                    ? t("이름·색상", "Name and color")
                    : t("이름·시간·색상", "Name, duration and color")}
                </summary>
                <div className="tool-grid">
                  <Field
                    label={t("이름", "Name")}
                    type="text"
                    value={c.name}
                    onChange={(name) => update(c.id, () => ({ name }))}
                  />
                  <ColorField
                    label={t("색상", "Color")}
                    value={c.color}
                    onChange={(color) => update(c.id, () => ({ color }))}
                  />
                  {!stopwatch && !c.running && (
                    <DurationFields
                      value={c.duration}
                      onChange={(duration) =>
                        update(c.id, () => ({ duration, remaining: duration }))
                      }
                    />
                  )}
                </div>
              </details>
            </div>
          </Panel>
        );
      })}
      <div className="tool-timer-x-undo">{undoBar}</div>
    </div>
  );
}
