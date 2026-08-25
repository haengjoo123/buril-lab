import { pathToFileURL } from 'node:url'

const MAX_RESPONSE_BYTES = 1024 * 1024
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const TRUSTED_REPOSITORY = 'haengjoo123/buril-lab'
const TRUSTED_WORKFLOW_NAME = 'Hosted Supabase advisor attestation'
const TRUSTED_WORKFLOW_PATH = '.github/workflows/hosted-supabase-advisor.yml'
const TRUSTED_ENVIRONMENTS = new Set(['staging', 'production'])

export const SUPABASE_ADVISOR_RUN_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const SUPABASE_ADVISOR_RUN_FUTURE_TOLERANCE_MS = 5 * 60 * 1000

function parseTimestamp(value, label) {
  if (typeof value !== 'string') {
    throw new Error(`Latest trusted Supabase Advisor attestation lacks ${label}.`)
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Latest trusted Supabase Advisor attestation has invalid ${label}.`)
  }
  return timestamp
}

function parseNow(now) {
  const timestamp = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(timestamp)) {
    throw new Error('Supabase Advisor attestation verification time is invalid.')
  }
  return timestamp
}

function expectedDisplayTitle(environment, commitSha) {
  return `Hosted Supabase advisor ${environment} ${commitSha}`
}

function isTrustedAdvisorRun(candidate, repository, commitSha, environment) {
  return (
    candidate?.name === TRUSTED_WORKFLOW_NAME
    && candidate?.path === TRUSTED_WORKFLOW_PATH
    && candidate?.display_title === expectedDisplayTitle(environment, commitSha)
    && candidate?.event === 'workflow_dispatch'
    && candidate?.head_branch === 'main'
    && candidate?.head_sha === commitSha
    && candidate?.repository?.full_name === repository
    && candidate?.head_repository?.full_name === repository
  )
}

export function findTrustedSupabaseAdvisorRun(runs, {
  repository,
  commitSha,
  environment,
  now = Date.now(),
}) {
  if (!Array.isArray(runs)) {
    throw new Error('GitHub Supabase Advisor attestation response is malformed.')
  }
  if (repository !== TRUSTED_REPOSITORY) {
    throw new Error('Supabase Advisor attestation repository is not trusted.')
  }
  if (!FULL_SHA_PATTERN.test(commitSha)) {
    throw new Error('Supabase Advisor attestation requires a lowercase, full Git SHA.')
  }
  if (!TRUSTED_ENVIRONMENTS.has(environment)) {
    throw new Error('Supabase Advisor attestation environment must be staging or production.')
  }

  const nowTimestamp = parseNow(now)
  const trustedRuns = runs
    .filter((candidate) => isTrustedAdvisorRun(candidate, repository, commitSha, environment))
    .map((candidate) => {
      const createdAt = parseTimestamp(candidate.created_at, 'created_at')
      const runStartedAt = parseTimestamp(candidate.run_started_at, 'run_started_at')
      const updatedAt = parseTimestamp(candidate.updated_at, 'updated_at')
      if (
        createdAt > nowTimestamp + SUPABASE_ADVISOR_RUN_FUTURE_TOLERANCE_MS
        || runStartedAt > nowTimestamp + SUPABASE_ADVISOR_RUN_FUTURE_TOLERANCE_MS
        || updatedAt > nowTimestamp + SUPABASE_ADVISOR_RUN_FUTURE_TOLERANCE_MS
      ) {
        throw new Error('Trusted Supabase Advisor attestation has an unreasonable future timestamp.')
      }
      if (createdAt > runStartedAt || runStartedAt > updatedAt) {
        throw new Error('Trusted Supabase Advisor attestation timestamps are inconsistent.')
      }
      if (!Number.isSafeInteger(candidate.id) || candidate.id <= 0) {
        throw new Error('Trusted Supabase Advisor attestation has an invalid run id.')
      }
      if (!Number.isSafeInteger(candidate.run_attempt) || candidate.run_attempt <= 0) {
        throw new Error('Trusted Supabase Advisor attestation has an invalid run attempt.')
      }
      return { candidate, createdAt, runStartedAt, updatedAt }
    })
    .sort((left, right) => {
      if (right.runStartedAt !== left.runStartedAt) return right.runStartedAt - left.runStartedAt
      if (right.createdAt !== left.createdAt) return right.createdAt - left.createdAt
      if (right.candidate.run_attempt !== left.candidate.run_attempt) {
        return right.candidate.run_attempt - left.candidate.run_attempt
      }
      return right.candidate.id - left.candidate.id
    })

  if (trustedRuns.length === 0) {
    throw new Error(`No trusted ${environment} Supabase Advisor attestation exists for this commit.`)
  }

  const latest = trustedRuns[0]
  if (latest.candidate.status !== 'completed' || latest.candidate.conclusion !== 'success') {
    throw new Error(`Latest trusted ${environment} Supabase Advisor attestation is not completed successfully.`)
  }
  if (
    nowTimestamp - latest.createdAt > SUPABASE_ADVISOR_RUN_MAX_AGE_MS
    || nowTimestamp - latest.runStartedAt > SUPABASE_ADVISOR_RUN_MAX_AGE_MS
    || nowTimestamp - latest.updatedAt > SUPABASE_ADVISOR_RUN_MAX_AGE_MS
  ) {
    throw new Error(`Latest trusted ${environment} Supabase Advisor attestation is older than 24 hours.`)
  }

  return latest.candidate
}

async function readBoundedJson(response) {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error('GitHub Supabase Advisor attestation response is not JSON.')
  }
  const contentLengthHeader = response.headers.get('content-length')
  if (contentLengthHeader !== null && !/^\d+$/.test(contentLengthHeader)) {
    throw new Error('GitHub Supabase Advisor attestation response has an invalid content length.')
  }
  const contentLength = Number(contentLengthHeader || 0)
  if (contentLength > MAX_RESPONSE_BYTES) {
    throw new Error('GitHub Supabase Advisor attestation response is too large.')
  }
  if (!response.body) {
    throw new Error('GitHub Supabase Advisor attestation response is empty.')
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
        throw new Error('GitHub Supabase Advisor attestation response is too large.')
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
    throw new Error('GitHub Supabase Advisor attestation response is not valid JSON.')
  }
}

export async function fetchTrustedSupabaseAdvisorRun(
  environment = process.env,
  { now = Date.now(), fetchImpl = fetch } = {},
) {
  const token = environment.GITHUB_TOKEN?.trim()
  const repository = environment.GITHUB_REPOSITORY?.trim()
  const commitSha = environment.DEPLOY_COMMIT_SHA?.trim()
  const deployEnvironment = environment.DEPLOY_ENVIRONMENT?.trim()
  if (!token || !repository || !commitSha || !deployEnvironment) {
    throw new Error('GitHub Supabase Advisor attestation verification inputs are missing.')
  }
  if (!REPOSITORY_PATTERN.test(repository) || repository !== TRUSTED_REPOSITORY) {
    throw new Error('GITHUB_REPOSITORY is not the trusted BurilLab repository.')
  }
  if (!FULL_SHA_PATTERN.test(commitSha)) {
    throw new Error('DEPLOY_COMMIT_SHA must be a lowercase, full 40-character Git SHA.')
  }
  if (!TRUSTED_ENVIRONMENTS.has(deployEnvironment)) {
    throw new Error('DEPLOY_ENVIRONMENT must be staging or production.')
  }

  const endpoint = new URL(
    `/repos/${repository}/actions/workflows/hosted-supabase-advisor.yml/runs`,
    'https://api.github.com',
  )
  endpoint.searchParams.set('branch', 'main')
  endpoint.searchParams.set('event', 'workflow_dispatch')
  endpoint.searchParams.set('head_sha', commitSha)
  endpoint.searchParams.set('per_page', '100')

  // Do not add a status filter. A newer queued, failed, or cancelled run for
  // the same environment and commit must block an older successful run.
  const response = await fetchImpl(endpoint, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    throw new Error(`GitHub Supabase Advisor attestation lookup failed with HTTP ${response.status}.`)
  }
  const payload = await readBoundedJson(response)
  return findTrustedSupabaseAdvisorRun(payload.workflow_runs, {
    repository,
    commitSha,
    environment: deployEnvironment,
    now,
  })
}

async function main() {
  const run = await fetchTrustedSupabaseAdvisorRun()
  console.log(`Verified trusted ${process.env.DEPLOY_ENVIRONMENT} Supabase Advisor attestation ${run.id} for ${run.head_sha}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'GitHub Supabase Advisor attestation verification failed.')
    process.exitCode = 1
  })
}
