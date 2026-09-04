import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { internalErrorResponse, json } from '../_shared/json'
import { readLimitedRequestBytes } from '../_shared/requestBody'
import { isUuid } from '../_shared/validation'

export const CABINET_PHOTO_MAX_BYTES = 2 * 1024 * 1024
export const CABINET_PHOTO_SIGNED_URL_SECONDS = 60 * 60
export const CABINET_PHOTO_UPSTREAM_TIMEOUT_MS = 20_000
const UPSTREAM_RESPONSE_BYTES = 512 * 1024

export interface CabinetPhotoEnv {
  SUPABASE_URL?: string
  VITE_SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  VITE_SUPABASE_ANON_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
}

export interface CabinetPhotoContext {
  request: Request
  env: CabinetPhotoEnv
  data?: Record<string, unknown>
  params?: Record<string, string | string[]>
}

export type CabinetPhotoAdmin = SupabaseClient

export function photoResponse(data: unknown, status = 200, headers?: HeadersInit): Response {
  const merged = new Headers(headers)
  merged.set('Cache-Control', 'no-store')
  return json(data, { status, headers: merged })
}

export function boundedCabinetPhotoFetch(
  rawOrigin: string,
  signal: AbortSignal,
  allowedPrefixes: readonly string[],
  maxRequests: number,
): typeof fetch {
  const origin = new URL(rawOrigin).origin
  let requests = 0
  return async (input, init) => {
    if (signal.aborted || ++requests > maxRequests) throw new Error('CABINET_PHOTO_REQUEST_REFUSED')
    const target = new URL(input instanceof Request ? input.url : input.toString())
    if (target.origin !== origin || target.username || target.password || target.hash
      || !allowedPrefixes.some((prefix) => target.pathname.startsWith(prefix))) {
      throw new Error('CABINET_PHOTO_TARGET_REFUSED')
    }
    const upstream = await fetch(input, { ...init, signal, redirect: 'manual' })
    try {
      if (upstream.status >= 300 && upstream.status < 400) throw new Error('CABINET_PHOTO_REDIRECT_REFUSED')
      const bytes = await readLimitedRequestBytes(upstream, UPSTREAM_RESPONSE_BYTES)
      if (signal.aborted) throw new Error('CABINET_PHOTO_REQUEST_REFUSED')
      const headers = new Headers(upstream.headers)
      headers.delete('Content-Encoding')
      headers.delete('Transfer-Encoding')
      headers.set('Content-Length', String(bytes.byteLength))
      return new Response(bytes, { status: upstream.status, statusText: upstream.statusText, headers })
    } catch {
      void upstream.body?.cancel().catch(() => undefined)
      throw new Error('CABINET_PHOTO_RESPONSE_REFUSED')
    }
  }
}

export async function runCabinetPhotoRequest(
  context: CabinetPhotoContext,
  handler: (session: { userId: string; admin: CabinetPhotoAdmin; signal: AbortSignal; origin: string }) => Promise<Response>,
): Promise<Response> {
  const authHeader = context.request.headers.get('Authorization')
  if (!authHeader || authHeader.length > 8192
    || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(authHeader)) {
    return photoResponse({ error: 'Authentication is required.', code: 'UNAUTHENTICATED' }, 401)
  }
  const origin = context.env.SUPABASE_URL?.trim() || context.env.VITE_SUPABASE_URL?.trim()
  const anonKey = context.env.SUPABASE_ANON_KEY?.trim() || context.env.VITE_SUPABASE_ANON_KEY?.trim()
  const serviceKey = context.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!origin || !anonKey || !serviceKey) {
    return photoResponse({ error: 'Cabinet photo service is unavailable.', code: 'PHOTO_SERVICE_UNAVAILABLE' }, 503)
  }
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'https:' || parsed.origin !== origin || parsed.username || parsed.password
      || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('INVALID_ORIGIN')
  } catch {
    return photoResponse({ error: 'Cabinet photo service is unavailable.', code: 'PHOTO_SERVICE_UNAVAILABLE' }, 503)
  }

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('CABINET_PHOTO_TIMEOUT')) },
      CABINET_PHOTO_UPSTREAM_TIMEOUT_MS)
  })
  const run = async (): Promise<Response> => {
    const userClient = createClient(origin, anonKey, {
      global: { headers: { Authorization: authHeader },
        fetch: boundedCabinetPhotoFetch(origin, controller.signal, ['/auth/v1/'], 1) },
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
    const { data, error } = await userClient.auth.getUser(authHeader.slice(7))
    if (controller.signal.aborted) throw new Error('CABINET_PHOTO_TIMEOUT')
    if (error && (error.status === undefined || error.status < 400 || error.status === 429 || error.status >= 500)) {
      return internalErrorResponse('cabinets.photo.authentication', error, 503)
    }
    if (error || !data.user || !isUuid(data.user.id) || data.user.is_anonymous === true
      || (context.data?.userId !== undefined && context.data.userId !== data.user.id)) {
      return photoResponse({ error: 'Authentication is required.', code: 'UNAUTHENTICATED' }, 401)
    }
    const admin = createClient(origin, serviceKey, {
      global: { fetch: boundedCabinetPhotoFetch(origin, controller.signal,
        ['/rest/v1/', '/storage/v1/'], 10) },
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
    return handler({ userId: data.user.id.toLowerCase(), admin, signal: controller.signal, origin })
  }
  try { return await Promise.race([run(), deadline]) }
  catch { return internalErrorResponse('cabinets.photo', null, 503) }
  finally { clearTimeout(timer); controller.abort() }
}

export function isWebp(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12
    && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
}

export function validPhotoPath(path: unknown, cabinetId: string): path is string {
  if (typeof path !== 'string' || path.length > 1024 || !isUuid(cabinetId)) return false
  const escaped = cabinetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^(?:labs|users)/([0-9a-f-]{36})/cabinets/(${escaped})/([0-9a-f-]{36})\\.webp$`, 'i').exec(path)
  return Boolean(match && isUuid(match[1]) && isUuid(match[2]) && isUuid(match[3]))
}

export function validPhotoPrefix(prefix: unknown, cabinetId: string): prefix is string {
  if (typeof prefix !== 'string' || prefix.length > 512 || !isUuid(cabinetId)) return false
  const escaped = cabinetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^(?:labs|users)/([0-9a-f-]{36})/cabinets/(${escaped})$`, 'i').exec(prefix)
  return Boolean(match && isUuid(match[1]) && isUuid(match[2]))
}

export function checkedSignedUrl(value: unknown, origin: string, expectedPath: string): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > 8192
    || typeof expectedPath !== 'string' || expectedPath.length > 1024) return null
  try {
    const url = new URL(value)
    return url.origin === origin && !url.username && !url.password && !url.hash
      && url.pathname === `/storage/v1/object/sign/cabinets/${expectedPath}`
      && Boolean(url.searchParams.get('token')) ? url.toString() : null
  } catch { return null }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
