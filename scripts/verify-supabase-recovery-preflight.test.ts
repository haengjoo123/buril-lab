import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RELEASE_ENVIRONMENTS } from './write-release-manifest.mjs'
import {
  RECOVERY_EXPECTATIONS,
  REQUIRED_POSTGRES_ARCHIVE_SHA256,
  REQUIRED_POSTGRES_BIN_MANIFEST,
  TRUSTED_WINDOWS_POWERSHELL_PATH,
  expected24HourComputeCostUsd,
  expectedCostConfirmation,
  expectedIsolationConfirmation,
  fetchSupabaseLiveRecoveryProbe,
  probeRecoveryWorkDirectoryProtection,
  probeReadOnlyPrerequisites,
  probeReadOnlyToolPrerequisites,
  probeTrustedWindowsPowerShell,
  reviewedWindowsWorkRoots,
  verifyEfsEncryptedFiles,
  verifyExternalCostConfirmation,
  verifyPostgresArchiveToolBinding,
  verifyPostgresBinReparseAttributes,
  verifyPostgresPortableArtifacts,
  verifyR2CompleteManifestEvidence,
  verifyR2LocalEvidenceLayout,
  verifyR2RestoreMaterial,
  verifyReadOnlyToolVersions,
  verifyLocalSupabaseCliPackage,
  verifyRecoveryPreflightEvidence,
  verifyRecoveryWorkDirectory,
  verifySupabaseLiveRecoveryProbe,
  verifyWindowsNoReparsePaths,
  verifyWindowsTreeNoReparse,
} from './verify-supabase-recovery-preflight.mjs'

const NOW = Date.parse('2026-08-25T04:30:00.000Z')
const TARGET_REF = 'b'.repeat(20)
const CONFIRMATION_ID = 'approval-20260825-0001'
const BODY = Buffer.from('body-content', 'utf8')
const BODY_SHA256 = createHash('sha256').update(BODY).digest('hex')
const ORPHAN_BODY = Buffer.from('unreferenced-body', 'utf8')
const ORPHAN_BODY_SHA256 = createHash('sha256').update(ORPHAN_BODY).digest('hex')
const temporaryDirectories: string[] = []

function powerShellValues(standardInput = ''): string[] {
  const match = standardInput.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/)
  if (!match) return []
  return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
}

function windowsProtectionRunner(unprotectedPath?: string) {
  return vi.fn(async (_executable: string, _args: string[], standardInput = '') => {
    if (standardInput.includes('Get-AuthenticodeSignature')) return 'trusted|5.1.26100.9168|Desktop|True\n'
    if (standardInput.includes('[IO.FileAttributes]::Encrypted')) {
      return powerShellValues(standardInput).includes(unprotectedPath ?? '') ? 'unprotected\n' : 'protected\n'
    }
    return 'clear\n'
  })
}

type R2Manifest = {
  schemaVersion: number
  snapshotId: string
  environment: string
  createdAt: string
  source: {
    supabaseProjectRef: string
    storageBucket: string
    pointerMode: string
  }
  objectCount: number
  referencedObjectCount: number
  orphanCount: number
  totalBytes: number
  objects: Array<{
    sourcePath: string
    backupKey: string
    bytes: number
    sha256: string
    classification: 'referenced' | 'unreferenced'
    ownerScope?: string
    contentType: string
  }>
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()
    if (directory?.startsWith(tmpdir())) rmSync(directory, { recursive: true, force: true })
  }
})

