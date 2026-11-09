export type FeedbackType = 'bug' | 'improvement' | 'general'

export type FeedbackStatus = 'new' | 'in_progress' | 'resolved'

/** App tab a feedback was sent from (`feedback.source_screen`, closed list = AppTab). */
export type FeedbackSourceScreen = 'search' | 'logs' | 'cabinet' | 'inventory' | 'admin' | 'tools'

export interface FeedbackInboxItem {
  id: string
  type: FeedbackType
  message: string
  contact: string | null
  user_email: string | null
  user_id: string | null
  user_agent: string | null
  created_at: string
  status: FeedbackStatus
  resolved_at: string | null
  resolved_by: string | null
  /** Lab space it was sent from; null outside a lab space and after account or lab deletion. */
  lab_id: string | null
  source_screen: FeedbackSourceScreen | null
  /** Current lab name. Only the list returns it; a status change returns the row without it. */
  lab_name?: string | null
}
