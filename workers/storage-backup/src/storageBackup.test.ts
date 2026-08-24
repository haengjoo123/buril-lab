import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import worker from './index'
import {
  isStorageBackupEnabled,
  parseLegacyPublicUrl,
  parseSourcePointer,
  parseStrictObjectPath,
  resolveSourceConfig,
  runScheduledBackup,
  type BackupR2Bucket,
  type BackupRunResult,
  type RuntimeConfigKv,
  type SafeLogEntry,
  type StorageBackupBindings,
} from './storageBackup'

const STAGING_ORIGIN = 'https://qpgnomuqdcucjmxrunnw.supabase.co'
const STAGING_REF = 'qpgnomuqdcucjmxrunnw'
const CABINET_A = '11111111-1111-4111-8111-111111111111'
const CABINET_B = '11111111-1111-4111-8111-222222222222'
const CABINET_C = '11111111-1111-4111-8111-333333333333'
const LAB_A = '22222222-2222-4222-8222-222222222222'
const USER_A = '33333333-3333-4333-8333-333333333333'
const STORAGE_A = '44444444-4444-4444-8444-444444444444'
const STORAGE_B = '55555555-5555-4555-8555-555555555555'
const STORAGE_C = '66666666-6666-4666-8666-666666666666'
const TEST_SECRET = 'service-role-test-value-never-used-outside-unit-tests'
const FIXED_NOW = Date.parse('2026-08-25T12:00:00.000Z')

interface PointerFixture {
  id: string
  lab_id: string | null
  user_id: string | null
  image_url?: string
  image_path?: string
}

interface ObjectFixture {
  id: string
  path: string
  body: Uint8Array
  etag: string
  updatedAt: string
  contentType?: string
}

interface FakeStoredObject {
  body: Uint8Array
  etag: string
  checksum: ArrayBuffer
  customMetadata?: Record<string, string>
}

interface FakeR2Head {
  key: string
  size: number
  etag: string
  checksums: { sha256?: ArrayBuffer }
  customMetadata?: Record<string, string>
}

interface FakePutCall {
  key: string
  onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string }
}

class FakeKv implements RuntimeConfigKv {
  readonly get = vi.fn<(key: string, type: 'json') => Promise<unknown>>()
  private readonly values: unknown[]
  private index = 0

  constructor(...values: unknown[]) {
    this.values = values.length > 0 ? values : [{ storage_backup_enabled: true }]
    this.get.mockImplementation(async () => {
      const selected = this.values[Math.min(this.index, this.values.length - 1)]
      this.index += 1
      if (selected instanceof Error) throw selected
      return selected
    })
  }
}

function copyArrayBuffer(value: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value.slice(0)
  const copied = new Uint8Array(value.byteLength)
  copied.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
  return copied.buffer
}

function toBytes(value: ArrayBuffer | ArrayBufferView | string): Uint8Array {
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0))
  const copied = new Uint8Array(value.byteLength)
  copied.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
  return copied
}

async function digest(value: Uint8Array): Promise<ArrayBuffer> {
  const copied = new Uint8Array(value.byteLength)
  copied.set(value)
  return crypto.subtle.digest('SHA-256', copied)
}

class FakeR2 implements BackupR2Bucket {
  readonly objects = new Map<string, FakeStoredObject>()
  readonly headCalls: string[] = []
  readonly putCalls: FakePutCall[] = []
  readonly failPutKeys = new Set<string>()
  readonly conflictPutKeys = new Set<string>()
  readonly corruptHeadKeys = new Set<string>()
  private etagCounter = 0

  async seed(
    key: string,
    body: string,
    customMetadata?: Record<string, string>,
  ): Promise<void> {
    const bytes = new TextEncoder().encode(body)
    this.etagCounter += 1
    this.objects.set(key, {
      body: bytes,
      etag: `etag-${this.etagCounter}`,
      checksum: await digest(bytes),
      customMetadata,
    })
  }

  async head(key: string): Promise<FakeR2Head | null> {
    this.headCalls.push(key)
    const stored = this.objects.get(key)
    if (!stored) return null
    return {
      key,
      size: stored.body.byteLength,
      etag: stored.etag,
      checksums: {
        sha256: this.corruptHeadKeys.has(key)
          ? new Uint8Array(32).fill(7).buffer
          : stored.checksum.slice(0),
      },
      customMetadata: stored.customMetadata ? { ...stored.customMetadata } : undefined,
    }
  }

