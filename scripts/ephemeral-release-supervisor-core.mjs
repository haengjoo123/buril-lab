import { createHash } from 'node:crypto'
import {
  attestationEnvelopeHash,
  exactKeys,
  publicKeyFingerprint,
  signAttestation,
  verifySignedAttestation,
} from './ephemeral-release-attestation.mjs'
import {
  CLEANUP_ABSENT_SECRET_NAMES,
  MAX_CUMULATIVE_LEASES,
} from './verify-ephemeral-cleanup-receipt.mjs'

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/
const LEASE_PATTERN = /^[0-9a-f]{32}$/
const PROBE_ID_PATTERN = /^[0-9a-f]{32}$/
const HASH_PATTERN = /^[0-9a-f]{64}$/
const MAX_SESSION_MS = 45 * 60 * 1000
const MAX_CREDENTIAL_INJECTION_PROBE_MS = 15 * 60 * 1000
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000
const JOURNAL_PHASES = Object.freeze([
  'provider_creation_pending',
  'lease_materialized',
  'dispatch_intent',
  'run_bound',
  'gates_verified',
  'cleanup_receipt_stored',
])
const JOURNAL_PHASE_INDEX = new Map(JOURNAL_PHASES.map((phase, index) => [phase, index]))

const CONTRACTS = Object.freeze({
  staging: Object.freeze({ workflow: 'deploy-staging.yml' }),
  production: Object.freeze({ workflow: 'deploy-production.yml' }),
})

export const STAGING_CREDENTIAL_INJECTION_PROBE_WORKFLOW = 'verify-staging-ephemeral-credentials.yml'

