// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FEEDBACK_STATUS_FILTER,
  getFeedbackQuickActions,
  matchesFeedbackStatusFilter,
} from './feedbackInboxActions'

describe('feedback inbox actions', () => {
  it('opens on unresolved feedback by default', () => {
    expect(DEFAULT_FEEDBACK_STATUS_FILTER).toBe('open')
    expect(matchesFeedbackStatusFilter('new', 'open')).toBe(true)
    expect(matchesFeedbackStatusFilter('in_progress', 'open')).toBe(true)
    expect(matchesFeedbackStatusFilter('resolved', 'open')).toBe(false)
  })

  it('keeps the all and single-status filters', () => {
    expect(matchesFeedbackStatusFilter('resolved', 'all')).toBe(true)
    expect(matchesFeedbackStatusFilter('resolved', 'resolved')).toBe(true)
    expect(matchesFeedbackStatusFilter('new', 'in_progress')).toBe(false)
  })

  it('offers the next useful status for each row', () => {
    expect(getFeedbackQuickActions('new')).toEqual([
      { kind: 'start', status: 'in_progress' },
      { kind: 'resolve', status: 'resolved' },
    ])
    expect(getFeedbackQuickActions('in_progress')).toEqual([{ kind: 'resolve', status: 'resolved' }])
    expect(getFeedbackQuickActions('resolved')).toEqual([{ kind: 'reopen', status: 'in_progress' }])
  })
})
