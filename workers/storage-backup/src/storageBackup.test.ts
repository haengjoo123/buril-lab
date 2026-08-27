import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import worker from './index'
import * as workerEntrypoint from './index'
import { runStorageBackupSchedule } from './scheduled'
import {
  calculateWorstCaseSubrequests,
  isStorageBackupEnabled,
  parseLegacyPublicUrl,
  parseSourcePointer,
  parseStrictObjectPath,
  resolveSourceConfig,
  runScheduledBackup,
  STORAGE_BACKUP_LIMITS,
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

function base64UrlJson(value: Record<string, unknown>): string {
  return btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function testLegacyJwt(role = 'service_role', ref = STAGING_REF): string {
  return [
    base64UrlJson({ alg: 'HS256', typ: 'JWT' }),
    base64UrlJson({ iss: 'supabase', ref, role, iat: 1, exp: 4_102_444_800 }),
    'unit-test-signature-never-used-remotely',
  ].join('.')
}

const TEST_SECRET = testLegacyJwt()
const TEST_NEW_SECRET = 'sb_secret_storageBackupUnitTestCredential_1234567890'
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
  readonly fetchCalls: Array<{
    url: string
    method: string
    headers: Headers
    redirect: RequestRedirect | undefined
  }> = []
  readonly downloadAttempts = new Map<string, number>()
  readonly downloadStatuses = new Map<string, number[]>()
  readonly downloadEtagOverrides = new Map<string, string | null>()
  pointerPass = 0
  storagePass = 0
  pointersForPass?: (pass: number, current: PointerFixture[]) => PointerFixture[]
  objectsForPass?: (pass: number, current: ObjectFixture[]) => ObjectFixture[]
  throwOnRequest = false
  hangDownloads = false
  expectedApiKey = TEST_SECRET
  expectedAuthorization: string | null = `Bearer ${TEST_SECRET}`

  constructor(pointers: PointerFixture[], objects: ObjectFixture[]) {
    this.pointers = structuredClone(pointers)
    this.objects = objects.map((object) => ({ ...object, body: object.body.slice() }))
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
    const method = init?.method ?? 'GET'
    const headers = new Headers(init?.headers)
    this.fetchCalls.push({ url: url.toString(), method, headers, redirect: init?.redirect })
    expect(init?.redirect).toBe('error')
    if (this.throwOnRequest) {
      throw new Error('private-user@example.invalid /private/path 77777777-7777-4777-8777-777777777777 secret-token')
    }

    expect(url.origin).toBe(STAGING_ORIGIN)
    expect(headers.get('apikey')).toBe(this.expectedApiKey)
    expect(headers.get('authorization')).toBe(this.expectedAuthorization)

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
    const headers = new Headers({
      'content-length': String(object.body.byteLength),
      'content-type': object.contentType ?? 'image/jpeg',
    })
    const responseEtag = this.downloadEtagOverrides.has(path)
      ? this.downloadEtagOverrides.get(path)
      : `"${object.etag}"`
    if (responseEtag !== null && responseEtag !== undefined) headers.set('etag', responseEtag)
    return new Response(object.body.slice(), {
      status: 200,
      headers,
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
    WORKERS_SUBREQUEST_LIMIT: '700',
    WORKERS_USAGE_PLAN: 'paid',
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
  it('invokes the native fetch binding without the dependency object as its receiver', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    const nativeLikeFetch = vi.fn(function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      if (this !== undefined) throw new TypeError('Illegal invocation')
      return source.fetch(input, init)
    })
    vi.stubGlobal('fetch', nativeLikeFetch)

    try {
      const result = await runScheduledBackup(bindings(new FakeKv(), new FakeR2()), {
        now: () => FIXED_NOW,
        randomBytes: (length: number) => new Uint8Array(length).fill(9),
        sleep: async () => undefined,
        log: () => undefined,
        limits: {
          dbPageSize: 2,
          storagePageSize: 2,
          requestTimeoutMs: 25,
          retryDelayMs: 1,
        },
      })

      expect(result.status).toBe('completed')
      expect(nativeLikeFetch).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

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

  it('requires an exact supported pointer mode and recognized backend credential', () => {
    const kv = new FakeKv()
    const r2 = new FakeR2()
    expect(() => resolveSourceConfig(bindings(kv, r2, { SOURCE_POINTER_MODE: 'auto' }))).toThrow('config_invalid')
    expect(() => resolveSourceConfig(bindings(kv, r2, { SUPABASE_SERVICE_ROLE_KEY: 'short' }))).toThrow('config_invalid')
  })

  it('uses apikey only for a new Supabase secret key', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    source.expectedApiKey = TEST_NEW_SECRET
    source.expectedAuthorization = null

    const { result } = await runFixture(source, {
      bindingOverrides: { SUPABASE_SERVICE_ROLE_KEY: TEST_NEW_SECRET },
    })

    expect(result.status).toBe('completed')
    expect(source.fetchCalls.length).toBeGreaterThan(0)
    expect(source.fetchCalls.every((call) => call.headers.get('apikey') === TEST_NEW_SECRET)).toBe(true)
    expect(source.fetchCalls.every((call) => call.headers.get('authorization') === null)).toBe(true)
  })

  it.each([
    ['publishable key', 'sb_publishable_storageBackupUnitTestCredential_1234567890'],
    ['anon JWT', testLegacyJwt('anon')],
    ['other-project service JWT', testLegacyJwt('service_role', 'abcdefghijklmnopqrst')],
    ['arbitrary secret-shaped string', 'arbitrary-backend-secret-value-that-is-not-a-supported-key'],
    ['malformed JWT', 'eyJhbGciOiJIUzI1NiJ9.invalid.unit-test-signature-never-used-remotely'],
  ])('rejects a %s before KV, Supabase, or R2 calls', async (_label, credential) => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    const kv = new FakeKv()
    const r2 = new FakeR2()

    const result = await runScheduledBackup(bindings(kv, r2, {
      SUPABASE_SERVICE_ROLE_KEY: credential,
    }), testOverrides(source))

    expect(result).toMatchObject({ status: 'failed', code: 'config_invalid' })
    expect(kv.get).not.toHaveBeenCalled()
    expect(source.fetchCalls).toHaveLength(0)
    expect(r2.headCalls).toHaveLength(0)
    expect(r2.putCalls).toHaveLength(0)
  })

  it('accepts only a JSON boolean true', async () => {
    await expect(isStorageBackupEnabled(new FakeKv({ storage_backup_enabled: true }))).resolves.toBe(true)
    await expect(isStorageBackupEnabled(new FakeKv({ storage_backup_enabled: 1 }))).resolves.toBe(false)
  })

  it('refuses an enabled run on the committed Free OFF-only execution profile', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    const kv = new FakeKv({ storage_backup_enabled: true })
    const r2 = new FakeR2()
    const result = await runScheduledBackup(bindings(kv, r2, {
      WORKERS_SUBREQUEST_LIMIT: '50',
      WORKERS_USAGE_PLAN: 'free_off_only',
    }), testOverrides(source))

    expect(result).toMatchObject({ status: 'failed', code: 'workers_paid_plan_required' })
    expect(kv.get).toHaveBeenCalledTimes(1)
    expect(source.fetchCalls).toHaveLength(0)
    expect(r2.headCalls).toHaveLength(0)
    expect(r2.putCalls).toHaveLength(0)
  })

  it('rejects unsupported plan claims and mismatched declared subrequest limits', () => {
    const kv = new FakeKv()
    const r2 = new FakeR2()
    expect(() => resolveSourceConfig(bindings(kv, r2, {
      WORKERS_USAGE_PLAN: 'standard',
    }))).toThrow('config_invalid')
    expect(() => resolveSourceConfig(bindings(kv, r2, {
      WORKERS_SUBREQUEST_LIMIT: '699',
    }))).toThrow('config_invalid')
    expect(() => resolveSourceConfig(bindings(kv, r2, {
      WORKERS_SUBREQUEST_LIMIT: '700',
      WORKERS_USAGE_PLAN: 'free_off_only',
    }))).toThrow('config_invalid')
  })

  it('blocks Supabase redirects before credentials can reach another origin', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    const externalCalls: Array<{ url: string; headers: Headers }> = []
    const redirectingFetch: typeof fetch = async function redirectingFetch(input, init) {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
      if (url.origin === STAGING_ORIGIN) {
        if (init?.redirect === 'error') throw new TypeError('redirect blocked')
        return redirectingFetch('https://credential-sink.invalid/collect', init)
      }
      externalCalls.push({ url: url.toString(), headers: new Headers(init?.headers) })
      return Response.json([])
    }

    const result = await runScheduledBackup(bindings(new FakeKv(), new FakeR2()), {
      ...testOverrides(source),
      fetch: redirectingFetch,
    })

    expect(result).toMatchObject({ status: 'failed', code: 'source_request_failed' })
    expect(externalCalls).toHaveLength(0)
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
      vars: {
        BACKUP_ENVIRONMENT: 'staging',
        SUPABASE_PROJECT_REF: STAGING_REF,
        WORKERS_SUBREQUEST_LIMIT: '700',
        WORKERS_USAGE_PLAN: 'paid',
      },
    })
    expect(production).toMatchObject({
      workers_dev: false,
      preview_urls: false,
      kv_namespaces: [{ binding: 'BURILLAB_RUNTIME_CONFIG', id: 'dd6866f35f794a91b0fb5a24cbe57cf3' }],
      r2_buckets: [{ binding: 'CABINET_BACKUPS', bucket_name: 'buril-lab-cabinet-backups-production' }],
      vars: {
        BACKUP_ENVIRONMENT: 'production',
        SUPABASE_PROJECT_REF: 'zafxzidbtbryiksemlwc',
        WORKERS_SUBREQUEST_LIMIT: '700',
        WORKERS_USAGE_PLAN: 'paid',
      },
    })
    expect(staging).toMatchObject({ limits: { subrequests: 700 } })
    expect(production).toMatchObject({ limits: { subrequests: 700 } })
    expect(staging.triggers).not.toEqual(production.triggers)
  })

  it('keeps the supported paid-plan ceiling above the exact static worst case', () => {
    const worstCase = calculateWorstCaseSubrequests({ ...STORAGE_BACKUP_LIMITS })

    expect(STORAGE_BACKUP_LIMITS.maxPointers).toBe(50)
    expect(STORAGE_BACKUP_LIMITS.maxStorageObjects).toBe(50)
    expect(worstCase).toBe(625)
    expect(worstCase).toBeLessThan(STORAGE_BACKUP_LIMITS.maxSubrequests)
    expect(() => resolveSourceConfig(
      bindings(new FakeKv(), new FakeR2()),
      { ...STORAGE_BACKUP_LIMITS, maxSubrequests: worstCase - 1 },
    )).toThrow('config_invalid')
  })

  it('stops before any subrequest at the exact 15-minute invocation boundary', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    const kv = new FakeKv()
    const r2 = new FakeR2()
    let clockReads = 0
    const result = await runScheduledBackup(bindings(kv, r2), {
      ...testOverrides(source),
      now: () => {
        clockReads += 1
        return clockReads === 1 ? FIXED_NOW : FIXED_NOW + (15 * 60_000)
      },
      limits: {
        dbPageSize: 2,
        storagePageSize: 2,
        maxRunDurationMs: 15 * 60_000,
      },
    })

    expect(result).toMatchObject({ status: 'failed', code: 'execution_deadline_exceeded' })
    expect(kv.get).not.toHaveBeenCalled()
    expect(source.fetchCalls).toHaveLength(0)
    expect(r2.headCalls).toHaveLength(0)
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
      requiredUserPolicies: {
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
      },
      allowedCloudflareManagedRules: [{
        name: 'Default Multipart Abort Rule',
        prefix: '',
        abortMultipartUploadsAfterDays: 7,
        multipartOnly: true,
      }],
      controlPrefixExcludedFromUserPolicies: true,
      rejectOtherRules: true,
    })
  })

  it('exports only the scheduled handler and no public fetch path', () => {
    expect(Object.keys(workerEntrypoint)).toEqual(['default'])
    expect(Object.keys(worker)).toEqual(['scheduled'])
    expect(worker).not.toHaveProperty('fetch')
  })

  it.each([
    ['disabled', 'backup_disabled'],
    ['skipped', 'backup_locked'],
    ['completed', 'backup_completed'],
  ] as const)('resolves a %s scheduled result normally', async (status, code) => {
    await expect(runStorageBackupSchedule({}, async () => ({
      status,
      code,
      count: 0,
      bytes: 0,
      durationMs: 0,
      orphanCount: 0,
    }))).resolves.toBeUndefined()
  })

  it('throws only a safe code when a scheduled backup returns failed', async () => {
    await expect(runStorageBackupSchedule({}, async () => ({
      status: 'failed',
      code: 'source_request_failed',
      count: 0,
      bytes: 0,
      durationMs: 0,
      orphanCount: 0,
    }))).rejects.toThrow(/^storage_backup_failed:source_request_failed$/)
  })

  it('replaces an unexpected scheduled rejection with a non-identifying code', async () => {
    await expect(runStorageBackupSchedule({}, async () => {
      throw new Error('private-user@example.invalid /private/path secret-token')
    })).rejects.toThrow(/^storage_backup_failed:unexpected_failure$/)
  })

  it('makes the actual scheduled entrypoint reject when configuration fails', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      await expect(worker.scheduled(
        {} as ScheduledController,
        {} as Env,
      )).rejects.toThrow(/^storage_backup_failed:config_invalid$/)
    } finally {
      log.mockRestore()
    }
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

