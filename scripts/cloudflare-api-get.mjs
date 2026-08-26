import { pathToFileURL } from 'node:url'

const MAX_RESPONSE_BYTES = 1024 * 1024
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/
const APPROVED_ACCOUNT_SURFACES = new Set([
  'pages/projects/buril-lab-staging/deployments?env=production',
  'pages/projects/buril-lab/deployments?env=production',
  'workers/scripts/buril-lab-storage-backup-staging/secrets',
  'workers/services/buril-lab-storage-backup-staging/environments/production/bindings',
  'workers/services/buril-lab-storage-backup-staging/environments/production/routes?show_zonename=true',
  'workers/domains?service=buril-lab-storage-backup-staging&environment=production',
  'workers/services/buril-lab-storage-backup-staging/environments/production/subdomain',
  'workers/services/buril-lab-storage-backup-staging/environments/production',
  'workers/scripts/buril-lab-storage-backup-staging/schedules',
])

export function parseArguments(argv) {
  if (argv.length !== 4) {
    throw new Error('Cloudflare API helper requires exactly --include-status and --url.')
  }
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || value === undefined || values.has(name)) {
      throw new Error('Cloudflare API helper arguments are invalid.')
    }
    values.set(name, value)
  }
  if (
    values.size !== 2
    || !values.has('--include-status')
    || !values.has('--url')
  ) {
    throw new Error('Cloudflare API helper accepts only --include-status and --url.')
  }
  return values
}

function approvedUrl(rawUrl, accountId) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('Cloudflare API URL is invalid.')
  }
  const prefix = `/client/v4/accounts/${accountId}/`
  if (
    url.protocol !== 'https:'
    || url.hostname !== 'api.cloudflare.com'
    || url.port !== ''
    || url.username
    || url.password
    || !url.pathname.startsWith(prefix)
  ) {
    throw new Error('Cloudflare API URL is outside the approved account surface.')
  }
  const accountSurface = `${url.pathname.slice(prefix.length)}${url.search}`
  if (!APPROVED_ACCOUNT_SURFACES.has(accountSurface) || url.hash) {
    throw new Error('Cloudflare API URL is not an approved read-only release endpoint.')
  }
  return url
}

async function readBoundedBody(response) {
  const contentType = response.headers.get('content-type') || ''
  if (!/^application\/json(?:\s*;|$)/i.test(contentType) || !response.body) {
    throw new Error('Cloudflare API response is not JSON.')
  }
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)) {
    await response.body.cancel().catch(() => undefined)
    throw new Error('Cloudflare API response is oversized.')
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
        throw new Error('Cloudflare API response is oversized.')
      }
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    if (error instanceof Error && error.message === 'Cloudflare API response is oversized.') {
      throw error
    }
    throw new Error('Cloudflare API response could not be read.')
  } finally {
    reader.releaseLock()
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
  try {
    JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('Cloudflare API response is invalid JSON.')
  }
  return bytes
}

export async function cloudflareApiGet(environment, rawUrl, {
  includeStatus = false,
  fetchImpl = fetch,
} = {}) {
  const token = environment.CLOUDFLARE_API_TOKEN?.trim()
  const accountId = environment.CLOUDFLARE_ACCOUNT_ID?.trim()
  if (!token || token.length < 20 || /[\r\n\0]/.test(token)) {
    throw new Error('Cloudflare API token is missing or malformed.')
  }
  if (!ACCOUNT_ID_PATTERN.test(accountId || '')) {
    throw new Error('Cloudflare account identifier is malformed.')
  }
  const url = approvedUrl(rawUrl, accountId)
  let response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new Error('Cloudflare API request could not be completed.')
  }
  if (response.redirected !== false || response.url !== url.href) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('Cloudflare API response URL changed unexpectedly.')
  }
  const body = await readBoundedBody(response)
  if (!includeStatus && !response.ok) {
    throw new Error(`Cloudflare API request failed with HTTP ${response.status}.`)
  }
  return Object.freeze({ body, status: response.status })
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  const includeStatus = args.get('--include-status') === 'true'
  if (!['true', 'false'].includes(args.get('--include-status') || '')) {
    throw new Error('--include-status must be exactly true or false.')
  }
  const result = await cloudflareApiGet(process.env, args.get('--url'), { includeStatus })
  process.stdout.write(result.body)
  if (includeStatus) process.stdout.write(`\n${result.status}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Cloudflare API request failed.')
    process.exitCode = 1
  })
}
