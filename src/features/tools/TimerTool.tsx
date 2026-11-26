import { useContext, useState } from "react";
import {
  ToolContext,
  Field,
  Panel,
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
import {
  type Clock,
  elapsedTime,
  remainingTime,
  toggleClock,
  clockText,
} from "./clock";
import { useNow } from "./useNow";
import DeviceToggle from "./DeviceToggle";
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
export default function TimerTool({
  stopwatch = false,
}: {
  stopwatch?: boolean;
}) {
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
                update(c.id, toggleClock(c, Date.now(), stopwatch));
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
