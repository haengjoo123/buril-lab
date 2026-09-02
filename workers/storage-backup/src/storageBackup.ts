const RUNTIME_CONFIG_KEY = 'runtime_config'
const SOURCE_BUCKET = 'cabinets'
const LOCK_KEY = 'control/active-lock.json'
const LATEST_KEY = 'control/latest.json'
const CONTENT_GC_STATE_KEY = 'control/content-gc-state.json'
const SNAPSHOT_PREFIX = 'snapshots/'
const CONTENT_PREFIX = 'objects/sha256/'
const SNAPSHOT_SCHEMA_VERSION = 2
const LEGACY_SNAPSHOT_SCHEMA_VERSION = 1
const CONTENT_GC_SCHEMA_VERSION = 1
const CLEANUP_SUBREQUEST_RESERVE = 2
const FREE_PLATFORM_SUBREQUEST_LIMIT = 50
const MAX_SOURCE_REDIRECTS_PER_ATTEMPT = 1
const DAY_MS = 24 * 60 * 60_000

const ENVIRONMENT_CONTRACT = Object.freeze({
  staging: Object.freeze({
    projectRef: 'qpgnomuqdcucjmxrunnw',
    origin: 'https://qpgnomuqdcucjmxrunnw.supabase.co',
  }),
  production: Object.freeze({
    projectRef: 'zafxzidbtbryiksemlwc',
    origin: 'https://zafxzidbtbryiksemlwc.supabase.co',
  }),
})

export type BackupEnvironmentName = keyof typeof ENVIRONMENT_CONTRACT
export type SourcePointerMode = 'legacy_url' | 'private_path'
export type WorkersUsagePlan = 'free_off_only' | 'paid'
type SupabaseBackendCredentialKind = 'legacy_service_role' | 'secret_key'

export type BackupCode =
  | 'backup_completed'
  | 'backup_completed_with_quarantine'
  | 'backup_disabled'
  | 'backup_locked'
  | 'backup_locked_extended'
  | 'config_invalid'
  | 'content_gc_delete_failed'
  | 'empty_source'
  | 'execution_deadline_exceeded'
  | 'flag_disabled_before_complete'
  | 'lock_acquire_failed'
  | 'lock_invalid'
  | 'lock_lost'
  | 'lock_release_failed'
  | 'object_download_invalid'
  | 'object_too_large'
  | 'ownership_ambiguous'
  | 'pointer_duplicate'
  | 'pointer_invalid'
  | 'pointer_missing_object'
  | 'r2_checksum_failed'
  | 'r2_lock_conflict'
  | 'r2_verify_failed'
  | 'r2_write_failed'
  | 'source_contract_invalid'
  | 'source_drift'
  | 'source_http_rejected'
  | 'source_limit_exceeded'
  | 'source_request_failed'
  | 'source_retry_exhausted'
  | 'source_timeout'
  | 'subrequest_budget_exceeded'
  | 'unexpected_failure'
  | 'workers_paid_plan_required'

export type FetchDiagnosticCode =
  | 'abort_error'
  | 'dns_error'
  | 'fetch_type_error'
  | 'illegal_invocation'
  | 'invalid_request'
  | 'network_error'
  | 'redirect_cross_origin'
  | 'redirect_invalid_location'
  | 'redirect_limit'
  | 'redirect_path_rejected'
  | 'redirect_rejected'
  | 'redirect_status_rejected'
  | 'subrequest_limit'
  | 'tls_error'
  | 'unknown_exception'

export interface SafeLogEntry {
  code: BackupCode
  count: number
  bytes: number
  durationMs: number
  orphanCount: number
}

export interface BackupRunResult extends SafeLogEntry {
  status: 'completed' | 'disabled' | 'failed' | 'skipped'
  diagnosticCode?: FetchDiagnosticCode
}

export interface RuntimeConfigKv {
  get(key: string, type: 'json'): Promise<unknown>
}

interface R2ChecksumsLike {
  sha256?: ArrayBuffer
}

interface R2HeadLike {
  key: string
  size: number
  etag: string
  checksums: R2ChecksumsLike
  uploaded: Date
  customMetadata?: Record<string, string>
}

interface R2GetLike extends R2HeadLike {
  arrayBuffer(): Promise<ArrayBuffer>
}

interface R2PutOptionsLike {
  onlyIf?: {
    etagMatches?: string
    etagDoesNotMatch?: string
  }
  customMetadata?: Record<string, string>
  httpMetadata?: {
    contentType?: string
    cacheControl?: string
  }
  sha256?: ArrayBuffer | ArrayBufferView
}

interface R2ListOptionsLike {
  limit?: number
  prefix?: string
  cursor?: string
  include?: Array<'customMetadata'>
}

interface R2ListResultLike {
  objects: R2HeadLike[]
  delimitedPrefixes: string[]
  truncated: boolean
  cursor?: string
}

export interface BackupR2Bucket {
  head(key: string): Promise<R2HeadLike | null>
  get(key: string): Promise<R2GetLike | null>
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: R2PutOptionsLike,
  ): Promise<R2HeadLike | null>
  delete(keys: string | string[]): Promise<void>
  list(options?: R2ListOptionsLike): Promise<R2ListResultLike>
}

export interface StorageBackupBindings {
  BURILLAB_RUNTIME_CONFIG?: RuntimeConfigKv
  CABINET_BACKUPS?: BackupR2Bucket
  BACKUP_ENVIRONMENT?: string
  SUPABASE_PROJECT_REF?: string
  SUPABASE_URL?: string
  SOURCE_POINTER_MODE?: string
  SOURCE_STORAGE_BUCKET?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  WORKERS_SUBREQUEST_LIMIT?: string
  WORKERS_USAGE_PLAN?: string
}

export interface BackupLimits {
  dbPageSize: number
  storagePageSize: number
  maxDbPages: number
  maxStoragePages: number
  maxStorageDepth: number
  maxPointers: number
  maxPointersPerOwner: number
  maxStorageObjects: number
  maxJsonBytes: number
  maxObjectBytes: number
  maxTotalBytes: number
  requestTimeoutMs: number
  retryCount: number
  retryDelayMs: number
  lockTtlMs: number
  maxLockClockSkewMs: number
  maxRunDurationMs: number
  maxSubrequests: number
  r2ListPageSize: number
  maxSnapshotListPages: number
  maxSnapshotDocuments: number
  maxRecentSnapshots: number
  maxContentListPages: number
  maxContentBodies: number
  gcReferenceWindowDays: number
  gcMinimumUnreferencedAgeDays: number
  gcConfirmationMaxGapDays: number
  maxGcCandidates: number
  maxGcDeletesPerRun: number
}

export const STORAGE_BACKUP_LIMITS: Readonly<BackupLimits> = Object.freeze({
  dbPageSize: 100,
  storagePageSize: 100,
  maxDbPages: 5,
  maxStoragePages: 25,
  maxStorageDepth: 8,
  maxPointers: 250,
  maxPointersPerOwner: 50,
  maxStorageObjects: 250,
  maxJsonBytes: 1_048_576,
  maxObjectBytes: 20 * 1_048_576,
  maxTotalBytes: 250 * 20 * 1_048_576,
  requestTimeoutMs: 5_000,
  retryCount: 2,
  retryDelayMs: 150,
  lockTtlMs: 30 * 60_000,
  maxLockClockSkewMs: 60_000,
  maxRunDurationMs: 14 * 60_000,
  maxSubrequests: 4_000,
  r2ListPageSize: 1_000,
  maxSnapshotListPages: 4,
  maxSnapshotDocuments: 512,
  maxRecentSnapshots: 128,
  maxContentListPages: 10,
  maxContentBodies: 10_000,
  gcReferenceWindowDays: 30,
  gcMinimumUnreferencedAgeDays: 31,
  gcConfirmationMaxGapDays: 3,
  maxGcCandidates: 100,
  maxGcDeletesPerRun: 10,
})

interface RunGuard {
  deadlineAt: number
  subrequests: number
}

interface BackupDependencies {
  fetch: typeof fetch
  now: () => number
  randomBytes: (length: number) => Uint8Array
  sleep: (milliseconds: number) => Promise<void>
  log: (entry: SafeLogEntry) => void
  limits: BackupLimits
  guard: RunGuard
}

export interface BackupDependencyOverrides {
  fetch?: typeof fetch
  now?: () => number
  randomBytes?: (length: number) => Uint8Array
  sleep?: (milliseconds: number) => Promise<void>
  log?: (entry: SafeLogEntry) => void
  limits?: Partial<BackupLimits>
}

interface SourceConfig {
  environment: BackupEnvironmentName
  origin: string
  projectRef: string
  pointerMode: SourcePointerMode
  serviceRoleKey: string
  credentialKind: SupabaseBackendCredentialKind
  runtimeConfig: RuntimeConfigKv
  r2: BackupR2Bucket
  workersUsagePlan: WorkersUsagePlan
}

interface CabinetPointer {
  cabinetId: string
  labId: string | null
  userId: string | null
  objectPath: string
}

interface StorageObject {
  id: string
  path: string
  size: number
  etag: string
  updatedAt: string
}

interface BackupPlanEntry {
  object: StorageObject
  classification: 'referenced' | 'unreferenced'
  ownerScope?: 'lab' | 'user'
}

interface BackedObject {
  sourcePath: string
  backupKey: string
  etag: string
  bytes: number
  sha256: string
  classification: 'referenced' | 'unreferenced'
  ownerScope?: 'lab' | 'user'
  contentType: string
}

interface DownloadedObject {
  body: Uint8Array
  contentType: string
}

interface LockLease {
  etag: string
  token: string
  acquiredAt: string
  expiresAt: string
}

interface ContentGcCandidate {
  backupKey: string
  etag: string
  bytes: number
  uploadedAt: string
  firstConfirmedAt: string
  lastConfirmedAt: string
  firstSnapshotId: string
  lastSnapshotId: string
}

interface ContentGcState {
  schemaVersion: number
  environment: BackupEnvironmentName
  updatedAt: string
  lastSnapshotId: string
  scannedBodyCount: number
  protectedBodyCount: number
  candidateCount: number
  deletedBodyCount: number
  candidates: ContentGcCandidate[]
}

type LockSkipCode = 'backup_locked' | 'backup_locked_extended'

interface LockAcquisition {
  lease: LockLease | null
  skipCode?: LockSkipCode
}

class BackupFailure extends Error {
  readonly code: BackupCode
  readonly diagnosticCode?: FetchDiagnosticCode

  constructor(code: BackupCode, diagnosticCode?: FetchDiagnosticCode) {
    super(code)
    this.name = 'BackupFailure'
    this.code = code
    this.diagnosticCode = diagnosticCode
  }
}

function fail(code: BackupCode, diagnosticCode?: FetchDiagnosticCode): never {
  throw new BackupFailure(code, diagnosticCode)
}

