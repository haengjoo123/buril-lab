import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  expectedCostConfirmation,
  expectedIsolationConfirmation,
  probeReadOnlyPrerequisites,
  verifyR2CompleteManifestEvidence,
  verifyReadOnlyToolVersions,
  verifyRecoveryPreflightEvidence,
  verifyRecoveryWorkDirectory,
} from './verify-supabase-recovery-preflight.mjs'

const NOW = Date.parse('2026-08-25T04:30:00.000Z')
const SOURCE_REF = 'a'.repeat(20)
const TARGET_REF = 'b'.repeat(20)
const STAGING_REF = 'c'.repeat(20)
const CONFIRMATION_ID = 'approval-20260825-0001'

function validEvidence() {
  return {
    schemaVersion: 1,
    capturedAt: '2026-08-25T04:25:00.000Z',
    source: {
      projectRef: SOURCE_REF,
      health: 'ACTIVE_HEALTHY',
      region: 'us-east-2',
      postgresVersion: '17.6',
    },
    target: {
      projectRef: TARGET_REF,
      region: 'us-east-2',
      computeSize: 'MICRO',
      postgresVersion: '17.6',
    },
    cost: {
      displayedMonthlyUsd: 10,
      actualComputeCapUsd: 1,
      deleteWithinHours: 24,
      confirmationId: CONFIRMATION_ID,
      confirmedAt: '2026-08-25T04:20:00.000Z',
      confirmation: expectedCostConfirmation({
        confirmationId: CONFIRMATION_ID,
        displayedMonthlyUsd: 10,
      }),
    },
    databaseBackup: {
      dailyEnabled: true,
      checkedAt: '2026-08-25T04:22:00.000Z',
      latestAvailableAt: '2026-08-24T08:40:29.000Z',
      visibleRestorePointCount: 8,
      storageBodiesIncluded: false,
    },
    workDirectory: {
      path: 'R:\\burillab-recovery\\run-20260825',
      encryptionProvider: 'bitlocker',
      encryptionStatus: 'protected',
      encryptionCheckedAt: '2026-08-25T04:23:00.000Z',
    },
    isolation: {
      externalEmailEnabled: false,
      scheduledJobsEnabled: false,
      deletionWorkerEnabled: false,
      webhooksEnabled: false,
      externalApiCallsEnabled: false,
      realtimePublicationsEnabled: false,
      maintenanceWorkerEnabled: false,
      confirmation: expectedIsolationConfirmation(TARGET_REF),
    },
    r2: {
      environment: 'production',
      storageBucket: 'cabinets',
      maxSnapshotAgeHours: 26,
    },
  }
}

function validR2Evidence() {
  const snapshotId = '20260825-abcdef01'
  const manifest = {
    schemaVersion: 1,
    snapshotId,
    environment: 'production',
    createdAt: '2026-08-25T03:55:00.000Z',
    source: {
      supabaseProjectRef: SOURCE_REF,
      storageBucket: 'cabinets',
      pointerMode: 'private_path',
    },
    objectCount: 1,
    totalBytes: 12,
    objects: [{
      sourcePath: 'lab-id/cabinet-id/photo.jpg',
      backupKey: `snapshots/${snapshotId}/objects/lab-id/cabinet-id/photo.jpg`,
      bytes: 12,
      sha256: 'c'.repeat(64),
      ownerScope: 'lab',
      contentType: 'image/jpeg',
    }],
  }
  const manifestRaw = `${JSON.stringify(manifest)}\n`
  const manifestSha256 = createHash('sha256').update(manifestRaw, 'utf8').digest('hex')
  return {
    latest: {
      schemaVersion: 1,
      snapshotId,
      environment: 'production',
      completeKey: `snapshots/${snapshotId}/complete.json`,
      manifestSha256,
      completedAt: '2026-08-25T04:00:00.000Z',
    },
    complete: {
      schemaVersion: 1,
      snapshotId,
      environment: 'production',
      completedAt: '2026-08-25T04:00:00.000Z',
      manifestKey: `snapshots/${snapshotId}/manifest.json`,
      manifestSha256,
      objectCount: 1,
      totalBytes: 12,
    },
    manifest,
    manifestRaw,
    manifestChecksumRaw: `${manifestSha256}\n`,
  }
}