function validEvidence() {
  return {
    schemaVersion: 3,
    capturedAt: '2026-08-25T04:25:00.000Z',
    databaseBackup: {
      dailyEnabled: true,
      checkedAt: '2026-08-25T04:22:00.000Z',
      latestAvailableAt: '2026-08-24T08:40:29.000Z',
      visibleRestorePointCount: 8,
      storageBodiesIncluded: false,
    },
    workDirectory: {
      path: 'C:\\Users\\operator\\AppData\\Local\\Temp\\burillab-recovery\\run-20260825',
      encryptionProvider: 'bitlocker',
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

function validLiveProbe(targetProjectRef = TARGET_REF) {
  return {
    sourceProject: {
      ref: RECOVERY_EXPECTATIONS.sourceProjectRef,
      status: 'ACTIVE_HEALTHY',
      region: RECOVERY_EXPECTATIONS.region,
      database: { version: '17.6.1.075' },
    },
    targetProject: {
      ref: targetProjectRef,
      status: 'ACTIVE_HEALTHY',
      region: RECOVERY_EXPECTATIONS.region,
      database: { version: '17.6.1.075' },
    },
    targetAddons: {
      selected_addons: [{
        type: 'compute_instance',
        variant: {
          id: 'ci_micro',
          name: 'Micro',
          price: { interval: 'monthly', type: 'fixed', amount: 10 },
        },
      }],
      available_addons: [],
    },
  }
}

function validExternalConfirmation() {
  return {
    confirmationId: CONFIRMATION_ID,
    confirmedAt: '2026-08-25T04:20:00.000Z',
    marker: expectedCostConfirmation(CONFIRMATION_ID),
  }
}

function signR2Evidence(manifest: R2Manifest) {
  const manifestRaw = `${JSON.stringify(manifest)}\n`
  const manifestSha256 = createHash('sha256').update(manifestRaw, 'utf8').digest('hex')
  const snapshotId = String(manifest.snapshotId)
  return {
    latest: {
      schemaVersion: 1,
      snapshotId,
      environment: 'production',
      completeKey: `snapshots/${snapshotId}/complete.json`,
      manifestSha256,
      orphanCount: manifest.orphanCount,
      completedAt: '2026-08-25T04:00:00.000Z',
    },
    complete: {
      schemaVersion: 1,
      snapshotId,
      environment: 'production',
      completedAt: '2026-08-25T04:00:00.000Z',
      manifestKey: `snapshots/${snapshotId}/manifest.json`,
      manifestSha256,
      objectCount: manifest.objectCount,
      referencedObjectCount: manifest.referencedObjectCount,
      orphanCount: manifest.orphanCount,
      totalBytes: manifest.totalBytes,
    },
    manifest,
    manifestRaw,
    manifestChecksumRaw: `${manifestSha256}\n`,
  }
}

function validR2Evidence() {
  const snapshotId = '20260825t035500000z-abcdef0123456789abcdef01'
  return signR2Evidence({
    schemaVersion: 1,
    snapshotId,
    environment: 'production',
    createdAt: '2026-08-25T03:55:00.000Z',
    source: {
      supabaseProjectRef: RECOVERY_EXPECTATIONS.sourceProjectRef,
      storageBucket: 'cabinets',
      pointerMode: 'private_path',
    },
    objectCount: 2,
    referencedObjectCount: 1,
    orphanCount: 1,
    totalBytes: BODY.byteLength + ORPHAN_BODY.byteLength,
    objects: [
      {
        sourcePath: 'lab-id/cabinet-id/photo.jpg',
        backupKey: `snapshots/${snapshotId}/objects/lab-id/cabinet-id/photo.jpg`,
        bytes: BODY.byteLength,
        sha256: BODY_SHA256,
        classification: 'referenced',
        ownerScope: 'lab',
        contentType: 'image/jpeg',
      },
      {
        sourcePath: 'legacy/orphan-photo.jpg',
        backupKey: `snapshots/${snapshotId}/quarantine/unreferenced/legacy/orphan-photo.jpg`,
        bytes: ORPHAN_BODY.byteLength,
        sha256: ORPHAN_BODY_SHA256,
        classification: 'unreferenced',
        contentType: 'image/jpeg',
      },
    ],
  })
}

function materialFixture() {
  const evidence = validR2Evidence()
  const workDirectory = mkdtempSync(join(tmpdir(), 'burillab-recovery-preflight-'))
  temporaryDirectories.push(workDirectory)
  const bodyRoot = join(workDirectory, 'snapshots', evidence.manifest.snapshotId)
  const bodyPath = join(bodyRoot, 'objects', 'lab-id', 'cabinet-id', 'photo.jpg')
  const quarantineBodyPath = join(
    bodyRoot,
    'quarantine',
    'unreferenced',
    'legacy',
    'orphan-photo.jpg',
  )
  mkdirSync(join(bodyRoot, 'objects', 'lab-id', 'cabinet-id'), { recursive: true })
  mkdirSync(join(bodyRoot, 'quarantine', 'unreferenced', 'legacy'), { recursive: true })
  writeFileSync(bodyPath, BODY)
  writeFileSync(quarantineBodyPath, ORPHAN_BODY)
  return { ...evidence, workDirectory, bodyRoot, bodyPath, quarantineBodyPath }
}

function localSupabaseCliFixture() {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'burillab-supabase-cli-'))
  temporaryDirectories.push(repositoryRoot)
  const packageDirectory = join(repositoryRoot, 'node_modules', 'supabase')
  mkdirSync(packageDirectory, { recursive: true })
  writeFileSync(join(repositoryRoot, 'package.json'), JSON.stringify({
    devDependencies: { supabase: '2.115.0' },
  }))
  writeFileSync(join(packageDirectory, 'package.json'), JSON.stringify({
    name: 'supabase',
    version: '2.115.0',
  }))
  writeFileSync(join(repositoryRoot, 'package-lock.json'), JSON.stringify({
    packages: {
      '': { devDependencies: { supabase: '2.115.0' } },
      'node_modules/supabase': {
        version: '2.115.0',
        resolved: 'https://registry.npmjs.org/supabase/-/supabase-2.115.0.tgz',
        integrity: 'sha512-8fL9vOd6jOntmU8N5DVlHGE2GWR1r57ulsrOzSyO6IRYq5QMyKie8T8DH+hb+caGhYUVJLvmpY7XYwic60Uafg==',
      },
    },
  }))
  return repositoryRoot
}

function postgresProbeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'burillab-pg-probe-'))
  temporaryDirectories.push(root)
  const binDirectory = join(root, 'pgsql', 'bin')
  mkdirSync(binDirectory, { recursive: true })
  const bodies = {
    'pg_dump.exe': Buffer.from('pg-dump'),
    'pg_restore.exe': Buffer.from('pg-restore'),
    'psql.exe': Buffer.from('psql'),
  }
  for (const [name, body] of Object.entries(bodies)) writeFileSync(join(binDirectory, name), body)
  return {
    binDirectory,
    binManifest: REQUIRED_POSTGRES_BIN_MANIFEST,
    pgDumpPath: join(binDirectory, 'pg_dump.exe'),
    pgRestorePath: join(binDirectory, 'pg_restore.exe'),
    psqlPath: join(binDirectory, 'psql.exe'),
  }
}

function storedZip(entries: Array<{
  name: string
  body: Buffer
  externalAttributes?: number
  versionMadeBy?: number
}>) {
  const localRecords: Buffer[] = []
  const centralRecords: Buffer[] = []
  let localOffset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt32LE(entry.body.byteLength, 18)
    localHeader.writeUInt32LE(entry.body.byteLength, 22)
    localHeader.writeUInt16LE(name.byteLength, 26)
    const localRecord = Buffer.concat([localHeader, name, entry.body])
    localRecords.push(localRecord)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(entry.versionMadeBy ?? 20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt32LE(entry.body.byteLength, 20)
    centralHeader.writeUInt32LE(entry.body.byteLength, 24)
    centralHeader.writeUInt16LE(name.byteLength, 28)
    centralHeader.writeUInt32LE(entry.externalAttributes ?? 0, 38)
    centralHeader.writeUInt32LE(localOffset, 42)
    centralRecords.push(Buffer.concat([centralHeader, name]))
    localOffset += localRecord.byteLength
  }
  const locals = Buffer.concat(localRecords)
  const centralDirectory = Buffer.concat(centralRecords)
  const endRecord = Buffer.alloc(22)
  endRecord.writeUInt32LE(0x06054b50, 0)
  endRecord.writeUInt16LE(entries.length, 8)
  endRecord.writeUInt16LE(entries.length, 10)
  endRecord.writeUInt32LE(centralDirectory.byteLength, 12)
  endRecord.writeUInt32LE(locals.byteLength, 16)
  return Buffer.concat([locals, centralDirectory, endRecord])
}

