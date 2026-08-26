const MAX_RESPONSE_BYTES = 1024 * 1024
const PROJECT_REF_PATTERN = /^[a-z]{20}$/
const CLOUDFLARE_ID_PATTERN = /^[0-9a-f]{32}$/
const SUPABASE_PAT_PROPAGATION_ATTEMPTS = 7
const SUPABASE_PAT_PROPAGATION_DELAY_MS = 10_000

function hasExactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return JSON.stringify(actual) === JSON.stringify(expected)
}

async function readBoundedJson(response, label) {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('application/json') || !response.body) {
    throw new Error(`${label} did not return JSON.`)
  }
  const length = response.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) {
    throw new Error(`${label} response is oversized.`)
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw new Error(`${label} response is oversized.`)
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error(`${label} response is invalid JSON.`)
  }
}

function validToken(token, label) {
  if (typeof token !== 'string' || token.length < 20 || /[\r\n\0]/.test(token)) {
    throw new Error(`${label} is missing or malformed.`)
  }
  return token
}

export async function verifyActiveSupabasePat(token, projectRef, { fetchImpl = fetch } = {}) {
  validToken(token, 'Supabase PAT')
  if (!PROJECT_REF_PATTERN.test(projectRef || '')) throw new Error('Supabase project reference is malformed.')
  const response = await fetchImpl('https://api.supabase.com/v1/projects', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error('Supabase PAT is not active for the supervised release.')
  const payload = await readBoundedJson(response, 'Supabase project lookup')
  if (!Array.isArray(payload) || !payload.some((project) => project?.id === projectRef)) {
    throw new Error('Supabase PAT cannot read the selected release project.')
  }
  return Object.freeze({ active: true, projectRef })
}

function retryableSupabasePatPropagationError(error) {
  return error instanceof Error && [
    'Supabase PAT is not active for the supervised release.',
    'Supabase PAT cannot read the selected release project.',
  ].includes(error.message)
}

export async function verifyEventuallyActiveSupabasePat(token, projectRef, {
  fetchImpl = fetch,
  attempts = SUPABASE_PAT_PROPAGATION_ATTEMPTS,
  retryDelayMs = SUPABASE_PAT_PROPAGATION_DELAY_MS,
  wait = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
} = {}) {
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > SUPABASE_PAT_PROPAGATION_ATTEMPTS) {
    throw new Error('Supabase PAT propagation attempt count is invalid.')
  }
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > SUPABASE_PAT_PROPAGATION_DELAY_MS) {
    throw new Error('Supabase PAT propagation retry delay is invalid.')
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await verifyActiveSupabasePat(token, projectRef, { fetchImpl })
    } catch (error) {
      if (!retryableSupabasePatPropagationError(error) || attempt === attempts) throw error
      await wait(retryDelayMs)
    }
  }
  throw new Error('Supabase PAT propagation verification did not complete.')
}

export async function verifyInactiveSupabasePat(token, { fetchImpl = fetch } = {}) {
  validToken(token, 'Supabase PAT')
  const response = await fetchImpl('https://api.supabase.com/v1/projects', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  if (response.body) await response.body.cancel()
  if (response.status !== 401) {
    throw new Error('Supabase PAT revocation is not proven by an exact HTTP 401 response.')
  }
  return Object.freeze({ inactive: true })
}

export async function verifyInactiveCloudflareToken(token, accountId, { fetchImpl = fetch } = {}) {
  validToken(token, 'Cloudflare token')
  if (!CLOUDFLARE_ID_PATTERN.test(accountId || '')) throw new Error('Cloudflare account identifier is malformed.')
  const endpoints = [
    'https://api.cloudflare.com/client/v4/user/tokens/verify',
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`,
  ]
  const statuses = []
  for (const endpoint of endpoints) {
    const response = await fetchImpl(endpoint, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    if (response.ok) {
      const payload = await readBoundedJson(response, 'Cloudflare token verification')
      if (
        !hasExactKeys(payload, ['success', 'errors', 'messages', 'result'])
        || payload.success !== true
        || !Array.isArray(payload.errors)
        || payload.errors.length !== 0
        || !Array.isArray(payload.messages)
        || payload.messages.length !== 0
        || !payload.result
        || typeof payload.result !== 'object'
        || Array.isArray(payload.result)
        || !Object.keys(payload.result).every((key) => ['id', 'status', 'expires_on', 'not_before'].includes(key))
        || !CLOUDFLARE_ID_PATTERN.test(payload.result.id || '')
      ) {
        throw new Error('Cloudflare token verification returned an unrecognized successful response.')
      }
      if (payload.result.status === 'active') {
        throw new Error('Cloudflare token is still active.')
      }
      if (['disabled', 'expired'].includes(payload?.result?.status)) {
        statuses.push(payload.result.status)
        continue
      }
      throw new Error('Cloudflare token verification returned an unrecognized successful response.')
    }
    if (response.status !== 401) {
      if (response.body) await response.body.cancel()
      throw new Error('Cloudflare token inactivity cannot be proven from a transient or unexpected response.')
    }
    const payload = await readBoundedJson(response, 'Cloudflare token verification rejection')
    if (
      !hasExactKeys(payload, ['success', 'errors', 'messages', 'result'])
      || payload.success !== false
      || payload.result !== null
      || !Array.isArray(payload.messages)
      || payload.messages.length !== 0
      || !Array.isArray(payload.errors)
      || payload.errors.length !== 1
      || !hasExactKeys(payload.errors[0], ['code', 'message'])
      || payload.errors[0].code !== 1000
      || payload.errors[0].message !== 'Invalid API Token'
    ) {
      throw new Error('Cloudflare token rejection did not prove that the API token is invalid.')
    }
    statuses.push('invalid')
  }
  if (statuses.length !== endpoints.length) throw new Error('Cloudflare token inactivity verification was incomplete.')
  return Object.freeze({ inactive: true })
}
