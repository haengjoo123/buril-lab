import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { decodeJwt } from 'jose'
import { internalErrorResponse, json } from '../../_shared/json'

export { internalErrorResponse, json }

type OperatorRole = 'reader' | 'approver' | 'raw_exporter'
type AssuranceLevel = 'aal1' | 'aal2'

interface OperatorActionPolicy {
  action: string
  resourceType: string
  role: OperatorRole
}

interface OperatorAuthorizationResult {
  success: boolean
  code?: string | null
  role: OperatorRole
  action: string
  assurance_level: AssuranceLevel
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_BEARER_TOKEN_LENGTH = 8_192
const MAX_FALLBACK_DURATION_MS = 24 * 60 * 60 * 1_000

const OPERATOR_ACTIONS: Readonly<Record<string, OperatorActionPolicy>> = Object.freeze({
  '/api/admin/feedback/list': {
    action: 'feedback.list', resourceType: 'feedback_collection', role: 'reader',
  },
  '/api/admin/feedback/status': {
    action: 'feedback.status', resourceType: 'feedback', role: 'approver',
  },
  '/api/admin/analytics/export': {
    action: 'analytics.export', resourceType: 'analytics_export', role: 'raw_exporter',
  },
  '/api/admin/analytics/mixtures': {
    action: 'analytics.mixtures', resourceType: 'analytics_mixtures', role: 'reader',
  },
  '/api/admin/analytics/reviews': {
    action: 'analytics.reviews', resourceType: 'analytics_reviews', role: 'approver',
  },
  '/api/admin/analytics/search': {
    action: 'analytics.search', resourceType: 'analytics_search', role: 'reader',
  },
  '/api/admin/analytics/summary': {
    action: 'analytics.summary', resourceType: 'analytics_summary', role: 'reader',
  },
  '/api/admin/safety-centers/document-url': {
    action: 'safety_centers.document_url', resourceType: 'safety_center_document', role: 'raw_exporter',
  },
  '/api/admin/safety-centers/list': {
    action: 'safety_centers.list', resourceType: 'safety_center_collection', role: 'reader',
  },
  '/api/admin/safety-centers/status': {
    action: 'safety_centers.status', resourceType: 'safety_center', role: 'approver',
  },
})

export interface FeedbackAdminEnv {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  OPS_AUTH_MODE?: string
  OPS_ADMIN_EMAILS?: string
  FEEDBACK_ADMIN_EMAILS?: string
  OPS_ANALYTICS_EXPORT_EMAILS?: string
  OPS_EMAIL_ALLOWLIST_EXPIRES_AT?: string
  OPS_EMAIL_ALLOWLIST_REASON?: string
}

export interface FeedbackAdminIdentity {
  id: string
  email: string
  role: OperatorRole
  assuranceLevel: AssuranceLevel
  requestId: string
}

export interface FeedbackRow {
  id: string
  type: string
  message: string
  contact: string | null
  user_email: string | null
  user_id: string | null
  user_agent: string | null
  created_at: string
  status: string
  resolved_at: string | null
  resolved_by: string | null
}

export interface FeedbackAdminContext {
  adminClient: SupabaseClient
  identity: FeedbackAdminIdentity
}

export const FEEDBACK_SELECT_FIELDS = [
  'id', 'type', 'message', 'contact', 'user_email', 'user_id', 'user_agent',
  'created_at', 'status', 'resolved_at', 'resolved_by',
].join(', ')

function resolveSupabaseUrl(env: FeedbackAdminEnv): string | null {
  return env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim() || null
}

function resolveSupabaseAnonKey(env: FeedbackAdminEnv): string | null {
  return env.SUPABASE_ANON_KEY?.trim() || env.VITE_SUPABASE_ANON_KEY?.trim() || null
}

function createSupabaseUserClient(env: FeedbackAdminEnv, authHeader: string) {
  const url = resolveSupabaseUrl(env)
  const anonKey = resolveSupabaseAnonKey(env)
  if (!url || !anonKey) throw new Error('Supabase URL or anon key is not configured.')
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function createSupabaseAdminClient(env: FeedbackAdminEnv) {
  const url = resolveSupabaseUrl(env)
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceRoleKey) throw new Error('Supabase URL or service role key is not configured.')
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function parseAdminEmails(...rawValues: Array<string | undefined>): Set<string> {
  return new Set(rawValues.filter(Boolean).join(',').split(',')
    .map((value) => value.trim().toLowerCase()).filter(Boolean))
}

function parseBearerJwt(authHeader: string | null): { header: string; token: string } | null {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  if (!token || token.length > MAX_BEARER_TOKEN_LENGTH || token.split('.').length !== 3 || /\s/.test(token)) {
    return null
  }
  return { header: `Bearer ${token}`, token }
}

function resolveAction(request: Request): OperatorActionPolicy | null {
  try {
    return OPERATOR_ACTIONS[new URL(request.url).pathname] || null
  } catch {
    return null
  }
}

function resolveRequestId(value: unknown): string {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value.toLowerCase() : crypto.randomUUID()
}

function resolveAssuranceLevel(token: string, expectedUserId: string): AssuranceLevel | null {
  try {
    const payload = decodeJwt(token)
    if (payload.sub !== expectedUserId) return null
    return payload.aal === 'aal2' ? 'aal2' : 'aal1'
  } catch {
    return null
  }
}

function parseAuthorizationResult(
  value: unknown,
  policy: OperatorActionPolicy,
  assuranceLevel: AssuranceLevel,
): OperatorAuthorizationResult | null {
  const raw = Array.isArray(value) && value.length === 1 ? value[0] : value
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (typeof record.success !== 'boolean'
    || record.role !== policy.role
    || record.action !== policy.action
    || record.assurance_level !== assuranceLevel
    || (record.code !== null && record.code !== undefined && typeof record.code !== 'string')) {
    return null
  }
  return record as unknown as OperatorAuthorizationResult
}

function authorizationDeniedResponse(code: string | null | undefined): Response {
  switch (code) {
    case 'mfa_required':
      return json({ error: 'MFA verification is required for operator actions.', code: 'MFA_REQUIRED' }, {
        status: 403, headers: { 'Cache-Control': 'no-store' },
      })
    case 'operator_review_required':
      return json({ error: 'This operator role requires its monthly access review.', code: 'OPERATOR_REVIEW_REQUIRED' }, {
        status: 403, headers: { 'Cache-Control': 'no-store' },
      })
    case 'operator_role_required':
      return json({ error: 'The required operator role is not assigned.', code: 'OPERATOR_ROLE_REQUIRED' }, {
        status: 403, headers: { 'Cache-Control': 'no-store' },
      })
    default:
      return internalErrorResponse('admin.auth.decision', null, 503)
  }
}

function validateFallbackWindow(env: FeedbackAdminEnv): boolean {
  const rawExpiry = env.OPS_EMAIL_ALLOWLIST_EXPIRES_AT?.trim() || ''
  const reason = env.OPS_EMAIL_ALLOWLIST_REASON?.trim() || ''
  const expiry = Date.parse(rawExpiry)
  const now = Date.now()
  const hasControlCharacters = Array.from(reason).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(rawExpiry)
    && Number.isFinite(expiry) && expiry > now && expiry - now <= MAX_FALLBACK_DURATION_MS
    && reason.length >= 8 && reason.length <= 200 && !hasControlCharacters
}

async function authorizeServerRole(
  adminClient: SupabaseClient,
  userId: string,
  policy: OperatorActionPolicy,
  requestId: string,
  assuranceLevel: AssuranceLevel,
): Promise<{ result: OperatorAuthorizationResult | null; error: unknown }> {
  const { data, error } = await adminClient.rpc('authorize_operator_action_v1', {
    p_user_id: userId,
    p_required_role: policy.role,
    p_action: policy.action,
    p_resource_type: policy.resourceType,
    p_resource_id: null,
    p_request_id: requestId,
    p_assurance_level: assuranceLevel,
  })
  return { result: error ? null : parseAuthorizationResult(data, policy, assuranceLevel), error }
}

async function authorizeFallback(
  adminClient: SupabaseClient,
  userId: string,
  policy: OperatorActionPolicy,
  requestId: string,
  assuranceLevel: AssuranceLevel,
): Promise<{ result: OperatorAuthorizationResult | null; error: unknown }> {
  const { data, error } = await adminClient.rpc('authorize_operator_fallback_v1', {
    p_user_id: userId,
    p_required_role: policy.role,
    p_action: policy.action,
    p_resource_type: policy.resourceType,
    p_request_id: requestId,
    p_assurance_level: assuranceLevel,
  })
  return { result: error ? null : parseAuthorizationResult(data, policy, assuranceLevel), error }
}

export async function requireFeedbackAdmin(
  request: Request,
  env: FeedbackAdminEnv,
  trustedRequestId?: unknown,
): Promise<{ ok: true; context: FeedbackAdminContext } | { ok: false; response: Response }> {
  const bearer = parseBearerJwt(request.headers.get('Authorization'))
  if (!bearer) return { ok: false, response: json({ error: 'Authentication is required.' }, { status: 401 }) }
  const policy = resolveAction(request)
  if (!policy) return { ok: false, response: internalErrorResponse('admin.auth.action_mapping', null, 503) }

  let userClient: SupabaseClient
  let adminClient: SupabaseClient
  try {
    userClient = createSupabaseUserClient(env, bearer.header)
    adminClient = createSupabaseAdminClient(env)
  } catch (error) {
    return { ok: false, response: internalErrorResponse('admin.auth.initialize', error, 503) }
  }

  const { data, error } = await userClient.auth.getUser(bearer.token)
  if (error || !data.user || !UUID_PATTERN.test(data.user.id)) {
    return { ok: false, response: json({ error: 'Authentication is required.' }, { status: 401 }) }
  }
  const assuranceLevel = resolveAssuranceLevel(bearer.token, data.user.id)
  if (!assuranceLevel) return { ok: false, response: json({ error: 'Authentication is required.' }, { status: 401 }) }

  const email = data.user.email?.trim().toLowerCase() || ''
  const requestId = resolveRequestId(trustedRequestId)
  const authMode = env.OPS_AUTH_MODE?.trim()
  let authorization: Awaited<ReturnType<typeof authorizeServerRole>>

  if (authMode === 'server_roles') {
    authorization = await authorizeServerRole(adminClient, data.user.id, policy, requestId, assuranceLevel)
  } else if (authMode === 'email_allowlist') {
    const generalAllowlist = parseAdminEmails(env.OPS_ADMIN_EMAILS, env.FEEDBACK_ADMIN_EMAILS)
    const exportAllowlist = parseAdminEmails(env.OPS_ANALYTICS_EXPORT_EMAILS)
    const emailAllowed = Boolean(email) && generalAllowlist.has(email)
      && (policy.role !== 'raw_exporter' || exportAllowlist.has(email))
    if (!validateFallbackWindow(env) || !emailAllowed) {
      return { ok: false, response: json({
        error: 'The emergency operator fallback is unavailable.', code: 'OPERATOR_ROLE_REQUIRED',
      }, { status: 403, headers: { 'Cache-Control': 'no-store' } }) }
    }
    authorization = await authorizeFallback(adminClient, data.user.id, policy, requestId, assuranceLevel)
  } else {
    return { ok: false, response: internalErrorResponse('admin.auth.mode', null, 503) }
  }

  if (authorization.error || !authorization.result) {
    return { ok: false, response: internalErrorResponse('admin.auth.audit', authorization.error, 503) }
  }
  if (!authorization.result.success) {
    return { ok: false, response: authorizationDeniedResponse(authorization.result.code) }
  }

  return {
    ok: true,
    context: {
      adminClient,
      identity: {
        id: data.user.id.toLowerCase(), email, role: policy.role,
        assuranceLevel, requestId,
      },
    },
  }
}
