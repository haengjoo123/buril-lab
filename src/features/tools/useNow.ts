import { useEffect, useState } from "react";
/**
 * The current time, refreshed every `interval` ms. Pass `active: false` when
 * nothing on screen depends on it, and the component stops re-rendering.
 */
export function useNow(interval = 250, active = true) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval, active]);
  return now;
}
/**
 * The current time on every animation frame while `active`, for a display
 * that shows hundredths of a second. Use it in the smallest component that
 * draws the digits: everything that calls it re-renders at the screen's
 * refresh rate. A hidden tab gets no frames, so there it falls back to an
 * interval. The value is not refreshed while inactive; clamp it to the time
 * the clock was started (`Math.max(now, clock.started ?? 0)`).
 */
export function useFrameNow(active: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    let frame = 0,
      timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      clearInterval(timer);
      frame = 0;
      timer = undefined;
    };
    const start = () => {
      stop();
      if (
        document.visibilityState === "hidden" ||
        typeof requestAnimationFrame !== "function"
      )
        timer = setInterval(() => setNow(Date.now()), 250);
      else {
        const loop = () => {
          setNow(Date.now());
          frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);
      }
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", start);
    };
  }, [active]);
  return now;
}
