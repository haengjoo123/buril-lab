import { useContext, useState } from "react";
import {
  ToolContext,
  Field,
  Panel,
  useText,
  useToolData,
  ErrorMessage,
} from "./ui";
import { enableNotifications, setDeviceEnabled } from "./notifications";
import { type Alarm, nextAlarm, localDateInput } from "./clock";
import { useNow } from "./useNow";
import DeviceToggle from "./DeviceToggle";
export default function AlarmTool() {
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
          // On the minute: the field below shows no seconds, so an alarm left
          // at its default must not ring partway through that minute.
          const at = new Date(Date.now() + 3600000);
          at.setSeconds(0, 0);
          set({
            ...d,
            alarms: [
              ...d.alarms,
              {
                id,
                name: t("알람", "Alarm"),
                at: at.toISOString(),
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
              ? `${t("다음 알림", "Next")}: ${new Date(
                  nextAlarm(a, now)!
                ).toLocaleString(t("ko-KR", "en-US"))}`
              : !a.active
              ? t("꺼져 있습니다.", "Turned off.")
              : t(
                  "지난 알람입니다. 시각을 바꾸거나 반복 요일을 고르면 다시 울립니다.",
                  "This alarm has passed. Change the time or pick repeat days to use it again."
                )}
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
