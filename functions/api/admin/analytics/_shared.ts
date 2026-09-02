import {
  internalErrorResponse,
  json,
  requireFeedbackAdmin,
  type FeedbackAdminContext,
  type FeedbackAdminEnv,
} from '../feedback/_shared'

export interface AnalyticsAdminEnv extends FeedbackAdminEnv {
  OPS_ANALYTICS_EXPORT_EMAILS?: string
}
export { json, internalErrorResponse }

export function parseBoundedDays(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isInteger(numeric) ? Math.min(Math.max(numeric, 1), 365) : fallback
}

export function parseBoundedLimit(value: unknown, fallback: number, maximum = 500): number {
  const numeric = Number(value)
  return Number.isInteger(numeric) ? Math.min(Math.max(numeric, 1), maximum) : fallback
}

export async function requireAnalyticsAdmin(request: Request, env: AnalyticsAdminEnv) {
  return requireFeedbackAdmin(request, env)
}

export async function requireAnalyticsExportAdmin(
  request: Request,
  env: AnalyticsAdminEnv,
): Promise<{ ok: true; context: FeedbackAdminContext } | { ok: false; response: Response }> {
  const auth = await requireFeedbackAdmin(request, env)
  if (!auth.ok) return auth
  const allowlist = new Set((env.OPS_ANALYTICS_EXPORT_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean))
  if (allowlist.size === 0) {
    return {
      ok: false,
      response: internalErrorResponse('admin.analytics.export.allowlist', null),
    }
  }
  if (!allowlist.has(auth.context.identity.email)) {
    return {
      ok: false,
      response: json({ error: 'This operator is not allowed to export row-level analytics.' }, { status: 403 }),
    }
  }
  return auth
}

export function unwrapRpcJson<T>(value: unknown): T {
  if (Array.isArray(value) && value.length === 1) return value[0] as T
  return value as T
}