function iso(value) {
  const timestamp = value instanceof Date ? value.getTime() : Number(value)
  if (!Number.isFinite(timestamp)) throw new Error('Supervisor timestamp is invalid.')
  return new Date(timestamp).toISOString()
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function workflowContract(environment) {
  const contract = CONTRACTS[environment]
  if (!contract) throw new Error('Supervisor environment must be staging or production.')
  return contract
}

export function createInitialCleanupReceipt({
  environment,
  legacyCredentials,
  privateKey,
  now = Date.now(),
}) {
  const contract = workflowContract(environment)
  if (!Array.isArray(legacyCredentials) || legacyCredentials.length === 0) {
    throw new Error('Initial cleanup requires verified legacy provider credentials.')
  }
  const normalized = legacyCredentials.map((entry) => {
    if (!['cloudflare', 'supabase'].includes(entry?.provider) || !HASH_PATTERN.test(entry?.credentialIdHash)) {
      throw new Error('Initial cleanup legacy credential evidence is invalid.')
    }
    return Object.freeze({
      provider: entry.provider,
      credential_id_hash: entry.credentialIdHash,
      status: 'operator_verified_absent',
    })
  })
  if (!normalized.some((entry) => entry.provider === 'cloudflare')
      || !normalized.some((entry) => entry.provider === 'supabase')) {
    throw new Error('Initial cleanup must close both Cloudflare and Supabase legacy credentials.')
  }
  const keyId = publicKeyFingerprint(privateKey)
  return signAttestation({
    version: 3,
    kind: 'cleanup_receipt',
    environment,
    workflow: contract.workflow,
    issued_at: iso(now),
    sequence: 0,
    legacy_verification_mode: 'operator_dashboard_attestation',
    github_secrets_absent: [...CLEANUP_ABSENT_SECRET_NAMES],
    legacy_credentials: normalized,
    leases: [],
    supervisor_key_id: keyId,
  }, privateKey)
}

export function refreshCleanupReceiptSecretContract({
  previousReceipt,
  environment,
  publicKey,
  privateKey,
  now = Date.now(),
}) {
  const contract = workflowContract(environment)
  const signed = verifySignedAttestation(previousReceipt, publicKey, 'cleanup_receipt')
  const previous = signed.payload
  exactKeys(previous, [
    'version', 'kind', 'environment', 'workflow', 'issued_at', 'sequence', 'legacy_verification_mode',
    'github_secrets_absent', 'legacy_credentials', 'leases', 'supervisor_key_id',
  ], 'Cleanup receipt contract refresh')
  if (
    previous.version !== 3
    || previous.environment !== environment
    || previous.workflow !== contract.workflow
    || previous.legacy_verification_mode !== 'operator_dashboard_attestation'
    || !Array.isArray(previous.leases)
    || previous.sequence !== previous.leases.length
    || previous.leases.length > MAX_CUMULATIVE_LEASES
    || previous.supervisor_key_id !== publicKeyFingerprint(publicKey)
  ) {
    throw new Error('Previous cleanup receipt cannot be refreshed for this environment.')
  }

  const previousNames = previous.github_secrets_absent
  if (
    !Array.isArray(previousNames)
    || previousNames.length === 0
    || new Set(previousNames).size !== previousNames.length
    || previousNames.some((name) => (
      typeof name !== 'string' || !CLEANUP_ABSENT_SECRET_NAMES.includes(name)
    ))
  ) {
    throw new Error('Previous cleanup receipt secret contract is not an additive predecessor.')
  }
  if (previousNames.length === CLEANUP_ABSENT_SECRET_NAMES.length) {
    throw new Error('Cleanup receipt already uses the current secret contract.')
  }

  const refreshedAt = now instanceof Date ? now.getTime() : Number(now)
  const previousIssuedAt = Date.parse(previous.issued_at)
  if (
    !Number.isFinite(refreshedAt)
    || !Number.isFinite(previousIssuedAt)
    || refreshedAt < previousIssuedAt
  ) {
    throw new Error('Cleanup receipt refresh time is invalid.')
  }

  return signAttestation({
    ...previous,
    issued_at: iso(refreshedAt),
    github_secrets_absent: [...CLEANUP_ABSENT_SECRET_NAMES],
    supervisor_key_id: publicKeyFingerprint(privateKey),
  }, privateKey)
}

export function createLeaseMaterial({
  environment,
  commitSha,
  leaseId,
  storageBackup,
  cleanupReceipt,
  cloudflareTokenIdHashes,
  cloudflareTokens,
  supabasePatLabel,
  supabasePat,
  stagingRunId = null,
  stagingCleanupReceipt = null,
  privateKey,
  now = Date.now(),
  lifetimeMs = 40 * 60 * 1000,
}) {
  const contract = workflowContract(environment)
  if (!FULL_SHA_PATTERN.test(commitSha) || !LEASE_PATTERN.test(leaseId)) {
    throw new Error('Lease material commit or lease identifier is malformed.')
  }
  if (typeof storageBackup !== 'boolean') {
    throw new Error('Lease material storage-backup scope is invalid.')
  }
  const expectedTokens = storageBackup ? 2 : 1
  if (
    !Array.isArray(cloudflareTokenIdHashes)
    || cloudflareTokenIdHashes.length !== expectedTokens
    || new Set(cloudflareTokenIdHashes).size !== expectedTokens
    || cloudflareTokenIdHashes.some((hash) => !HASH_PATTERN.test(hash))
    || !Array.isArray(cloudflareTokens)
    || cloudflareTokens.length !== expectedTokens
    || new Set(cloudflareTokens).size !== expectedTokens
    || cloudflareTokens.some((token) => typeof token !== 'string' || token.length < 20 || /[\r\n\0]/.test(token))
  ) {
    throw new Error('Lease material Cloudflare token identifiers are invalid.')
  }
  if (typeof supabasePatLabel !== 'string' || supabasePatLabel.length < 8 || supabasePatLabel.length > 128) {
    throw new Error('Lease material Supabase PAT label is invalid.')
  }
  if (typeof supabasePat !== 'string' || supabasePat.length < 20 || /[\r\n\0]/.test(supabasePat)) {
    throw new Error('Lease material Supabase PAT is invalid.')
  }
  if (environment === 'staging' && (stagingRunId !== null || stagingCleanupReceipt !== null)) {
    throw new Error('Staging lease material must not carry Production Staging evidence.')
  }
  if (
    environment === 'production'
    && (!/^\d+$/.test(stagingRunId || '') || typeof stagingCleanupReceipt !== 'string')
  ) {
    throw new Error('Production lease material requires an exact cleaned Staging run.')
  }
  if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0 || lifetimeMs > MAX_SESSION_MS) {
    throw new Error('Lease material lifetime must be at most 45 minutes.')
  }
  const issuedAt = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(issuedAt)) throw new Error('Lease material issue time is invalid.')
  const expiresAt = issuedAt + lifetimeMs
  const keyId = publicKeyFingerprint(privateKey)
  const supabasePatLabelHash = sha256(supabasePatLabel)
  const supabasePatSha256 = sha256(supabasePat)
  const cloudflareTokenSha256 = cloudflareTokens.map((token) => sha256(token))
  const grant = signAttestation({
    version: 1,
    kind: 'lease_grant',
    environment,
    workflow: contract.workflow,
    commit_sha: commitSha,
    lease_id: leaseId,
    storage_backup: storageBackup,
    issued_at: iso(issuedAt),
    expires_at: iso(expiresAt),
    cleanup_receipt_sha256: attestationEnvelopeHash(cleanupReceipt),
    cloudflare_token_id_hashes: cloudflareTokenIdHashes,
    cloudflare_token_sha256: cloudflareTokenSha256,
    supabase_pat_label_hash: supabasePatLabelHash,
    supabase_pat_sha256: supabasePatSha256,
    staging_run_id: stagingRunId,
    staging_cleanup_receipt_sha256: stagingCleanupReceipt === null
      ? null
      : attestationEnvelopeHash(stagingCleanupReceipt),
    supervisor_key_id: keyId,
  }, privateKey)
  return Object.freeze({
    grant,
    expiresAt,
    cloudflareTokenIdHashes: Object.freeze(cloudflareTokenIdHashes),
    cloudflareTokenSha256: Object.freeze(cloudflareTokenSha256),
    supabasePatLabelHash,
    supabasePatSha256,
  })
}

