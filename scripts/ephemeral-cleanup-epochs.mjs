import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  exactKeys, MAX_ATTESTATION_ENVELOPE_BYTES, publicKeyFingerprint,
  signAttestation, verifySignedAttestation,
} from './ephemeral-release-attestation.mjs'

// A GitHub variable still contains no more than 32 closures. Older, complete
// signed envelopes are content-addressed review artifacts, not discarded runs.
export const MAX_CUMULATIVE_LEASES = 32
export const MAX_ARCHIVED_CLEANUP_EPOCHS = 16
export const CLEANUP_ABSENT_SECRET_NAMES = Object.freeze([
  'CLOUDFLARE_API_TOKEN',
  'EPHEMERAL_CREDENTIAL_SESSION',
  'PRODUCTION_CLOUDFLARE_API_TOKEN',
  'PRODUCTION_PAGES_EPHEMERAL_TOKEN',
  'PRODUCTION_WORKER_EPHEMERAL_TOKEN',
  'STAGING_CLOUDFLARE_API_TOKEN',
  'STAGING_PAGES_EPHEMERAL_TOKEN',
  'STAGING_WORKER_EPHEMERAL_TOKEN',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_HOSTED_ADVISOR_EPHEMERAL_TOKEN',
])
const HASH = /^[0-9a-f]{64}$/
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000
const ARCHIVE_ROOT = fileURLToPath(new URL('../config/ephemeral-cleanup-epochs/', import.meta.url))
const RECEIPT_FIELDS = Object.freeze([
  'version', 'kind', 'environment', 'workflow', 'issued_at', 'sequence',
  'legacy_verification_mode', 'github_secrets_absent', 'legacy_credentials',
  'leases', 'supervisor_key_id',
])
const LEASE_FIELDS = Object.freeze([
  'run_id', 'run_attempt', 'commit_sha', 'lease_id', 'storage_backup', 'closed_at',
  'previous_cleanup_receipt_sha256', 'cloudflare_token_id_hashes',
  'supabase_pat_label_hash', 'supabase_pat_sha256', 'providers_inactive',
])

export function cleanupReceiptFieldNames(payload) {
  return payload?.version === 4
    ? [...RECEIPT_FIELDS, 'epoch', 'previous_epoch_receipt_sha256']
    : [...RECEIPT_FIELDS]
}

export function cleanupEpochArchivePath(environment, hash) {
  if (!['staging', 'production'].includes(environment) || !HASH.test(hash || '')) {
    throw new Error('Cleanup epoch archive identity is malformed.')
  }
  return `config/ephemeral-cleanup-epochs/${environment}/${hash}.json`
}

export function readCleanupEpochArchive(environment, hash) {
  cleanupEpochArchivePath(environment, hash)
  const directory = path.join(ARCHIVE_ROOT, environment)
  const file = path.join(directory, `${hash}.json`)
  try {
    for (const ancestor of [path.dirname(ARCHIVE_ROOT), ARCHIVE_ROOT, directory]) {
      if (!lstatSync(ancestor).isDirectory()) throw new Error('not a regular directory')
    }
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_ATTESTATION_ENVELOPE_BYTES + 2) {
      throw new Error('not a bounded regular file')
    }
    // Git text files have a single final newline; the attestation itself has none.
    return readFileSync(file, 'utf8').replace(/\r?\n$/, '')
  } catch {
    throw new Error('A required signed cleanup epoch archive is missing or unsafe.')
  }
}

