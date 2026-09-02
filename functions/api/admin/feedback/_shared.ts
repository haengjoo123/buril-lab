import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { internalErrorResponse, json } from '../../_shared/json'

export { internalErrorResponse, json }

export interface FeedbackAdminEnv {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  FEEDBACK_ADMIN_EMAILS?: string
  OPS_ADMIN_EMAILS?: string
}

export interface FeedbackAdminIdentity {
  id: string
  email: string
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
  'id',
  'type',
  'message',
  'contact',
  'user_email',
  'user_id',
  'user_agent',
  'created_at',
  'status',
  'resolved_at',
  'resolved_by',
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

  if (!url || !anonKey) {
    throw new Error('Supabase URL or anon key is not configured.')
  }

  return createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

function createSupabaseAdminClient(env: FeedbackAdminEnv) {
  const url = resolveSupabaseUrl(env)
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase URL or service role key is not configured.')
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

function parseAdminEmails(...rawValues: Array<string | undefined>): Set<string> {
  return new Set(
    rawValues
      .filter(Boolean)
      .join(',')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )
}

export async function requireFeedbackAdmin(
  request: Request,
  env: FeedbackAdminEnv,
): Promise<{ ok: true; context: FeedbackAdminContext } | { ok: false; response: Response }> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return {
      ok: false,
      response: json({ error: 'Authentication is required.' }, { status: 401 }),
    }
  }

  let userClient: SupabaseClient
  try {
    userClient = createSupabaseUserClient(env, authHeader)
  } catch (error) {
    return {
      ok: false,
      response: internalErrorResponse('admin.auth.initialize', error),
    }
  }

  const { data, error } = await userClient.auth.getUser()
  if (error || !data.user) {
    return {
      ok: false,
      response: json({ error: 'Authentication is required.' }, { status: 401 }),
    }
  }

  const allowlist = parseAdminEmails(env.OPS_ADMIN_EMAILS, env.FEEDBACK_ADMIN_EMAILS)
  if (allowlist.size === 0) {
    return {
      ok: false,
      response: internalErrorResponse('admin.auth.allowlist', null),
    }
  }

  const email = data.user.email?.trim().toLowerCase()
  if (!email || !allowlist.has(email)) {
    return {
      ok: false,
      response: json({ error: 'This page is only available to allowlisted operators.' }, { status: 403 }),
    }
  }

  let adminClient: SupabaseClient
  try {
    adminClient = createSupabaseAdminClient(env)
  } catch (error) {
    return {
      ok: false,
      response: internalErrorResponse('admin.client.initialize', error),
    }
  }

  return {
    ok: true,
    context: {
      adminClient,
      identity: {
        id: data.user.id,
        email,
      },
    },
  }
}
