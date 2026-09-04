import { createClient } from '@supabase/supabase-js'
import { resolveRuntimeConfig, type RuntimeConfigEnv } from '../_runtimeConfig'
import { internalErrorResponse, json } from '../_shared/json'
import { readLimitedJson, readLimitedRequestBytes, RequestBodyError } from '../_shared/requestBody'
import { isUuid } from '../_shared/validation'

export const DELETION_INTAKE_BODY_BYTES = 2 * 1024
export const DELETION_INTAKE_TIMEOUT_MS = 8_000
const AUTH_RESPONSE_BYTES = 256 * 1024
const RPC_RESPONSE_BYTES = 16 * 1024

export interface DeletionIntakeEnv extends RuntimeConfigEnv {
  SUPABASE_URL?: string
  VITE_SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  VITE_SUPABASE_ANON_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
}

interface DeletionInput {
  requestId: string
  labId?: string
}

type DeletionKind = 'account' | 'lab'

function response(data: unknown, status = 200, headers?: HeadersInit): Response {
  const merged = new Headers(headers)
  merged.set('Cache-Control', 'no-store')
  return json(data, { status, headers: merged })
}

function parseInput(value: unknown, kind: DeletionKind): DeletionInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as Record<string, unknown>
  const allowed = kind === 'account' ? ['requestId'] : ['requestId', 'labId']
  if (Object.keys(body).some((key) => !allowed.includes(key)) || !isUuid(body.requestId)) return null
  if (kind === 'lab' && !isUuid(body.labId)) return null
  return {
    requestId: (body.requestId as string).toLowerCase(),
    ...(kind === 'lab' ? { labId: (body.labId as string).toLowerCase() } : {}),
  }
}

function boundedFetch(signal: AbortSignal, maxResponseBytes: number): typeof fetch {
  let requested = false
  return async (input, init) => {
    if (requested || signal.aborted) throw new Error('DELETION_UPSTREAM_REFUSED')
    requested = true
    const upstream = await fetch(input, { ...init, signal, redirect: 'manual' })
    try {
      if (upstream.status >= 300 && upstream.status < 400) throw new Error('DELETION_REDIRECT_REFUSED')
      const bytes = await readLimitedRequestBytes(upstream, maxResponseBytes)
      if (signal.aborted) throw new Error('DELETION_UPSTREAM_REFUSED')
      const headers = new Headers(upstream.headers)
      headers.delete('Content-Encoding')
      headers.delete('Transfer-Encoding')
      headers.set('Content-Length', String(bytes.byteLength))
      return new Response(bytes, { status: upstream.status, statusText: upstream.statusText, headers })
    } catch {
      void upstream.body?.cancel().catch(() => undefined)
      throw new Error('DELETION_RESPONSE_REFUSED')
    }
  }
}

function checkedResult(value: unknown, kind: DeletionKind): Response | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = value as Record<string, unknown>
  if (result.success === true) {
    if (!isUuid(result.job_id) || !['pending', 'running', 'retry_wait'].includes(String(result.status))
      || Object.keys(result).sort().join('|') !== 'job_id|status|success') return null
    return response({ success: true, jobId: String(result.job_id).toLowerCase(), status: result.status }, 202)
  }
  if (result.success !== false || typeof result.code !== 'string'
    || Object.keys(result).sort().join('|') !== 'code|success') return null
  switch (result.code) {
    case 'account_not_found': return kind === 'account' ? response({ error: 'Account not found.', code: result.code }, 404) : null
    case 'account_transfer_required': return kind === 'account'
      ? response({ error: 'Transfer or delete administered labs first.', code: result.code }, 409) : null
    case 'lab_not_found': return kind === 'lab' ? response({ error: 'Lab not found.', code: result.code }, 404) : null
    case 'lab_admin_required': return kind === 'lab'
      ? response({ error: 'Lab administrator access is required.', code: result.code }, 403) : null
    default: return null
  }
}

