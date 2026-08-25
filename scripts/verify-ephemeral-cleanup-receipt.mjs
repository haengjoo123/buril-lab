import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import {
  exactKeys,
  verifySignedAttestation,
} from './ephemeral-release-attestation.mjs'

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

export const CLEANUP_ABSENT_SECRET_NAMES = Object.freeze([
  'CLOUDFLARE_API_TOKEN',
  'EPHEMERAL_CREDENTIAL_SESSION',
  'PRODUCTION_CLOUDFLARE_API_TOKEN',
  'PRODUCTION_PAGES_EPHEMERAL_TOKEN',
  'STAGING_CLOUDFLARE_API_TOKEN',
  'STAGING_PAGES_EPHEMERAL_TOKEN',
  'STAGING_WORKER_EPHEMERAL_TOKEN',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_HOSTED_ADVISOR_EPHEMERAL_TOKEN',
])
export const MAX_CUMULATIVE_LEASES = 32

const WORKFLOW_CONTRACTS = Object.freeze({
  staging: Object.freeze({
    name: 'Deploy staging',
    path: '.github/workflows/deploy-staging.yml',
    filename: 'deploy-staging.yml',
    job: 'Supervised deploy of verified commit to buril-lab-staging',
    title: /^Deploy staging ([0-9a-f]{40}) \(lease=([0-9a-f]{32}), storage-backup=(true|false)\)$/,
  }),
  production: Object.freeze({
    name: 'Deploy production manually',
    path: '.github/workflows/deploy-production.yml',
    filename: 'deploy-production.yml',
    job: 'Manually deploy verified commit to buril-lab',
    title: /^Deploy production ([0-9a-f]{40}) \(lease=([0-9a-f]{32})\)$/,
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
    || run.name !== contract.name
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
    || anchor.name !== contract.name
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

function verifyLegacyCredentials(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Signed cleanup receipt must include the initial legacy credential closure.')
  }
  const identities = new Set()
  let hasSupabase = false
  let hasCloudflare = false
  for (const entry of entries) {
    exactKeys(entry, ['provider', 'credential_id_hash', 'status'], 'Legacy credential closure')
    if (
      !['cloudflare', 'supabase'].includes(entry.provider)
      || !HASH_PATTERN.test(entry.credential_id_hash)
      || entry.status !== 'operator_verified_absent'
    ) {
      throw new Error('Signed cleanup receipt has invalid legacy credential closure evidence.')
    }
    const identity = `${entry.provider}:${entry.credential_id_hash}`
    if (identities.has(identity)) throw new Error('Signed cleanup receipt repeats legacy credential evidence.')
    identities.add(identity)
    if (entry.provider === 'supabase') hasSupabase = true
    if (entry.provider === 'cloudflare') hasCloudflare = true
  }
  if (!hasSupabase || !hasCloudflare) {
    throw new Error('Signed cleanup receipt must close both legacy Supabase and Cloudflare credentials.')
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
} = {}) {
  const contract = WORKFLOW_CONTRACTS.staging
  const run = parseTrustedRun(rawRun, contract, TRUSTED_REPOSITORY, '__no_current_run__')
  if (!run) throw new Error('Staging cleanup receipt target run is not trusted.')
  const nowTimestamp = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(nowTimestamp)) throw new Error('Staging cleanup receipt verification time is invalid.')
  const signed = verifySignedAttestation(rawReceipt, publicKey, 'cleanup_receipt')
  const receipt = signed.payload
  exactKeys(receipt, [
    'version', 'kind', 'environment', 'workflow', 'issued_at', 'sequence', 'legacy_verification_mode', 'github_secrets_absent',
    'legacy_credentials', 'leases', 'supervisor_key_id',
  ], 'Signed Staging cleanup receipt')
  if (
    receipt.version !== 3
    || receipt.environment !== 'staging'
    || receipt.workflow !== contract.filename
    || receipt.legacy_verification_mode !== 'operator_dashboard_attestation'
  ) {
    throw new Error('Signed Staging cleanup receipt belongs to a different environment.')
  }
  if (
    !Array.isArray(receipt.github_secrets_absent)
    || JSON.stringify([...receipt.github_secrets_absent].sort())
      !== JSON.stringify([...CLEANUP_ABSENT_SECRET_NAMES].sort())
  ) {
    throw new Error('Signed Staging cleanup receipt does not attest every GitHub secret is absent.')
  }
  verifyLegacyCredentials(receipt.legacy_credentials)
  if (
    !Array.isArray(receipt.leases)
    || receipt.leases.length > MAX_CUMULATIVE_LEASES
    || receipt.sequence !== receipt.leases.length
  ) throw new Error('Signed Staging cleanup receipt has an invalid sequence or lease epoch.')
  const entry = receipt.leases.find((candidate) => candidate?.run_id === run.runId)
  if (!entry) throw new Error('Signed Staging cleanup receipt does not cover the exact deployed run.')
  const closedAt = verifyLeaseEntry(entry, run, nowTimestamp)
  const issuedAt = parseTimestamp(receipt.issued_at, 'Signed Staging cleanup receipt issued_at')
  if (issuedAt < closedAt || issuedAt > nowTimestamp + FUTURE_TOLERANCE_MS) {
    throw new Error('Signed Staging cleanup receipt issue time is inconsistent.')
  }
  return Object.freeze({
    runId: run.runId,
    leaseId: run.leaseId,
    commitSha: run.commitSha,
    receiptHash: signed.envelopeHash,
  })
}

export function verifyEphemeralCleanupReceipt(runs, environment, {
  now = Date.now(),
  publicKey,
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

  const nowTimestamp = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(nowTimestamp)) throw new Error('Cleanup receipt verification time is invalid.')
  const priorRuns = runs
    .map((run) => parseTrustedRun(run, contract, repository, currentRunId, { requireLeaseEvidence: true }))
    .filter(Boolean)
    .sort((left, right) => Number(left.runId) - Number(right.runId))
  if (priorRuns.some((run) => run.leaseId === leaseId)) {
    throw new Error('Ephemeral lease identifiers must never be reused by a later workflow run.')
  }

  const signed = verifySignedAttestation(
    environment.EPHEMERAL_CLEANUP_RECEIPT?.trim() || '',
    publicKey,
    'cleanup_receipt',
  )
  const receipt = signed.payload
  exactKeys(receipt, [
    'version',
    'kind',
    'environment',
    'workflow',
    'issued_at',
    'sequence',
    'legacy_verification_mode',
    'github_secrets_absent',
    'legacy_credentials',
    'leases',
    'supervisor_key_id',
  ], 'Signed cleanup receipt')
  if (
    receipt.version !== 3
    || receipt.environment !== deployEnvironment
    || receipt.workflow !== contract.filename
    || receipt.legacy_verification_mode !== 'operator_dashboard_attestation'
  ) {
    throw new Error('Signed cleanup receipt belongs to a different deployment environment.')
  }
  if (
    !Array.isArray(receipt.github_secrets_absent)
    || JSON.stringify([...receipt.github_secrets_absent].sort())
      !== JSON.stringify([...CLEANUP_ABSENT_SECRET_NAMES].sort())
  ) {
    throw new Error('Signed cleanup receipt does not attest every legacy and ephemeral GitHub secret is absent.')
  }
  verifyLegacyCredentials(receipt.legacy_credentials)
  if (
    !Array.isArray(receipt.leases)
    || receipt.leases.length > MAX_CUMULATIVE_LEASES
    || receipt.sequence !== receipt.leases.length
    || receipt.leases.length !== priorRuns.length
  ) {
    throw new Error('Signed cleanup receipt does not cover every prior leased deployment run.')
  }
  const receiptRunIds = new Set(receipt.leases.map((entry) => entry?.run_id))
  if (receiptRunIds.size !== priorRuns.length) {
    throw new Error('Signed cleanup receipt repeats or omits a prior leased deployment run.')
  }
  let latestClosure = 0
  for (const run of priorRuns) {
    const entry = receipt.leases.find((candidate) => candidate?.run_id === run.runId)
    if (!entry) throw new Error('Signed cleanup receipt omits a prior leased deployment run.')
    latestClosure = Math.max(latestClosure, verifyLeaseEntry(entry, run, nowTimestamp))
  }
  const issuedAt = parseTimestamp(receipt.issued_at, 'Signed cleanup receipt issued_at')
  if (issuedAt < latestClosure || issuedAt > nowTimestamp + FUTURE_TOLERANCE_MS) {
    throw new Error('Signed cleanup receipt issue time is inconsistent with its lease closures.')
  }

  return Object.freeze({
    environment: deployEnvironment,
    coveredRunCount: priorRuns.length,
    receiptHash: signed.envelopeHash,
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

export async function fetchAndVerifyEphemeralCleanupReceipt(environment = process.env, {
  fetchImpl = fetch,
  publicKey,
  now = Date.now(),
} = {}) {
  const token = environment.GITHUB_TOKEN?.trim()
  const repository = environment.GITHUB_REPOSITORY?.trim()
  const deployEnvironment = environment.DEPLOY_ENVIRONMENT?.trim()
  const contract = WORKFLOW_CONTRACTS[deployEnvironment]
  if (!token || token.length < 20 || repository !== TRUSTED_REPOSITORY || !contract) {
    throw new Error('GitHub cleanup receipt verification inputs are missing or untrusted.')
  }
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
  assertCurrentRunAnchor(
    allRuns,
    contract,
    repository,
    environment.GITHUB_RUN_ID?.trim() || '',
    environment.DEPLOY_LEASE_ID?.trim() || '',
  )
  const candidateRuns = allRuns.filter((run) => (
    parseTrustedRun(run, contract, repository, environment.GITHUB_RUN_ID?.trim() || '') !== null
  ))
  const evidencedRuns = []
  for (let offset = 0; offset < candidateRuns.length; offset += 8) {
    const batch = await Promise.all(candidateRuns.slice(offset, offset + 8).map((run) => (
      attachLeaseGateEvidence(run, contract, repository, token, fetchImpl)
    )))
    evidencedRuns.push(...batch)
    if (evidencedRuns.filter((run) => run.credential_lease_gate_succeeded === true).length > MAX_CUMULATIVE_LEASES) {
      throw new Error('GitHub leased deployment history exceeds the reviewed receipt epoch.')
    }
  }
  return verifyEphemeralCleanupReceipt(evidencedRuns, environment, { now, publicKey })
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
