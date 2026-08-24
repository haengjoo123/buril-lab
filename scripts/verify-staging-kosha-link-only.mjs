import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

const STAGING_KOSHA_PROBE_URL = 'https://staging.burillab.com/api/kosha/msds'
const KOSHA_REFERENCE_URL = 'https://msds.kosha.or.kr/MSDSInfo/kcic/msdssearchMsds.do'
const MAX_RESPONSE_BYTES = 16 * 1024

function requireAccessValue(environment, name, minimumLength) {
  const value = environment[name]?.trim()
  if (!value || value.length < minimumLength || /[\r\n\0]/.test(value)) {
    throw new Error(`${name} is missing or malformed.`)
  }
  return value
}

async function readBoundedJson(response) {
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > MAX_RESPONSE_BYTES) {
    throw new Error('Staging KOSHA probe response is too large.')
  }
  if (!response.body) throw new Error('Staging KOSHA probe response is empty.')

  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        throw new Error('Staging KOSHA probe response is too large.')
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
    throw new Error('Staging KOSHA probe response is not JSON.')
  }
}

export function verifyStagingKoshaLinkOnlyPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Staging KOSHA response must be a JSON object.')
  }
  if (payload.mode !== 'link_only') {
    throw new Error('Staging KOSHA mode is not link_only.')
  }
  if (payload.officialUrl !== KOSHA_REFERENCE_URL) {
    throw new Error('Staging KOSHA response lacks the approved official reference URL.')
  }
  if (!Array.isArray(payload.sections) || payload.sections.length !== 0) {
    throw new Error('Staging KOSHA link-only response must not contain cached sections.')
  }
  return payload
}

export async function verifyStagingKoshaLinkOnly({
  environment = process.env,
  fetchImplementation = fetch,
  retries = 5,
  retryDelayMs = 5_000,
} = {}) {
  const clientId = requireAccessValue(environment, 'STAGING_ACCESS_CLIENT_ID', 10)
  const clientSecret = requireAccessValue(environment, 'STAGING_ACCESS_CLIENT_SECRET', 20)
  if (!Number.isInteger(retries) || retries < 0) throw new Error('Staging KOSHA retries are invalid.')
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0) {
    throw new Error('Staging KOSHA retry delay is invalid.')
  }

  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImplementation(STAGING_KOSHA_PROBE_URL, {
        headers: {
          Accept: 'application/json',
          'CF-Access-Client-Id': clientId,
          'CF-Access-Client-Secret': clientSecret,
        },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      })
      if (response.status !== 200) {
        await response.body?.cancel()
        throw new Error(`Staging KOSHA probe failed with HTTP ${response.status}.`)
      }
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.toLowerCase().includes('application/json')) {
        await response.body?.cancel()
        throw new Error('Staging KOSHA probe response is not JSON.')
      }
      return verifyStagingKoshaLinkOnlyPayload(await readBoundedJson(response))
    } catch (error) {
      lastError = error
      if (attempt < retries) await delay(retryDelayMs)
    }
  }
  throw lastError
}

async function main() {
  await verifyStagingKoshaLinkOnly()
  console.log('Verified Staging KOSHA link-only runtime contract.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Staging KOSHA runtime verification failed.')
    process.exitCode = 1
  })
}
