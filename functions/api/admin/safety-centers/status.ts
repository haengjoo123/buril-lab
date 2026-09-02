import {
  internalErrorResponse,
  json,
  requireFeedbackAdmin,
  SAFETY_CENTER_SELECT_FIELDS,
  type SafetyCenterAdminEnv,
  type SafetyCenterAdminRow,
} from './_shared'
import { isUuid } from '../../_shared/validation'

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected'])

interface UpdateSafetyCenterStatusBody {
  centerId?: unknown
  status?: unknown
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

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'A JSON object is required.' }, { status: 400 })
  }
  const centerId = typeof body.centerId === 'string' ? body.centerId.trim() : null
  const status = typeof body.status === 'string' ? body.status.trim() : null

  if (!isUuid(centerId)) {
    return json({ error: 'centerId must be a UUID.' }, { status: 400 })
  }

  if (!status || !VALID_STATUSES.has(status)) {
    return json({ error: 'status must be one of pending, approved, or rejected.' }, { status: 400 })
  }

  const nowIso = new Date().toISOString()
  const { adminClient, identity } = auth.context

  if (status === 'approved') {
    const { data: existingCenter, error: fetchError } = await adminClient
      .from('safety_centers')
      .select('id, verification_document_path')
      .eq('id', centerId)
      .single()

    if (fetchError) {
      return fetchError.code === 'PGRST116'
        ? json({ error: 'Safety center was not found.' }, { status: 404 })
        : internalErrorResponse('admin.safety-centers.status.read', fetchError)
    }

    if (!existingCenter?.verification_document_path) {
      return json({ error: 'Verification document is required before approving a safety center.' }, { status: 400 })
    }
  }

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
    return error.code === 'PGRST116'
      ? json({ error: 'Safety center was not found.' }, { status: 404 })
      : internalErrorResponse('admin.safety-centers.status.update', error)
  }

  return json({
    item: data as SafetyCenterAdminRow,
  })
}
