import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  createExactLengthPng,
  extractSafeWorkerFailureDiagnostic,
  STAGING_STORAGE_BACKUP_ACCEPTANCE_CONTRACT,
  validateAcceptanceTriggerUrl,
  verifyAcceptanceManifest,
  verifyScheduledTriggerResponse,
} from './staging-storage-backup-acceptance.mjs'

const SNAPSHOT_ID = '20260827t120000000z-00112233445566778899aabb'
const STARTED_AT = Date.parse('2026-08-27T11:59:00.000Z')

function fixture() {
  const items = [
    {
      path: 'burillab-storage-backup-acceptance/fixture-a.png',
      bytes: 1_700_000,
      rgba: [23, 91, 146, 255],
    },
    {
      path: 'burillab-storage-backup-acceptance/fixture-b.png',
      bytes: 1_710_853,
      rgba: [20, 132, 92, 255],
    },
  ].map((item) => {
    const body = createExactLengthPng(item.bytes, item.rgba)
    return { ...item, sha256: createHash('sha256').update(body).digest('hex') }
  })
  const expected = items.map((item, index) => ({
    ...item,
    etag: `source-etag-${index}`,
    classification: 'referenced',
    ownerScope: 'lab',
    contentType: 'image/png',
  }))
  const manifest = {
    schemaVersion: 2,
    snapshotId: SNAPSHOT_ID,
    environment: 'staging',
    createdAt: '2026-08-27T12:00:00.000Z',
    source: {
      supabaseProjectRef: 'qpgnomuqdcucjmxrunnw',
      storageBucket: 'cabinets',
      pointerMode: 'legacy_url',
    },
    objectCount: 2,
    referencedObjectCount: 2,
    orphanCount: 0,
    totalBytes: 3_410_853,
    uploadedBodyCount: 2,
    reusedBodyCount: 0,
    objects: expected.map((item) => ({
      sourcePath: item.path,
      backupKey: `objects/sha256/${item.sha256.slice(0, 2)}/${item.sha256}`,
      etag: item.etag,
      bytes: item.bytes,
      sha256: item.sha256,
      classification: 'referenced',
      ownerScope: 'lab',
      contentType: 'image/png',
    })),
  }
  const manifestBody = Buffer.from(`${JSON.stringify(manifest)}\n`)
  const manifestSha256 = createHash('sha256').update(manifestBody).digest('hex')
  const complete = {
    schemaVersion: 2,
    snapshotId: SNAPSHOT_ID,
    environment: 'staging',
    completedAt: '2026-08-27T12:00:10.000Z',
    manifestKey: `snapshots/${SNAPSHOT_ID}/manifest.json`,
    manifestSha256,
    objectCount: 2,
    referencedObjectCount: 2,
    orphanCount: 0,
    totalBytes: 3_410_853,
    uploadedBodyCount: 2,
    reusedBodyCount: 0,
  }
  const latest = {
    schemaVersion: 2,
    snapshotId: SNAPSHOT_ID,
    environment: 'staging',
    completeKey: `snapshots/${SNAPSHOT_ID}/complete.json`,
    manifestSha256,
    completedAt: complete.completedAt,
    orphanCount: 0,
  }
  return { latest, complete, manifest, manifestBody, manifestSha256, expected }
}

