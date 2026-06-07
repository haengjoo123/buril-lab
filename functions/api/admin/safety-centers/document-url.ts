import {
  json,
  requireFeedbackAdmin,
  type SafetyCenterAdminEnv,
} from './_shared'

interface SafetyCenterDocumentUrlBody {
  centerId?: string
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

  const centerId = body.centerId?.trim()
  if (!centerId) {
    return json({ error: 'centerId is required.' }, { status: 400 })
  }

  const { adminClient } = auth.context
  const { data: center, error: fetchError } = await adminClient
    .from('safety_centers')
    .select('verification_document_path, verification_document_name')
    .eq('id', centerId)
    .single()

  if (fetchError) {
    const statusCode = fetchError.code === 'PGRST116' ? 404 : 500
    return json({ error: fetchError.message }, { status: statusCode })
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
    return json({ error: signedUrlError.message }, { status: 500 })
  }

  return json({
    url: signedUrl.signedUrl,
    expiresIn: 60,
    fileName: center.verification_document_name,
  })
}
