import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import {
  attestationEnvelopeHash,
  exactKeys,
  verifySignedAttestation,
} from './ephemeral-release-attestation.mjs'
import { STAGING_CREDENTIAL_INJECTION_PROBE_WORKFLOW } from './ephemeral-release-supervisor-core.mjs'
import { verifyEphemeralLeaseGrant } from './verify-ephemeral-lease-grant.mjs'

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const PROBE_ID_PATTERN = /^[0-9a-f]{32}$/
const HASH_PATTERN = /^[0-9a-f]{64}$/
const FUTURE_TOLERANCE_MS = 60 * 1000
const MAX_PROBE_LIFETIME_MS = 15 * 60 * 1000

function timestamp(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} is missing.`)
  const result = Date.parse(value)
  if (!Number.isFinite(result)) throw new Error(`${label} is invalid.`)
  return result
}

function requiredSecret(environment, name) {
  const value = environment[name]?.trim()
  if (!value || value.length < 20 || /[\r\n\0]/.test(value)) {
    throw new Error(`${name} is missing or malformed.`)
  }
  return value
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function verifyCredentialHashes(environment, expectedSupabaseHash, expectedPagesHash) {
  const supabaseSecret = requiredSecret(environment, 'SUPABASE_ACCESS_TOKEN')
  const pagesSecret = requiredSecret(environment, 'PAGES_EPHEMERAL_TOKEN')
  if (
    !HASH_PATTERN.test(expectedSupabaseHash)
    || !HASH_PATTERN.test(expectedPagesHash)
    || sha256(supabaseSecret) !== expectedSupabaseHash
    || sha256(pagesSecret) !== expectedPagesHash
  ) {
    throw new Error('Ephemeral environment-secret injection does not match its signed binding.')
  }
}

export function verifyLeaseCredentialInjection(environment, publicKey, { now = Date.now() } = {}) {
  const grant = verifyEphemeralLeaseGrant(environment, publicKey, { now })
  verifyCredentialHashes(
    environment,
    grant.supabasePatSha256,
    grant.cloudflareTokenSha256[0],
  )
  return Object.freeze({
    environment: grant.environment,
    commitSha: grant.commitSha,
    leaseId: grant.leaseId,
  })
}

export function verifyCredentialInjectionProbe(environment, publicKey, { now = Date.now() } = {}) {
  const deployEnvironment = environment.DEPLOY_ENVIRONMENT?.trim()
  const commitSha = environment.DEPLOY_COMMIT_SHA?.trim()
  const probeId = environment.DEPLOY_PROBE_ID?.trim()
  const receipt = environment.EPHEMERAL_CLEANUP_RECEIPT?.trim()
  const grant = verifySignedAttestation(
    environment.EPHEMERAL_CREDENTIAL_PROBE_GRANT?.trim() || '',
    publicKey,
    'credential_injection_probe',
  )
  const payload = grant.payload
  exactKeys(payload, [
    'version',
    'kind',
    'environment',
    'probe_workflow',
    'target_workflow',
    'commit_sha',
    'probe_id',
    'issued_at',
    'expires_at',
    'cleanup_receipt_sha256',
    'supabase_secret_sha256',
    'pages_secret_sha256',
    'supervisor_key_id',
  ], 'Credential-injection probe')
  if (
    deployEnvironment !== 'staging'
    || payload.version !== 1
    || payload.kind !== 'credential_injection_probe'
    || payload.environment !== 'staging'
    || payload.probe_workflow !== STAGING_CREDENTIAL_INJECTION_PROBE_WORKFLOW
    || payload.target_workflow !== 'deploy-staging.yml'
    || payload.commit_sha !== commitSha
    || payload.probe_id !== probeId
    || !FULL_SHA_PATTERN.test(commitSha || '')
    || !PROBE_ID_PATTERN.test(probeId || '')
    || !receipt
    || payload.cleanup_receipt_sha256 !== attestationEnvelopeHash(receipt)
  ) {
    throw new Error('Credential-injection probe does not match the exact Staging request.')
  }
  const issuedAt = timestamp(payload.issued_at, 'Credential-injection probe issued_at')
  const expiresAt = timestamp(payload.expires_at, 'Credential-injection probe expires_at')
  const nowTimestamp = now instanceof Date ? now.getTime() : Number(now)
  if (
    !Number.isFinite(nowTimestamp)
    || issuedAt > nowTimestamp + FUTURE_TOLERANCE_MS
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > MAX_PROBE_LIFETIME_MS
    || nowTimestamp < issuedAt - FUTURE_TOLERANCE_MS
    || nowTimestamp >= expiresAt
  ) {
    throw new Error('Credential-injection probe is outside its approved 15-minute window.')
  }
  verifyCredentialHashes(environment, payload.supabase_secret_sha256, payload.pages_secret_sha256)
  return Object.freeze({ environment: 'staging', commitSha, probeId })
}

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== '--mode' || !['lease', 'probe'].includes(argv[1])) {
    throw new Error('Usage: node scripts/verify-ephemeral-credential-injection.mjs --mode lease|probe')
  }
  return argv[1]
}

async function main() {
  const mode = parseArgs(process.argv.slice(2))
  const publicKey = await readFile('config/ephemeral-release-public-key.pem', 'utf8')
  if (mode === 'lease') {
    verifyLeaseCredentialInjection(process.env, publicKey)
    console.log('Exact ephemeral deployment credentials reached the runner.')
    return
  }
  verifyCredentialInjectionProbe(process.env, publicKey)
  console.log('Exact Staging environment-secret injection was verified.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Ephemeral credential-injection verification failed.')
    process.exitCode = 1
  })
}
