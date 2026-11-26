/**
 * Delivering tool alerts on this device: the per-device switches, permission,
 * the system notifications of the native apps, and sound and browser
 * notifications on the web. What is due and when is decided in
 * `notificationPlan.ts`.
 */
import { Capacitor } from "@capacitor/core";
import type {
  LocalNotificationSchema,
  LocalNotificationsPlugin,
} from "@capacitor/local-notifications";
import { notificationId } from "../reminders/deviceNotifications";
import {
  diffScheduled,
  scheduleKey,
  scheduleSignature,
  type PlannedNotification,
} from "./notificationPlan";

export { notificationId };

// ---- Switches kept on this device ----

/** Sent on `window` when a switch below, or the permission, was changed here. */
export const NOTIFICATION_SETTINGS_EVENT = "buril:tool-notifications";
const optInKey = (owner: string) => `buril-tools-notifications:${owner}`;
const lastSeenKey = (owner: string) => `buril-tools-last-seen:${owner}`;
const claimsKey = (owner: string) => `buril-tools-alert-claims:${owner}`;
const SOUND_KEY = "buril-tools-alert-sound";

// Where storage is blocked or full, a choice lasts until the page is closed.
const unsaved = new Map<string, string | null>();
const stored = (key: string) => {
  if (unsaved.has(key)) return unsaved.get(key) ?? null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    unsaved.delete(key);
  } catch {
    unsaved.set(key, value);
  }
};
const announceSettings = () => {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(NOTIFICATION_SETTINGS_EVENT));
};

/**
 * The stored list of things switched on for this device, as text. It changes
 * exactly when the list does, which makes it a cheap thing to compare.
 */
export const deviceOptIns = (owner: string) => stored(optInKey(owner)) ?? "";
let parsedOptIns: { raw: string; ids: Set<string> } | undefined;
/** The ids switched on for this device. Parsed once per change of the list. */
export function readDeviceEnabled(owner: string): ReadonlySet<string> {
  const raw = deviceOptIns(owner);
  if (parsedOptIns?.raw !== raw) {
    let ids: unknown = [];
    try {
      ids = JSON.parse(raw || "[]");
    } catch {
      // An unreadable list is an empty one; the next change rewrites it.
    }
    parsedOptIns = {
      raw,
      ids: new Set(
        Array.isArray(ids)
          ? ids.filter((id): id is string => typeof id === "string")
          : []
      ),
    };
  }
  return parsedOptIns.ids;
}
export const deviceEnabled = (owner: string, id: string) =>
  readDeviceEnabled(owner).has(id);
export function setDeviceEnabled(owner: string, id: string, on: boolean) {
  const ids = new Set(readDeviceEnabled(owner));
  if (on) ids.add(id);
  else ids.delete(id);
  store(optInKey(owner), JSON.stringify([...ids]));
  announceSettings();
}
/** Whether a `storage` event from another tab changed this account's list. */
export const isOptInChange = (event: StorageEvent, owner: string) =>
  event.key === null || event.key === optInKey(owner);

/** The in-app beep. On unless switched off on this device. */
export const alertSoundEnabled = () => stored(SOUND_KEY) !== "off";
export function setAlertSoundEnabled(on: boolean) {
  store(SOUND_KEY, on ? null : "off");
  announceSettings();
}

// ---- Permission ----

