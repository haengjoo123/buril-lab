import {
  internalErrorResponse,
  analyticsJson,
  boundedInteger,
  classifySearchQuery,
  createAnalyticsAdminClient,
  isBodyTooLarge,
  isUuid,
  normalizeSearchQuery,
  optionalShortText,
  requireGuestSubject,
  resolveAnalyticsIdentity,
  sanitizeSearchQuery,
  verifyAnalyticsLabMembership,
  type SearchAnalyticsEnv,
} from './_shared'

interface SearchEventBody {
  eventId?: unknown
  sessionId?: unknown
  previousEventId?: unknown
  rawQuery?: unknown
  searchChannel?: unknown
  outcome?: unknown
  labId?: unknown
  chemicalResultCount?: unknown
  productResultCount?: unknown
  cabinetResultCount?: unknown
  latencyMs?: unknown
  matchedCas?: unknown
  matchedPubchemCid?: unknown
  matchedKoshaId?: unknown
  matchedStandardName?: unknown
  previousIngestionFailures?: unknown
  guestSubjectId?: unknown
  guestDeleteToken?: unknown
}

interface PreviousSearchEventRow {
  id: string
  user_id: string | null
  guest_subject_id: string | null
  session_id: string
  query_normalized: string
  created_at: string
}

const OUTCOMES = new Set(['matched', 'no_result', 'invalid_query', 'technical_error'])
const CHANNELS = new Set(['manual', 'autocomplete', 'history', 'scan', 'voice', 'url'])

