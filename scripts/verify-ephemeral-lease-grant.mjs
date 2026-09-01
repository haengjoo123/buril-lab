import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import {
  attestationEnvelopeHash,
  exactKeys,
  verifySignedAttestation,
} from './ephemeral-release-attestation.mjs'

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const LEASE_PATTERN = /^[0-9a-f]{32}$/
const HASH_PATTERN = /^[0-9a-f]{64}$/
const FUTURE_TOLERANCE_MS = 60 * 1000
const MAX_GRANT_LIFETIME_MS = 45 * 60 * 1000
const MAX_MINIMUM_REMAINING_SECONDS = 30 * 60

const CONTRACTS = Object.freeze({
  staging: Object.freeze({ workflow: 'deploy-staging.yml' }),
  production: Object.freeze({ workflow: 'deploy-production.yml' }),
})

function timestamp(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} is missing.`)
  const result = Date.parse(value)
  if (!Number.isFinite(result)) throw new Error(`${label} is invalid.`)
  return result
}

export function parseMinimumRemainingSeconds(value) {
  const raw = value === undefined || value === null || value === '' ? '0' : String(value)
  if (!/^(?:0|[1-9][0-9]{0,3})$/.test(raw)) {
    throw new Error('Ephemeral lease minimum remaining seconds must be a canonical non-negative integer.')
  }
  const seconds = Number(raw)
  if (!Number.isSafeInteger(seconds) || seconds > MAX_MINIMUM_REMAINING_SECONDS) {
    throw new Error('Ephemeral lease minimum remaining seconds must not exceed 1800.')
  }
  return seconds
}

function parseArgs(argv) {
  if (argv.length === 0) return undefined
  if (argv.length !== 2 || argv[0] !== '--minimum-remaining-seconds') {
    throw new Error('Usage: node scripts/verify-ephemeral-lease-grant.mjs [--minimum-remaining-seconds <0-1800>]')
  }
  return parseMinimumRemainingSeconds(argv[1])
}

export function verifyEphemeralLeaseGrant(environment, publicKey, {
  now = Date.now(),
  minimumRemainingSeconds,
} = {}) {
  const deployEnvironment = environment.DEPLOY_ENVIRONMENT?.trim()
  const contract = CONTRACTS[deployEnvironment]
  if (!contract) throw new Error('Ephemeral lease environment must be staging or production.')
  const rawGrant = environment.EPHEMERAL_LEASE_GRANT?.trim()
  const rawReceipt = environment.EPHEMERAL_CLEANUP_RECEIPT?.trim()
  const grant = verifySignedAttestation(rawGrant || '', publicKey, 'lease_grant')
  const payload = grant.payload
  exactKeys(payload, [
    'version',
    'kind',
    'environment',
    'workflow',
    'commit_sha',
    'lease_id',
    'storage_backup',
    'issued_at',
    'expires_at',
    'cleanup_receipt_sha256',
    'cloudflare_token_id_hashes',
    'cloudflare_token_sha256',
    'supabase_pat_label_hash',
    'supabase_pat_sha256',
    'staging_run_id',
    'staging_cleanup_receipt_sha256',
    'supervisor_key_id',
  ], 'Ephemeral lease grant')

  const commitSha = environment.DEPLOY_COMMIT_SHA?.trim()
  const leaseId = environment.DEPLOY_LEASE_ID?.trim()
  const storageBackup = environment.DEPLOY_STORAGE_BACKUP === 'true'
  if (
    payload.version !== 1
    || payload.environment !== deployEnvironment
    || payload.workflow !== contract.workflow
    || payload.commit_sha !== commitSha
    || payload.lease_id !== leaseId
    || payload.storage_backup !== storageBackup
    || !FULL_SHA_PATTERN.test(payload.commit_sha)
    || !LEASE_PATTERN.test(payload.lease_id)
  ) {
    throw new Error('Ephemeral lease grant does not match the exact deployment request.')
  }
  if (!rawReceipt || payload.cleanup_receipt_sha256 !== attestationEnvelopeHash(rawReceipt)) {
    throw new Error('Ephemeral lease grant is not bound to the current cleanup receipt.')
  }
  if (deployEnvironment === 'staging') {
    if (payload.staging_run_id !== null || payload.staging_cleanup_receipt_sha256 !== null) {
      throw new Error('Staging lease grants must not carry Production Staging evidence.')
    }
  } else {
    const expectedStagingRunId = environment.DEPLOY_STAGING_RUN_ID?.trim()
    const stagingReceipt = environment.STAGING_EPHEMERAL_CLEANUP_RECEIPT?.trim()
    if (
      !/^\d+$/.test(payload.staging_run_id || '')
      || payload.staging_run_id !== expectedStagingRunId
      || !HASH_PATTERN.test(payload.staging_cleanup_receipt_sha256 || '')
      || !stagingReceipt
      || payload.staging_cleanup_receipt_sha256 !== attestationEnvelopeHash(stagingReceipt)
    ) {
      throw new Error('Production lease grant is not bound to the exact cleaned Staging run.')
    }
  }

  const nowTimestamp = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(nowTimestamp)) throw new Error('Ephemeral lease verification time is invalid.')
  const minimumRemaining = minimumRemainingSeconds === undefined
    ? parseMinimumRemainingSeconds(environment.EPHEMERAL_LEASE_MIN_REMAINING_SECONDS?.trim())
    : parseMinimumRemainingSeconds(minimumRemainingSeconds)
  const issuedAt = timestamp(payload.issued_at, 'Ephemeral lease issued_at')
  const expiresAt = timestamp(payload.expires_at, 'Ephemeral lease expires_at')
  if (
    issuedAt > nowTimestamp + FUTURE_TOLERANCE_MS
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > MAX_GRANT_LIFETIME_MS
    || nowTimestamp < issuedAt - FUTURE_TOLERANCE_MS
    || nowTimestamp >= expiresAt
  ) {
    throw new Error('Ephemeral lease grant is outside its approved 45-minute window.')
  }
  if (expiresAt - nowTimestamp < minimumRemaining * 1000) {
    throw new Error(`Ephemeral lease grant has less than the required ${minimumRemaining}-second mutation window.`)
  }

  const expectedCloudflareHashes = storageBackup ? 2 : 1
  if (
    !Array.isArray(payload.cloudflare_token_id_hashes)
    || payload.cloudflare_token_id_hashes.length !== expectedCloudflareHashes
    || new Set(payload.cloudflare_token_id_hashes).size !== expectedCloudflareHashes
    || payload.cloudflare_token_id_hashes.some((hash) => !HASH_PATTERN.test(hash))
    || !Array.isArray(payload.cloudflare_token_sha256)
    || payload.cloudflare_token_sha256.length !== expectedCloudflareHashes
    || new Set(payload.cloudflare_token_sha256).size !== expectedCloudflareHashes
    || payload.cloudflare_token_sha256.some((hash) => !HASH_PATTERN.test(hash))
    || !HASH_PATTERN.test(payload.supabase_pat_label_hash)
    || !HASH_PATTERN.test(payload.supabase_pat_sha256)
  ) {
    throw new Error('Ephemeral lease grant credential identifiers are incomplete.')
  }

  return Object.freeze({
    environment: deployEnvironment,
    commitSha: payload.commit_sha,
    leaseId: payload.lease_id,
    storageBackup,
    expiresAt,
    minimumRemainingSeconds: minimumRemaining,
    cloudflareTokenIdHashes: Object.freeze([...payload.cloudflare_token_id_hashes]),
    cloudflareTokenSha256: Object.freeze([...payload.cloudflare_token_sha256]),
    supabasePatLabelHash: payload.supabase_pat_label_hash,
    supabasePatSha256: payload.supabase_pat_sha256,
    stagingRunId: payload.staging_run_id,
    stagingCleanupReceiptSha256: payload.staging_cleanup_receipt_sha256,
    grantHash: grant.envelopeHash,
  })
}

async function main() {
  const publicKey = await readFile('config/ephemeral-release-public-key.pem', 'utf8')
  const minimumRemainingSeconds = parseArgs(process.argv.slice(2))
  const result = verifyEphemeralLeaseGrant(process.env, publicKey, { minimumRemainingSeconds })
  console.log(`Signed ephemeral lease is valid for ${result.environment} and ${result.commitSha}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Ephemeral lease verification failed.')
    process.exitCode = 1
  })
}
