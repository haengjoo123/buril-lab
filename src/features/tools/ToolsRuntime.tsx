import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { toolNotificationBudget } from "../reminders/deviceNotifications";
import { getToolRepository } from "./repository";
import {
  NOTIFICATION_SETTINGS_EVENT,
  claimAlerts,
  deviceOptIns,
  isOptInChange,
  onToolNotificationTap,
  playAlertSound,
  readDeviceEnabled,
  readLastSeen,
  showSystemNotification,
  syncToolNotifications,
  unlockAlertSound,
  writeLastSeen,
} from "./notifications";
import {
  catchUpFrom,
  dueBetween,
  planLabels,
  planToolNotifications,
  scheduleSignature,
  splitDue,
  withinBudget,
  type PlannedNotification,
} from "./notificationPlan";
import { useText } from "./ui";
import "./runtime.css";

/** The longest sleep between checks, so a changed clock or a computer that slept is noticed. */
const WAKE_MS = 60_000;
/** A longer silence than this was a gap (closed, asleep, suspended), not a late check. */
const GAP_MS = 90_000;
/** The plan is remade this often even when nothing changed: the calendar's window moves on. */
const REPLAN_MS = 6 * 3_600_000;
const SEEN_EVERY_MS = 15_000;
// Typing in a timer's name changes its document many times a second. The plan
// is remade after a pause, with a ceiling so steady typing does not hold it up.
const CHANGE_SETTLE_MS = 250;
const CHANGE_MAX_WAIT_MS = 2000;
const VISIBLE = 3;
const KEPT = 50;
const PLANNED_TOOLS = new Set(["timer", "alarm", "calendar", "cell-culture"]);

type Alert = Pick<
  PlannedNotification,
  "key" | "title" | "body" | "at" | "path"
> & { missed: boolean };
const toAlert = (entry: PlannedNotification, missed: boolean): Alert => ({
  key: entry.key,
  title: entry.title,
  body: entry.body,
  at: entry.at,
  path: entry.path,
  missed,
});
/** Newest first; an alert already shown is not added again. */
const withAlerts = (list: Alert[], added: Alert[]) => {
  const shown = new Set(list.map((alert) => alert.key));
  return [...list, ...added.filter((alert) => !shown.has(alert.key))]
    .sort((a, b) => b.at - a.at)
    .slice(0, KEPT);
};

/**
 * Makes timers, alarms, calendar reminders and culture timers alert, whatever
 * part of the app is open. Native apps hand the plan to the system, which
 * also delivers it while the app is closed. On the web the alerts are shown
 * here, with a sound, for as long as the app is open in a tab.
 */
