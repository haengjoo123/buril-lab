import {
  json,
  requireFeedbackAdmin,
  SAFETY_CENTER_SELECT_FIELDS,
  type SafetyCenterAdminEnv,
  type SafetyCenterAdminRow,
} from './_shared'

export const onRequestPost = async (context: {
  request: Request
  env: SafetyCenterAdminEnv
}) => {
  const auth = await requireFeedbackAdmin(context.request, context.env)
  if (!auth.ok) {
    return auth.response
  }

  const { adminClient } = auth.context
  const { data, error } = await adminClient
    .from('safety_centers')
    .select(SAFETY_CENTER_SELECT_FIELDS)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    return json({ error: error.message }, { status: 500 })
  }

  return json({
    items: (data || []) as SafetyCenterAdminRow[],
  })
}