export function createCredentialInjectionProbe({
  environment,
  commitSha,
  probeId,
  cleanupReceipt,
  supabaseProbeSecret,
  pagesProbeSecret,
  privateKey,
  now = Date.now(),
  lifetimeMs = 10 * 60 * 1000,
}) {
  const contract = workflowContract(environment)
  if (
    environment !== 'staging'
    || !FULL_SHA_PATTERN.test(commitSha)
    || !PROBE_ID_PATTERN.test(probeId)
    || typeof cleanupReceipt !== 'string'
    || typeof supabaseProbeSecret !== 'string'
    || typeof pagesProbeSecret !== 'string'
    || supabaseProbeSecret.length < 20
    || pagesProbeSecret.length < 20
    || /[\r\n\0]/.test(supabaseProbeSecret)
    || /[\r\n\0]/.test(pagesProbeSecret)
    || supabaseProbeSecret === pagesProbeSecret
  ) {
    throw new Error('Credential-injection probe material is invalid.')
  }
  if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0 || lifetimeMs > MAX_CREDENTIAL_INJECTION_PROBE_MS) {
    throw new Error('Credential-injection probe lifetime must be at most 15 minutes.')
  }
  const receipt = verifySignedAttestation(cleanupReceipt, privateKey, 'cleanup_receipt').payload
  if (
    receipt.version !== 3
    || receipt.environment !== environment
    || receipt.workflow !== contract.workflow
    || !Array.isArray(receipt.leases)
    || receipt.sequence !== receipt.leases.length
  ) {
    throw new Error('Credential-injection probe requires the current signed cleanup receipt.')
  }
  const issuedAt = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(issuedAt)) throw new Error('Credential-injection probe issue time is invalid.')
  const expiresAt = issuedAt + lifetimeMs
  const grant = signAttestation({
    version: 1,
    kind: 'credential_injection_probe',
    environment,
    probe_workflow: STAGING_CREDENTIAL_INJECTION_PROBE_WORKFLOW,
    target_workflow: contract.workflow,
    commit_sha: commitSha,
    probe_id: probeId,
    issued_at: iso(issuedAt),
    expires_at: iso(expiresAt),
    cleanup_receipt_sha256: attestationEnvelopeHash(cleanupReceipt),
    supabase_secret_sha256: sha256(supabaseProbeSecret),
    pages_secret_sha256: sha256(pagesProbeSecret),
    supervisor_key_id: publicKeyFingerprint(privateKey),
  }, privateKey)
  return Object.freeze({ grant, expiresAt })
}

export function createProviderCreationPending({
  environment,
  commitSha,
  leaseId,
  storageBackup,
  supabasePatLabel,
  cloudflareAccountId,
  cleanupReceipt,
  privateKey,
  now = Date.now(),
}) {
  const contract = workflowContract(environment)
  if (
    !FULL_SHA_PATTERN.test(commitSha)
    || !LEASE_PATTERN.test(leaseId)
    || typeof storageBackup !== 'boolean'
    || typeof supabasePatLabel !== 'string'
    || supabasePatLabel.length < 8
    || !/^[0-9a-f]{32}$/.test(cloudflareAccountId || '')
    || typeof cleanupReceipt !== 'string'
  ) {
    throw new Error('Provider-creation pending evidence is malformed.')
  }
  const base = verifySignedAttestation(cleanupReceipt, privateKey, 'cleanup_receipt').payload
  if (
    base.version !== 3
    || base.environment !== environment
    || base.workflow !== contract.workflow
    || !Array.isArray(base.leases)
    || base.sequence !== base.leases.length
    || base.leases.length >= MAX_CUMULATIVE_LEASES
  ) {
    throw new Error('Provider-creation journal requires the exact current cleanup receipt.')
  }
  const timestamp = iso(now)
  return signAttestation({
    version: 2,
    kind: 'provider_creation_journal',
    environment,
    workflow: contract.workflow,
    commit_sha: commitSha,
    lease_id: leaseId,
    storage_backup: storageBackup,
    supabase_pat_label: supabasePatLabel,
    cloudflare_account_id: cloudflareAccountId,
    base_cleanup_receipt_sha256: attestationEnvelopeHash(cleanupReceipt),
    base_cleanup_sequence: base.sequence,
    base_cleanup_leases_sha256: sha256(JSON.stringify(base.leases)),
    started_at: timestamp,
    updated_at: timestamp,
    phase: 'provider_creation_pending',
    lease_evidence: null,
    run_evidence: null,
    credential_gates_succeeded: null,
    successor_cleanup_receipt_sha256: null,
    supervisor_key_id: publicKeyFingerprint(privateKey),
  }, privateKey)
}