export const onRequestPost = async (context: {
  request: Request
  env: SearchAnalyticsEnv
}): Promise<Response> => {
  if (isBodyTooLarge(context.request)) {
    return analyticsJson({ error: 'Request body is too large.' }, { status: 413 })
  }

  let body: SearchEventBody
  try {
    body = await context.request.json() as SearchEventBody
  } catch {
    return analyticsJson({ error: 'A valid JSON body is required.' }, { status: 400 })
  }

  if (!isUuid(body.eventId) || !isUuid(body.sessionId)) {
    return analyticsJson({ error: 'eventId and sessionId must be UUIDs.' }, { status: 400 })
  }
  if (body.previousEventId !== undefined && body.previousEventId !== null && !isUuid(body.previousEventId)) {
    return analyticsJson({ error: 'previousEventId must be a UUID.' }, { status: 400 })
  }

  const querySanitized = sanitizeSearchQuery(body.rawQuery)
  if (!querySanitized) {
    return analyticsJson({ error: 'A non-empty submitted query is required.' }, { status: 400 })
  }
  const queryNormalized = normalizeSearchQuery(querySanitized)
  const outcome = typeof body.outcome === 'string' && OUTCOMES.has(body.outcome) ? body.outcome : null
  const searchChannel = typeof body.searchChannel === 'string' && CHANNELS.has(body.searchChannel)
    ? body.searchChannel
    : null
  if (!outcome || !searchChannel) {
    return analyticsJson({ error: 'A valid searchChannel and outcome are required.' }, { status: 400 })
  }

  const identity = await resolveAnalyticsIdentity(context.request, context.env)
  if ('error' in identity) return identity.error

  let adminClient
  try {
    adminClient = createAnalyticsAdminClient(context.env)
  } catch (error) {
    return internalErrorResponse('analytics.search-event.initialize', error)
  }

  let guestSubjectId: string | null = null
  if (!identity.userId) {
    const guest = await requireGuestSubject(adminClient, body.guestSubjectId, body.guestDeleteToken)
    if ('error' in guest) return guest.error
    guestSubjectId = guest.id
    const { error } = await adminClient
      .from('search_analytics_guest_subjects')
      .upsert({
        id: guest.id,
        delete_token_hash: guest.deleteTokenHash,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: 'id' })
    if (error) return internalErrorResponse('analytics.search-event.guest', error)
  }

  const labId = identity.userId && isUuid(body.labId) ? body.labId : null
  if (identity.userId && body.labId && !labId) {
    return analyticsJson({ error: 'labId must be a UUID.' }, { status: 400 })
  }
  if (identity.userId && labId && !(await verifyAnalyticsLabMembership(adminClient, identity.userId, labId))) {
    return analyticsJson({ error: 'The requested laboratory scope is not accessible.' }, { status: 403 })
  }

  let previousEventId: string | null = isUuid(body.previousEventId) ? body.previousEventId : null
  let previousEvent: PreviousSearchEventRow | null = null
  if (previousEventId) {
    const { data } = await adminClient
      .from('search_analytics_events')
      .select('id, user_id, guest_subject_id, session_id, query_normalized, created_at')
      .eq('id', previousEventId)
      .maybeSingle()
    const candidate = data as unknown as PreviousSearchEventRow | null
    previousEvent = candidate
    const sameSubject = candidate !== null && (
      identity.userId
        ? candidate.user_id === identity.userId
        : candidate.guest_subject_id === guestSubjectId
    )
    const withinSession = candidate !== null
      && candidate.session_id === body.sessionId
      && Date.now() - Date.parse(candidate.created_at) <= 30 * 60 * 1000
    if (!sameSubject || !withinSession) {
      previousEventId = null
      previousEvent = null
    }
  }

  const rawMatchedPubchemCid = Number(body.matchedPubchemCid)
  const matchedPubchemCid = Number.isSafeInteger(rawMatchedPubchemCid) && rawMatchedPubchemCid > 0
    ? rawMatchedPubchemCid
    : null
  const row = {
    id: body.eventId,
    user_id: identity.userId,
    guest_subject_id: guestSubjectId,
    lab_id: labId,
    session_id: body.sessionId,
    previous_event_id: previousEventId,
    query_sanitized: querySanitized,
    query_normalized: queryNormalized,
    query_type: classifySearchQuery(querySanitized),
    search_channel: searchChannel,
    outcome,
    chemical_result_count: boundedInteger(body.chemicalResultCount, 0, 100000),
    product_result_count: boundedInteger(body.productResultCount, 0, 100000),
    cabinet_result_count: boundedInteger(body.cabinetResultCount, 0, 100000),
    latency_ms: boundedInteger(body.latencyMs, 0, 300000),
    matched_cas: optionalShortText(body.matchedCas, 32),
    matched_pubchem_cid: matchedPubchemCid,
    matched_kosha_id: optionalShortText(body.matchedKoshaId, 100),
    matched_standard_name: optionalShortText(body.matchedStandardName, 300),
    previous_ingestion_failures: boundedInteger(body.previousIngestionFailures, 0, 1000),
    commercial_cohort: 'internal_only',
  }

  const { error: insertError } = await adminClient.from('search_analytics_events').insert(row)
  if (insertError) {
    if (insertError.code === '23505') {
      const { data: existing } = await adminClient
        .from('search_analytics_events')
        .select('id, user_id, guest_subject_id')
        .eq('id', body.eventId)
        .maybeSingle()
      const sameSubject = existing && (identity.userId
        ? existing.user_id === identity.userId
        : existing.guest_subject_id === guestSubjectId)
      if (sameSubject) {
        return analyticsJson({ eventId: body.eventId, duplicate: true })
      }
    }
    return internalErrorResponse('analytics.search-event.insert', insertError)
  }

  if (
    previousEvent
    && previousEvent.query_normalized !== queryNormalized
    && Date.now() - Date.parse(previousEvent.created_at) <= 10 * 60 * 1000
  ) {
    await adminClient.from('search_analytics_actions').insert({
      event_id: previousEvent.id,
      related_event_id: body.eventId,
      action_type: 'query_reformulated',
      target_type: 'query',
      target_ref: queryNormalized,
      metadata: { source: searchChannel },
    })
  }

  return analyticsJson({
    eventId: body.eventId,
    sanitizedQuery: querySanitized,
    queryType: row.query_type,
  })
}
