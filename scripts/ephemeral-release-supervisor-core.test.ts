import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { attestationEnvelopeHash, signAttestation, verifySignedAttestation } from './ephemeral-release-attestation.mjs'
import { createCleanupEpochSuccessor, verifyCleanupReceiptChain } from './ephemeral-cleanup-epochs.mjs'
import {
  advanceProviderCreationJournal,
  appendClosedLeaseReceipt,
  assertProviderCreationRunAbsenceCanAbort,
  createAbortedLeaseReceipt,
  createInitialCleanupReceipt,
  createLeaseMaterial,
  createProviderCreationPending,
  refreshCleanupReceiptSecretContract,
  resolveProviderCreationCleanupState,
  sha256,
  verifyProviderCreationCleanupSuccessor,
  verifyProviderCreationJournal,
  verifyProviderCreationLeaseGrant,
  verifyProviderCreationRecoveryEvidence,
} from './ephemeral-release-supervisor-core.mjs'
import { CLEANUP_ABSENT_SECRET_NAMES } from './verify-ephemeral-cleanup-receipt.mjs'
import { verifyEphemeralLeaseGrant } from './verify-ephemeral-lease-grant.mjs'

const NOW = Date.parse('2026-08-25T05:00:00Z')
const SHA = 'a'.repeat(40)
const LEASE = 'b'.repeat(32)
const PAGE_TOKEN_ID = 'c'.repeat(32)
const WORKER_TOKEN_ID = 'd'.repeat(32)
const PAGE_TOKEN = 'cloudflare-pages-token-material-1234567890'
const WORKER_TOKEN = 'cloudflare-worker-token-material-1234567890'
const PAT_LABEL = `burillab-staging-${LEASE}`
const PAT = 'sbp_test_ephemeral_pat_material_1234567890'
const ACCOUNT_ID = 'e'.repeat(32)
const RUN_ID = 101

function setup() {
  const keys = generateKeyPairSync('ed25519')
  const receipt = createInitialCleanupReceipt({
    environment: 'staging',
    legacyCredentials: [
      { provider: 'cloudflare', credentialIdHash: '1'.repeat(64) },
      { provider: 'supabase', credentialIdHash: '2'.repeat(64) },
    ],
    privateKey: keys.privateKey,
    now: NOW - 60_000,
  })
  return { keys, receipt }
}

