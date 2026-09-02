import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import {
  exactKeys,
} from './ephemeral-release-attestation.mjs'
import { verifyCleanupReceiptChain } from './ephemeral-cleanup-epochs.mjs'
export { CLEANUP_ABSENT_SECRET_NAMES, MAX_CUMULATIVE_LEASES } from './ephemeral-cleanup-epochs.mjs'

const MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_RUN_PAGES = 10
const RUNS_PER_PAGE = 100
const TRUSTED_REPOSITORY = 'haengjoo123/buril-lab'
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const LEASE_PATTERN = /^[0-9a-f]{32}$/
const HASH_PATTERN = /^[0-9a-f]{64}$/
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000
const TERMINAL_GATE_CONCLUSIONS = new Set([
  'action_required',
  'cancelled',
  'failure',
  'neutral',
  'skipped',
  'stale',
  'success',
  'timed_out',
])

const WORKFLOW_CONTRACTS = Object.freeze({
  staging: Object.freeze({
    path: '.github/workflows/deploy-staging.yml',
    filename: 'deploy-staging.yml',
    job: 'Supervised deploy of verified commit to buril-lab-staging',
    title: /^Deploy staging ([0-9a-f]{40}) \(lease=([0-9a-f]{32}), storage-backup=(true|false)\)$/,
  }),
  production: Object.freeze({
    path: '.github/workflows/deploy-production.yml',
    filename: 'deploy-production.yml',
    job: 'Manually deploy verified commit to buril-lab',
    title: /^Deploy production ([0-9a-f]{40}) \(lease=([0-9a-f]{32})(?:, storage-backup=(true|false))?\)$/,
  }),
})

function parseTimestamp(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} is missing.`)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} is invalid.`)
  return parsed
}

function parseTrustedRun(run, contract, repository, currentRunId, { requireLeaseEvidence = false } = {}) {
  if (
    !run || typeof run !== 'object' || Array.isArray(run)
    || String(run.id) === currentRunId
    || run.path !== contract.path
    || run.event !== 'workflow_dispatch'
    || run.head_branch !== 'main'
    || run.repository?.full_name !== repository
    || run.head_repository?.full_name !== repository
  ) return null
  const titleMatch = typeof run.display_title === 'string' ? run.display_title.match(contract.title) : null
  if (!titleMatch || run.head_sha !== titleMatch[1]) return null
  if (requireLeaseEvidence && run.credential_lease_gate_succeeded !== true) return null
  const runAttempt = requireLeaseEvidence ? run.credential_run_attempt : run.run_attempt
  const runUpdatedAt = requireLeaseEvidence ? run.credential_run_updated_at : run.updated_at
  if (!Number.isSafeInteger(run.id) || run.id <= 0 || !Number.isSafeInteger(runAttempt) || runAttempt <= 0) {
    throw new Error('Prior leased deployment run has an invalid identifier or attempt.')
  }
  const createdAt = parseTimestamp(run.created_at, 'Prior leased run created_at')
  const updatedAt = parseTimestamp(runUpdatedAt, 'Prior leased run updated_at')
  if (updatedAt < createdAt) throw new Error('Prior leased deployment timestamps are inconsistent.')
  return Object.freeze({
    runId: String(run.id),
    runAttempt,
    updatedAt,
    commitSha: titleMatch[1],
    leaseId: titleMatch[2],
    storageBackup: titleMatch[3] === 'true',
  })
}

function assertCurrentRunAnchor(runs, contract, repository, currentRunId, leaseId) {
  const anchors = runs.filter((run) => String(run?.id) === currentRunId)
  if (anchors.length !== 1) {
    throw new Error('GitHub deployment history does not contain the exact current workflow run anchor.')
  }
  const anchor = anchors[0]
  const titleMatch = typeof anchor.display_title === 'string'
    ? anchor.display_title.match(contract.title)
    : null
  if (
    !Number.isSafeInteger(anchor.id)
    || anchor.id <= 0
    || anchor.run_attempt !== 1
    || anchor.path !== contract.path
    || anchor.event !== 'workflow_dispatch'
    || anchor.head_branch !== 'main'
    || anchor.repository?.full_name !== repository
    || anchor.head_repository?.full_name !== repository
    || !titleMatch
    || anchor.head_sha !== titleMatch[1]
    || titleMatch[2] !== leaseId
  ) {
    throw new Error('GitHub deployment history current workflow run anchor is malformed or mismatched.')
  }
}