export interface NotificationAccess {
  /**
   * Whether the system may show notifications. "prompt": the browser has not
   * been answered yet. "unsupported": this browser has none. Alerts inside
   * the open app do not depend on it.
   */
  display: "granted" | "denied" | "prompt" | "unsupported";
  /**
   * Android only: alarms may be set for an exact time. Without it the system
   * delivers them when it suits the battery, up to a few minutes late.
   */
  exact: boolean;
}
let access: NotificationAccess | null = null;
const accessListeners = new Set<() => void>();
/** The access as last seen; null until something has checked it. */
export const notificationAccess = () => access;
function setAccess(next: NotificationAccess) {
  if (access?.display !== next.display || access.exact !== next.exact) {
    access = next;
    accessListeners.forEach((listener) => listener());
  }
  return access;
}
/** For `useSyncExternalStore`: the switches above and the access. */
export function subscribeNotificationState(listener: () => void) {
  accessListeners.add(listener);
  window.addEventListener(NOTIFICATION_SETTINGS_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    accessListeners.delete(listener);
    window.removeEventListener(NOTIFICATION_SETTINGS_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

const plugin = async () =>
  (await import("@capacitor/local-notifications")).LocalNotifications;
const webAccess = (): NotificationAccess => ({
  display:
    typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission === "default"
      ? "prompt"
      : Notification.permission,
  exact: true,
});
async function nativeAccess(
  notifications: LocalNotificationsPlugin,
  display?: string
): Promise<NotificationAccess> {
  display ??= (await notifications.checkPermissions()).display;
  let exact = true;
  if (Capacitor.getPlatform() === "android")
    try {
      exact =
        (await notifications.checkExactNotificationSetting()).exact_alarm ===
        "granted";
    } catch {
      // Not offered by this Android version: alarms are exact there.
    }
  return { display: display === "granted" ? "granted" : "denied", exact };
}
let checking: Promise<NotificationAccess> | undefined;
/** Looks up the access without asking the user for anything. */
export function checkNotificationAccess(): Promise<NotificationAccess> {
  if (!Capacitor.isNativePlatform())
    return Promise.resolve(setAccess(webAccess()));
  // Every switch on a screen asks at once; one look serves them all.
  checking ??= plugin()
    .then((notifications) => nativeAccess(notifications))
    .then(setAccess)
    .finally(() => {
      checking = undefined;
    });
  return checking;
}
/**
 * Asks for permission to notify. Call it from a click.
 *
 * On the web it does not wait for the answer: the browser's question can stay
 * open indefinitely, and what the click was for (starting a timer) must not
 * wait with it. The result then says "prompt", and the access is updated once
 * the user has answered. Being refused is a result, not an error.
 */
export async function requestNotificationAccess(): Promise<NotificationAccess> {
  if (!Capacitor.isNativePlatform()) {
    unlockAlertSound();
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    )
      try {
        const answered = () => {
          setAccess(webAccess());
        };
        // Older Safari takes a callback and returns nothing.
        const asked = Notification.requestPermission(answered) as
          | Promise<unknown>
          | undefined;
        asked?.then(answered, answered);
      } catch {
        // No way to ask here; alerts inside the app still work.
      }
    return setAccess(webAccess());
  }
  const notifications = await plugin();
  const permission = await notifications.requestPermissions();
  return setAccess(await nativeAccess(notifications, permission.display));
}
/**
 * The same, for the tool screens: rejects only when a native app may not show
 * notifications at all, where switching an alert on would promise something
 * the device will not do. A refusal on the web, or of exact alarms on
 * Android, resolves: the alert still arrives.
 */
export async function enableNotifications(): Promise<NotificationAccess> {
  const result = await requestNotificationAccess();
  if (Capacitor.isNativePlatform() && result.display !== "granted")
    throw Error("Notification permission denied");
  return result;
}
/** Android: opens the system screen where exact alarms are allowed. */
export async function openExactAlarmSetting(): Promise<NotificationAccess> {
  if (Capacitor.getPlatform() !== "android") return checkNotificationAccess();
  const notifications = await plugin();
  await notifications.changeExactNotificationSetting();
  const result = setAccess(await nativeAccess(notifications));
  // What is already scheduled is scheduled again with the new precision.
  announceSettings();
  return result;
}

// ---- Native notifications ----

export const TOOL_CHANNEL_ID = "tool-alarms-v1";
/** An `at` this close is left out: the plugin fires a past time immediately. */
const TOO_SOON_MS = 1000;

// Signing out cancels an account's notifications while its runtime may still
// be mounted. Anything that runtime asks for afterwards is refused.
const stopped = new Map<string, number>();
const isStopped = (owner: string, since: number) =>
  (stopped.get(owner) ?? -Infinity) > since;

// One native change at a time: two overlapping passes would each act on a
// list of pending notifications the other is about to change.
let queue: Promise<unknown> = Promise.resolve();
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

let channel: { name: string; id: string | undefined } | undefined;
async function toolChannel(
  notifications: LocalNotificationsPlugin,
  labels: { name: string; description: string }
) {
  if (Capacitor.getPlatform() !== "android") return undefined;
  if (channel?.name !== labels.name) {
    let id: string | undefined;
    try {
      // Creating it again only renames it (the app language changed).
      await notifications.createChannel({
        id: TOOL_CHANNEL_ID,
        name: labels.name,
        description: labels.description,
        importance: 4,
        visibility: 1,
        vibration: true,
      });
      id = TOOL_CHANNEL_ID;
    } catch {
      // Android 7 and older have no channels; the default one is used.
    }
    channel = { name: labels.name, id };
  }
  return channel.id;
}

const isToolNotification = (
  notification: { extra?: unknown },
  owner?: string
) => {
  const extra = notification.extra as
    | { burilTool?: unknown; owner?: unknown }
    | null
    | undefined;
  return extra?.burilTool === true && (!owner || extra.owner === owner);
};

/**
 * Makes the system hold exactly these alerts for the account: pending ones no
 * longer wanted are cancelled, new or changed ones are scheduled, and the
 * rest is left alone. Resolves with the access it found, or null where there
 * is nothing to schedule (the web, or an account that has signed out since
 * `since`).
 */
export function syncToolNotifications(
  entries: readonly PlannedNotification[],
  owner: string,
  options: { since: number; channel: { name: string; description: string } }
): Promise<NotificationAccess | null> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve(null);
  return inTurn(async () => {
    if (isStopped(owner, options.since)) return null;
    const notifications = await plugin();
    const found = setAccess(await nativeAccess(notifications));
    if (found.display !== "granted") return found;
    // The channel appears in the system settings, so it is made with the
    // first alert rather than for everyone.
    const channelId = entries.length
      ? await toolChannel(notifications, options.channel)
      : undefined;
    const ios = Capacitor.getPlatform() === "ios";
    const delivery = `${found.exact ? "exact" : "inexact"}:${channelId ?? ""}`;
    const now = Date.now();
    const wanted = new Map<number, LocalNotificationSchema>();
    for (const entry of entries) {
      if (!entry.repeat && entry.at <= now + TOO_SOON_MS) continue;
      const id = notificationId(scheduleKey(entry));
      if (wanted.has(id)) continue;
      wanted.set(id, {
        id,
        title: entry.title,
        body: entry.body,
        schedule: entry.repeat
          ? { on: entry.repeat, repeats: true, allowWhileIdle: true }
          : { at: new Date(entry.at), allowWhileIdle: true },
        ...(channelId ? { channelId } : {}),
        // iOS plays nothing unless a sound is named; a name it cannot find
        // gives the system's default sound.
        ...(ios ? { sound: "default" } : {}),
        // Shown as a banner even while the app is open.
        foreground: true,
        // Without the permission, asking for an exact alarm makes the plugin
        // open the system settings on every schedule.
        isExactNotification: found.exact,
        extra: {
          burilTool: true,
          owner,
          key: entry.key,
          path: entry.path,
          signature: scheduleSignature(entry, delivery),
        },
      });
    }
    // "Scheduled" leaves out what has already been delivered, which Android
    // keeps listing as pending. A native build older than this call falls
    // back to that list.
    const scheduled = (
      await notifications
        .getAll({ state: "SCHEDULED" })
        .catch(() => notifications.getPending())
    ).notifications.filter((notification) =>
      isToolNotification(notification, owner)
    );
    const { cancel, add } = diffScheduled(
      scheduled.map((notification) => ({
        id: notification.id,
        signature: String(notification.extra?.signature ?? ""),
      })),
      [...wanted.values()].map((notification) => ({
        id: notification.id,
        signature: notification.extra.signature as string,
      }))
    );
    if (isStopped(owner, options.since)) return found;
    if (cancel.length)
      await notifications.cancel({
        notifications: cancel.map((id) => ({ id })),
      });
    if (add.length)
      await notifications.schedule({
        notifications: add.map((id) => wanted.get(id)!),
      });
    return found;
  });
}

/**
 * Removes an account's tool notifications from this device, and what the
 * device remembered about its alerts. Called when the account signs out.
 */
export function cancelToolNotifications(owner?: string): Promise<void> {
  if (owner) {
    stopped.set(owner, Date.now());
    for (const key of [optInKey, lastSeenKey, claimsKey])
      store(key(owner), null);
  }
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  return inTurn(async () => {
    const notifications = await plugin();
    const pending = (await notifications.getPending()).notifications
      .filter((notification) => isToolNotification(notification, owner))
      .map((notification) => ({ id: notification.id }));
    if (pending.length) await notifications.cancel({ notifications: pending });
  });
}

const TOOL_PATH = /^\/app\/tools(\/[a-z0-9-]+){0,2}$/i;
/**
 * Calls `open` with the tool's route when the user taps one of this account's
 * tool notifications. Returns the function that stops listening.
 */
export function onToolNotificationTap(
  owner: string,
  open: (path: string) => void
): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};
  let stop = false,
    remove: (() => Promise<void>) | undefined;
  void plugin()
    .then((notifications) =>
      notifications.addListener(
        "localNotificationActionPerformed",
        (action) => {
          const extra = action.notification?.extra as
            | { path?: unknown }
            | null
            | undefined;
          if (
            action.actionId === "tap" &&
            isToolNotification(action.notification, owner) &&
            typeof extra?.path === "string" &&
            TOOL_PATH.test(extra.path)
          )
            open(extra.path);
        }
      )
    )
    .then((handle) => {
      remove = () => handle.remove();
      if (stop) void remove();
    })
    .catch(() => undefined);
  return () => {
    stop = true;
    void remove?.();
  };
}

