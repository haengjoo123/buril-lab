import { internalErrorResponse, json, requireFeedbackAdmin, type FeedbackAdminEnv, type FeedbackRow } from './_shared'
import { isUuid } from '../../_shared/validation'

const VALID_STATUSES = new Set(['new', 'in_progress', 'resolved'])

interface UpdateFeedbackStatusBody {
  feedbackId?: unknown
  status?: unknown
}

export const onRequestPost = async (context: {
  request: Request
  env: FeedbackAdminEnv
  data?: { requestId?: unknown }
}) => {
  const auth = await requireFeedbackAdmin(context.request, context.env, context.data?.requestId)
  if (!auth.ok) {
    return auth.response
  }

  let body: UpdateFeedbackStatusBody
  try {
    body = await context.request.json() as UpdateFeedbackStatusBody
  } catch {
    return json({ error: 'A valid JSON body is required.' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'A JSON object is required.' }, { status: 400 })
  }
  const feedbackId = typeof body.feedbackId === 'string' ? body.feedbackId.trim() : null
  const status = typeof body.status === 'string' ? body.status.trim() : null

  if (!isUuid(feedbackId)) {
    return json({ error: 'feedbackId must be a UUID.' }, { status: 400 })
  }

  if (!status || !VALID_STATUSES.has(status)) {
    return json({ error: 'status must be one of new, in_progress, or resolved.' }, { status: 400 })
  }

  const { adminClient, identity } = auth.context
  const { data, error } = await adminClient.rpc('operator_feedback_status_v1', {
    p_operator_user_id: identity.id,
    p_feedback_id: feedbackId,
    p_status: status,
    p_request_id: identity.requestId,
    p_assurance_level: identity.assuranceLevel,
  })

  if (error) {
    return internalErrorResponse('admin.feedback.status', error)
  }
  const result = Array.isArray(data) && data.length === 1 ? data[0] : data
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return internalErrorResponse('admin.feedback.status.result', null)
  }
  const record = result as Record<string, unknown>
  if (record.success !== true) {
    if (record.code === 'feedback_not_found') {
      return json({ error: 'Feedback was not found.' }, { status: 404 })
    }
    return internalErrorResponse('admin.feedback.status.authorization', null)
  }
  if (!record.item || typeof record.item !== 'object' || Array.isArray(record.item)) {
    return internalErrorResponse('admin.feedback.status.item', null)
  }

  return json({
    item: record.item as FeedbackRow,
  })
}
