import {
  internalErrorResponse,
  json,
  parseBoundedDays,
  parseBoundedLimit,
  requireAnalyticsAdmin,
  unwrapRpcJson,
  type AnalyticsAdminEnv,
} from './_shared'

interface MixturesBody { days?: unknown; limit?: unknown }

export const onRequestPost = async (context: {
  request: Request; env: AnalyticsAdminEnv; data?: { requestId?: unknown }
}) => {
  const auth = await requireAnalyticsAdmin(context.request, context.env, context.data?.requestId)
  if (!auth.ok) return auth.response
  let body: MixturesBody = {}
  try { body = await context.request.json() as MixturesBody } catch { /* Empty body uses defaults. */ }
  const { data, error } = await auth.context.adminClient.rpc('analytics_admin_mixtures', {
    p_days: parseBoundedDays(body.days, 90),
    p_limit: parseBoundedLimit(body.limit, 100),
  })
  if (error) return internalErrorResponse('admin.analytics.mixtures', error)
  return json(unwrapRpcJson(data))
}