function classifyFetchException(error: unknown): FetchDiagnosticCode {
  let name = ''
  let message = ''
  try {
    if (error instanceof Error) {
      name = error.name.toLowerCase()
      message = error.message.toLowerCase()
    } else if (isRecord(error)) {
      name = typeof error.name === 'string' ? error.name.toLowerCase() : ''
      message = typeof error.message === 'string' ? error.message.toLowerCase() : ''
    }
  } catch {
    return 'unknown_exception'
  }

  const fingerprint = `${name} ${message}`
  if (name === 'aborterror' || /\babort(?:ed)?\b/.test(fingerprint)) return 'abort_error'
  if (fingerprint.includes('illegal invocation')) return 'illegal_invocation'
  if (/\bredirect(?:ed|ion)?\b/.test(fingerprint)) return 'redirect_rejected'
  if (/\bsubrequest\b|too many (?:calls|requests)/.test(fingerprint)) return 'subrequest_limit'
  if (/\bdns\b|name resolution|resolve host/.test(fingerprint)) return 'dns_error'
  if (/\btls\b|\bssl\b|certificate/.test(fingerprint)) return 'tls_error'
  if (/\bnetwork\b|connection (?:failed|lost|refused|reset)|fetch failed/.test(fingerprint)) {
    return 'network_error'
  }
  if (/invalid (?:url|header|request)|malformed (?:url|header|request)|unsupported protocol/.test(fingerprint)) {
    return 'invalid_request'
  }
  if (name === 'typeerror' || error instanceof TypeError) return 'fetch_type_error'
  return 'unknown_exception'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isNullableUuid(value: unknown): value is string | null {
  return value === null || isUuid(value)
}

function createDefaultDependencies(overrides: BackupDependencyOverrides): BackupDependencies {
  return {
    // Keep the platform fetch receiver out of our dependency object. Some Worker
    // runtimes reject a native fetch function when it is later invoked as
    // `dependencies.fetch(...)` because that supplies the dependency object as
    // the receiver instead of making a normal global fetch call.
    fetch: overrides.fetch ?? ((input, init) => fetch(input, init)),
    now: overrides.now ?? (() => Date.now()),
    randomBytes: overrides.randomBytes ?? ((length) => {
      const value = new Uint8Array(length)
      crypto.getRandomValues(value)
      return value
    }),
    sleep: overrides.sleep ?? ((milliseconds) => new Promise((resolve) => {
      setTimeout(resolve, milliseconds)
    })),
    log: overrides.log ?? ((entry) => {
      console.log(JSON.stringify(entry))
    }),
    limits: {
      ...STORAGE_BACKUP_LIMITS,
      ...overrides.limits,
    },
    guard: {
      deadlineAt: 0,
      subrequests: 0,
    },
  }
}

function safeLog(dependencies: BackupDependencies, entry: SafeLogEntry): void {
  try {
    dependencies.log(entry)
  } catch {
    // Logging must never change backup safety or expose the original error.
  }
}

function createRunResult(
  dependencies: BackupDependencies,
  status: BackupRunResult['status'],
  code: BackupCode,
  startedAt: number,
  count = 0,
  bytes = 0,
  orphanCount = 0,
  diagnosticCode?: FetchDiagnosticCode,
): BackupRunResult {
  return {
    status,
    code,
    count,
    bytes,
    durationMs: Math.max(0, Math.round(dependencies.now() - startedAt)),
    orphanCount,
    ...(diagnosticCode ? { diagnosticCode } : {}),
  } satisfies BackupRunResult
}

function emitRunResult(
  dependencies: BackupDependencies,
  result: BackupRunResult,
): BackupRunResult {
  safeLog(dependencies, {
    code: result.code,
    count: result.count,
    bytes: result.bytes,
    durationMs: result.durationMs,
    orphanCount: result.orphanCount,
  })
  return result
}

export function calculateWorstCaseSubrequests(limits: BackupLimits): number {
  const attempts = limits.retryCount + 1
  const sourceRequestAttempts = (
    (2 * limits.maxDbPages)
    + (3 * limits.maxStoragePages)
    + limits.maxPointers
  ) * attempts
  const sourceRequests = sourceRequestAttempts * (MAX_SOURCE_REDIRECTS_PER_ATTEMPT + 1)
  const runtimeFlagReads = limits.maxPointers + 5
  // A worst-case v2 run reads the previous pointer/completion/manifest, checks
  // every content-addressed body, rewrites every body, verifies every body
  // again before completion, and still reserves the fixed lock/document calls.
  const r2Requests = (4 * limits.maxStorageObjects) + 19
  const snapshotListRequests = 2 * limits.maxSnapshotListPages
  const contentListRequests = 2 * limits.maxContentListPages
  const snapshotVerificationRequests = 3 * limits.maxRecentSnapshots
  // GC reads and conditionally rewrites one aggregate state document. Each
  // bounded deletion rechecks the content object, lease, and runtime flag,
  // performs the delete, and confirms that the object is gone.
  const gcFixedRequests = snapshotListRequests
    + contentListRequests
    + snapshotVerificationRequests
    + 5
  const gcDeletionRequests = 5 * limits.maxGcDeletesPerRun
  return sourceRequests
    + runtimeFlagReads
    + r2Requests
    + gcFixedRequests
    + gcDeletionRequests
}

function isValidLimits(limits: BackupLimits): boolean {
  const worstCaseSubrequests = calculateWorstCaseSubrequests(limits)
  const maximumPossibleBytes = limits.maxObjectBytes * limits.maxStorageObjects
  return Object.values(limits).every((value) => Number.isSafeInteger(value) && value > 0)
    && Number.isSafeInteger(worstCaseSubrequests)
    && Number.isSafeInteger(maximumPossibleBytes)
    && limits.dbPageSize <= 1_000
    && limits.storagePageSize <= 1_000
    && limits.maxDbPages <= 10
    && limits.maxStoragePages <= 50
    && limits.maxPointers === limits.maxStorageObjects
    && limits.maxPointers <= 500
    && limits.maxPointersPerOwner <= 50
    && limits.maxPointersPerOwner <= limits.maxPointers
    && limits.r2ListPageSize <= 1_000
    && limits.maxSnapshotDocuments <= limits.r2ListPageSize * limits.maxSnapshotListPages
    && limits.maxRecentSnapshots * 3 <= limits.maxSnapshotDocuments
    && limits.maxContentBodies <= limits.r2ListPageSize * limits.maxContentListPages
    && limits.gcReferenceWindowDays === 30
    && limits.gcMinimumUnreferencedAgeDays >= limits.gcReferenceWindowDays + 1
    && limits.gcConfirmationMaxGapDays <= limits.gcReferenceWindowDays
    && limits.maxGcDeletesPerRun <= limits.maxGcCandidates
    && limits.retryCount <= 5
    && limits.maxObjectBytes <= limits.maxTotalBytes
    && maximumPossibleBytes <= limits.maxTotalBytes
    && limits.maxRunDurationMs <= 15 * 60_000
    && limits.lockTtlMs >= limits.maxRunDurationMs + limits.maxLockClockSkewMs
    && limits.requestTimeoutMs * (limits.retryCount + 1) < limits.maxRunDurationMs
    && limits.maxSubrequests <= 10_000
    && worstCaseSubrequests <= limits.maxSubrequests
}

function startRunGuard(
  dependencies: BackupDependencies,
  startedAt: number,
): void {
  const deadlineAt = startedAt + dependencies.limits.maxRunDurationMs
  if (!Number.isFinite(startedAt) || !Number.isSafeInteger(deadlineAt)) fail('config_invalid')
  dependencies.guard.deadlineAt = deadlineAt
  dependencies.guard.subrequests = 0
}

function consumeSubrequest(
  dependencies: BackupDependencies,
  allowAfterDeadline = false,
): void {
  if (!allowAfterDeadline && dependencies.now() >= dependencies.guard.deadlineAt) {
    fail('execution_deadline_exceeded')
  }
  const availableLimit = allowAfterDeadline
    ? dependencies.limits.maxSubrequests
    : dependencies.limits.maxSubrequests - CLEANUP_SUBREQUEST_RESERVE
  if (dependencies.guard.subrequests >= availableLimit) {
    fail('subrequest_budget_exceeded')
  }
  dependencies.guard.subrequests += 1
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index)
    if (codePoint <= 31 || codePoint === 127) return true
  }
  return false
}

function hasSafeSecretShape(value: string | undefined): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.length >= 20
    && value.length <= 4_096
    && !hasControlCharacters(value)
}

function parseBase64UrlJson(value: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 2_048) fail('config_invalid')
  const remainder = value.length % 4
  if (remainder === 1) fail('config_invalid')
  const padded = `${value.replace(/-/g, '+').replace(/_/g, '/')}${'='.repeat((4 - remainder) % 4)}`
  try {
    const decoded = atob(padded)
    if (decoded.length > 2_048 || hasControlCharacters(decoded.replace(/[\t\r\n]/g, ''))) {
      fail('config_invalid')
    }
    const parsed = JSON.parse(decoded) as unknown
    if (!isRecord(parsed)) fail('config_invalid')
    return parsed
  } catch (error) {
    if (error instanceof BackupFailure) throw error
    fail('config_invalid')
  }
}

function parseSupabaseBackendCredential(
  value: string | undefined,
  expectedProjectRef: string,
): { kind: SupabaseBackendCredentialKind; value: string } {
  if (!hasSafeSecretShape(value)) fail('config_invalid')
  if (/^sb_secret_[A-Za-z0-9_-]{20,512}$/.test(value)) {
    return { kind: 'secret_key', value }
  }

  const parts = value.split('.')
  if (parts.length !== 3 || parts[2].length < 16 || !/^[A-Za-z0-9_-]+$/.test(parts[2])) {
    fail('config_invalid')
  }
  const header = parseBase64UrlJson(parts[0])
  const payload = parseBase64UrlJson(parts[1])
  if (
    header.alg !== 'HS256'
    || header.typ !== 'JWT'
    || payload.iss !== 'supabase'
    || payload.role !== 'service_role'
    || payload.ref !== expectedProjectRef
  ) {
    fail('config_invalid')
  }
  return { kind: 'legacy_service_role', value }
}

function parsePlatformSubrequestLimit(value: string | undefined): number {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,7}$/.test(value)) fail('config_invalid')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || String(parsed) !== value) fail('config_invalid')
  return parsed
}

export function resolveSourceConfig(
  bindings: StorageBackupBindings,
  limits: BackupLimits = { ...STORAGE_BACKUP_LIMITS },
): SourceConfig {
  const environment = bindings.BACKUP_ENVIRONMENT
  if (environment !== 'staging' && environment !== 'production') fail('config_invalid')

  const expected = ENVIRONMENT_CONTRACT[environment]
  if (
    bindings.SUPABASE_PROJECT_REF !== expected.projectRef
    || bindings.SUPABASE_URL !== expected.origin
    || bindings.SOURCE_STORAGE_BUCKET !== SOURCE_BUCKET
  ) {
    fail('config_invalid')
  }

  const parsedOrigin = new URL(bindings.SUPABASE_URL)
  if (
    parsedOrigin.protocol !== 'https:'
    || parsedOrigin.origin !== expected.origin
    || parsedOrigin.username
    || parsedOrigin.password
    || parsedOrigin.port
    || parsedOrigin.pathname !== '/'
    || parsedOrigin.search
    || parsedOrigin.hash
  ) {
    fail('config_invalid')
  }

  const pointerMode = bindings.SOURCE_POINTER_MODE
  if (pointerMode !== 'legacy_url' && pointerMode !== 'private_path') fail('config_invalid')
  const credential = parseSupabaseBackendCredential(
    bindings.SUPABASE_SERVICE_ROLE_KEY,
    expected.projectRef,
  )
  if (!bindings.BURILLAB_RUNTIME_CONFIG || typeof bindings.BURILLAB_RUNTIME_CONFIG.get !== 'function') {
    fail('config_invalid')
  }
  if (
    !bindings.CABINET_BACKUPS
    || typeof bindings.CABINET_BACKUPS.head !== 'function'
    || typeof bindings.CABINET_BACKUPS.get !== 'function'
    || typeof bindings.CABINET_BACKUPS.put !== 'function'
    || typeof bindings.CABINET_BACKUPS.delete !== 'function'
    || typeof bindings.CABINET_BACKUPS.list !== 'function'
    || !isValidLimits(limits)
  ) {
    fail('config_invalid')
  }

  const workersUsagePlan = bindings.WORKERS_USAGE_PLAN
  if (workersUsagePlan !== 'free_off_only' && workersUsagePlan !== 'paid') fail('config_invalid')
  const platformSubrequestLimit = parsePlatformSubrequestLimit(bindings.WORKERS_SUBREQUEST_LIMIT)
  if (
    (workersUsagePlan === 'free_off_only' && platformSubrequestLimit !== FREE_PLATFORM_SUBREQUEST_LIMIT)
    || (
      workersUsagePlan === 'paid'
      && (
        platformSubrequestLimit !== limits.maxSubrequests
        || calculateWorstCaseSubrequests(limits) > platformSubrequestLimit
      )
    )
  ) {
    fail('config_invalid')
  }

  return {
    environment,
    origin: expected.origin,
    projectRef: expected.projectRef,
    pointerMode,
    serviceRoleKey: credential.value,
    credentialKind: credential.kind,
    runtimeConfig: bindings.BURILLAB_RUNTIME_CONFIG,
    r2: bindings.CABINET_BACKUPS,
    workersUsagePlan,
  }
}

export async function isStorageBackupEnabled(namespace: RuntimeConfigKv): Promise<boolean> {
  try {
    const value = await namespace.get(RUNTIME_CONFIG_KEY, 'json')
    return isRecord(value) && value.storage_backup_enabled === true
  } catch {
    return false
  }
}

async function readStorageBackupEnabled(
  config: SourceConfig,
  dependencies: BackupDependencies,
): Promise<boolean> {
  consumeSubrequest(dependencies)
  return isStorageBackupEnabled(config.runtimeConfig)
}