function verifyJournalLeaseEvidence(value, environment, storageBackup) {
  exactKeys(value, [
    'grant_sha256',
    'cloudflare_token_id_hashes',
    'cloudflare_token_sha256',
    'supabase_pat_label_hash',
    'supabase_pat_sha256',
  ], 'Provider-creation journal lease evidence')
  const expectedCloudflareTokens = storageBackup ? 2 : 1
  if (
    !HASH_PATTERN.test(value.grant_sha256)
    || !Array.isArray(value.cloudflare_token_id_hashes)
    || value.cloudflare_token_id_hashes.length !== expectedCloudflareTokens
    || new Set(value.cloudflare_token_id_hashes).size !== expectedCloudflareTokens
    || value.cloudflare_token_id_hashes.some((hash) => !HASH_PATTERN.test(hash))
    || !Array.isArray(value.cloudflare_token_sha256)
    || value.cloudflare_token_sha256.length !== expectedCloudflareTokens
    || new Set(value.cloudflare_token_sha256).size !== expectedCloudflareTokens
    || value.cloudflare_token_sha256.some((hash) => !HASH_PATTERN.test(hash))
    || !HASH_PATTERN.test(value.supabase_pat_label_hash)
    || !HASH_PATTERN.test(value.supabase_pat_sha256)
  ) {
    throw new Error('Provider-creation journal lease evidence is invalid.')
  }
}

function verifyJournalRunEvidence(value, payload) {
  exactKeys(value, ['run_id', 'run_attempt', 'display_title', 'updated_at'], 'Provider-creation journal run evidence')
  const expectedTitle = payload.environment === 'staging'
    ? `Deploy staging ${payload.commit_sha} (lease=${payload.lease_id}, storage-backup=${payload.storage_backup})`
    : `Deploy production ${payload.commit_sha} (lease=${payload.lease_id}, storage-backup=${payload.storage_backup})`
  if (
    !/^[1-9][0-9]*$/.test(value.run_id)
    || value.run_attempt !== 1
    || value.display_title !== expectedTitle
    || !Number.isFinite(Date.parse(value.updated_at))
  ) {
    throw new Error('Provider-creation journal run evidence is invalid.')
  }
}

export function verifyProviderCreationJournal(rawJournal, publicKey) {
  const signed = verifySignedAttestation(rawJournal, publicKey, 'provider_creation_journal')
  const payload = signed.payload
  exactKeys(payload, [
    'version',
    'kind',
    'environment',
    'workflow',
    'commit_sha',
    'lease_id',
    'storage_backup',
    'supabase_pat_label',
    'cloudflare_account_id',
    'base_cleanup_receipt_sha256',
    'base_cleanup_sequence',
    'base_cleanup_leases_sha256',
    'started_at',
    'updated_at',
    'phase',
    'lease_evidence',
    'run_evidence',
    'credential_gates_succeeded',
    'successor_cleanup_receipt_sha256',
    'supervisor_key_id',
  ], 'Provider-creation phase journal')
  const contract = CONTRACTS[payload.environment]
  const startedAt = Date.parse(payload.started_at)
  const updatedAt = Date.parse(payload.updated_at)
  const phaseIndex = JOURNAL_PHASE_INDEX.get(payload.phase)
  if (
    payload.version !== 2
    || !contract
    || payload.workflow !== contract.workflow
    || !FULL_SHA_PATTERN.test(payload.commit_sha)
    || !LEASE_PATTERN.test(payload.lease_id)
    || typeof payload.storage_backup !== 'boolean'
    || payload.supabase_pat_label !== `burillab-${payload.environment}-${payload.lease_id}`
    || !/^[0-9a-f]{32}$/.test(payload.cloudflare_account_id || '')
    || !HASH_PATTERN.test(payload.base_cleanup_receipt_sha256)
    || !Number.isSafeInteger(payload.base_cleanup_sequence)
    || payload.base_cleanup_sequence < 0
    || payload.base_cleanup_sequence >= MAX_CUMULATIVE_LEASES
    || !HASH_PATTERN.test(payload.base_cleanup_leases_sha256)
    || !Number.isFinite(startedAt)
    || !Number.isFinite(updatedAt)
    || updatedAt < startedAt
    || phaseIndex === undefined
  ) {
    throw new Error('Provider-creation phase journal is invalid.')
  }
  const leaseRequired = phaseIndex >= JOURNAL_PHASE_INDEX.get('lease_materialized')
  const runRequired = phaseIndex >= JOURNAL_PHASE_INDEX.get('run_bound')
  const gatesRequired = phaseIndex >= JOURNAL_PHASE_INDEX.get('gates_verified')
  const successorRequired = phaseIndex >= JOURNAL_PHASE_INDEX.get('cleanup_receipt_stored')
  if ((payload.lease_evidence !== null) !== leaseRequired) {
    throw new Error('Provider-creation journal lease phase is inconsistent.')
  }
  if (leaseRequired) verifyJournalLeaseEvidence(payload.lease_evidence, payload.environment, payload.storage_backup)
  if ((payload.run_evidence !== null) !== runRequired) {
    throw new Error('Provider-creation journal run phase is inconsistent.')
  }
  if (runRequired) verifyJournalRunEvidence(payload.run_evidence, payload)
  if ((typeof payload.credential_gates_succeeded === 'boolean') !== gatesRequired) {
    throw new Error('Provider-creation journal credential-gate phase is inconsistent.')
  }
  if (successorRequired) {
    if (payload.credential_gates_succeeded !== true || !HASH_PATTERN.test(payload.successor_cleanup_receipt_sha256 || '')) {
      throw new Error('Provider-creation journal cleanup phase is inconsistent.')
    }
  } else if (payload.successor_cleanup_receipt_sha256 !== null) {
    throw new Error('Provider-creation journal has a premature cleanup successor.')
  }
  return Object.freeze({ payload, journalHash: signed.envelopeHash })
}

