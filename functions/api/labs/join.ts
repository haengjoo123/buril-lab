import { createClient } from '@supabase/supabase-js'
import { internalErrorResponse, json } from '../_shared/json'
import { readLimitedJson, readLimitedRequestBytes, RequestBodyError, requestBodyErrorResponse } from '../_shared/requestBody'
import { isUuid } from '../_shared/validation'

export const LAB_JOIN_BODY_BYTES = 8 * 1024
export const LAB_JOIN_UPSTREAM_TIMEOUT_MS = 8_000
export const LAB_JOIN_AUTH_RESPONSE_BYTES = 256 * 1024
export const LAB_JOIN_RPC_RESPONSE_BYTES = 8 * 1024

interface LabJoinEnv {
  APP_ENVIRONMENT?: string
  SUPABASE_URL?: string
  VITE_SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  VITE_SUPABASE_ANON_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  LAB_JOIN_RATE_LIMIT_SECRET?: string
}

interface JoinInput {
  labId: string
  password: string
  nickname: string | null
}

function response(data: unknown, status = 200, headers?: ResponseInit['headers']): Response {
  const merged = new Headers(headers)
  merged.set('Cache-Control', 'no-store')
  return json(data, { status, headers: merged })
}

function invalidInput(): Response {
  return response({ error: 'Valid labId, password and optional nickname are required.', code: 'INVALID_JOIN_INPUT' }, 400)
}

function parseInput(value: unknown): JoinInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as Record<string, unknown>
  if (Object.keys(body).some((key) => !['labId', 'password', 'nickname'].includes(key))
    || !isUuid(body.labId) || typeof body.password !== 'string'
    || Array.from(body.password).length > 128 || body.password.includes('\0')
    || (body.nickname !== undefined && (typeof body.nickname !== 'string'
      || Array.from(body.nickname).length > 100
      || Array.from(body.nickname).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)))) return null
  return { labId: body.labId.toLowerCase(), password: body.password,
    nickname: typeof body.nickname === 'string' ? body.nickname.trim() || null : null }
}

/** Unknown/non-edge callers deliberately share one low-trust failure bucket. */
export function labJoinClientIp(request: Request, environment: string | undefined): string {
  const cf = (request as Request & { cf?: unknown }).cf
  if (!['production', 'staging'].includes(environment ?? '') || !cf || typeof cf !== 'object') return 'unknown'
  const raw = request.headers.get('CF-Connecting-IP')?.trim()
  if (!raw || raw.length > 45) return 'unknown'
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(raw)) {
    const octets = raw.split('.').map(Number)
    return octets.every((value) => value <= 255) ? octets.join('.') : 'unknown'
  }
  if (raw.includes(':') && /^[a-f0-9:.]+$/i.test(raw)) {
    try { return new URL(`http://[${raw}]`).hostname.slice(1, -1) } catch { /* invalid IPv6 */ }
  }
  return 'unknown'
}

async function subjectHash(secret: string, type: 'user' | 'ip', labId: string, value: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = await crypto.subtle.sign('HMAC', key, encoder.encode(`burillab:lab-join:v1:${type}:${labId}:${value}`))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function checkedResult(value: unknown, labId: string): Response | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = value as Record<string, unknown>
  if (result.success === true) {
    if (result.lab_id !== labId || Object.keys(result).sort().join('|') !== 'lab_id|success') return null
    return response({ success: true, labId })
  }
  if (result.success !== false || typeof result.code !== 'string') return null
  if (result.code === 'join_locked') {
    if (Object.keys(result).sort().join('|') !== 'code|retry_after_seconds|success'
      || !Number.isSafeInteger(result.retry_after_seconds)
      || (result.retry_after_seconds as number) < 1 || (result.retry_after_seconds as number) > 3600) return null
    const retryAfterSeconds = result.retry_after_seconds as number
    return response({ error: 'Join temporarily locked.', code: result.code, retryAfterSeconds }, 429,
      { 'Retry-After': String(retryAfterSeconds) })
  }
  if (Object.keys(result).sort().join('|') !== 'code|success') return null
  switch (result.code) {
    case 'incorrect_password': return response({ error: 'Incorrect password.', code: result.code }, 403)
    case 'already_member': return response({ error: 'Already a member.', code: result.code }, 409)
    case 'lab_not_found': return response({ error: 'Lab not found.', code: result.code }, 404)
    default: return null
  }
}

