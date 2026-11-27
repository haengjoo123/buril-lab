import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import { Capacitor } from "@capacitor/core";
import { ToolContext, useText, ErrorMessage } from "./ui";
import {
  alertSoundEnabled,
  checkNotificationAccess,
  deviceEnabled,
  notificationAccess,
  openExactAlarmSetting,
  playAlertSound,
  requestNotificationAccess,
  setAlertSoundEnabled,
  setDeviceEnabled,
  subscribeNotificationState,
  unlockAlertSound,
} from "./notifications";
import "./runtime.css";

/**
 * "Notify on this device" for one timer, alarm, event or culture timer, with
 * what the user should know about how the alert will reach them here.
 */
export default function DeviceToggle({ id }: { id: string }) {
  const ctx = useContext(ToolContext)!,
    t = useText(),
    owner = ctx.repo.owner,
    native = Capacitor.isNativePlatform();
  const enabled = useSyncExternalStore(
      subscribeNotificationState,
      () => deviceEnabled(owner, id),
      () => false
    ),
    sound = useSyncExternalStore(
      subscribeNotificationState,
      alertSoundEnabled,
      () => true
    ),
    access = useSyncExternalStore(
      subscribeNotificationState,
      notificationAccess,
      () => null
    );
  const [error, setError] = useState(""),
    [refused, setRefused] = useState(false);
  useEffect(() => {
    if (enabled) void checkNotificationAccess().catch(() => undefined);
  }, [enabled]);
  const blocked =
    native && (refused || (enabled && access?.display === "denied"));
  // A fragment, so the switch stays a direct child of the row a tool puts it in.
  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={async (event) => {
            const on = event.target.checked;
            setError("");
            setRefused(false);
            if (!on) return setDeviceEnabled(owner, id, false);
            try {
              const found = await requestNotificationAccess();
              // A native app that may not notify cannot keep this promise.
              if (native && found.display !== "granted") setRefused(true);
              else setDeviceEnabled(owner, id, true);
            } catch (e) {
              setError(String(e));
            }
          }}
        />
        {t("이 기기에서 알림", "Notify on this device")}
      </label>
      {enabled && !native && (
        <label>
          <input
            type="checkbox"
            checked={sound}
            onChange={(event) => {
              setAlertSoundEnabled(event.target.checked);
              if (event.target.checked) {
                // This click is what lets the browser play it later.
                unlockAlertSound();
                playAlertSound();
              }
            }}
          />
          {t("알림 소리", "Alert sound")}
        </label>
      )}
      {blocked && (
        <p className="tool-error tool-device-note" role="alert">
          {enabled
            ? t(
                "이 앱의 알림 권한이 꺼져 있어, 앱을 닫으면 알림이 오지 않습니다. 기기 설정에서 알림을 허용하세요.",
                "Notifications are turned off for this app, so nothing arrives once the app is closed. Allow them in the device settings."
              )
            : t(
                "알림 권한이 허용되지 않아 켤 수 없습니다. 기기 설정에서 이 앱의 알림을 허용한 뒤 다시 켜세요.",
                "This cannot be switched on because notifications are not allowed. Allow them for this app in the device settings, then try again."
              )}
        </p>
      )}
      {enabled && native && access?.display === "granted" && !access.exact && (
        <p className="tool-muted tool-device-note tool-device-warning">
          {t(
            "정확한 알람 권한이 없어 알림이 몇 분 늦을 수 있습니다.",
            "Without the exact alarm permission, alerts may be a few minutes late."
          )}
          <button
            type="button"
            onClick={() =>
              void openExactAlarmSetting().catch((e) => setError(String(e)))
            }
          >
            {t("설정 열기", "Open settings")}
          </button>
        </p>
      )}
      {enabled && !native && (
        <p className="tool-muted tool-device-note">
          {t(
            "웹에서는 이 앱이 브라우저 탭에 열려 있을 때만 알림이 울립니다. 탭이 백그라운드에 있으면 1분쯤 늦을 수 있습니다.",
            "On the web, alerts only go off while this app is open in a browser tab. In a background tab they can be about a minute late."
          )}
          {access?.display === "denied" &&
            ` ${t(
              "브라우저 알림이 차단되어 있어, 다른 창을 보고 있을 때는 소리와 앱 안의 알림으로만 알립니다.",
              "Browser notifications are blocked, so while you are in another window you only get the sound and the alert inside the app."
            )}`}
        </p>
      )}
      <ErrorMessage message={error} />
    </>
  );
}
