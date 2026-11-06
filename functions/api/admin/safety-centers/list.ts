import {
  internalErrorResponse,
  json,
  requireFeedbackAdmin,
  SAFETY_CENTER_SELECT_FIELDS,
  type SafetyCenterAdminEnv,
  type SafetyCenterAdminRow,
} from './_shared'
import { withRequesterDomains } from './_requesterDomain'

export const onRequestPost = async (context: {
  request: Request
  env: SafetyCenterAdminEnv
  data?: { requestId?: unknown }
}) => {
  const auth = await requireFeedbackAdmin(context.request, context.env, context.data?.requestId)
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
    return internalErrorResponse('admin.safety-centers.list', error)
  }

  return json({
    // Pending rows (oldest 20) carry the requester's email domain and whether it matches the
    // institution domain, so the operator can spot a personal address before approving.
    items: await withRequesterDomains(adminClient, (data || []) as SafetyCenterAdminRow[]),
  })
}