function setupJournal(withEpoch = false) {
  const { keys, receipt: initialReceipt } = setup()
  let receipt = initialReceipt
  let readArchive: ((environment: string, hash: string) => string) | undefined
  if (withEpoch) {
    for (let id = 1000; id < 1032; id += 1) {
      receipt = appendClosedLeaseReceipt({ previousReceipt: receipt, environment: 'staging', publicKey: keys.publicKey, privateKey: keys.privateKey,
        run: { id, runAttempt: 1, commitSha: SHA, leaseId: id.toString(16).padStart(32, '0'), storageBackup: false,
          updatedAt: new Date(NOW - 40_000).toISOString() },
        cloudflareTokenIdHashes: ['3'.repeat(64)], supabasePatLabelHash: '4'.repeat(64), supabasePatSha256: '5'.repeat(64), now: NOW - 20_000,
      })
    }
    const archived = receipt
    const hash = attestationEnvelopeHash(archived)
    readArchive = (environment, target) => {
      if (environment !== 'staging' || target !== hash) throw new Error('missing test archive')
      return archived
    }
    receipt = createCleanupEpochSuccessor({ previousReceipt: archived, environment: 'staging', publicKey: keys.publicKey,
      privateKey: keys.privateKey, now: NOW - 10_000, readArchive })
  }
  const pending = createProviderCreationPending({
    environment: 'staging',
    commitSha: SHA,
    leaseId: LEASE,
    storageBackup: true,
    supabasePatLabel: PAT_LABEL,
    cloudflareAccountId: ACCOUNT_ID,
    cleanupReceipt: receipt,
    privateKey: keys.privateKey,
    now: NOW,
    readArchive,
  })
  const material = createLeaseMaterial({
    environment: 'staging',
    commitSha: SHA,
    leaseId: LEASE,
    storageBackup: true,
    cleanupReceipt: receipt,
    cloudflareTokenIdHashes: [sha256(PAGE_TOKEN_ID), sha256(WORKER_TOKEN_ID)],
    cloudflareTokens: [PAGE_TOKEN, WORKER_TOKEN],
    supabasePatLabel: PAT_LABEL,
    supabasePat: PAT,
    privateKey: keys.privateKey,
    now: NOW,
  })
  const leaseMaterialized = advanceProviderCreationJournal({
    journal: pending,
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    nextPhase: 'lease_materialized',
    leaseEvidence: {
      grant_sha256: sha256(material.grant),
      cloudflare_token_id_hashes: [...material.cloudflareTokenIdHashes],
      cloudflare_token_sha256: [sha256(PAGE_TOKEN), sha256(WORKER_TOKEN)],
      supabase_pat_label_hash: material.supabasePatLabelHash,
      supabase_pat_sha256: material.supabasePatSha256,
    },
    now: NOW + 1_000,
  })
  const dispatchIntent = advanceProviderCreationJournal({
    journal: leaseMaterialized,
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    nextPhase: 'dispatch_intent',
    now: NOW + 2_000,
  })
  const runEvidence = {
    run_id: String(RUN_ID),
    run_attempt: 1,
    display_title: `Deploy staging ${SHA} (lease=${LEASE}, storage-backup=true)`,
    updated_at: new Date(NOW + 3_000).toISOString(),
  }
  const runBound = advanceProviderCreationJournal({
    journal: dispatchIntent,
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    nextPhase: 'run_bound',
    runEvidence,
    now: NOW + 3_000,
  })
  const gatesVerified = advanceProviderCreationJournal({
    journal: runBound,
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    nextPhase: 'gates_verified',
    runEvidence,
    credentialGatesSucceeded: true,
    now: NOW + 4_000,
  })
  const successor = appendClosedLeaseReceipt({
    previousReceipt: receipt,
    environment: 'staging',
    run: {
      id: RUN_ID,
      runAttempt: 1,
      commitSha: SHA,
      leaseId: LEASE,
      storageBackup: true,
      updatedAt: runEvidence.updated_at,
    },
    cloudflareTokenIdHashes: [...material.cloudflareTokenIdHashes],
    supabasePatLabelHash: material.supabasePatLabelHash,
    supabasePatSha256: material.supabasePatSha256,
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    now: NOW + 5_000,
    readArchive,
  })
  const cleanupStored = advanceProviderCreationJournal({
    journal: gatesVerified,
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    nextPhase: 'cleanup_receipt_stored',
    successorCleanupReceipt: successor,
    now: NOW + 6_000,
    readArchive,
  })
  return {
    keys,
    receipt,
    pending,
    leaseGrant: material.grant,
    leaseMaterialized,
    dispatchIntent,
    runBound,
    gatesVerified,
    successor,
    cleanupStored,
    readArchive,
  }
}

