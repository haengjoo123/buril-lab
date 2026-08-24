import { pathToFileURL } from 'node:url'

const MAX_RESPONSE_BYTES = 1024 * 1024
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
export const STAGING_RUN_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000
export const STAGING_RUN_FUTURE_TOLERANCE_MS = 5 * 60 * 1000

function parseTimestamp(value, label) {
  if (typeof value !== 'string') throw new Error(`Latest trusted Staging run lacks ${label}.`)
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error(`Latest trusted Staging run has invalid ${label}.`)
  return timestamp
}

function parseNow(now) {
  const timestamp = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(timestamp)) throw new Error('Staging-run verification time is invalid.')
  return timestamp
}

function isTrustedStagingRun(candidate, repository, commitSha) {
  return (
    candidate?.event === 'workflow_run'
    && candidate?.head_branch === 'main'
    && candidate?.head_sha === commitSha
    && candidate?.head_repository?.full_name === repository
  )
}

export function findTrustedStagingRun(runs, {
  repository,
  commitSha,
  now = Date.now(),
}) {
  if (!Array.isArray(runs)) throw new Error('GitHub Staging-run response is malformed.')
  const nowTimestamp = parseNow(now)
  const trustedRuns = runs
    .filter((candidate) => isTrustedStagingRun(candidate, repository, commitSha))
    .map((candidate) => {
      const createdAt = parseTimestamp(candidate.created_at, 'created_at')
      const runStartedAt = parseTimestamp(candidate.run_started_at, 'run_started_at')
      const updatedAt = parseTimestamp(candidate.updated_at, 'updated_at')
      if (createdAt > nowTimestamp + STAGING_RUN_FUTURE_TOLERANCE_MS
          || runStartedAt > nowTimestamp + STAGING_RUN_FUTURE_TOLERANCE_MS
          || updatedAt > nowTimestamp + STAGING_RUN_FUTURE_TOLERANCE_MS) {
        throw new Error('Trusted Deploy staging run has an unreasonable future timestamp.')
      }
      if (createdAt > runStartedAt || runStartedAt > updatedAt) {
        throw new Error('Trusted Deploy staging run timestamps are inconsistent.')
      }
      return { candidate, createdAt, runStartedAt, updatedAt }
    })
    .sort((left, right) => {
      if (right.runStartedAt !== left.runStartedAt) return right.runStartedAt - left.runStartedAt
      if (right.createdAt !== left.createdAt) return right.createdAt - left.createdAt
      const rightAttempt = Number(right.candidate.run_attempt) || 0
      const leftAttempt = Number(left.candidate.run_attempt) || 0
      if (rightAttempt !== leftAttempt) return rightAttempt - leftAttempt
      return (Number(right.candidate.id) || 0) - (Number(left.candidate.id) || 0)
    })

  if (trustedRuns.length === 0) {
    throw new Error('No trusted Deploy staging run exists for this commit.')
  }

  const latest = trustedRuns[0]
  if (latest.candidate.status !== 'completed' || latest.candidate.conclusion !== 'success') {
    throw new Error('Latest trusted Deploy staging run is not completed successfully.')
  }
  if (nowTimestamp - latest.createdAt > STAGING_RUN_MAX_AGE_MS) {
    throw new Error('Latest trusted Deploy staging run was created more than eight days ago.')
  }
  if (nowTimestamp - latest.runStartedAt > STAGING_RUN_MAX_AGE_MS) {
    throw new Error('Latest trusted Deploy staging run attempt is older than eight days.')
  }
  if (nowTimestamp - latest.updatedAt > STAGING_RUN_MAX_AGE_MS) {
    throw new Error('Latest trusted Deploy staging run is older than eight days.')
  }
  return latest.candidate
}

async function readBoundedJson(response) {
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > MAX_RESPONSE_BYTES) throw new Error('GitHub Staging-run response is too large.')
  if (!response.body) throw new Error('GitHub Staging-run response is empty.')

  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw new Error('GitHub Staging-run response is too large.')
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
    throw new Error('GitHub Staging-run response is not JSON.')
  }
}

export async function fetchTrustedStagingRun(environment = process.env, { now = Date.now() } = {}) {
  const token = environment.GITHUB_TOKEN?.trim()
  const repository = environment.GITHUB_REPOSITORY?.trim()
  const commitSha = environment.DEPLOY_COMMIT_SHA?.trim()
  if (!token || !repository || !commitSha) throw new Error('GitHub Staging verification inputs are missing.')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('GITHUB_REPOSITORY is malformed.')
  }
  if (!FULL_SHA_PATTERN.test(commitSha)) {
    throw new Error('DEPLOY_COMMIT_SHA must be a lowercase, full 40-character Git SHA.')
  }

  const endpoint = new URL(
    `/repos/${repository}/actions/workflows/deploy-staging.yml/runs`,
    'https://api.github.com',
  )
  endpoint.searchParams.set('head_sha', commitSha)
  endpoint.searchParams.set('per_page', '100')

  // Do not add a status filter: a newer queued, in-progress, failed, or
  // cancelled run must block an older success for the same commit.
  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`GitHub Staging-run lookup failed with HTTP ${response.status}.`)
  const payload = await readBoundedJson(response)
  return findTrustedStagingRun(payload.workflow_runs, { repository, commitSha, now })
}

async function main() {
  const run = await fetchTrustedStagingRun()
  console.log(`Verified trusted Deploy staging run ${run.id} for ${run.head_sha}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'GitHub Staging-run verification failed.')
    process.exitCode = 1
  })
}