async function requireStorageBackupEnabled(
  config: SourceConfig,
  dependencies: BackupDependencies,
): Promise<void> {
  if (!await readStorageBackupEnabled(config, dependencies)) {
    fail('flag_disabled_before_complete')
  }
}

function normalizePercentHex(value: string): string {
  return value.replace(/%[0-9a-f]{2}/gi, (match) => match.toUpperCase())
}

export function parseStrictObjectPath(value: string): string {
  if (
    value.length < 1
    || value.length > 1_024
    || value !== value.trim()
    || hasControlCharacters(value)
    || /[\\?#]/.test(value)
    || value.startsWith('/')
    || value.endsWith('/')
    || value.includes('//')
  ) {
    fail('pointer_invalid')
  }

  const decodedSegments = value.split('/').map((segment) => {
    if (!/^(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+$/.test(segment)) fail('pointer_invalid')

    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      fail('pointer_invalid')
    }

    if (
      decoded === '.'
      || decoded === '..'
      || decoded.includes('%')
      || hasControlCharacters(decoded)
      || /[\\/]/.test(decoded)
      || normalizePercentHex(encodeURIComponent(decoded)) !== normalizePercentHex(segment)
    ) {
      fail('pointer_invalid')
    }
    return decoded
  })

  return decodedSegments.join('/')
}

export function parseLegacyPublicUrl(value: string, expectedOrigin: string): string {
  if (value.length > 2_048 || hasControlCharacters(value) || value.includes('\\')) fail('pointer_invalid')

  const prefix = `${expectedOrigin}/storage/v1/object/public/${SOURCE_BUCKET}/`
  if (!value.startsWith(prefix) || value.includes('?') || value.includes('#')) fail('pointer_invalid')

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    fail('pointer_invalid')
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.origin !== expectedOrigin
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.search
    || parsed.hash
  ) {
    fail('pointer_invalid')
  }

  return parseStrictObjectPath(value.slice(prefix.length))
}

export function parseSourcePointer(
  value: string,
  mode: SourcePointerMode,
  expectedOrigin: string,
): string {
  return mode === 'legacy_url'
    ? parseLegacyPublicUrl(value, expectedOrigin)
    : parseStrictObjectPath(value)
}

function encodeObjectPath(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(value: Uint8Array): Promise<{ bytes: ArrayBuffer; hex: string }> {
  const input = new Uint8Array(value.byteLength)
  input.set(value)
  const digest = await crypto.subtle.digest('SHA-256', input)
  return { bytes: digest, hex: bytesToHex(new Uint8Array(digest)) }
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function equalBytes(left: ArrayBuffer | undefined, right: ArrayBuffer): boolean {
  if (!left || left.byteLength !== right.byteLength) return false
  const a = new Uint8Array(left)
  const b = new Uint8Array(right)
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false
  }
  return true
}

async function readBodyLimited(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const parsed = Number(contentLength)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximumBytes) fail('source_limit_exceeded')
  }
  if (!response.body) fail('source_contract_invalid')

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > maximumBytes) fail('source_limit_exceeded')
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }

  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

async function discardResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // The status code, not an upstream error body, controls the retry.
  }
}

async function requestWithRetry<T>(
  url: string,
  init: RequestInit,
  dependencies: BackupDependencies,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const attempts = dependencies.limits.retryCount + 1
  let lastCode: BackupCode = 'source_request_failed'
  let lastDiagnosticCode: FetchDiagnosticCode | undefined

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, dependencies.limits.requestTimeoutMs)

    try {
      const requestInit: RequestInit = {
        ...init,
        redirect: 'manual',
        signal: controller.signal,
      }
      consumeSubrequest(dependencies)
      let response = await dependencies.fetch(url, requestInit)
      if (response.status >= 300 && response.status < 400) {
        let redirectedUrl = ''
        try {
          redirectedUrl = resolveSafeSourceRedirect(url, init.method, response)
        } finally {
          await discardResponse(response)
        }
        consumeSubrequest(dependencies)
        response = await dependencies.fetch(redirectedUrl, requestInit)
        if (response.status >= 300 && response.status < 400) {
          await discardResponse(response)
          fail('source_request_failed', 'redirect_limit')
        }
      }
      if (response.status === 429 || response.status >= 500) {
        lastCode = 'source_retry_exhausted'
        await discardResponse(response)
        if (attempt + 1 < attempts) {
          await dependencies.sleep(dependencies.limits.retryDelayMs * (attempt + 1))
          continue
        }
        fail(lastCode)
      }
      if (!response.ok) {
        await discardResponse(response)
        fail('source_http_rejected')
      }
      return await consume(response)
    } catch (error) {
      if (error instanceof BackupFailure) throw error
      lastCode = timedOut ? 'source_timeout' : 'source_request_failed'
      lastDiagnosticCode = timedOut ? 'abort_error' : classifyFetchException(error)
      if (attempt + 1 < attempts) {
        await dependencies.sleep(dependencies.limits.retryDelayMs * (attempt + 1))
        continue
      }
      fail(lastCode, lastDiagnosticCode)
    } finally {
      clearTimeout(timer)
    }
  }

  fail(lastCode, lastDiagnosticCode)
}

async function requestJson(
  url: string,
  init: RequestInit,
  config: SourceConfig,
  dependencies: BackupDependencies,
): Promise<unknown> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  headers.set('apikey', config.serviceRoleKey)
  if (config.credentialKind === 'legacy_service_role') {
    headers.set('Authorization', `Bearer ${config.serviceRoleKey}`)
  } else {
    headers.delete('Authorization')
  }
  if (init.body !== undefined) headers.set('Content-Type', 'application/json')

  return requestWithRetry(url, { ...init, headers }, dependencies, async (response) => {
    const bytes = await readBodyLimited(response, dependencies.limits.maxJsonBytes)
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown
    } catch {
      fail('source_contract_invalid')
    }
  })
}

function parseCabinetRow(
  value: unknown,
  pointerMode: SourcePointerMode,
  origin: string,
): CabinetPointer | null {
  if (!isRecord(value)) fail('source_contract_invalid')
  const pointerColumn = pointerMode === 'legacy_url' ? 'image_url' : 'image_path'
  if (
    !isUuid(value.id)
    || !isNullableUuid(value.lab_id)
    || !isNullableUuid(value.user_id)
    || typeof value[pointerColumn] !== 'string'
  ) {
    fail('source_contract_invalid')
  }

  if (value[pointerColumn] === '') return null

  return {
    cabinetId: value.id,
    labId: value.lab_id,
    userId: value.user_id,
    objectPath: parseSourcePointer(value[pointerColumn], pointerMode, origin),
  }
}

async function listCabinetPointers(
  config: SourceConfig,
  dependencies: BackupDependencies,
): Promise<CabinetPointer[]> {
  const pointerColumn = config.pointerMode === 'legacy_url' ? 'image_url' : 'image_path'
  const rows: CabinetPointer[] = []
  const ids = new Set<string>()
  const paths = new Set<string>()

  for (let page = 0; page < dependencies.limits.maxDbPages; page += 1) {
    const url = new URL('/rest/v1/cabinets', config.origin)
    url.searchParams.set('select', `id,lab_id,user_id,${pointerColumn}`)
    url.searchParams.set(pointerColumn, 'not.is.null')
    url.searchParams.set('order', 'id.asc')
    url.searchParams.set('limit', String(dependencies.limits.dbPageSize))
    url.searchParams.set('offset', String(page * dependencies.limits.dbPageSize))

    const raw = await requestJson(url.toString(), { method: 'GET' }, config, dependencies)
    if (!Array.isArray(raw) || raw.length > dependencies.limits.dbPageSize) fail('source_contract_invalid')

    for (const item of raw) {
      if (!isRecord(item) || !isUuid(item.id)) fail('source_contract_invalid')
      if (ids.has(item.id)) fail('source_drift')
      ids.add(item.id)
      const row = parseCabinetRow(item, config.pointerMode, config.origin)
      if (!row) continue
      if (paths.has(row.objectPath)) fail('pointer_duplicate')
      paths.add(row.objectPath)
      rows.push(row)
      if (rows.length > dependencies.limits.maxPointers) fail('source_limit_exceeded')
    }

    if (raw.length < dependencies.limits.dbPageSize) return rows
  }

  fail('source_limit_exceeded')
}

function validateStorageSegment(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 255
    || value === '.'
    || value === '..'
    || hasControlCharacters(value)
    || /[\\/]/.test(value)
  ) {
    fail('source_contract_invalid')
  }
  return value
}

function normalizeEtag(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) return ''
  const trimmed = value.trim().replace(/^W\//, '').replace(/^"|"$/g, '')
  return /^[A-Za-z0-9._:-]+$/.test(trimmed) ? trimmed : ''
}

function parseStorageObject(value: Record<string, unknown>, path: string): StorageObject {
  if (!isUuid(value.id) || !isRecord(value.metadata) || typeof value.updated_at !== 'string') {
    fail('source_contract_invalid')
  }
  const size = value.metadata.size
  if (!Number.isSafeInteger(size) || (size as number) < 0) fail('source_contract_invalid')
  const updatedAt = value.updated_at
  if (!Number.isFinite(Date.parse(updatedAt))) fail('source_contract_invalid')
  const etag = normalizeEtag(value.metadata.eTag ?? value.metadata.etag)
  if (!etag) fail('source_contract_invalid')

  return {
    id: value.id,
    path,
    size: size as number,
    etag,
    updatedAt,
  }
}

async function listStorageObjects(
  config: SourceConfig,
  dependencies: BackupDependencies,
): Promise<StorageObject[]> {
  const endpoint = `${config.origin}/storage/v1/object/list/${SOURCE_BUCKET}`
  const queue: Array<{ prefix: string; depth: number }> = [{ prefix: '', depth: 0 }]
  const visitedPrefixes = new Set<string>()
  const objectIds = new Set<string>()
  const objectPaths = new Set<string>()
  const objects: StorageObject[] = []
  let pageCount = 0

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visitedPrefixes.has(current.prefix)) fail('source_contract_invalid')
    visitedPrefixes.add(current.prefix)
    const entryNames = new Set<string>()

    for (let offset = 0; ; offset += dependencies.limits.storagePageSize) {
      pageCount += 1
      if (pageCount > dependencies.limits.maxStoragePages) fail('source_limit_exceeded')

      const raw = await requestJson(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          prefix: current.prefix,
          limit: dependencies.limits.storagePageSize,
          offset,
          sortBy: { column: 'name', order: 'asc' },
        }),
      }, config, dependencies)
      if (!Array.isArray(raw) || raw.length > dependencies.limits.storagePageSize) {
        fail('source_contract_invalid')
      }

      for (const item of raw) {
        if (!isRecord(item)) fail('source_contract_invalid')
        const name = validateStorageSegment(item.name)
        if (entryNames.has(name)) fail('source_drift')
        entryNames.add(name)
        const fullPath = current.prefix ? `${current.prefix}/${name}` : name

        if (item.id === null) {
          if (current.depth >= dependencies.limits.maxStorageDepth) fail('source_limit_exceeded')
          queue.push({ prefix: fullPath, depth: current.depth + 1 })
          if (queue.length + visitedPrefixes.size > dependencies.limits.maxStorageObjects) {
            fail('source_limit_exceeded')
          }
          continue
        }

        if (!isUuid(item.id)) fail('source_contract_invalid')
        if (objectIds.has(item.id) || objectPaths.has(fullPath)) fail('source_drift')
        objectIds.add(item.id)
        objectPaths.add(fullPath)
        objects.push(parseStorageObject(item, fullPath))
        if (objects.length > dependencies.limits.maxStorageObjects) fail('source_limit_exceeded')
      }

      if (raw.length < dependencies.limits.storagePageSize) break
    }
  }

  return objects.sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

function pointerFingerprint(rows: CabinetPointer[]): string {
  return JSON.stringify(rows.map((row) => ({
    id: row.cabinetId,
    labId: row.labId,
    userId: row.userId,
    path: row.objectPath,
  })).sort((left, right) => left.id.localeCompare(right.id, 'en')))
}

function storageFingerprint(rows: StorageObject[]): string {
  return JSON.stringify(rows.map((row) => ({
    id: row.id,
    path: row.path,
    size: row.size,
    etag: row.etag,
    updatedAt: row.updatedAt,
  })))
}

