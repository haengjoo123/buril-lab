const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Short relative time for audit cards ("5분 전", "어제"); older than a week
 * falls back to the date so it never reads as "23일 전".
 */
export function formatAuditRelativeTime(value: string, locale: string, now: number = Date.now()): string {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '-';

  const diff = time - now;
  const distance = Math.abs(diff);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (distance < MINUTE_MS) return formatter.format(0, 'second');
  if (distance < HOUR_MS) return formatter.format(Math.round(diff / MINUTE_MS), 'minute');
  if (distance < DAY_MS) return formatter.format(Math.round(diff / HOUR_MS), 'hour');
  if (distance < 7 * DAY_MS) return formatter.format(Math.round(diff / DAY_MS), 'day');
  return new Date(time).toLocaleDateString(locale);
}
