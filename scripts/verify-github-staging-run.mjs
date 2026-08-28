import { appendFile, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { verifyCleanupReceiptCoversRun } from './verify-ephemeral-cleanup-receipt.mjs'

const MAX_RESPONSE_BYTES = 1024 * 1024
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const TRUSTED_WORKFLOW_NAME = 'Deploy staging'
const TRUSTED_WORKFLOW_PATH = '.github/workflows/deploy-staging.yml'
const TRUSTED_RUN_TITLE = /^Deploy staging ([0-9a-f]{40}) \(lease=([0-9a-f]{32}), storage-backup=(true|false)\)$/
const TRUSTED_BUILD_JOB_NAME = 'Build exact Staging artifact without deployment credentials'
const TRUSTED_DEPLOY_JOB_NAME = 'Supervised deploy of verified commit to buril-lab-staging'
const TRUSTED_WORKER_JOB_NAME = 'Supervised fresh-runner deploy of the OFF-only Staging backup Worker'
const REQUIRED_BUILD_STEPS = Object.freeze([
  'Validate the credential-free Staging build request',
  'Check out the exact Staging build commit',
  'Verify the Staging build commit is current main',
  'Set up Node.js for the Staging build',
  'Install locked Staging build dependencies',
  'Build the Staging artifact',
  'Compile Staging Pages Functions without deployment credentials',
  'Attach and verify the public release identity',
  'Create the exact Staging artifact manifest',
  'Upload the exact Staging release artifact',
])
const REQUIRED_DEPLOY_STEPS = Object.freeze([
  'Validate the supervised Staging confirmation',
  'Capture the clean Staging deploy runner boundary',
  'Download the exact Staging release artifact',
  'Independently verify the uploaded Staging artifact archive digest',
  'Verify and activate the exact Staging release artifact',
  'Verify the signed current ephemeral lease',
  'Verify exact ephemeral credentials reached the runner',
  'Verify the signed cumulative credential cleanup receipt',
  'Verify the exact commit passed trusted main quality',
  'Verify the current Staging Supabase Advisor state',
  'Verify environment-scoped deployment inputs',
  'Recheck the exact commit still passes trusted main quality',
  'Recheck the current Staging Supabase Advisor state before Pages deployment',
  'Recheck the active Staging Pages token and deployment inputs at the mutation boundary',
  'Recheck the signed Staging cleanup receipt at the Pages mutation boundary',
  'Recheck the signed Staging lease with ten minutes remaining for Pages mutation',
  'Deploy the exact commit to Staging Pages',
  'Verify the protected Staging release manifest',
  'Run the protected custom-domain Staging Gate 0 browser flow',
  'Run the protected immutable-deployment Staging Gate 0 browser flow',
  'Record Pages deployment evidence',
])
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
  const titleMatch = typeof candidate?.display_title === 'string'
    ? candidate.display_title.match(TRUSTED_RUN_TITLE)
    : null
  const apiNameMatches = candidate?.name === TRUSTED_WORKFLOW_NAME
    || candidate?.name === candidate?.display_title
  return (
    apiNameMatches
    && titleMatch?.[1] === commitSha
    && candidate?.path === TRUSTED_WORKFLOW_PATH
    && candidate?.event === 'workflow_dispatch'
    && candidate?.head_branch === 'main'
    && candidate?.head_sha === commitSha
    && candidate?.repository?.full_name === repository
    && candidate?.head_repository?.full_name === repository
  )
}

export function verifyTrustedStagingJobs(jobs, runId) {
  if (!Array.isArray(jobs)) throw new Error('GitHub Staging job response is malformed.')
  const allowedNames = new Set([TRUSTED_BUILD_JOB_NAME, TRUSTED_DEPLOY_JOB_NAME, TRUSTED_WORKER_JOB_NAME])
  if (jobs.some((job) => !allowedNames.has(job?.name))) {
    throw new Error('Trusted Deploy staging run contains an unapproved job.')
  }
  const buildMatches = jobs.filter((job) => job?.name === TRUSTED_BUILD_JOB_NAME)
  const deployMatches = jobs.filter((job) => job?.name === TRUSTED_DEPLOY_JOB_NAME)
  const workerMatches = jobs.filter((job) => job?.name === TRUSTED_WORKER_JOB_NAME)
  if (buildMatches.length !== 1 || deployMatches.length !== 1 || workerMatches.length !== 1) {
    throw new Error('Trusted Deploy staging run must contain exactly one build, deploy, and optional Worker job.')
  }
  const buildJob = buildMatches[0]
  const deployJob = deployMatches[0]
  const workerJob = workerMatches[0]
  for (const [label, job] of [['build', buildJob], ['deployment', deployJob]]) {
    if (!Number.isSafeInteger(job.id) || job.id <= 0 || job.status !== 'completed' || job.conclusion !== 'success') {
      throw new Error(`Trusted Deploy staging ${label} job did not complete successfully.`)
    }
    if (job.run_id !== undefined && job.run_id !== runId) {
      throw new Error(`Trusted Deploy staging ${label} job belongs to a different workflow run.`)
    }
  }
  if (
    !Number.isSafeInteger(workerJob.id)
    || workerJob.id <= 0
    || workerJob.status !== 'completed'
    || !['success', 'skipped'].includes(workerJob.conclusion)
    || (workerJob.run_id !== undefined && workerJob.run_id !== runId)
  ) {
    throw new Error('Trusted Deploy staging optional Worker job has invalid evidence.')
  }
  for (const [label, job, requiredSteps] of [
    ['build', buildJob, REQUIRED_BUILD_STEPS],
    ['deployment', deployJob, REQUIRED_DEPLOY_STEPS],
  ]) {
    if (!Array.isArray(job.steps)) throw new Error(`Trusted Deploy staging ${label} job lacks step evidence.`)
    for (const requiredName of requiredSteps) {
      const matches = job.steps.filter((step) => step?.name === requiredName)
      if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') {
        throw new Error(`Trusted Deploy staging ${label} step did not complete successfully: ${requiredName}`)
      }
    }
  }
  return { buildJob, deployJob, workerJob }
}

