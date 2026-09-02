import { json } from './json'

export const REQUEST_BODY_TIMEOUT_MS = 10_000

export class RequestBodyError extends Error {
  readonly status: 400 | 408 | 413
  readonly code: 'INVALID_REQUEST_BODY' | 'REQUEST_BODY_TIMEOUT' | 'REQUEST_TOO_LARGE'

  constructor(
    message: string,
    status: RequestBodyError['status'],
    code: RequestBodyError['code'],
  ) {
    super(message)
    this.name = 'RequestBodyError'
    this.status = status
    this.code = code
  }
}

function invalidBody(): RequestBodyError {
  return new RequestBodyError('A valid request body is required.', 400, 'INVALID_REQUEST_BODY')
}

export function requestBodyTooLarge(): RequestBodyError {
  return new RequestBodyError('Request body is too large.', 413, 'REQUEST_TOO_LARGE')
}

export function requestBodyErrorResponse(error: RequestBodyError): Response {
  return json({ error: error.message, code: error.code }, {
    status: error.status, headers: { 'Cache-Control': 'no-store' },
  })
}

export async function readLimitedRequestBytes(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Invalid request body limit.')
  const declaredLength = request.headers.get('Content-Length')
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) throw invalidBody()
    const size = Number(declaredLength)
    if (!Number.isSafeInteger(size) || size > maxBytes) throw requestBodyTooLarge()
  }
  if (!request.body) return new Uint8Array(0)

  // Never trust Content-Length alone: chunked or understated bodies are bounded too.
  const reader = request.body.getReader()
  let bytes = new Uint8Array(Math.min(maxBytes, 16 * 1024))
  let length = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RequestBodyError(
      'Request body took too long to arrive.', 408, 'REQUEST_BODY_TIMEOUT',
    )), REQUEST_BODY_TIMEOUT_MS)
  })
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline])
      if (done) break
      if (value.byteLength > maxBytes - length) throw requestBodyTooLarge()
      if (length + value.byteLength > bytes.byteLength) {
        const grown = new Uint8Array(Math.min(maxBytes, Math.max(length + value.byteLength, bytes.byteLength * 2)))
        grown.set(bytes.subarray(0, length))
        bytes = grown
      }
      bytes.set(value, length)
      length += value.byteLength
    }
    return bytes.byteLength === length ? bytes : bytes.slice(0, length)
  } catch (error) {
    // Cancellation asks the underlying source to clean up and may never settle
    // for a stalled sender. Do not turn the 10-second read deadline into an
    // unbounded cleanup wait; requesting cancellation closes pending reads now.
    void reader.cancel().catch(() => undefined)
    throw error instanceof RequestBodyError ? error : invalidBody()
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
}

export async function readLimitedJson(request: Request, maxBytes: number): Promise<unknown> {
  const bytes = await readLimitedRequestBytes(request, maxBytes)
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw invalidBody()
  }
}

export async function readLimitedFormData(request: Request, maxBytes: number): Promise<FormData> {
  const bytes = await readLimitedRequestBytes(request, maxBytes)
  try {
    return await new Response(bytes, {
      headers: { 'Content-Type': request.headers.get('Content-Type') || '' },
    }).formData()
  } catch {
    throw invalidBody()
  }
}
