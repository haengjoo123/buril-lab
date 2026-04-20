export type FeedbackType = 'bug' | 'improvement' | 'general'

export type FeedbackStatus = 'new' | 'in_progress' | 'resolved'

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
}