function buildBackupPlan(
  pointers: CabinetPointer[],
  objects: StorageObject[],
  limits: BackupLimits,
): BackupPlanEntry[] {
  if (objects.length === 0) fail('empty_source')
  const storageByPath = new Map(objects.map((object) => [object.path, object]))
  const referenced = new Set<string>()
  const referencedByOwner = new Map<string, number>()
  const plan: BackupPlanEntry[] = []

  for (const pointer of pointers) {
    const hasLab = pointer.labId !== null
    const hasUser = pointer.userId !== null
    if (!hasLab && !hasUser) fail('ownership_ambiguous')
    const ownerKey = hasLab ? `lab:${pointer.labId}` : `user:${pointer.userId}`
    const ownerCount = (referencedByOwner.get(ownerKey) ?? 0) + 1
    if (ownerCount > limits.maxPointersPerOwner) fail('source_limit_exceeded')
    referencedByOwner.set(ownerKey, ownerCount)
    const object = storageByPath.get(pointer.objectPath)
    if (!object) fail('pointer_missing_object')
    referenced.add(pointer.objectPath)
    plan.push({
      object,
      classification: 'referenced',
      ownerScope: hasLab ? 'lab' : 'user',
    })
  }

  for (const object of objects) {
    if (!referenced.has(object.path)) {
      plan.push({ object, classification: 'unreferenced' })
    }
  }
  return plan.sort((left, right) => left.object.path.localeCompare(right.object.path, 'en'))
}

async function downloadObject(
  object: StorageObject,
  config: SourceConfig,
  dependencies: BackupDependencies,
): Promise<DownloadedObject> {
  if (object.size <= 0) fail('object_download_invalid')
  if (object.size > dependencies.limits.maxObjectBytes) fail('object_too_large')
  const url = `${config.origin}/storage/v1/object/${SOURCE_BUCKET}/${encodeObjectPath(object.path)}`
  const headers = new Headers({
    Accept: 'application/octet-stream',
    apikey: config.serviceRoleKey,
  })
  if (config.credentialKind === 'legacy_service_role') {
    headers.set('Authorization', `Bearer ${config.serviceRoleKey}`)
  }

  return requestWithRetry(url, { method: 'GET', headers }, dependencies, async (response) => {
    const contentEncoding = response.headers.get('content-encoding')
    if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') fail('object_download_invalid')
    const responseEtag = normalizeEtag(response.headers.get('etag'))
    if (!responseEtag) fail('object_download_invalid')
    if (responseEtag !== object.etag) fail('source_drift')
    const body = await readBodyLimited(response, dependencies.limits.maxObjectBytes)
    if (body.byteLength !== object.size) fail('source_drift')
    const contentType = response.headers.get('content-type')?.trim() || 'application/octet-stream'
    if (contentType.length > 200 || hasControlCharacters(contentType)) {
      fail('object_download_invalid')
    }
    return { body, contentType }
  })
}

async function verifyR2Object(
  r2: BackupR2Bucket,
  key: string,
  body: Uint8Array,
  digest: ArrayBuffer,
  dependencies: BackupDependencies,
  expectedEtag?: string,
  allowAfterDeadline = false,
): Promise<R2HeadLike> {
  let head: R2HeadLike | null
  try {
    consumeSubrequest(dependencies, allowAfterDeadline)
    head = await r2.head(key)
  } catch {
    fail('r2_verify_failed')
  }
  if (!head || head.key !== key || head.size !== body.byteLength) fail('r2_verify_failed')
  if (expectedEtag && head.etag !== expectedEtag) fail('r2_verify_failed')
  if (!equalBytes(head.checksums.sha256, digest)) fail('r2_checksum_failed')
  return head
}

async function putVerified(
  r2: BackupR2Bucket,
  key: string,
  body: Uint8Array,
  dependencies: BackupDependencies,
  onlyIf: NonNullable<R2PutOptionsLike['onlyIf']>,
  options: Omit<R2PutOptionsLike, 'onlyIf' | 'sha256'> = {},
  allowAfterDeadline = false,
): Promise<R2HeadLike> {
  const digest = await sha256(body)
  let written: R2HeadLike | null
  try {
    consumeSubrequest(dependencies, allowAfterDeadline)
    written = await r2.put(key, body, {
      ...options,
      onlyIf,
      sha256: digest.bytes,
    })
  } catch {
    fail('r2_write_failed')
  }
  if (!written) fail('r2_lock_conflict')
  return verifyR2Object(
    r2,
    key,
    body,
    digest.bytes,
    dependencies,
    written.etag,
    allowAfterDeadline,
  )
}

async function putNewVerified(
  r2: BackupR2Bucket,
  key: string,
  body: Uint8Array,
  dependencies: BackupDependencies,
  options: Omit<R2PutOptionsLike, 'onlyIf' | 'sha256'> = {},
): Promise<R2HeadLike> {
  return putVerified(r2, key, body, dependencies, { etagDoesNotMatch: '*' }, options)
}

function randomToken(dependencies: BackupDependencies): string {
  const bytes = dependencies.randomBytes(16)
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 16) fail('config_invalid')
  return bytesToHex(bytes)
}

interface ParsedExistingLock {
  state: 'active' | 'released'
  acquiredAt: number
  expiresAt: number
}

function parseCanonicalTimestamp(value: unknown): { text: string; time: number } {
  if (typeof value !== 'string') fail('lock_invalid')
  const time = Date.parse(value)
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) fail('lock_invalid')
  return { text: value, time }
}

function parseExistingLock(
  existing: R2HeadLike,
  now: number,
  limits: BackupLimits,
): ParsedExistingLock {
  if (
    existing.key !== LOCK_KEY
    || !normalizeEtag(existing.etag)
    || !isRecord(existing.customMetadata)
  ) {
    fail('lock_invalid')
  }

  const state = existing.customMetadata['lock-state']
  const token = existing.customMetadata['lock-token']
  if (
    (state !== 'active' && state !== 'released')
    || typeof token !== 'string'
    || !/^[0-9a-f]{32}$/.test(token)
  ) {
    fail('lock_invalid')
  }

  const acquired = parseCanonicalTimestamp(existing.customMetadata['acquired-at'])
  const expires = parseCanonicalTimestamp(existing.customMetadata['expires-at'])
  const lifetime = expires.time - acquired.time
  if (
    acquired.time > now + limits.maxLockClockSkewMs
    || lifetime < 0
    || lifetime > limits.lockTtlMs
    || (state === 'active' && lifetime === 0)
    || (state === 'released' && expires.time > now + limits.maxLockClockSkewMs)
  ) {
    fail('lock_invalid')
  }

  return {
    state,
    acquiredAt: acquired.time,
    expiresAt: expires.time,
  }
}

async function acquireLock(
  config: SourceConfig,
  dependencies: BackupDependencies,
): Promise<LockAcquisition> {
  const now = dependencies.now()
  let existing: R2HeadLike | null
  try {
    consumeSubrequest(dependencies)
    existing = await config.r2.head(LOCK_KEY)
  } catch {
    fail('lock_acquire_failed')
  }

  const token = randomToken(dependencies)
  const acquiredAt = new Date(now).toISOString()
  const expiresAt = new Date(now + dependencies.limits.lockTtlMs).toISOString()
  const body = textBytes(JSON.stringify({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    state: 'active',
    acquiredAt,
    expiresAt,
    token,
  }))
  const customMetadata = {
    'lock-state': 'active',
    'lock-token': token,
    'acquired-at': acquiredAt,
    'expires-at': expiresAt,
  }

  if (existing) {
    const parsed = parseExistingLock(existing, now, dependencies.limits)
    if (parsed.state === 'active' && parsed.expiresAt > now) {
      return {
        lease: null,
        skipCode: now - parsed.acquiredAt >= dependencies.limits.lockTtlMs / 2
          ? 'backup_locked_extended'
          : 'backup_locked',
      }
    }
  }

  let written: R2HeadLike
  try {
    written = await putVerified(
      config.r2,
      LOCK_KEY,
      body,
      dependencies,
      existing ? { etagMatches: existing.etag } : { etagDoesNotMatch: '*' },
      { customMetadata, httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' } },
    )
  } catch (error) {
    if (error instanceof BackupFailure && error.code === 'r2_lock_conflict') {
      return { lease: null, skipCode: 'backup_locked' }
    }
    throw error
  }

  return {
    lease: {
      etag: written.etag,
      token,
      acquiredAt,
      expiresAt,
    },
  }
}

async function verifyLock(
  config: SourceConfig,
  lease: LockLease,
  dependencies: BackupDependencies,
): Promise<void> {
  let current: R2HeadLike | null
  try {
    consumeSubrequest(dependencies)
    current = await config.r2.head(LOCK_KEY)
  } catch {
    fail('lock_lost')
  }
  if (
    !current
    || current.etag !== lease.etag
    || current.customMetadata?.['lock-state'] !== 'active'
    || current.customMetadata?.['lock-token'] !== lease.token
    || current.customMetadata?.['acquired-at'] !== lease.acquiredAt
    || current.customMetadata?.['expires-at'] !== lease.expiresAt
    || Date.parse(lease.expiresAt) <= dependencies.now()
  ) {
    fail('lock_lost')
  }
}

async function releaseLock(
  config: SourceConfig,
  lease: LockLease,
  dependencies: BackupDependencies,
): Promise<void> {
  const releasedAt = new Date(dependencies.now()).toISOString()
  const body = textBytes(JSON.stringify({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    state: 'released',
    releasedAt,
  }))
  try {
    await putVerified(
      config.r2,
      LOCK_KEY,
      body,
      dependencies,
      { etagMatches: lease.etag },
      {
        customMetadata: {
          'lock-state': 'released',
          'lock-token': lease.token,
          'acquired-at': lease.acquiredAt,
          'expires-at': releasedAt,
        },
        httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
      },
      true,
    )
  } catch {
    fail('lock_release_failed')
  }
}

function createRunId(dependencies: BackupDependencies): string {
  const timestamp = new Date(dependencies.now()).toISOString().replace(/[-:.]/g, '').toLowerCase()
  return `${timestamp}-${bytesToHex(dependencies.randomBytes(12))}`
}

function jsonDocument(value: unknown): Uint8Array {
  return textBytes(`${JSON.stringify(value)}\n`)
}

function hasExactObjectKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index])
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function isSnapshotId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 8
    && value.length <= 128
    && /^[a-z0-9-]+$/.test(value)
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function sha256Bytes(value: string): ArrayBuffer {
  if (!isSha256Hex(value)) fail('r2_verify_failed')
  const bytes = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, (index * 2) + 2), 16)
  }
  return bytes.buffer
}

function contentAddressKey(value: string): string {
  if (!isSha256Hex(value)) fail('r2_verify_failed')
  return `objects/sha256/${value.slice(0, 2)}/${value}`
}

function isStoredSourcePath(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 1_024
    || value !== value.trim()
    || value.startsWith('/')
    || value.endsWith('/')
    || value.includes('//')
    || hasControlCharacters(value)
    || value.includes('\\')
  ) {
    return false
  }
  return value.split('/').every((segment) => (
    segment.length >= 1
    && segment.length <= 255
    && segment !== '.'
    && segment !== '..'
    && !hasControlCharacters(segment)
  ))
}

async function readR2Document(
  config: SourceConfig,
  key: string,
  maximumBytes: number,
  dependencies: BackupDependencies,
): Promise<{ body: Uint8Array; object: R2GetLike } | null> {
  let object: R2GetLike | null
  try {
    consumeSubrequest(dependencies)
    object = await config.r2.get(key)
  } catch {
    fail('r2_verify_failed')
  }
  if (object === null) return null
  if (
    object.key !== key
    || !Number.isSafeInteger(object.size)
    || object.size < 1
    || object.size > maximumBytes
  ) {
    fail('r2_verify_failed')
  }

  let raw: ArrayBuffer
  try {
    raw = await object.arrayBuffer()
  } catch {
    fail('r2_verify_failed')
  }
  const body = new Uint8Array(raw)
  if (body.byteLength !== object.size) fail('r2_verify_failed')
  const digest = await sha256(body)
  if (!equalBytes(object.checksums.sha256, digest.bytes)) fail('r2_checksum_failed')
  return { body, object }
}

async function readR2Bytes(
  config: SourceConfig,
  key: string,
  maximumBytes: number,
  dependencies: BackupDependencies,
): Promise<Uint8Array | null> {
  const document = await readR2Document(config, key, maximumBytes, dependencies)
  return document?.body ?? null
}

