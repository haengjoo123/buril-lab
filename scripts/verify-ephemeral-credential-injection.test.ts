import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  createCredentialInjectionProbe,
  createInitialCleanupReceipt,
  createLeaseMaterial,
  sha256,
} from './ephemeral-release-supervisor-core.mjs'
import {
  verifyCredentialInjectionProbe,
  verifyLeaseCredentialInjection,
} from './verify-ephemeral-credential-injection.mjs'

const NOW = Date.parse('2026-08-26T06:00:00Z')
const SHA = 'a'.repeat(40)
const LEASE = 'b'.repeat(32)
const PROBE = 'c'.repeat(32)
const SUPABASE_SECRET = 'supabase-ephemeral-credential-material-1234567890'
const PAGES_SECRET = 'cloudflare-pages-ephemeral-credential-material-1234567890'

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
  const probe = createCredentialInjectionProbe({
    environment: 'staging',
    commitSha: SHA,
    probeId: PROBE,
    cleanupReceipt: receipt,
    supabaseProbeSecret: SUPABASE_SECRET,
    pagesProbeSecret: PAGES_SECRET,
    privateKey: keys.privateKey,
    now: NOW,
  })
  const lease = createLeaseMaterial({
    environment: 'staging',
    commitSha: SHA,
    leaseId: LEASE,
    storageBackup: false,
    cleanupReceipt: receipt,
    cloudflareTokenIdHashes: [sha256('cloudflare-token-id')],
    cloudflareTokens: [PAGES_SECRET],
    supabasePatLabel: `burillab-staging-${LEASE}`,
    supabasePat: SUPABASE_SECRET,
    privateKey: keys.privateKey,
    now: NOW,
  })
  return {
    keys,
    probeEnvironment: {
      DEPLOY_ENVIRONMENT: 'staging',
      DEPLOY_COMMIT_SHA: SHA,
      DEPLOY_PROBE_ID: PROBE,
      EPHEMERAL_CLEANUP_RECEIPT: receipt,
      EPHEMERAL_CREDENTIAL_PROBE_GRANT: probe.grant,
      SUPABASE_ACCESS_TOKEN: SUPABASE_SECRET,
      PAGES_EPHEMERAL_TOKEN: PAGES_SECRET,
    },
    leaseEnvironment: {
      DEPLOY_ENVIRONMENT: 'staging',
      DEPLOY_COMMIT_SHA: SHA,
      DEPLOY_LEASE_ID: LEASE,
      DEPLOY_STORAGE_BACKUP: 'false',
      EPHEMERAL_CLEANUP_RECEIPT: receipt,
      EPHEMERAL_LEASE_GRANT: lease.grant,
      SUPABASE_ACCESS_TOKEN: SUPABASE_SECRET,
      PAGES_EPHEMERAL_TOKEN: PAGES_SECRET,
    },
  }
}

describe('ephemeral credential-injection verification', () => {
  it('accepts only the exact signed Staging environment-secret probe', () => {
    const value = fixture()
    expect(verifyCredentialInjectionProbe(value.probeEnvironment, value.keys.publicKey, { now: NOW }))
      .toMatchObject({ environment: 'staging', commitSha: SHA, probeId: PROBE })
  })

  it('rejects a substituted injected value without exposing it', () => {
    const value = fixture()
    let thrown: unknown
    try {
      verifyCredentialInjectionProbe({
        ...value.probeEnvironment,
        PAGES_EPHEMERAL_TOKEN: 'different-cloudflare-pages-credential-material-123456',
      }, value.keys.publicKey, { now: NOW })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toMatch(/does not match its signed binding/)
    expect((thrown as Error).message).not.toContain(PAGES_SECRET)
  })

  it('rejects an expired or cleanup-mismatched probe', () => {
    const value = fixture()
    expect(() => verifyCredentialInjectionProbe(value.probeEnvironment, value.keys.publicKey, {
      now: NOW + 11 * 60_000,
    })).toThrow(/15-minute window/)
    expect(() => verifyCredentialInjectionProbe({
      ...value.probeEnvironment,
      EPHEMERAL_CLEANUP_RECEIPT: 'other-receipt',
    }, value.keys.publicKey, { now: NOW })).toThrow(/does not match the exact Staging request/)
  })

  it('binds a deployment runner to both real credentials in its signed lease', () => {
    const value = fixture()
    expect(verifyLeaseCredentialInjection(value.leaseEnvironment, value.keys.publicKey, { now: NOW }))
      .toMatchObject({ environment: 'staging', commitSha: SHA, leaseId: LEASE })
    expect(() => verifyLeaseCredentialInjection({
      ...value.leaseEnvironment,
      SUPABASE_ACCESS_TOKEN: 'different-supabase-credential-material-1234567890',
    }, value.keys.publicKey, { now: NOW })).toThrow(/does not match its signed binding/)
  })
})