export function verifyProviderCreationLeaseGrant({ journal, leaseGrant, publicKey }) {
  const pending = verifyProviderCreationJournal(journal, publicKey).payload
  const signed = verifySignedAttestation(leaseGrant, publicKey, 'lease_grant')
  const grant = signed.payload
  exactKeys(grant, [
    'version', 'kind', 'environment', 'workflow', 'commit_sha', 'lease_id', 'storage_backup',
    'issued_at', 'expires_at', 'cleanup_receipt_sha256', 'cloudflare_token_id_hashes',
    'cloudflare_token_sha256', 'supabase_pat_label_hash', 'supabase_pat_sha256', 'staging_run_id',
    'staging_cleanup_receipt_sha256', 'supervisor_key_id',
  ], 'Provider-creation lease grant')
  const issuedAt = Date.parse(grant.issued_at)
  const expiresAt = Date.parse(grant.expires_at)
  const expectedCloudflareTokens = pending.storage_backup ? 2 : 1
  if (
    grant.version !== 1
    || grant.environment !== pending.environment
    || grant.workflow !== pending.workflow
    || grant.commit_sha !== pending.commit_sha
    || grant.lease_id !== pending.lease_id
    || grant.storage_backup !== pending.storage_backup
    || grant.cleanup_receipt_sha256 !== pending.base_cleanup_receipt_sha256
    || grant.supabase_pat_label_hash !== sha256(pending.supabase_pat_label)
    || !Number.isFinite(issuedAt)
    || !Number.isFinite(expiresAt)
    || issuedAt < Date.parse(pending.started_at)
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > MAX_SESSION_MS
    || !Array.isArray(grant.cloudflare_token_id_hashes)
    || grant.cloudflare_token_id_hashes.length !== expectedCloudflareTokens
    || new Set(grant.cloudflare_token_id_hashes).size !== expectedCloudflareTokens
    || grant.cloudflare_token_id_hashes.some((hash) => !HASH_PATTERN.test(hash))
    || !Array.isArray(grant.cloudflare_token_sha256)
    || grant.cloudflare_token_sha256.length !== expectedCloudflareTokens
    || new Set(grant.cloudflare_token_sha256).size !== expectedCloudflareTokens
    || grant.cloudflare_token_sha256.some((hash) => !HASH_PATTERN.test(hash))
    || !HASH_PATTERN.test(grant.supabase_pat_label_hash)
    || !HASH_PATTERN.test(grant.supabase_pat_sha256)
    || (pending.environment === 'staging'
      && (grant.staging_run_id !== null || grant.staging_cleanup_receipt_sha256 !== null))
    || (pending.environment === 'production'
      && (!/^[1-9][0-9]*$/.test(grant.staging_run_id || '')
        || !HASH_PATTERN.test(grant.staging_cleanup_receipt_sha256 || '')))
  ) {
    throw new Error('Stored lease grant does not match the exact signed provider-creation journal.')
  }
  if (pending.lease_evidence) {
    if (
      pending.lease_evidence.grant_sha256 !== signed.envelopeHash
      || JSON.stringify(pending.lease_evidence.cloudflare_token_id_hashes)
        !== JSON.stringify(grant.cloudflare_token_id_hashes)
      || JSON.stringify(pending.lease_evidence.cloudflare_token_sha256)
        !== JSON.stringify(grant.cloudflare_token_sha256)
      || pending.lease_evidence.supabase_pat_label_hash !== grant.supabase_pat_label_hash
      || pending.lease_evidence.supabase_pat_sha256 !== grant.supabase_pat_sha256
    ) {
      throw new Error('Stored lease grant conflicts with the journal materialization evidence.')
    }
  }
  return Object.freeze({
    payload: grant,
    grantHash: signed.envelopeHash,
    phaseRollbackDetected: pending.lease_evidence === null,
    leaseEvidence: Object.freeze({
      grant_sha256: signed.envelopeHash,
      cloudflare_token_id_hashes: Object.freeze([...grant.cloudflare_token_id_hashes]),
      cloudflare_token_sha256: Object.freeze([...grant.cloudflare_token_sha256]),
      supabase_pat_label_hash: grant.supabase_pat_label_hash,
      supabase_pat_sha256: grant.supabase_pat_sha256,
    }),
  })
}