describe('ephemeral release supervisor core', () => {
  it('binds the new journal to its exact archived epoch through normal and interrupted cleanup', () => {
    const f = setupJournal(true)
    const opts = { publicKey: f.keys.publicKey, readArchive: f.readArchive, now: NOW + 10_000 }
    const pending = verifyProviderCreationJournal(f.pending, f.keys.publicKey).payload
    expect(pending).toMatchObject({ version: 3, base_cleanup_epoch: 1, base_cleanup_sequence: 0 })
    expect(resolveProviderCreationCleanupState({ journal: f.gatesVerified, cleanupReceipt: f.receipt, ...opts }))
      .toMatchObject({ state: 'base' })
    expect(verifyProviderCreationCleanupSuccessor({ journal: f.gatesVerified, cleanupReceipt: f.successor, ...opts }))
      .toMatchObject({ payload: { version: 4, epoch: 1, sequence: 1 } })
    expect(resolveProviderCreationCleanupState({ journal: f.gatesVerified, cleanupReceipt: f.successor, ...opts }))
      .toMatchObject({ state: 'successor' })
    expect(verifyCleanupReceiptChain(f.successor, f.keys.publicKey, { environment: 'staging', ...opts }).leases).toHaveLength(33)
    expect(() => resolveProviderCreationCleanupState({ journal: f.cleanupStored, cleanupReceipt: f.receipt, ...opts }))
      .toThrow(/rolled back/)
  })

  it('rejects dropping or changing the archived epoch during successor recovery', () => {
    const f = setupJournal(true)
    const opts = { publicKey: f.keys.publicKey, readArchive: f.readArchive, now: NOW + 10_000 }
    const payload = verifyProviderCreationJournal(f.gatesVerified, f.keys.publicKey).payload
    const changed = signAttestation({ ...payload, base_cleanup_epoch: 2 }, f.keys.privateKey)
    expect(() => verifyProviderCreationCleanupSuccessor({ journal: changed, cleanupReceipt: f.successor, ...opts }))
      .toThrow(/exact journal successor/)
    const successor = verifySignedAttestation(f.successor, f.keys.publicKey, 'cleanup_receipt').payload
    const dropped = { ...successor, version: 3 }
    delete dropped.epoch
    delete dropped.previous_epoch_receipt_sha256
    expect(() => verifyProviderCreationCleanupSuccessor({ journal: f.gatesVerified, cleanupReceipt: signAttestation(dropped, f.keys.privateKey), ...opts }))
      .toThrow(/exact journal successor/)
  })

  it('refreshes an additive cleanup secret contract without losing lease history', () => {
    const { keys, successor } = setupJournal()
    const current = verifySignedAttestation(successor, keys.publicKey, 'cleanup_receipt').payload
    const legacy = signAttestation({
      ...current,
      github_secrets_absent: current.github_secrets_absent
        .filter((name: string) => name !== 'PRODUCTION_WORKER_EPHEMERAL_TOKEN'),
    }, keys.privateKey)

    const refreshed = refreshCleanupReceiptSecretContract({
      previousReceipt: legacy,
      environment: 'staging',
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      now: NOW + 10_000,
    })
    const payload = verifySignedAttestation(refreshed, keys.publicKey, 'cleanup_receipt').payload

    expect(payload.github_secrets_absent).toEqual(CLEANUP_ABSENT_SECRET_NAMES)
    expect(payload.sequence).toBe(current.sequence)
    expect(payload.leases).toEqual(current.leases)
    expect(payload.legacy_credentials).toEqual(current.legacy_credentials)
    expect(payload.issued_at).toBe(new Date(NOW + 10_000).toISOString())
    expect(() => refreshCleanupReceiptSecretContract({
      previousReceipt: refreshed,
      environment: 'staging',
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      now: NOW + 11_000,
    })).toThrow(/already uses the current secret contract/)
  })

  it('creates a signed initial cleanup and exact lease/session material', () => {
    const { keys, receipt } = setup()
    expect(verifySignedAttestation(receipt, keys.publicKey, 'cleanup_receipt').payload)
      .toMatchObject({ environment: 'staging', leases: [] })

    const material = createLeaseMaterial({
      environment: 'staging',
      commitSha: SHA,
      leaseId: LEASE,
      storageBackup: true,
      cleanupReceipt: receipt,
      cloudflareTokenIdHashes: [sha256(PAGE_TOKEN_ID), sha256(WORKER_TOKEN_ID)],
      cloudflareTokens: [PAGE_TOKEN, WORKER_TOKEN],
      supabasePatLabel: PAT_LABEL,
      supabasePat: PAT,
      privateKey: keys.privateKey,
      now: NOW,
    })
    const environment = {
      DEPLOY_ENVIRONMENT: 'staging',
      DEPLOY_COMMIT_SHA: SHA,
      DEPLOY_LEASE_ID: LEASE,
      DEPLOY_STORAGE_BACKUP: 'true',
      EPHEMERAL_CLEANUP_RECEIPT: receipt,
      EPHEMERAL_LEASE_GRANT: material.grant,
    }
    expect(verifyEphemeralLeaseGrant(environment, keys.publicKey, { now: NOW }))
      .toMatchObject({
        cloudflareTokenIdHashes: [sha256(PAGE_TOKEN_ID), sha256(WORKER_TOKEN_ID)],
        supabasePatLabelHash: sha256(PAT_LABEL),
        supabasePatSha256: sha256(PAT),
      })
  })

  it('creates a two-token Production Worker lease bound to one cleaned Staging run', () => {
    const keys = generateKeyPairSync('ed25519')
    const legacyCredentials = [
      { provider: 'cloudflare', credentialIdHash: '1'.repeat(64) },
      { provider: 'supabase', credentialIdHash: '2'.repeat(64) },
    ]
    const productionReceipt = createInitialCleanupReceipt({
      environment: 'production',
      legacyCredentials,
      privateKey: keys.privateKey,
      now: NOW - 60_000,
    })
    const stagingReceipt = createInitialCleanupReceipt({
      environment: 'staging',
      legacyCredentials,
      privateKey: keys.privateKey,
      now: NOW - 60_000,
    })
    const material = createLeaseMaterial({
      environment: 'production',
      commitSha: SHA,
      leaseId: LEASE,
      storageBackup: true,
      cleanupReceipt: productionReceipt,
      cloudflareTokenIdHashes: [sha256(PAGE_TOKEN_ID), sha256(WORKER_TOKEN_ID)],
      cloudflareTokens: [PAGE_TOKEN, WORKER_TOKEN],
      supabasePatLabel: `burillab-production-${LEASE}`,
      supabasePat: PAT,
      stagingRunId: '31',
      stagingCleanupReceipt: stagingReceipt,
      privateKey: keys.privateKey,
      now: NOW,
    })
    expect(verifyEphemeralLeaseGrant({
      DEPLOY_ENVIRONMENT: 'production',
      DEPLOY_COMMIT_SHA: SHA,
      DEPLOY_LEASE_ID: LEASE,
      DEPLOY_STORAGE_BACKUP: 'true',
      DEPLOY_STAGING_RUN_ID: '31',
      EPHEMERAL_CLEANUP_RECEIPT: productionReceipt,
      STAGING_EPHEMERAL_CLEANUP_RECEIPT: stagingReceipt,
      EPHEMERAL_LEASE_GRANT: material.grant,
    }, keys.publicKey, { now: NOW })).toMatchObject({
      environment: 'production',
      storageBackup: true,
      stagingRunId: '31',
      cloudflareTokenIdHashes: [sha256(PAGE_TOKEN_ID), sha256(WORKER_TOKEN_ID)],
    })
  })

  it('appends a closed run only after its update time and preserves the signed cumulative history', () => {
    const { keys, receipt } = setup()
    const closed = appendClosedLeaseReceipt({
      previousReceipt: receipt,
      environment: 'staging',
      run: {
        id: 101,
        runAttempt: 1,
        commitSha: SHA,
        leaseId: LEASE,
        storageBackup: true,
        updatedAt: '2026-08-25T05:10:00Z',
      },
      cloudflareTokenIdHashes: [sha256(PAGE_TOKEN_ID), sha256(WORKER_TOKEN_ID)],
      supabasePatLabelHash: sha256(PAT_LABEL),
      supabasePatSha256: sha256(PAT),
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      now: Date.parse('2026-08-25T05:15:00Z'),
    })
    expect(verifySignedAttestation(closed, keys.publicKey, 'cleanup_receipt').payload.leases)
      .toHaveLength(1)
    expect(() => appendClosedLeaseReceipt({
      previousReceipt: receipt,
      environment: 'staging',
      run: {
        id: 101,
        runAttempt: 1,
        commitSha: SHA,
        leaseId: LEASE,
        storageBackup: true,
        updatedAt: '2026-08-25T05:10:00Z',
      },
      cloudflareTokenIdHashes: [sha256(PAGE_TOKEN_ID), sha256(WORKER_TOKEN_ID)],
      supabasePatLabelHash: sha256(PAT_LABEL),
      supabasePatSha256: sha256(PAT),
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      now: Date.parse('2026-08-25T05:09:59Z'),
    })).toThrow(/earlier than the workflow update/)
  })

  it('signs a pending marker before token creation and an exact aborted-lease recovery', () => {
    const { keys, receipt } = setup()
    const pending = createProviderCreationPending({
      environment: 'staging',
      commitSha: SHA,
      leaseId: LEASE,
      storageBackup: true,
      supabasePatLabel: PAT_LABEL,
      cloudflareAccountId: ACCOUNT_ID,
      cleanupReceipt: receipt,
      privateKey: keys.privateKey,
      now: NOW,
    })
    expect(verifyProviderCreationJournal(pending, keys.publicKey).payload)
      .toMatchObject({
        lease_id: LEASE,
        phase: 'provider_creation_pending',
        base_cleanup_receipt_sha256: sha256(receipt),
      })

    const aborted = createAbortedLeaseReceipt({
      pendingMarker: pending,
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      providerEvidence: [
        { provider: 'supabase', status: 'api_verified_inactive', credentialSha256: sha256(PAT) },
        { provider: 'cloudflare_pages', status: 'api_verified_inactive', credentialSha256: sha256('pages-token-material-123456789') },
        { provider: 'cloudflare_worker', status: 'operator_verified_not_created', credentialSha256: null },
      ],
      now: NOW + 60_000,
    })
    expect(verifySignedAttestation(aborted, keys.publicKey, 'aborted_lease_receipt').payload)
      .toMatchObject({ lease_id: LEASE, provider_evidence: expect.any(Array) })

    const tampered = JSON.parse(pending)
    tampered.signature = 'A'.repeat(86)
    expect(() => createAbortedLeaseReceipt({
      pendingMarker: JSON.stringify(tampered),
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      providerEvidence: [],
    })).toThrow(/signature/)
  })

  it('keeps the base cleanup receipt recoverable immediately after dispatch', () => {
    const {
      keys,
      receipt,
      pending,
      leaseGrant,
      leaseMaterialized,
      dispatchIntent,
    } = setupJournal()
    expect(verifyProviderCreationJournal(dispatchIntent, keys.publicKey).payload)
      .toMatchObject({ phase: 'dispatch_intent', run_evidence: null })
    expect(resolveProviderCreationCleanupState({
      journal: dispatchIntent,
      cleanupReceipt: receipt,
      publicKey: keys.publicKey,
      now: NOW + 10_000,
    })).toMatchObject({ state: 'base', receiptHash: sha256(receipt) })
    expect(() => assertProviderCreationRunAbsenceCanAbort({
      journal: dispatchIntent,
      publicKey: keys.publicKey,
    })).toThrow(/cannot be closed from temporary workflow-run absence/)
    expect(() => assertProviderCreationRunAbsenceCanAbort({
      journal: leaseMaterialized,
      publicKey: keys.publicKey,
    })).toThrow(/materialized lease/)
    expect(assertProviderCreationRunAbsenceCanAbort({
      journal: pending,
      publicKey: keys.publicKey,
    }).phase).toBe('provider_creation_pending')
    const grantOnStalePending = verifyProviderCreationLeaseGrant({
      journal: pending,
      leaseGrant,
      publicKey: keys.publicKey,
    })
    expect(grantOnStalePending.phaseRollbackDetected).toBe(true)
    const restoredMaterialization = advanceProviderCreationJournal({
      journal: pending,
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      nextPhase: 'lease_materialized',
      leaseEvidence: grantOnStalePending.leaseEvidence,
      now: NOW + 1_000,
    })
    expect(restoredMaterialization).toBe(leaseMaterialized)
    expect(verifyProviderCreationLeaseGrant({
      journal: restoredMaterialization,
      leaseGrant,
      publicKey: keys.publicKey,
    }).phaseRollbackDetected).toBe(false)
  })

  it('pins the exact run identity before recovering from a post-run-id crash', () => {
    const { keys, receipt, runBound } = setupJournal()
    expect(verifyProviderCreationJournal(runBound, keys.publicKey).payload)
      .toMatchObject({
        phase: 'run_bound',
        run_evidence: { run_id: String(RUN_ID), run_attempt: 1 },
      })
    expect(resolveProviderCreationCleanupState({
      journal: runBound,
      cleanupReceipt: receipt,
      publicKey: keys.publicKey,
      now: NOW + 10_000,
    }).state).toBe('base')
  })

  it('preserves successful credential gates before recovering a missing successor receipt', () => {
    const { keys, receipt, runBound, gatesVerified } = setupJournal()
    expect(verifyProviderCreationJournal(gatesVerified, keys.publicKey).payload)
      .toMatchObject({
        phase: 'gates_verified',
        credential_gates_succeeded: true,
        run_evidence: { run_id: String(RUN_ID) },
      })
    expect(resolveProviderCreationCleanupState({
      journal: gatesVerified,
      cleanupReceipt: receipt,
      publicKey: keys.publicKey,
      now: NOW + 10_000,
    }).state).toBe('base')
    expect(() => advanceProviderCreationJournal({
      journal: runBound,
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      nextPhase: 'gates_verified',
      runEvidence: {
        ...verifyProviderCreationJournal(runBound, keys.publicKey).payload.run_evidence,
        run_id: String(RUN_ID + 1),
      },
      credentialGatesSucceeded: true,
      now: NOW + 4_000,
    })).toThrow(/cannot change its exact workflow run identity/)
  })

  it('binds recovery inactivity proof to the exact materialized credentials', () => {
    const { keys, gatesVerified } = setupJournal()
    const exactEvidence = [
      { provider: 'supabase', status: 'api_verified_inactive', credentialSha256: sha256(PAT) },
      { provider: 'cloudflare_pages', status: 'api_verified_inactive', credentialSha256: sha256(PAGE_TOKEN) },
      { provider: 'cloudflare_worker', status: 'api_verified_inactive', credentialSha256: sha256(WORKER_TOKEN) },
    ]
    expect(verifyProviderCreationRecoveryEvidence({
      journal: gatesVerified,
      providerEvidence: exactEvidence,
      publicKey: keys.publicKey,
    }).providerEvidence).toHaveLength(3)
    expect(() => verifyProviderCreationRecoveryEvidence({
      journal: gatesVerified,
      providerEvidence: exactEvidence.map((entry) => (
        entry.provider === 'supabase'
          ? { ...entry, credentialSha256: sha256('another-revoked-supabase-pat') }
          : entry
      )),
      publicKey: keys.publicKey,
    })).toThrow(/exact signed credentials/)
    expect(() => verifyProviderCreationRecoveryEvidence({
      journal: gatesVerified,
      providerEvidence: exactEvidence.map((entry) => (
        entry.provider === 'cloudflare_worker'
          ? { ...entry, status: 'operator_verified_not_created', credentialSha256: null }
          : entry
      )),
      publicKey: keys.publicKey,
    })).toThrow(/exact signed credentials/)
    expect(() => verifyProviderCreationRecoveryEvidence({
      journal: gatesVerified,
      providerEvidence: exactEvidence.map((entry) => (
        entry.provider === 'cloudflare_worker'
          ? { ...entry, status: 'operator_verified_dashboard_revoked', credentialSha256: null }
          : entry
      )),
      publicKey: keys.publicKey,
    })).toThrow(/exact signed credentials/)
  })

  it('records a dashboard-revoked credential only before lease materialization', () => {
    const { keys, receipt } = setup()
    const pending = createProviderCreationPending({
      environment: 'staging',
      commitSha: SHA,
      leaseId: LEASE,
      storageBackup: false,
      supabasePatLabel: PAT_LABEL,
      cloudflareAccountId: ACCOUNT_ID,
      cleanupReceipt: receipt,
      privateKey: keys.privateKey,
      now: NOW,
    })
    expect(verifyProviderCreationRecoveryEvidence({
      journal: pending,
      providerEvidence: [
        { provider: 'cloudflare_pages', status: 'operator_verified_not_created', credentialSha256: null },
        { provider: 'supabase', status: 'operator_verified_dashboard_revoked', credentialSha256: null },
      ],
      publicKey: keys.publicKey,
    }).providerEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'supabase', status: 'operator_verified_dashboard_revoked' }),
    ]))
  })

  it('permits dashboard revocation after materialization only with the explicit pre-deployment recovery flag', () => {
    const { keys, gatesVerified } = setupJournal()
    const dashboardEvidence = [
      { provider: 'supabase', status: 'operator_verified_dashboard_revoked_pre_deployment', credentialSha256: null },
      { provider: 'cloudflare_pages', status: 'operator_verified_dashboard_revoked_pre_deployment', credentialSha256: null },
      { provider: 'cloudflare_worker', status: 'operator_verified_dashboard_revoked_pre_deployment', credentialSha256: null },
    ]
    expect(() => verifyProviderCreationRecoveryEvidence({
      journal: gatesVerified,
      providerEvidence: dashboardEvidence,
      publicKey: keys.publicKey,
    })).toThrow(/exact signed credentials/)
    expect(verifyProviderCreationRecoveryEvidence({
      journal: gatesVerified,
      providerEvidence: dashboardEvidence,
      publicKey: keys.publicKey,
      allowMaterializedDashboardRevocation: true,
    }).providerEvidence).toHaveLength(3)
  })

  it('permits an explicit dashboard-revoked attestation after a supervisor process loses captured credentials', () => {
    const { keys, gatesVerified } = setupJournal()
    const dashboardEvidence = [
      { provider: 'supabase', status: 'operator_verified_dashboard_revoked_after_process_loss', credentialSha256: null },
      { provider: 'cloudflare_pages', status: 'operator_verified_dashboard_revoked_after_process_loss', credentialSha256: null },
      { provider: 'cloudflare_worker', status: 'operator_verified_dashboard_revoked_after_process_loss', credentialSha256: null },
    ]
    expect(() => verifyProviderCreationRecoveryEvidence({
      journal: gatesVerified,
      providerEvidence: dashboardEvidence,
      publicKey: keys.publicKey,
    })).toThrow(/exact signed credentials/)
    expect(verifyProviderCreationRecoveryEvidence({
      journal: gatesVerified,
      providerEvidence: dashboardEvidence,
      publicKey: keys.publicKey,
      allowMaterializedDashboardRevocation: true,
    }).providerEvidence).toHaveLength(3)
  })

  it('accepts only the exact successor after receipt storage and before pending deletion', () => {
    const {
      keys,
      receipt,
      gatesVerified,
      successor,
      cleanupStored,
    } = setupJournal()
    expect(resolveProviderCreationCleanupState({
      journal: gatesVerified,
      cleanupReceipt: successor,
      publicKey: keys.publicKey,
      now: NOW + 10_000,
    })).toMatchObject({ state: 'successor', receiptHash: sha256(successor) })
    expect(verifyProviderCreationCleanupSuccessor({
      journal: cleanupStored,
      cleanupReceipt: successor,
      publicKey: keys.publicKey,
      now: NOW + 10_000,
    }).receiptHash).toBe(sha256(successor))
    expect(() => resolveProviderCreationCleanupState({
      journal: cleanupStored,
      cleanupReceipt: receipt,
      publicKey: keys.publicKey,
      now: NOW + 10_000,
    })).toThrow(/rolled back/)

    const replay = appendClosedLeaseReceipt({
      previousReceipt: receipt,
      environment: 'staging',
      run: {
        id: RUN_ID + 1,
        runAttempt: 1,
        commitSha: SHA,
        leaseId: LEASE,
        storageBackup: true,
        updatedAt: new Date(NOW + 3_000).toISOString(),
      },
      cloudflareTokenIdHashes: [sha256(PAGE_TOKEN_ID), sha256(WORKER_TOKEN_ID)],
      supabasePatLabelHash: sha256(PAT_LABEL),
      supabasePatSha256: sha256(PAT),
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      now: NOW + 5_000,
    })
    expect(() => resolveProviderCreationCleanupState({
      journal: gatesVerified,
      cleanupReceipt: replay,
      publicKey: keys.publicKey,
      now: NOW + 10_000,
    })).toThrow(/exact journal run/)
    expect(() => advanceProviderCreationJournal({
      journal: gatesVerified,
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      nextPhase: 'cleanup_receipt_stored',
      successorCleanupReceipt: replay,
      now: NOW + 6_000,
    })).toThrow(/exact journal run/)

    const alternateBase = createInitialCleanupReceipt({
      environment: 'staging',
      legacyCredentials: [
        { provider: 'cloudflare', credentialIdHash: '7'.repeat(64) },
        { provider: 'supabase', credentialIdHash: '8'.repeat(64) },
      ],
      privateKey: keys.privateKey,
      now: NOW - 60_000,
    })
    const alternateSuccessor = appendClosedLeaseReceipt({
      previousReceipt: alternateBase,
      environment: 'staging',
      run: {
        id: RUN_ID,
        runAttempt: 1,
        commitSha: SHA,
        leaseId: LEASE,
        storageBackup: true,
        updatedAt: new Date(NOW + 3_000).toISOString(),
      },
      cloudflareTokenIdHashes: [sha256(PAGE_TOKEN_ID), sha256(WORKER_TOKEN_ID)],
      supabasePatLabelHash: sha256(PAT_LABEL),
      supabasePatSha256: sha256(PAT),
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      now: NOW + 5_000,
    })
    expect(() => resolveProviderCreationCleanupState({
      journal: gatesVerified,
      cleanupReceipt: alternateSuccessor,
      publicKey: keys.publicKey,
      now: NOW + 10_000,
    })).toThrow(/exact journal run and credentials/)
  })
})