export function findTrustedStagingRun(runs, {
  repository,
  commitSha,
  runId,
  now = Date.now(),
}) {
  if (!Array.isArray(runs)) throw new Error('GitHub Staging-run response is malformed.')
  const nowTimestamp = parseNow(now)
  const trustedRuns = runs
    .filter((candidate) => (
      isTrustedStagingRun(candidate, repository, commitSha)
      && (runId === undefined || String(candidate?.id) === String(runId))
    ))
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
  if (!Number.isSafeInteger(latest.candidate.id) || latest.candidate.id <= 0) {
    throw new Error('Latest trusted Deploy staging run has an invalid identifier.')
  }
  if (latest.candidate.run_attempt !== 1) {
    throw new Error('Latest trusted Deploy staging run is a forbidden workflow re-run.')
  }
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

export async function fetchTrustedStagingRun(environment = process.env, {
  now = Date.now(),
  publicKey,
  fetchImpl = fetch,
} = {}) {
  const token = environment.GITHUB_TOKEN?.trim()
  const repository = environment.GITHUB_REPOSITORY?.trim()
  const commitSha = environment.DEPLOY_COMMIT_SHA?.trim()
  const runId = environment.DEPLOY_STAGING_RUN_ID?.trim()
  if (!token || !repository || !commitSha || !/^\d+$/.test(runId || '')) {
    throw new Error('GitHub exact Staging verification inputs are missing.')
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('GITHUB_REPOSITORY is malformed.')
  }
  if (!FULL_SHA_PATTERN.test(commitSha)) {
    throw new Error('DEPLOY_COMMIT_SHA must be a lowercase, full 40-character Git SHA.')
  }

  const endpoint = new URL(
    `/repos/${repository}/actions/runs/${runId}`,
    'https://api.github.com',
  )
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
  if (!response.ok) throw new Error(`GitHub Staging-run lookup failed with HTTP ${response.status}.`)
  const payload = await readBoundedJson(response)
  const run = findTrustedStagingRun([payload], { repository, commitSha, runId, now })

  const jobsEndpoint = new URL(
    `/repos/${repository}/actions/runs/${run.id}/jobs`,
    'https://api.github.com',
  )
  jobsEndpoint.searchParams.set('filter', 'latest')
  jobsEndpoint.searchParams.set('per_page', '100')
  const jobsResponse = await fetchImpl(jobsEndpoint, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
  if (!jobsResponse.ok) throw new Error(`GitHub Staging-job lookup failed with HTTP ${jobsResponse.status}.`)
  const jobsPayload = await readBoundedJson(jobsResponse)
  verifyTrustedStagingJobs(jobsPayload.jobs, run.id)
  if (!publicKey) throw new Error('Pinned ephemeral release public key is missing for Staging cleanup verification.')
  verifyCleanupReceiptCoversRun(
    environment.STAGING_EPHEMERAL_CLEANUP_RECEIPT?.trim() || '',
    publicKey,
    run,
    { now },
  )
  return run
}

async function main() {
  const publicKey = await readFile('config/ephemeral-release-public-key.pem', 'utf8')
  const run = await fetchTrustedStagingRun(process.env, { publicKey })
  const cleanup = verifyCleanupReceiptCoversRun(
    process.env.STAGING_EPHEMERAL_CLEANUP_RECEIPT?.trim() || '',
    publicKey,
    run,
  )
  if (process.env.GITHUB_OUTPUT) {
    const commitMessage = `quality-approved staging run ${run.id} lease ${cleanup.leaseId}`
    await appendFile(process.env.GITHUB_OUTPUT, [
      `staging_run_id=${run.id}`,
      `staging_lease_id=${cleanup.leaseId}`,
      `staging_run_started_at=${new Date(Date.parse(run.run_started_at)).toISOString()}`,
      `staging_run_updated_at=${new Date(Date.parse(run.updated_at)).toISOString()}`,
      `staging_commit_message=${commitMessage}`,
      '',
    ].join('\n'), 'utf8')
  }
  console.log(`Verified trusted Deploy staging run ${run.id} for ${run.head_sha}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'GitHub Staging-run verification failed.')
    process.exitCode = 1
  })
}
