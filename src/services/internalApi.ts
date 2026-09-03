import { supabase } from './supabaseClient'
import { getInternalApiUrl } from './apiUrl'

interface ApiErrorPayload {
  error?: string
  code?: unknown
  retryAfterSeconds?: unknown
}

export class InternalApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly retryAfterSeconds?: number

  constructor(message: string, status: number, code?: string, retryAfterSeconds?: number) {
    super(message)
    this.name = 'InternalApiError'
    this.status = status
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function retryDelay(payload: ApiErrorPayload | undefined, response: Response): number | undefined {
  const fromHeader = response.headers.get('Retry-After')
  const value = payload?.retryAfterSeconds
    ?? (fromHeader && /^\d+$/.test(fromHeader) ? Number(fromHeader) : undefined)
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 86_400
    ? value : undefined
}

/**
 * 내부 API 응답을 일관되게 처리합니다.
 * 서버가 돌려준 명시적 에러 메시지가 있으면 그대로 사용합니다.
 * Supabase 세션이 있으면 Authorization 헤더를 포함합니다.
 */
async function authorizedHeaders(includeJsonContentType: boolean): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = includeJsonContentType ? { 'Content-Type': 'application/json' } : {}

  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`
  }
  return headers
}

async function parseJsonResponse<TResponse>(response: Response): Promise<TResponse> {
  const contentType = response.headers.get('content-type') || ''
  let payload: (TResponse & ApiErrorPayload) | undefined
  if (contentType.includes('application/json')) {
    try { payload = await response.json() as TResponse & ApiErrorPayload }
    catch { /* Preserve the HTTP error and retry header even for malformed JSON. */ }
  }

  if (!response.ok) {
    const message = typeof payload?.error === 'string' && payload.error
      ? payload.error : `Request failed with status ${response.status}`
    const code = typeof payload?.code === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(payload.code)
      ? payload.code : undefined
    throw new InternalApiError(message, response.status, code, retryDelay(payload, response))
  }

  if (!payload) throw new Error('Server returned an empty response.')
  return payload
}

export async function postJson<TResponse>(
  url: string,
  body: unknown,
  options?: { signal?: AbortSignal },
): Promise<TResponse> {
  const headers = await authorizedHeaders(true)

  const response = await fetch(getInternalApiUrl(url), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options?.signal,
  })
  return parseJsonResponse<TResponse>(response)
}

export async function getJson<TResponse>(
  url: string,
  options?: { signal?: AbortSignal; cache?: RequestCache },
): Promise<TResponse> {
  const headers = await authorizedHeaders(false)
  const response = await fetch(getInternalApiUrl(url), {
    method: 'GET',
    headers,
    signal: options?.signal,
    cache: options?.cache,
  })
  return parseJsonResponse<TResponse>(response)
}
