import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  publicKeyFingerprint,
  attestationEnvelopeHash,
  signAttestation,
} from './ephemeral-release-attestation.mjs'
import {
  CLEANUP_ABSENT_SECRET_NAMES,
  fetchAndVerifyEphemeralCleanupReceipt,
  fetchAndVerifyCleanupHistory,
  verifyEphemeralCleanupReceipt,
} from './verify-ephemeral-cleanup-receipt.mjs'
import { createCleanupEpochSuccessor } from './ephemeral-cleanup-epochs.mjs'
import { appendClosedLeaseReceipt } from './ephemeral-release-supervisor-core.mjs'

const SHA = 'a'.repeat(40)
const OLD_LEASE = 'b'.repeat(32)
const NEW_LEASE = 'c'.repeat(32)
const HASH = 'd'.repeat(64)
const NOW = Date.parse('2026-08-25T05:00:00Z')

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    run_attempt: 1,
    // GitHub's workflow-runs API reports the evaluated run-name here, rather
    // than the static workflow `name`. The path and signed title are the
    // stable identity checks used by the production verifier.
    name: `Deploy staging ${SHA} (lease=${OLD_LEASE}, storage-backup=true)`,
    path: '.github/workflows/deploy-staging.yml',
    display_title: `Deploy staging ${SHA} (lease=${OLD_LEASE}, storage-backup=true)`,
    event: 'workflow_dispatch',
    head_branch: 'main',
    head_sha: SHA,
    created_at: '2026-08-25T03:00:00Z',
    updated_at: '2026-08-25T03:30:00Z',
    repository: { full_name: 'haengjoo123/buril-lab' },
    head_repository: { full_name: 'haengjoo123/buril-lab' },
    credential_lease_gate_succeeded: true,
    credential_run_attempt: 1,
    credential_run_updated_at: '2026-08-25T03:30:00Z',
    ...overrides,
  }
}

function currentRun() {
  return run({
    id: 202,
    name: `Deploy staging ${SHA} (lease=${NEW_LEASE}, storage-backup=false)`,
    display_title: `Deploy staging ${SHA} (lease=${NEW_LEASE}, storage-backup=false)`,
    created_at: '2026-08-25T04:00:00Z',
    updated_at: '2026-08-25T04:30:00Z',
  })
}

function signedReceipt(keys: ReturnType<typeof generateKeyPairSync>, runs: ReturnType<typeof run>[], overrides: Record<string, unknown> = {}) {
  const leases = runs.map((item) => {
    const title = String(item.display_title).match(
      /^Deploy staging ([0-9a-f]{40}) \(lease=([0-9a-f]{32}), storage-backup=(true|false)\)$/,
    )
    if (!title) throw new Error('test fixture has an invalid title')
    return {
      run_id: String(item.id),
      run_attempt: item.run_attempt,
      commit_sha: title[1],
      lease_id: title[2],
      storage_backup: title[3] === 'true',
      closed_at: '2026-08-25T04:30:00Z',
      previous_cleanup_receipt_sha256: '9'.repeat(64),
      cloudflare_token_id_hashes: title[3] === 'true' ? [HASH, 'e'.repeat(64)] : [HASH],
      supabase_pat_label_hash: 'f'.repeat(64),
      supabase_pat_sha256: '0'.repeat(64),
      providers_inactive: true,
    }
  })
  return signAttestation({
    version: 3,
    kind: 'cleanup_receipt',
    environment: 'staging',
    workflow: 'deploy-staging.yml',
    issued_at: '2026-08-25T04:45:00Z',
    sequence: leases.length,
    legacy_verification_mode: 'operator_dashboard_attestation',
    github_secrets_absent: [...CLEANUP_ABSENT_SECRET_NAMES],
    legacy_credentials: [
      { provider: 'cloudflare', credential_id_hash: '1'.repeat(64), status: 'operator_verified_absent' },
      { provider: 'supabase', credential_id_hash: '2'.repeat(64), status: 'operator_verified_absent' },
    ],
    leases,
    supervisor_key_id: publicKeyFingerprint(keys.publicKey),
    ...overrides,
  }, keys.privateKey)
}

function environment(receipt: string, overrides: Record<string, string> = {}) {
  return {
    GITHUB_TOKEN: 'not-a-real-github-token',
    GITHUB_REPOSITORY: 'haengjoo123/buril-lab',
    GITHUB_RUN_ID: '202',
    GITHUB_RUN_ATTEMPT: '1',
    DEPLOY_ENVIRONMENT: 'staging',
    DEPLOY_LEASE_ID: NEW_LEASE,
    EPHEMERAL_CLEANUP_RECEIPT: receipt,
    ...overrides,
  }
}

