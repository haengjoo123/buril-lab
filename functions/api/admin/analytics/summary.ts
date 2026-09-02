import {
  internalErrorResponse,
  json,
  parseBoundedDays,
  requireAnalyticsAdmin,
  unwrapRpcJson,
  type AnalyticsAdminEnv,
} from './_shared'

interface SummaryBody { days?: unknown }

export const onRequestPost = async (context: { request: Request; env: AnalyticsAdminEnv }) => {
  const auth = await requireAnalyticsAdmin(context.request, context.env)
  if (!auth.ok) return auth.response
  let body: SummaryBody = {}
  try { body = await context.request.json() as SummaryBody } catch { /* Empty body uses defaults. */ }
  const days = parseBoundedDays(body.days, 30)
  const [summaryResult, governanceResult] = await Promise.all([
    auth.context.adminClient.rpc('analytics_admin_summary', { p_days: days }),
    auth.context.adminClient.rpc('analytics_admin_governance'),
  ])
  if (summaryResult.error) return internalErrorResponse('admin.analytics.summary', summaryResult.error)
  if (governanceResult.error) return internalErrorResponse('admin.analytics.governance', governanceResult.error)
  return json({
    summary: unwrapRpcJson(summaryResult.data),
    governance: unwrapRpcJson(governanceResult.data),
  })
}