describe('Supabase recovery preflight evidence', () => {
  it('accepts exact, fresh, isolated Micro recovery metadata', () => {
    expect(verifyRecoveryPreflightEvidence({
      evidence: validEvidence(),
      expectedSourceProjectRef: SOURCE_REF,
      expectedTargetProjectRef: TARGET_REF,
      forbiddenTargetProjectRefs: [STAGING_REF],
      now: NOW,
    })).toMatchObject({
      sourcePostgresMajor: 17,
      targetPostgresMajor: 17,
    })
  })

  it('fails closed without a separate user cost confirmation ID', () => {
    const evidence = validEvidence()
    evidence.cost.confirmationId = ''
    expect(() => verifyRecoveryPreflightEvidence({
      evidence,
      expectedSourceProjectRef: SOURCE_REF,
      expectedTargetProjectRef: TARGET_REF,
      forbiddenTargetProjectRefs: [STAGING_REF],
      now: NOW,
    })).toThrow('cost confirmation ID')
  })

  it('rejects the existing Staging project as a recovery target', () => {
    const evidence = validEvidence()
    evidence.target.projectRef = STAGING_REF
    expect(() => verifyRecoveryPreflightEvidence({
      evidence,
      expectedSourceProjectRef: SOURCE_REF,
      expectedTargetProjectRef: STAGING_REF,
      forbiddenTargetProjectRefs: [STAGING_REF],
      now: NOW,
    })).toThrow('existing protected project ref')
  })

  it.each([
    ['different source ref', (evidence: ReturnType<typeof validEvidence>) => { evidence.source.projectRef = 'c'.repeat(20) }],
    ['different region', (evidence: ReturnType<typeof validEvidence>) => { evidence.target.region = 'ap-northeast-2' }],
    ['non-Micro target', (evidence: ReturnType<typeof validEvidence>) => { evidence.target.computeSize = 'SMALL' }],
    ['enabled scheduler', (evidence: ReturnType<typeof validEvidence>) => { evidence.isolation.scheduledJobsEnabled = true }],
    ['Storage-body claim', (evidence: ReturnType<typeof validEvidence>) => { evidence.databaseBackup.storageBodiesIncluded = true }],
  ])('rejects %s', (_label, mutate) => {
    const evidence = validEvidence()
    mutate(evidence)
    expect(() => verifyRecoveryPreflightEvidence({
      evidence,
      expectedSourceProjectRef: SOURCE_REF,
      expectedTargetProjectRef: TARGET_REF,
      forbiddenTargetProjectRefs: [STAGING_REF],
      now: NOW,
    })).toThrow()
  })

  it('rejects secret-shaped fields before they can be logged or used', () => {
    const evidence = { ...validEvidence(), serviceRoleKey: 'do-not-accept' }
    expect(() => verifyRecoveryPreflightEvidence({
      evidence,
      expectedSourceProjectRef: SOURCE_REF,
      expectedTargetProjectRef: TARGET_REF,
      forbiddenTargetProjectRefs: [STAGING_REF],
      now: NOW,
    })).toThrow('forbidden sensitive field')
  })
})

describe('R2 complete-manifest chain', () => {
  it('accepts latest to complete to byte-exact manifest evidence', () => {
    expect(verifyR2CompleteManifestEvidence({
      ...validR2Evidence(),
      expectedSourceProjectRef: SOURCE_REF,
      now: NOW,
    })).toMatchObject({
      objectCount: 1,
      totalBytes: 12,
    })
  })

  it('rejects a manifest without the exact complete hash chain', () => {
    const evidence = validR2Evidence()
    evidence.complete.manifestSha256 = 'd'.repeat(64)
    expect(() => verifyR2CompleteManifestEvidence({
      ...evidence,
      expectedSourceProjectRef: SOURCE_REF,
      now: NOW,
    })).toThrow('hash chain')
  })

  it('rejects traversal, encoded traversal, duplicates, and zero-object evidence', () => {
    for (const sourcePath of ['../photo.jpg', 'lab/%2e%2e/photo.jpg']) {
      const evidence = validR2Evidence()
      evidence.manifest.objects[0].sourcePath = sourcePath
      expect(() => verifyR2CompleteManifestEvidence({
        ...evidence,
        expectedSourceProjectRef: SOURCE_REF,
        now: NOW,
      })).toThrow()
    }

    const empty = validR2Evidence()
    empty.manifest.objectCount = 0
    empty.manifest.totalBytes = 0
    empty.manifest.objects = []
    expect(() => verifyR2CompleteManifestEvidence({
      ...empty,
      expectedSourceProjectRef: SOURCE_REF,
      now: NOW,
    })).toThrow('positive')
  })

  it('rejects a complete snapshot older than the reviewed daily-backup window', () => {
    expect(() => verifyR2CompleteManifestEvidence({
      ...validR2Evidence(),
      expectedSourceProjectRef: SOURCE_REF,
      now: Date.parse('2026-08-26T07:00:00.000Z'),
    })).toThrow('freshness')
  })
})

