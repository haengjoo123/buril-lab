import { describe, expect, it } from 'vitest';
import { applyHeldMemberOrder, isNewLabMember, sortLabMembers } from './labMemberSort';

const NOW = new Date('2026-11-06T12:00:00.000Z').getTime();
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();
const member = (user_id: string, role: string, joinedDaysAgo: number) => ({
  user_id,
  role,
  joined_at: daysAgo(joinedDaysAgo),
});

describe('isNewLabMember', () => {
  it('flags members who joined within the last 14 days', () => {
    expect(isNewLabMember(member('a', 'student', 0), NOW)).toBe(true);
    expect(isNewLabMember(member('a', 'student', 14), NOW)).toBe(true);
    expect(isNewLabMember(member('a', 'student', 14.5), NOW)).toBe(false);
    expect(isNewLabMember(member('a', 'graduate', 40), NOW)).toBe(false);
  });

  it('never flags the admin or an unreadable join date', () => {
    expect(isNewLabMember(member('a', 'admin', 1), NOW)).toBe(false);
    expect(isNewLabMember({ role: 'student', joined_at: 'not-a-date' }, NOW)).toBe(false);
  });
});

describe('sortLabMembers', () => {
  it('lists new members, then admin and PI, then everyone else by join date', () => {
    const sorted = sortLabMembers([
      member('old-grad', 'graduate', 200),
      member('pi', 'pi', 300),
      member('new-2', 'student', 2),
      member('admin', 'admin', 400),
      member('older-undergrad', 'undergrad', 250),
      member('new-10', 'student', 10),
      member('new-pi', 'pi', 5),
    ], NOW);

    expect(sorted.map((row) => row.user_id)).toEqual([
      'new-10',
      'new-pi',
      'new-2',
      'admin',
      'pi',
      'older-undergrad',
      'old-grad',
    ]);
  });

  it('keeps the admin in the admin slot even in a brand-new lab and does not mutate input', () => {
    const input = [member('new', 'student', 1), member('admin', 'admin', 1), member('postdoc', 'postdoc', 30)];
    const sorted = sortLabMembers(input, NOW);
    expect(sorted.map((row) => row.user_id)).toEqual(['new', 'admin', 'postdoc']);
    expect(input.map((row) => row.user_id)).toEqual(['new', 'admin', 'postdoc']);
  });

  it('puts unreadable join dates last within their group', () => {
    const sorted = sortLabMembers([
      { user_id: 'broken', role: 'graduate', joined_at: '' },
      member('grad', 'graduate', 100),
    ], NOW);
    expect(sorted.map((row) => row.user_id)).toEqual(['grad', 'broken']);
  });
});

describe('applyHeldMemberOrder', () => {
  const sorted = [member('b', 'pi', 30), member('a', 'graduate', 40), member('c', 'graduate', 20)];

  it('returns the sorted order when nothing is held', () => {
    expect(applyHeldMemberOrder(sorted, null).map((row) => row.user_id)).toEqual(['b', 'a', 'c']);
  });

  it('keeps held rows in place, appends unknown members and drops removed ones', () => {
    const held = ['a', 'gone', 'b'];
    expect(applyHeldMemberOrder(sorted, held).map((row) => row.user_id)).toEqual(['a', 'b', 'c']);
  });
});
