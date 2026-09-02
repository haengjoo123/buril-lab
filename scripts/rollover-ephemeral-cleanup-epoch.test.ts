import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { attestationEnvelopeHash, verifySignedAttestation } from './ephemeral-release-attestation.mjs'
import { createInitialCleanupReceipt, appendClosedLeaseReceipt } from './ephemeral-release-supervisor-core.mjs'
import { verifyCleanupReceiptHistory } from './verify-ephemeral-cleanup-receipt.mjs'
import { runCleanupEpochRollover } from './rollover-ephemeral-cleanup-epoch.mjs'

const NOW = Date.parse('2026-09-03T00:00:00Z')
const SHA = 'a'.repeat(40)

function setup() {
  const keys = generateKeyPairSync('ed25519')
  let root = createInitialCleanupReceipt({ environment: 'staging', privateKey: keys.privateKey, now: NOW - 100_000,
    legacyCredentials: [{ provider: 'cloudflare', credentialIdHash: '1'.repeat(64) }, { provider: 'supabase', credentialIdHash: '2'.repeat(64) }],
  })
  for (let id = 1000; id < 1032; id += 1) {
    root = appendClosedLeaseReceipt({ previousReceipt: root, environment: 'staging', publicKey: keys.publicKey, privateKey: keys.privateKey,
      run: { id, runAttempt: 1, commitSha: SHA, leaseId: id.toString(16).padStart(32, '0'), storageBackup: false,
        updatedAt: new Date(NOW - 60_000).toISOString() },
      cloudflareTokenIdHashes: ['3'.repeat(64)], supabasePatLabelHash: '4'.repeat(64), supabasePatSha256: '5'.repeat(64), now: NOW - 50_000,
    })
  }
  const expectedHash = attestationEnvelopeHash(root)
  const runs = verifySignedAttestation(root, keys.publicKey, 'cleanup_receipt').payload.leases.map((entry: Record<string, unknown>) => ({
    id: Number(entry.run_id), run_attempt: 1, path: '.github/workflows/deploy-staging.yml', event: 'workflow_dispatch', head_branch: 'main',
    head_sha: SHA, display_title: `Deploy staging ${SHA} (lease=${entry.lease_id}, storage-backup=false)`,
    repository: { full_name: 'haengjoo123/buril-lab' }, head_repository: { full_name: 'haengjoo123/buril-lab' },
    created_at: new Date(NOW - 70_000).toISOString(), updated_at: new Date(NOW - 60_000).toISOString(),
    credential_lease_gate_succeeded: true, credential_run_attempt: 1, credential_run_updated_at: new Date(NOW - 60_000).toISOString(),
  }))
  const state = {
    current: root, mirror: root, dirty: false, wrongHead: false, failQuality: false, missingJob: false,
    untrackedArchive: false, pending: '', secret: '', dropMirror: false, losePrimaryResponse: false,
    changeBeforeWrite: false, receiptReads: 0,
  }
  const names = ['Application checks', 'Blank database interface', 'Cloudflare release contract', 'Gate 0 browser interface']
  const run = vi.fn(async (args: string[]) => {
    if (args[0] === 'secret' && args[1] === 'list') {
      return JSON.stringify(args.includes('--env') && state.secret ? [{ name: state.secret }] : [])
    }
    if (args[0] === 'variable' && args[1] === 'list') {
      return JSON.stringify(args.includes('--env') && state.pending ? [{ name: state.pending }] : [])
    }
    if (args[0] === 'variable' && args[1] === 'get') {
      if (args[2] === 'EPHEMERAL_CLEANUP_RECEIPT') {
        state.receiptReads += 1
        return state.changeBeforeWrite && state.receiptReads > 1 ? 'changed' : state.current
      }
      if (args[2] === 'STAGING_EPHEMERAL_CLEANUP_RECEIPT') return state.mirror
    }
    if (args[0] === 'variable' && args[1] === 'set') {
      const body = args[args.indexOf('--body') + 1]
      if (args[2] === 'EPHEMERAL_CLEANUP_RECEIPT') {
        state.current = body
        if (state.losePrimaryResponse) throw new Error('synthetic lost acknowledgement')
        return ''
      }
      if (args[2] === 'STAGING_EPHEMERAL_CLEANUP_RECEIPT') {
        if (!state.dropMirror) state.mirror = body
        return ''
      }
    }
    if (args[0] === 'auth' && args[1] === 'token') return 'synthetic-managed-github-session-only'
    if (args[0] === 'api' && args[1].endsWith('/commits/main')) return state.wrongHead ? 'b'.repeat(40) : SHA
    if (args[0] === 'api' && args[1].includes('/quality.yml/runs?')) return JSON.stringify({ workflow_runs: [{
      id: 5000, event: 'push', head_branch: 'main', head_sha: SHA, head_repository: { full_name: 'haengjoo123/buril-lab' },
      status: 'completed', conclusion: state.failQuality ? 'failure' : 'success', run_attempt: 1,
      created_at: new Date(NOW - 20_000).toISOString(), run_started_at: new Date(NOW - 15_000).toISOString(), updated_at: new Date(NOW - 10_000).toISOString(),
    }] })
    if (args[0] === 'api' && args[1].includes('/runs/5000/jobs?')) return JSON.stringify({ total_count: 4,
      jobs: (state.missingJob ? names.slice(1) : names).map((name) => ({ name, run_id: 5000, status: 'completed', conclusion: 'success' })),
    })
    throw new Error('unapproved synthetic CLI operation')
  })
  const git = vi.fn(async (args: string[]) => {
    if (args[0] === 'rev-parse') return SHA
    if (args[0] === 'status') return state.dirty ? ' M scripts/example.mjs' : ''
    if (args[0] === 'ls-files') return state.untrackedArchive ? '' : args.at(-1) as string
    throw new Error('unapproved synthetic Git operation')
  })
  const readArchive = (_environment: string, hash: string) => {
    if (hash !== expectedHash) throw new Error('missing exact archive')
    return root
  }
  const loadKey = vi.fn(async () => keys.privateKey)
  const fetchHistory = vi.fn(async (environment: Record<string, string>, opts: Record<string, unknown>) => verifyCleanupReceiptHistory(runs, environment, opts))
  const options = { run, git, publicKey: keys.publicKey, loadKey, fetchHistory, now: NOW, readArchive }
  const input = { mode: 'apply', environment: 'staging', expectedHash, confirmation: `ROLLOVER staging ${expectedHash}` }
  const writes = () => run.mock.calls.filter(([args]) => args[0] === 'variable' && args[1] === 'set')
  return { input, options, state, root, keys, writes, runs }
}