describe('Staging storage backup acceptance contract', () => {
  it('extracts only allow-listed non-sensitive Worker failure codes', () => {
    expect(extractSafeWorkerFailureDiagnostic([
      'provider payload token=must-never-appear',
      'Error: storage_backup_failed:r2_verify_failed',
    ].join('\n'))).toEqual({ code: 'r2_verify_failed' })
    expect(extractSafeWorkerFailureDiagnostic(
      'Error: storage_backup_failed:source_request_failed:network_error',
    )).toEqual({ code: 'source_request_failed', diagnosticCode: 'network_error' })
    expect(extractSafeWorkerFailureDiagnostic(
      'prefix {"code":"r2_verify_failed","count":0,"bytes":0,"durationMs":264000,"orphanCount":0} suffix',
    )).toEqual({ code: 'r2_verify_failed' })
    expect(extractSafeWorkerFailureDiagnostic(
      'Error: storage_backup_failed:attacker_supplied_code:secret_value',
    )).toBeNull()
    expect(extractSafeWorkerFailureDiagnostic(
      '{"code":"r2_verify_failed","count":0,"bytes":0,"durationMs":1,"orphanCount":0,"secret":"must-never-appear"}',
    )).toBeNull()
    expect(extractSafeWorkerFailureDiagnostic('token=must-never-appear')).toBeNull()
  })

  it('constructs deterministic valid-sized PNG fixtures', () => {
    const first = createExactLengthPng(1_700_000, [23, 91, 146, 255])
    const repeated = createExactLengthPng(1_700_000, [23, 91, 146, 255])
    expect(first).toHaveLength(1_700_000)
    expect(first.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(first.subarray(-12, -8).readUInt32BE()).toBe(0)
    expect(first.subarray(-8, -4).toString('ascii')).toBe('IEND')
    expect(createHash('sha256').update(first).digest('hex'))
      .toBe(createHash('sha256').update(repeated).digest('hex'))
  })

  it('pins the exact isolated Staging targets and production-sized synthetic total', () => {
    expect(STAGING_STORAGE_BACKUP_ACCEPTANCE_CONTRACT).toMatchObject({
      projectRef: 'qpgnomuqdcucjmxrunnw',
      accountId: '692fedd5b67a5fd545bb16038bbd4c85',
      kvNamespaceId: 'dcaa52254fa6447bbe7c21f54354ad0d',
      workerName: 'buril-lab-storage-backup-staging',
      r2Bucket: 'buril-lab-cabinet-backups-staging',
      dailyCron: '15 17 * * *',
      objectCount: 2,
      completeSnapshotCount: 6,
      totalBytes: 3_410_853,
    })
    expect(STAGING_STORAGE_BACKUP_ACCEPTANCE_CONTRACT.fixturePaths).toEqual([
      'burillab-storage-backup-acceptance/fixture-a.png',
      'burillab-storage-backup-acceptance/fixture-b.png',
    ])
  })

  it('accepts only the exact loopback scheduled trigger contract', () => {
    expect(validateAcceptanceTriggerUrl(
      'http://127.0.0.1:8791/__scheduled?cron=%2A+%2A+%2A+%2A+%2A',
    )).toContain('127.0.0.1:8791/__scheduled?')
    expect(verifyScheduledTriggerResponse('Ran scheduled event')).toBe(true)
  })

  it.each([
    'https://127.0.0.1:8791/__scheduled?cron=%2A+%2A+%2A+%2A+%2A',
    'http://localhost:8791/__scheduled?cron=%2A+%2A+%2A+%2A+%2A',
    'http://127.0.0.1:8792/__scheduled?cron=%2A+%2A+%2A+%2A+%2A',
    'http://127.0.0.1:8791/__scheduled?cron=15+17+%2A+%2A+%2A',
    'http://127.0.0.1:8791/__scheduled?cron=%2A+%2A+%2A+%2A+%2A&extra=1',
  ])('rejects an unapproved scheduled trigger URL: %s', (value) => {
    expect(() => validateAcceptanceTriggerUrl(value)).toThrow()
  })

  it.each([
    '',
    'Ran scheduled event\n',
    'ran scheduled event',
  ])('rejects an unsuccessful or expanded scheduled trigger response', (value) => {
    expect(() => verifyScheduledTriggerResponse(value)).toThrow()
  })

  it('accepts only the complete latest-to-body hash chain', () => {
    const value = fixture()
    expect(verifyAcceptanceManifest({
      latest: value.latest,
      complete: value.complete,
      manifestBody: value.manifestBody,
      manifestShaText: `${value.manifestSha256}\n`,
      startedAt: STARTED_AT,
      previousSnapshotId: 'older-snapshot',
      expected: value.expected,
      expectedUploadedBodyCount: 2,
      expectedReusedBodyCount: 0,
    })).toMatchObject({ snapshotId: SNAPSHOT_ID })
  })

  it.each([
    ['old latest pointer', (value: ReturnType<typeof fixture>) => ({
      ...value,
      latest: { ...value.latest, completedAt: '2026-08-27T11:00:00.000Z' },
    })],
    ['orphan object', (value: ReturnType<typeof fixture>) => ({
      ...value,
      manifestBody: Buffer.from(`${JSON.stringify({ ...value.manifest, orphanCount: 1 })}\n`),
    })],
    ['wrong source path', (value: ReturnType<typeof fixture>) => ({
      ...value,
      manifestBody: Buffer.from(`${JSON.stringify({
        ...value.manifest,
        objects: value.manifest.objects.map((item, index) => (
          index === 0 ? { ...item, sourcePath: 'unexpected.png' } : item
        )),
      })}\n`),
    })],
    ['wrong manifest hash object', (value: ReturnType<typeof fixture>) => ({
      ...value,
      manifestSha256: '0'.repeat(64),
    })],
  ])('rejects %s', (_name, mutate) => {
    const value = mutate(fixture())
    expect(() => verifyAcceptanceManifest({
      latest: value.latest,
      complete: value.complete,
      manifestBody: value.manifestBody,
      manifestShaText: `${value.manifestSha256}\n`,
      startedAt: STARTED_AT,
      previousSnapshotId: 'older-snapshot',
      expected: value.expected,
      expectedUploadedBodyCount: 2,
      expectedReusedBodyCount: 0,
    })).toThrow()
  })
})