export default function ToolsRuntime({ ownerId }: { ownerId: string }) {
  const t = useText(),
    language = t("ko", "en"),
    navigate = useNavigate();
  const [alerts, setAlerts] = useState<Alert[]>([]),
    [failed, setFailed] = useState(false),
    [shownFor, setShownFor] = useState(ownerId);
  // Another account signed in: the alerts on screen were not for it.
  if (shownFor !== ownerId) {
    setShownFor(ownerId);
    setAlerts([]);
    setFailed(false);
  }
  // `navigate` changes with every route; the listeners below need the latest.
  const open = useRef(navigate);
  useEffect(() => {
    open.current = navigate;
  }, [navigate]);
  useEffect(() => {
    const repo = getToolRepository(ownerId),
      native = Capacitor.isNativePlatform(),
      budget = toolNotificationBudget(Capacitor.getPlatform()),
      startedAt = Date.now();
    const text = (ko: string, en: string) => (language === "ko" ? ko : en);
    const labels = planLabels(text);
    const channel = {
      name: text("실험 도구 알림", "Lab tool alerts"),
      description: text(
        "타이머, 알람, 일정, 세포 배양 타이머",
        "Timers, alarms, calendar reminders and culture timers"
      ),
    };
    const fired = new Set<string>();
    let disposed = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      settling: ReturnType<typeof setTimeout> | undefined,
      settlingSince = 0,
      plan: PlannedNotification[] = [],
      planInputs: string | null = null,
      planFrom = 0,
      plannedAt = 0,
      planCount = 0,
      seenWritten = 0,
      // Until a native app reports otherwise, the system delivers the alerts.
      systemDelivers = native,
      scheduledCount = 0,
      scheduled: string | null = null,
      resync = false,
      syncing = false,
      queued: PlannedNotification[] | null = null;
    // The web resumes where this device last checked, and reports what came
    // due in between as missed. Natively the system delivered those.
    let previous = (native ? null : readLastSeen(ownerId)) ?? startedAt;

    // Changes exactly when the plan could: a document of one of the four
    // tools, the list of things switched on for this device, or the device's
    // time zone (alarms ring by the wall clock).
    const inputs = (now: number) => {
      let signature = `${deviceOptIns(ownerId)}|${new Date(
        now
      ).getTimezoneOffset()}`;
      for (const item of repo.items)
        if (PLANNED_TOOLS.has(item.doc.tool_id))
          signature += `|${item.doc.id}:${item.doc.updated_at}:${
            item.doc.revision
          }:${item.generation}:${item.doc.deleted_at ? 1 : 0}:${
            item.draft ? 1 : 0
          }`;
      return signature;
    };
    const replan = (from: number, signature: string, now: number) => {
      plan = planToolNotifications(
        repo.items,
        readDeviceEnabled(ownerId),
        from,
        labels
      );
      planInputs = signature;
      planFrom = from;
      plannedAt = now;
      planCount++;
    };

    const announce = (due: PlannedNotification[], now: number) => {
      const { live, missed } = splitDue(due, now, startedAt);
      const added = [
        ...live.map((entry) => toAlert(entry, false)),
        ...(native ? [] : missed).map((entry) => toAlert(entry, true)),
      ];
      if (added.length) setAlerts((list) => withAlerts(list, added));
      if (!live.length) return;
      // Every open tab shows the alert; one of them makes the noise.
      void claimAlerts(
        ownerId,
        live.map((entry) => entry.key)
      ).then((mine) => {
        if (!mine.length) return;
        playAlertSound();
        if (document.visibilityState !== "hidden" && document.hasFocus())
          return;
        for (const entry of live)
          if (mine.includes(entry.key))
            showSystemNotification(entry, () => {
              setAlerts((list) =>
                list.filter((alert) => alert.key !== entry.key)
              );
              open.current(entry.path);
            });
      });
    };

    const drain = async () => {
      syncing = true;
      while (queued && !disposed) {
        const wanted = queued;
        queued = null;
        try {
          const found = await syncToolNotifications(wanted, ownerId, {
            since: startedAt,
            channel,
          });
          if (disposed) break;
          // Without permission nothing arrives from the system, so alerts
          // are at least shown while the app is open.
          if (found) systemDelivers = found.display === "granted";
          setFailed(false);
        } catch (error) {
          console.warn("Could not schedule tool notifications:", error);
          if (disposed) break;
          systemDelivers = false;
          setFailed(true);
        }
      }
      syncing = false;
    };
    // Hands the plan to the system, when it is not the one already handed over.
    const schedule = (now: number) => {
      if (planCount === scheduledCount && !resync) return;
      scheduledCount = planCount;
      const wanted = withinBudget(plan, now, budget);
      const signature = wanted
        .map((entry) => scheduleSignature(entry, ""))
        .join("\n");
      if (signature === scheduled && !resync) return;
      scheduled = signature;
      resync = false;
      queued = wanted;
      if (!syncing) void drain();
    };

    const tick = () => {
      clearTimeout(timer);
      timer = undefined;
      // Before the first exchange with the server this device may hold a
      // stale copy. Nothing is announced, scheduled or cancelled from that.
      if (disposed || !repo.hydrated) return;
      const now = Date.now();
      if (previous > now) previous = now; // The clock was set back.
      const gap = now - previous > GAP_MS;
      if (gap) previous = catchUpFrom(previous, now);
      const signature = inputs(now);
      // Documents changed since the plan was made. Only what both the old
      // plan and the edited documents hold has come due: an alarm just
      // created for a time already past never did, and a timer paused a
      // moment before its end no longer does. The new plan starts from now.
      const edited = planInputs !== null && signature !== planInputs;
      if (
        !edited &&
        (planInputs === null ||
          gap ||
          previous < planFrom ||
          now - plannedAt > REPLAN_MS)
      )
        replan(previous, signature, now);
      let passed = dueBetween(plan, previous, now);
      if (edited && passed.length) {
        const current = new Map(
          planToolNotifications(
            repo.items,
            readDeviceEnabled(ownerId),
            previous,
            labels
          ).map((entry) => [entry.key, entry])
        );
        passed = passed.flatMap((entry) => current.get(entry.key) ?? []);
      }
      previous = now;
      if (passed.length) {
        // A clock set back passes the same alert a second time.
        const due = passed.filter((entry) => !fired.has(entry.key));
        if (fired.size > 500) fired.clear();
        for (const entry of due) fired.add(entry.key);
        if (due.length && !systemDelivers) announce(due, now);
      }
      // What repeats is planned one occurrence at a time.
      if (passed.length || edited) replan(now, signature, now);
      if (!native && (passed.length || now - seenWritten >= SEEN_EVERY_MS)) {
        seenWritten = now;
        writeLastSeen(ownerId, now, startedAt);
      }
      if (native) schedule(now);
      // Sleep until the next alert. Nothing planned: nothing runs.
      const next = plan.find((entry) => entry.at > now)?.at;
      if (next !== undefined)
        timer = setTimeout(tick, Math.min(WAKE_MS, Math.max(50, next - now)));
    };
    const documentsChanged = () => {
      const now = Date.now();
      if (settling === undefined) settlingSince = now;
      const wait = settlingSince + CHANGE_MAX_WAIT_MS - now;
      clearTimeout(settling);
      settling = setTimeout(() => {
        settling = undefined;
        tick();
      }, Math.max(0, Math.min(CHANGE_SETTLE_MS, wait)));
    };

    const changed = () => {
      resync = true;
      tick();
    };
    const otherTab = (event: StorageEvent) => {
      if (isOptInChange(event, ownerId)) tick();
    };
    const sync = () => void repo.sync();
    const focus = () => {
      sync();
      tick();
    };
    // A hidden or closing page may never run another timer: write what is
    // still waiting for a pause in typing, and how far alerts were checked.
    const leave = () => {
      void repo.flush();
      if (!native) writeLastSeen(ownerId, previous, startedAt);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") leave();
      // Timers hardly ran in the background, and the permission may have
      // been changed in the system settings meanwhile.
      else changed();
    };
    // Browsers allow sound only after the user has touched the page.
    const interact = () => {
      if (!plan.length || systemDelivers) return;
      unlockAlertSound();
      window.removeEventListener("pointerdown", interact, true);
      window.removeEventListener("keydown", interact, true);
    };
    const unsubscribe = repo.subscribe(documentsChanged),
      stopTaps = onToolNotificationTap(ownerId, (path) => open.current(path)),
      syncTimer = setInterval(sync, 30000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leave);
    window.addEventListener("online", sync);
    window.addEventListener("focus", focus);
    window.addEventListener(NOTIFICATION_SETTINGS_EVENT, changed);
    window.addEventListener("storage", otherTab);
    window.addEventListener("pointerdown", interact, true);
    window.addEventListener("keydown", interact, true);
    timer = setTimeout(tick, 0);
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(settling);
      clearInterval(syncTimer);
      unsubscribe();
      stopTaps();
      // A change of language starts over from exactly here.
      if (!native) writeLastSeen(ownerId, previous, startedAt);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("online", sync);
      window.removeEventListener("focus", focus);
      window.removeEventListener(NOTIFICATION_SETTINGS_EVENT, changed);
      window.removeEventListener("storage", otherTab);
      window.removeEventListener("pointerdown", interact, true);
      window.removeEventListener("keydown", interact, true);
    };
  }, [ownerId, language]);

  if (!alerts.length && !failed) return null;
  const locale = t("ko-KR", "en-US"),
    shown = alerts.slice(0, VISIBLE),
    more = alerts.length - shown.length;
  const dismiss = (key: string) =>
    setAlerts((list) => list.filter((alert) => alert.key !== key));
  return (
    <section
      className="tool-notifications"
      aria-label={t("실험 도구 알림", "Lab tool alerts")}
    >
      {failed && (
        <div className="tool-notification failed" role="alert">
          <div className="tool-notification-text">
            {t(
              "기기 알림을 예약하지 못했습니다. 앱을 열어 둔 동안에만 알림이 표시됩니다.",
              "Notifications could not be scheduled on this device. Alerts will only show while the app is open."
            )}
          </div>
          <div className="tool-notification-actions">
            <button type="button" onClick={() => setFailed(false)}>
              {t("닫기", "Dismiss")}
            </button>
          </div>
        </div>
      )}
      {shown.map((alert) => (
        <div
          key={alert.key}
          role="alert"
          className={
            alert.missed ? "tool-notification missed" : "tool-notification"
          }
        >
          <div className="tool-notification-text">
            {alert.missed && (
              <span className="tool-notification-tag">
                {t("놓친 알림", "Missed")}
              </span>
            )}
            <strong>{alert.title}</strong>
            <span>
              {alert.body}
              {" · "}
              <time dateTime={new Date(alert.at).toISOString()}>
                {new Date(alert.at).toLocaleString(locale, {
                  // A missed alert may be from yesterday.
                  ...(alert.missed
                    ? { month: "short" as const, day: "numeric" as const }
                    : {}),
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </time>
            </span>
          </div>
          <div className="tool-notification-actions">
            <Link to={alert.path} onClick={() => dismiss(alert.key)}>
              {t("열기", "Open")}
            </Link>
            <button
              type="button"
              aria-label={t(
                `${alert.title} 알림 닫기`,
                `Dismiss ${alert.title}`
              )}
              onClick={() => dismiss(alert.key)}
            >
              {t("닫기", "Dismiss")}
            </button>
          </div>
        </div>
      ))}
      {alerts.length > 1 && (
        <div className="tool-notifications-more">
          <span>{more > 0 ? t(`외 ${more}건`, `+${more} more`) : ""}</span>
          <button type="button" onClick={() => setAlerts([])}>
            {t("모두 닫기", "Dismiss all")}
          </button>
        </div>
      )}
    </section>
  );
}
