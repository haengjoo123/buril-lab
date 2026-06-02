import {
  json,
  requireFeedbackAdmin,
  SAFETY_CENTER_SELECT_FIELDS,
  type SafetyCenterAdminEnv,
  type SafetyCenterAdminRow,
} from './_shared'

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected'])

interface UpdateSafetyCenterStatusBody {
  centerId?: string
  status?: string
}

export const onRequestPost = async (context: {
  request: Request
  env: SafetyCenterAdminEnv
}) => {
  const auth = await requireFeedbackAdmin(context.request, context.env)
  if (!auth.ok) {
    return auth.response
  }

  let body: UpdateSafetyCenterStatusBody
  try {
    body = await context.request.json() as UpdateSafetyCenterStatusBody
  } catch {
    return json({ error: 'A valid JSON body is required.' }, { status: 400 })
  }

  const centerId = body.centerId?.trim()
  const status = body.status?.trim()

  if (!centerId) {
    return json({ error: 'centerId is required.' }, { status: 400 })
  }

  if (!status || !VALID_STATUSES.has(status)) {
    return json({ error: 'status must be one of pending, approved, or rejected.' }, { status: 400 })
  }

  const nowIso = new Date().toISOString()
  const { adminClient, identity } = auth.context
  const { data, error } = await adminClient
    .from('safety_centers')
    .update({
      status,
      approved_by: status === 'approved' ? identity.id : null,
      approved_at: status === 'approved' ? nowIso : null,
      updated_at: nowIso,
    })
    .eq('id', centerId)
    .select(SAFETY_CENTER_SELECT_FIELDS)
    .single()

  if (error) {
    const statusCode = error.code === 'PGRST116' ? 404 : 500
    return json({ error: error.message }, { status: statusCode })
  }

  return json({
    item: data as SafetyCenterAdminRow,
  })
}