  async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: {
      onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string }
      customMetadata?: Record<string, string>
      sha256?: ArrayBuffer | ArrayBufferView
    },
  ): Promise<FakeR2Head | null> {
    this.putCalls.push({ key, onlyIf: options?.onlyIf ? { ...options.onlyIf } : undefined })
    if (this.failPutKeys.has(key)) throw new Error('email@example.com token path uuid')
    if (this.conflictPutKeys.has(key)) return null

    const existing = this.objects.get(key)
    if (options?.onlyIf?.etagDoesNotMatch === '*' && existing) return null
    if (options?.onlyIf?.etagMatches && existing?.etag !== options.onlyIf.etagMatches) return null

    const body = toBytes(value)
    const actualDigest = await digest(body)
    if (options?.sha256) {
      expect(new Uint8Array(copyArrayBuffer(options.sha256))).toEqual(new Uint8Array(actualDigest))
    }
    this.etagCounter += 1
    const stored = {
      body,
      etag: `etag-${this.etagCounter}`,
      checksum: actualDigest,
      customMetadata: options?.customMetadata ? { ...options.customMetadata } : undefined,
    }
    this.objects.set(key, stored)
    return this.head(key)
  }

  text(key: string): string {
    const stored = this.objects.get(key)
    if (!stored) throw new Error('missing test object')
    return new TextDecoder().decode(stored.body)
  }
}

class FakeSource {
  pointers: PointerFixture[]
  objects: ObjectFixture[]
  readonly fetchCalls: Array<{ url: string; method: string; headers: Headers }> = []
  readonly downloadAttempts = new Map<string, number>()
  readonly downloadStatuses = new Map<string, number[]>()
  pointerPass = 0
  storagePass = 0
  pointersForPass?: (pass: number, current: PointerFixture[]) => PointerFixture[]
  objectsForPass?: (pass: number, current: ObjectFixture[]) => ObjectFixture[]
  throwOnRequest = false
  hangDownloads = false

  constructor(pointers: PointerFixture[], objects: ObjectFixture[]) {
    this.pointers = structuredClone(pointers)
    this.objects = objects.map((object) => ({ ...object, body: object.body.slice() }))
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
    const method = init?.method ?? 'GET'
    const headers = new Headers(init?.headers)
    this.fetchCalls.push({ url: url.toString(), method, headers })
    if (this.throwOnRequest) {
      throw new Error('private-user@example.invalid /private/path 77777777-7777-4777-8777-777777777777 secret-token')
    }

    expect(url.origin).toBe(STAGING_ORIGIN)
    expect(headers.get('apikey')).toBe(TEST_SECRET)
    expect(headers.get('authorization')).toBe(`Bearer ${TEST_SECRET}`)

    if (url.pathname === '/rest/v1/cabinets') return this.cabinetResponse(url)
    if (url.pathname === '/storage/v1/object/list/cabinets') return this.storageListResponse(init)
    if (url.pathname.startsWith('/storage/v1/object/cabinets/')) {
      return this.downloadResponse(url, init?.signal)
    }
    return new Response(null, { status: 404 })
  }

  private cabinetResponse(url: URL): Response {
    const offset = Number(url.searchParams.get('offset'))
    const limit = Number(url.searchParams.get('limit'))
    if (offset === 0) this.pointerPass += 1
    const rows = this.pointersForPass
      ? this.pointersForPass(this.pointerPass, structuredClone(this.pointers))
      : structuredClone(this.pointers)
    const sorted = rows.sort((left, right) => left.id.localeCompare(right.id, 'en'))
    return Response.json(sorted.slice(offset, offset + limit))
  }

  private async storageListResponse(init?: RequestInit): Promise<Response> {
    const rawBody = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : null
    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return Response.json({ error: 'invalid body' }, { status: 400 })
    }
    const body = rawBody as Record<string, unknown>
    const prefix = typeof body.prefix === 'string' ? body.prefix : ''
    const offset = typeof body.offset === 'number' ? body.offset : 0
    const limit = typeof body.limit === 'number' ? body.limit : 100
    if (prefix === '' && offset === 0) this.storagePass += 1
    const objects = this.objectsForPass
      ? this.objectsForPass(this.storagePass, this.objects.map((object) => ({ ...object, body: object.body.slice() })))
      : this.objects

