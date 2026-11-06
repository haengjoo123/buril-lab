import type { FeedbackStatus } from '../../types/feedback'

/** `open` is the inbox default: everything that still needs work (new + in progress). */
export type FeedbackStatusFilter = 'open' | 'all' | FeedbackStatus

export const DEFAULT_FEEDBACK_STATUS_FILTER: FeedbackStatusFilter = 'open'

export function matchesFeedbackStatusFilter(status: FeedbackStatus, filter: FeedbackStatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'open') return status !== 'resolved'
  return status === filter
}

export type FeedbackQuickActionKind = 'start' | 'resolve' | 'reopen'

export interface FeedbackQuickAction {
  kind: FeedbackQuickActionKind
  status: FeedbackStatus
}

/** One-tap status changes shown in each row. Anything else is reachable through the undo toast. */
export function getFeedbackQuickActions(status: FeedbackStatus): FeedbackQuickAction[] {
  if (status === 'new') {
    return [{ kind: 'start', status: 'in_progress' }, { kind: 'resolve', status: 'resolved' }]
  }
  if (status === 'in_progress') return [{ kind: 'resolve', status: 'resolved' }]
  return [{ kind: 'reopen', status: 'in_progress' }]
}
