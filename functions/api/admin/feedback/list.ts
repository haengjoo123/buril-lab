import { FEEDBACK_SELECT_FIELDS, json, requireFeedbackAdmin, type FeedbackAdminEnv, type FeedbackRow } from './_shared'

export const onRequestPost = async (context: {
  request: Request
  env: FeedbackAdminEnv
}) => {
  const auth = await requireFeedbackAdmin(context.request, context.env)
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
    return json({ error: error.message }, { status: 500 })
  }

  return json({
    items: (data || []) as FeedbackRow[],
  })
}
