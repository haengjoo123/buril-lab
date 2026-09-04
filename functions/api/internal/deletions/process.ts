import { createClient } from '@supabase/supabase-js'
import { resolveRuntimeConfig, type RuntimeConfigEnv } from '../../_runtimeConfig'
import { internalErrorResponse, json } from '../../_shared/json'
import { createDeletionProcessorGateway, runDeletionProcessor } from './_processor'

const MAX_RESPONSE_BYTES = 256 * 1024
const MAX_UPSTREAM_REQUESTS = 32
const PROCESSOR_TIMEOUT_MS = 45_000

export interface DeletionProcessorEnv extends RuntimeConfigEnv {
  SUPABASE_URL?: string
  VITE_SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  DELETION_MAINTENANCE_SECRET?: string
}

function response(data: unknown, status = 200): Response {
  return json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

async function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
}

async function secretsMatch(actual: string, expected: string): Promise<boolean> {
  const [actualHash, expectedHash] = await Promise.all([sha256(actual), sha256(expected)])
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (left: ArrayBuffer, right: ArrayBuffer) => boolean
  }
  if (typeof subtle.timingSafeEqual === 'function') {
    return subtle.timingSafeEqual(actualHash, expectedHash)
  }
  // Node's Web Crypto used by unit tests does not yet expose the Workers
  // extension. Both SHA-256 values are fixed length, so this fallback does
  // not leak the original secret length or exit early.
  const left = new Uint8Array(actualHash)
  const right = new Uint8Array(expectedHash)
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

async function readBoundedResponse(upstream: Response): Promise<Response> {
  const contentLength = Number(upstream.headers.get('content-length') || 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    await upstream.body?.cancel().catch(() => undefined)
    throw new Error('DELETION_RESPONSE_TOO_LARGE')
  }
  const reader = upstream.body?.getReader()
  if (!reader) return upstream
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw new Error('DELETION_RESPONSE_TOO_LARGE')
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  const headers = new Headers(upstream.headers)
  headers.delete('Content-Encoding')
  headers.delete('Transfer-Encoding')
  headers.set('Content-Length', String(body.byteLength))
  return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers })
}

function boundedFetch(signal: AbortSignal): typeof fetch {
  let requestCount = 0
  return async (input, init) => {
    requestCount += 1
    if (signal.aborted || requestCount > MAX_UPSTREAM_REQUESTS) throw new Error('DELETION_UPSTREAM_REFUSED')
    const upstream = await fetch(input, { ...init, redirect: 'manual', signal })
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel().catch(() => undefined)
      throw new Error('DELETION_REDIRECT_REFUSED')
    }
    return readBoundedResponse(upstream)
  }
}

export async function handleDeletionProcessorRequest(
  context: { request: Request; env: DeletionProcessorEnv },
  run = runDeletionProcessor,
): Promise<Response> {
  const expectedSecret = context.env.DELETION_MAINTENANCE_SECRET?.trim() ?? ''
  const authorization = context.request.headers.get('Authorization') ?? ''
  const suppliedSecret = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (expectedSecret.length < 32) {
    return response({ error: 'Deletion maintenance is unavailable.', code: 'DELETION_MAINTENANCE_UNAVAILABLE' }, 503)
  }
  if (!suppliedSecret || !await secretsMatch(suppliedSecret, expectedSecret)) {
    return response({ error: 'Authentication is required.', code: 'UNAUTHENTICATED' }, 401)
  }

  const runtime = await resolveRuntimeConfig(context.env)
  if (!runtime.maintenanceEnabled) {
    return response({ error: 'Deletion maintenance is unavailable.', code: 'DELETION_MAINTENANCE_DISABLED' }, 503)
  }
  const supabaseUrl = context.env.SUPABASE_URL?.trim() || context.env.VITE_SUPABASE_URL?.trim()
  const serviceKey = context.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!supabaseUrl || !serviceKey) {
    return response({ error: 'Deletion maintenance is unavailable.', code: 'DELETION_MAINTENANCE_UNAVAILABLE' }, 503)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROCESSOR_TIMEOUT_MS)
  try {
    const admin = createClient(supabaseUrl, serviceKey, {
      global: { fetch: boundedFetch(controller.signal) },
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
    const summary = await run(createDeletionProcessorGateway(admin))
    return response(summary, summary.failed > 0 ? 207 : 200)
  } catch {
    return internalErrorResponse('deletions.worker.process', null, 503)
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

export const onRequestPost = async (context: {
  request: Request
  env: DeletionProcessorEnv
}): Promise<Response> => handleDeletionProcessorRequest(context)