    const entries = new Map<string, Record<string, unknown>>()
    for (const object of objects) {
      const requiredPrefix = prefix ? `${prefix}/` : ''
      if (!object.path.startsWith(requiredPrefix)) continue
      const remaining = object.path.slice(requiredPrefix.length)
      const slash = remaining.indexOf('/')
      if (slash >= 0) {
        const folder = remaining.slice(0, slash)
        entries.set(folder, {
          name: folder,
          id: null,
          metadata: null,
          updated_at: null,
        })
      } else {
        entries.set(remaining, {
          name: remaining,
          id: object.id,
          updated_at: object.updatedAt,
          metadata: {
            size: object.body.byteLength,
            eTag: object.etag,
          },
        })
      }
    }
    const sorted = [...entries.values()].sort((left, right) => (
      String(left.name).localeCompare(String(right.name), 'en')
    ))
    return Response.json(sorted.slice(offset, offset + limit))
  }

  private async downloadResponse(url: URL, signal?: AbortSignal | null): Promise<Response> {
    const encoded = url.pathname.slice('/storage/v1/object/cabinets/'.length)
    const path = encoded.split('/').map((segment) => decodeURIComponent(segment)).join('/')
    this.downloadAttempts.set(path, (this.downloadAttempts.get(path) ?? 0) + 1)
    if (this.hangDownloads) {
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    }

    const statuses = this.downloadStatuses.get(path)
    const status = statuses?.shift() ?? 200
    if (status !== 200) return new Response(null, { status })
    const object = this.objects.find((candidate) => candidate.path === path)
    if (!object) return new Response(null, { status: 404 })
    return new Response(object.body.slice(), {
      status: 200,
      headers: {
        'content-length': String(object.body.byteLength),
        'content-type': object.contentType ?? 'image/jpeg',
        etag: `"${object.etag}"`,
      },
    })
  }
}

function publicUrl(path: string): string {
  return `${STAGING_ORIGIN}/storage/v1/object/public/cabinets/${path.split('/').map(encodeURIComponent).join('/')}`
}

function pointer(
  id: string,
  path: string,
  owner: 'user' | 'lab' | 'both' | 'none' = 'user',
  mode: 'legacy_url' | 'private_path' = 'legacy_url',
): PointerFixture {
  return {
    id,
    lab_id: owner === 'lab' || owner === 'both' ? LAB_A : null,
    user_id: owner === 'user' || owner === 'both' ? USER_A : null,
    ...(mode === 'legacy_url' ? { image_url: publicUrl(path) } : { image_path: path }),
  }
}

function object(
  id: string,
  path: string,
  text = `image-${path}`,
): ObjectFixture {
  return {
    id,
    path,
    body: new TextEncoder().encode(text),
    etag: `source-${id.slice(0, 8)}`,
    updatedAt: '2026-08-25T11:00:00.000Z',
  }
}

function validFixtures(mode: 'legacy_url' | 'private_path' = 'legacy_url') {
  const objects = [
    object(STORAGE_A, 'root-a.jpg'),
    object(STORAGE_B, 'nested/root-b.jpg'),
    object(STORAGE_C, 'nested/deeper/root-c.jpg'),
  ]
  const pointers = [
    pointer(CABINET_A, objects[0].path, 'user', mode),
    pointer(CABINET_B, objects[1].path, 'lab', mode),
    pointer(CABINET_C, objects[2].path, 'user', mode),
  ]
  return { pointers, objects }
}

function bindings(
  kv: RuntimeConfigKv,
  r2: BackupR2Bucket,
  overrides: Partial<StorageBackupBindings> = {},
): StorageBackupBindings {
  return {
    BURILLAB_RUNTIME_CONFIG: kv,
    CABINET_BACKUPS: r2,
    BACKUP_ENVIRONMENT: 'staging',
    SUPABASE_PROJECT_REF: STAGING_REF,
    SUPABASE_URL: STAGING_ORIGIN,
    SOURCE_POINTER_MODE: 'legacy_url',
    SOURCE_STORAGE_BUCKET: 'cabinets',
    SUPABASE_SERVICE_ROLE_KEY: TEST_SECRET,
    ...overrides,
  }
}

function testOverrides(source: FakeSource, logs: SafeLogEntry[] = []) {
  return {
    fetch: source.fetch,
    now: () => FIXED_NOW,
    randomBytes: (length: number) => new Uint8Array(length).fill(9),
    sleep: async () => undefined,
    log: (entry: SafeLogEntry) => logs.push(entry),
    limits: {
      dbPageSize: 2,
      storagePageSize: 2,
      requestTimeoutMs: 25,
      retryDelayMs: 1,
    },
  }
}

function completeKeys(r2: FakeR2): string[] {
  return [...r2.objects.keys()].filter((key) => key.endsWith('/complete.json'))
}

async function runFixture(
  source: FakeSource,
  options: {
    kv?: FakeKv
    r2?: FakeR2
    bindingOverrides?: Partial<StorageBackupBindings>
    logs?: SafeLogEntry[]
    dependencyOverrides?: Record<string, unknown>
  } = {},
): Promise<{ result: BackupRunResult; kv: FakeKv; r2: FakeR2; logs: SafeLogEntry[] }> {
  const kv = options.kv ?? new FakeKv()
  const r2 = options.r2 ?? new FakeR2()
  const logs = options.logs ?? []
  const overrides = {
    ...testOverrides(source, logs),
    ...options.dependencyOverrides,
  }
  const result = await runScheduledBackup(bindings(kv, r2, options.bindingOverrides), overrides)
  return { result, kv, r2, logs }
}