// ---- Alerts while the app is open (web) ----

let audio: AudioContext | null | undefined;
function audioContext() {
  if (audio === undefined)
    try {
      const Context =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      audio = Context ? new Context() : null;
    } catch {
      audio = null;
    }
  return audio;
}
// An audio output left open keeps the device's sound system awake (a laptop
// may not go to sleep), so it is closed again once nothing is playing.
let resting: ReturnType<typeof setTimeout> | undefined;
function rest(context: AudioContext, after: number) {
  clearTimeout(resting);
  resting = setTimeout(
    () => void context.suspend().catch(() => undefined),
    after
  );
}
/**
 * Browsers only let a page make sound after the user has interacted with it.
 * Call this from a click or key press: once started that way, the output can
 * be opened again later for an alert.
 */
export function unlockAlertSound() {
  try {
    const context = audioContext();
    if (!context) return;
    if (context.state !== "running")
      void context.resume().catch(() => undefined);
    rest(context, 1000);
  } catch {
    // No audio on this device.
  }
}
function beep(context: AudioContext) {
  const start = context.currentTime + 0.05;
  // Two groups of three short beeps.
  for (const offset of [0, 0.22, 0.44, 1.1, 1.32, 1.54]) {
    const oscillator = context.createOscillator(),
      gain = context.createGain(),
      at = start + offset;
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.18);
  }
}
/**
 * Beeps and, where the device can, vibrates. Silent when the sound is
 * switched off, and when the browser still blocks audio.
 */
