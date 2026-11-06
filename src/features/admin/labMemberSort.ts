const DAY_MS = 24 * 60 * 60 * 1000;

/** Members who joined this recently are listed first with a "새 멤버" chip so their role gets checked. */
export const NEW_MEMBER_DAYS = 14;

export interface SortableLabMember {
  user_id: string;
  role: string;
  joined_at: string;
}

function joinedTime(member: Pick<SortableLabMember, 'joined_at'>): number | null {
  const time = new Date(member.joined_at).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * Joined within the last NEW_MEMBER_DAYS. The admin is never "new": their role is not set
 * from the member list (the lab creator would otherwise be flagged in every new lab).
 */
export function isNewLabMember(member: Pick<SortableLabMember, 'role' | 'joined_at'>, now: number): boolean {
  if (member.role === 'admin') return false;
  const joinedAt = joinedTime(member);
  if (joinedAt === null) return false;
  return now - joinedAt <= NEW_MEMBER_DAYS * DAY_MS;
}

function memberRank(member: SortableLabMember, now: number): number {
  if (isNewLabMember(member, now)) return 0;
  if (member.role === 'admin') return 1;
  if (member.role === 'pi') return 2;
  return 3;
}

/** New members first, then admin and PI, then everyone else; ties by join date (earliest first). */
export function sortLabMembers<T extends SortableLabMember>(members: readonly T[], now: number): T[] {
  return [...members].sort((a, b) => {
    const rankDiff = memberRank(a, now) - memberRank(b, now);
    if (rankDiff !== 0) return rankDiff;
    const aJoined = joinedTime(a);
    const bJoined = joinedTime(b);
    if (aJoined === bJoined) return 0;
    if (aJoined === null) return 1;
    if (bJoined === null) return -1;
    return aJoined - bJoined;
  });
}

/**
 * Keeps rows where they were (while an undo toast is up, so nothing moves under the finger).
 * Members the held order does not know yet go after it in sorted order; removed members drop out.
 */
export function applyHeldMemberOrder<T extends { user_id: string }>(
  sortedMembers: readonly T[],
  heldOrder: readonly string[] | null,
): T[] {
  if (!heldOrder) return [...sortedMembers];
  const byId = new Map(sortedMembers.map((member) => [member.user_id, member]));
  const held = heldOrder.flatMap((userId) => {
    const member = byId.get(userId);
    return member ? [member] : [];
  });
  const heldIds = new Set(heldOrder);
  return [...held, ...sortedMembers.filter((member) => !heldIds.has(member.user_id))];
}