describe('OFF-first activation and environment isolation', () => {
  it.each([
    ['missing', null],
    ['string true', { storage_backup_enabled: 'true' }],
    ['array', [{ storage_backup_enabled: true }]],
    ['empty object', {}],
    ['KV failure', new Error('private upstream error')],
  ])('keeps source and R2 at zero calls when the flag is %s', async (_label, value) => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    const kv = new FakeKv(value)
    const r2 = new FakeR2()
    const result = await runScheduledBackup(bindings(kv, r2), testOverrides(source))

    expect(result).toMatchObject({ status: 'disabled', code: 'backup_disabled' })
    expect(source.fetchCalls).toHaveLength(0)
    expect(r2.headCalls).toHaveLength(0)
    expect(r2.putCalls).toHaveLength(0)
  })

  it('rejects mixed production and Staging references before any external call', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    const kv = new FakeKv()
    const r2 = new FakeR2()
    const result = await runScheduledBackup(bindings(kv, r2, {
      SUPABASE_URL: 'https://zafxzidbtbryiksemlwc.supabase.co',
    }), testOverrides(source))

    expect(result).toMatchObject({ status: 'failed', code: 'config_invalid' })
    expect(kv.get).not.toHaveBeenCalled()
    expect(source.fetchCalls).toHaveLength(0)
    expect(r2.headCalls).toHaveLength(0)
  })

  it('requires an exact supported pointer mode and secret-shaped service credential', () => {
    const kv = new FakeKv()
    const r2 = new FakeR2()
    expect(() => resolveSourceConfig(bindings(kv, r2, { SOURCE_POINTER_MODE: 'auto' }))).toThrow('config_invalid')
    expect(() => resolveSourceConfig(bindings(kv, r2, { SUPABASE_SERVICE_ROLE_KEY: 'short' }))).toThrow('config_invalid')
  })

  it('accepts only a JSON boolean true', async () => {
    await expect(isStorageBackupEnabled(new FakeKv({ storage_backup_enabled: true }))).resolves.toBe(true)
    await expect(isStorageBackupEnabled(new FakeKv({ storage_backup_enabled: 1 }))).resolves.toBe(false)
  })

  it('pins distinct worker, KV, R2, ref, and cron configuration without secrets', () => {
    const staging = JSON.parse(readFileSync(resolve('workers/storage-backup/wrangler.staging.jsonc'), 'utf8')) as Record<string, unknown>
    const production = JSON.parse(readFileSync(resolve('workers/storage-backup/wrangler.production.jsonc'), 'utf8')) as Record<string, unknown>
    expect(staging.name).toBe('buril-lab-storage-backup-staging')
    expect(production.name).toBe('buril-lab-storage-backup-production')
    expect(staging).not.toHaveProperty('vars.SUPABASE_SERVICE_ROLE_KEY')
    expect(production).not.toHaveProperty('vars.SUPABASE_SERVICE_ROLE_KEY')
    expect(staging).toMatchObject({
      workers_dev: false,
      preview_urls: false,
      kv_namespaces: [{ binding: 'BURILLAB_RUNTIME_CONFIG', id: 'dcaa52254fa6447bbe7c21f54354ad0d' }],
      r2_buckets: [{ binding: 'CABINET_BACKUPS', bucket_name: 'buril-lab-cabinet-backups-staging' }],
      vars: { BACKUP_ENVIRONMENT: 'staging', SUPABASE_PROJECT_REF: STAGING_REF },
    })
    expect(production).toMatchObject({
      workers_dev: false,
      preview_urls: false,
      kv_namespaces: [{ binding: 'BURILLAB_RUNTIME_CONFIG', id: 'dd6866f35f794a91b0fb5a24cbe57cf3' }],
      r2_buckets: [{ binding: 'CABINET_BACKUPS', bucket_name: 'buril-lab-cabinet-backups-production' }],
      vars: { BACKUP_ENVIRONMENT: 'production', SUPABASE_PROJECT_REF: 'zafxzidbtbryiksemlwc' },
    })
    expect(staging.triggers).not.toEqual(production.triggers)
  })

  it('pins the reviewed private R2 retention contract without covering control keys', () => {
    const policy = JSON.parse(readFileSync(resolve('workers/storage-backup/r2-policy.expected.json'), 'utf8')) as Record<string, unknown>
    expect(policy).toEqual({
      schemaVersion: 1,
      buckets: [
        'buril-lab-cabinet-backups-staging',
        'buril-lab-cabinet-backups-production',
      ],
      publicAccess: false,
      customDomain: false,
      publicDevelopmentUrl: false,
      lifecycle: {
        name: 'expire-snapshots-31-days',
        prefix: 'snapshots/',
        deleteAfterDays: 31,
        abortMultipartUploadsAfterDays: 1,
      },
      bucketLock: {
        name: 'retain-snapshots-30-days',
        prefix: 'snapshots/',
        retainForDays: 30,
      },
      controlPrefixExcluded: true,
    })
  })

  it('exports only the scheduled handler and no public fetch path', () => {
    expect(Object.keys(worker)).toEqual(['scheduled'])
    expect(worker).not.toHaveProperty('fetch')
  })
})