function verifyLeaseEntry(entry, run, nowTimestamp) {
  exactKeys(entry, [
    'run_id',
    'run_attempt',
    'commit_sha',
    'lease_id',
    'storage_backup',
    'closed_at',
    'previous_cleanup_receipt_sha256',
    'cloudflare_token_id_hashes',
    'supabase_pat_label_hash',
    'supabase_pat_sha256',
    'providers_inactive',
  ], 'Cleanup lease entry')
  if (
    entry.run_id !== run.runId
    || entry.run_attempt !== run.runAttempt
    || entry.commit_sha !== run.commitSha
    || entry.lease_id !== run.leaseId
    || entry.storage_backup !== run.storageBackup
    || entry.providers_inactive !== true
    || !HASH_PATTERN.test(entry.previous_cleanup_receipt_sha256)
    || !FULL_SHA_PATTERN.test(entry.commit_sha)
    || !LEASE_PATTERN.test(entry.lease_id)
  ) {
    throw new Error('Signed cleanup receipt does not match every prior leased deployment run.')
  }
  const closedAt = parseTimestamp(entry.closed_at, 'Cleanup lease closed_at')
  if (closedAt < run.updatedAt || closedAt > nowTimestamp + FUTURE_TOLERANCE_MS) {
    throw new Error('Cleanup lease closure time is earlier than the run or unreasonably future-dated.')
  }
  const expectedCloudflareTokens = run.storageBackup ? 2 : 1
  if (
    !Array.isArray(entry.cloudflare_token_id_hashes)
    || entry.cloudflare_token_id_hashes.length !== expectedCloudflareTokens
    || new Set(entry.cloudflare_token_id_hashes).size !== expectedCloudflareTokens
    || entry.cloudflare_token_id_hashes.some((hash) => !HASH_PATTERN.test(hash))
    || !HASH_PATTERN.test(entry.supabase_pat_label_hash)
    || !HASH_PATTERN.test(entry.supabase_pat_sha256)
  ) {
    throw new Error('Signed cleanup receipt credential revocation evidence is incomplete.')
  }
  return closedAt
}

export function verifyCleanupReceiptCoversRun(rawReceipt, publicKey, rawRun, {
  now = Date.now(),
  readArchive,
} = {}) {
  const contract = WORKFLOW_CONTRACTS.staging
  const run = parseTrustedRun(rawRun, contract, TRUSTED_REPOSITORY, '__no_current_run__')
  if (!run) throw new Error('Staging cleanup receipt target run is not trusted.')
  const nowTimestamp = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(nowTimestamp)) throw new Error('Staging cleanup receipt verification time is invalid.')
  const chain = verifyCleanupReceiptChain(rawReceipt, publicKey, { environment: 'staging', now, readArchive })
  const entry = chain.leases.find((candidate) => candidate?.run_id === run.runId)
  if (!entry) throw new Error('Signed Staging cleanup receipt does not cover the exact deployed run.')
  verifyLeaseEntry(entry, run, nowTimestamp)
  return Object.freeze({
    runId: run.runId,
    leaseId: run.leaseId,
    commitSha: run.commitSha,
    receiptHash: chain.receiptHash,
  })
}

