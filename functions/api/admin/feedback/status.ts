import { FEEDBACK_SELECT_FIELDS, internalErrorResponse, json, requireFeedbackAdmin, type FeedbackAdminEnv, type FeedbackRow } from './_shared'
import { isUuid } from '../../_shared/validation'

const VALID_STATUSES = new Set(['new', 'in_progress', 'resolved'])

interface UpdateFeedbackStatusBody {
  feedbackId?: unknown
  status?: unknown
}

export const onRequestPost = async (context: {
  request: Request
  env: FeedbackAdminEnv
}) => {
  const auth = await requireFeedbackAdmin(context.request, context.env)
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

  const nowIso = new Date().toISOString()
  const { adminClient, identity } = auth.context
  const { data, error } = await adminClient
    .from('feedback')
    .update({
      status,
      updated_at: nowIso,
      resolved_at: status === 'resolved' ? nowIso : null,
      resolved_by: status === 'resolved' ? identity.id : null,
    })
    .eq('id', feedbackId)
    .select(FEEDBACK_SELECT_FIELDS)
    .single()

  if (error) {
    return error.code === 'PGRST116'
      ? json({ error: 'Feedback was not found.' }, { status: 404 })
      : internalErrorResponse('admin.feedback.status', error)
  }

  return json({
    item: data as FeedbackRow,
  })
}
