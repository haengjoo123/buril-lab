import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { attestationEnvelopeHash, signAttestation, verifySignedAttestation, MAX_ATTESTATION_ENVELOPE_BYTES } from './ephemeral-release-attestation.mjs'
import {
  cleanupEpochArchivePath, createCleanupEpochSuccessor, MAX_CUMULATIVE_LEASES,
  MAX_ARCHIVED_CLEANUP_EPOCHS, readCleanupEpochArchive, verifyCleanupReceiptChain,
} from './ephemeral-cleanup-epochs.mjs'
import { appendClosedLeaseReceipt, createInitialCleanupReceipt } from './ephemeral-release-supervisor-core.mjs'
import { verifyCleanupReceiptCoversRun, verifyCleanupReceiptHistory, verifyEphemeralCleanupReceipt } from './verify-ephemeral-cleanup-receipt.mjs'

const NOW = Date.parse('2026-09-03T00:00:00Z')
const SHA = 'a'.repeat(40)
const env = (receipt: string) => ({
  GITHUB_REPOSITORY: 'haengjoo123/buril-lab', DEPLOY_ENVIRONMENT: 'staging', EPHEMERAL_CLEANUP_RECEIPT: receipt,
  GITHUB_RUN_ID: '9000', GITHUB_RUN_ATTEMPT: '1', DEPLOY_LEASE_ID: 'f'.repeat(32),
})

function fixture() {
  const keys = generateKeyPairSync('ed25519')
  const archives = new Map<string, string>()
  const readArchive = (_environment: string, hash: string) => {
    const raw = archives.get(hash)
    if (!raw) throw new Error('missing signed archive')
    return raw
  }
  let root = createInitialCleanupReceipt({ environment: 'staging', privateKey: keys.privateKey, now: NOW - 200_000,
    legacyCredentials: [{ provider: 'cloudflare', credentialIdHash: '1'.repeat(64) }, { provider: 'supabase', credentialIdHash: '2'.repeat(64) }],
  })
  const append = (receipt: string, id: number) => appendClosedLeaseReceipt({
    previousReceipt: receipt, environment: 'staging', publicKey: keys.publicKey, privateKey: keys.privateKey,
    run: { id, runAttempt: 1, commitSha: SHA, leaseId: id.toString(16).padStart(32, '0'), storageBackup: false,
      updatedAt: new Date(NOW - 100_000).toISOString() },
    cloudflareTokenIdHashes: ['3'.repeat(64)], supabasePatLabelHash: '4'.repeat(64), supabasePatSha256: '5'.repeat(64),
    now: NOW - 50_000, readArchive,
  })
  for (let id = 1000; id < 1032; id += 1) root = append(root, id)
  const rootHash = attestationEnvelopeHash(root)
  archives.set(rootHash, root)
  const rollover = (receipt: string) => createCleanupEpochSuccessor({ previousReceipt: receipt, environment: 'staging',
    publicKey: keys.publicKey, privateKey: keys.privateKey, now: NOW - 50_000, readArchive })
  const current = rollover(root)
  const options = { environment: 'staging', now: NOW, readArchive }
  return { keys, root, rootHash, current, options, append, archives, rollover }
}

function runsFor(receipt: string, keys: ReturnType<typeof generateKeyPairSync>, options: Record<string, unknown>) {
  return verifyCleanupReceiptChain(receipt, keys.publicKey, options).leases.map((entry: Record<string, unknown>) => ({
    id: Number(entry.run_id), run_attempt: 1, path: '.github/workflows/deploy-staging.yml', event: 'workflow_dispatch', head_branch: 'main',
    head_sha: SHA, display_title: `Deploy staging ${SHA} (lease=${entry.lease_id}, storage-backup=false)`,
    repository: { full_name: 'haengjoo123/buril-lab' }, head_repository: { full_name: 'haengjoo123/buril-lab' },
    created_at: new Date(NOW - 110_000).toISOString(), updated_at: new Date(NOW - 100_000).toISOString(),
    credential_lease_gate_succeeded: true, credential_run_attempt: 1, credential_run_updated_at: new Date(NOW - 100_000).toISOString(),
  }))
}