export function verifyEphemeralCleanupReceipt(runs, environment, {
  now = Date.now(),
  publicKey,
  readArchive,
} = {}) {
  const repository = environment.GITHUB_REPOSITORY?.trim()
  const deployEnvironment = environment.DEPLOY_ENVIRONMENT?.trim()
  const currentRunId = environment.GITHUB_RUN_ID?.trim()
  const currentAttempt = environment.GITHUB_RUN_ATTEMPT?.trim()
  const leaseId = environment.DEPLOY_LEASE_ID?.trim()
  if (repository !== TRUSTED_REPOSITORY) throw new Error('Ephemeral cleanup receipt repository is not trusted.')
  const contract = WORKFLOW_CONTRACTS[deployEnvironment]
  if (!contract) throw new Error('Ephemeral cleanup receipt environment must be staging or production.')
  if (!/^\d+$/.test(currentRunId || '') || currentAttempt !== '1') {
    throw new Error('Ephemeral deployments require a new first-attempt workflow run.')
  }
  if (!LEASE_PATTERN.test(leaseId || '')) throw new Error('Ephemeral cleanup lease input is malformed.')
  if (!Array.isArray(runs)) throw new Error('GitHub deployment run response is malformed.')
  if (!publicKey) throw new Error('Pinned ephemeral release public key is missing.')

  return verifyCleanupReceiptHistory(runs, environment, { now, publicKey, readArchive, currentRunId, leaseId })
}

export function verifyCleanupReceiptHistory(runs, environment, {
  now = Date.now(), publicKey, readArchive, currentRunId = '__no_current_run__', leaseId = null,
} = {}) {
  const repository = environment.GITHUB_REPOSITORY?.trim()
  const deployEnvironment = environment.DEPLOY_ENVIRONMENT?.trim()
  const contract = WORKFLOW_CONTRACTS[deployEnvironment]
  if (repository !== TRUSTED_REPOSITORY || !contract || !Array.isArray(runs) || !publicKey) {
    throw new Error('Cleanup history inputs are missing or untrusted.')
  }
  const nowTimestamp = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(nowTimestamp)) throw new Error('Cleanup receipt verification time is invalid.')
  const priorRuns = runs
    .map((run) => parseTrustedRun(run, contract, repository, currentRunId, { requireLeaseEvidence: true }))
    .filter(Boolean)
    .sort((left, right) => Number(left.runId) - Number(right.runId))
  if (new Set(priorRuns.map((run) => run.runId)).size !== priorRuns.length) {
    throw new Error('GitHub cleanup history repeats a prior leased deployment run.')
  }
  if (priorRuns.some((run) => run.leaseId === leaseId)) {
    throw new Error('Ephemeral lease identifiers must never be reused by a later workflow run.')
  }

  const chain = verifyCleanupReceiptChain(
    environment.EPHEMERAL_CLEANUP_RECEIPT?.trim() || '',
    publicKey,
    { environment: deployEnvironment, now, readArchive },
  )
  if (chain.leases.length !== priorRuns.length) {
    throw new Error('Signed cleanup receipt does not cover every prior leased deployment run.')
  }
  const receiptRunIds = new Set(chain.leases.map((entry) => entry?.run_id))
  if (receiptRunIds.size !== priorRuns.length) {
    throw new Error('Signed cleanup receipt repeats or omits a prior leased deployment run.')
  }
  for (const run of priorRuns) {
    const entry = chain.leases.find((candidate) => candidate?.run_id === run.runId)
    if (!entry) throw new Error('Signed cleanup receipt omits a prior leased deployment run.')
    verifyLeaseEntry(entry, run, nowTimestamp)
  }

  return Object.freeze({
    environment: deployEnvironment,
    coveredRunCount: priorRuns.length,
    receiptHash: chain.receiptHash,
    epoch: chain.epoch,
    currentEpochLeaseCount: chain.payload.sequence,
  })
}

async function readBoundedJson(response) {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('application/json') || !response.body) {
    throw new Error('GitHub deployment run response is not JSON.')
  }
  const lengthHeader = response.headers.get('content-length')
  if (lengthHeader !== null && (!/^\d+$/.test(lengthHeader) || Number(lengthHeader) > MAX_RESPONSE_BYTES)) {
    throw new Error('GitHub deployment run response is too large.')
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw new Error('GitHub deployment run response is too large.')
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
    throw new Error('GitHub deployment run response is not valid JSON.')
  }
}

