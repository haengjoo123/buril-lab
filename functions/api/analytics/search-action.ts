import {
  analyticsJson,
  createAnalyticsAdminClient,
  isBodyTooLarge,
  isUuid,
  optionalShortText,
  requireGuestSubject,
  resolveAnalyticsIdentity,
  sanitizeActionMetadata,
  type SearchAnalyticsEnv,
} from './_shared'

interface SearchActionBody {
  actionId?: unknown
  eventId?: unknown
  relatedEventId?: unknown
  actionType?: unknown
  targetType?: unknown
  targetRef?: unknown
  matchedCas?: unknown
  matchedStandardName?: unknown
  metadata?: unknown
  guestSubjectId?: unknown
  guestDeleteToken?: unknown
}
const ACTION_TYPES = new Set([
  'result_opened',
  'result_selected',
  'query_reformulated',
  'scan_corrected',
  'added_to_batch',
])
const TARGET_TYPES = new Set(['chemical', 'product', 'cabinet', 'query', 'batch'])

export const onRequestPost = async (context: {
  request: Request
  env: SearchAnalyticsEnv
}): Promise<Response> => {
  if (isBodyTooLarge(context.request)) {
    return analyticsJson({ error: 'Request body is too large.' }, { status: 413 })
  }

  let body: SearchActionBody
  try {
    body = await context.request.json() as SearchActionBody
  } catch {
    return analyticsJson({ error: 'A valid JSON body is required.' }, { status: 400 })
  }
  if (!isUuid(body.actionId) || !isUuid(body.eventId)) {
    return analyticsJson({ error: 'actionId and eventId must be UUIDs.' }, { status: 400 })
  }
  if (body.relatedEventId !== undefined && body.relatedEventId !== null && !isUuid(body.relatedEventId)) {
    return analyticsJson({ error: 'relatedEventId must be a UUID.' }, { status: 400 })
  }
  const actionType = typeof body.actionType === 'string' && ACTION_TYPES.has(body.actionType)
    ? body.actionType
    : null
  const targetType = typeof body.targetType === 'string' && TARGET_TYPES.has(body.targetType)
    ? body.targetType
    : null
  if (!actionType) return analyticsJson({ error: 'A valid actionType is required.' }, { status: 400 })

  const identity = await resolveAnalyticsIdentity(context.request, context.env)
  if ('error' in identity) return identity.error

  let adminClient
  try {
    adminClient = createAnalyticsAdminClient(context.env)
  } catch (error) {
    return analyticsJson({ error: error instanceof Error ? error.message : 'Analytics is unavailable.' }, { status: 500 })
  }

  let guestSubjectId: string | null = null
  if (!identity.userId) {
    const guest = await requireGuestSubject(adminClient, body.guestSubjectId, body.guestDeleteToken)
    if ('error' in guest) return guest.error
    guestSubjectId = guest.id
  }

  const { data: event, error: eventError } = await adminClient
    .from('search_analytics_events')
    .select('id, user_id, guest_subject_id')
    .eq('id', body.eventId)
    .maybeSingle()
  if (eventError) return analyticsJson({ error: eventError.message }, { status: 500 })
  const ownsEvent = event && (identity.userId
    ? event.user_id === identity.userId
    : event.guest_subject_id === guestSubjectId)
  if (!ownsEvent) return analyticsJson({ error: 'Search event was not found.' }, { status: 404 })

  let relatedEventId: string | null = isUuid(body.relatedEventId) ? body.relatedEventId : null
  if (relatedEventId) {
    const { data: related } = await adminClient
      .from('search_analytics_events')
      .select('user_id, guest_subject_id')
      .eq('id', relatedEventId)
      .maybeSingle()
    const ownsRelated = related && (identity.userId
      ? related.user_id === identity.userId
      : related.guest_subject_id === guestSubjectId)
    if (!ownsRelated) relatedEventId = null
  }

  const { error } = await adminClient.from('search_analytics_actions').insert({
    id: body.actionId,
    event_id: body.eventId,
    related_event_id: relatedEventId,
    action_type: actionType,
    target_type: targetType,
    target_ref: optionalShortText(body.targetRef, 300),
    matched_cas: optionalShortText(body.matchedCas, 32),
    matched_standard_name: optionalShortText(body.matchedStandardName, 300),
    metadata: sanitizeActionMetadata(body.metadata),
  })
  if (error && error.code !== '23505') {
    return analyticsJson({ error: error.message }, { status: 500 })
  }
  return analyticsJson({ actionId: body.actionId, duplicate: error?.code === '23505' })
}