function verifyLegacyCredentials(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Signed cleanup receipt must include the initial legacy credential closure.')
  }
  const identities = new Set()
  for (const entry of entries) {
    exactKeys(entry, ['provider', 'credential_id_hash', 'status'], 'Legacy credential closure')
    const identity = `${entry.provider}:${entry.credential_id_hash}`
    if (!['cloudflare', 'supabase'].includes(entry.provider) || !HASH.test(entry.credential_id_hash)
      || entry.status !== 'operator_verified_absent' || identities.has(identity)) {
      throw new Error('Signed cleanup receipt has invalid or repeated legacy credential closure evidence.')
    }
    identities.add(identity)
  }
  if (!entries.some((entry) => entry.provider === 'supabase') || !entries.some((entry) => entry.provider === 'cloudflare')) {
    throw new Error('Signed cleanup receipt must close both legacy Supabase and Cloudflare credentials.')
  }
}

export function verifyCleanupReceiptShape(payload, environment, now = Date.now()) {
  exactKeys(payload, cleanupReceiptFieldNames(payload), 'Signed cleanup receipt')
  const nowTimestamp = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(nowTimestamp)) throw new Error('Cleanup receipt verification time is invalid.')
  if (![3, 4].includes(payload.version) || !['staging', 'production'].includes(environment)
    || payload.environment !== environment || payload.workflow !== `deploy-${environment}.yml`
    || payload.kind !== 'cleanup_receipt' || payload.legacy_verification_mode !== 'operator_dashboard_attestation') {
    throw new Error('Signed cleanup receipt belongs to a different deployment environment.')
  }
  if (payload.version === 4 && (!Number.isSafeInteger(payload.epoch) || payload.epoch < 1
    || payload.epoch > MAX_ARCHIVED_CLEANUP_EPOCHS || !HASH.test(payload.previous_epoch_receipt_sha256))) {
    throw new Error('Signed cleanup receipt epoch link is invalid.')
  }
  if (!Array.isArray(payload.github_secrets_absent)
    || JSON.stringify([...payload.github_secrets_absent].sort()) !== JSON.stringify([...CLEANUP_ABSENT_SECRET_NAMES].sort())) {
    throw new Error('Signed cleanup receipt does not attest every legacy and ephemeral GitHub secret is absent.')
  }
  verifyLegacyCredentials(payload.legacy_credentials)
  if (!Array.isArray(payload.leases) || payload.leases.length > MAX_CUMULATIVE_LEASES
    || payload.sequence !== payload.leases.length) {
    throw new Error('Signed cleanup receipt has an invalid sequence or lease epoch.')
  }
  const issuedAt = Date.parse(payload.issued_at)
  if (typeof payload.issued_at !== 'string' || !Number.isFinite(issuedAt) || issuedAt > nowTimestamp + FUTURE_TOLERANCE_MS) {
    throw new Error('Signed cleanup receipt issue time is inconsistent.')
  }
  for (const entry of payload.leases) {
    exactKeys(entry, LEASE_FIELDS, 'Cleanup lease entry')
    const closedAt = Date.parse(entry.closed_at)
    const tokens = entry.storage_backup ? 2 : 1
    if (typeof entry.run_id !== 'string' || !/^[1-9][0-9]*$/.test(entry.run_id) || !Number.isSafeInteger(Number(entry.run_id))
      || !Number.isSafeInteger(entry.run_attempt) || entry.run_attempt <= 0
      || !/^[0-9a-f]{40}$/.test(entry.commit_sha) || !/^[0-9a-f]{32}$/.test(entry.lease_id)
      || typeof entry.storage_backup !== 'boolean' || entry.providers_inactive !== true
      || !HASH.test(entry.previous_cleanup_receipt_sha256) || !HASH.test(entry.supabase_pat_label_hash)
      || !HASH.test(entry.supabase_pat_sha256) || !Array.isArray(entry.cloudflare_token_id_hashes)
      || entry.cloudflare_token_id_hashes.length !== tokens || new Set(entry.cloudflare_token_id_hashes).size !== tokens
      || entry.cloudflare_token_id_hashes.some((hash) => !HASH.test(hash))
      || typeof entry.closed_at !== 'string' || !Number.isFinite(closedAt) || closedAt > issuedAt) {
      throw new Error('Signed cleanup receipt credential revocation or closure evidence is incomplete.')
    }
  }
  return payload
}

