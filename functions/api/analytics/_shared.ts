import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { normalizeCasNumber } from '../../../src/utils/casNumber'

export interface SearchAnalyticsEnv {
  SUPABASE_URL?: string
  VITE_SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  VITE_SUPABASE_ANON_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
}

export interface SearchAnalyticsIdentity {
  userId: string | null
  email: string | null
}

export type SearchAnalyticsClient = SupabaseClient

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CAS_CANDIDATE_PATTERN = /\b\d{2,7}-\d{2}-\d\b/g
const FORMULA_PATTERN = /^(?=.{1,100}$)(?=.*[A-Z])(?:[A-Z][a-z]?\d*|[()[\]]|\d+|[.+\-·])+$/
const MAX_BODY_BYTES = 32 * 1024

export function analyticsJson(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: {
      'Cache-Control': 'no-store',
      ...(init?.headers || {}),
    },
  })
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function isBodyTooLarge(request: Request): boolean {
  const contentLength = Number(request.headers.get('content-length') || 0)
  return Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES
}

export function sanitizeSearchQuery(rawValue: unknown): string {
  if (typeof rawValue !== 'string') return ''

  const preservedCas: string[] = []
  let value = Array.from(rawValue.normalize('NFKC'), (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159) ? ' ' : character
  }).join('')
  value = value.replace(CAS_CANDIDATE_PATTERN, (candidate) => {
    const cas = normalizeCasNumber(candidate)
    if (!cas) return candidate
    const index = preservedCas.push(cas) - 1
    return `BURILCAS${index}PLACEHOLDER`
  })
  value = value
    .replace(/(?:https?:\/\/|www\.)\S+/gi, '[URL]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g, '[TOKEN]')
    .replace(/(?:\+?\d[\d ()-]{8,}\d)/g, '[PHONE]')
    .replace(/\b(?=[A-Za-z0-9_-]{32,}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/g, '[TOKEN]')
    .replace(/\s+/g, ' ')
    .trim()

  preservedCas.forEach((cas, index) => {
    value = value.replace(`BURILCAS${index}PLACEHOLDER`, cas)
  })

  return Array.from(value).slice(0, 200).join('').trim()
}

export function normalizeSearchQuery(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ')
}

export function classifySearchQuery(value: string): 'name' | 'cas' | 'formula' | 'unknown' {
  if (!value) return 'unknown'
  if (normalizeCasNumber(value)) return 'cas'
  if (FORMULA_PATTERN.test(value)) return 'formula'
  return 'name'
}

export function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return minimum
  return Math.min(Math.max(Math.round(numeric), minimum), maximum)
}

export function optionalShortText(value: unknown, maxLength = 300): string | null {
  if (typeof value !== 'string') return null
  const sanitized = sanitizeSearchQuery(value)
  return sanitized ? Array.from(sanitized).slice(0, maxLength).join('') : null
}

export function sanitizeActionMetadata(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const allowedKeys = ['source', 'selectedField', 'corrected', 'resultType', 'searchMode'] as const
  const sanitized: Record<string, string | number | boolean | null> = {}
  for (const key of allowedKeys) {
    const candidate = source[key]
    if (typeof candidate === 'string') {
      sanitized[key] = Array.from(candidate.normalize('NFKC').trim()).slice(0, 100).join('')
    } else if (typeof candidate === 'boolean') {
      sanitized[key] = candidate
    } else if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      sanitized[key] = candidate
    } else if (candidate === null) {
      sanitized[key] = null
    }
  }
  return sanitized
}

function resolveSupabaseUrl(env: SearchAnalyticsEnv): string | null {
  return env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim() || null
}

function resolveSupabaseAnonKey(env: SearchAnalyticsEnv): string | null {
  return env.SUPABASE_ANON_KEY?.trim() || env.VITE_SUPABASE_ANON_KEY?.trim() || null
}

export function createAnalyticsAdminClient(env: SearchAnalyticsEnv): SearchAnalyticsClient {
  const url = resolveSupabaseUrl(env)
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceRoleKey) throw new Error('Analytics database access is not configured.')
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function resolveAnalyticsIdentity(
  request: Request,
  env: SearchAnalyticsEnv,
): Promise<SearchAnalyticsIdentity | { error: Response }> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader) return { userId: null, email: null }
  if (!authHeader.startsWith('Bearer ')) {
    return { error: analyticsJson({ error: 'Invalid authentication header.' }, { status: 401 }) }
  }

  const url = resolveSupabaseUrl(env)
  const anonKey = resolveSupabaseAnonKey(env)
  if (!url || !anonKey) {
    return { error: analyticsJson({ error: 'Analytics authentication is not configured.' }, { status: 500 }) }
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await userClient.auth.getUser()
  if (error || !data.user) {
    return { error: analyticsJson({ error: 'Invalid authentication token.' }, { status: 401 }) }
  }
  return {
    userId: data.user.id,
    email: data.user.email?.trim().toLowerCase() || null,
  }
}

export async function verifyAnalyticsLabMembership(
  adminClient: SearchAnalyticsClient,
  userId: string,
  labId: string,
): Promise<boolean> {
  const { data, error } = await adminClient
    .from('lab_members')
    .select('id')
    .eq('user_id', userId)
    .eq('lab_id', labId)
    .limit(1)
    .maybeSingle()
  return !error && Boolean(data)
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function requireGuestSubject(
  adminClient: SearchAnalyticsClient,
  guestSubjectId: unknown,
  deleteToken: unknown,
): Promise<{ id: string; deleteTokenHash: string } | { error: Response }> {
  if (!isUuid(guestSubjectId) || typeof deleteToken !== 'string' || deleteToken.length < 32 || deleteToken.length > 256) {
    return { error: analyticsJson({ error: 'A valid guest subject and deletion token are required.' }, { status: 400 }) }
  }

  const deleteTokenHash = await sha256Hex(deleteToken)
  const { data, error } = await adminClient
    .from('search_analytics_guest_subjects')
    .select('id, delete_token_hash')
    .eq('id', guestSubjectId)
    .maybeSingle()
  if (error) {
    return { error: analyticsJson({ error: error.message }, { status: 500 }) }
  }
  if (data && data.delete_token_hash !== deleteTokenHash) {
    return { error: analyticsJson({ error: 'Guest deletion token does not match.' }, { status: 403 }) }
  }
  return { id: guestSubjectId, deleteTokenHash }
}
