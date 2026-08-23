import {
  analyticsJson,
  createAnalyticsAdminClient,
  isBodyTooLarge,
  requireGuestSubject,
  type SearchAnalyticsEnv,
} from './_shared'

interface GuestDeleteBody {
  guestSubjectId?: unknown
  guestDeleteToken?: unknown
}

export const onRequestPost = async (context: {
  request: Request
  env: SearchAnalyticsEnv
}): Promise<Response> => {
  if (isBodyTooLarge(context.request)) {
    return analyticsJson({ error: 'Request body is too large.' }, { status: 413 })
  }
  let body: GuestDeleteBody
  try {
    body = await context.request.json() as GuestDeleteBody
  } catch {
    return analyticsJson({ error: 'A valid JSON body is required.' }, { status: 400 })
  }

  let adminClient
  try {
    adminClient = createAnalyticsAdminClient(context.env)
  } catch (error) {
    return analyticsJson({ error: error instanceof Error ? error.message : 'Analytics is unavailable.' }, { status: 500 })
  }
  const guest = await requireGuestSubject(adminClient, body.guestSubjectId, body.guestDeleteToken)
  if ('error' in guest) return guest.error

  const { data, error } = await adminClient.rpc('analytics_delete_guest_subject', {
    p_guest_subject_id: guest.id,
    p_delete_token_hash: guest.deleteTokenHash,
  })
  if (error) {
    return analyticsJson({ error: error.message }, { status: error.code === 'P0002' ? 404 : 500 })
  }
  return analyticsJson(data)
}
