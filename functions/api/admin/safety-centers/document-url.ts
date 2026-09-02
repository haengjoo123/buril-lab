import {
  internalErrorResponse,
  json,
  requireFeedbackAdmin,
  type SafetyCenterAdminEnv,
} from './_shared'
import { isUuid } from '../../_shared/validation'

interface SafetyCenterDocumentUrlBody {
  centerId?: unknown
}

export const onRequestPost = async (context: {
  request: Request
  env: SafetyCenterAdminEnv
}) => {
  const auth = await requireFeedbackAdmin(context.request, context.env)
  if (!auth.ok) {
    return auth.response
  }

  let body: SafetyCenterDocumentUrlBody
  try {
    body = await context.request.json() as SafetyCenterDocumentUrlBody
  } catch {
    return json({ error: 'A valid JSON body is required.' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'A JSON object is required.' }, { status: 400 })
  }
  const centerId = typeof body.centerId === 'string' ? body.centerId.trim() : null
  if (!isUuid(centerId)) {
    return json({ error: 'centerId must be a UUID.' }, { status: 400 })
  }

  const { adminClient } = auth.context
  const { data: center, error: fetchError } = await adminClient
    .from('safety_centers')
    .select('verification_document_path, verification_document_name')
    .eq('id', centerId)
    .single()

  if (fetchError) {
    return fetchError.code === 'PGRST116'
      ? json({ error: 'Safety center was not found.' }, { status: 404 })
      : internalErrorResponse('admin.safety-centers.document.read', fetchError)
  }

  const path = center?.verification_document_path
  if (!path) {
    return json({ error: 'Verification document is not attached.' }, { status: 404 })
  }

  const { data: signedUrl, error: signedUrlError } = await adminClient.storage
    .from('safety-center-verifications')
    .createSignedUrl(path, 60, {
      download: center.verification_document_name || undefined,
    })

  if (signedUrlError) {
    return internalErrorResponse('admin.safety-centers.document.sign', signedUrlError)
  }

  return json({
    url: signedUrl.signedUrl,
    expiresIn: 60,
    fileName: center.verification_document_name,
  })
}