function parseJsonObject(body: Uint8Array): Record<string, unknown> {
  try {
    const value = JSON.parse(new TextDecoder().decode(body)) as unknown
    if (!isRecord(value)) fail('r2_verify_failed')
    return value
  } catch (error) {
    if (error instanceof BackupFailure) throw error
    fail('r2_verify_failed')
  }
}

function parsePreviousManifestObject(value: unknown): BackedObject {
  if (!isRecord(value)) fail('r2_verify_failed')
  const classification = value.classification
  const expectedKeys = classification === 'referenced'
    ? ['sourcePath', 'backupKey', 'etag', 'bytes', 'sha256', 'classification', 'ownerScope', 'contentType']
    : ['sourcePath', 'backupKey', 'etag', 'bytes', 'sha256', 'classification', 'contentType']
  if (
    !hasExactObjectKeys(value, expectedKeys)
    || (classification !== 'referenced' && classification !== 'unreferenced')
    || !isStoredSourcePath(value.sourcePath)
    || !isSha256Hex(value.sha256)
    || value.backupKey !== contentAddressKey(value.sha256)
    || typeof value.etag !== 'string'
    || normalizeEtag(value.etag) !== value.etag
    || !Number.isSafeInteger(value.bytes)
    || (value.bytes as number) <= 0
    || typeof value.contentType !== 'string'
    || value.contentType.length < 1
    || value.contentType.length > 200
    || hasControlCharacters(value.contentType)
    || (classification === 'referenced' && value.ownerScope !== 'lab' && value.ownerScope !== 'user')
  ) {
    fail('r2_verify_failed')
  }
  return {
    sourcePath: value.sourcePath,
    backupKey: value.backupKey as string,
    etag: value.etag,
    bytes: value.bytes as number,
    sha256: value.sha256,
    classification,
    ...(classification === 'referenced' ? { ownerScope: value.ownerScope as 'lab' | 'user' } : {}),
    contentType: value.contentType,
  }
}

interface VerifiedSnapshot {
  snapshotId: string
  completedAt: string
  manifestSha256: string
  orphanCount: number
  objects: BackedObject[]
}

async function readVerifiedSnapshot(
  config: SourceConfig,
  snapshotId: string,
  dependencies: BackupDependencies,
): Promise<VerifiedSnapshot> {
  if (!isSnapshotId(snapshotId)) fail('r2_verify_failed')
  const completeKey = `${SNAPSHOT_PREFIX}${snapshotId}/complete.json`
  const manifestKey = `${SNAPSHOT_PREFIX}${snapshotId}/manifest.json`
  const manifestHashKey = `${SNAPSHOT_PREFIX}${snapshotId}/manifest.sha256`
  const completeBody = await readR2Bytes(
    config,
    completeKey,
    dependencies.limits.maxJsonBytes,
    dependencies,
  )
  if (completeBody === null) fail('r2_verify_failed')
  const complete = parseJsonObject(completeBody)
  if (
    !hasExactObjectKeys(complete, [
      'schemaVersion', 'snapshotId', 'environment', 'completedAt', 'manifestKey',
      'manifestSha256', 'objectCount', 'referencedObjectCount', 'orphanCount',
      'totalBytes', 'uploadedBodyCount', 'reusedBodyCount',
    ])
    || complete.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
    || complete.snapshotId !== snapshotId
    || complete.environment !== config.environment
    || !isCanonicalTimestamp(complete.completedAt)
    || complete.manifestKey !== manifestKey
    || !isSha256Hex(complete.manifestSha256)
  ) {
    fail('r2_verify_failed')
  }

  const manifestHashBody = await readR2Bytes(config, manifestHashKey, 128, dependencies)
  if (
    manifestHashBody === null
    || new TextDecoder().decode(manifestHashBody) !== `${complete.manifestSha256}\n`
  ) {
    fail('r2_checksum_failed')
  }
  const manifestBody = await readR2Bytes(config, manifestKey, dependencies.limits.maxJsonBytes, dependencies)
  if (manifestBody === null) fail('r2_verify_failed')
  const manifestDigest = await sha256(manifestBody)
  if (manifestDigest.hex !== complete.manifestSha256) fail('r2_checksum_failed')
  const manifest = parseJsonObject(manifestBody)
  if (
    !hasExactObjectKeys(manifest, [
      'schemaVersion', 'snapshotId', 'environment', 'createdAt', 'source',
      'objectCount', 'referencedObjectCount', 'orphanCount', 'totalBytes',
      'uploadedBodyCount', 'reusedBodyCount', 'objects',
    ])
    || manifest.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
    || manifest.snapshotId !== snapshotId
    || manifest.environment !== config.environment
    || !isCanonicalTimestamp(manifest.createdAt)
    || Date.parse(manifest.createdAt) > Date.parse(complete.completedAt as string)
    || Date.parse(complete.completedAt as string) - Date.parse(manifest.createdAt) > dependencies.limits.maxRunDurationMs
    || Date.parse(complete.completedAt as string) > dependencies.now() + dependencies.limits.maxLockClockSkewMs
    || !isRecord(manifest.source)
    || !hasExactObjectKeys(manifest.source, ['supabaseProjectRef', 'storageBucket', 'pointerMode'])
    || manifest.source.supabaseProjectRef !== config.projectRef
    || manifest.source.storageBucket !== SOURCE_BUCKET
    || manifest.source.pointerMode !== config.pointerMode
    || !Array.isArray(manifest.objects)
  ) {
    fail('r2_verify_failed')
  }

  const parsed = manifest.objects.map(parsePreviousManifestObject)
  if (parsed.length > dependencies.limits.maxStorageObjects) fail('r2_verify_failed')
  const paths = new Set<string>()
  for (const object of parsed) {
    if (paths.has(object.sourcePath) || object.bytes > dependencies.limits.maxObjectBytes) {
      fail('r2_verify_failed')
    }
    paths.add(object.sourcePath)
  }
  const objectCount = parsed.length
  const orphanCount = parsed.filter((object) => object.classification === 'unreferenced').length
  const referencedObjectCount = objectCount - orphanCount
  const totalBytes = parsed.reduce((sum, object) => sum + object.bytes, 0)
  const uploadedBodyCount = manifest.uploadedBodyCount
  const reusedBodyCount = manifest.reusedBodyCount
  if (
    manifest.objectCount !== objectCount
    || manifest.referencedObjectCount !== referencedObjectCount
    || manifest.orphanCount !== orphanCount
    || manifest.totalBytes !== totalBytes
    || !Number.isSafeInteger(totalBytes)
    || totalBytes > dependencies.limits.maxTotalBytes
    || !Number.isSafeInteger(uploadedBodyCount)
    || (uploadedBodyCount as number) < 0
    || !Number.isSafeInteger(reusedBodyCount)
    || (reusedBodyCount as number) < 0
    || (uploadedBodyCount as number) + (reusedBodyCount as number) !== objectCount
    || complete.objectCount !== objectCount
    || complete.referencedObjectCount !== referencedObjectCount
    || complete.orphanCount !== orphanCount
    || complete.totalBytes !== totalBytes
    || complete.uploadedBodyCount !== uploadedBodyCount
    || complete.reusedBodyCount !== reusedBodyCount
  ) {
    fail('r2_verify_failed')
  }
  return {
    snapshotId,
    completedAt: complete.completedAt as string,
    manifestSha256: complete.manifestSha256,
    orphanCount,
    objects: parsed,
  }
}

async function readPreviousManifest(
  config: SourceConfig,
  dependencies: BackupDependencies,
): Promise<Map<string, BackedObject>> {
  const latestBody = await readR2Bytes(config, LATEST_KEY, dependencies.limits.maxJsonBytes, dependencies)
  if (latestBody === null) return new Map<string, BackedObject>()
  const latest = parseJsonObject(latestBody)
  if (
    !hasExactObjectKeys(latest, [
      'schemaVersion', 'snapshotId', 'environment', 'completeKey',
      'manifestSha256', 'completedAt', 'orphanCount',
    ])
    || (latest.schemaVersion !== LEGACY_SNAPSHOT_SCHEMA_VERSION
      && latest.schemaVersion !== SNAPSHOT_SCHEMA_VERSION)
    || !isSnapshotId(latest.snapshotId)
    || latest.environment !== config.environment
    || latest.completeKey !== `${SNAPSHOT_PREFIX}${latest.snapshotId}/complete.json`
    || !isSha256Hex(latest.manifestSha256)
    || !isCanonicalTimestamp(latest.completedAt)
    || !Number.isSafeInteger(latest.orphanCount)
    || (latest.orphanCount as number) < 0
  ) {
    fail('r2_verify_failed')
  }
  if (latest.schemaVersion === LEGACY_SNAPSHOT_SCHEMA_VERSION) return new Map<string, BackedObject>()

  const snapshot = await readVerifiedSnapshot(config, latest.snapshotId as string, dependencies)
  if (
    snapshot.completedAt !== latest.completedAt
    || snapshot.manifestSha256 !== latest.manifestSha256
    || snapshot.orphanCount !== latest.orphanCount
  ) {
    fail('r2_verify_failed')
  }
  return new Map(snapshot.objects.map((object) => [object.sourcePath, object]))
}

async function readR2Head(
  config: SourceConfig,
  key: string,
  dependencies: BackupDependencies,
): Promise<R2HeadLike | null> {
  try {
    consumeSubrequest(dependencies)
    return await config.r2.head(key)
  } catch {
    fail('r2_verify_failed')
  }
}

function contentHeadMatches(
  head: R2HeadLike | null,
  key: string,
  bytes: number,
  digestHex: string,
): boolean {
  return Boolean(
    head
    && head.key === key
    && head.size === bytes
    && normalizeEtag(head.etag)
    && equalBytes(head.checksums.sha256, sha256Bytes(digestHex)),
  )
}

function uploadedTime(value: unknown): number {
  if (!(value instanceof Date)) fail('r2_verify_failed')
  const time = value.getTime()
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value.toISOString()) {
    fail('r2_verify_failed')
  }
  return time
}

function r2ObjectFingerprint(objects: R2HeadLike[]): string {
  return JSON.stringify(objects.map((object) => ({
    key: object.key,
    size: object.size,
    etag: object.etag,
    uploadedAt: uploadedTime(object.uploaded),
    sha256: object.checksums.sha256
      ? bytesToHex(new Uint8Array(object.checksums.sha256))
      : null,
    customMetadata: object.customMetadata
      ? Object.fromEntries(Object.entries(object.customMetadata).sort(([left], [right]) => (
          left.localeCompare(right, 'en')
        )))
      : null,
  })))
}