export function playAlertSound() {
  if (!alertSoundEnabled()) return;
  try {
    const context = audioContext();
    const play = (output: AudioContext) => {
      beep(output);
      rest(output, 3000);
    };
    if (context?.state === "running") play(context);
    else if (context) {
      // A blocked output opens at the next click, however much later: a beep
      // that could not be played on time is dropped, not kept for then.
      const asked = Date.now();
      void context.resume().then(
        () => {
          if (context.state !== "running") return;
          if (Date.now() - asked < 1500) play(context);
          else rest(context, 0);
        },
        () => undefined
      );
    }
  } catch {
    // No audio on this device.
  }
  try {
    navigator.vibrate?.([200, 100, 200, 100, 400]);
  } catch {
    // Vibration is blocked before the first interaction with the page.
  }
}

/**
 * Shows a browser notification for an alert, for when the page is not being
 * looked at. False when the browser does not allow it; Chrome on Android, for
 * one, only accepts notifications from a service worker.
 */
export function showSystemNotification(
  alert: { key: string; title: string; body: string },
  onClick: () => void
): boolean {
  try {
    if (
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    )
      return false;
    const notification = new Notification(alert.title, {
      body: alert.body,
      // Another tab showing the same alert replaces this one instead of adding to it.
      tag: alert.key,
    });
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}

const TAB = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const CLAIM_KEEP_MS = 600_000;
const CLAIM_SETTLE_MS = 150;
type Claims = Record<string, [tab: string, at: number]>;
function readClaims(owner: string): Claims {
  try {
    const value: unknown = JSON.parse(stored(claimsKey(owner)) || "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Claims)
      : {};
  } catch {
    return {};
  }
}
/**
 * Which of these alerts this tab should make noise for. Every open tab shows
 * an alert, but only the tab that claims its key first beeps and notifies.
 * Claims are kept in localStorage, which all tabs of the account share.
 */
export async function claimAlerts(
  owner: string,
  keys: readonly string[]
): Promise<string[]> {
  if (!keys.length) return [];
  const claim = () => {
    const now = Date.now(),
      claims = readClaims(owner);
    for (const [key, entry] of Object.entries(claims))
      if (!Array.isArray(entry) || !(now - entry[1] < CLAIM_KEEP_MS))
        delete claims[key];
    const mine = keys.filter((key) => !claims[key]);
    for (const key of mine) claims[key] = [TAB, now];
    if (mine.length)
      localStorage.setItem(claimsKey(owner), JSON.stringify(claims));
    return mine;
  };
  try {
    // A lock makes "look, then claim" one step across tabs.
    if (typeof navigator !== "undefined" && navigator.locks)
      return await navigator.locks.request(
        `buril-tools-alert-claims:${owner}`,
        async () => claim()
      );
    // Without one, two tabs can both claim; the later write wins, and both
    // agree on it a moment later.
    const mine = claim();
    if (!mine.length) return [];
    await new Promise((resolve) => setTimeout(resolve, CLAIM_SETTLE_MS));
    const settled = readClaims(owner);
    return mine.filter((key) => settled[key]?.[0] === TAB);
  } catch {
    // Storage is blocked: this tab cannot know about others.
    return [...keys];
  }
}

/** When this device last checked the account's alerts; null when unknown. */
export function readLastSeen(owner: string): number | null {
  const value = Number(stored(lastSeenKey(owner)));
  return Number.isFinite(value) && value > 0 ? value : null;
}
/**
 * Records that alerts were checked up to `time`. Several tabs share the
 * record, so it only moves forward. `since` is when the caller started: an
 * account that signed out after that is not written to again.
 */
export function writeLastSeen(owner: string, time: number, since: number) {
  if (isStopped(owner, since)) return;
  const known = readLastSeen(owner);
  if (known !== null && known >= time && known <= Date.now()) return;
  store(lastSeenKey(owner), String(time));
}