describe('strict source pointer parsing', () => {
  it('accepts canonical legacy and private paths without fallback', () => {
    expect(parseLegacyPublicUrl(publicUrl('nested/file name.jpg'), STAGING_ORIGIN)).toBe('nested/file name.jpg')
    expect(parseStrictObjectPath('nested/file%20name.jpg')).toBe('nested/file name.jpg')
    expect(parseSourcePointer('nested/file.jpg', 'private_path', STAGING_ORIGIN)).toBe('nested/file.jpg')
    expect(() => parseSourcePointer(publicUrl('nested/file.jpg'), 'private_path', STAGING_ORIGIN)).toThrow('pointer_invalid')
    expect(() => parseSourcePointer('nested/file.jpg', 'legacy_url', STAGING_ORIGIN)).toThrow('pointer_invalid')
  })

  it.each([
    'https://external.example/storage/v1/object/public/cabinets/file.jpg',
    `https://user@qpgnomuqdcucjmxrunnw.supabase.co/storage/v1/object/public/cabinets/file.jpg`,
    `https://qpgnomuqdcucjmxrunnw.supabase.co:444/storage/v1/object/public/cabinets/file.jpg`,
    `${STAGING_ORIGIN}/storage/v1/object/public/products/file.jpg`,
    `${STAGING_ORIGIN}/storage/v1/object/public/cabinets/../file.jpg`,
    `${STAGING_ORIGIN}/storage/v1/object/public/cabinets/%2e%2e/file.jpg`,
    `${STAGING_ORIGIN}/storage/v1/object/public/cabinets/%252e%252e/file.jpg`,
    `${STAGING_ORIGIN}/storage/v1/object/public/cabinets/%5Cwindows.jpg`,
    `${STAGING_ORIGIN}/storage/v1/object/public/cabinets/folder%2Ffile.jpg`,
    `${STAGING_ORIGIN}/storage/v1/object/public/cabinets/file.jpg?download=1`,
    `${STAGING_ORIGIN}/storage/v1/object/public/cabinets/file.jpg#fragment`,
    `${STAGING_ORIGIN}/storage/v1/object/public/cabinets/%0Afile.jpg`,
    `${STAGING_ORIGIN}/storage/v1/object/public/cabinets/`,
  ])('rejects a legacy URL bypass: %s', (value) => {
    expect(() => parseLegacyPublicUrl(value, STAGING_ORIGIN)).toThrow('pointer_invalid')
  })

  it.each([
    '../file.jpg',
    '%2e%2e/file.jpg',
    '%252e%252e/file.jpg',
    'folder\\file.jpg',
    'folder/%2Ffile.jpg',
    '/leading.jpg',
    'trailing.jpg/',
    'double//slash.jpg',
    'file.jpg?query=1',
    'file.jpg\u0000',
  ])('rejects a private-path bypass: %s', (value) => {
    expect(() => parseStrictObjectPath(value)).toThrow('pointer_invalid')
  })
})