describe('signed cumulative ephemeral cleanup receipt', () => {
  it('reads and verifies every archived and current-epoch GitHub gate without a time cutoff', async () => {
    const keys = generateKeyPairSync('ed25519')
    const prior = Array.from({ length: 32 }, (_, index) => run({ id: 1000 + index,
      display_title: `Deploy staging ${SHA} (lease=${index.toString(16).padStart(32, '0')}, storage-backup=false)`,
    }))
    const archived = signedReceipt(keys, prior)
    const hash = attestationEnvelopeHash(archived)
    const readArchive = (_environment: string, target: string) => {
      if (target !== hash) throw new Error('missing archive')
      return archived
    }
    const empty = createCleanupEpochSuccessor({ previousReceipt: archived, environment: 'staging', publicKey: keys.publicKey,
      privateKey: keys.privateKey, now: NOW - 5 * 60_000, readArchive })
    const latest = run({ id: 2000, display_title: `Deploy staging ${SHA} (lease=${'e'.repeat(32)}, storage-backup=false)`,
      created_at: '2026-08-25T04:50:00Z', updated_at: '2026-08-25T04:51:00Z', credential_run_updated_at: '2026-08-25T04:51:00Z', conclusion: 'failure',
    })
    const receipt = appendClosedLeaseReceipt({ previousReceipt: empty, environment: 'staging', publicKey: keys.publicKey, privateKey: keys.privateKey,
      run: { id: 2000, runAttempt: 1, commitSha: SHA, leaseId: 'e'.repeat(32), storageBackup: false, updatedAt: latest.updated_at },
      cloudflareTokenIdHashes: [HASH], supabasePatLabelHash: 'f'.repeat(64), supabasePatSha256: '0'.repeat(64), now: NOW, readArchive,
    })
    const all = [...prior, latest]
    let includeAnchor = true
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      let payload
      if (url.pathname.endsWith('/jobs')) {
        const id = Number(url.pathname.split('/').at(-2))
        const matching = all.find((item) => item.id === id)
        if (!matching) throw new Error('unapproved synthetic run')
        payload = { jobs: [{ id: id + 10_000, run_id: id, run_attempt: 1, name: 'Supervised deploy of verified commit to buril-lab-staging',
          status: 'completed', conclusion: matching.conclusion || 'success', completed_at: matching.credential_run_updated_at,
          steps: [{ name: 'Verify the signed current ephemeral lease', status: 'completed', conclusion: 'success' },
            { name: 'Verify the signed cumulative credential cleanup receipt', status: 'completed', conclusion: 'success' }],
        }] }
      } else {
        const listed = includeAnchor ? [...all, currentRun()] : all
        payload = { total_count: listed.length, workflow_runs: listed }
      }
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    await expect(fetchAndVerifyEphemeralCleanupReceipt(environment(receipt), { now: NOW, publicKey: keys.publicKey, readArchive, fetchImpl: fetchMock }))
      .resolves.toMatchObject({ coveredRunCount: 33, epoch: 1, currentEpochLeaseCount: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(34)
    includeAnchor = false
    // Local preflight deliberately does not exclude a caller-supplied current ID.
    await expect(fetchAndVerifyCleanupHistory(environment(receipt, { GITHUB_RUN_ID: '2000' }), {
      now: NOW, publicKey: keys.publicKey, readArchive, fetchImpl: fetchMock,
    })).resolves.toMatchObject({ coveredRunCount: 33 })
    all.push(run({ id: 3000, display_title: `Deploy staging ${SHA} (lease=${'d'.repeat(32)}, storage-backup=false)` }))
    await expect(fetchAndVerifyCleanupHistory(environment(receipt), { now: NOW, publicKey: keys.publicKey, readArchive, fetchImpl: fetchMock }))
      .rejects.toThrow(/every prior/)
  })

  it('requires a signed initial cleanup even when no prior leased run exists', () => {
    const keys = generateKeyPairSync('ed25519')
    const receipt = signedReceipt(keys, [])
    expect(verifyEphemeralCleanupReceipt([], environment(receipt), { now: NOW, publicKey: keys.publicKey }))
      .toMatchObject({ coveredRunCount: 0 })
    expect(() => verifyEphemeralCleanupReceipt([], environment(''), { now: NOW, publicKey: keys.publicKey }))
      .toThrow(/attestation envelope/)
  })

  it('requires one signed closure for every prior leased run, including failed later runs', () => {
    const keys = generateKeyPairSync('ed25519')
    const first = run()
    const second = run({
      id: 102,
      display_title: `Deploy staging ${SHA} (lease=${'3'.repeat(32)}, storage-backup=false)`,
      created_at: '2026-08-25T04:00:00Z',
      updated_at: '2026-08-25T04:10:00Z',
      credential_run_updated_at: '2026-08-25T04:10:00Z',
      conclusion: 'failure',
    })
    const complete = signedReceipt(keys, [first, second])
    expect(verifyEphemeralCleanupReceipt([first, second], environment(complete), {
      now: NOW,
      publicKey: keys.publicKey,
    })).toMatchObject({ coveredRunCount: 2 })

    const onlyLatest = signedReceipt(keys, [second])
    expect(() => verifyEphemeralCleanupReceipt([first, second], environment(onlyLatest), {
      now: NOW,
      publicKey: keys.publicKey,
    })).toThrow(/cover every prior|omits/)
  })

  it('ignores a manual dispatch that never passed the signed lease gate', () => {
    const keys = generateKeyPairSync('ed25519')
    const unsigned = run({
      credential_lease_gate_succeeded: false,
      credential_run_attempt: undefined,
      credential_run_updated_at: undefined,
    })
    const receipt = signedReceipt(keys, [])
    expect(verifyEphemeralCleanupReceipt([unsigned], environment(receipt), {
      now: NOW,
      publicKey: keys.publicKey,
    })).toMatchObject({ coveredRunCount: 0 })
  })

  it('rejects fake booleans, arbitrary hashes, tampering, and lease reuse', () => {
    const keys = generateKeyPairSync('ed25519')
    const prior = run()
    const receipt = signedReceipt(keys, [prior])
    const parsed = JSON.parse(receipt)
    parsed.signature = 'A'.repeat(86)
    expect(() => verifyEphemeralCleanupReceipt([prior], environment(JSON.stringify(parsed)), {
      now: NOW,
      publicKey: keys.publicKey,
    })).toThrow(/signature/)

    expect(() => verifyEphemeralCleanupReceipt([prior], environment(receipt, {
      DEPLOY_LEASE_ID: OLD_LEASE,
    }), { now: NOW, publicKey: keys.publicKey })).toThrow(/must never be reused/)

    const missingProvider = signedReceipt(keys, [prior], {
      legacy_credentials: [
        { provider: 'supabase', credential_id_hash: '2'.repeat(64), status: 'operator_verified_absent' },
      ],
    })
    expect(() => verifyEphemeralCleanupReceipt([prior], environment(missingProvider), {
      now: NOW,
      publicKey: keys.publicKey,
    })).toThrow(/both legacy Supabase and Cloudflare/)
  })

  it('accepts a late but genuine cleanup after the run instead of imposing a two-hour deadline', () => {
    const keys = generateKeyPairSync('ed25519')
    const oldRun = run({
      created_at: '2026-08-20T03:00:00Z',
      updated_at: '2026-08-20T03:30:00Z',
    })
    const receipt = signedReceipt(keys, [oldRun])
    expect(verifyEphemeralCleanupReceipt([oldRun], environment(receipt), {
      now: NOW,
      publicKey: keys.publicKey,
    })).toMatchObject({ coveredRunCount: 1 })
  })

  it('fails closed before the cumulative GitHub variable approaches its size limit', () => {
    const keys = generateKeyPairSync('ed25519')
    const priorRuns = Array.from({ length: 33 }, (_, index) => run({
      id: 1000 + index,
      display_title: `Deploy staging ${SHA} (lease=${index.toString(16).padStart(32, '0')}, storage-backup=false)`,
    }))
    const receipt = signedReceipt(keys, priorRuns)
    expect(() => verifyEphemeralCleanupReceipt(priorRuns, environment(receipt), {
      now: NOW,
      publicKey: keys.publicKey,
    })).toThrow(/cover every prior|invalid sequence|lease epoch/)
  })

  it('paginates instead of allowing 100 unrelated runs to hide an older lease', async () => {
    const keys = generateKeyPairSync('ed25519')
    const prior = run()
    const unrelated = Array.from({ length: 100 }, (_, index) => ({
      ...run({ id: 1000 + index }),
      display_title: `legacy run ${index}`,
    }))
    const receipt = signedReceipt(keys, [prior])
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      const isJobs = url.pathname.endsWith('/actions/runs/101/jobs')
      const page = url.searchParams.get('page')
      return new Response(JSON.stringify(isJobs
        ? {
            jobs: [{
              id: 999,
              run_id: 101,
              run_attempt: 1,
              name: 'Supervised deploy of verified commit to buril-lab-staging',
              status: 'completed',
              conclusion: 'success',
              completed_at: '2026-08-25T03:30:00Z',
              steps: [
                {
                  name: 'Verify the signed current ephemeral lease',
                  status: 'completed',
                  conclusion: 'success',
                },
                {
                  name: 'Verify the signed cumulative credential cleanup receipt',
                  status: 'completed',
                  conclusion: 'success',
                },
              ],
            }],
          }
        : { total_count: 102, workflow_runs: page === '1' ? unrelated : [prior, currentRun()] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    await expect(fetchAndVerifyEphemeralCleanupReceipt(environment(receipt), {
      now: NOW,
      publicKey: keys.publicKey,
      fetchImpl: fetchMock,
    })).resolves.toMatchObject({ coveredRunCount: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('ignores explicitly gate-failed dispatches before applying the 32-run epoch limit', async () => {
    const keys = generateKeyPairSync('ed25519')
    const candidates = Array.from({ length: 33 }, (_, index) => run({
      id: 2000 + index,
      display_title: `Deploy staging ${SHA} (lease=${(index + 10).toString(16).padStart(32, '0')}, storage-backup=false)`,
    }))
    const receipt = signedReceipt(keys, [])
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/jobs')) {
        const runId = Number(url.pathname.split('/').at(-2))
        return new Response(JSON.stringify({
          jobs: [{
            id: runId + 10_000,
            run_id: runId,
            run_attempt: 1,
            name: 'Supervised deploy of verified commit to buril-lab-staging',
            status: 'completed',
            conclusion: 'failure',
            completed_at: '2026-08-25T03:30:00Z',
            steps: [
              { name: 'Verify the signed current ephemeral lease', status: 'completed', conclusion: 'failure' },
              { name: 'Verify the signed cumulative credential cleanup receipt', status: 'completed', conclusion: 'skipped' },
            ],
          }],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({
        total_count: candidates.length + 1,
        workflow_runs: [...candidates, currentRun()],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    await expect(fetchAndVerifyEphemeralCleanupReceipt(environment(receipt), {
      now: NOW,
      publicKey: keys.publicKey,
      fetchImpl: fetchMock,
    })).resolves.toMatchObject({ coveredRunCount: 0 })

    const indeterminateFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      return new Response(JSON.stringify(url.pathname.endsWith('/jobs')
        ? { jobs: [] }
        : { total_count: 2, workflow_runs: [candidates[0], currentRun()] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    await expect(fetchAndVerifyEphemeralCleanupReceipt(environment(receipt), {
      now: NOW,
      publicKey: keys.publicKey,
      fetchImpl: indeterminateFetch,
    })).rejects.toThrow(/job evidence is incomplete/)

    const cleanupGateFailed = run({
      id: 3000,
      display_title: `Deploy staging ${SHA} (lease=${'9'.repeat(32)}, storage-backup=false)`,
    })
    const gateFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      return new Response(JSON.stringify(url.pathname.endsWith('/jobs')
        ? {
            jobs: [{
              id: 999,
              run_id: 3000,
              run_attempt: 1,
              name: 'Supervised deploy of verified commit to buril-lab-staging',
              status: 'completed',
              conclusion: 'failure',
              completed_at: '2026-08-25T03:30:00Z',
              steps: [
                { name: 'Verify the signed current ephemeral lease', status: 'completed', conclusion: 'success' },
                { name: 'Verify the signed cumulative credential cleanup receipt', status: 'completed', conclusion: 'failure' },
              ],
            }],
          }
        : { total_count: 2, workflow_runs: [cleanupGateFailed, currentRun()] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    await expect(fetchAndVerifyEphemeralCleanupReceipt(environment(receipt), {
      now: NOW,
      publicKey: keys.publicKey,
      fetchImpl: gateFetch,
    })).resolves.toMatchObject({ coveredRunCount: 0 })
  })

  it('rejects an incomplete run page instead of treating total_count as an empty history', async () => {
    const keys = generateKeyPairSync('ed25519')
    const receipt = signedReceipt(keys, [])
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      total_count: 1,
      workflow_runs: [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    await expect(fetchAndVerifyEphemeralCleanupReceipt(environment(receipt), {
      now: NOW,
      publicKey: keys.publicKey,
      fetchImpl: fetchMock,
    })).rejects.toThrow(/incomplete.*total_count/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('requires the exact current run anchor even when an empty page has a matching total_count', async () => {
    const keys = generateKeyPairSync('ed25519')
    const receipt = signedReceipt(keys, [])
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      total_count: 0,
      workflow_runs: [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    await expect(fetchAndVerifyEphemeralCleanupReceipt(environment(receipt), {
      now: NOW,
      publicKey: keys.publicKey,
      fetchImpl: fetchMock,
    })).rejects.toThrow(/exact current workflow run anchor/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
