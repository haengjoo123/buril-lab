import { describe, expect, it } from 'vitest';
import { formatAuditRelativeTime } from './auditRelativeTime';

const NOW = new Date('2026-11-06T12:00:00.000Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatAuditRelativeTime', () => {
  it('uses relative wording for the last week', () => {
    expect(formatAuditRelativeTime(ago(10 * 1000), 'en-US', NOW)).toBe('now');
    expect(formatAuditRelativeTime(ago(5 * MINUTE), 'en-US', NOW)).toBe('5 minutes ago');
    expect(formatAuditRelativeTime(ago(3 * HOUR), 'en-US', NOW)).toBe('3 hours ago');
    expect(formatAuditRelativeTime(ago(DAY), 'en-US', NOW)).toBe('yesterday');
    expect(formatAuditRelativeTime(ago(5 * MINUTE), 'ko-KR', NOW)).toBe('5분 전');
  });

  it('falls back to the date for older entries and handles bad input', () => {
    const old = ago(30 * DAY);
    expect(formatAuditRelativeTime(old, 'en-US', NOW)).toBe(new Date(old).toLocaleDateString('en-US'));
    expect(formatAuditRelativeTime('not-a-date', 'en-US', NOW)).toBe('-');
  });
});
