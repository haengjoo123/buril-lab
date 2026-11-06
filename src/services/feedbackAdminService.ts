import { postJson } from './internalApi'
import type { FeedbackInboxItem, FeedbackStatus } from '../types/feedback'

interface FeedbackListResponse {
  items: FeedbackInboxItem[]
}

interface FeedbackStatusResponse {
  item: FeedbackInboxItem
}

export async function listFeedbackInbox(): Promise<FeedbackInboxItem[]> {
  const payload = await postJson<FeedbackListResponse>('/api/admin/feedback/list', {})
  return payload.items
}

export async function updateFeedbackStatus(
  feedbackId: string,
  status: FeedbackStatus,
): Promise<FeedbackInboxItem> {
  const payload = await postJson<FeedbackStatusResponse>('/api/admin/feedback/status', {
    feedbackId,
    status,
  })

  return payload.item
}
