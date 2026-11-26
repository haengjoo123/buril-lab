export type Clock = {
  id: string;
  name: string;
  color: string;
  duration: number;
  remaining: number;
  end: number | null;
  running: boolean;
  elapsed: number;
  started: number | null;
};
export const elapsedTime = (clock: Clock, now: number) =>
  clock.elapsed + (clock.running && clock.started ? now - clock.started : 0);
export const remainingTime = (clock: Clock, now: number) =>
  clock.running && clock.end ? Math.max(0, clock.end - now) : clock.remaining;
/**
 * What the start/pause button does to a clock. A countdown that has run out
 * starts over from its full duration: `remaining` still holds whatever was
 * left at the last resume, which is not what "restart" means.
 */
export function toggleClock(
  clock: Clock,
  now: number,
  stopwatch: boolean
): Partial<Clock> {
  if (clock.running && (stopwatch || remainingTime(clock, now) > 0))
    return {
      running: false,
      remaining: remainingTime(clock, now),
      elapsed: elapsedTime(clock, now),
      started: null,
      end: null,
    };
  const from = clock.running
    ? clock.duration
    : clock.remaining || clock.duration;
  return { running: true, started: now, end: now + from, remaining: from };
}
export const clockText = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((seconds / 60) % 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
};
export interface Alarm {
  id: string;
  name: string;
  at: string;
  weekdays: number[];
  active: boolean;
}
export function nextAlarm(alarm: Alarm, now: number) {
  if (!alarm.active) return null;
  if (!alarm.weekdays.length)
    return +new Date(alarm.at) > now ? +new Date(alarm.at) : null;
  const original = new Date(alarm.at);
  for (let i = 0; i < 8; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() + i);
    date.setHours(original.getHours(), original.getMinutes(), 0, 0);
    if (+date > now && alarm.weekdays.includes(date.getDay())) return +date;
  }
  return null;
}
export const localDateInput = (date: Date) =>
  new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
