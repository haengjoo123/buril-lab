import { useContext, useState } from "react";
import { ToolContext, useText, ErrorMessage } from "./ui";
import {
  deviceEnabled,
  enableNotifications,
  setDeviceEnabled,
} from "./notifications";
export default function DeviceToggle({ id }: { id: string }) {
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
