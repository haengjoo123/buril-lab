import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createInitialCleanupReceipt, createLeaseMaterial, sha256 } from './ephemeral-release-supervisor-core.mjs'
import { verifyEphemeralSupabaseLease } from './verify-ephemeral-supabase-lease.mjs'

const NOW = Date.parse('2026-08-25T05:00:00Z')
const SHA = 'a'.repeat(40)
const LEASE = 'b'.repeat(32)
const PAT = 'sbp_test_ephemeral_pat_material_1234567890'

function fixture() {
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
  const material = createLeaseMaterial({
    environment: 'staging',
    commitSha: SHA,
    leaseId: LEASE,
    storageBackup: false,
    cleanupReceipt: receipt,
    cloudflareTokenIdHashes: [sha256('c'.repeat(32))],
    cloudflareTokens: ['cloudflare-pages-token-material-1234567890'],
    supabasePatLabel: `burillab-staging-${LEASE}`,
    supabasePat: PAT,
    privateKey: keys.privateKey,
    now: NOW,
  })
  return {
    keys,
    environment: {
      DEPLOY_ENVIRONMENT: 'staging',
      DEPLOY_COMMIT_SHA: SHA,
      DEPLOY_LEASE_ID: LEASE,
      DEPLOY_STORAGE_BACKUP: 'false',
      EPHEMERAL_CLEANUP_RECEIPT: receipt,
      EPHEMERAL_LEASE_GRANT: material.grant,
      SUPABASE_ACCESS_TOKEN: PAT,
    },
  }
}

describe('ephemeral Supabase lease binding', () => {
  it('accepts only the exact PAT whose hash is signed in the current lease', () => {
    const value = fixture()
    expect(verifyEphemeralSupabaseLease(value.environment, value.keys.publicKey, { now: NOW }))
      .toMatchObject({ environment: 'staging', commitSha: SHA, leaseId: LEASE })
    expect(() => verifyEphemeralSupabaseLease({
      ...value.environment,
      SUPABASE_ACCESS_TOKEN: 'sbp_different_ephemeral_pat_material_123456',
    }, value.keys.publicKey, { now: NOW })).toThrow(/does not match the signed release lease/)
  })

  it('rejects a PAT paired with a stale or expired signed grant', () => {
    const value = fixture()
    expect(() => verifyEphemeralSupabaseLease(value.environment, value.keys.publicKey, {
      now: NOW + 41 * 60_000,
    })).toThrow(/45-minute window/)
  })
})