describe('history-preserving signed cleanup epochs', () => {
  it('keeps the 32-lease and 48 KiB variable limits and the exact original envelope', () => {
    const f = fixture()
    expect(MAX_CUMULATIVE_LEASES).toBe(32)
    expect(MAX_ARCHIVED_CLEANUP_EPOCHS).toBe(16)
    expect(Buffer.byteLength(f.current)).toBeLessThan(MAX_ATTESTATION_ENVELOPE_BYTES)
    expect(f.archives.get(f.rootHash)).toBe(f.root)
    const chain = verifyCleanupReceiptChain(f.current, f.keys.publicKey, f.options)
    expect(chain).toMatchObject({ epoch: 1, archivedEpochCount: 1, payload: { sequence: 0, leases: [] } })
    expect(chain.leases).toHaveLength(32)
    expect(chain.receipts[0].envelopeHash).toBe(f.rootHash)
  })

  it('covers all 33 real-history entries, including an archived Staging deployment', () => {
    const f = fixture()
    const current = f.append(f.current, 2000)
    const runs = runsFor(current, f.keys, f.options)
    expect(verifyEphemeralCleanupReceipt(runs, env(current), { ...f.options, publicKey: f.keys.publicKey }))
      .toMatchObject({ coveredRunCount: 33, epoch: 1, currentEpochLeaseCount: 1 })
    expect(verifyCleanupReceiptCoversRun(current, f.keys.publicKey, runs[0], f.options)).toMatchObject({ runId: '1000' })
    expect(verifyCleanupReceiptCoversRun(current, f.keys.publicKey, runs[32], f.options)).toMatchObject({ runId: '2000' })
  })

  it('requires every prior GitHub run even after rollover, and forbids lease reuse', () => {
    const f = fixture()
    const runs = runsFor(f.current, f.keys, f.options)
    const opts = { ...f.options, publicKey: f.keys.publicKey }
    expect(() => verifyCleanupReceiptHistory(runs.slice(1), env(f.current), opts)).toThrow(/every prior/)
    expect(() => verifyCleanupReceiptHistory([...runs.slice(1), runs[1]], env(f.current), opts)).toThrow(/repeated|repeats/)
    expect(() => verifyEphemeralCleanupReceipt(runs, { ...env(f.current), DEPLOY_LEASE_ID: '1000'.toString() }, opts)).toThrow(/malformed/)
    expect(() => verifyEphemeralCleanupReceipt(runs, { ...env(f.current), DEPLOY_LEASE_ID: (1000).toString(16).padStart(32, '0') }, opts)).toThrow(/never be reused/)
    expect(() => f.append(f.current, 1000)).toThrow(/already present/)
  })

  it('cannot replace history with a fresh bootstrap-shaped receipt', () => {
    const f = fixture()
    const payload = verifySignedAttestation(f.root, f.keys.publicKey, 'cleanup_receipt').payload
    const reset = signAttestation({ ...payload, sequence: 0, leases: [] }, f.keys.privateKey)
    expect(() => verifyCleanupReceiptHistory(runsFor(f.root, f.keys, f.options), env(reset), { ...f.options, publicKey: f.keys.publicKey }))
      .toThrow(/every prior/)
  })

  it.each(['missing', 'tampered', 'wrong-hash', 'incomplete', 'foreign-environment', 'changed-legacy'])('rejects an unsafe archive: %s', (kind) => {
    const f = fixture()
    const payload = verifySignedAttestation(f.root, f.keys.publicKey, 'cleanup_receipt').payload
    if (kind === 'missing') f.archives.clear()
    else if (kind === 'tampered') {
      const envelope = JSON.parse(f.root)
      envelope.signature = 'A'.repeat(86)
      f.archives.set(f.rootHash, JSON.stringify(envelope))
    } else {
      const changed = kind === 'wrong-hash' ? { ...payload, issued_at: new Date(NOW - 40_000).toISOString() }
        : kind === 'incomplete' ? { ...payload, sequence: 31, leases: payload.leases.slice(1) }
          : kind === 'foreign-environment' ? { ...payload, environment: 'production', workflow: 'deploy-production.yml' }
            : { ...payload, legacy_credentials: payload.legacy_credentials.map((entry: object) => ({ ...entry, credential_id_hash: '7'.repeat(64) })) }
      f.archives.set(f.rootHash, signAttestation(changed, f.keys.privateKey))
    }
    expect(() => verifyCleanupReceiptChain(f.current, f.keys.publicKey, f.options)).toThrow()
  })

  it.each([0, 2, 17, -1, 1.5])('rejects invalid or skipped epoch ordinal %s', (epoch) => {
    const f = fixture()
    const payload = verifySignedAttestation(f.current, f.keys.publicKey, 'cleanup_receipt').payload
    const changed = signAttestation({ ...payload, epoch }, f.keys.privateKey)
    expect(() => verifyCleanupReceiptChain(changed, f.keys.publicKey, f.options)).toThrow(/epoch/)
  })

  it('requires the complete predecessor archive before signing a new epoch', () => {
    const f = fixture()
    f.archives.clear()
    expect(() => f.rollover(f.root)).toThrow(/missing/)
    expect(() => f.rollover(f.current)).toThrow()
  })

  it('does not allow a 33rd closure in one variable or early rollover', () => {
    const f = fixture()
    expect(() => f.append(f.root, 2000)).toThrow(/32-lease epoch/)
    expect(() => f.rollover(f.current)).toThrow(/complete/)
    const payload = verifySignedAttestation(f.root, f.keys.publicKey, 'cleanup_receipt').payload
    const oversized = signAttestation({ ...payload, sequence: 33, leases: [...payload.leases, payload.leases[0]] }, f.keys.privateKey)
    expect(() => verifyCleanupReceiptChain(oversized, f.keys.publicKey, f.options)).toThrow(/sequence|epoch/)
  })

  it('supports a second complete epoch without truncating or rewriting the first', () => {
    const f = fixture()
    let first = f.current
    for (let id = 2000; id < 2032; id += 1) first = f.append(first, id)
    f.archives.set(attestationEnvelopeHash(first), first)
    const second = f.rollover(first)
    const verified = verifyCleanupReceiptChain(second, f.keys.publicKey, f.options)
    expect(verified).toMatchObject({ epoch: 2, archivedEpochCount: 2, payload: { sequence: 0 } })
    expect(verified.leases).toHaveLength(64)
    expect(f.archives.get(f.rootHash)).toBe(f.root)
  })

  it.each(['../staging', 'production/../staging', 'staging\\..', ''])('rejects non-canonical archive environment %s', (environment) => {
    expect(() => cleanupEpochArchivePath(environment, 'a'.repeat(64))).toThrow(/malformed/)
  })

  it('rejects traversal and missing files and verifies the checked-in original with the pinned public key', () => {
    expect(() => cleanupEpochArchivePath('staging', '../arbitrary')).toThrow(/malformed/)
    expect(() => readCleanupEpochArchive('staging', '0'.repeat(64))).toThrow(/missing or unsafe/)
    const hash = '2f34d77f5313398a4fdf6e06a9f926306063a7963943e2fc6e6b3b773aae3e77'
    const raw = readCleanupEpochArchive('staging', hash)
    const key = readFileSync(new URL('../config/ephemeral-release-public-key.pem', import.meta.url), 'utf8')
    expect(verifyCleanupReceiptChain(raw, key, { environment: 'staging', now: NOW }))
      .toMatchObject({ receiptHash: hash, epoch: 0, payload: { sequence: 32 } })
  })
})