function oneRequestFetch(signal: AbortSignal, maxResponseBytes: number): typeof fetch {
  let requested = false
  return async (input, init) => {
    if (requested || signal.aborted) throw new Error('LAB_JOIN_REQUEST_REFUSED')
    requested = true
    // Workers does not implement Request.redirect="error". Keep redirects
    // observable and reject them here so credentials are never forwarded to a
    // second origin by an automatic follow.
    const upstream = await fetch(input, { ...init, signal, redirect: 'manual' })
    try {
      if (upstream.status >= 300 && upstream.status < 400) {
        throw new Error('LAB_JOIN_REDIRECT_REFUSED')
      }
      const bytes = await readLimitedRequestBytes(upstream, maxResponseBytes)
      if (signal.aborted) throw new Error('LAB_JOIN_REQUEST_REFUSED')
      const headers = new Headers(upstream.headers)
      headers.delete('Content-Encoding')
      headers.delete('Transfer-Encoding')
      headers.set('Content-Length', String(bytes.byteLength))
      return new Response(bytes, { status: upstream.status, statusText: upstream.statusText, headers })
    } catch {
      void upstream.body?.cancel().catch(() => undefined)
      throw new Error('LAB_JOIN_RESPONSE_REFUSED')
    }
  }
}

export const onRequestPost = async (context: {
  request: Request
  env: LabJoinEnv
  data?: Record<string, unknown>
}): Promise<Response> => {
  const authHeader = context.request.headers.get('Authorization')
  if (!authHeader || authHeader.length > 8192 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(authHeader)) {
    return response({ error: 'Authentication is required.', code: 'UNAUTHENTICATED' }, 401)
  }
  if (!/^application\/json(?:\s*;.*)?$/i.test(context.request.headers.get('Content-Type') ?? '')) {
    return response({ error: 'A JSON request is required.', code: 'UNSUPPORTED_MEDIA_TYPE' }, 415)
  }
  let parsed: JoinInput | null
  try { parsed = parseInput(await readLimitedJson(context.request, LAB_JOIN_BODY_BYTES)) }
  catch (error) {
    return error instanceof RequestBodyError ? requestBodyErrorResponse(error) : invalidInput()
  }
  if (!parsed) return invalidInput()
  const input = parsed

  const url = context.env.SUPABASE_URL?.trim() || context.env.VITE_SUPABASE_URL?.trim()
  const anonKey = context.env.SUPABASE_ANON_KEY?.trim() || context.env.VITE_SUPABASE_ANON_KEY?.trim()
  const serviceKey = context.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  const hashSecret = context.env.LAB_JOIN_RATE_LIMIT_SECRET?.trim()
  if (!url || !anonKey || !serviceKey || !hashSecret || hashSecret.length < 32 || hashSecret.length > 256) {
    return response({ error: 'Lab join protection is unavailable.', code: 'JOIN_UNAVAILABLE' }, 503)
  }

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('LAB_JOIN_TIMEOUT')) }, LAB_JOIN_UPSTREAM_TIMEOUT_MS)
  })
  const run = async (): Promise<Response> => {
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader }, fetch: oneRequestFetch(controller.signal, LAB_JOIN_AUTH_RESPONSE_BYTES) },
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
    const { data: userData, error: userError } = await userClient.auth.getUser(authHeader.slice(7))
    if (controller.signal.aborted) throw new Error('LAB_JOIN_TIMEOUT')
    if (userError && (userError.status === undefined || userError.status < 400 || userError.status === 429 || userError.status >= 500)) {
      return internalErrorResponse('labs.join.authentication', userError, 503)
    }
    if (userError || !userData.user || !isUuid(userData.user.id) || userData.user.is_anonymous === true
      || (context.data?.userId !== undefined && context.data.userId !== userData.user.id)) {
      return response({ error: 'Authentication is required.', code: 'UNAUTHENTICATED' }, 401)
    }
    const [userHash, ipHash] = await Promise.all([
      subjectHash(hashSecret, 'user', input.labId, userData.user.id),
      subjectHash(hashSecret, 'ip', input.labId, labJoinClientIp(context.request, context.env.APP_ENVIRONMENT)),
    ])
    if (controller.signal.aborted) throw new Error('LAB_JOIN_TIMEOUT')
    const adminClient = createClient(url, serviceKey, {
      global: { fetch: oneRequestFetch(controller.signal, LAB_JOIN_RPC_RESPONSE_BYTES) },
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
    const { data, error } = await adminClient.rpc('join_lab_server_v1', {
      p_user_id: userData.user.id, p_lab_id: input.labId, p_password: input.password,
      p_user_hash: userHash, p_ip_hash: ipHash, p_nickname: input.nickname,
    })
    if (controller.signal.aborted) throw new Error('LAB_JOIN_TIMEOUT')
    if (error) {
      if (error.code === 'P0001' && error.message?.startsWith('max_lab_memberships_exceeded:')) {
        return response({ error: 'The account has reached its lab membership limit.', code: 'max_lab_memberships_exceeded' }, 409)
      }
      return internalErrorResponse('labs.join', error, 503)
    }
    return checkedResult(data, input.labId) ?? internalErrorResponse('labs.join.result', null, 503)
  }
  try { return await Promise.race([run(), deadline]) }
  catch { return internalErrorResponse('labs.join', null, 503) }
  finally { clearTimeout(timer); controller.abort() }
}