async function listR2ObjectsOnce(
  config: SourceConfig,
  prefix: string,
  maximumPages: number,
  maximumObjects: number,
  includeCustomMetadata: boolean,
  dependencies: BackupDependencies,
): Promise<R2HeadLike[]> {
  const objects: R2HeadLike[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  let previousKey = ''

  for (let page = 0; page < maximumPages; page += 1) {
    let result: R2ListResultLike
    try {
      consumeSubrequest(dependencies)
      result = await config.r2.list({
        prefix,
        limit: dependencies.limits.r2ListPageSize,
        ...(cursor ? { cursor } : {}),
        ...(includeCustomMetadata ? { include: ['customMetadata'] } : {}),
      })
    } catch {
      fail('r2_verify_failed')
    }
    if (
      !isRecord(result)
      || !Array.isArray(result.objects)
      || result.objects.length > dependencies.limits.r2ListPageSize
      || !Array.isArray(result.delimitedPrefixes)
      || result.delimitedPrefixes.length !== 0
      || typeof result.truncated !== 'boolean'
    ) {
      fail('r2_verify_failed')
    }

    for (const object of result.objects) {
      if (
        !isRecord(object)
        || typeof object.key !== 'string'
        || !object.key.startsWith(prefix)
        || object.key.length <= prefix.length
        || object.key.length > 1_024
        || hasControlCharacters(object.key)
        || !Number.isSafeInteger(object.size)
        || object.size < 0
        || normalizeEtag(object.etag) !== object.etag
        || !isRecord(object.checksums)
        || (object.checksums.sha256 !== undefined && !(object.checksums.sha256 instanceof ArrayBuffer))
        || (includeCustomMetadata && !isRecord(object.customMetadata))
        || (previousKey !== '' && object.key.localeCompare(previousKey, 'en') <= 0)
      ) {
        fail('r2_verify_failed')
      }
      uploadedTime(object.uploaded)
      previousKey = object.key
      objects.push(object)
      if (objects.length > maximumObjects) fail('r2_verify_failed')
    }

    if (!result.truncated) return objects
    if (
      result.objects.length === 0
      || typeof result.cursor !== 'string'
      || result.cursor.length < 1
      || result.cursor.length > 2_048
      || hasControlCharacters(result.cursor)
      || cursors.has(result.cursor)
    ) {
      fail('r2_verify_failed')
    }
    cursors.add(result.cursor)
    cursor = result.cursor
  }
  fail('r2_verify_failed')
}

async function listStableR2Objects(
  config: SourceConfig,
  prefix: string,
  maximumPages: number,
  maximumObjects: number,
  includeCustomMetadata: boolean,
  dependencies: BackupDependencies,
): Promise<R2HeadLike[]> {
  const first = await listR2ObjectsOnce(
    config,
    prefix,
    maximumPages,
    maximumObjects,
    includeCustomMetadata,
    dependencies,
  )
  const second = await listR2ObjectsOnce(
    config,
    prefix,
    maximumPages,
    maximumObjects,
    includeCustomMetadata,
    dependencies,
  )
  if (r2ObjectFingerprint(first) !== r2ObjectFingerprint(second)) fail('r2_verify_failed')
  return first
}

interface SnapshotDocuments {
  manifest?: R2HeadLike
  manifestHash?: R2HeadLike
  complete?: R2HeadLike
  legacyPayloads?: R2HeadLike[]
}

function legacySnapshotPayloadId(object: R2HeadLike): string | null {
  // v1 wrote referenced photos and quarantined orphans under distinct prefixes.
  // Both remain part of its verified manifest; neither is a v2 GC target.
  const match = /^snapshots\/([a-z0-9-]{8,128})\/(?:objects|quarantine\/unreferenced)\/(.+)$/.exec(object.key)
  if (!match) return null
  if (!isSnapshotId(match[1]) || object.size <= 0) fail('r2_verify_failed')
  return match[1]
}

function snapshotDocumentGroups(objects: R2HeadLike[]): Map<string, SnapshotDocuments> {
  const groups = new Map<string, SnapshotDocuments>()
  for (const object of objects) {
    const match = /^snapshots\/([a-z0-9-]{8,128})\/(manifest\.json|manifest\.sha256|complete\.json)$/.exec(object.key)
    if (!match) {
      // The first backup format stored copied photo bodies below each snapshot.
      // They are retained for rollback, but they are not v2 restore documents and
      // must never become content-GC references or deletion candidates.
      const legacySnapshotId = legacySnapshotPayloadId(object)
      if (legacySnapshotId) {
        const group = groups.get(legacySnapshotId) ?? {}
        group.legacyPayloads = [...(group.legacyPayloads ?? []), object]
        groups.set(legacySnapshotId, group)
        continue
      }
      fail('r2_verify_failed')
    }
    if (!isSnapshotId(match[1]) || object.size <= 0) fail('r2_verify_failed')
    const snapshotId = match[1]
    const document = match[2]
    const group = groups.get(snapshotId) ?? {}
    const field = document === 'manifest.json'
      ? 'manifest'
      : document === 'manifest.sha256'
        ? 'manifestHash'
        : 'complete'
    if (group[field]) fail('r2_verify_failed')
    group[field] = object
    groups.set(snapshotId, group)
  }
  return groups
}

async function verifyLegacySnapshotForContentGc(
  config: SourceConfig,
  snapshotId: string,
  group: SnapshotDocuments,
  dependencies: BackupDependencies,
): Promise<string> {
  if (!group.manifest || !group.manifestHash || !group.complete || !group.legacyPayloads?.length) {
    fail('r2_verify_failed')
  }

  const completeKey = `${SNAPSHOT_PREFIX}${snapshotId}/complete.json`
  const manifestKey = `${SNAPSHOT_PREFIX}${snapshotId}/manifest.json`
  const manifestHashKey = `${SNAPSHOT_PREFIX}${snapshotId}/manifest.sha256`
  const completeBody = await readR2Bytes(
    config,
    completeKey,
    dependencies.limits.maxJsonBytes,
    dependencies,
  )
  const manifestBody = await readR2Bytes(
    config,
    manifestKey,
    dependencies.limits.maxJsonBytes,
    dependencies,
  )
  const manifestHashBody = await readR2Bytes(config, manifestHashKey, 128, dependencies)
  if (completeBody === null || manifestBody === null || manifestHashBody === null) {
    fail('r2_verify_failed')
  }

  const complete = parseJsonObject(completeBody)
  const manifest = parseJsonObject(manifestBody)
  const manifestDigest = await sha256(manifestBody)
  if (
    !hasExactObjectKeys(complete, [
      'schemaVersion', 'snapshotId', 'environment', 'completedAt', 'manifestKey',
      'manifestSha256', 'objectCount', 'referencedObjectCount', 'orphanCount', 'totalBytes',
    ])
    || complete.schemaVersion !== LEGACY_SNAPSHOT_SCHEMA_VERSION
    || complete.snapshotId !== snapshotId
    || complete.environment !== config.environment
    || !isCanonicalTimestamp(complete.completedAt)
    || complete.manifestKey !== manifestKey
    || !isSha256Hex(complete.manifestSha256)
    || manifestDigest.hex !== complete.manifestSha256
    || new TextDecoder().decode(manifestHashBody) !== `${complete.manifestSha256}\n`
  ) {
    fail('r2_verify_failed')
  }

  if (
    !hasExactObjectKeys(manifest, [
      'schemaVersion', 'snapshotId', 'environment', 'createdAt', 'source',
      'objectCount', 'referencedObjectCount', 'orphanCount', 'totalBytes', 'objects',
    ])
    || manifest.schemaVersion !== LEGACY_SNAPSHOT_SCHEMA_VERSION
    || manifest.snapshotId !== snapshotId
    || manifest.environment !== config.environment
    || !isCanonicalTimestamp(manifest.createdAt)
    || Date.parse(manifest.createdAt) > Date.parse(complete.completedAt as string)
    || Date.parse(complete.completedAt as string) - Date.parse(manifest.createdAt)
      > dependencies.limits.maxRunDurationMs
    || Date.parse(complete.completedAt as string)
      > dependencies.now() + dependencies.limits.maxLockClockSkewMs
    || !isRecord(manifest.source)
    || !hasExactObjectKeys(manifest.source, ['supabaseProjectRef', 'storageBucket', 'pointerMode'])
    || manifest.source.supabaseProjectRef !== config.projectRef
    || manifest.source.storageBucket !== SOURCE_BUCKET
    || manifest.source.pointerMode !== config.pointerMode
    || !Array.isArray(manifest.objects)
    || manifest.objects.length > dependencies.limits.maxStorageObjects
  ) {
    fail('r2_verify_failed')
  }

  const payloads = new Map<string, R2HeadLike>()
  for (const payload of group.legacyPayloads) {
    if (payloads.has(payload.key)) fail('r2_verify_failed')
    payloads.set(payload.key, payload)
  }
  const sourcePaths = new Set<string>()
  const backupKeys = new Set<string>()
  let referencedObjectCount = 0
  let orphanCount = 0
  let totalBytes = 0
  for (const value of manifest.objects) {
    if (!isRecord(value)) fail('r2_verify_failed')
    const classification = value.classification
    const referenced = classification === 'referenced'
    const expectedKeys = referenced
      ? ['sourcePath', 'backupKey', 'bytes', 'sha256', 'classification', 'ownerScope', 'contentType']
      : ['sourcePath', 'backupKey', 'bytes', 'sha256', 'classification', 'contentType']
    if (
      !hasExactObjectKeys(value, expectedKeys)
      || (classification !== 'referenced' && classification !== 'unreferenced')
      || !isStoredSourcePath(value.sourcePath)
      || !isStoredSourcePath(value.backupKey)
      || !isSha256Hex(value.sha256)
      || !Number.isSafeInteger(value.bytes)
      || (value.bytes as number) <= 0
      || (value.bytes as number) > dependencies.limits.maxObjectBytes
      || typeof value.contentType !== 'string'
      || value.contentType.length < 1
      || value.contentType.length > 255
      || hasControlCharacters(value.contentType)
      || (referenced && value.ownerScope !== 'lab' && value.ownerScope !== 'user')
    ) {
      fail('r2_verify_failed')
    }
    const expectedPrefix = referenced ? 'objects' : 'quarantine/unreferenced'
    const expectedBackupKey = `${SNAPSHOT_PREFIX}${snapshotId}/${expectedPrefix}/${value.sourcePath}`
    if (
      value.backupKey !== expectedBackupKey
      || sourcePaths.has(value.sourcePath)
      || backupKeys.has(value.backupKey)
    ) {
      fail('r2_verify_failed')
    }
    const payload = payloads.get(value.backupKey)
    if (
      !payload
      || payload.size !== value.bytes
      || !equalBytes(payload.checksums.sha256, sha256Bytes(value.sha256))
    ) {
      fail('r2_checksum_failed')
    }
    sourcePaths.add(value.sourcePath)
    backupKeys.add(value.backupKey)
    totalBytes += value.bytes as number
    if (!Number.isSafeInteger(totalBytes) || totalBytes > dependencies.limits.maxTotalBytes) {
      fail('r2_verify_failed')
    }
    if (referenced) referencedObjectCount += 1
    else orphanCount += 1
  }

  if (
    payloads.size !== manifest.objects.length
    || manifest.objectCount !== manifest.objects.length
    || manifest.referencedObjectCount !== referencedObjectCount
    || manifest.orphanCount !== orphanCount
    || manifest.totalBytes !== totalBytes
    || complete.objectCount !== manifest.objectCount
    || complete.referencedObjectCount !== referencedObjectCount
    || complete.orphanCount !== orphanCount
    || complete.totalBytes !== totalBytes
  ) {
    fail('r2_verify_failed')
  }
  return complete.completedAt as string
}

async function collectRecentSnapshotReferences(
  config: SourceConfig,
  currentSnapshotId: string,
  dependencies: BackupDependencies,
): Promise<{ referencedKeys: Set<string>; recentSnapshotIds: Set<string> }> {
  const listed = await listStableR2Objects(
    config,
    SNAPSHOT_PREFIX,
    dependencies.limits.maxSnapshotListPages,
    dependencies.limits.maxSnapshotDocuments,
    false,
    dependencies,
  )
  const groups = snapshotDocumentGroups(listed)
  const now = dependencies.now()
  const referenceCutoff = now - (dependencies.limits.gcReferenceWindowDays * DAY_MS)
  const referencedKeys = new Set<string>()
  const recentSnapshotIds = new Set<string>()
  const recentGroups = [...groups.entries()]
    .filter(([, group]) => {
      if (!group.complete) return false
      const completeUploadedAt = uploadedTime(group.complete.uploaded)
      if (completeUploadedAt > now + dependencies.limits.maxLockClockSkewMs) fail('r2_verify_failed')
      return completeUploadedAt >= referenceCutoff
    })
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
  if (
    recentGroups.length < 1
    || recentGroups.length > dependencies.limits.maxRecentSnapshots
    || !recentGroups.some(([snapshotId]) => snapshotId === currentSnapshotId)
  ) {
    fail('r2_verify_failed')
  }

  for (const [snapshotId, group] of recentGroups) {
    if (!group.manifest || !group.manifestHash || !group.complete) fail('r2_verify_failed')
    const manifestUploadedAt = uploadedTime(group.manifest.uploaded)
    const hashUploadedAt = uploadedTime(group.manifestHash.uploaded)
    const completeUploadedAt = uploadedTime(group.complete.uploaded)
    if (manifestUploadedAt > hashUploadedAt || hashUploadedAt > completeUploadedAt) {
      fail('r2_verify_failed')
    }
    if (group.legacyPayloads?.length) {
      const completedAt = await verifyLegacySnapshotForContentGc(
        config,
        snapshotId,
        group,
        dependencies,
      )
      if (
        Math.abs(Date.parse(completedAt) - completeUploadedAt)
          > dependencies.limits.maxRunDurationMs + dependencies.limits.maxLockClockSkewMs
      ) {
        fail('r2_verify_failed')
      }
      continue
    }
    const snapshot = await readVerifiedSnapshot(config, snapshotId, dependencies)
    if (
      Math.abs(Date.parse(snapshot.completedAt) - completeUploadedAt)
        > dependencies.limits.maxRunDurationMs + dependencies.limits.maxLockClockSkewMs
    ) {
      fail('r2_verify_failed')
    }
    recentSnapshotIds.add(snapshotId)
    for (const object of snapshot.objects) referencedKeys.add(object.backupKey)
  }
  return { referencedKeys, recentSnapshotIds }
}

function contentDigestFromKey(key: string): string {
  const match = /^objects\/sha256\/([0-9a-f]{2})\/([0-9a-f]{64})$/.exec(key)
  if (!match || match[1] !== match[2].slice(0, 2)) fail('r2_verify_failed')
  return match[2]
}

function validateContentObject(
  object: R2HeadLike,
  now: number,
  dependencies: BackupDependencies,
): void {
  const digestHex = contentDigestFromKey(object.key)
  if (
    object.size <= 0
    || object.size > dependencies.limits.maxObjectBytes
    || uploadedTime(object.uploaded) > now + dependencies.limits.maxLockClockSkewMs
    || !equalBytes(object.checksums.sha256, sha256Bytes(digestHex))
    || !isRecord(object.customMetadata)
    || !hasExactObjectKeys(object.customMetadata, ['content-sha256'])
    || object.customMetadata['content-sha256'] !== digestHex
  ) {
    fail('r2_verify_failed')
  }
}

function contentIdentityMatches(left: R2HeadLike, right: R2HeadLike): boolean {
  const digestHex = contentDigestFromKey(left.key)
  return left.key === right.key
    && left.size === right.size
    && left.etag === right.etag
    && uploadedTime(left.uploaded) === uploadedTime(right.uploaded)
    && equalBytes(right.checksums.sha256, sha256Bytes(digestHex))
    && isRecord(right.customMetadata)
    && hasExactObjectKeys(right.customMetadata, ['content-sha256'])
    && right.customMetadata['content-sha256'] === digestHex
}

function parseContentGcCandidate(
  value: unknown,
  state: Pick<ContentGcState, 'updatedAt' | 'lastSnapshotId'>,
  dependencies: BackupDependencies,
): ContentGcCandidate {
  if (!isRecord(value) || !hasExactObjectKeys(value, [
    'backupKey', 'etag', 'bytes', 'uploadedAt', 'firstConfirmedAt', 'lastConfirmedAt',
    'firstSnapshotId', 'lastSnapshotId',
  ])) {
    fail('r2_verify_failed')
  }
  const backupKey = typeof value.backupKey === 'string' ? value.backupKey : ''
  contentDigestFromKey(backupKey)
  if (
    typeof value.etag !== 'string'
    || normalizeEtag(value.etag) !== value.etag
    || !Number.isSafeInteger(value.bytes)
    || (value.bytes as number) <= 0
    || (value.bytes as number) > dependencies.limits.maxObjectBytes
    || !isCanonicalTimestamp(value.uploadedAt)
    || !isCanonicalTimestamp(value.firstConfirmedAt)
    || !isCanonicalTimestamp(value.lastConfirmedAt)
    || !isSnapshotId(value.firstSnapshotId)
    || value.lastSnapshotId !== state.lastSnapshotId
    || value.lastConfirmedAt !== state.updatedAt
    || Date.parse(value.firstConfirmedAt) > Date.parse(value.lastConfirmedAt)
    || Date.parse(value.firstConfirmedAt) - Date.parse(value.uploadedAt)
      < dependencies.limits.gcMinimumUnreferencedAgeDays * DAY_MS
  ) {
    fail('r2_verify_failed')
  }
  return {
    backupKey,
    etag: value.etag,
    bytes: value.bytes as number,
    uploadedAt: value.uploadedAt,
    firstConfirmedAt: value.firstConfirmedAt,
    lastConfirmedAt: value.lastConfirmedAt,
    firstSnapshotId: value.firstSnapshotId,
    lastSnapshotId: value.lastSnapshotId as string,
  }
}

function parseContentGcState(
  body: Uint8Array,
  object: R2GetLike,
  config: SourceConfig,
  dependencies: BackupDependencies,
): ContentGcState {
  const value = parseJsonObject(body)
  if (
    !hasExactObjectKeys(value, [
      'schemaVersion', 'environment', 'updatedAt', 'lastSnapshotId',
      'scannedBodyCount', 'protectedBodyCount', 'candidateCount',
      'deletedBodyCount', 'candidates',
    ])
    || value.schemaVersion !== CONTENT_GC_SCHEMA_VERSION
    || value.environment !== config.environment
    || !isCanonicalTimestamp(value.updatedAt)
    || !isSnapshotId(value.lastSnapshotId)
    || !Number.isSafeInteger(value.scannedBodyCount)
    || (value.scannedBodyCount as number) < 0
    || (value.scannedBodyCount as number) > dependencies.limits.maxContentBodies
    || !Number.isSafeInteger(value.protectedBodyCount)
    || (value.protectedBodyCount as number) < 0
    || (value.protectedBodyCount as number) > (value.scannedBodyCount as number)
    || !Number.isSafeInteger(value.candidateCount)
    || (value.candidateCount as number) < 0
    || (value.candidateCount as number) > dependencies.limits.maxGcCandidates
    || !Number.isSafeInteger(value.deletedBodyCount)
    || (value.deletedBodyCount as number) < 0
    || (value.deletedBodyCount as number) > dependencies.limits.maxGcDeletesPerRun
    || !Array.isArray(value.candidates)
    || value.candidates.length !== value.candidateCount
    || value.candidates.length > dependencies.limits.maxGcCandidates
    || uploadedTime(object.uploaded) > dependencies.now() + dependencies.limits.maxLockClockSkewMs
    || Math.abs(uploadedTime(object.uploaded) - Date.parse(value.updatedAt))
      > dependencies.limits.maxRunDurationMs + dependencies.limits.maxLockClockSkewMs
    || !isRecord(object.customMetadata)
    || !hasExactObjectKeys(object.customMetadata, ['gc-state'])
    || object.customMetadata['gc-state'] !== 'content-reference-v1'
  ) {
    fail('r2_verify_failed')
  }
  const state = {
    schemaVersion: CONTENT_GC_SCHEMA_VERSION,
    environment: config.environment,
    updatedAt: value.updatedAt,
    lastSnapshotId: value.lastSnapshotId,
    scannedBodyCount: value.scannedBodyCount as number,
    protectedBodyCount: value.protectedBodyCount as number,
    candidateCount: value.candidateCount as number,
    deletedBodyCount: value.deletedBodyCount as number,
    candidates: [] as ContentGcCandidate[],
  } satisfies ContentGcState
  const keys = new Set<string>()
  for (const candidate of value.candidates) {
    const parsed = parseContentGcCandidate(candidate, state, dependencies)
    if (keys.has(parsed.backupKey)) fail('r2_verify_failed')
    keys.add(parsed.backupKey)
    state.candidates.push(parsed)
  }
  return state
}

function candidateFromObject(
  object: R2HeadLike,
  snapshotId: string,
  confirmedAt: string,
): ContentGcCandidate {
  return {
    backupKey: object.key,
    etag: object.etag,
    bytes: object.size,
    uploadedAt: object.uploaded.toISOString(),
    firstConfirmedAt: confirmedAt,
    lastConfirmedAt: confirmedAt,
    firstSnapshotId: snapshotId,
    lastSnapshotId: snapshotId,
  }
}

function candidateMatchesObject(candidate: ContentGcCandidate, object: R2HeadLike): boolean {
  return candidate.backupKey === object.key
    && candidate.etag === object.etag
    && candidate.bytes === object.size
    && candidate.uploadedAt === object.uploaded.toISOString()
}

async function deleteConfirmedContentBody(
  config: SourceConfig,
  lease: LockLease,
  listed: R2HeadLike,
  dependencies: BackupDependencies,
): Promise<void> {
  const current = await readR2Head(config, listed.key, dependencies)
  if (!current || !contentIdentityMatches(listed, current)) fail('r2_verify_failed')
  await verifyLock(config, lease, dependencies)
  await requireStorageBackupEnabled(config, dependencies)
  try {
    consumeSubrequest(dependencies)
    await config.r2.delete(listed.key)
    consumeSubrequest(dependencies)
    if (await config.r2.head(listed.key)) fail('content_gc_delete_failed')
  } catch (error) {
    if (error instanceof BackupFailure) throw error
    fail('content_gc_delete_failed')
  }
}

async function collectContentGarbage(
  config: SourceConfig,
  lease: LockLease,
  currentSnapshotId: string,
  dependencies: BackupDependencies,
): Promise<void> {
  const now = dependencies.now()
  const confirmedAt = new Date(now).toISOString()
  const { referencedKeys, recentSnapshotIds } = await collectRecentSnapshotReferences(
    config,
    currentSnapshotId,
    dependencies,
  )
  const contentObjects = await listStableR2Objects(
    config,
    CONTENT_PREFIX,
    dependencies.limits.maxContentListPages,
    dependencies.limits.maxContentBodies,
    true,
    dependencies,
  )
  const contentByKey = new Map<string, R2HeadLike>()
  for (const object of contentObjects) {
    validateContentObject(object, now, dependencies)
    contentByKey.set(object.key, object)
  }
  for (const referencedKey of referencedKeys) {
    if (!contentByKey.has(referencedKey)) fail('r2_verify_failed')
  }

  const stateDocument = await readR2Document(
    config,
    CONTENT_GC_STATE_KEY,
    dependencies.limits.maxJsonBytes,
    dependencies,
  )
  const previousState = stateDocument
    ? parseContentGcState(stateDocument.body, stateDocument.object, config, dependencies)
    : null
  const stateIsFresh = previousState !== null
    && now >= Date.parse(previousState.updatedAt) - dependencies.limits.maxLockClockSkewMs
    && now - Date.parse(previousState.updatedAt)
      <= dependencies.limits.gcConfirmationMaxGapDays * DAY_MS
  if (stateIsFresh && !recentSnapshotIds.has(previousState.lastSnapshotId)) {
    fail('r2_verify_failed')
  }

  const carried = new Map<string, ContentGcCandidate>()
  if (stateIsFresh && previousState) {
    for (const candidate of previousState.candidates) {
      const content = contentByKey.get(candidate.backupKey)
      if (
        !content
        || referencedKeys.has(candidate.backupKey)
        || !candidateMatchesObject(candidate, content)
      ) {
        continue
      }
      carried.set(candidate.backupKey, {
        ...candidate,
        lastConfirmedAt: confirmedAt,
        lastSnapshotId: currentSnapshotId,
      })
    }
  }

  const deletionCandidates = [...carried.values()]
    .sort((left, right) => (
      left.firstConfirmedAt.localeCompare(right.firstConfirmedAt, 'en')
      || left.backupKey.localeCompare(right.backupKey, 'en')
    ))
    .slice(0, dependencies.limits.maxGcDeletesPerRun)
  const deleted = new Set<string>()
  for (const candidate of deletionCandidates) {
    const content = contentByKey.get(candidate.backupKey)
    if (!content) fail('r2_verify_failed')
    await deleteConfirmedContentBody(config, lease, content, dependencies)
    deleted.add(candidate.backupKey)
    carried.delete(candidate.backupKey)
  }

  const minimumAgeMs = dependencies.limits.gcMinimumUnreferencedAgeDays * DAY_MS
  for (const content of contentObjects) {
    if (carried.size >= dependencies.limits.maxGcCandidates) break
    if (
      deleted.has(content.key)
      || referencedKeys.has(content.key)
      || carried.has(content.key)
      || now - uploadedTime(content.uploaded) < minimumAgeMs
    ) {
      continue
    }
    carried.set(content.key, candidateFromObject(content, currentSnapshotId, confirmedAt))
  }

  const candidates = [...carried.values()].sort((left, right) => (
    left.backupKey.localeCompare(right.backupKey, 'en')
  ))
  const state = {
    schemaVersion: CONTENT_GC_SCHEMA_VERSION,
    environment: config.environment,
    updatedAt: confirmedAt,
    lastSnapshotId: currentSnapshotId,
    scannedBodyCount: contentObjects.length,
    protectedBodyCount: contentObjects.filter((object) => referencedKeys.has(object.key)).length,
    candidateCount: candidates.length,
    deletedBodyCount: deleted.size,
    candidates,
  } satisfies ContentGcState
  await verifyLock(config, lease, dependencies)
  await requireStorageBackupEnabled(config, dependencies)
  await putVerified(
    config.r2,
    CONTENT_GC_STATE_KEY,
    jsonDocument(state),
    dependencies,
    stateDocument ? { etagMatches: stateDocument.object.etag } : { etagDoesNotMatch: '*' },
    {
      customMetadata: { 'gc-state': 'content-reference-v1' },
      httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
    },
  )
}

async function ensureContentBody(
  config: SourceConfig,
  body: Uint8Array,
  digest: { bytes: ArrayBuffer; hex: string },
  contentType: string,
  dependencies: BackupDependencies,
  inspectedHead?: R2HeadLike | null,
): Promise<{ backupKey: string; uploaded: boolean }> {
  const backupKey = contentAddressKey(digest.hex)
  const existing = inspectedHead === undefined
    ? await readR2Head(config, backupKey, dependencies)
    : inspectedHead
  if (contentHeadMatches(existing, backupKey, body.byteLength, digest.hex)) {
    return { backupKey, uploaded: false }
  }
  if (existing && !normalizeEtag(existing.etag)) fail('r2_verify_failed')

  await requireStorageBackupEnabled(config, dependencies)
  await putVerified(
    config.r2,
    backupKey,
    body,
    dependencies,
    existing ? { etagMatches: existing.etag } : { etagDoesNotMatch: '*' },
    {
      customMetadata: { 'content-sha256': digest.hex },
      httpMetadata: { contentType, cacheControl: 'no-store' },
    },
  )
  return { backupKey, uploaded: true }
}

async function updateLatest(
  config: SourceConfig,
  body: Uint8Array,
  dependencies: BackupDependencies,
): Promise<void> {
  let existing: R2HeadLike | null
  try {
    consumeSubrequest(dependencies)
    existing = await config.r2.head(LATEST_KEY)
  } catch {
    fail('r2_verify_failed')
  }
  await putVerified(
    config.r2,
    LATEST_KEY,
    body,
    dependencies,
    existing ? { etagMatches: existing.etag } : { etagDoesNotMatch: '*' },
    { httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' } },
  )
}

async function executeBackup(
  config: SourceConfig,
  lease: LockLease,
  dependencies: BackupDependencies,
): Promise<{ count: number; bytes: number; orphanCount: number }> {
  const pointers = await listCabinetPointers(config, dependencies)
  const firstStorageList = await listStorageObjects(config, dependencies)
  const secondStorageList = await listStorageObjects(config, dependencies)
  if (storageFingerprint(firstStorageList) !== storageFingerprint(secondStorageList)) fail('source_drift')
  const plan = buildBackupPlan(pointers, firstStorageList, dependencies.limits)

  const totalListedBytes = plan.reduce((sum, entry) => sum + entry.object.size, 0)
  if (!Number.isSafeInteger(totalListedBytes) || totalListedBytes > dependencies.limits.maxTotalBytes) {
    fail('source_limit_exceeded')
  }

  const runId = createRunId(dependencies)
  const prefix = `snapshots/${runId}`
  const previousObjects = await readPreviousManifest(config, dependencies)
  const backedObjects: BackedObject[] = []
  let uploadedBodyCount = 0

  for (const entry of plan) {
    const previous = previousObjects.get(entry.object.path)
    let backupKey = ''
    let digestHex = ''
    let contentType = ''
    let uploaded = false

    if (
      previous
      && previous.etag === entry.object.etag
      && previous.bytes === entry.object.size
    ) {
      const previousHead = await readR2Head(config, previous.backupKey, dependencies)
      if (contentHeadMatches(
        previousHead,
        previous.backupKey,
        previous.bytes,
        previous.sha256,
      )) {
        backupKey = previous.backupKey
        digestHex = previous.sha256
        contentType = previous.contentType
      } else {
        const downloaded = await downloadObject(entry.object, config, dependencies)
        const digest = await sha256(downloaded.body)
        const stored = await ensureContentBody(
          config,
          downloaded.body,
          digest,
          downloaded.contentType,
          dependencies,
          contentAddressKey(digest.hex) === previous.backupKey ? previousHead : undefined,
        )
        backupKey = stored.backupKey
        digestHex = digest.hex
        contentType = downloaded.contentType
        uploaded = stored.uploaded
      }
    } else {
      const downloaded = await downloadObject(entry.object, config, dependencies)
      const digest = await sha256(downloaded.body)
      const stored = await ensureContentBody(
        config,
        downloaded.body,
        digest,
        downloaded.contentType,
        dependencies,
      )
      backupKey = stored.backupKey
      digestHex = digest.hex
      contentType = downloaded.contentType
      uploaded = stored.uploaded
    }
    if (uploaded) uploadedBodyCount += 1

    backedObjects.push({
      sourcePath: entry.object.path,
      backupKey,
      etag: entry.object.etag,
      bytes: entry.object.size,
      sha256: digestHex,
      classification: entry.classification,
      ownerScope: entry.ownerScope,
      contentType,
    })
  }

  const totalBytes = backedObjects.reduce((sum, object) => sum + object.bytes, 0)
  const orphanCount = backedObjects.filter((object) => object.classification === 'unreferenced').length
  const referencedObjectCount = backedObjects.length - orphanCount
  const reusedBodyCount = backedObjects.length - uploadedBodyCount
  const createdAt = new Date(dependencies.now()).toISOString()
  const manifest = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshotId: runId,
    environment: config.environment,
    createdAt,
    source: {
      supabaseProjectRef: config.projectRef,
      storageBucket: SOURCE_BUCKET,
      pointerMode: config.pointerMode,
    },
    objectCount: backedObjects.length,
    referencedObjectCount,
    orphanCount,
    totalBytes,
    uploadedBodyCount,
    reusedBodyCount,
    objects: backedObjects,
  }
  const manifestBody = jsonDocument(manifest)
  const manifestDigest = await sha256(manifestBody)
  const manifestKey = `${prefix}/manifest.json`
  const manifestHashKey = `${prefix}/manifest.sha256`
  const completeKey = `${prefix}/complete.json`

  await requireStorageBackupEnabled(config, dependencies)
  await putNewVerified(config.r2, manifestKey, manifestBody, dependencies, {
    httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
  })
  await requireStorageBackupEnabled(config, dependencies)
  await putNewVerified(config.r2, manifestHashKey, textBytes(`${manifestDigest.hex}\n`), dependencies, {
    httpMetadata: { contentType: 'text/plain; charset=utf-8', cacheControl: 'no-store' },
  })

  const finalPointers = await listCabinetPointers(config, dependencies)
  const finalStorageList = await listStorageObjects(config, dependencies)
  if (
    pointerFingerprint(pointers) !== pointerFingerprint(finalPointers)
    || storageFingerprint(firstStorageList) !== storageFingerprint(finalStorageList)
  ) {
    fail('source_drift')
  }

  for (const object of backedObjects) {
    const bodyDigest = new Uint8Array(object.sha256.match(/.{2}/g)?.map((value) => Number.parseInt(value, 16)) ?? [])
    let head: R2HeadLike | null
    try {
      consumeSubrequest(dependencies)
      head = await config.r2.head(object.backupKey)
    } catch {
      fail('r2_verify_failed')
    }
    if (
      !head
      || head.size !== object.bytes
      || !equalBytes(head.checksums.sha256, bodyDigest.buffer)
    ) {
      fail('r2_checksum_failed')
    }
  }

  await verifyLock(config, lease, dependencies)
  await requireStorageBackupEnabled(config, dependencies)

  const completedAt = new Date(dependencies.now()).toISOString()
  const completion = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshotId: runId,
    environment: config.environment,
    completedAt,
    manifestKey,
    manifestSha256: manifestDigest.hex,
    objectCount: backedObjects.length,
    referencedObjectCount,
    orphanCount,
    totalBytes,
    uploadedBodyCount,
    reusedBodyCount,
  }
  const completeBody = jsonDocument(completion)
  await putNewVerified(config.r2, completeKey, completeBody, dependencies, {
    httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
  })
  await collectContentGarbage(config, lease, runId, dependencies)
  await requireStorageBackupEnabled(config, dependencies)
  await updateLatest(config, jsonDocument({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshotId: runId,
    environment: config.environment,
    completeKey,
    manifestSha256: manifestDigest.hex,
    completedAt,
    orphanCount,
  }), dependencies)

  return { count: backedObjects.length, bytes: totalBytes, orphanCount }
}

