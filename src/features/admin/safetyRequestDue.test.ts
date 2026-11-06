import { describe, expect, it } from 'vitest';
import { formatDueDate, getRequestDueState, sortLabSafetyRequests } from './safetyRequestDue';
import type { SafetyCenterRequestStatus } from '../safety-center/types';

// 2026-11-06 21:00 in Seoul (UTC+9).
const SEOUL_EVENING = new Date('2026-11-06T12:00:00.000Z').getTime();
// 2026-11-07 00:30 in Seoul, still 2026-11-06 in UTC.
const SEOUL_AFTER_MIDNIGHT = new Date('2026-11-06T15:30:00.000Z').getTime();

describe('getRequestDueState', () => {
  it('counts Asia/Seoul calendar days', () => {
    expect(getRequestDueState('2026-11-09', SEOUL_EVENING)).toEqual({ daysLeft: 3, tone: 'soon' });
    expect(getRequestDueState('2026-11-06', SEOUL_EVENING)).toEqual({ daysLeft: 0, tone: 'soon' });
    expect(getRequestDueState('2026-11-04', SEOUL_EVENING)).toEqual({ daysLeft: -2, tone: 'overdue' });
    expect(getRequestDueState('2026-11-10', SEOUL_EVENING)).toEqual({ daysLeft: 4, tone: 'later' });
  });

  it('rolls over at Seoul midnight, not UTC midnight', () => {
    expect(getRequestDueState('2026-11-06', SEOUL_AFTER_MIDNIGHT)).toEqual({ daysLeft: -1, tone: 'overdue' });
    expect(getRequestDueState('2026-11-07', SEOUL_AFTER_MIDNIGHT)).toEqual({ daysLeft: 0, tone: 'soon' });
  });

  it('counts across month and year boundaries', () => {
    const newYearsEve = new Date('2026-12-31T03:00:00.000Z').getTime();
    expect(getRequestDueState('2027-01-02', newYearsEve)?.daysLeft).toBe(2);
    expect(getRequestDueState('2026-11-30', newYearsEve)?.daysLeft).toBe(-31);
  });

  it('returns null without a readable due date', () => {
    expect(getRequestDueState(null, SEOUL_EVENING)).toBeNull();
    expect(getRequestDueState('', SEOUL_EVENING)).toBeNull();
    expect(getRequestDueState('soon', SEOUL_EVENING)).toBeNull();
    expect(getRequestDueState('2026-13-01', SEOUL_EVENING)).toBeNull();
  });
});

describe('sortLabSafetyRequests', () => {
  const request = (id: string, status: SafetyCenterRequestStatus, due_date: string | null) => ({ id, status, due_date });

  it('puts unresolved requests first, then earliest due date, no due date last', () => {
    const sorted = sortLabSafetyRequests([
      request('resolved-early', 'resolved', '2026-10-01'),
      request('open-none', 'open', null),
      request('open-late', 'open', '2026-12-01'),
      request('submitted-early', 'submitted', '2026-11-02'),
      request('progress-mid', 'in_progress', '2026-11-10'),
      request('resolved-none', 'resolved', null),
    ]);
    expect(sorted.map((row) => row.id)).toEqual([
      'submitted-early',
      'progress-mid',
      'open-late',
      'open-none',
      'resolved-early',
      'resolved-none',
    ]);
  });

  it('keeps the server order for ties', () => {
    const sorted = sortLabSafetyRequests([
      request('first', 'open', '2026-11-10'),
      request('second', 'open', '2026-11-10'),
    ]);
    expect(sorted.map((row) => row.id)).toEqual(['first', 'second']);
  });
});

describe('formatDueDate', () => {
  it('formats the date in the given locale without shifting the day', () => {
    expect(formatDueDate('2026-11-09', 'en-US')).toBe('Nov 9, 2026');
    expect(formatDueDate('2026-11-09', 'ko-KR')).toBe('2026. 11. 9.');
  });

  it('falls back for missing or unreadable values', () => {
    expect(formatDueDate(null, 'ko-KR')).toBe('-');
    expect(formatDueDate('next week', 'ko-KR')).toBe('next week');
  });
});