describe('fixed and live Supabase recovery identity', () => {
  it('derives protected production and Staging refs from the release environment registry', () => {
    expect(RECOVERY_EXPECTATIONS.sourceProjectRef).toBe(RELEASE_ENVIRONMENTS.production.supabaseProjectRef)
    expect(RECOVERY_EXPECTATIONS.stagingProjectRef).toBe(RELEASE_ENVIRONMENTS.staging.supabaseProjectRef)
  })

  it('accepts only live ACTIVE_HEALTHY projects in fixed us-east-2 with live Micro billing', () => {
    expect(verifySupabaseLiveRecoveryProbe({
      ...validLiveProbe(),
      targetProjectRef: TARGET_REF,
    })).toEqual({
      sourcePostgresMajor: 17,
      targetPostgresMajor: 17,
      displayedMonthlyUsd: 10,
    })
  })

  it.each([
    ['arbitrary production ref', (probe: ReturnType<typeof validLiveProbe>) => { probe.sourceProject.ref = 'x'.repeat(20) }],
    ['wrong live target ref', (probe: ReturnType<typeof validLiveProbe>) => { probe.targetProject.ref = 'y'.repeat(20) }],
    ['wrong source region', (probe: ReturnType<typeof validLiveProbe>) => { probe.sourceProject.region = 'ap-northeast-2' }],
    ['wrong target region', (probe: ReturnType<typeof validLiveProbe>) => { probe.targetProject.region = 'ap-northeast-2' }],
    ['non-Micro compute', (probe: ReturnType<typeof validLiveProbe>) => { probe.targetAddons.selected_addons[0].variant.id = 'ci_small' }],
    ['changed monthly cost', (probe: ReturnType<typeof validLiveProbe>) => { probe.targetAddons.selected_addons[0].variant.price.amount = 11 }],
  ])('rejects %s even if local evidence could claim otherwise', (_label, mutate) => {
    const probe = validLiveProbe()
    mutate(probe)
    expect(() => verifySupabaseLiveRecoveryProbe({ ...probe, targetProjectRef: TARGET_REF })).toThrow()
  })

  it.each([
    RECOVERY_EXPECTATIONS.sourceProjectRef,
    RECOVERY_EXPECTATIONS.stagingProjectRef,
  ])('rejects protected ref %s as a recovery target', (targetProjectRef) => {
    expect(() => verifySupabaseLiveRecoveryProbe({
      ...validLiveProbe(targetProjectRef),
      targetProjectRef,
    })).toThrow('protected project ref')
  })

  it('uses only three fixed Management API GETs and does not expose the token', async () => {
    const token = 'management-token-that-must-never-be-logged'
    const responses = new Map([
      [`/v1/projects/${RECOVERY_EXPECTATIONS.sourceProjectRef}`, validLiveProbe().sourceProject],
      [`/v1/projects/${TARGET_REF}`, validLiveProbe().targetProject],
      [`/v1/projects/${TARGET_REF}/billing/addons`, validLiveProbe().targetAddons],
    ])
    const calls: Array<{ url: URL, init: RequestInit }> = []
    const fetchImpl = vi.fn(async (url: URL, init: RequestInit) => {
      calls.push({ url, init })
      const body = responses.get(url.pathname)
      return new Response(JSON.stringify(body), {
        status: body ? 200 : 404,
        headers: { 'content-type': 'application/json' },
      })
    })

    await expect(fetchSupabaseLiveRecoveryProbe({
      accessToken: token,
      targetProjectRef: TARGET_REF,
      fetchImpl,
    })).resolves.toEqual(validLiveProbe())
    expect(calls).toHaveLength(3)
    expect(calls.every(({ url, init }) => url.origin === 'https://api.supabase.com' && init.method === 'GET')).toBe(true)
    expect(calls.map(({ url }) => url.pathname).sort()).toEqual([...responses.keys()].sort())
    expect(JSON.stringify(calls.map(({ url }) => url))).not.toContain(token)

    let failureMessage = ''
    try {
      await fetchSupabaseLiveRecoveryProbe({
        accessToken: token,
        targetProjectRef: TARGET_REF,
        fetchImpl: async () => new Response('{}', {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      })
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error)
    }
    expect(failureMessage).not.toContain(token)
  })
})

describe('external cost confirmation and evidence', () => {
  it('binds the live USD 10 display to a separate confirmation and a USD 0.32256 estimate', () => {
    expect(expected24HourComputeCostUsd()).toBe(0.32256)
    expect(expected24HourComputeCostUsd()).toBeLessThan(1)
    expect(Number((
      RECOVERY_EXPECTATIONS.microComputeHourlyUsd * RECOVERY_EXPECTATIONS.monthlyBillingHours
    ).toFixed(2))).toBe(RECOVERY_EXPECTATIONS.displayedMonthlyUsd)
    expect(verifyExternalCostConfirmation({
      externalConfirmation: validExternalConfirmation(),
      capturedAt: Date.parse(validEvidence().capturedAt),
      liveDisplayedMonthlyUsd: 10,
    })).toMatchObject({ expectedComputeCostUsd: 0.32256 })
  })

  it('rejects absent or locally invented cost evidence', () => {
    expect(() => verifyExternalCostConfirmation({
      externalConfirmation: undefined,
      capturedAt: Date.parse(validEvidence().capturedAt),
      liveDisplayedMonthlyUsd: 10,
    })).toThrow()

    const evidence = { ...validEvidence(), cost: validExternalConfirmation() }
    expect(() => verifyRecoveryPreflightEvidence({
      evidence,
      targetProjectRef: TARGET_REF,
      liveProbe: validLiveProbe(),
      externalCostConfirmation: validExternalConfirmation(),
      now: NOW,
    })).toThrow('fields do not match')
  })

  it.each([
    ['wrong live display', { liveDisplayedMonthlyUsd: 11, marker: expectedCostConfirmation(CONFIRMATION_ID) }],
    ['tampered marker', { liveDisplayedMonthlyUsd: 10, marker: 'CONFIRM RECOVERY COST TAMPERED' }],
  ])('rejects %s', (_label, values) => {
    const externalConfirmation = validExternalConfirmation()
    externalConfirmation.marker = values.marker
    expect(() => verifyExternalCostConfirmation({
      externalConfirmation,
      capturedAt: Date.parse(validEvidence().capturedAt),
      liveDisplayedMonthlyUsd: values.liveDisplayedMonthlyUsd,
    })).toThrow()
  })

  it('accepts exact fresh non-cost evidence only with live metadata and external approval', () => {
    expect(verifyRecoveryPreflightEvidence({
      evidence: validEvidence(),
      targetProjectRef: TARGET_REF,
      liveProbe: validLiveProbe(),
      externalCostConfirmation: validExternalConfirmation(),
      now: NOW,
    })).toMatchObject({
      sourcePostgresMajor: 17,
      targetPostgresMajor: 17,
      expectedComputeCostUsd: 0.32256,
    })
  })
})

describe('R2 complete chain and local restore bodies', () => {
  it('requires latest, complete, manifest, checksum, and bodies to share one exact local layout', () => {
    const snapshotId = validR2Evidence().manifest.snapshotId
    const bodyRoot = `C:\\recovery\\r2\\snapshots\\${snapshotId}`
    const validLayout = {
      bodyRoot,
      latestPath: 'C:\\recovery\\r2\\control\\latest.json',
      completePath: `${bodyRoot}\\complete.json`,
      manifestPath: `${bodyRoot}\\manifest.json`,
      manifestChecksumPath: `${bodyRoot}\\manifest.sha256`,
      snapshotId,
      platform: 'win32' as const,
    }
    expect(verifyR2LocalEvidenceLayout(validLayout)).toEqual({ bucketRoot: 'C:\\recovery\\r2' })
    expect(() => verifyR2LocalEvidenceLayout({
      ...validLayout,
      completePath: `C:\\recovery\\other\\snapshots\\${snapshotId}\\complete.json`,
    })).toThrow('one exact snapshot layout')
  })

  it('accepts the exact latest to complete to manifest hash chain', () => {
    expect(verifyR2CompleteManifestEvidence({
      ...validR2Evidence(),
      now: NOW,
    })).toMatchObject({
      defaultRestoreObjectCount: 1,
      objectCount: 2,
      orphanCount: 1,
      referencedObjectCount: 1,
      totalBytes: BODY.byteLength + ORPHAN_BODY.byteLength,
    })
  })

  it('rejects a non-production source ref and broken latest or complete chain', () => {
    const wrongSourceManifest = structuredClone(validR2Evidence().manifest)
    wrongSourceManifest.source.supabaseProjectRef = 'x'.repeat(20)
    expect(() => verifyR2CompleteManifestEvidence({
      ...signR2Evidence(wrongSourceManifest),
      now: NOW,
    })).toThrow('fixed production ref')

    const wrongComplete = validR2Evidence()
    wrongComplete.latest.completeKey = 'snapshots/wrong/complete.json'
    expect(() => verifyR2CompleteManifestEvidence({ ...wrongComplete, now: NOW })).toThrow('completion key')

    const missingComplete = validR2Evidence()
    expect(() => verifyR2CompleteManifestEvidence({
      ...missingComplete,
      complete: undefined,
      now: NOW,
    })).toThrow()
  })

  it('rejects duplicate manifest coverage before body verification', () => {
    const duplicate = structuredClone(validR2Evidence().manifest)
    duplicate.objects.push(structuredClone(duplicate.objects[0]))
    duplicate.objectCount = 3
    duplicate.referencedObjectCount = 2
    duplicate.totalBytes = (BODY.byteLength * 2) + ORPHAN_BODY.byteLength
    expect(() => verifyR2CompleteManifestEvidence({
      ...signR2Evidence(duplicate),
      now: NOW,
    })).toThrow('duplicate')
  })

  it('binds the parsed manifest to the exact manifest bytes in the hash chain', () => {
    const mismatched = validR2Evidence()
    mismatched.manifest.objects[0].bytes += 1
    expect(() => verifyR2CompleteManifestEvidence({
      ...mismatched,
      now: NOW,
    })).toThrow('exact bytes')
  })

  it('hashes referenced and quarantined bodies but defaults restore scope to referenced only', async () => {
    const fixture = materialFixture()
    await expect(verifyR2RestoreMaterial({
      manifest: fixture.manifest,
      bodyRoot: fixture.bodyRoot,
      workDirectory: fixture.workDirectory,
      encryptionProvider: 'bitlocker',
      runner: windowsProtectionRunner(),
    })).resolves.toEqual({
      defaultRestoreObjectCount: 1,
      objectCount: 2,
      orphanCount: 1,
      referencedObjectCount: 1,
      totalBytes: BODY.byteLength + ORPHAN_BODY.byteLength,
    })
  })

  it('fails closed when any actual EFS restore body lacks the Encrypted attribute', async () => {
    const fixture = materialFixture()
    const protectedRunner = windowsProtectionRunner()
    await expect(verifyR2RestoreMaterial({
      manifest: fixture.manifest,
      bodyRoot: fixture.bodyRoot,
      workDirectory: fixture.workDirectory,
      encryptionProvider: 'efs',
      runner: protectedRunner,
    })).resolves.toMatchObject({ objectCount: 2 })
    const protectedValues = protectedRunner.mock.calls.flatMap(([, , standardInput]) => (
      powerShellValues(standardInput)
    ))
    expect(protectedValues).toContain(fixture.bodyPath)
    expect(protectedValues).toContain(fixture.quarantineBodyPath)

    const unprotectedRunner = windowsProtectionRunner(fixture.quarantineBodyPath)
    await expect(verifyR2RestoreMaterial({
      manifest: fixture.manifest,
      bodyRoot: fixture.bodyRoot,
      workDirectory: fixture.workDirectory,
      encryptionProvider: 'efs',
      runner: unprotectedRunner,
    })).rejects.toThrow('Every selected recovery evidence and body file')
  })

  it('rejects missing, wrong-size, wrong-hash, and orphan restore bodies without printing paths', async () => {
    const missing = materialFixture()
    unlinkSync(missing.bodyPath)
    await expect(verifyR2RestoreMaterial({
      manifest: missing.manifest,
      bodyRoot: missing.bodyRoot,
      workDirectory: missing.workDirectory,
      encryptionProvider: 'bitlocker',
      runner: windowsProtectionRunner(),
    })).rejects.toThrow('coverage')

    const missingQuarantine = materialFixture()
    unlinkSync(missingQuarantine.quarantineBodyPath)
    await expect(verifyR2RestoreMaterial({
      manifest: missingQuarantine.manifest,
      bodyRoot: missingQuarantine.bodyRoot,
      workDirectory: missingQuarantine.workDirectory,
      encryptionProvider: 'bitlocker',
      runner: windowsProtectionRunner(),
    })).rejects.toThrow('coverage')

    const wrongSize = materialFixture()
    writeFileSync(wrongSize.bodyPath, Buffer.from('wrong'))
    await expect(verifyR2RestoreMaterial({
      manifest: wrongSize.manifest,
      bodyRoot: wrongSize.bodyRoot,
      workDirectory: wrongSize.workDirectory,
      encryptionProvider: 'bitlocker',
      runner: windowsProtectionRunner(),
    })).rejects.toThrow('byte length')

    const wrongHash = materialFixture()
    wrongHash.manifest.objects[0].sha256 = 'd'.repeat(64)
    await expect(verifyR2RestoreMaterial({
      manifest: wrongHash.manifest,
      bodyRoot: wrongHash.bodyRoot,
      workDirectory: wrongHash.workDirectory,
      encryptionProvider: 'bitlocker',
      runner: windowsProtectionRunner(),
    })).rejects.toThrow('SHA-256')

    const orphan = materialFixture()
    writeFileSync(join(orphan.bodyRoot, 'unexpected-body.jpg'), BODY)
    let message = ''
    try {
      await verifyR2RestoreMaterial({
        manifest: orphan.manifest,
        bodyRoot: orphan.bodyRoot,
        workDirectory: orphan.workDirectory,
        encryptionProvider: 'bitlocker',
        runner: windowsProtectionRunner(),
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('coverage')
    expect(message).not.toContain(orphan.workDirectory)
    expect(message).not.toContain('unexpected-body.jpg')
  })

  it('rejects invalid quarantine classification counts, paths, and owner metadata', () => {
    const wrongCount = structuredClone(validR2Evidence().manifest)
    wrongCount.orphanCount = 0
    expect(() => verifyR2CompleteManifestEvidence({
      ...signR2Evidence(wrongCount),
      now: NOW,
    })).toThrow('classification counts')

    const wrongPath = structuredClone(validR2Evidence().manifest)
    wrongPath.objects[1].backupKey = `snapshots/${wrongPath.snapshotId}/objects/legacy/orphan-photo.jpg`
    expect(() => verifyR2CompleteManifestEvidence({
      ...signR2Evidence(wrongPath),
      now: NOW,
    })).toThrow('canonical snapshot path')

    const leakedOwner = structuredClone(validR2Evidence().manifest)
    leakedOwner.objects[1].ownerScope = 'lab'
    expect(() => verifyR2CompleteManifestEvidence({
      ...signR2Evidence(leakedOwner),
      now: NOW,
    })).toThrow('fields')
  })
})

describe('Windows temporary directory and local tool isolation', () => {
  const safeWorkDirectory = 'C:\\Users\\operator\\AppData\\Local\\Temp\\burillab-recovery\\run-20260825'
  const safeArguments = {
    configuredPath: safeWorkDirectory,
    realPath: safeWorkDirectory,
    repositoryRoot: 'C:\\workspace\\buril-lab',
    syncRoots: ['C:\\Users\\operator\\OneDrive'],
    allowedRoots: ['C:\\Users\\operator\\AppData\\Local\\Temp'],
    encryptionProvider: 'bitlocker',
    encryptionStatus: 'protected',
    reparseStatus: 'clear',
    syncProbeStatus: 'clear',
    platform: 'win32' as const,
  }

  it('derives approved roots from Windows temp and USERPROFILE without hardcoding a user path', () => {
    expect(reviewedWindowsWorkRoots({
      TEMP: 'C:\\Users\\alice\\AppData\\Local\\Temp',
      TMP: 'C:\\Users\\alice\\AppData\\Local\\Temp',
      USERPROFILE: 'C:\\Users\\alice',
      BURILLAB_RECOVERY_ALLOWED_WORK_ROOT: 'D:\\untrusted',
    })).toEqual([
      'C:\\Users\\alice\\AppData\\Local\\Temp',
      'C:\\Users\\alice\\.codex-tmp',
    ])
  })

  it('accepts only a non-reparse child of an approved Windows root with live encryption', () => {
    expect(verifyRecoveryWorkDirectory(safeArguments)).toEqual({ volumeRoot: 'C:\\' })
    expect(verifyRecoveryWorkDirectory({
      ...safeArguments,
      encryptionProvider: 'efs',
    })).toEqual({ volumeRoot: 'C:\\' })
  })

  it.each([
    'C:\\Users\\operator\\OneDrive\\Temp\\run',
    'C:\\Users\\operator\\Dropbox (Personal)\\Temp\\run',
    'C:\\Users\\operator\\Box\\Temp\\run',
    'C:\\Users\\operator\\Google Drive\\Temp\\run',
    'C:\\Users\\operator\\iCloudDrive\\Temp\\run',
    'G:\\My Drive\\Temp\\run',
  ])('rejects known sync path %s', (workDirectory) => {
    const allowedRoot = workDirectory.slice(0, workDirectory.lastIndexOf('\\run'))
    expect(() => verifyRecoveryWorkDirectory({
      ...safeArguments,
      configuredPath: workDirectory,
      realPath: workDirectory,
      allowedRoots: [allowedRoot],
    })).toThrow('synchronization')
  })

  it.each([
    ['same path', safeWorkDirectory],
    ['sync root above work directory', 'C:\\Users\\operator\\AppData\\Local\\Temp\\burillab-recovery'],
    ['sync root below work directory', `${safeWorkDirectory}\\Nested-Sync-Root\\`],
  ])('rejects configured synchronization overlap in both directions: %s', (_label, syncRoot) => {
    expect(() => verifyRecoveryWorkDirectory({
      ...safeArguments,
      syncRoots: [syncRoot],
    })).toThrow('overlap a configured synchronization root')
  })

  it('does not confuse a sibling prefix with synchronization overlap', () => {
    expect(verifyRecoveryWorkDirectory({
      ...safeArguments,
      syncRoots: [`${safeWorkDirectory}-sibling`],
    })).toEqual({ volumeRoot: 'C:\\' })
  })

  it.each(['reparse', 'unknown', undefined])('fails closed for reparse status %s', (reparseStatus) => {
    expect(() => verifyRecoveryWorkDirectory({ ...safeArguments, reparseStatus })).toThrow('reparse-point status')
  })

  it.each(['sync', 'unknown', undefined])('fails closed for synchronization probe status %s', (syncProbeStatus) => {
    expect(() => verifyRecoveryWorkDirectory({ ...safeArguments, syncProbeStatus })).toThrow('synchronization-root status')
  })

  it('rejects paths outside approved roots and ambiguous sync roots', () => {
    expect(() => verifyRecoveryWorkDirectory({
      ...safeArguments,
      configuredPath: 'R:\\burillab-recovery\\run',
      realPath: 'R:\\burillab-recovery\\run',
    })).toThrow('approved Windows recovery root')
    expect(() => verifyRecoveryWorkDirectory({
      ...safeArguments,
      syncRoots: ['relative-sync-root'],
    })).toThrow('ambiguous')
  })

  it('requires the reviewed tool versions', () => {
    expect(verifyReadOnlyToolVersions({
      windowsPowerShell: '5.1.26100.9168',
      supabase: '2.115.0',
      pgDump: 'pg_dump (PostgreSQL) 17.11',
      pgRestore: 'pg_restore (PostgreSQL) 17.11',
      psql: 'psql (PostgreSQL) 17.11',
    }, 17)).toEqual({
      windowsPowerShellVersion: '5.1.26100',
      supabaseVersion: '2.115.0',
      pgDumpVersion: '17.11.0',
      pgRestoreVersion: '17.11.0',
      psqlVersion: '17.11.0',
    })
    expect(() => verifyReadOnlyToolVersions({
      windowsPowerShell: '5.1.26100.9168',
      supabase: '2.115.0',
      pgDump: 'pg_dump (PostgreSQL) 17.10',
      pgRestore: 'pg_restore (PostgreSQL) 17.11',
      psql: 'psql (PostgreSQL) 17.11',
    }, 17)).toThrow('17.11.0')
  })

  it('hashes the selected official archive and rejects altered portable tool material', async () => {
    const allowedRoot = mkdtempSync(join(tmpdir(), 'burillab-pg-portable-'))
    temporaryDirectories.push(allowedRoot)
    const binDirectory = join(allowedRoot, 'pgsql', 'bin')
    mkdirSync(binDirectory, { recursive: true })
    const pgDumpPath = join(binDirectory, 'pg_dump.exe')
    const pgRestorePath = join(binDirectory, 'pg_restore.exe')
    const psqlPath = join(binDirectory, 'psql.exe')
    const archivePath = join(allowedRoot, 'postgresql-portable.zip')
    for (const toolPath of [pgDumpPath, pgRestorePath, psqlPath]) writeFileSync(toolPath, 'tool')
    writeFileSync(archivePath, 'altered-archive')

    expect(REQUIRED_POSTGRES_ARCHIVE_SHA256).toBe(
      '6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3',
    )
    await expect(verifyPostgresPortableArtifacts({
      pgDumpPath,
      pgRestorePath,
      psqlPath,
      archivePath,
      allowedRoot,
      platform: 'win32',
    })).rejects.toThrow('SHA-256')
  })

  it('pins the full PostgreSQL bin set independently of runtime archive content', async () => {
    const canonicalManifest = JSON.stringify(
      REQUIRED_POSTGRES_BIN_MANIFEST
        .map(({ name, bytes, sha256 }) => [name, bytes, sha256])
        .sort(([left], [right]) => String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0),
    )
    expect(REQUIRED_POSTGRES_BIN_MANIFEST).toHaveLength(69)
    expect(Buffer.byteLength(canonicalManifest, 'utf8')).toBe(6538)
    expect(createHash('sha256').update(canonicalManifest).digest('hex')).toBe(
      '4f1cdc4b3cb3e49775a555ca80a6651ed938f4a2d5d536d57851e82baf32adee',
    )
    expect(REQUIRED_POSTGRES_BIN_MANIFEST.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['pg_dump.exe', 'pg_restore.exe', 'psql.exe', 'libpq.dll']),
    )

    const allowedRoot = mkdtempSync(join(tmpdir(), 'burillab-pg-binding-'))
    temporaryDirectories.push(allowedRoot)
    const binDirectory = join(allowedRoot, 'pgsql', 'bin')
    mkdirSync(binDirectory, { recursive: true })
    const attackerChosenBodies = {
      'pg_dump.exe': Buffer.from('attacker-pg-dump', 'utf8'),
      'pg_restore.exe': Buffer.from('attacker-pg-restore', 'utf8'),
      'psql.exe': Buffer.from('attacker-psql', 'utf8'),
      'libpq.dll': Buffer.from('attacker-libpq-companion', 'utf8'),
    }
    for (const [name, body] of Object.entries(attackerChosenBodies)) {
      writeFileSync(join(binDirectory, name), body)
    }
    const archivePath = join(allowedRoot, 'postgresql-portable.zip')
    const attackerArchiveEntries = Object.entries(attackerChosenBodies).map(([name, body]) => ({
      name: `pgsql/bin/${name}`,
      body,
    }))
    writeFileSync(archivePath, storedZip(attackerArchiveEntries))

    await expect(verifyPostgresArchiveToolBinding({
      archivePath,
      pgDumpPath: join(binDirectory, 'pg_dump.exe'),
      pgRestorePath: join(binDirectory, 'pg_restore.exe'),
      psqlPath: join(binDirectory, 'psql.exe'),
    })).rejects.toThrow('pinned official 17.11 manifest')

    writeFileSync(archivePath, storedZip([
      ...attackerArchiveEntries,
      { name: 'pgsql/bin/nested/evil.dll', body: Buffer.from('evil', 'utf8') },
    ]))
    await expect(verifyPostgresArchiveToolBinding({
      archivePath,
      pgDumpPath: join(binDirectory, 'pg_dump.exe'),
      pgRestorePath: join(binDirectory, 'pg_restore.exe'),
      psqlPath: join(binDirectory, 'psql.exe'),
    })).rejects.toThrow('unsafe or nested reviewed bin entry')

    writeFileSync(archivePath, storedZip(attackerArchiveEntries.map((entry) => (
      entry.name.endsWith('/libpq.dll') ? { ...entry, externalAttributes: 0xa0000000 } : entry
    ))))
    await expect(verifyPostgresArchiveToolBinding({
      archivePath,
      pgDumpPath: join(binDirectory, 'pg_dump.exe'),
      pgRestorePath: join(binDirectory, 'pg_restore.exe'),
      psqlPath: join(binDirectory, 'psql.exe'),
    })).rejects.toThrow('unsafe or nested reviewed bin entry')

    writeFileSync(archivePath, storedZip([
      ...attackerArchiveEntries,
      { name: '.\\pgsql\\bin\\shadow.dll', body: Buffer.from('shadow', 'utf8') },
    ]))
    await expect(verifyPostgresArchiveToolBinding({
      archivePath,
      pgDumpPath: join(binDirectory, 'pg_dump.exe'),
      pgRestorePath: join(binDirectory, 'pg_restore.exe'),
      psqlPath: join(binDirectory, 'psql.exe'),
    })).rejects.toThrow('noncanonical reviewed bin path')

    writeFileSync(archivePath, storedZip(attackerArchiveEntries))
    writeFileSync(join(binDirectory, 'psql.exe.local'), 'redirect DLL loading')
    await expect(verifyPostgresArchiveToolBinding({
      archivePath,
      pgDumpPath: join(binDirectory, 'pg_dump.exe'),
      pgRestorePath: join(binDirectory, 'pg_restore.exe'),
      psqlPath: join(binDirectory, 'psql.exe'),
    })).rejects.toThrow('pinned official 17.11 manifest')
  })
  it('fails closed when the PostgreSQL bin directory or any companion has a reparse attribute', async () => {
    const allowedRoot = mkdtempSync(join(tmpdir(), 'burillab-pg-reparse-'))
    temporaryDirectories.push(allowedRoot)
    const binDirectory = join(allowedRoot, 'pgsql', 'bin')
    mkdirSync(binDirectory, { recursive: true })
    writeFileSync(join(binDirectory, 'libpq.dll'), 'companion')
    const clearRunner = vi.fn(async () => 'clear\n')
    await expect(verifyPostgresBinReparseAttributes({
      binDirectory,
      runner: clearRunner,
    })).resolves.toEqual({ reparseStatus: 'clear' })
    const [, probeArguments, standardInput] = clearRunner.mock.calls[0]
    expect(clearRunner.mock.calls[0][0]).toBe(TRUSTED_WINDOWS_POWERSHELL_PATH)
    expect(probeArguments).toEqual([
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-Command', '-',
    ])
    expect(standardInput).toContain('[IO.FileAttributes]::ReparsePoint')
    expect(standardInput).toContain('Get-ChildItem -LiteralPath $directory.FullName')
    expect(standardInput).toContain('$item.PSIsContainer')
    expect(powerShellValues(standardInput)).toContain(binDirectory)

    await expect(verifyPostgresBinReparseAttributes({
      binDirectory,
      runner: vi.fn(async () => 'reparse\n'),
    })).rejects.toThrow('reparse status is not unambiguously clear')
  })

  it('runs only trusted OS probes and rejects an unattested portable tool object', async () => {
    const calls: Array<[string, string[], string]> = []
    const runner = vi.fn(async (executable: string, args: string[], standardInput = '') => {
      calls.push([executable, args, standardInput])
      if (standardInput.includes('Get-AuthenticodeSignature')) {
        return 'trusted|5.1.26100.9168|Desktop|True\n'
      }
      if (standardInput.includes('Get-BitLockerVolume')) return 'protected\n'
      if (standardInput.includes('SyncRootManager') || standardInput.includes('ReparsePoint')) return 'clear\n'
      throw new Error('Unexpected probe')
    })
    const postgresTools = postgresProbeFixture()
    const repositoryRoot = localSupabaseCliFixture()

    await expect(probeReadOnlyPrerequisites({
      targetPostgresMajor: 17,
      volumeRoot: 'C:\\',
      workDirectory: safeWorkDirectory,
      encryptionProvider: 'bitlocker',
      postgresTools,
      repositoryRoot,
      runner,
    })).rejects.toThrow('internally attested pinned official PostgreSQL artifact')
    expect(calls).toHaveLength(4)
    expect(calls.every(([executable]) => executable === TRUSTED_WINDOWS_POWERSHELL_PATH)).toBe(true)
    const probeScripts = calls.map(([, , standardInput]) => standardInput).join(' ')
    expect(probeScripts).toContain('SyncRootManager')
    expect(probeScripts).toContain('Dropbox\\info.json')
    expect(probeScripts).toContain('$env:Box')
    expect(probeScripts).toContain('$env:GoogleDrive')
    expect(probeScripts).toContain('$env:iCloudDrive')
    const syncProbeScript = calls.find(([, , standardInput]) => (
      standardInput.includes('SyncRootManager')
    ))?.[2]
    expect(syncProbeScript).toContain('$target.StartsWith($normalized')
    expect(syncProbeScript).toContain('$normalized.StartsWith($target')
    expect(probeScripts).not.toContain('npx.cmd')
    expect(probeScripts).not.toContain('ProcessStartInfo')
    expect(calls.some(([executable]) => executable === 'docker')).toBe(false)
  })

  it('fails before tool execution when the read-only sync probe reports reverse overlap', async () => {
    const calls: Array<[string, string[], string]> = []
    const runner = vi.fn(async (executable: string, args: string[], standardInput = '') => {
      calls.push([executable, args, standardInput])
      if (standardInput.includes('Get-AuthenticodeSignature')) {
        return 'trusted|5.1.26100.9168|Desktop|True\n'
      }
      if (standardInput.includes('Get-BitLockerVolume')) return 'protected\n'
      if (standardInput.includes('ReparsePoint')) return 'clear\n'
      if (standardInput.includes('SyncRootManager')) return 'sync\n'
      throw new Error('Unexpected probe')
    })

    await expect(probeRecoveryWorkDirectoryProtection({
      volumeRoot: 'C:\\',
      workDirectory: safeWorkDirectory,
      encryptionProvider: 'bitlocker',
      runner,
    })).rejects.toThrow('synchronization-root probe did not return clear status')
    expect(calls).toHaveLength(4)
    expect(calls.every(([executable]) => executable === TRUSTED_WINDOWS_POWERSHELL_PATH)).toBe(true)
    const syncProbeScript = calls.at(-1)?.[2]
    expect(syncProbeScript).toContain('$normalized.StartsWith($target')
  })

  it('accepts EFS only after probing the exact directory and its direct-child encrypted file', async () => {
    const calls: Array<[string, string[], string]> = []
    const runner = vi.fn(async (executable: string, args: string[], standardInput = '') => {
      calls.push([executable, args, standardInput])
      if (standardInput.includes('Get-AuthenticodeSignature')) {
        return 'trusted|5.1.26100.9168|Desktop|True\n'
      }
      if (standardInput.includes('[IO.FileAttributes]::Encrypted')) return 'protected\n'
      if (standardInput.includes('ReparsePoint') || standardInput.includes('OneDriveCommercial')) return 'clear\n'
      throw new Error('Unexpected probe')
    })
    const efsProbeFile = `${safeWorkDirectory}\\efs-inheritance.probe`

    await expect(probeRecoveryWorkDirectoryProtection({
      volumeRoot: 'C:\\',
      workDirectory: safeWorkDirectory,
      encryptionProvider: 'efs',
      efsProbeFile,
      runner,
    })).resolves.toMatchObject({ encryptionStatus: 'protected' })
    expect(calls.some(([, , standardInput]) => powerShellValues(standardInput).includes(efsProbeFile))).toBe(true)
    expect(calls.some(([, , standardInput]) => standardInput.includes('CreationTimeUtc'))).toBe(true)
    expect(calls.some(([, , standardInput]) => standardInput.includes('Get-BitLockerVolume'))).toBe(false)
    await expect(probeRecoveryWorkDirectoryProtection({
      volumeRoot: 'C:\\',
      workDirectory: safeWorkDirectory,
      encryptionProvider: 'efs',
      runner,
    })).rejects.toThrow('inputs')
  })

  it('checks the EFS Encrypted attribute on every consumed evidence and hash-chain file', async () => {
    const workDirectory = mkdtempSync(join(tmpdir(), 'burillab-efs-files-'))
    temporaryDirectories.push(workDirectory)
    const filePaths = [
      'preflight-evidence.json',
      'latest.json',
      'complete.json',
      'manifest.json',
      'manifest.sha256',
      'body.bin',
      ...Array.from({ length: 65 }, (_value, index) => `nested-body-${index}.bin`),
    ].map((name) => {
      const filePath = join(workDirectory, name)
      writeFileSync(filePath, name)
      return filePath
    })
    const protectedRunner = windowsProtectionRunner()
    await expect(verifyEfsEncryptedFiles({
      filePaths,
      runner: protectedRunner,
    })).resolves.toEqual({ encryptedFileCount: filePaths.length })
    expect(protectedRunner).toHaveBeenCalledTimes(2)
    expect(protectedRunner.mock.calls.every(([executable]) => (
      executable === TRUSTED_WINDOWS_POWERSHELL_PATH
    ))).toBe(true)
    const allScripts = protectedRunner.mock.calls.map(([, , standardInput]) => standardInput).join(' ')
    const allValues = protectedRunner.mock.calls.flatMap(([, , standardInput]) => (
      powerShellValues(standardInput)
    ))
    expect(allScripts).toContain('foreach ($selectedPath in $args)')
    expect(allScripts).toContain('$item.Attributes -band $encrypted')
    for (const filePath of filePaths) expect(allValues).toContain(filePath)

    const unprotectedPath = filePaths.at(-1)!
    await expect(verifyEfsEncryptedFiles({
      filePaths,
      runner: windowsProtectionRunner(unprotectedPath),
    })).rejects.toThrow('Every selected recovery evidence and body file')
  })

  it('statically requires one exact project-local Supabase CLI package and lock entry', () => {
    const repositoryRoot = localSupabaseCliFixture()
    expect(verifyLocalSupabaseCliPackage({ repositoryRoot })).toEqual({
      supabaseVersion: '2.115.0',
    })

    writeFileSync(join(repositoryRoot, 'package.json'), JSON.stringify({
      dependencies: { supabase: '2.115.0' },
      devDependencies: { supabase: '2.115.0' },
    }))
    expect(() => verifyLocalSupabaseCliPackage({ repositoryRoot })).toThrow('exactly locked')
    writeFileSync(join(repositoryRoot, 'package.json'), JSON.stringify({
      devDependencies: { supabase: '2.115.0' },
    }))

    writeFileSync(join(repositoryRoot, 'node_modules', 'supabase', 'package.json'), JSON.stringify({
      name: 'supabase',
      version: '2.115.1',
    }))
    expect(() => verifyLocalSupabaseCliPackage({ repositoryRoot })).toThrow('exactly locked')

    writeFileSync(join(repositoryRoot, 'node_modules', 'supabase', 'package.json'), JSON.stringify({
      name: 'supabase',
      version: '2.115.0',
    }))
    const exactLock = JSON.parse(readFileSync(join(repositoryRoot, 'package-lock.json'), 'utf8'))
    const ambiguousLock = structuredClone(exactLock)
    ambiguousLock.packages[''].dependencies = { supabase: '2.115.1' }
    writeFileSync(join(repositoryRoot, 'package-lock.json'), JSON.stringify(ambiguousLock))
    expect(() => verifyLocalSupabaseCliPackage({ repositoryRoot })).toThrow('exactly locked')

    for (const section of ['optionalDependencies', 'peerDependencies']) {
      const duplicateLock = structuredClone(exactLock)
      duplicateLock.packages[''][section] = { supabase: '2.115.0' }
      writeFileSync(join(repositoryRoot, 'package-lock.json'), JSON.stringify(duplicateLock))
      expect(() => verifyLocalSupabaseCliPackage({ repositoryRoot })).toThrow('exactly locked')
    }

    const missingRoot = mkdtempSync(join(tmpdir(), 'burillab-missing-cli-'))
    temporaryDirectories.push(missingRoot)
    writeFileSync(join(missingRoot, 'package.json'), JSON.stringify({
      devDependencies: { supabase: '2.115.0' },
    }))
    writeFileSync(join(missingRoot, 'package-lock.json'), JSON.stringify({ packages: {} }))
    expect(() => verifyLocalSupabaseCliPackage({ repositoryRoot: missingRoot })).toThrow()
  })

  it('does not accept a caller-forged pinned manifest as an artifact attestation', async () => {
    const postgresTools = postgresProbeFixture()
    const repositoryRoot = localSupabaseCliFixture()
    await expect(probeReadOnlyToolPrerequisites({
      targetPostgresMajor: 17,
      postgresTools,
      repositoryRoot,
      windowsPowerShellVersion: '5.1.26100',
    })).rejects.toThrow('internally attested pinned official PostgreSQL artifact')
  })

  it('fails closed on batched file, ancestor, or recursive-directory reparse evidence', async () => {
    const fixture = materialFixture()
    const clearRunner = windowsProtectionRunner()
    await expect(verifyWindowsTreeNoReparse({
      rootDirectories: [fixture.bodyRoot],
      runner: clearRunner,
    })).resolves.toEqual({ inspectedRootCount: 1 })
    await expect(verifyWindowsNoReparsePaths({
      directoryPaths: [fixture.bodyRoot],
      filePaths: [fixture.bodyPath, fixture.quarantineBodyPath],
      ancestorRoot: fixture.workDirectory,
      runner: clearRunner,
    })).resolves.toEqual({ inspectedPathCount: 3 })
    const scripts = clearRunner.mock.calls.map(([, , standardInput]) => standardInput).join(' ')
    expect(scripts).toContain("Queue[System.IO.DirectoryInfo]")
    expect(scripts).toContain('$current.Parent')
    expect(scripts).not.toContain('Get-ChildItem -LiteralPath $directory.FullName -Recurse')

    await expect(verifyWindowsTreeNoReparse({
      rootDirectories: [fixture.bodyRoot],
      runner: vi.fn(async () => 'reparse\n'),
    })).rejects.toThrow('recursive recovery directory')
    await expect(verifyWindowsNoReparsePaths({
      filePaths: [fixture.bodyPath],
      ancestorRoot: fixture.workDirectory,
      runner: vi.fn(async () => 'reparse\n'),
    })).rejects.toThrow('clear Windows reparse attribute')
  })

  it.runIf(process.platform === 'win32')('uses the real default runner with signed 64-bit Windows PowerShell 5.1', async () => {
    await expect(probeTrustedWindowsPowerShell()).resolves.toMatchObject({
      windowsPowerShellVersion: expect.stringMatching(/^5\.1\./),
    })
  })

  it('contains no mutating HTTP method, shell execution, or self-reported protected ref flags', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'verify-supabase-recovery-preflight.mjs'), 'utf8')
    expect(source).not.toMatch(/method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/)
    expect(source).not.toContain('shell: true')
    expect(source).not.toContain("'--source-ref'")
    expect(source).not.toContain("'--staging-ref'")
    expect(source.toLowerCase()).not.toContain('docker')
    expect(source).not.toContain("runner('pwsh'")
    expect(source).not.toContain('npx.cmd')
    expect(source).not.toContain('execFile(')
    expect(source).not.toContain('ProcessStartInfo')
    expect(source).not.toContain('BurilLabNativeFileLockAssembly')
    expect(source).not.toContain('[IO.FileShare]::Read')
    expect(source).not.toContain('$start.Arguments = "--version"')
    expect(source).toContain("'--work-directory'")
    expect(source).toContain("'--encryption-provider'")
    expect(source).toContain(TRUSTED_WINDOWS_POWERSHELL_PATH.replaceAll('\\', '\\\\'))
    const runSource = source.slice(source.indexOf('export async function runRecoveryPreflight'))
    expect(runSource.indexOf('const preliminaryBodyTree')).toBeLessThan(
      runSource.indexOf('fetchSupabaseLiveRecoveryProbe({'),
    )
    expect(source).toContain("import { RELEASE_ENVIRONMENTS } from './write-release-manifest.mjs'")
  })
})
