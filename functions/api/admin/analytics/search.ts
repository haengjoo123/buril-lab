import {
  json,
  parseBoundedDays,
  parseBoundedLimit,
  requireAnalyticsAdmin,
  unwrapRpcJson,
  type AnalyticsAdminEnv,
} from './_shared'

interface SearchBody { days?: unknown; limit?: unknown; order?: unknown }

export const onRequestPost = async (context: { request: Request; env: AnalyticsAdminEnv }) => {
  const auth = await requireAnalyticsAdmin(context.request, context.env)
  if (!auth.ok) return auth.response
  let body: SearchBody = {}
  try { body = await context.request.json() as SearchBody } catch { /* Empty body uses defaults. */ }
  const { data, error } = await auth.context.adminClient.rpc('analytics_admin_search', {
    p_days: parseBoundedDays(body.days, 90),
    p_limit: parseBoundedLimit(body.limit, 100),
    p_order: body.order === 'confusion' ? 'confusion' : 'demand',
  })
  if (error) return json({ error: error.message }, { status: 500 })
  return json(unwrapRpcJson(data))
}
