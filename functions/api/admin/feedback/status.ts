import { FEEDBACK_SELECT_FIELDS, json, requireFeedbackAdmin, type FeedbackAdminEnv, type FeedbackRow } from './_shared'

const VALID_STATUSES = new Set(['new', 'in_progress', 'resolved'])

interface UpdateFeedbackStatusBody {
  feedbackId?: string
  status?: string
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

  const feedbackId = body.feedbackId?.trim()
  const status = body.status?.trim()

  if (!feedbackId) {
    return json({ error: 'feedbackId is required.' }, { status: 400 })
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
    const statusCode = error.code === 'PGRST116' ? 404 : 500
    return json({ error: error.message }, { status: statusCode })
  }

  return json({
    item: data as FeedbackRow,
  })
}
