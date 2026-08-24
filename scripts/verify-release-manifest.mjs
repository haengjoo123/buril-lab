import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import {
  RELEASE_ENVIRONMENTS,
  RELEASE_SCHEMA_VERSION,
} from './write-release-manifest.mjs'
import { isApprovedStagingHostname } from './verify-staging-access.mjs'

const MAX_MANIFEST_BYTES = 8 * 1024
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const EXPECTED_KEYS = ['built_at', 'commit_sha', 'environment', 'project', 'schema_version']

function parseArgs(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (!name.startsWith('--')) throw new Error(`Unexpected argument: ${name}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`)
    values.set(name.slice(2), value)
    index += 1
  }
  return values
}

async function readBoundedResponse(response) {
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > MAX_MANIFEST_BYTES) throw new Error('Remote release manifest is too large.')
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_MANIFEST_BYTES) throw new Error('Remote release manifest is too large.')
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
  return new TextDecoder().decode(bytes)
}

function accessHeaders(environment, hostname) {
  const clientId = environment.STAGING_ACCESS_CLIENT_ID?.trim()
  const clientSecret = environment.STAGING_ACCESS_CLIENT_SECRET?.trim()
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw new Error('Both Staging Access service-token values must be set together.')
  }

  if (isApprovedStagingHostname(hostname)) {
    if (!clientId || !clientSecret) {
      throw new Error('Staging release verification requires a Cloudflare Access service token.')
    }
    return {
      'CF-Access-Client-Id': clientId,
      'CF-Access-Client-Secret': clientSecret,
    }
  }

  if (clientId || clientSecret) {
    throw new Error('Staging Access credentials may only be sent to staging.burillab.com.')
  }
  return {}
}

async function fetchManifest(url, environmentName, processEnvironment) {
  if (!Object.hasOwn(RELEASE_ENVIRONMENTS, environmentName)) {
    throw new Error('Expected environment must be staging or production.')
  }
  const expected = RELEASE_ENVIRONMENTS[environmentName]

  const parsed = new URL(url)
  const allowedOrigin = environmentName === 'staging'
    ? isApprovedStagingHostname(parsed.hostname)
    : parsed.origin === expected.origin
  if (parsed.protocol !== 'https:' || !allowedOrigin || parsed.pathname !== '/release.json') {
    throw new Error('Remote release manifest URL does not match the selected environment.')
  }

  const response = await fetch(parsed, {
    headers: {
      Accept: 'application/json',
      ...accessHeaders(processEnvironment, parsed.hostname),
    },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Release manifest request failed with HTTP ${response.status}.`)
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error('Release manifest response is not JSON.')
  }
  return readBoundedResponse(response)
}

function parseManifest(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Release manifest contains invalid JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Release manifest must be a JSON object.')
  }
  return parsed
}

export function verifyReleaseManifest(manifest, { commitSha, environment }) {
  if (!FULL_SHA_PATTERN.test(commitSha)) {
    throw new Error('Expected commit must be a lowercase, full 40-character Git SHA.')
  }
  if (!Object.hasOwn(RELEASE_ENVIRONMENTS, environment)) {
    throw new Error('Expected environment must be staging or production.')
  }
  const expected = RELEASE_ENVIRONMENTS[environment]

  const keys = Object.keys(manifest).sort()
  if (JSON.stringify(keys) !== JSON.stringify(EXPECTED_KEYS)) {
    throw new Error('Release manifest fields do not match schema version 1.')
  }
  if (manifest.schema_version !== RELEASE_SCHEMA_VERSION) {
    throw new Error('Release manifest schema is unsupported.')
  }
  if (manifest.commit_sha !== commitSha) throw new Error('Release manifest commit does not match.')
  if (manifest.environment !== environment) throw new Error('Release manifest environment does not match.')
  if (manifest.project !== expected.project) throw new Error('Release manifest project does not match.')
  if (typeof manifest.built_at !== 'string' || Number.isNaN(Date.parse(manifest.built_at))) {
    throw new Error('Release manifest build timestamp is invalid.')
  }
  return manifest
}

export async function loadAndVerifyReleaseManifest({
  file,
  url,
  commitSha,
  environment,
  retries = 0,
  retryDelayMs = 5_000,
  processEnvironment = process.env,
}) {
  if (Boolean(file) === Boolean(url)) throw new Error('Specify exactly one of file or url.')
  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const raw = file
        ? await readFile(resolve(file), 'utf8')
        : await fetchManifest(url, environment, processEnvironment)
      return verifyReleaseManifest(parseManifest(raw), { commitSha, environment })
    } catch (error) {
      lastError = error
      if (attempt < retries) await delay(retryDelayMs)
    }
  }
  throw lastError
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const file = args.get('file')
  const url = args.get('url')
  const commitSha = args.get('commit')
  const environment = args.get('environment')
  const retries = Number(args.get('retries') || 0)
  const retryDelayMs = Number(args.get('retry-delay-ms') || 5_000)
  if (!commitSha || !environment || !Number.isInteger(retries) || retries < 0) {
    throw new Error('A commit, environment, and non-negative retry count are required.')
  }

  const manifest = await loadAndVerifyReleaseManifest({
    file,
    url,
    commitSha,
    environment,
    retries,
    retryDelayMs,
  })
  console.log(`Verified ${manifest.environment} release ${manifest.commit_sha}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Release manifest verification failed.')
    process.exitCode = 1
  })
}