describe('local-only recovery prerequisites', () => {
  it('requires an outside-repository, non-sync, BitLocker-protected directory', () => {
    expect(verifyRecoveryWorkDirectory({
      configuredPath: 'R:\\burillab-recovery\\run-20260825',
      realPath: 'R:\\burillab-recovery\\run-20260825',
      repositoryRoot: 'C:\\workspace\\buril-lab',
      syncRoots: ['C:\\Users\\operator\\OneDrive'],
      bitLockerStatus: 'protected',
      platform: 'win32',
    })).toEqual({ volumeRoot: 'R:\\' })
  })

  it.each([
    ['C:\\Users\\operator\\OneDrive\\recovery', 'protected'],
    ['C:\\workspace\\buril-lab\\recovery', 'protected'],
    ['R:\\burillab-recovery\\run-20260825', 'unprotected'],
  ])('rejects unsafe work directory %s', (workDirectory, bitLockerStatus) => {
    expect(() => verifyRecoveryWorkDirectory({
      configuredPath: workDirectory,
      realPath: workDirectory,
      repositoryRoot: 'C:\\workspace\\buril-lab',
      syncRoots: ['C:\\Users\\operator\\OneDrive'],
      bitLockerStatus,
      platform: 'win32',
    })).toThrow()
  })

  it('requires the reviewed tool versions and a live Docker server response', () => {
    expect(verifyReadOnlyToolVersions({
      pwsh: '7.6.4',
      supabase: '2.115.0',
      docker: '28.3.3',
      psql: 'psql (PostgreSQL) 17.6',
    }, 17)).toEqual({
      pwshVersion: '7.6.4',
      supabaseVersion: '2.115.0',
      dockerVersion: '28.3.3',
      psqlVersion: '17.6.0',
    })
    expect(() => verifyReadOnlyToolVersions({
      pwsh: '7.6.4',
      supabase: '2.114.0',
      docker: '28.3.3',
      psql: 'psql (PostgreSQL) 17.6',
    }, 17)).toThrow('2.115.0')
  })

  it('runs only the five fixed read-only local probes', async () => {
    const calls: Array<[string, string[]]> = []
    const runner = vi.fn(async (executable: string, args: string[]) => {
      calls.push([executable, args])
      if (executable === 'npx.cmd') return '2.115.0\n'
      if (executable === 'docker') return '28.3.3\n'
      if (executable === 'psql') return 'psql (PostgreSQL) 17.6\n'
      if (args.some((argument) => argument.includes('Get-BitLockerVolume'))) return 'protected\n'
      return '7.6.4\n'
    })

    await expect(probeReadOnlyPrerequisites({
      targetPostgresMajor: 17,
      volumeRoot: 'R:\\',
      runner,
    })).resolves.toMatchObject({ bitLockerStatus: 'protected' })
    expect(calls).toHaveLength(5)
    expect(calls.map(([executable]) => executable)).toEqual(['pwsh', 'npx.cmd', 'docker', 'psql', 'pwsh'])
    expect(calls.flatMap(([, args]) => args).join(' ')).not.toMatch(/\b(?:create|delete|dump|restore|push|deploy)\b/i)
  })

  it('contains no remote client or destructive Supabase command path', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'verify-supabase-recovery-preflight.mjs'), 'utf8')
    expect(source).not.toMatch(/\bfetch\s*\(/)
    expect(source).not.toMatch(/\bsupabase\s+(?:projects?\s+)?(?:create|delete|dump|restore|link)\b/i)
    expect(source).not.toContain('shell: true')
  })
})