describe('supervised cleanup epoch plan/apply and forward-only recovery', () => {
  it('plans read-only, audits all 32 runs, and does not load the private key', async () => {
    const f = setup()
    await expect(runCleanupEpochRollover({ ...f.input, mode: 'plan' }, f.options))
      .resolves.toMatchObject({ mode: 'plan', nextEpoch: 1, preservedLeaseCount: 32, state: 'ready', reviewed: null })
    expect(f.writes()).toHaveLength(0)
    expect(f.options.loadKey).not.toHaveBeenCalled()
    expect(f.options.git).not.toHaveBeenCalled()
    expect(f.options.fetchHistory).toHaveBeenCalledTimes(1)
  })

  it('applies only the exact signed successor and mirror after all four main jobs', async () => {
    const f = setup()
    const result = await runCleanupEpochRollover(f.input, f.options)
    expect(result).toMatchObject({ state: 'complete', currentEpochLeaseCount: 0, preservedLeaseCount: 32,
      reviewed: { commitSha: SHA, qualityRunId: '5000' } })
    expect(f.state.current).toBe(f.state.mirror)
    expect(f.writes()).toHaveLength(2)
    expect(verifySignedAttestation(f.state.current, f.keys.publicKey, 'cleanup_receipt').payload)
      .toMatchObject({ version: 4, epoch: 1, sequence: 0, previous_epoch_receipt_sha256: f.input.expectedHash })
    expect(f.options.run.mock.calls.some(([args]) => args[0] === 'workflow' || (args[0] === 'secret' && args[1] !== 'list'))).toBe(false)
  })

  it('recovers a partial mirror write without re-signing or discarding the original', async () => {
    const f = setup()
    f.state.dropMirror = true
    await expect(runCleanupEpochRollover(f.input, f.options)).rejects.toThrow(/mirror is pending/)
    const stored = f.state.current
    expect(stored).not.toBe(f.root)
    expect(f.state.mirror).toBe(f.root)
    f.state.dropMirror = false
    await expect(runCleanupEpochRollover(f.input, f.options)).resolves.toMatchObject({ state: 'complete' })
    expect(f.state.current).toBe(stored)
    expect(f.state.mirror).toBe(stored)
    expect(f.options.loadKey).toHaveBeenCalledTimes(1)
    expect(f.writes().filter(([args]) => args[2] === 'EPHEMERAL_CLEANUP_RECEIPT')).toHaveLength(1)
  })

  it('accepts a lost write acknowledgement only after an exact authoritative read', async () => {
    const f = setup()
    f.state.losePrimaryResponse = true
    await expect(runCleanupEpochRollover(f.input, f.options)).resolves.toMatchObject({ state: 'complete' })
    expect(f.state.current).toBe(f.state.mirror)
  })

  it.each(['dirty', 'wrongHead', 'failQuality', 'missingJob', 'untrackedArchive', 'changeBeforeWrite'] as const)('does not mutate on %s', async (fault) => {
    const f = setup()
    f.state[fault] = true
    await expect(runCleanupEpochRollover(f.input, f.options)).rejects.toThrow()
    expect(f.writes()).toHaveLength(0)
    expect(f.options.loadKey).not.toHaveBeenCalled()
    expect(f.state.current).toBe(f.root)
  })

  it.each(['EPHEMERAL_PROVIDER_CREATION_PENDING', 'EPHEMERAL_LEASE_GRANT', 'EPHEMERAL_CREDENTIAL_PROBE_GRANT'])('blocks pending work: %s', async (name) => {
    const f = setup()
    f.state.pending = name
    await expect(runCleanupEpochRollover(f.input, f.options)).rejects.toThrow(/no temporary credentials or pending work/)
    expect(f.writes()).toHaveLength(0)
    expect(f.options.loadKey).not.toHaveBeenCalled()
  })

  it.each(['STAGING_PAGES_EPHEMERAL_TOKEN', 'SUPABASE_HOSTED_ADVISOR_EPHEMERAL_TOKEN', 'STAGING_CLOUDFLARE_STORAGE_BACKUP_ACCEPTANCE_TOKEN'])('blocks a remaining temporary secret: %s', async (name) => {
    const f = setup()
    f.state.secret = name
    await expect(runCleanupEpochRollover(f.input, f.options)).rejects.toThrow(/no temporary credentials or pending work/)
    expect(f.writes()).toHaveLength(0)
  })

  it('does not sign when an actual leased run is omitted from the audit', async () => {
    const f = setup()
    f.runs.pop()
    await expect(runCleanupEpochRollover(f.input, f.options)).rejects.toThrow(/every prior/)
    expect(f.writes()).toHaveLength(0)
    expect(f.options.loadKey).not.toHaveBeenCalled()
  })

  it('refuses an unrelated mirror or different confirmation', async () => {
    const f = setup()
    f.state.mirror = 'not-the-exact-signed-receipt'
    await expect(runCleanupEpochRollover(f.input, f.options)).rejects.toThrow(/mirror/)
    f.state.mirror = f.root
    await expect(runCleanupEpochRollover({ ...f.input, confirmation: 'approve everything' }, f.options)).rejects.toThrow(/confirmation/)
    expect(f.writes()).toHaveLength(0)
  })
})