function failureCode(error: unknown): BackupCode {
  return error instanceof BackupFailure ? error.code : 'unexpected_failure'
}

function resolveSafeSourceRedirect(
  sourceUrl: string,
  method: string | undefined,
  response: Response,
): string {
  const normalizedMethod = (method ?? 'GET').toUpperCase()
  const statusAllowsMethod = response.status === 307
    || response.status === 308
    || ((response.status === 301 || response.status === 302)
      && (normalizedMethod === 'GET' || normalizedMethod === 'HEAD'))
  if (!statusAllowsMethod) {
    fail('source_request_failed', 'redirect_status_rejected')
  }

  const location = response.headers.get('location')
  if (!location || hasControlCharacters(location)) {
    fail('source_request_failed', 'redirect_invalid_location')
  }

  let source: URL
  let destination: URL
  try {
    source = new URL(sourceUrl)
    destination = new URL(location, source)
  } catch {
    fail('source_request_failed', 'redirect_invalid_location')
  }

  if (
    source.protocol !== 'https:'
    || destination.protocol !== 'https:'
    || destination.origin !== source.origin
    || destination.username !== ''
    || destination.password !== ''
  ) {
    fail('source_request_failed', 'redirect_cross_origin')
  }
  const normalizePath = (pathname: string) => pathname.length > 1
    ? pathname.replace(/\/+$/, '')
    : pathname
  if (normalizePath(destination.pathname) !== normalizePath(source.pathname)) {
    fail('source_request_failed', 'redirect_path_rejected')
  }
  destination.hash = ''
  return destination.toString()
}

