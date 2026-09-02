import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { runScheduledBackup } from '../src/storageBackup'

const RUNTIME_CONFIG_KEY = 'runtime_config'
const SENTINEL_KEY = 'runtime-tests/sentinel.txt'

async function setBackupEnabled(enabled: boolean): Promise<void> {
  await env.BURILLAB_RUNTIME_CONFIG.put(RUNTIME_CONFIG_KEY, JSON.stringify({
    voice_disposal_mode: 'redirect',
    kosha_content_mode: 'link_only',
    account_deletion_enabled: false,
    maintenance_worker_enabled: false,
    storage_backup_enabled: enabled,
  }))
}

async function expectSentinelUnchanged(): Promise<void> {
  const stored = await env.CABINET_BACKUPS.get(SENTINEL_KEY)
  expect(stored).not.toBeNull()
  expect(await stored?.text()).toBe('unchanged')
  const listed = await env.CABINET_BACKUPS.list()
  expect(listed.objects.map((entry) => entry.key)).toEqual([SENTINEL_KEY])
}

describe('scheduled Worker in the Cloudflare runtime', () => {
  beforeEach(async () => {
    await env.BURILLAB_RUNTIME_CONFIG.delete(RUNTIME_CONFIG_KEY)
    const existing = await env.CABINET_BACKUPS.list()
    if (existing.objects.length > 0) {
      await env.CABINET_BACKUPS.delete(existing.objects.map((entry) => entry.key))
    }
    await env.CABINET_BACKUPS.put(SENTINEL_KEY, 'unchanged')
  })

  it('has no public fetch handler and exits cleanly while the KV flag is off', async () => {
    expect('fetch' in worker).toBe(false)
    await setBackupEnabled(false)

    await expect(worker.scheduled({} as ScheduledController, env)).resolves.toBeUndefined()

    await expectSentinelUnchanged()
  })

  it('treats a non-boolean enabled value as OFF on the paid profile', async () => {
    await env.BURILLAB_RUNTIME_CONFIG.put(RUNTIME_CONFIG_KEY, JSON.stringify({
      voice_disposal_mode: 'redirect',
      kosha_content_mode: 'link_only',
      account_deletion_enabled: false,
      maintenance_worker_enabled: false,
      storage_backup_enabled: 'true',
    }))

    await expect(worker.scheduled({} as ScheduledController, env)).resolves.toBeUndefined()

    await expectSentinelUnchanged()
  })

  it('migrates a mixed v1 snapshot without changing its quarantine and reuses the next v2 bodies', async () => {
    await setBackupEnabled(true)
    const encoder = new TextEncoder()
    const snapshotId = 'legacy-runtime-fixture'
    const sourceNames = ['current-reference.jpg', 'current-orphan.jpg']
    const sourceBodies = sourceNames.map((name) => encoder.encode(`synthetic-${name}`))
    const hashes = await Promise.all(sourceBodies.map(async (body) => (
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', body)), (byte) => (
        byte.toString(16).padStart(2, '0')
      )).join('')
    )))
    const objects = sourceNames.map((sourcePath, index) => ({
      sourcePath,
      backupKey: `snapshots/${snapshotId}/${index === 0 ? 'objects' : 'quarantine/unreferenced'}/${sourcePath}`,
      bytes: sourceBodies[index].byteLength,
      sha256: hashes[index],
      classification: index === 0 ? 'referenced' : 'unreferenced',
      ...(index === 0 ? { ownerScope: 'lab' } : {}),
      contentType: 'image/jpeg',
    }))
    const putHashed = async (key: string, body: Uint8Array) => {
      await env.CABINET_BACKUPS.put(key, body, {
        sha256: await crypto.subtle.digest('SHA-256', new Uint8Array(body)),
      })
    }
    for (let index = 0; index < objects.length; index += 1) {
      await putHashed(objects[index].backupKey, sourceBodies[index])
    }
    const manifest = {
      schemaVersion: 1,
      snapshotId,
      environment: 'staging',
      createdAt: new Date().toISOString(),
      source: { supabaseProjectRef: env.SUPABASE_PROJECT_REF, storageBucket: 'cabinets', pointerMode: 'legacy_url' },
      objectCount: 2,
      referencedObjectCount: 1,
      orphanCount: 1,
      totalBytes: sourceBodies.reduce((total, body) => total + body.byteLength, 0),
      objects,
    }
    const manifestBody = encoder.encode(`${JSON.stringify(manifest)}\n`)
    const manifestSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', manifestBody)), (byte) => (
      byte.toString(16).padStart(2, '0')
    )).join('')
    const complete = {
      schemaVersion: 1,
      snapshotId,
      environment: 'staging',
      completedAt: new Date().toISOString(),
      manifestKey: `snapshots/${snapshotId}/manifest.json`,
      manifestSha256,
      objectCount: 2,
      referencedObjectCount: 1,
      orphanCount: 1,
      totalBytes: manifest.totalBytes,
    }
    await putHashed(complete.manifestKey, manifestBody)
    await putHashed(`snapshots/${snapshotId}/manifest.sha256`, encoder.encode(`${manifestSha256}\n`))
    await putHashed(`snapshots/${snapshotId}/complete.json`, encoder.encode(`${JSON.stringify(complete)}\n`))
    await putHashed('control/latest.json', encoder.encode(`${JSON.stringify({
      schemaVersion: 1,
      snapshotId,
      environment: 'staging',
      completeKey: `snapshots/${snapshotId}/complete.json`,
      manifestSha256,
      completedAt: complete.completedAt,
      orphanCount: 1,
    })}\n`))

    let downloads = 0
    const sourceFetch: typeof fetch = async (input) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
      expect(url.origin).toBe(env.SUPABASE_URL)
      if (url.pathname === '/rest/v1/cabinets') return Response.json([{
        id: '11111111-1111-4111-8111-111111111111',
        lab_id: '22222222-2222-4222-8222-222222222222',
        user_id: null,
        image_url: `${env.SUPABASE_URL}/storage/v1/object/public/cabinets/${sourceNames[0]}`,
      }])
      if (url.pathname === '/storage/v1/object/list/cabinets') return Response.json(sourceNames.map((name, index) => ({
        name,
        id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`,
        updated_at: '2026-08-25T00:00:00.000Z',
        metadata: { size: sourceBodies[index].byteLength, eTag: `source-${index}` },
      })))
      const index = sourceNames.findIndex((name) => url.pathname === `/storage/v1/object/cabinets/${name}`)
      if (index < 0) throw new Error('Unexpected synthetic source request')
      downloads += 1
      return new Response(sourceBodies[index], { headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(sourceBodies[index].byteLength),
        ETag: `source-${index}`,
      } })
    }
    const first = await runScheduledBackup(env, { fetch: sourceFetch })
    expect(first).toMatchObject({ status: 'completed', count: 2, orphanCount: 1 })
    expect(downloads).toBe(2)
    const second = await runScheduledBackup(env, { fetch: sourceFetch })
    expect(second).toMatchObject({ status: 'completed', count: 2, orphanCount: 1 })
    expect(downloads).toBe(2)
    const latest = await (await env.CABINET_BACKUPS.get('control/latest.json'))?.json<{ snapshotId: string }>()
    expect(latest?.snapshotId).not.toBe(snapshotId)
    const current = await (await env.CABINET_BACKUPS.get(`snapshots/${latest?.snapshotId}/manifest.json`))?.json()
    expect(current).toMatchObject({ schemaVersion: 2, uploadedBodyCount: 0, reusedBodyCount: 2, orphanCount: 1 })
    for (let index = 0; index < objects.length; index += 1) {
      const retained = await env.CABINET_BACKUPS.get(objects[index].backupKey)
      expect(new Uint8Array(await retained!.arrayBuffer())).toEqual(sourceBodies[index])
    }
  })
})
