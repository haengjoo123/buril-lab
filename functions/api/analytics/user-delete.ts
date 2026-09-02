import {
  internalErrorResponse,
  analyticsJson,
  createAnalyticsAdminClient,
  isBodyTooLarge,
  normalizeSearchQuery,
  resolveAnalyticsIdentity,
  sanitizeSearchQuery,
  type SearchAnalyticsEnv,
} from './_shared'

interface UserDeleteBody {
  all?: unknown
  query?: unknown
}

export const onRequestPost = async (context: {
  request: Request
  env: SearchAnalyticsEnv
}): Promise<Response> => {
  if (isBodyTooLarge(context.request)) {
    return analyticsJson({ error: 'Request body is too large.' }, { status: 413 })
  }
  const identity = await resolveAnalyticsIdentity(context.request, context.env)
  if ('error' in identity) return identity.error
  if (!identity.userId) return analyticsJson({ error: 'Authentication is required.' }, { status: 401 })

  let body: UserDeleteBody
  try {
    body = await context.request.json() as UserDeleteBody
  } catch {
    return analyticsJson({ error: 'A valid JSON body is required.' }, { status: 400 })
  }
  const deleteAll = body.all === true
  const query = sanitizeSearchQuery(body.query)
  if (!deleteAll && !query) {
    return analyticsJson({ error: 'query is required unless all is true.' }, { status: 400 })
  }

  let adminClient
  try {
    adminClient = createAnalyticsAdminClient(context.env)
  } catch (error) {
    return internalErrorResponse('analytics.user-delete.initialize', error)
  }

  const { data, error } = await adminClient.rpc('analytics_delete_user_search', {
    p_user_id: identity.userId,
    p_query_normalized: deleteAll ? null : normalizeSearchQuery(query),
    p_delete_all: deleteAll,
    p_reason: deleteAll ? 'history_cleared' : 'history_item_deleted',
  })
  if (error) {
    return internalErrorResponse('analytics.user-delete', error)
  }
  return analyticsJson(data)
}
