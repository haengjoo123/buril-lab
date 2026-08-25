import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  attestationEnvelopeHash,
  publicKeyFingerprint,
  signAttestation,
  verifySignedAttestation,
} from './ephemeral-release-attestation.mjs'
import {
  parseMinimumRemainingSeconds,
  verifyEphemeralLeaseGrant,
} from './verify-ephemeral-lease-grant.mjs'

const NOW = Date.parse('2026-08-25T05:00:00Z')
const SHA = 'a'.repeat(40)
const LEASE = 'b'.repeat(32)
const HASH = 'c'.repeat(64)

function fixture(overrides: Record<string, unknown> = {}) {
  const keys = generateKeyPairSync('ed25519')
  const keyId = publicKeyFingerprint(keys.publicKey)
  const receipt = signAttestation({
    kind: 'cleanup_receipt',
    supervisor_key_id: keyId,
  }, keys.privateKey)
  const payload = {
    version: 1,
    kind: 'lease_grant',
    environment: 'staging',
    workflow: 'deploy-staging.yml',
    commit_sha: SHA,
    lease_id: LEASE,
    storage_backup: true,
    issued_at: '2026-08-25T04:50:00Z',
    expires_at: '2026-08-25T05:30:00Z',
    cleanup_receipt_sha256: attestationEnvelopeHash(receipt),
    cloudflare_token_id_hashes: [HASH, 'd'.repeat(64)],
    cloudflare_token_sha256: ['1'.repeat(64), '2'.repeat(64)],
    supabase_pat_label_hash: 'e'.repeat(64),
    supabase_pat_sha256: 'f'.repeat(64),
    staging_run_id: null,
    staging_cleanup_receipt_sha256: null,
    supervisor_key_id: keyId,
    ...overrides,
  }
  const grant = signAttestation(payload, keys.privateKey)
  return {
    keys,
    receipt,
    grant,
    environment: {
      DEPLOY_ENVIRONMENT: 'staging',
      DEPLOY_COMMIT_SHA: SHA,
      DEPLOY_LEASE_ID: LEASE,
      DEPLOY_STORAGE_BACKUP: 'true',
      EPHEMERAL_CLEANUP_RECEIPT: receipt,
      EPHEMERAL_LEASE_GRANT: grant,
    },
  }
}

describe('signed ephemeral lease grants', () => {
  it('binds the environment, commit, lease, cleanup state, and expected credentials', () => {
    const value = fixture()
    expect(verifyEphemeralLeaseGrant(value.environment, value.keys.publicKey, { now: NOW }))
      .toMatchObject({
        environment: 'staging',
        commitSha: SHA,
        leaseId: LEASE,
        storageBackup: true,
        cloudflareTokenIdHashes: [HASH, 'd'.repeat(64)],
        cloudflareTokenSha256: ['1'.repeat(64), '2'.repeat(64)],
      })
  })

  it.each([
    [{ DEPLOY_LEASE_ID: 'f'.repeat(32) }, /does not match/],
    [{ DEPLOY_COMMIT_SHA: 'f'.repeat(40) }, /does not match/],
    [{ DEPLOY_STORAGE_BACKUP: 'false' }, /does not match/],
    [{ EPHEMERAL_CLEANUP_RECEIPT: 'not-the-signed-receipt' }, /attestation envelope|not bound/],
  ])('rejects mismatched workflow inputs', (override, message) => {
    const value = fixture()
    expect(() => verifyEphemeralLeaseGrant({ ...value.environment, ...override }, value.keys.publicKey, { now: NOW }))
      .toThrow(message)
  })

  it('rejects an expired or overlong grant', () => {
    const expired = fixture({
      issued_at: '2026-08-25T03:00:00Z',
      expires_at: '2026-08-25T03:30:00Z',
    })
    expect(() => verifyEphemeralLeaseGrant(expired.environment, expired.keys.publicKey, { now: NOW }))
      .toThrow(/45-minute window/)

    const overlong = fixture({
      issued_at: '2026-08-25T04:45:00Z',
      expires_at: '2026-08-25T05:31:00Z',
    })
    expect(() => verifyEphemeralLeaseGrant(overlong.environment, overlong.keys.publicKey, { now: NOW }))
      .toThrow(/45-minute window/)
  })

  it('requires a validated remaining mutation window when requested', () => {
    const value = fixture({ expires_at: '2026-08-25T05:10:00Z' })
    expect(verifyEphemeralLeaseGrant({
      ...value.environment,
      EPHEMERAL_LEASE_MIN_REMAINING_SECONDS: '600',
    }, value.keys.publicKey, { now: NOW })).toMatchObject({ minimumRemainingSeconds: 600 })

    expect(() => verifyEphemeralLeaseGrant({
      ...value.environment,
      EPHEMERAL_LEASE_MIN_REMAINING_SECONDS: '601',
    }, value.keys.publicKey, { now: NOW })).toThrow(/required 601-second mutation window/)

    expect(() => verifyEphemeralLeaseGrant({
      ...value.environment,
      EPHEMERAL_LEASE_MIN_REMAINING_SECONDS: '0600',
    }, value.keys.publicKey, { now: NOW })).toThrow(/canonical non-negative integer/)
  })

  it('validates explicit minimum remaining seconds and defaults to zero', () => {
    expect(parseMinimumRemainingSeconds(undefined)).toBe(0)
    expect(parseMinimumRemainingSeconds('0')).toBe(0)
    expect(parseMinimumRemainingSeconds('1800')).toBe(1800)
    expect(() => parseMinimumRemainingSeconds('1801')).toThrow(/must not exceed 1800/)
    expect(() => parseMinimumRemainingSeconds('-1')).toThrow(/canonical non-negative integer/)
    expect(() => parseMinimumRemainingSeconds('1.5')).toThrow(/canonical non-negative integer/)

    const value = fixture({ expires_at: '2026-08-25T05:10:00Z' })
    expect(verifyEphemeralLeaseGrant(value.environment, value.keys.publicKey, {
      now: NOW,
      minimumRemainingSeconds: 600,
    })).toMatchObject({ minimumRemainingSeconds: 600 })
  })

  it('binds Production to one exact cleaned Staging run and receipt', () => {
    const value = fixture({
      environment: 'production',
      workflow: 'deploy-production.yml',
      storage_backup: false,
      cloudflare_token_id_hashes: [HASH],
      cloudflare_token_sha256: ['1'.repeat(64)],
      staging_run_id: '31',
      staging_cleanup_receipt_sha256: undefined,
    })
    const payload = verifySignedAttestation(value.grant, value.keys.publicKey, 'lease_grant').payload
    const productionGrant = signAttestation({
      ...payload,
      staging_cleanup_receipt_sha256: attestationEnvelopeHash(value.receipt),
    }, value.keys.privateKey)
    const environment = {
      ...value.environment,
      DEPLOY_ENVIRONMENT: 'production',
      DEPLOY_STORAGE_BACKUP: 'false',
      DEPLOY_STAGING_RUN_ID: '31',
      STAGING_EPHEMERAL_CLEANUP_RECEIPT: value.receipt,
      EPHEMERAL_LEASE_GRANT: productionGrant,
    }
    expect(verifyEphemeralLeaseGrant(environment, value.keys.publicKey, { now: NOW }))
      .toMatchObject({ environment: 'production', stagingRunId: '31' })
    expect(() => verifyEphemeralLeaseGrant({
      ...environment,
      DEPLOY_STAGING_RUN_ID: '32',
    }, value.keys.publicKey, { now: NOW })).toThrow(/exact cleaned Staging run/)
  })
})
