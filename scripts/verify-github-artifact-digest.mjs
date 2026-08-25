import { createHash, randomUUID } from 'node:crypto'
import { lstat, open, readdir, realpath, unlink } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const CANONICAL_REPOSITORY = 'haengjoo123/buril-lab'
const DIGEST_PATTERN = /^[0-9a-f]{64}$/
const ARTIFACT_ID_PATTERN = /^[1-9][0-9]*$/
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
const ALLOWED_CONTENT_TYPES = new Set(['application/zip', 'application/octet-stream'])
const SIGNED_ARCHIVE_HOST_SUFFIXES = Object.freeze([
  '.blob.core.windows.net',
  '.actions.githubusercontent.com',
])

function validateSignedArchiveUrl(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('GitHub artifact archive redirect is invalid.')
  }
  const hostname = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.port
    || url.hash
    || !url.search
    || !SIGNED_ARCHIVE_HOST_SUFFIXES.some((suffix) => (
      hostname.endsWith(suffix) && hostname.length > suffix.length
    ))
  ) {
    throw new Error('GitHub artifact archive redirect is not an approved signed origin.')
  }
  return url
}

function validateInputs(environment) {
  const token = environment.GITHUB_TOKEN
  const repository = environment.GITHUB_REPOSITORY?.trim()
  const artifactId = environment.EXPECTED_ARTIFACT_ID?.trim()
  const expectedDigest = environment.EXPECTED_ARTIFACT_SERVICE_DIGEST?.trim()
  const runnerTemp = environment.RUNNER_TEMP?.trim()
  if (
    typeof token !== 'string'
    || token.length < 1
    || /[\u0000-\u001f\u007f]/.test(token)
    || repository !== CANONICAL_REPOSITORY
    || !ARTIFACT_ID_PATTERN.test(artifactId || '')
    || !DIGEST_PATTERN.test(expectedDigest || '')
    || !runnerTemp
    || !isAbsolute(runnerTemp)
  ) {
    throw new Error('GitHub artifact digest verification inputs are invalid.')
  }
  return { token, repository, artifactId, expectedDigest, runnerTemp }
}

function validateArchiveResponse(response) {
  if (!response.ok) throw new Error(`GitHub artifact archive download failed with HTTP ${response.status}.`)
  const contentType = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error('GitHub artifact archive content type is invalid.')
  }
  const rawLength = response.headers.get('content-length')
  if (rawLength !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(rawLength)) {
      throw new Error('GitHub artifact archive content length is invalid.')
    }
    const length = Number(rawLength)
    if (!Number.isSafeInteger(length) || length < 1 || length > MAX_ARCHIVE_BYTES) {
      throw new Error('GitHub artifact archive is empty or exceeds the size limit.')
    }
  }
  if (!response.body) throw new Error('GitHub artifact archive response is empty.')
}

async function downloadAndHash(response, file) {
  const reader = response.body.getReader()
  const hash = createHash('sha256')
  let bytes = 0
  let failed = true
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      bytes += chunk.byteLength
      if (bytes > MAX_ARCHIVE_BYTES) throw new Error('GitHub artifact archive exceeds the size limit.')
      hash.update(chunk)
      let offset = 0
      while (offset < chunk.byteLength) {
        const { bytesWritten } = await file.write(chunk, offset, chunk.byteLength - offset)
        if (!Number.isSafeInteger(bytesWritten) || bytesWritten < 1) {
          throw new Error('Artifact archive write made no progress.')
        }
        offset += bytesWritten
      }
    }
    if (bytes < 1) throw new Error('GitHub artifact archive is empty.')
    failed = false
    return hash.digest('hex')
  } catch {
    throw new Error('GitHub artifact archive download or hashing failed.')
  } finally {
    if (failed) {
      try {
        await reader.cancel()
      } catch {
        // Ignore transport cleanup failures; the verification already fails closed.
      }
    }
    reader.releaseLock()
    await file.close()
  }
}

export async function verifyGithubArtifactDigest(environment = process.env, {
  fetchImpl = fetch,
  uuid = randomUUID,
} = {}) {
  const inputs = validateInputs(environment)
  const tempStat = await lstat(inputs.runnerTemp)
  if (!tempStat.isDirectory() || tempStat.isSymbolicLink()) {
    throw new Error('GitHub runner temporary directory is invalid.')
  }
  const canonicalTemp = await realpath(inputs.runnerTemp)
  const archivePath = join(canonicalTemp, `burillab-artifact-${uuid()}.zip`)
  if (relative(canonicalTemp, archivePath).startsWith('..')) {
    throw new Error('GitHub artifact archive path escaped the runner temporary directory.')
  }

  const endpoint = new URL(
    `/repos/${inputs.repository}/actions/artifacts/${inputs.artifactId}/zip`,
    'https://api.github.com',
  )
  let archiveCreated = false
  try {
    const redirectResponse = await fetchImpl(endpoint, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${inputs.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })
    if (redirectResponse.status !== 302) {
      throw new Error(`GitHub artifact archive lookup failed with HTTP ${redirectResponse.status}.`)
    }
    const archiveUrl = validateSignedArchiveUrl(redirectResponse.headers.get('location') || '')
    const archiveResponse = await fetchImpl(archiveUrl, {
      headers: { Accept: 'application/zip, application/octet-stream' },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
    })
    validateArchiveResponse(archiveResponse)
    const archiveFile = await open(archivePath, 'wx', 0o600)
    archiveCreated = true
    const actualDigest = await downloadAndHash(archiveResponse, archiveFile)
    if (actualDigest !== inputs.expectedDigest) {
      throw new Error('GitHub artifact archive digest does not match the exact uploaded artifact.')
    }
    return Object.freeze({ artifactId: inputs.artifactId, digest: actualDigest })
  } finally {
    if (archiveCreated) {
      await unlink(archivePath)
    }
  }
}

async function main() {
  if (process.argv.length !== 2) throw new Error('GitHub artifact digest verifier accepts no command-line arguments.')
  const result = await verifyGithubArtifactDigest(process.env)
  console.log(`Verified GitHub artifact archive digest for artifact ${result.artifactId}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'GitHub artifact digest verification failed.')
    process.exitCode = 1
  })
}