export async function enqueueDeletionRequest(context: {
  request: Request
  env: DeletionIntakeEnv
  data?: Record<string, unknown>
}, kind: DeletionKind): Promise<Response> {
  const authHeader = context.request.headers.get('Authorization')
  if (!authHeader || authHeader.length > 8192
    || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(authHeader)) {
    return response({ error: 'Authentication is required.', code: 'UNAUTHENTICATED' }, 401)
  }
  if (!/^application\/json(?:\s*;.*)?$/i.test(context.request.headers.get('Content-Type') ?? '')) {
    return response({ error: 'A JSON request is required.', code: 'UNSUPPORTED_MEDIA_TYPE' }, 415)
  }

  let input: DeletionInput | null
  try { input = parseInput(await readLimitedJson(context.request, DELETION_INTAKE_BODY_BYTES), kind) }
  catch (error) {
    return error instanceof RequestBodyError
      ? response({ error: 'The request body is invalid.', code: error.code }, error.status)
      : response({ error: 'The deletion request is invalid.', code: 'INVALID_DELETION_REQUEST' }, 400)
  }
  if (!input) return response({ error: 'The deletion request is invalid.', code: 'INVALID_DELETION_REQUEST' }, 400)

  const runtimeConfig = await resolveRuntimeConfig(context.env)
  if (!runtimeConfig.accountDeletionEnabled) {
    return response({ error: 'Deletion intake is temporarily unavailable.', code: 'DELETION_DISABLED' }, 503)
  }

  const url = context.env.SUPABASE_URL?.trim() || context.env.VITE_SUPABASE_URL?.trim()
  const anonKey = context.env.SUPABASE_ANON_KEY?.trim() || context.env.VITE_SUPABASE_ANON_KEY?.trim()
  const serviceKey = context.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !anonKey || !serviceKey) {
    return response({ error: 'Deletion intake is temporarily unavailable.', code: 'DELETION_UNAVAILABLE' }, 503)
  }

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('DELETION_TIMEOUT')) }, DELETION_INTAKE_TIMEOUT_MS)
  })
  const run = async (): Promise<Response> => {
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader }, fetch: boundedFetch(controller.signal, AUTH_RESPONSE_BYTES) },
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
    const { data: userData, error: userError } = await userClient.auth.getUser(authHeader.slice(7))
    if (controller.signal.aborted) throw new Error('DELETION_TIMEOUT')
    if (userError && (userError.status === undefined || userError.status < 400 || userError.status === 429 || userError.status >= 500)) {
      return internalErrorResponse(`deletions.${kind}.authentication`, userError, 503)
    }
    if (userError || !userData.user || !isUuid(userData.user.id) || userData.user.is_anonymous === true
      || (context.data?.userId !== undefined && context.data.userId !== userData.user.id)) {
      return response({ error: 'Authentication is required.', code: 'UNAUTHENTICATED' }, 401)
    }

    const adminClient = createClient(url, serviceKey, {
      global: { fetch: boundedFetch(controller.signal, RPC_RESPONSE_BYTES) },
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
    const rpc = kind === 'account' ? 'enqueue_account_deletion_v1' : 'enqueue_lab_deletion_v1'
    const params = kind === 'account'
      ? { p_user_id: userData.user.id, p_request_id: input.requestId }
      : { p_user_id: userData.user.id, p_lab_id: input.labId, p_request_id: input.requestId }
    const { data, error } = await adminClient.rpc(rpc, params)
    if (controller.signal.aborted) throw new Error('DELETION_TIMEOUT')
    if (error) return internalErrorResponse(`deletions.${kind}.enqueue`, error, 503)
    return checkedResult(data, kind) ?? internalErrorResponse(`deletions.${kind}.result`, null, 503)
  }

  try { return await Promise.race([run(), deadline]) }
  catch { return internalErrorResponse(`deletions.${kind}.intake`, null, 503) }
  finally { clearTimeout(timer); controller.abort() }
}
