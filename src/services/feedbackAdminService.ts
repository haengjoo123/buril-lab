import { supabase } from './supabaseClient'
import { getInternalApiUrl } from './apiUrl'
import type { FeedbackInboxItem, FeedbackStatus } from '../types/feedback'

export class FeedbackAdminApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'FeedbackAdminApiError'
    this.status = status
  }
}

interface ApiErrorPayload {
  error?: string
}

interface FeedbackListResponse {
  items: FeedbackInboxItem[]
}

interface FeedbackStatusResponse {
  item: FeedbackInboxItem
}

async function createAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`
  }

  return headers
}

async function parseApiError(response: Response): Promise<FeedbackAdminApiError> {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    const payload = await response.json() as ApiErrorPayload
    return new FeedbackAdminApiError(
      payload.error || `Request failed with status ${response.status}`,
      response.status,
    )
  }

  const text = await response.text()
  return new FeedbackAdminApiError(text || `Request failed with status ${response.status}`, response.status)
}

async function postFeedbackAdminJson<TResponse>(path: string, body: unknown): Promise<TResponse> {
  const response = await fetch(getInternalApiUrl(path), {
    method: 'POST',
    headers: await createAuthHeaders(),
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw await parseApiError(response)
  }

  return await response.json() as TResponse
}

export async function listFeedbackInbox(): Promise<FeedbackInboxItem[]> {
  const payload = await postFeedbackAdminJson<FeedbackListResponse>('/api/admin/feedback/list', {})
  return payload.items
}

export async function updateFeedbackStatus(
  feedbackId: string,
  status: FeedbackStatus,
): Promise<FeedbackInboxItem> {
  const payload = await postFeedbackAdminJson<FeedbackStatusResponse>('/api/admin/feedback/status', {
    feedbackId,
    status,
  })

  return payload.item
}
