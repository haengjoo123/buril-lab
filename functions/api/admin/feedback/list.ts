import { FEEDBACK_SELECT_FIELDS, internalErrorResponse, json, requireFeedbackAdmin, type FeedbackAdminEnv, type FeedbackRow } from './_shared'

/** A row as selected: the `lab:labs(name)` embed is null when there is no lab or it was deleted. */
type FeedbackListRow = Omit<FeedbackRow, 'lab_name'> & { lab?: { name?: unknown } | null }

function withLabName({ lab, ...row }: FeedbackListRow): FeedbackRow {
  return { ...row, lab_name: typeof lab?.name === 'string' ? lab.name : null }
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

  const { adminClient } = auth.context
  const { data, error } = await adminClient
    .from('feedback')
    .select(FEEDBACK_SELECT_FIELDS)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    return internalErrorResponse('admin.feedback.list', error)
  }

  return json({
    items: ((data || []) as unknown as FeedbackListRow[]).map(withLabName),
  })
}
