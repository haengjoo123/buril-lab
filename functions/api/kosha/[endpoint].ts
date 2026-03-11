interface Env {
  KOSHA_API_KEY?: string
}

const ALLOWED_ENDPOINT_PATTERN = /^(chemlist|chemdetail\d{2})$/
const KOSHA_BASE_URL = 'https://msds.kosha.or.kr/openapi/service/msdschem'

function textResponse(body: string, init?: ResponseInit) {
  return new Response(body, {
    ...init,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      ...(init?.headers || {}),
    },
  })
}

export const onRequestGet = async (context: {
  request: Request
  env: Env
  params: { endpoint?: string }
}) => {
  const endpoint = context.params.endpoint

  if (typeof endpoint !== 'string' || !ALLOWED_ENDPOINT_PATTERN.test(endpoint)) {
    return textResponse('<error>Invalid KOSHA endpoint.</error>', { status: 400 })
  }

  if (!context.env.KOSHA_API_KEY) {
    return textResponse('<error>KOSHA API key is not configured.</error>', { status: 500 })
  }

  const requestUrl = new URL(context.request.url)
  const upstreamParams = new URLSearchParams(requestUrl.search)

  // 서비스 키는 서버에서만 주입하고, 클라이언트 입력은 무시합니다.
  upstreamParams.delete('serviceKey')
  upstreamParams.set('serviceKey', context.env.KOSHA_API_KEY)

  const upstreamUrl = `${KOSHA_BASE_URL}/${endpoint}?${upstreamParams.toString()}`

  const upstreamResponse = await fetch(upstreamUrl, {
    method: 'GET',
    headers: {
      'Accept': 'application/xml,text/xml;q=0.9,*/*;q=0.8',
    },
  })

  const body = await upstreamResponse.text()

  return textResponse(body, {
    status: upstreamResponse.status,
  })
}
