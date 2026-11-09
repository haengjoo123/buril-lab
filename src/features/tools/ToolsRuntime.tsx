import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { getToolRepository } from "./repository";
import { deviceEnabled, scheduleToolNotifications } from "./notifications";
import type { ToolNotification } from "./notifications";
import type { Weekday } from "@capacitor/local-notifications";
import { nextAlarm, type Alarm, type Clock } from "./TimeTools";
import { occurrences, type CalendarEvent } from "./calendar";
import { useText } from "./ui";
import "./tools.css";
export default function ToolsRuntime({ ownerId }: { ownerId: string }) {
  const [message, setMessage] = useState(""),
    t = useText();
  useEffect(() => {
    const repo = getToolRepository(ownerId);
    let previous = Date.now(),
      signature = "",
      scheduleChain = Promise.resolve();
    const fired = new Set<string>();
    const collect = (from: number) => {
      const items: ToolNotification[] = [];
      for (const { doc } of repo.items) {
        if (doc.deleted_at) continue;
        if (doc.tool_id === "timer")
          for (const clock of (doc.data.clocks ?? []) as Clock[])
            if (clock.running && clock.end && deviceEnabled(ownerId, clock.id))
              items.push({
                key: `${clock.id}:${clock.end}`,
                title: clock.name,
                at: clock.end,
              });
        if (doc.tool_id === "cell-culture") {
          const timer = doc.data.timer as { id: string; end: number } | null;
          if (timer && deviceEnabled(ownerId, timer.id))
            items.push({
              key: `${timer.id}:${timer.end}`,
              title: doc.title,
              at: timer.end,
            });
        }
        if (doc.tool_id === "alarm")
          for (const alarm of (doc.data.alarms ?? []) as Alarm[])
            if (deviceEnabled(ownerId, alarm.id)) {
              for (const day of alarm.weekdays.length
                ? alarm.weekdays
                : [null]) {
                const at = nextAlarm(
                  { ...alarm, weekdays: day === null ? [] : [day] },
                  from
                );
                if (at) {
                  const date = new Date(at);
                  items.push({
                    key: `${alarm.id}:${day}:${at}`,
                    title: alarm.name,
                    at,
                    ...(day === null
                      ? {}
                      : {
                          repeat: {
                            weekday: (day + 1) as Weekday,
                            hour: date.getHours(),
                            minute: date.getMinutes(),
                            second: 0,
                          },
                        }),
                  });
                }
              }
            }
        if (doc.tool_id === "calendar")
          for (const event of (doc.data.events ?? []) as CalendarEvent[])
            if (
              deviceEnabled(ownerId, event.id) &&
              new Date(event.end) > new Date(event.start)
            ) {
              try {
                for (const e of occurrences(
                  event,
                  new Date(from),
                  new Date(
                    from + (event.repeat === "monthly" ? 366 : 31) * 86400000
                  )
                )) {
                  const at = +new Date(e.start) - e.reminderMinutes * 60000;
                  const repeatable =
                    event.repeat !== "none" &&
                    !event.until &&
                    !event.exceptions.length &&
                    event.timezone ===
                      Intl.DateTimeFormat().resolvedOptions().timeZone;
                  const date = new Date(at);
                  items.push({
                    key: `${e.id}:${at}`,
                    title: e.title,
                    at,
                    ...(repeatable
                      ? {
                          repeat: {
                            hour: date.getHours(),
                            minute: date.getMinutes(),
                            second: 0,
                            ...(event.repeat === "weekly"
                              ? { weekday: (date.getDay() + 1) as Weekday }
                              : event.repeat === "monthly"
                              ? { day: date.getDate() }
                              : {}),
                          },
                        }
                      : {}),
                  });
                  if (repeatable) break;
                }
              } catch {
                /* Invalid imported event is shown by calendar editor. */
              }
            }
      }
      return items;
    };
    const tick = () => {
      const now = Date.now();
      const items = collect(previous - 1);
      if (!Capacitor.isNativePlatform())
        for (const item of items)
          if (item.at > previous && item.at <= now && !fired.has(item.key)) {
            fired.add(item.key);
            setMessage(item.title);
          }
      previous = now;
      const future = collect(now)
          .sort((a, b) => a.at - b.at)
          .slice(0, 60),
        sig = JSON.stringify(future);
      if (sig !== signature) {
        signature = sig;
        scheduleChain = scheduleChain
          .then(() => scheduleToolNotifications(future, ownerId))
          .catch((e) => {
            setMessage(String(e));
          });
      }
    };
    const unsubscribe = repo.subscribe(tick),
      timer = setInterval(tick, 1000),
      syncTimer = setInterval(() => void repo.sync(), 30000);
    const sync = () => void repo.sync();
    window.addEventListener("online", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("buril:tool-notifications", tick);
    tick();
    return () => {
      unsubscribe();
      clearInterval(timer);
      clearInterval(syncTimer);
      window.removeEventListener("online", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("buril:tool-notifications", tick);
    };
  }, [ownerId]);
  return message ? (
    <div className="tool-notification" role="alert">
      {message}
      <button onClick={() => setMessage("")}>{t("닫기", "Dismiss")}</button>
    </div>
  ) : null;
}
