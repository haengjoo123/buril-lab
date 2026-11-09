import { Capacitor } from "@capacitor/core";
import type { ScheduleOn } from "@capacitor/local-notifications";
export type ToolNotification = {
  key: string;
  title: string;
  at: number;
  repeat?: ScheduleOn;
};
export function notificationId(id: string) {
  let h = 0;
  for (const c of id) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return ((h >>> 0) % 2000000000) + 1;
}
export async function enableNotifications() {
  if (!Capacitor.isNativePlatform()) return true;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  const p = await LocalNotifications.requestPermissions();
  if (p.display !== "granted") throw Error("Notification permission denied");
  if (Capacitor.getPlatform() === "android") {
    const exact = await LocalNotifications.checkExactNotificationSetting();
    if (exact.exact_alarm !== "granted") {
      await LocalNotifications.changeExactNotificationSetting();
      if (
        (await LocalNotifications.checkExactNotificationSetting())
          .exact_alarm !== "granted"
      )
        throw Error("Enable exact alarms in system settings");
    }
  }
  return true;
}
export async function cancelToolNotifications(owner?: string) {
  if (!Capacitor.isNativePlatform()) return;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  const pending = await LocalNotifications.getPending();
  const notifications = pending.notifications
    .filter(
      (n) => n.extra?.burilTool === true && (!owner || n.extra?.owner === owner)
    )
    .map((n) => ({ id: n.id }));
  if (notifications.length) await LocalNotifications.cancel({ notifications });
}
export async function scheduleToolNotifications(
  items: ToolNotification[],
  owner: string
) {
  if (!Capacitor.isNativePlatform()) return;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  const permission = await LocalNotifications.checkPermissions();
  if (permission.display !== "granted") return;
  await cancelToolNotifications(owner);
  const future = items
    .filter((i) => i.at > Date.now())
    .sort((a, b) => a.at - b.at)
    .slice(0, 60);
  if (future.length)
    await LocalNotifications.schedule({
      notifications: future.map((i) => ({
        id: notificationId(i.key),
        title: i.title,
        body: i.title,
        schedule: i.repeat
          ? { on: i.repeat, repeats: true, allowWhileIdle: true }
          : { at: new Date(i.at), allowWhileIdle: true },
        extra: { burilTool: true, owner },
      })),
    });
}
export function deviceEnabled(owner: string, id: string) {
  try {
    return (
      JSON.parse(
        localStorage.getItem(`buril-tools-notifications:${owner}`) || "[]"
      ) as string[]
    ).includes(id);
  } catch {
    return false;
  }
}
export function setDeviceEnabled(owner: string, id: string, on: boolean) {
  let ids: string[] = [];
  try {
    ids = JSON.parse(
      localStorage.getItem(`buril-tools-notifications:${owner}`) || "[]"
    );
  } catch {
    /* recover local setting */
  }
  localStorage.setItem(
    `buril-tools-notifications:${owner}`,
    JSON.stringify(
      on ? [...new Set([...ids, id])] : ids.filter((v) => v !== id)
    )
  );
  window.dispatchEvent(new Event("buril:tool-notifications"));
}
