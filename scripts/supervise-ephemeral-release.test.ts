import { generateKeyPairSync } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  assertCleanupBootstrapAbsent,
  assertNoRepositoryCredentialState,
  credentialGateResult,
  credentialGatesSucceeded,
  credentialInjectionProbeResult,
  failedBeforePagesMutation,
  findDispatchedRun,
  findJournalRun,
  finalizeEphemeralReleaseLifecycle,
  parseDispatchedRunId,
  readHiddenTtyLine,
  removeCredentialSecrets,
  runGh,
  verifyAbortedLeaseReceipt,
  verifyPendingMarker,
  verifyLocalCleanupBeforeProviderCreation,
  withSupervisorProcessLock,
} from './supervise-ephemeral-release.mjs'
import { CLEANUP_ABSENT_SECRET_NAMES } from './verify-ephemeral-cleanup-receipt.mjs'
import {
  createAbortedLeaseReceipt,
  createInitialCleanupReceipt,
  createProviderCreationPending,
} from './ephemeral-release-supervisor-core.mjs'

describe('ephemeral release lifecycle finalization', () => {
  it('cannot use bootstrap to overwrite any existing signed receipt', async () => {
    const existing = vi.fn(async () => JSON.stringify([{ name: 'EPHEMERAL_CLEANUP_RECEIPT' }]))
    await expect(assertCleanupBootstrapAbsent('staging', { run: existing })).rejects.toThrow(/never be replaced by bootstrap/)
    expect(existing.mock.calls).toHaveLength(1)
    const empty = vi.fn(async () => '[]')
    await expect(assertCleanupBootstrapAbsent('staging', { run: empty })).resolves.toBeUndefined()
  })

  it('requires an exact Staging mirror and full history before new provider credentials', async () => {
    const keys = generateKeyPairSync('ed25519')
    const receipt = createInitialCleanupReceipt({ environment: 'staging', privateKey: keys.privateKey,
      legacyCredentials: [{ provider: 'cloudflare', credentialIdHash: '1'.repeat(64) }, { provider: 'supabase', credentialIdHash: '2'.repeat(64) }],
    })
    const run = vi.fn(async (args: string[]) => args[0] === 'variable' ? receipt : 'synthetic-managed-github-session-only')
    const fetchHistory = vi.fn(async () => ({ coveredRunCount: 0 }))
    await expect(verifyLocalCleanupBeforeProviderCreation('staging', receipt, keys.publicKey, { run, fetchHistory }))
      .resolves.toMatchObject({ coveredRunCount: 0 })
    expect(fetchHistory).toHaveBeenCalledTimes(1)
    expect(run.mock.calls.every(([args]) => (args[0] === 'variable' && args[1] === 'get') || args[0] === 'auth')).toBe(true)
    const mismatch = vi.fn(async () => 'not-the-signed-receipt')
    const notCalled = vi.fn()
    await expect(verifyLocalCleanupBeforeProviderCreation('staging', receipt, keys.publicKey, { run: mismatch, fetchHistory: notCalled }))
      .rejects.toThrow(/mirror is unfinished/)
    expect(notCalled).not.toHaveBeenCalled()
  })

  it('matches an aborted receipt against the signed journal envelope', () => {
    const keys = generateKeyPairSync('ed25519')
    const leaseId = 'd'.repeat(32)
    const cloudflareAccountId = 'e'.repeat(32)
    const cleanupReceipt = createInitialCleanupReceipt({
      environment: 'staging',
      legacyCredentials: [
        { provider: 'cloudflare', credentialIdHash: 'a'.repeat(64) },
        { provider: 'supabase', credentialIdHash: 'b'.repeat(64) },
      ],
      privateKey: keys.privateKey,
    })
    const journal = createProviderCreationPending({
      environment: 'staging',
      commitSha: 'c'.repeat(40),
      leaseId,
      storageBackup: false,
      supabasePatLabel: `burillab-staging-${leaseId}`,
      cloudflareAccountId,
      cleanupReceipt,
      privateKey: keys.privateKey,
    })
    const marker = verifyPendingMarker(journal, keys.publicKey, {
      environment: 'staging',
      leaseId,
      cloudflareAccountId,
    })
    const abortedReceipt = createAbortedLeaseReceipt({
      pendingMarker: journal,
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      providerEvidence: [
        { provider: 'cloudflare_pages', status: 'operator_verified_not_created', credentialSha256: null },
        { provider: 'supabase', status: 'operator_verified_not_created', credentialSha256: null },
      ],
    })

    expect(() => verifyAbortedLeaseReceipt(abortedReceipt, keys.publicKey, marker)).not.toThrow()
  })

  it('rejects repository-scoped fallback credentials and release variables', async () => {
    const secretRun = vi.fn(async (args: string[]) => (
      args[0] === 'secret'
        ? JSON.stringify([{ name: 'STAGING_PAGES_EPHEMERAL_TOKEN' }])
        : '[]'
    ))
    await expect(assertNoRepositoryCredentialState({ run: secretRun }))
      .rejects.toThrow(/bypass environment isolation/)

    const variableRun = vi.fn(async (args: string[]) => (
      args[0] === 'variable'
        ? JSON.stringify([{ name: 'EPHEMERAL_LEASE_GRANT' }])
        : '[]'
    ))
    await expect(assertNoRepositoryCredentialState({ run: variableRun }))
      .rejects.toThrow(/bypass environment isolation/)
  })

  it('attempts every present credential deletion and trusts only the final list', async () => {
    const present = CLEANUP_ABSENT_SECRET_NAMES.slice(0, 3)
    let listCount = 0
    const deleted: string[] = []
    const run = vi.fn(async (args: string[]) => {
      if (args[0] === 'secret' && args[1] === 'list') {
        listCount += 1
        return listCount === 1
          ? JSON.stringify(present.map((name) => ({ name })))
          : '[]'
      }
      if (args[0] === 'secret' && args[1] === 'delete') {
        deleted.push(args[2])
        if (args[2] === present[0]) throw new Error('lost response')
        return ''
      }
      throw new Error('unexpected command')
    })
    await expect(removeCredentialSecrets('staging', { run })).resolves.toBeUndefined()
    expect(deleted).toEqual(present)
  })

  it('accepts only one exact repository run URL and both credential gates', () => {
    expect(parseDispatchedRunId('https://github.com/haengjoo123/buril-lab/actions/runs/12345'))
      .toBe('12345')
    expect(() => parseDispatchedRunId([
      'https://github.com/haengjoo123/buril-lab/actions/runs/12345',
      'https://github.com/haengjoo123/buril-lab/actions/runs/12346',
    ].join('\n'))).toThrow(/ambiguous/)
    expect(parseDispatchedRunId('https://github.com/another/repo/actions/runs/12345')).toBeNull()

    const contract = { jobName: 'supervised job' }
    const run = {
      jobs: [{
        name: contract.jobName,
        status: 'completed',
        steps: [
          { name: 'Verify the signed current ephemeral lease', status: 'completed', conclusion: 'success' },
          { name: 'Verify the signed cumulative credential cleanup receipt', status: 'completed', conclusion: 'success' },
        ],
      }],
    }
    expect(credentialGatesSucceeded(run, contract)).toBe(true)
    run.jobs[0].steps[1].conclusion = 'failure'
    expect(credentialGatesSucceeded(run, contract)).toBe(false)
    expect(credentialGateResult(run, contract)).toBe('failed')
    delete run.jobs[0].steps[1].conclusion
    expect(credentialGateResult(run, contract)).toBe('indeterminate')
    run.jobs[0].steps.push({
      name: 'Verify the signed cumulative credential cleanup receipt',
      status: 'completed',
      conclusion: 'success',
    })
    expect(credentialGateResult(run, contract)).toBe('indeterminate')
  })

  it('requires the exact successful credential-injection verification step', () => {
    const contract = {
      jobName: 'credential probe',
      verificationStep: 'Verify exact environment-secret injection',
    }
    const run = {
      status: 'completed',
      conclusion: 'success',
      jobs: [{
        name: contract.jobName,
        status: 'completed',
        conclusion: 'success',
        steps: [{
          name: contract.verificationStep,
          status: 'completed',
          conclusion: 'success',
        }],
      }],
    }
    expect(credentialInjectionProbeResult(run, contract)).toBe('succeeded')
    run.jobs[0].steps[0].conclusion = 'failure'
    expect(credentialInjectionProbeResult(run, contract)).toBe('failed')
    delete run.jobs[0].steps[0].conclusion
    expect(credentialInjectionProbeResult(run, contract)).toBe('indeterminate')
  })

  it('accepts dashboard-only revocation evidence only after a failed or cancelled Pages write was skipped', () => {
    const contract = {
      jobName: 'supervised job',
      pagesMutationStep: 'Deploy the exact commit to Staging Pages',
    }
    const run = {
      status: 'completed',
      conclusion: 'failure',
      jobs: [{
        name: contract.jobName,
        status: 'completed',
        steps: [{
          name: contract.pagesMutationStep,
          status: 'completed',
          conclusion: 'skipped',
        }],
      }],
    }
    expect(failedBeforePagesMutation(run, contract)).toBe(true)

    run.conclusion = 'cancelled'
    expect(failedBeforePagesMutation(run, contract)).toBe(true)

    run.jobs[0].steps[0].conclusion = 'success'
    expect(failedBeforePagesMutation(run, contract)).toBe(false)
  })

  it('treats a wholly skipped Pages job as a failed gate with no possible mutation', () => {
    const contract = {
      jobName: 'supervised job',
      pagesMutationStep: 'Deploy the exact commit to Staging Pages',
    }
    const run = {
      status: 'completed',
      conclusion: 'failure',
      jobs: [{
        name: contract.jobName,
        status: 'completed',
        conclusion: 'skipped',
        steps: [],
      }],
    }

    expect(failedBeforePagesMutation(run, contract)).toBe(true)
    expect(credentialGateResult(run, contract)).toBe('failed')
  })

  it('reconciles a delayed workflow run beyond the legacy one-minute lookup window', async () => {
    const commitSha = 'a'.repeat(40)
    const expectedTitle = `Deploy staging ${commitSha} (lease=${'b'.repeat(32)}, storage-backup=false)`
    const contract = { workflow: 'deploy-staging.yml', workflowName: 'Deploy staging' }
    const createdAt = '2026-08-25T05:00:00.000Z'
    const delayedRun = {
      databaseId: 12345,
      displayTitle: expectedTitle,
      headSha: commitSha,
      status: 'queued',
      conclusion: '',
      createdAt,
      updatedAt: createdAt,
      attempt: 1,
      event: 'workflow_dispatch',
      headBranch: 'main',
      url: 'https://github.com/haengjoo123/buril-lab/actions/runs/12345',
      workflowName: 'Deploy staging',
    }
    let lookups = 0
    const wait = vi.fn(async () => undefined)

    await expect(findDispatchedRun(contract, expectedTitle, commitSha, {
      dispatchedAfter: Date.parse(createdAt),
      attempts: 13,
      wait,
      runGhImpl: async () => {
        lookups += 1
        return JSON.stringify(lookups < 13 ? [] : [delayedRun])
      },
      runDetailsImpl: async () => delayedRun,
    })).resolves.toEqual(delayedRun)

    expect(lookups).toBe(13)
    expect(wait).toHaveBeenCalledTimes(12)
  })

  it('waits for complete details of an exact just-created workflow before cleaning its secrets', async () => {
    const commitSha = 'a'.repeat(40)
    const expectedTitle = `Deploy staging ${commitSha} (lease=${'b'.repeat(32)}, storage-backup=false)`
    const contract = { workflow: 'deploy-staging.yml', workflowName: 'Deploy staging' }
    const createdAt = '2026-08-25T05:00:00.000Z'
    const completeRun = {
      databaseId: 12345,
      displayTitle: expectedTitle,
      headSha: commitSha,
      status: 'queued',
      conclusion: '',
      createdAt,
      updatedAt: createdAt,
      attempt: 1,
      event: 'workflow_dispatch',
      headBranch: 'main',
      url: 'https://github.com/haengjoo123/buril-lab/actions/runs/12345',
      workflowName: 'Deploy staging',
    }
    let detailsLookups = 0
    const wait = vi.fn(async () => undefined)

    await expect(findDispatchedRun(contract, expectedTitle, commitSha, {
      dispatchOutput: completeRun.url,
      dispatchedAfter: Date.parse(createdAt),
      attempts: 2,
      wait,
      runDetailsImpl: async () => {
        detailsLookups += 1
        return detailsLookups === 1
          ? { ...completeRun, workflowName: '' }
          : completeRun
      },
    })).resolves.toEqual(completeRun)

    expect(detailsLookups).toBe(2)
    expect(wait).toHaveBeenCalledTimes(1)
  })

  it('paginates recovery history instead of treating the 101st exact run as absent', async () => {
    const commitSha = 'a'.repeat(40)
    const leaseId = 'b'.repeat(32)
    const displayTitle = `Deploy staging ${commitSha} (lease=${leaseId}, storage-backup=false)`
    const startedAt = Date.parse('2026-08-25T05:00:00Z')
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      display_title: `Unrelated run ${index + 1}`,
      head_sha: commitSha,
      created_at: new Date(startedAt + 120_000 - index).toISOString(),
    }))
    const exactListRun = {
      id: 777,
      display_title: displayTitle,
      head_sha: commitSha,
      created_at: new Date(startedAt + 1_000).toISOString(),
    }
    const run = vi.fn(async (args: string[]) => (
      args.at(-1)?.endsWith('&page=1')
        ? JSON.stringify({ workflow_runs: firstPage })
        : JSON.stringify({ workflow_runs: [exactListRun] })
    ))
    const details = {
      databaseId: 777,
      displayTitle,
      headSha: commitSha,
      status: 'completed',
      conclusion: 'success',
      createdAt: exactListRun.created_at,
      updatedAt: new Date(startedAt + 60_000).toISOString(),
      attempt: 1,
      event: 'workflow_dispatch',
      headBranch: 'main',
      url: 'https://github.com/haengjoo123/buril-lab/actions/runs/777',
      workflowName: 'Deploy staging',
      jobs: [],
    }
    await expect(findJournalRun({
      payload: {
        environment: 'staging',
        commit_sha: commitSha,
        lease_id: leaseId,
        storage_backup: false,
        started_at: new Date(startedAt).toISOString(),
        run_evidence: null,
      },
    }, {
      run,
      getRunDetails: vi.fn(async () => details),
      wait: vi.fn(async () => undefined),
      attempts: 1,
    })).resolves.toMatchObject({ databaseId: 777 })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('recovers a main-head race only when the entire Pages job was skipped', async () => {
    const commitSha = 'a'.repeat(40)
    const advancedMainSha = 'c'.repeat(40)
    const leaseId = 'b'.repeat(32)
    const displayTitle = `Deploy staging ${commitSha} (lease=${leaseId}, storage-backup=false)`
    const startedAt = Date.parse('2026-08-25T05:00:00Z')
    const listedRun = {
      id: 778,
      display_title: displayTitle,
      head_sha: advancedMainSha,
      created_at: new Date(startedAt + 1_000).toISOString(),
    }
    const details = {
      databaseId: 778,
      displayTitle,
      headSha: advancedMainSha,
      status: 'completed',
      conclusion: 'failure',
      createdAt: listedRun.created_at,
      updatedAt: new Date(startedAt + 5_000).toISOString(),
      attempt: 1,
      event: 'workflow_dispatch',
      headBranch: 'main',
      url: 'https://github.com/haengjoo123/buril-lab/actions/runs/778',
      workflowName: 'Deploy staging',
      jobs: [{
        name: 'Supervised deploy of verified commit to buril-lab-staging',
        status: 'completed',
        conclusion: 'skipped',
        steps: [],
      }],
    }
    const pending = {
      payload: {
        environment: 'staging',
        commit_sha: commitSha,
        lease_id: leaseId,
        storage_backup: false,
        started_at: new Date(startedAt).toISOString(),
        run_evidence: null,
      },
    }
    const listRun = vi.fn(async () => JSON.stringify({ workflow_runs: [listedRun] }))

    await expect(findJournalRun(pending, {
      run: listRun,
      getRunDetails: vi.fn(async () => details),
      wait: vi.fn(async () => undefined),
      attempts: 1,
    })).resolves.toEqual(details)

    const mutated = {
      ...details,
      jobs: [{
        ...details.jobs[0],
        conclusion: 'success',
        steps: [{
          name: 'Deploy the exact commit to Staging Pages',
          status: 'completed',
          conclusion: 'success',
        }],
      }],
    }
    await expect(findJournalRun(pending, {
      run: listRun,
      getRunDetails: vi.fn(async () => mutated),
      wait: vi.fn(async () => undefined),
      attempts: 1,
    })).rejects.toThrow(/does not match the exact supervised lease/)
  })

  it('continues to provider revocation when GitHub cleanup fails', async () => {
    const events: string[] = []
    const recordCleanup = vi.fn()

    await expect(finalizeEphemeralReleaseLifecycle({
      clearGithub: async () => {
        events.push('github')
        throw new Error('github unavailable')
      },
      confirmProviderRevocation: async () => {
        events.push('confirm')
      },
      verifyProviderInactivity: async () => {
        events.push('provider')
      },
      recordCleanup,
    })).rejects.toThrow(/did not complete every required lifecycle phase/)

    expect(events).toEqual(['github', 'confirm', 'provider'])
    expect(recordCleanup).not.toHaveBeenCalled()
  })

  it('does not sign cleanup when provider inactivity cannot be proven', async () => {
    const recordCleanup = vi.fn()

    await expect(finalizeEphemeralReleaseLifecycle({
      clearGithub: async () => undefined,
      confirmProviderRevocation: async () => undefined,
      verifyProviderInactivity: async () => {
        throw new Error('provider still active')
      },
      recordCleanup,
    })).rejects.toThrow(/did not complete every required lifecycle phase/)

    expect(recordCleanup).not.toHaveBeenCalled()
  })

  it('records verified cleanup before surfacing a failed workflow', async () => {
    const events: string[] = []

    await expect(finalizeEphemeralReleaseLifecycle({
      operationFailure: new Error('workflow failed'),
      clearGithub: async () => {
        events.push('github')
      },
      confirmProviderRevocation: async () => {
        events.push('confirm')
      },
      verifyProviderInactivity: async () => {
        events.push('provider')
      },
      recordCleanup: async () => {
        events.push('receipt')
      },
    })).rejects.toThrow(/did not complete every required lifecycle phase/)

    expect(events).toEqual(['github', 'confirm', 'provider', 'receipt'])
  })

  it('completes only after both cleanup surfaces and the receipt succeed', async () => {
    const events: string[] = []

    await finalizeEphemeralReleaseLifecycle({
      clearGithub: async () => {
        events.push('github')
      },
      confirmProviderRevocation: async () => {
        events.push('confirm')
      },
      verifyProviderInactivity: async () => {
        events.push('provider')
      },
      recordCleanup: async () => {
        events.push('receipt')
      },
    })

    expect(events).toEqual(['github', 'confirm', 'provider', 'receipt'])
  })

  it('does not echo secrets entered through an interactive terminal', async () => {
    const input = Object.assign(new EventEmitter(), {
      isTTY: true,
      setRawMode: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn(),
    })
    const writes: string[] = []
    const output = { write: (value: string) => writes.push(value) }
    const pending = readHiddenTtyLine({ input, output })
    queueMicrotask(() => input.emit('data', Buffer.from('harmless-secret-marker\r')))

    await expect(pending).resolves.toBe('harmless-secret-marker')
    expect(writes.join('')).toBe('\n')
    expect(input.setRawMode.mock.calls).toEqual([[true], [false]])
    expect(input.resume).toHaveBeenCalledOnce()
    expect(input.pause).toHaveBeenCalledOnce()
  })

  it('drains and bounds GitHub CLI stderr instead of hanging', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { end: vi.fn() },
      kill: vi.fn(),
    })
    const spawnImpl = vi.fn(() => {
      queueMicrotask(() => child.stderr.emit('data', Buffer.alloc(2 * 1024 * 1024 + 1)))
      return child
    })

    await expect(runGh(['run', 'watch'], { spawnImpl, timeoutMs: 500 }))
      .rejects.toThrow(/output was oversized/)
    expect(child.kill).toHaveBeenCalled()
  })

  it('allows only one local supervisor process to own release state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'burillab-supervisor-lock-'))
    const lockPath = join(directory, 'supervisor.lock')
    let releaseFirst: (() => void) | undefined
    let markEntered: (() => void) | undefined
    const entered = new Promise<void>((resolvePromise) => {
      markEntered = resolvePromise
    })
    const release = new Promise<void>((resolvePromise) => {
      releaseFirst = resolvePromise
    })
    try {
      const first = withSupervisorProcessLock(async () => {
        markEntered?.()
        await release
        return 'first-complete'
      }, { lockPath, context: 'test:first', now: 1, pid: process.pid })
      await entered
      await expect(withSupervisorProcessLock(async () => 'unsafe-second', {
        lockPath,
        context: 'test:second',
        now: 2,
        pid: process.pid,
      })).rejects.toThrow(/Another ephemeral release supervisor owns/)
      releaseFirst?.()
      await expect(first).resolves.toBe('first-complete')
      await expect(withSupervisorProcessLock(async () => 'next-safe-run', {
        lockPath,
        context: 'test:next',
        now: 3,
        pid: process.pid,
      })).resolves.toBe('next-safe-run')

      await writeFile(lockPath, JSON.stringify({
        version: 1,
        pid: 999_999,
        context: 'crashed:staging:lease',
        started_at: new Date(1).toISOString(),
        nonce: 'a'.repeat(32),
      }), 'utf8')
      const processAliveImpl = vi.fn(async () => false)
      await expect(withSupervisorProcessLock(async () => 'recovered-after-crash', {
        lockPath,
        context: 'recover:staging:lease',
        processAliveImpl,
        now: 4,
        pid: process.pid,
      })).resolves.toBe('recovered-after-crash')
      expect(processAliveImpl).toHaveBeenCalledWith(999_999)
    } finally {
      releaseFirst?.()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