describe('snapshot creation and consistency barriers', () => {
  it('backs up paged nested objects in the required order and writes a non-identifying manifest', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    const { result, r2 } = await runFixture(source)

    expect(result).toMatchObject({
      status: 'completed',
      code: 'backup_completed',
      count: 3,
      bytes: fixtures.objects.reduce((sum, item) => sum + item.body.byteLength, 0),
    })
    expect(source.pointerPass).toBe(2)
    expect(source.storagePass).toBe(3)
    expect(completeKeys(r2)).toHaveLength(1)

    const snapshotPuts = r2.putCalls.map((call) => call.key).filter((key) => key.startsWith('snapshots/'))
    const bodyIndexes = snapshotPuts
      .map((key, index) => key.includes('/objects/') ? index : -1)
      .filter((index) => index >= 0)
    const manifestIndex = snapshotPuts.findIndex((key) => key.endsWith('/manifest.json'))
    const hashIndex = snapshotPuts.findIndex((key) => key.endsWith('/manifest.sha256'))
    const completeIndex = snapshotPuts.findIndex((key) => key.endsWith('/complete.json'))
    expect(Math.max(...bodyIndexes)).toBeLessThan(manifestIndex)
    expect(manifestIndex).toBeLessThan(hashIndex)
    expect(hashIndex).toBeLessThan(completeIndex)
    expect(r2.putCalls.findIndex((call) => call.key === 'control/latest.json')).toBeGreaterThan(
      r2.putCalls.findIndex((call) => call.key.endsWith('/complete.json')),
    )

    const manifestKey = snapshotPuts.find((key) => key.endsWith('/manifest.json'))
    expect(manifestKey).toBeTruthy()
    const manifestText = r2.text(manifestKey as string)
    expect(manifestText).toContain('"environment":"staging"')
    expect(manifestText).toContain('"ownerScope":"lab"')
    expect(manifestText).not.toMatch(/labId|userId|email|reagent|laboratory/i)

    const manifest = JSON.parse(manifestText) as {
      snapshotId: string
      objectCount: number
      totalBytes: number
      objects: Array<{ sourcePath: string; backupKey: string; bytes: number; contentType: string }>
    }
    expect(manifest.snapshotId).toMatch(/^[a-z0-9-]{8,128}$/)
    expect(manifest.objects).toHaveLength(manifest.objectCount)
    expect(manifest.objects.every((item) => (
      item.bytes > 0
      && item.contentType.length > 0
      && item.backupKey === `snapshots/${manifest.snapshotId}/objects/${item.sourcePath}`
    ))).toBe(true)

    const expectedManifestHash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(manifestText))),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('')
    const manifestHashKey = snapshotPuts.find((key) => key.endsWith('/manifest.sha256'))
    expect(r2.text(manifestHashKey as string)).toBe(`${expectedManifestHash}\n`)

    const completeKey = snapshotPuts.find((key) => key.endsWith('/complete.json'))
    const complete = JSON.parse(r2.text(completeKey as string)) as Record<string, unknown>
    expect(complete).toMatchObject({
      snapshotId: manifest.snapshotId,
      manifestKey,
      manifestSha256: expectedManifestHash,
      objectCount: manifest.objectCount,
      totalBytes: manifest.totalBytes,
    })
  })

  it('supports the explicit private_path contract without trying legacy_url', async () => {
    const fixtures = validFixtures('private_path')
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    const { result } = await runFixture(source, {
      bindingOverrides: { SOURCE_POINTER_MODE: 'private_path' },
    })
    expect(result.status).toBe('completed')
    const select = new URL(source.fetchCalls.find((call) => call.url.includes('/rest/v1/cabinets'))?.url ?? '').searchParams.get('select')
    expect(select).toContain('image_path')
    expect(select).not.toContain('image_url')
  })

  it('can reproduce the anonymous 2-object, 3,410,853-byte acceptance shape using synthetic data only', async () => {
    const objects: ObjectFixture[] = [
      {
        ...object(STORAGE_A, 'synthetic/first.jpg'),
        body: new Uint8Array(1_700_000).fill(1),
      },
      {
        ...object(STORAGE_B, 'synthetic/second.jpg'),
        body: new Uint8Array(1_710_853).fill(2),
      },
    ]
    const pointers = [
      pointer(CABINET_A, objects[0].path, 'user'),
      pointer(CABINET_B, objects[1].path, 'lab'),
    ]
    const source = new FakeSource(pointers, objects)
    const { result, r2 } = await runFixture(source)

    expect(result).toMatchObject({ status: 'completed', count: 2, bytes: 3_410_853 })
    const manifestKey = [...r2.objects.keys()].find((key) => key.endsWith('/manifest.json'))
    const manifest = JSON.parse(r2.text(manifestKey as string)) as Record<string, unknown>
    expect(manifest).toMatchObject({ objectCount: 2, totalBytes: 3_410_853 })
    expect(manifest).toHaveProperty('source.storageBucket', 'cabinets')
    expect(source.fetchCalls.every((call) => !call.url.includes('media-products'))).toBe(true)
  })

  it('rejects a Storage snapshot that changes between the first two reads', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    source.objectsForPass = (pass, current) => pass === 2
      ? current.map((item, index) => index === 0 ? { ...item, updatedAt: '2026-08-25T11:01:00.000Z' } : item)
      : current
    const { result, r2 } = await runFixture(source)
    expect(result).toMatchObject({ status: 'failed', code: 'source_drift' })
    expect(completeKeys(r2)).toHaveLength(0)
    expect([...r2.objects.keys()].some((key) => key.includes('/objects/'))).toBe(false)
  })

  it('rejects pointer drift after bodies and manifests without creating complete.json', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    source.pointersForPass = (pass, current) => pass === 2
      ? current.map((item, index) => index === 0 ? { ...item, user_id: null, lab_id: LAB_A } : item)
      : current
    const { result, r2 } = await runFixture(source)
    expect(result).toMatchObject({ status: 'failed', code: 'source_drift' })
    expect([...r2.objects.keys()].some((key) => key.endsWith('/manifest.json'))).toBe(true)
    expect(completeKeys(r2)).toHaveLength(0)
    expect(r2.objects.has('control/latest.json')).toBe(false)
  })

  it('rejects final Storage drift after object copies', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    source.objectsForPass = (pass, current) => pass === 3
      ? current.map((item, index) => index === 1 ? { ...item, etag: 'changed-etag' } : item)
      : current
    const { result, r2 } = await runFixture(source)
    expect(result.code).toBe('source_drift')
    expect(completeKeys(r2)).toHaveLength(0)
  })

  it.each([
    ['duplicate pointer', 'pointer_duplicate', (pointers: PointerFixture[], objects: ObjectFixture[]) => ({
      pointers: [...pointers, pointer('77777777-7777-4777-8777-777777777777', objects[0].path)],
      objects,
    })],
    ['missing object', 'pointer_missing_object', (pointers: PointerFixture[], objects: ObjectFixture[]) => ({
      pointers,
      objects: objects.slice(1),
    })],
    ['orphan object', 'source_orphan_object', (pointers: PointerFixture[], objects: ObjectFixture[]) => ({
      pointers: pointers.slice(1),
      objects,
    })],
    ['both owner scopes', 'ownership_ambiguous', (pointers: PointerFixture[], objects: ObjectFixture[]) => ({
      pointers: pointers.map((item, index) => index === 0 ? pointer(item.id, objects[0].path, 'both') : item),
      objects,
    })],
    ['no owner scope', 'ownership_ambiguous', (pointers: PointerFixture[], objects: ObjectFixture[]) => ({
      pointers: pointers.map((item, index) => index === 0 ? pointer(item.id, objects[0].path, 'none') : item),
      objects,
    })],
  ] as const)('fails closed for %s', async (_label, expectedCode, mutate) => {
    const fixtures = validFixtures()
    const changed = mutate(fixtures.pointers, fixtures.objects)
    const source = new FakeSource(changed.pointers, changed.objects)
    const { result, r2 } = await runFixture(source)
    expect(result.code).toBe(expectedCode)
    expect(completeKeys(r2)).toHaveLength(0)
  })

  it('rejects an empty bucket as a backup, not as a successful snapshot', async () => {
    const source = new FakeSource([], [])
    const { result, r2 } = await runFixture(source)
    expect(result).toMatchObject({ status: 'failed', code: 'empty_source' })
    expect(completeKeys(r2)).toHaveLength(0)
  })

  it('rechecks the flag immediately before complete.json', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    const kv = new FakeKv(
      { storage_backup_enabled: true },
      { storage_backup_enabled: false },
    )
    const { result, r2 } = await runFixture(source, { kv })
    expect(result.code).toBe('flag_disabled_before_complete')
    expect(completeKeys(r2)).toHaveLength(0)
    expect(r2.objects.has('control/latest.json')).toBe(false)
  })
})

