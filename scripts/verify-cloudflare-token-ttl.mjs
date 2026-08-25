import { createHash } from 'node:crypto'

const MAX_RESPONSE_BYTES = 1024 * 1024
const CLOUDFLARE_ID_PATTERN = /^[0-9a-f]{32}$/

export const CLOUDFLARE_TOKEN_MIN_REMAINING_MS = 45 * 60 * 1000
export const CLOUDFLARE_TOKEN_MAX_REMAINING_MS = 26 * 60 * 60 * 1000
export const CLOUDFLARE_TOKEN_FUTURE_TOLERANCE_MS = 5 * 60 * 1000

function parseTimestamp(value, label) {
  if (typeof value !== 'string') throw new Error(`Cloudflare token ${label} is missing.`)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`Cloudflare token ${label} is invalid.`)
  return parsed
}

export function verifyCloudflareTokenMetadata(payload, { now = Date.now() } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.success !== true) {
    throw new Error('Cloudflare token verification did not return a successful result.')
  }
  const result = payload.result
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Cloudflare token verification result is missing.')
  }
  if (result.status !== 'active') throw new Error('Cloudflare deployment token is not active.')
  if (typeof result.id !== 'string' || !CLOUDFLARE_ID_PATTERN.test(result.id)) {
    throw new Error('Cloudflare token verification returned an invalid identifier.')
  }

  const nowTimestamp = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(nowTimestamp)) throw new Error('Cloudflare token verification time is invalid.')
  const expiresAt = parseTimestamp(result.expires_on, 'expires_on')
  const remaining = expiresAt - nowTimestamp
  if (remaining < CLOUDFLARE_TOKEN_MIN_REMAINING_MS) {
    throw new Error('Cloudflare deployment token expires too soon for the supervised workflow.')
  }
  if (remaining > CLOUDFLARE_TOKEN_MAX_REMAINING_MS) {
    throw new Error('Cloudflare deployment token TTL exceeds 26 hours.')
  }
  if (result.not_before !== undefined && result.not_before !== null) {
    const notBefore = parseTimestamp(result.not_before, 'not_before')
    if (notBefore > nowTimestamp + CLOUDFLARE_TOKEN_FUTURE_TOLERANCE_MS) {
      throw new Error('Cloudflare deployment token is not active yet.')
    }
    if (notBefore >= expiresAt) {
      throw new Error('Cloudflare deployment token validity window is inconsistent.')
    }
  }
  return Object.freeze({
    expiresAt,
    tokenIdHash: createHash('sha256').update(result.id, 'utf8').digest('hex'),
  })
}

async function readBoundedJson(response) {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error('Cloudflare token verification response is not JSON.')
  }
  const lengthHeader = response.headers.get('content-length')
  if (lengthHeader !== null && !/^\d+$/.test(lengthHeader)) {
    throw new Error('Cloudflare token verification response has an invalid content length.')
  }
  if (Number(lengthHeader || 0) > MAX_RESPONSE_BYTES || !response.body) {
    throw new Error('Cloudflare token verification response is empty or too large.')
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        throw new Error('Cloudflare token verification response is too large.')
      }
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
    throw new Error('Cloudflare token verification response is not valid JSON.')
  }
}

export async function verifyCloudflareTokenTtl(environment = process.env, {
  now = Date.now(),
  fetchImpl = fetch,
} = {}) {
  const token = environment.CLOUDFLARE_EPHEMERAL_TOKEN?.trim()
  const accountId = environment.CLOUDFLARE_ACCOUNT_ID?.trim()
  if (!token || token.length < 20 || /[\r\n\0]/.test(token)) {
    throw new Error('CLOUDFLARE_EPHEMERAL_TOKEN is missing or malformed.')
  }
  if (!accountId || !CLOUDFLARE_ID_PATTERN.test(accountId)) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID is malformed for token verification.')
  }

  const urls = [
    'https://api.cloudflare.com/client/v4/user/tokens/verify',
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`,
  ]
  for (const url of urls) {
    let response
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      continue
    }
    if (!response.ok) continue
    const payload = await readBoundedJson(response)
    return verifyCloudflareTokenMetadata(payload, { now })
  }
  throw new Error('Cloudflare could not verify the ephemeral deployment token.')
}
