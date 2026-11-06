// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { countApprovalsByStatus, getWaitingDays, sortApprovalQueue } from './safetyCenterApprovalQueue'

const NOW = Date.parse('2026-11-06T12:00:00.000Z')

describe('safety center approval queue', () => {
  it('counts whole waiting days and never goes negative', () => {
    expect(getWaitingDays('2026-11-06T09:00:00.000Z', NOW)).toBe(0)
    expect(getWaitingDays('2026-11-05T11:59:00.000Z', NOW)).toBe(1)
    expect(getWaitingDays('2026-11-02T12:00:00.000Z', NOW)).toBe(4)
    expect(getWaitingDays('2026-11-07T12:00:00.000Z', NOW)).toBe(0)
    expect(getWaitingDays('not a date', NOW)).toBe(0)
  })

  it('counts waiting days on the Asia/Seoul calendar, not in 24-hour steps', () => {
    // 09:00 KST on 6 Nov.
    const morning = Date.parse('2026-11-06T00:00:00.000Z')
    // 22:00 KST the day before: 11 hours ago, but yesterday.
    expect(getWaitingDays('2026-11-05T13:00:00.000Z', morning)).toBe(1)
    // 00:30 KST the same day.
    expect(getWaitingDays('2026-11-05T15:30:00.000Z', morning)).toBe(0)
    // 23:59 KST on 2 Nov: four calendar days, more than the 3-day warning.
    expect(getWaitingDays('2026-11-02T14:59:00.000Z', morning)).toBe(4)
    // 00:00 KST on 3 Nov: exactly three calendar days, still within the warning.
    expect(getWaitingDays('2026-11-02T15:00:00.000Z', morning)).toBe(3)
  })

  it('counts requests per status', () => {
    expect(countApprovalsByStatus([
      { status: 'pending' }, { status: 'pending' }, { status: 'approved' }, { status: 'rejected' },
    ])).toEqual({ all: 4, pending: 2, approved: 1, rejected: 1 })
    expect(countApprovalsByStatus([])).toEqual({ all: 0, pending: 0, approved: 0, rejected: 0 })
  })

  it('puts pending requests first, oldest first, and keeps decided ones newest first', () => {
    const sorted = sortApprovalQueue([
      { id: 'approved-new', status: 'approved' as const, created_at: '2026-11-05T00:00:00.000Z' },
      { id: 'pending-new', status: 'pending' as const, created_at: '2026-11-04T00:00:00.000Z' },
      { id: 'rejected-old', status: 'rejected' as const, created_at: '2026-10-01T00:00:00.000Z' },
      { id: 'pending-old', status: 'pending' as const, created_at: '2026-10-20T00:00:00.000Z' },
    ])

    expect(sorted.map((item) => item.id)).toEqual(['pending-old', 'pending-new', 'approved-new', 'rejected-old'])
  })

  it('does not reorder the input array', () => {
    const items = [
      { status: 'pending' as const, created_at: '2026-11-04T00:00:00.000Z' },
      { status: 'pending' as const, created_at: '2026-10-04T00:00:00.000Z' },
    ]
    sortApprovalQueue(items)
    expect(items[0].created_at).toBe('2026-11-04T00:00:00.000Z')
  })
})