describe('network, R2, checksum, and lock failures', () => {
  it('retries bounded 429 and 5xx downloads and then completes', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    source.downloadStatuses.set(fixtures.objects[0].path, [429, 503, 200])
    const { result } = await runFixture(source)
    expect(result.status).toBe('completed')
    expect(source.downloadAttempts.get(fixtures.objects[0].path)).toBe(3)
  })

  it('fails after the retry ceiling on 5xx', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    source.downloadStatuses.set(fixtures.objects[0].path, [503, 503, 503])
    const { result, r2 } = await runFixture(source)
    expect(result.code).toBe('source_retry_exhausted')
    expect(source.downloadAttempts.get(fixtures.objects[0].path)).toBe(3)
    expect(completeKeys(r2)).toHaveLength(0)
  })

  it('aborts timed-out downloads and never completes', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    source.hangDownloads = true
    const { result, r2 } = await runFixture(source, {
      dependencyOverrides: {
        limits: {
          dbPageSize: 2,
          storagePageSize: 2,
          requestTimeoutMs: 5,
          retryCount: 1,
          retryDelayMs: 1,
        },
      },
    })
    expect(result.code).toBe('source_timeout')
    expect([...source.downloadAttempts.values()].reduce((sum, value) => sum + value, 0)).toBe(2)
    expect(completeKeys(r2)).toHaveLength(0)
  })

  it('rejects a source object over the configured maximum before download', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    const { result, r2 } = await runFixture(source, {
      dependencyOverrides: {
        limits: {
          dbPageSize: 2,
          storagePageSize: 2,
          maxObjectBytes: 4,
          requestTimeoutMs: 25,
          retryDelayMs: 1,
        },
      },
    })
    expect(result.code).toBe('object_too_large')
    expect(source.downloadAttempts.size).toBe(0)
    expect(completeKeys(r2)).toHaveLength(0)
  })

  it('does not create complete.json after an R2 write failure', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    const r2 = new FakeR2()
    r2.failPutKeys.add(expectSnapshotObjectKey(fixtures.objects[0].path))
    const { result } = await runFixture(source, { r2 })
    expect(result.code).toBe('r2_write_failed')
    expect(completeKeys(r2)).toHaveLength(0)
  })

  it('does not create complete.json when R2 head returns a bad checksum', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    const r2 = new FakeR2()
    r2.corruptHeadKeys.add(expectSnapshotObjectKey(fixtures.objects[0].path))
    const { result } = await runFixture(source, { r2 })
    expect(result.code).toBe('r2_checksum_failed')
    expect(completeKeys(r2)).toHaveLength(0)
  })

  it('skips an active conditional lock without touching Supabase', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    const r2 = new FakeR2()
    await r2.seed('control/active-lock.json', '{}', {
      'lock-state': 'active',
      'lock-token': 'existing-token',
      'expires-at': '2026-08-25T12:30:00.000Z',
    })
    const { result } = await runFixture(source, { r2 })
    expect(result).toMatchObject({ status: 'skipped', code: 'backup_locked' })
    expect(source.fetchCalls).toHaveLength(0)
  })

  it('replaces an expired lock only with an etag condition', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    const r2 = new FakeR2()
    await r2.seed('control/active-lock.json', '{}', {
      'lock-state': 'released',
      'expires-at': '2026-08-25T11:00:00.000Z',
    })
    const oldEtag = (await r2.head('control/active-lock.json'))?.etag
    const { result } = await runFixture(source, { r2 })
    expect(result.status).toBe('completed')
    const acquire = r2.putCalls.find((call) => call.key === 'control/active-lock.json')
    expect(acquire?.onlyIf).toEqual({ etagMatches: oldEtag })
  })

  it('fails closed for a malformed lock and a conditional acquisition race', async () => {
    const fixtures = validFixtures()
    const malformedSource = new FakeSource(fixtures.pointers, fixtures.objects)
    const malformedR2 = new FakeR2()
    await malformedR2.seed('control/active-lock.json', '{}', { 'lock-state': 'active' })
    const malformed = await runFixture(malformedSource, { r2: malformedR2 })
    expect(malformed.result.code).toBe('lock_invalid')
    expect(malformedSource.fetchCalls).toHaveLength(0)

    const raceSource = new FakeSource(fixtures.pointers, fixtures.objects)
    const raceR2 = new FakeR2()
    raceR2.conflictPutKeys.add('control/active-lock.json')
    const race = await runFixture(raceSource, { r2: raceR2 })
    expect(race.result).toMatchObject({ status: 'skipped', code: 'backup_locked' })
    expect(raceSource.fetchCalls).toHaveLength(0)
  })
})

describe('safe logging', () => {
  it('logs only approved aggregate fields and never the raw source error', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    source.throwOnRequest = true
    const logs: SafeLogEntry[] = []
    const { result } = await runFixture(source, { logs })

    expect(result.code).toBe('source_request_failed')
    expect(logs).toHaveLength(1)
    expect(Object.keys(logs[0]).sort()).toEqual(['bytes', 'code', 'count', 'durationMs'])
    const serialized = JSON.stringify(logs)
    expect(serialized).not.toContain('private-user@example.invalid')
    expect(serialized).not.toContain('/private/path')
    expect(serialized).not.toContain('77777777-7777-4777-8777-777777777777')
    expect(serialized).not.toContain('secret-token')
    expect(serialized).not.toContain(TEST_SECRET)
  })
})

function expectSnapshotObjectKey(path: string): string {
  const timestamp = new Date(FIXED_NOW).toISOString().replace(/[-:.]/g, '').toLowerCase()
  const suffix = new Uint8Array(12).fill(9)
  const token = Array.from(suffix, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `snapshots/${timestamp}-${token}/objects/${path}`
}
