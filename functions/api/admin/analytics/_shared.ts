import {
  internalErrorResponse,
  json,
  requireFeedbackAdmin,
  type FeedbackAdminContext,
  type FeedbackAdminEnv,
} from '../feedback/_shared'

export type AnalyticsAdminEnv = FeedbackAdminEnv
export { json, internalErrorResponse }

export function parseBoundedDays(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isInteger(numeric) ? Math.min(Math.max(numeric, 1), 365) : fallback
}

export function parseBoundedLimit(value: unknown, fallback: number, maximum = 500): number {
  const numeric = Number(value)
  return Number.isInteger(numeric) ? Math.min(Math.max(numeric, 1), maximum) : fallback
}

export async function requireAnalyticsAdmin(request: Request, env: AnalyticsAdminEnv, trustedRequestId?: unknown) {
  return requireFeedbackAdmin(request, env, trustedRequestId)
}

export async function requireAnalyticsExportAdmin(
  request: Request,
  env: AnalyticsAdminEnv,
  trustedRequestId?: unknown,
): Promise<{ ok: true; context: FeedbackAdminContext } | { ok: false; response: Response }> {
  return requireFeedbackAdmin(request, env, trustedRequestId)
}

export function unwrapRpcJson<T>(value: unknown): T {
  if (Array.isArray(value) && value.length === 1) return value[0] as T
  return value as T
}