export function verifyCleanupReceiptChain(rawReceipt, publicKey, {
  environment, now = Date.now(), readArchive = readCleanupEpochArchive,
} = {}) {
  const current = verifySignedAttestation(rawReceipt, publicKey, 'cleanup_receipt')
  verifyCleanupReceiptShape(current.payload, environment, now)
  const receipts = [current]
  const seenHashes = new Set([current.envelopeHash])
  let child = current
  while (child.payload.version === 4) {
    const hash = child.payload.previous_epoch_receipt_sha256
    if (seenHashes.has(hash) || receipts.length > MAX_ARCHIVED_CLEANUP_EPOCHS) {
      throw new Error('Signed cleanup epoch chain is cyclic or exceeds the reviewed archive bound.')
    }
    const archived = verifySignedAttestation(readArchive(environment, hash), publicKey, 'cleanup_receipt')
    verifyCleanupReceiptShape(archived.payload, environment, now)
    const archivedEpoch = archived.payload.version === 3 ? 0 : archived.payload.epoch
    if (archived.envelopeHash !== hash || archivedEpoch !== child.payload.epoch - 1
      || archived.payload.leases.length !== MAX_CUMULATIVE_LEASES
      || Date.parse(archived.payload.issued_at) > Date.parse(child.payload.issued_at)
      || child.payload.leases.some((entry) => Date.parse(entry.closed_at) < Date.parse(archived.payload.issued_at))
      || JSON.stringify(archived.payload.legacy_credentials) !== JSON.stringify(current.payload.legacy_credentials)) {
      throw new Error('Signed cleanup epoch archive link, completeness, time or legacy closure does not match.')
    }
    seenHashes.add(hash)
    receipts.push(archived)
    child = archived
  }
  receipts.reverse()
  const leases = receipts.flatMap((receipt) => receipt.payload.leases)
  if (new Set(leases.map((entry) => entry.run_id)).size !== leases.length
    || new Set(leases.map((entry) => entry.lease_id)).size !== leases.length) {
    throw new Error('Signed cleanup receipt repeats a run or lease across epochs.')
  }
  return Object.freeze({
    payload: current.payload, receiptHash: current.envelopeHash,
    epoch: current.payload.version === 3 ? 0 : current.payload.epoch,
    archivedEpochCount: receipts.length - 1,
    receipts: Object.freeze(receipts), leases: Object.freeze(leases),
  })
}

export function createCleanupEpochSuccessor({
  previousReceipt, environment, publicKey, privateKey, now = Date.now(), readArchive = readCleanupEpochArchive,
}) {
  const previous = verifyCleanupReceiptChain(previousReceipt, publicKey, { environment, now, readArchive })
  const nowTimestamp = now instanceof Date ? now.getTime() : Number(now)
  if (previous.payload.sequence !== MAX_CUMULATIVE_LEASES || previous.epoch >= MAX_ARCHIVED_CLEANUP_EPOCHS
    || !Number.isFinite(nowTimestamp) || nowTimestamp < Date.parse(previous.payload.issued_at)) {
    throw new Error('Only a complete, reviewed 32-lease epoch can roll over at a valid time.')
  }
  const successor = signAttestation({
    ...previous.payload,
    version: 4,
    epoch: previous.epoch + 1,
    previous_epoch_receipt_sha256: previous.receiptHash,
    issued_at: new Date(nowTimestamp).toISOString(),
    sequence: 0,
    leases: [],
    supervisor_key_id: publicKeyFingerprint(privateKey),
  }, privateKey)
  // This also requires the exact old envelope to exist in the reviewed archive.
  const verified = verifyCleanupReceiptChain(successor, publicKey, { environment, now, readArchive })
  if (JSON.stringify(verified.leases) !== JSON.stringify(previous.leases)) {
    throw new Error('Cleanup epoch rollover did not preserve every prior closure.')
  }
  return successor
}