export function advanceProviderCreationJournal({
  journal,
  publicKey,
  privateKey,
  nextPhase,
  leaseEvidence,
  runEvidence,
  credentialGatesSucceeded,
  successorCleanupReceipt,
  now = Date.now(),
}) {
  const current = verifyProviderCreationJournal(journal, publicKey).payload
  const currentIndex = JOURNAL_PHASE_INDEX.get(current.phase)
  const nextIndex = JOURNAL_PHASE_INDEX.get(nextPhase)
  if (nextIndex === undefined || nextIndex !== currentIndex + 1) {
    throw new Error('Provider-creation journal phase transition is not sequential.')
  }
  const nextUpdatedAt = iso(now)
  if (Date.parse(nextUpdatedAt) < Date.parse(current.updated_at)) {
    throw new Error('Provider-creation journal time must not move backwards.')
  }
  const next = {
    ...current,
    phase: nextPhase,
    updated_at: nextUpdatedAt,
    supervisor_key_id: publicKeyFingerprint(privateKey),
  }
  if (nextPhase === 'lease_materialized') {
    next.lease_evidence = leaseEvidence
  } else if (nextPhase === 'run_bound') {
    next.run_evidence = runEvidence
  } else if (nextPhase === 'gates_verified') {
    if (
      runEvidence?.run_id !== current.run_evidence?.run_id
      || runEvidence?.run_attempt !== current.run_evidence?.run_attempt
      || runEvidence?.display_title !== current.run_evidence?.display_title
      || Date.parse(runEvidence?.updated_at) < Date.parse(current.run_evidence?.updated_at)
    ) {
      throw new Error('Provider-creation journal cannot change its exact workflow run identity.')
    }
    next.run_evidence = runEvidence
    next.credential_gates_succeeded = credentialGatesSucceeded
  } else if (nextPhase === 'cleanup_receipt_stored') {
    verifyProviderCreationCleanupSuccessor({
      journal,
      cleanupReceipt: successorCleanupReceipt,
      publicKey,
      now,
    })
    next.successor_cleanup_receipt_sha256 = attestationEnvelopeHash(successorCleanupReceipt)
  }
  const result = signAttestation(next, privateKey)
  verifyProviderCreationJournal(result, publicKey)
  return result
}

export function verifyProviderCreationCleanupSuccessor({
  journal,
  cleanupReceipt,
  publicKey,
  now = Date.now(),
}) {
  const pending = verifyProviderCreationJournal(journal, publicKey).payload
  if (
    !pending.lease_evidence
    || !pending.run_evidence
    || pending.credential_gates_succeeded !== true
  ) {
    throw new Error('Cleanup successor verification requires exact lease, run, and successful gate evidence.')
  }
  const signed = verifySignedAttestation(cleanupReceipt, publicKey, 'cleanup_receipt')
  const receipt = signed.payload
  exactKeys(receipt, [
    'version', 'kind', 'environment', 'workflow', 'issued_at', 'sequence', 'legacy_verification_mode',
    'github_secrets_absent', 'legacy_credentials', 'leases', 'supervisor_key_id',
  ], 'Provider-creation cleanup successor')
  if (
    receipt.version !== 3
    || receipt.environment !== pending.environment
    || receipt.workflow !== pending.workflow
    || !Array.isArray(receipt.leases)
    || receipt.sequence !== pending.base_cleanup_sequence + 1
    || receipt.leases.length !== receipt.sequence
    || sha256(JSON.stringify(receipt.leases.slice(0, -1))) !== pending.base_cleanup_leases_sha256
  ) {
    throw new Error('Cleanup receipt is not the exact journal successor.')
  }
  const entry = receipt.leases.at(-1)
  exactKeys(entry, [
    'run_id', 'run_attempt', 'commit_sha', 'lease_id', 'storage_backup', 'closed_at',
    'previous_cleanup_receipt_sha256', 'cloudflare_token_id_hashes', 'supabase_pat_label_hash',
    'supabase_pat_sha256', 'providers_inactive',
  ], 'Provider-creation cleanup successor entry')
  const closedAt = Date.parse(entry.closed_at)
  const issuedAt = Date.parse(receipt.issued_at)
  const runUpdatedAt = Date.parse(pending.run_evidence.updated_at)
  const nowTimestamp = now instanceof Date ? now.getTime() : Number(now)
  if (
    entry.run_id !== pending.run_evidence.run_id
    || entry.run_attempt !== pending.run_evidence.run_attempt
    || entry.commit_sha !== pending.commit_sha
    || entry.lease_id !== pending.lease_id
    || entry.storage_backup !== pending.storage_backup
    || entry.previous_cleanup_receipt_sha256 !== pending.base_cleanup_receipt_sha256
    || JSON.stringify(entry.cloudflare_token_id_hashes) !== JSON.stringify(pending.lease_evidence.cloudflare_token_id_hashes)
    || entry.supabase_pat_label_hash !== pending.lease_evidence.supabase_pat_label_hash
    || entry.supabase_pat_sha256 !== pending.lease_evidence.supabase_pat_sha256
    || entry.providers_inactive !== true
    || !Number.isFinite(closedAt)
    || !Number.isFinite(issuedAt)
    || !Number.isFinite(nowTimestamp)
    || closedAt < runUpdatedAt
    || issuedAt < closedAt
    || issuedAt > nowTimestamp + FUTURE_TOLERANCE_MS
  ) {
    throw new Error('Cleanup receipt successor does not close the exact journal run and credentials.')
  }
  if (
    pending.successor_cleanup_receipt_sha256 !== null
    && pending.successor_cleanup_receipt_sha256 !== signed.envelopeHash
  ) {
    throw new Error('Cleanup receipt does not match the successor recorded in the journal.')
  }
  return Object.freeze({ payload: receipt, receiptHash: signed.envelopeHash })
}