describe('cabinet pointer query contract', () => {
  it('skips only an exact empty image_url as a cabinet with no photo', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource([
      ...fixtures.pointers,
      {
        id: '77777777-7777-4777-8777-777777777777',
        lab_id: LAB_A,
        user_id: USER_A,
        image_url: '',
      },
    ], fixtures.objects)
    const { result } = await runFixture(source)

    expect(result).toMatchObject({
      status: 'completed',
      code: 'backup_completed',
      count: fixtures.objects.length,
      orphanCount: 0,
    })
    const query = new URL(source.fetchCalls.find((call) => call.url.includes('/rest/v1/cabinets'))?.url ?? '')
    expect(query.searchParams.get('image_url')).toBe('not.is.null')
    expect(query.searchParams.get('select')).toBe('id,lab_id,user_id,image_url')
  })

  it.each([
    ['whitespace', '   ', 'pointer_invalid'],
    ['non-string raw value', null, 'source_contract_invalid'],
  ] as const)('fails closed for a %s image_url returned by the Data API', async (_label, value, code) => {
    const fixtures = validFixtures()
    const changed = fixtures.pointers.map((item, index) => (
      index === 0 ? { ...item, image_url: value as unknown as string } : item
    ))
    const { result, r2 } = await runFixture(new FakeSource(changed, fixtures.objects))

    expect(result.code).toBe(code)
    expect(completeKeys(r2)).toHaveLength(0)
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
    ['duplicate Storage UUID', 'source_drift', (pointers: PointerFixture[], objects: ObjectFixture[]) => ({
      pointers,
      objects: objects.map((item, index) => index === 1 ? { ...item, id: objects[0].id } : item),
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

  it('uses lab ownership when the cabinet model contains both lab_id and user_id', async () => {
    const fixtures = validFixtures()
    const pointers = fixtures.pointers.map((item, index) => (
      index === 0 ? pointer(item.id, fixtures.objects[0].path, 'both') : item
    ))
    const source = new FakeSource(pointers, fixtures.objects)
    const { result, r2 } = await runFixture(source)

    expect(result.status).toBe('completed')
    const manifestKey = [...r2.objects.keys()].find((key) => key.endsWith('/manifest.json'))
    const manifest = JSON.parse(r2.text(manifestKey as string)) as {
      objects: Array<{ sourcePath: string; ownerScope: string }>
    }
    expect(manifest.objects.find((item) => item.sourcePath === fixtures.objects[0].path)).toMatchObject({
      ownerScope: 'lab',
    })
  })

  it('quarantines an unreferenced Storage object without owner identifiers', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers.slice(1), fixtures.objects)
    const logs: SafeLogEntry[] = []
    const { result, r2 } = await runFixture(source, { logs })

    expect(result).toMatchObject({
      status: 'completed',
      code: 'backup_completed_with_quarantine',
      count: 3,
      orphanCount: 1,
    })
    expect(logs).toHaveLength(1)
    expect(logs[0].orphanCount).toBe(1)

    const manifestKey = [...r2.objects.keys()].find((key) => key.endsWith('/manifest.json'))
    const manifestText = r2.text(manifestKey as string)
    const manifest = JSON.parse(manifestText) as {
      referencedObjectCount: number
      orphanCount: number
      objects: Array<Record<string, unknown>>
    }
    expect(manifest).toMatchObject({ referencedObjectCount: 2, orphanCount: 1 })
    const orphan = manifest.objects.find((item) => item.classification === 'unreferenced')
    expect(orphan).toMatchObject({
      sourcePath: fixtures.objects[0].path,
      classification: 'unreferenced',
    })
    expect(orphan).not.toHaveProperty('ownerScope')
    expect(String(orphan?.backupKey)).toContain('/quarantine/unreferenced/')
    expect(manifestText).not.toMatch(/labId|userId|email|reagent|laboratory/i)

    const completeKey = [...r2.objects.keys()].find((key) => key.endsWith('/complete.json'))
    expect(JSON.parse(r2.text(completeKey as string))).toMatchObject({
      referencedObjectCount: 2,
      orphanCount: 1,
    })
  })

  it('can preserve an orphan-only bucket after all cabinet photos are cleared', async () => {
    const fixtures = validFixtures()
    const { result } = await runFixture(new FakeSource([], fixtures.objects))

    expect(result).toMatchObject({
      status: 'completed',
      code: 'backup_completed_with_quarantine',
      count: 3,
      orphanCount: 3,
    })
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
      { storage_backup_enabled: true },
      { storage_backup_enabled: true },
      { storage_backup_enabled: true },
      { storage_backup_enabled: true },
      { storage_backup_enabled: true },
      { storage_backup_enabled: false },
    )
    const { result, r2 } = await runFixture(source, { kv })
    expect(result.code).toBe('flag_disabled_before_complete')
    expect(completeKeys(r2)).toHaveLength(0)
    expect(r2.objects.has('control/latest.json')).toBe(false)
  })

  it('stops before the next object write when the runtime flag turns OFF', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    const kv = new FakeKv(
      { storage_backup_enabled: true },
      { storage_backup_enabled: true },
      { storage_backup_enabled: false },
    )
    const { result, r2 } = await runFixture(source, { kv })

    expect(result.code).toBe('flag_disabled_before_complete')
    const copiedBodies = [...r2.objects.keys()].filter((key) => key.includes('/objects/'))
    const firstPath = [...fixtures.objects]
      .sort((left, right) => left.path.localeCompare(right.path, 'en'))[0].path
    expect(copiedBodies).toEqual([expectSnapshotObjectKey(firstPath)])
    expect([...r2.objects.keys()].some((key) => key.endsWith('/manifest.json'))).toBe(false)
    expect(completeKeys(r2)).toHaveLength(0)
  })
})