async function attachLeaseGateEvidence(run, contract, repository, token, fetchImpl) {
  const endpoint = new URL(
    `https://api.github.com/repos/${repository}/actions/runs/${run.id}/jobs`,
  )
  endpoint.searchParams.set('filter', 'all')
  endpoint.searchParams.set('per_page', '100')
  const response = await fetchImpl(endpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error('GitHub could not provide leased deployment job evidence.')
  const payload = await readBoundedJson(response)
  if (!Array.isArray(payload.jobs)) throw new Error('GitHub leased deployment job response is malformed.')
  const jobs = payload.jobs.filter((job) => (
    job?.name === contract.job
    && job?.run_id === run.id
    && job?.run_attempt === 1
  ))
  if (jobs.length !== 1) {
    throw new Error('GitHub leased deployment job evidence is incomplete or duplicated.')
  }
  const job = jobs[0]
  const leaseSteps = Array.isArray(job?.steps)
    ? job.steps.filter((step) => step?.name === 'Verify the signed current ephemeral lease')
    : []
  const cleanupSteps = Array.isArray(job?.steps)
    ? job.steps.filter((step) => step?.name === 'Verify the signed cumulative credential cleanup receipt')
    : []
  if (
    job.status !== 'completed'
    || typeof job.completed_at !== 'string'
    || leaseSteps.length !== 1
    || leaseSteps[0].status !== 'completed'
    || !TERMINAL_GATE_CONCLUSIONS.has(leaseSteps[0].conclusion)
    || cleanupSteps.length !== 1
    || cleanupSteps[0].status !== 'completed'
    || !TERMINAL_GATE_CONCLUSIONS.has(cleanupSteps[0].conclusion)
  ) {
    throw new Error('GitHub leased deployment gate evidence is not terminal and complete.')
  }
  if (leaseSteps[0].conclusion !== 'success' || cleanupSteps[0].conclusion !== 'success') {
    return Object.freeze({ ...run, credential_lease_gate_succeeded: false })
  }
  return Object.freeze({
    ...run,
    credential_lease_gate_succeeded: true,
    credential_run_attempt: 1,
    credential_run_updated_at: job.completed_at,
  })
}

async function fetchLeasedDeploymentHistory(environment, {
  fetchImpl = fetch,
  publicKey,
  now = Date.now(),
  readArchive,
  requireCurrentRun = true,
} = {}) {
  const token = environment.GITHUB_TOKEN?.trim()
  const repository = environment.GITHUB_REPOSITORY?.trim()
  const deployEnvironment = environment.DEPLOY_ENVIRONMENT?.trim()
  const contract = WORKFLOW_CONTRACTS[deployEnvironment]
  if (!token || token.length < 20 || repository !== TRUSTED_REPOSITORY || !contract) {
    throw new Error('GitHub cleanup receipt verification inputs are missing or untrusted.')
  }
  const chain = verifyCleanupReceiptChain(environment.EPHEMERAL_CLEANUP_RECEIPT?.trim() || '', publicKey, {
    environment: deployEnvironment, now, readArchive,
  })
  const currentRunId = requireCurrentRun ? (environment.GITHUB_RUN_ID?.trim() || '') : '__no_current_run__'
  const allRuns = []
  const seenRunIds = new Set()
  let expectedRunCount = null
  for (let page = 1; page <= MAX_RUN_PAGES; page += 1) {
    const endpoint = new URL(
      `https://api.github.com/repos/${repository}/actions/workflows/${contract.filename}/runs`,
    )
    endpoint.searchParams.set('branch', 'main')
    endpoint.searchParams.set('event', 'workflow_dispatch')
    endpoint.searchParams.set('per_page', String(RUNS_PER_PAGE))
    endpoint.searchParams.set('page', String(page))
    const response = await fetchImpl(endpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error('GitHub could not provide prior deployment runs for cleanup verification.')
    const payload = await readBoundedJson(response)
    if (
      !Number.isSafeInteger(payload.total_count)
      || payload.total_count < 0
      || !Array.isArray(payload.workflow_runs)
      || payload.workflow_runs.length > RUNS_PER_PAGE
    ) throw new Error('GitHub deployment run response is malformed.')
    if (expectedRunCount === null) {
      expectedRunCount = payload.total_count
      if (expectedRunCount > MAX_RUN_PAGES * RUNS_PER_PAGE) {
        throw new Error('GitHub leased deployment history exceeds the bounded cleanup audit window.')
      }
    } else if (payload.total_count !== expectedRunCount) {
      throw new Error('GitHub deployment run total_count changed during cleanup verification.')
    }
    for (const run of payload.workflow_runs) {
      if (!Number.isSafeInteger(run?.id) || run.id <= 0 || seenRunIds.has(run.id)) {
        throw new Error('GitHub deployment run pagination contains an invalid or repeated run identifier.')
      }
      seenRunIds.add(run.id)
      allRuns.push(run)
    }
    if (allRuns.length > expectedRunCount) {
      throw new Error('GitHub deployment run pagination exceeds total_count.')
    }
    if (allRuns.length === expectedRunCount) break
    if (payload.workflow_runs.length < RUNS_PER_PAGE) {
      throw new Error('GitHub deployment run pagination is incomplete for total_count.')
    }
    if (page === MAX_RUN_PAGES) {
      throw new Error('GitHub leased deployment history exceeds the bounded cleanup audit window.')
    }
  }
  if (expectedRunCount === null || allRuns.length !== expectedRunCount) {
    throw new Error('GitHub deployment run pagination is incomplete for total_count.')
  }
  if (requireCurrentRun) {
    assertCurrentRunAnchor(allRuns, contract, repository, currentRunId, environment.DEPLOY_LEASE_ID?.trim() || '')
  }
  const candidateRuns = allRuns.filter((run) => (
    parseTrustedRun(run, contract, repository, currentRunId) !== null
  ))
  const evidencedRuns = []
  for (let offset = 0; offset < candidateRuns.length; offset += 8) {
    const batch = await Promise.all(candidateRuns.slice(offset, offset + 8).map((run) => (
      attachLeaseGateEvidence(run, contract, repository, token, fetchImpl)
    )))
    evidencedRuns.push(...batch)
    if (evidencedRuns.filter((run) => run.credential_lease_gate_succeeded === true).length > chain.leases.length) {
      throw new Error('Signed cleanup receipt does not cover every prior leased deployment run across the reviewed epochs.')
    }
  }
  return evidencedRuns
}

export async function fetchAndVerifyEphemeralCleanupReceipt(environment = process.env, options = {}) {
  const runs = await fetchLeasedDeploymentHistory(environment, { ...options, requireCurrentRun: true })
  return verifyEphemeralCleanupReceipt(runs, environment, options)
}

// Supervisor-only preflight: no invented current run and no history cut-off.
// Every first-attempt leased run, including unsuccessful deployments, is read.
export async function fetchAndVerifyCleanupHistory(environment, options = {}) {
  const runs = await fetchLeasedDeploymentHistory(environment, { ...options, requireCurrentRun: false })
  return verifyCleanupReceiptHistory(runs, environment, { ...options, currentRunId: '__no_current_run__', leaseId: null })
}

async function main() {
  const publicKey = await readFile('config/ephemeral-release-public-key.pem', 'utf8')
  const result = await fetchAndVerifyEphemeralCleanupReceipt(process.env, { publicKey })
  console.log(`Signed cleanup receipt covers ${result.coveredRunCount} prior ${result.environment} lease(s).`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Ephemeral cleanup receipt verification failed.')
    process.exitCode = 1
  })
}