function failureDiagnosticCode(error: unknown): FetchDiagnosticCode | undefined {
  return error instanceof BackupFailure ? error.diagnosticCode : undefined
}

export async function runScheduledBackup(
  bindings: StorageBackupBindings,
  overrides: BackupDependencyOverrides = {},
): Promise<BackupRunResult> {
  const dependencies = createDefaultDependencies(overrides)
  const startedAt = dependencies.now()
  let config: SourceConfig
  let enabled: boolean

  try {
    config = resolveSourceConfig(bindings, dependencies.limits)
    startRunGuard(dependencies, startedAt)
    enabled = await readStorageBackupEnabled(config, dependencies)
  } catch (error) {
    return emitRunResult(
      dependencies,
      createRunResult(dependencies, 'failed', failureCode(error), startedAt),
    )
  }

  if (!enabled) {
    return emitRunResult(
      dependencies,
      createRunResult(dependencies, 'disabled', 'backup_disabled', startedAt),
    )
  }


  if (config.workersUsagePlan !== 'paid') {
    return emitRunResult(
      dependencies,
      createRunResult(dependencies, 'failed', 'workers_paid_plan_required', startedAt),
    )
  }

  let lease: LockLease | null = null
  let result: BackupRunResult
  try {
    const acquisition = await acquireLock(config, dependencies)
    lease = acquisition.lease
    if (!lease) {
      return emitRunResult(
        dependencies,
        createRunResult(
          dependencies,
          'skipped',
          acquisition.skipCode ?? 'backup_locked',
          startedAt,
        ),
      )
    }
    const completed = await executeBackup(config, lease, dependencies)
    result = createRunResult(
      dependencies,
      'completed',
      completed.orphanCount > 0 ? 'backup_completed_with_quarantine' : 'backup_completed',
      startedAt,
      completed.count,
      completed.bytes,
      completed.orphanCount,
    )
  } catch (error) {
    result = createRunResult(
      dependencies,
      'failed',
      failureCode(error),
      startedAt,
      0,
      0,
      0,
      failureDiagnosticCode(error),
    )
  }

  if (lease) {
    try {
      await releaseLock(config, lease, dependencies)
    } catch {
      if (result.status === 'completed') {
        result = createRunResult(
          dependencies,
          'failed',
          'lock_release_failed',
          startedAt,
          result.count,
          result.bytes,
          result.orphanCount,
        )
      }
    }
  }
  return emitRunResult(dependencies, result)
}
