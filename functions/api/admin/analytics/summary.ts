import {
  internalErrorResponse,
  json,
  parseBoundedDays,
  requireAnalyticsAdmin,
  unwrapRpcJson,
  type AnalyticsAdminEnv,
} from './_shared'

interface SummaryBody { days?: unknown; includeKpis?: unknown }

export type KpisErrorCode = 'KPIS_UNAVAILABLE' | 'KPIS_FAILED'

/** PostgREST "function not in schema cache" and Postgres undefined_function: the migration is not applied yet. */
const MISSING_FUNCTION_CODES = new Set(['PGRST202', '42883'])

function errorCode(error: unknown): unknown {
  return error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined
}

function kpisErrorCode(error: unknown): KpisErrorCode {
  const code = errorCode(error)
  return typeof code === 'string' && MISSING_FUNCTION_CODES.has(code) ? 'KPIS_UNAVAILABLE' : 'KPIS_FAILED'
}

/**
 * Same log line as internalErrorResponse (functions/api/_shared/json.ts): the scope and an
 * allowlisted-format code only, never the provider message, which can carry SQL or user input.
 * The KPI failure does not fail the response, so it cannot go through internalErrorResponse.
 */
function logKpisError(error: unknown): void {
  const rawCode = errorCode(error)
  const providerCode = typeof rawCode === 'string' && /^[A-Z0-9_]{1,64}$/.test(rawCode) ? rawCode : null
  console.error(JSON.stringify({ event: 'api_internal_error', scope: 'admin.analytics.kpis', providerCode }))
}

export const onRequestPost = async (context: {
  request: Request; env: AnalyticsAdminEnv; data?: { requestId?: unknown }
}) => {
  const auth = await requireAnalyticsAdmin(context.request, context.env, context.data?.requestId)
  if (!auth.ok) return auth.response
  let body: SummaryBody | null = {}
  try { body = await context.request.json() as SummaryBody | null } catch { /* Empty body uses defaults. */ }
  const days = parseBoundedDays(body?.days, 30)
  // Only the operator home asks for the KPIs; every other caller keeps the two-call response.
  const includeKpis = body?.includeKpis === true
  const client = auth.context.adminClient
  const [summaryResult, governanceResult, kpisResult] = await Promise.all([
    client.rpc('analytics_admin_summary', { p_days: days }),
    client.rpc('analytics_admin_governance'),
    includeKpis ? client.rpc('analytics_admin_kpis_v1', { p_days: days }) : Promise.resolve(null),
  ])
  if (summaryResult.error) return internalErrorResponse('admin.analytics.summary', summaryResult.error)
  if (governanceResult.error) return internalErrorResponse('admin.analytics.governance', governanceResult.error)
  const payload = {
    summary: unwrapRpcJson(summaryResult.data),
    governance: unwrapRpcJson(governanceResult.data),
  }
  if (!kpisResult) return json(payload)
  // The KPIs are an extra: when they fail (or the function is not deployed yet) the home falls back
  // to the summary, so the response stays 200 with a code the app can explain.
  if (kpisResult.error) {
    logKpisError(kpisResult.error)
    return json({ ...payload, kpis: null, kpisError: kpisErrorCode(kpisResult.error) })
  }
  const kpis = unwrapRpcJson<unknown>(kpisResult.data)
  if (!kpis || typeof kpis !== 'object' || Array.isArray(kpis)) {
    logKpisError(null)
    return json({ ...payload, kpis: null, kpisError: 'KPIS_FAILED' })
  }
  return json({ ...payload, kpis })
}