describe('network, R2, checksum, and lock failures', () => {
  it('uses the reserved cleanup path to release a lock after the run deadline', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    const r2 = new FakeR2()
    const { result } = await runFixture(source, {
      r2,
      dependencyOverrides: {
        now: () => r2.objects.get('control/active-lock.json')?.customMetadata?.['lock-state'] === 'active'
          && r2.headCalls.length >= 3
          ? FIXED_NOW + STORAGE_BACKUP_LIMITS.maxRunDurationMs
          : FIXED_NOW,
      },
    })

    expect(result).toMatchObject({ status: 'failed', code: 'execution_deadline_exceeded' })
    expect(source.fetchCalls).toHaveLength(0)
    expect(r2.objects.get('control/active-lock.json')?.customMetadata?.['lock-state']).toBe('released')
    expect(r2.putCalls.filter((call) => call.key === 'control/active-lock.json')).toHaveLength(2)
    expect(completeKeys(r2)).toHaveLength(0)
  })

  it('rejects a missing or invalid ETag in the Storage listing contract', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    source.objects[0] = { ...source.objects[0], etag: 'invalid etag' }
    const { result, r2 } = await runFixture(source)

    expect(result.code).toBe('source_contract_invalid')
    expect(source.downloadAttempts.size).toBe(0)
    expect(completeKeys(r2)).toHaveLength(0)
  })

  it.each([
    ['missing', null, 'object_download_invalid'],
    ['invalid', 'invalid etag', 'object_download_invalid'],
    ['different', 'different-valid-etag', 'source_drift'],
  ] as const)('requires an exact %s download ETag', async (_label, etag, expectedCode) => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    source.downloadEtagOverrides.set(fixtures.objects[0].path, etag)
    const { result, r2 } = await runFixture(source)

    expect(result.code).toBe(expectedCode)
    expect(completeKeys(r2)).toHaveLength(0)
  })

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
      'lock-token': 'a'.repeat(32),
      'acquired-at': '2026-08-25T11:59:00.000Z',
      'expires-at': '2026-08-25T12:29:00.000Z',
    })
    const { result } = await runFixture(source, { r2 })
    expect(result).toMatchObject({ status: 'skipped', code: 'backup_locked' })
    expect(source.fetchCalls).toHaveLength(0)
  })

  it('emits a distinct safe code for a repeatedly long-running active lock', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    const r2 = new FakeR2()
    await r2.seed('control/active-lock.json', '{}', {
      'lock-state': 'active',
      'lock-token': 'b'.repeat(32),
      'acquired-at': '2026-08-25T11:40:00.000Z',
      'expires-at': '2026-08-25T12:10:00.000Z',
    })
    const { result, logs } = await runFixture(source, { r2 })

    expect(result).toMatchObject({ status: 'skipped', code: 'backup_locked_extended' })
    expect(logs[0]).toMatchObject({ code: 'backup_locked_extended' })
    expect(source.fetchCalls).toHaveLength(0)
  })

  it('replaces an expired lock only with an etag condition', async () => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    const r2 = new FakeR2()
    await r2.seed('control/active-lock.json', '{}', {
      'lock-state': 'released',
      'lock-token': 'c'.repeat(32),
      'acquired-at': '2026-08-25T10:45:00.000Z',
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

  it.each([
    ['future acquisition', {
      'lock-state': 'active',
      'lock-token': 'd'.repeat(32),
      'acquired-at': '2026-08-25T13:00:00.000Z',
      'expires-at': '2026-08-25T13:30:00.000Z',
    }],
    ['excessive TTL', {
      'lock-state': 'active',
      'lock-token': 'e'.repeat(32),
      'acquired-at': '2026-08-25T11:59:00.000Z',
      'expires-at': '2026-08-25T12:40:00.000Z',
    }],
    ['invalid token', {
      'lock-state': 'active',
      'lock-token': 'not-a-token',
      'acquired-at': '2026-08-25T11:59:00.000Z',
      'expires-at': '2026-08-25T12:29:00.000Z',
    }],
    ['invalid state', {
      'lock-state': 'unknown',
      'lock-token': 'f'.repeat(32),
      'acquired-at': '2026-08-25T11:59:00.000Z',
      'expires-at': '2026-08-25T12:29:00.000Z',
    }],
  ] as const)('fails instead of skipping a malformed %s lock', async (_label, metadata) => {
    const fixtures = validFixtures()
    const source = new FakeSource(fixtures.pointers, fixtures.objects)
    const r2 = new FakeR2()
    await r2.seed('control/active-lock.json', '{}', { ...metadata })
    const { result } = await runFixture(source, { r2 })

    expect(result).toMatchObject({ status: 'failed', code: 'lock_invalid' })
    expect(source.fetchCalls).toHaveLength(0)
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
    expect(Object.keys(logs[0]).sort()).toEqual([
      'bytes',
      'code',
      'count',
      'durationMs',
      'orphanCount',
    ])
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
