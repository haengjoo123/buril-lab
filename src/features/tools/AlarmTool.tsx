import { useContext, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  ToolContext,
  Field,
  Panel,
  useText,
  useToolData,
  ErrorMessage,
  EmptyState,
  useUndo,
} from "./ui";
import {
  deviceEnabled,
  enableNotifications,
  setDeviceEnabled,
} from "./notifications";
import {
  type Alarm,
  isPastOneOff,
  localDateInput,
  nextAlarm,
  snoozeOffer,
  snoozeTime,
  sortAlarms,
} from "./clock";
import { useNow } from "./useNow";
import DeviceToggle from "./DeviceToggle";

/** Puts removed alarms back where they were, lowest position first. */
const restore = (
  alarms: Alarm[],
  removed: { alarm: Alarm; index: number }[]
) => {
  const list = [...alarms];
  for (const { alarm, index } of removed)
    if (!list.some((row) => row.id === alarm.id))
      list.splice(Math.min(index, list.length), 0, alarm);
  return list;
};
export default function AlarmTool() {
  const t = useText(),
    ctx = useContext(ToolContext)!,
    now = useNow(1000);
  const [undoBar, offerUndo] = useUndo();
  const [d, set] = useToolData<{ alarms: Alarm[] }>({ alarms: [] });
  const [permissionError, setPermissionError] = useState(""),
    // The order kept while a date is being typed: each keystroke changes the
    // alarm's time, and re-sorting then would move the field being edited.
    [pinned, setPinned] = useState<string[] | null>(null),
    [added, setAdded] = useState("");
  const sorted = sortAlarms(d.alarms, now);
  const alarms = pinned
    ? [
        ...pinned.flatMap((id) => sorted.filter((alarm) => alarm.id === id)),
        ...sorted.filter((alarm) => !pinned.includes(alarm.id)),
      ]
    : sorted;
  const past = d.alarms.filter((alarm) => isPastOneOff(alarm, now));
  // Re-sorting waits until the date field has been left and no press is under
  // way: the press that takes focus away would otherwise land on whatever
  // moved under it.
  const pressing = useRef(false),
    unpin = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const down = () => {
      pressing.current = true;
    };
    const up = () => {
      pressing.current = false;
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      clearTimeout(unpin.current);
    };
  }, []);
  const release = () => {
    clearTimeout(unpin.current);
    const wait = () => {
      if (pressing.current) unpin.current = setTimeout(wait, 150);
      else setPinned(null);
    };
    unpin.current = setTimeout(wait, 300);
  };
  // A new alarm is placed by its time, which can be anywhere in the list.
  useEffect(() => {
    if (added)
      document
        .getElementById(`tool-alarm-x-${added}`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [added]);
  const update = (id: string, patch: Partial<Alarm>) =>
    set((old) => ({
      ...old,
      alarms: old.alarms.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  const remove = (targets: Alarm[], message: string) => {
    const ids = new Set(targets.map((alarm) => alarm.id));
    const removed = d.alarms
        .map((alarm, index) => ({ alarm, index }))
        .filter(({ alarm }) => ids.has(alarm.id)),
      notified = targets.filter((alarm) =>
        deviceEnabled(ctx.repo.owner, alarm.id)
      );
    for (const alarm of targets)
      setDeviceEnabled(ctx.repo.owner, alarm.id, false);
    set((old) => ({
      ...old,
      alarms: old.alarms.filter((alarm) => !ids.has(alarm.id)),
    }));
    offerUndo(message, () => {
      set((old) => ({ ...old, alarms: restore(old.alarms, removed) }));
      for (const alarm of notified)
        setDeviceEnabled(ctx.repo.owner, alarm.id, true);
    });
  };
  const locale = t("ko-KR", "en-US");
  const timeText = (at: number) =>
    new Date(at).toLocaleTimeString(locale, {
      hour: "numeric",
      minute: "2-digit",
    });
  return (
    <div className="tool-alarm-x-root">
      <div className="tool-actions">
        <button
          className="primary tool-alarm-x-add"
          onClick={async () => {
            try {
              await enableNotifications();
              setPermissionError("");
            } catch (e) {
              setPermissionError(String(e));
            }
            const id = crypto.randomUUID();
            // On the minute: the field below shows no seconds, so an alarm left
            // at its default must not ring partway through that minute.
            const at = new Date(Date.now() + 3600000);
            at.setSeconds(0, 0);
            set((old) => ({
              ...old,
              alarms: [
                ...old.alarms,
                {
                  id,
                  name: t("알람", "Alarm"),
                  at: at.toISOString(),
                  weekdays: [],
                  active: true,
                },
              ],
            }));
            setDeviceEnabled(ctx.repo.owner, id, true);
            setAdded(id);
          }}
        >
          {t("알람 추가", "Add alarm")}
        </button>
        {past.length > 0 && (
          <button
            onClick={() =>
              remove(
                past,
                t(
                  `지난 알람 ${past.length}개를 삭제했습니다.`,
                  past.length === 1
                    ? "Removed 1 past alarm."
                    : `Removed ${past.length} past alarms.`
                )
              )
            }
          >
            {t(
              `지난 알람 정리 (${past.length})`,
              `Clear past alarms (${past.length})`
            )}
          </button>
        )}
      </div>
      <ErrorMessage message={permissionError} />
      {!alarms.length && (
        <EmptyState title={t("알람이 없습니다", "No alarms yet")}>
          <p>
            {t(
              "알람을 추가하면 한 시간 뒤로 맞춰집니다. 날짜와 시각, 반복 요일을 바꿀 수 있습니다.",
              "A new alarm is set one hour ahead. Change its date, time and repeat days as needed."
            )}
          </p>
        </EmptyState>
      )}
      {alarms.map((a) => {
        const next = nextAlarm(a, now),
          snoozed = snoozeTime(a, now),
          rang = snoozeOffer(a, now),
          date = new Date(a.at);
        return (
          <Panel key={a.id}>
            <div
              className="tool-alarm-x-card"
              id={`tool-alarm-x-${a.id}`}
              data-state={next ? "on" : "off"}
            >
              <Field
                label={t("이름", "Name")}
                type="text"
                value={a.name}
                onChange={(name) => update(a.id, { name })}
              />
              <div
                onFocus={() => {
                  clearTimeout(unpin.current);
                  setPinned(alarms.map((alarm) => alarm.id));
                }}
                onBlur={release}
              >
                <Field
                  label={t(
                    "날짜와 시각 (현재 기기 시간대)",
                    "Date and time (device timezone)"
                  )}
                  type="datetime-local"
                  value={Number.isNaN(+date) ? "" : localDateInput(date)}
                  onChange={(at) => {
                    // A new time is a new alarm: a snooze of the old one goes.
                    if (at)
                      update(a.id, {
                        at: new Date(at).toISOString(),
                        snoozeUntil: undefined,
                      });
                  }}
                />
              </div>
              <div
                className="tool-weekdays"
                role="group"
                aria-label={t("반복 요일", "Repeat on")}
              >
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
                      onChange={(e) => {
                        update(a.id, {
                          weekdays: e.target.checked
                            ? [...a.weekdays, i]
                            : a.weekdays.filter((v) => v !== i),
                        });
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div className="tool-alarm-x-toggles">
                <label>
                  <input
                    type="checkbox"
                    checked={a.active}
                    onChange={(e) => {
                      update(a.id, {
                        active: e.target.checked,
                        // Switched off, a waiting snooze is dropped with it.
                        ...(e.target.checked ? {} : { snoozeUntil: undefined }),
                      });
                    }}
                  />
                  {t("활성화", "Active")}
                </label>
                <DeviceToggle id={a.id} />
              </div>
              <p className="tool-muted">
                {next
                  ? `${t("다음 알림", "Next")}: ${new Date(
                      next
                    ).toLocaleString(locale)}${
                      snoozed === next
                        ? ` (${t("다시 알림", "snoozed")})`
                        : ""
                    }`
                  : !a.active
                  ? t("꺼져 있습니다.", "Turned off.")
                  : t(
                      "지난 알람입니다. 시각을 바꾸거나 반복 요일을 고르면 다시 울립니다.",
                      "This alarm has passed. Change the time or pick repeat days to use it again."
                    )}
              </p>
              {rang != null && (
                <div className="tool-alarm-x-snooze">
                  <span>
                    {t(
                      `${timeText(rang)}에 울렸습니다.`,
                      `Rang at ${timeText(rang)}.`
                    )}
                  </span>
                  {[5, 10].map((minutes) => (
                    <button
                      key={minutes}
                      aria-label={t(
                        `${minutes}분 뒤 다시 알림`,
                        `Snooze ${minutes} min`
                      )}
                      onClick={() =>
                        update(a.id, {
                          snoozeUntil: new Date(
                            Date.now() + minutes * 60000
                          ).toISOString(),
                        })
                      }
                    >
                      {minutes === 5
                        ? t("5분 뒤 다시", "Snooze 5 min")
                        : t("10분", "10 min")}
                    </button>
                  ))}
                </div>
              )}
              {snoozed != null && (
                <div className="tool-alarm-x-snooze">
                  <span>
                    {t(
                      `${timeText(snoozed)}에 다시 알립니다.`,
                      `Snoozed until ${timeText(snoozed)}.`
                    )}
                  </span>
                  <button
                    onClick={() => update(a.id, { snoozeUntil: undefined })}
                  >
                    {t("다시 알림 취소", "Cancel snooze")}
                  </button>
                </div>
              )}
              <div className="tool-actions">
                <button
                  aria-label={t(`${a.name} 삭제`, `Delete ${a.name}`)}
                  onClick={() =>
                    remove(
                      [a],
                      t(
                        `“${a.name}” 알람을 삭제했습니다.`,
                        `Deleted “${a.name}”.`
                      )
                    )
                  }
                >
                  <Trash2 size={18} aria-hidden="true" />
                  {t("삭제", "Delete")}
                </button>
              </div>
            </div>
          </Panel>
        );
      })}
      <div className="tool-alarm-x-undo">{undoBar}</div>
    </div>
  );
}