export function resolveProviderCreationCleanupState({
  journal,
  cleanupReceipt,
  publicKey,
  now = Date.now(),
}) {
  const pending = verifyProviderCreationJournal(journal, publicKey).payload
  const signed = verifySignedAttestation(cleanupReceipt, publicKey, 'cleanup_receipt')
  if (signed.envelopeHash === pending.base_cleanup_receipt_sha256) {
    const receipt = signed.payload
    if (
      receipt.version !== 3
      || receipt.environment !== pending.environment
      || receipt.workflow !== pending.workflow
      || !Array.isArray(receipt.leases)
      || receipt.sequence !== pending.base_cleanup_sequence
      || receipt.sequence !== receipt.leases.length
      || sha256(JSON.stringify(receipt.leases)) !== pending.base_cleanup_leases_sha256
    ) {
      throw new Error('Current cleanup receipt does not match the signed journal base.')
    }
    if (pending.phase === 'cleanup_receipt_stored') {
      throw new Error('Cleanup receipt was rolled back behind the successor recorded in the signed journal.')
    }
    return Object.freeze({
      state: 'base',
      payload: receipt,
      receiptHash: signed.envelopeHash,
    })
  }

  if (
    !['gates_verified', 'cleanup_receipt_stored'].includes(pending.phase)
    || pending.credential_gates_succeeded !== true
  ) {
    throw new Error('Cleanup successor exists before the signed journal reached its successful gate phase.')
  }
  const successor = verifyProviderCreationCleanupSuccessor({
    journal,
    cleanupReceipt,
    publicKey,
    now,
  })
  return Object.freeze({
    state: 'successor',
    payload: successor.payload,
    receiptHash: successor.receiptHash,
  })
}

export function assertProviderCreationRunAbsenceCanAbort({ journal, publicKey }) {
  const pending = verifyProviderCreationJournal(journal, publicKey).payload
  if (pending.phase === 'dispatch_intent' || pending.lease_evidence !== null) {
    throw new Error('A materialized lease or signed dispatch intent cannot be closed from temporary workflow-run absence; retry recovery later.')
  }
  if (pending.run_evidence !== null) {
    throw new Error('A journal with exact run evidence cannot be closed as an unstarted lease.')
  }
  return pending
}

export function createAbortedLeaseReceipt({
  pendingMarker,
  publicKey,
  privateKey,
  providerEvidence,
  allowMaterializedDashboardRevocation = false,
  now = Date.now(),
}) {
  const verified = verifyProviderCreationRecoveryEvidence({
    journal: pendingMarker,
    providerEvidence,
    publicKey,
    allowMaterializedDashboardRevocation,
  })
  const pending = verified.pending
  const normalized = verified.providerEvidence
  workflowContract(pending.environment)
  return signAttestation({
    version: 2,
    kind: 'aborted_lease_receipt',
    environment: pending.environment,
    workflow: pending.workflow,
    commit_sha: pending.commit_sha,
    lease_id: pending.lease_id,
    storage_backup: pending.storage_backup,
    phase_journal_sha256: attestationEnvelopeHash(pendingMarker),
    cleanup_receipt_sha256: pending.base_cleanup_receipt_sha256,
    recovered_at: iso(now),
    provider_evidence: normalized,
    supervisor_key_id: publicKeyFingerprint(privateKey),
  }, privateKey)
}

