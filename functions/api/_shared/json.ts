export function json(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  })
}

export function internalErrorResponse(scope: string, error: unknown, status = 500): Response {
  const rawCode = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  const providerCode = typeof rawCode === 'string' && /^[A-Z0-9_]{1,64}$/.test(rawCode) ? rawCode : null
  // Provider messages can contain SQL, object paths, user input, or credentials.
  // Keep only the operation and an allowlisted-format code in application logs.
  console.error(JSON.stringify({ event: 'api_internal_error', scope, providerCode }))
  return json(
    { error: 'The service is temporarily unavailable.', code: 'INTERNAL_ERROR' },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}
