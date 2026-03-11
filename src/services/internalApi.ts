interface ApiErrorPayload {
  error?: string
}

/**
 * 내부 API 응답을 일관되게 처리합니다.
 * 서버가 돌려준 명시적 에러 메시지가 있으면 그대로 사용합니다.
 */
export async function postJson<TResponse>(url: string, body: unknown): Promise<TResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json')
    ? (await response.json()) as TResponse & ApiErrorPayload
    : undefined

  if (!response.ok) {
    const message = payload?.error || `Request failed with status ${response.status}`
    throw new Error(message)
  }

  if (!payload) {
    throw new Error('Server returned an empty response.')
  }

  return payload
}