export function verifyProviderCreationRecoveryEvidence({
  journal,
  providerEvidence,
  publicKey,
  allowMaterializedDashboardRevocation = false,
}) {
  const pending = verifyProviderCreationJournal(journal, publicKey).payload
  if (!Array.isArray(providerEvidence) || providerEvidence.length < 2) {
    throw new Error('Aborted lease requires evidence for every provider credential.')
  }
  const expectedProviders = pending.storage_backup
    ? ['cloudflare_pages', 'cloudflare_worker', 'supabase']
    : ['cloudflare_pages', 'supabase']
  const normalized = providerEvidence.map((entry) => {
    if (
      !expectedProviders.includes(entry?.provider)
      || ![
        'api_verified_inactive',
        'operator_verified_not_created',
        'operator_verified_dashboard_revoked',
        'operator_verified_dashboard_revoked_pre_deployment',
      ].includes(entry?.status)
      || (entry.status === 'api_verified_inactive' && !HASH_PATTERN.test(entry.credentialSha256))
      || (
        [
          'operator_verified_not_created',
          'operator_verified_dashboard_revoked',
          'operator_verified_dashboard_revoked_pre_deployment',
        ].includes(entry.status)
        && entry.credentialSha256 !== null
      )
    ) {
      throw new Error('Aborted lease provider evidence is invalid.')
    }
    return Object.freeze({
      provider: entry.provider,
      status: entry.status,
      credential_sha256: entry.credentialSha256,
    })
  }).sort((left, right) => left.provider.localeCompare(right.provider))
  if (
    normalized.length !== expectedProviders.length
    || new Set(normalized.map((entry) => entry.provider)).size !== expectedProviders.length
    || expectedProviders.some((provider) => !normalized.some((entry) => entry.provider === provider))
  ) {
    throw new Error('Aborted lease provider evidence is incomplete or duplicated.')
  }
  if (pending.lease_evidence) {
    const expectedHashes = new Map([
      ['cloudflare_pages', pending.lease_evidence.cloudflare_token_sha256[0]],
      ['supabase', pending.lease_evidence.supabase_pat_sha256],
    ])
    if (pending.storage_backup) {
      expectedHashes.set('cloudflare_worker', pending.lease_evidence.cloudflare_token_sha256[1])
    }
    const dashboardRevocationAfterPreDeploymentFailure = normalized.every((entry) => (
      entry.status === 'operator_verified_dashboard_revoked_pre_deployment'
      && entry.credential_sha256 === null
    ))
    if (dashboardRevocationAfterPreDeploymentFailure && allowMaterializedDashboardRevocation) {
      return Object.freeze({
        pending,
        providerEvidence: Object.freeze(normalized),
      })
    }
    if (normalized.some((entry) => (
      entry.status !== 'api_verified_inactive'
      || entry.credential_sha256 !== expectedHashes.get(entry.provider)
    ))) {
      throw new Error('Recovery evidence does not prove inactivity of the exact signed credentials.')
    }
  }
  return Object.freeze({
    pending,
    providerEvidence: Object.freeze(normalized),
  })
}

export function appendClosedLeaseReceipt({
  previousReceipt,
  environment,
  run,
  cloudflareTokenIdHashes,
  supabasePatLabelHash,
  supabasePatSha256,
  publicKey,
  privateKey,
  now = Date.now(),
}) {
  const contract = workflowContract(environment)
  const signed = verifySignedAttestation(previousReceipt, publicKey, 'cleanup_receipt')
  const previous = signed.payload
  if (
    previous.version !== 3
    || previous.environment !== environment
    || previous.workflow !== contract.workflow
    || !Array.isArray(previous.leases)
    || previous.sequence !== previous.leases.length
  ) {
    throw new Error('Previous supervisor cleanup receipt is invalid for this environment.')
  }
  if (
    !run || !Number.isSafeInteger(run.id) || run.id <= 0 || !Number.isSafeInteger(run.runAttempt)
    || !FULL_SHA_PATTERN.test(run.commitSha) || !LEASE_PATTERN.test(run.leaseId)
    || typeof run.storageBackup !== 'boolean' || typeof run.updatedAt !== 'string'
  ) {
    throw new Error('Closed workflow run evidence is malformed.')
  }
  if (previous.leases.some((entry) => entry?.run_id === String(run.id))) {
    throw new Error('Closed workflow run is already present in the cumulative receipt.')
  }
  if (previous.leases.length >= MAX_CUMULATIVE_LEASES) {
    throw new Error('Cleanup receipt reached its reviewed 32-lease epoch limit.')
  }
  const expectedTokens = run.storageBackup ? 2 : 1
  if (
    !Array.isArray(cloudflareTokenIdHashes)
    || cloudflareTokenIdHashes.length !== expectedTokens
    || cloudflareTokenIdHashes.some((hash) => !HASH_PATTERN.test(hash))
    || !HASH_PATTERN.test(supabasePatLabelHash)
    || !HASH_PATTERN.test(supabasePatSha256)
  ) {
    throw new Error('Closed workflow credential hashes are invalid.')
  }
  const closedAt = now instanceof Date ? now.getTime() : Number(now)
  const updatedAt = Date.parse(run.updatedAt)
  if (!Number.isFinite(closedAt) || !Number.isFinite(updatedAt) || closedAt < updatedAt) {
    throw new Error('Closed workflow time is earlier than the workflow update time.')
  }
  return signAttestation({
    ...previous,
    issued_at: iso(closedAt),
    sequence: previous.sequence + 1,
    leases: [
      ...previous.leases,
      {
        run_id: String(run.id),
        run_attempt: run.runAttempt,
        commit_sha: run.commitSha,
        lease_id: run.leaseId,
        storage_backup: run.storageBackup,
        closed_at: iso(closedAt),
        previous_cleanup_receipt_sha256: signed.envelopeHash,
        cloudflare_token_id_hashes: [...cloudflareTokenIdHashes],
        supabase_pat_label_hash: supabasePatLabelHash,
        supabase_pat_sha256: supabasePatSha256,
        providers_inactive: true,
      },
    ],
    supervisor_key_id: publicKeyFingerprint(privateKey),
  }, privateKey)
}

export { sha256 }
