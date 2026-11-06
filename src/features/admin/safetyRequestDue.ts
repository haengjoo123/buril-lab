import type { SafetyCenterRequestStatus } from '../safety-center/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Unresolved center requests due within this many days are flagged amber. */
export const DUE_SOON_DAYS = 3;

export type RequestDueTone = 'overdue' | 'soon' | 'later';

export interface RequestDueState {
  /** Calendar days until the due date on the Asia/Seoul calendar: 0 = due today, negative = overdue. */
  daysLeft: number;
  tone: RequestDueTone;
}

const seoulDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Day number (days since the epoch) of a 'YYYY-MM-DD' date, or null when it is not one. */
function parseDateKey(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

/** Day number of `now` on the Asia/Seoul calendar, where center due dates are set. */
function seoulDayNumber(now: number): number {
  const parts = seoulDateFormatter.formatToParts(new Date(now));
  const part = (type: 'year' | 'month' | 'day') => Number(parts.find((item) => item.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day')) / DAY_MS;
}

/** D-day of a request due date ('YYYY-MM-DD'), counted in Asia/Seoul calendar days. */
export function getRequestDueState(dueDate: string | null | undefined, now: number): RequestDueState | null {
  if (!dueDate) return null;
  const dueDay = parseDateKey(dueDate);
  if (dueDay === null) return null;
  const daysLeft = dueDay - seoulDayNumber(now);
  const tone: RequestDueTone = daysLeft < 0 ? 'overdue' : daysLeft <= DUE_SOON_DAYS ? 'soon' : 'later';
  return { daysLeft, tone };
}

/** Unresolved requests first, then by due date (earliest first, no due date last). */
export function sortLabSafetyRequests<T extends { status: SafetyCenterRequestStatus; due_date: string | null }>(
  requests: readonly T[],
): T[] {
  return [...requests].sort((a, b) => {
    const resolvedDiff = Number(a.status === 'resolved') - Number(b.status === 'resolved');
    if (resolvedDiff !== 0) return resolvedDiff;
    const aDue = a.due_date ? parseDateKey(a.due_date) : null;
    const bDue = b.due_date ? parseDateKey(b.due_date) : null;
    if (aDue === bDue) return 0;
    if (aDue === null) return 1;
    if (bDue === null) return -1;
    return aDue - bDue;
  });
}

/** A date-only value ('YYYY-MM-DD') in the reader's locale, without shifting it across time zones. */
export function formatDueDate(value: string | null | undefined, locale: string): string {
  if (!value) return '-';
  const day = parseDateKey(value);
  if (day === null) return value;
  return new Date(day * DAY_MS).toLocaleDateString(locale, { timeZone: 'UTC', dateStyle: 'medium' });
}
