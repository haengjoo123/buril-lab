import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { RELEASE_ENVIRONMENTS } from './write-release-manifest.mjs'

const execFile = promisify(execFileCallback)

export const RECOVERY_PREFLIGHT_SCHEMA_VERSION = 3
export const REQUIRED_SUPABASE_CLI_VERSION = '2.115.0'
export const REQUIRED_POSTGRES_TOOL_VERSION = '17.11.0'
export const REQUIRED_POSTGRES_ARCHIVE_SHA256 = '6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3'
export const MAX_PREFLIGHT_EVIDENCE_AGE_MS = 30 * 60 * 1000
export const MAX_R2_SNAPSHOT_AGE_MS = 26 * 60 * 60 * 1000
export const REQUIRED_ACTUAL_COMPUTE_CAP_USD = 1
export const REQUIRED_DELETE_WITHIN_HOURS = 24
export const RECOVERY_EXPECTATIONS = Object.freeze({
  sourceProjectRef: RELEASE_ENVIRONMENTS.production.supabaseProjectRef,
  stagingProjectRef: RELEASE_ENVIRONMENTS.staging.supabaseProjectRef,
  region: 'us-east-2',
  targetComputeVariant: 'ci_micro',
  targetComputeSize: 'MICRO',
  displayedMonthlyUsd: 10,
  microComputeHourlyUsd: 0.01344,
  monthlyBillingHours: 744,
})

const MAX_SMALL_EVIDENCE_BYTES = 64 * 1024
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024
const MAX_POSTGRES_ARCHIVE_BYTES = 1024 * 1024 * 1024
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SNAPSHOT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,127}$/
const CONFIRMATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/
const SENSITIVE_KEY_PATTERN = /(?:password|secret|token|credential|service.?role|api.?key|connection.?string|database.?url)/i
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const LOCAL_PROBE_ENVIRONMENT_NAMES = new Set([
  'appdata',
  'box',
  'boxsync',
  'comspec',
  'dropbox',
  'google_drive',
  'google_drive_fs',
  'googledrive',
  'googledrivefs',
  'homedrive',
  'homepath',
  'iclouddrive',
  'localappdata',
  'npm_config_cache',
  'onedrive',
  'onedrivecommercial',
  'onedriveconsumer',
  'path',
  'pathext',
  'programfiles',
  'programfiles(x86)',
  'systemroot',
  'temp',
  'tmp',
  'userprofile',
  'windir',
])

const EVIDENCE_KEYS = Object.freeze([
  'capturedAt',
  'databaseBackup',
  'isolation',
  'r2',
  'schemaVersion',
  'workDirectory',
])
const DATABASE_BACKUP_KEYS = Object.freeze([
  'checkedAt',
  'dailyEnabled',
  'latestAvailableAt',
  'storageBodiesIncluded',
  'visibleRestorePointCount',
])
const WORK_DIRECTORY_KEYS = Object.freeze([
  'encryptionCheckedAt',
  'encryptionProvider',
  'path',
])
const ISOLATION_KEYS = Object.freeze([
  'confirmation',
  'deletionWorkerEnabled',
  'externalApiCallsEnabled',
  'externalEmailEnabled',
  'maintenanceWorkerEnabled',
  'realtimePublicationsEnabled',
  'scheduledJobsEnabled',
  'webhooksEnabled',
])
const R2_KEYS = Object.freeze(['environment', 'maxSnapshotAgeHours', 'storageBucket'])
const LATEST_KEYS = Object.freeze([
  'completeKey',
  'completedAt',
  'environment',
  'manifestSha256',
  'orphanCount',
  'schemaVersion',
  'snapshotId',
])
const COMPLETE_KEYS = Object.freeze([
  'completedAt',
  'environment',
  'manifestKey',
  'manifestSha256',
  'objectCount',
  'orphanCount',
  'referencedObjectCount',
  'schemaVersion',
  'snapshotId',
  'totalBytes',
])
const MANIFEST_KEYS = Object.freeze([
  'createdAt',
  'environment',
  'objectCount',
  'objects',
  'orphanCount',
  'referencedObjectCount',
  'schemaVersion',
  'snapshotId',
  'source',
  'totalBytes',
])
const MANIFEST_SOURCE_KEYS = Object.freeze(['pointerMode', 'storageBucket', 'supabaseProjectRef'])
const MANIFEST_REFERENCED_OBJECT_KEYS = Object.freeze([
  'backupKey',
  'bytes',
  'classification',
  'contentType',
  'ownerScope',
  'sha256',
  'sourcePath',
])
const MANIFEST_UNREFERENCED_OBJECT_KEYS = Object.freeze([
  'backupKey',
  'bytes',
  'classification',
  'contentType',
  'sha256',
  'sourcePath',
])

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertExactKeys(value, expected, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new Error(`${label} fields do not match the reviewed schema.`)
  }
}

function assertNoSensitiveKeys(value, label = 'Evidence') {
  if (Array.isArray(value)) {
    for (const item of value) assertNoSensitiveKeys(item, label)
    return
  }
  if (!isRecord(value)) return
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      throw new Error(`${label} contains a forbidden sensitive field.`)
    }
    assertNoSensitiveKeys(child, label)
  }
}

function parseUtcTimestamp(value, label) {
  if (typeof value !== 'string' || !ISO_UTC_PATTERN.test(value)) {
    throw new Error(`${label} must be a millisecond-precision UTC timestamp.`)
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`${label} is invalid.`)
  }
  return timestamp
}

function assertRecent(timestamp, now, maxAgeMs, label) {
  if (timestamp > now + 60_000 || now - timestamp > maxAgeMs) {
    throw new Error(`${label} is outside the allowed freshness window.`)
  }
}

function assertProjectRef(value, label) {
  if (typeof value !== 'string' || !PROJECT_REF_PATTERN.test(value)) {
    throw new Error(`${label} must be an exact Supabase project ref.`)
  }
}

function assertPositiveSafeInteger(value, label, { allowZero = false } = {}) {
  if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`${label} must be a ${allowZero ? 'non-negative' : 'positive'} safe integer.`)
  }
}

function postgresMajor(version, label) {
  if (typeof version !== 'string' || !/^\d{1,2}(?:\.\d+){1,3}$/.test(version)) {
    throw new Error(`${label} must be a numeric PostgreSQL version.`)
  }
  const major = Number.parseInt(version.split('.')[0], 10)
  if (major < 12 || major > 30) throw new Error(`${label} is outside the reviewed PostgreSQL range.`)
  return major
}

export function expected24HourComputeCostUsd() {
  return Number((RECOVERY_EXPECTATIONS.microComputeHourlyUsd * REQUIRED_DELETE_WITHIN_HOURS).toFixed(5))
}

export function expectedCostConfirmation(confirmationId) {
  return `CONFIRM RECOVERY COST ${confirmationId} DISPLAY_USD_${RECOVERY_EXPECTATIONS.displayedMonthlyUsd} EXPECTED_24H_COMPUTE_USD_${expected24HourComputeCostUsd()} COMPUTE_CAP_USD_${REQUIRED_ACTUAL_COMPUTE_CAP_USD} DELETE_WITHIN_${REQUIRED_DELETE_WITHIN_HOURS}H`
}

export function expectedIsolationConfirmation(targetProjectRef) {
  return `CONFIRM RECOVERY ISOLATION ${targetProjectRef} ALL_EXTERNAL_CALLS_AND_SCHEDULERS_OFF`
}

export function verifySupabaseLiveRecoveryProbe({
  sourceProject,
  targetProject,
  targetAddons,
  targetProjectRef,
}) {
  assertProjectRef(targetProjectRef, 'Recovery target project ref')
  if ([RECOVERY_EXPECTATIONS.sourceProjectRef, RECOVERY_EXPECTATIONS.stagingProjectRef].includes(targetProjectRef)) {
    throw new Error('Recovery target matches an existing protected project ref.')
  }
  if (!isRecord(sourceProject) || sourceProject.ref !== RECOVERY_EXPECTATIONS.sourceProjectRef) {
    throw new Error('Live source project identity does not match the fixed production ref.')
  }
  if (!isRecord(targetProject) || targetProject.ref !== targetProjectRef) {
    throw new Error('Live target project identity does not match the selected recovery ref.')
  }
  if (sourceProject.status !== 'ACTIVE_HEALTHY' || targetProject.status !== 'ACTIVE_HEALTHY') {
    throw new Error('Source and target projects must both be ACTIVE_HEALTHY.')
  }
  if (
    sourceProject.region !== RECOVERY_EXPECTATIONS.region
    || targetProject.region !== RECOVERY_EXPECTATIONS.region
    || targetProject.region !== sourceProject.region
  ) {
    throw new Error('Live source and target regions must match the fixed recovery region.')
  }
  if (!isRecord(sourceProject.database) || !isRecord(targetProject.database)) {
    throw new Error('Live project metadata lacks PostgreSQL version information.')
  }
  const sourcePostgresMajor = postgresMajor(sourceProject.database.version, 'Live source PostgreSQL version')
  const targetPostgresMajor = postgresMajor(targetProject.database.version, 'Live target PostgreSQL version')

  if (!isRecord(targetAddons) || !Array.isArray(targetAddons.selected_addons)) {
    throw new Error('Live target billing metadata is invalid.')
  }
  const computeAddons = targetAddons.selected_addons.filter((addon) => addon?.type === 'compute_instance')
  if (computeAddons.length !== 1 || !isRecord(computeAddons[0].variant)) {
    throw new Error('Live target billing metadata must select exactly one compute instance.')
  }
  const computeVariant = computeAddons[0].variant
  if (computeVariant.id !== RECOVERY_EXPECTATIONS.targetComputeVariant) {
    throw new Error('Live recovery target compute variant is not Micro.')
  }
  if (
    !isRecord(computeVariant.price)
    || computeVariant.price.interval !== 'monthly'
    || computeVariant.price.amount !== RECOVERY_EXPECTATIONS.displayedMonthlyUsd
  ) {
    throw new Error('Live Micro monthly display cost does not match the reviewed USD 10 expectation.')
  }

  return {
    sourcePostgresMajor,
    targetPostgresMajor,
    displayedMonthlyUsd: computeVariant.price.amount,
  }
}

export function verifyExternalCostConfirmation({
  externalConfirmation,
  capturedAt,
  liveDisplayedMonthlyUsd,
}) {
  assertExactKeys(externalConfirmation, ['confirmationId', 'confirmedAt', 'marker'], 'External cost confirmation')
  if (
    typeof externalConfirmation.confirmationId !== 'string'
    || !CONFIRMATION_ID_PATTERN.test(externalConfirmation.confirmationId)
  ) {
    throw new Error('A separately delivered user cost confirmation ID is required.')
  }
  if (liveDisplayedMonthlyUsd !== RECOVERY_EXPECTATIONS.displayedMonthlyUsd) {
    throw new Error('Live monthly display cost does not match the reviewed USD 10 expectation.')
  }
  const confirmedAt = parseUtcTimestamp(externalConfirmation.confirmedAt, 'External cost confirmation time')
  if (confirmedAt > capturedAt || capturedAt - confirmedAt > REQUIRED_DELETE_WITHIN_HOURS * 60 * 60 * 1000) {
    throw new Error('External cost confirmation must precede the preflight and be less than 24 hours old.')
  }
  if (externalConfirmation.marker !== expectedCostConfirmation(externalConfirmation.confirmationId)) {
    throw new Error('Externally delivered cost confirmation marker does not match the reviewed cost and limits.')
  }
  const expectedComputeCostUsd = expected24HourComputeCostUsd()
  const expectedMonthlyDisplayUsd = Number((
    RECOVERY_EXPECTATIONS.microComputeHourlyUsd * RECOVERY_EXPECTATIONS.monthlyBillingHours
  ).toFixed(2))
  if (expectedMonthlyDisplayUsd !== liveDisplayedMonthlyUsd) {
    throw new Error('Reviewed hourly Micro pricing does not reconcile to the live monthly display cost.')
  }
  if (!(expectedComputeCostUsd < REQUIRED_ACTUAL_COMPUTE_CAP_USD)) {
    throw new Error('Expected 24-hour Micro compute cost is not below the USD 1 cap.')
  }
  return { confirmedAt, expectedComputeCostUsd }
}

export function verifyRecoveryPreflightEvidence({
  evidence,
  targetProjectRef,
  liveProbe,
  externalCostConfirmation,
  now = Date.now(),
}) {
  assertNoSensitiveKeys(evidence)
  assertExactKeys(evidence, EVIDENCE_KEYS, 'Recovery preflight evidence')
  if (evidence.schemaVersion !== RECOVERY_PREFLIGHT_SCHEMA_VERSION) {
    throw new Error('Recovery preflight evidence schema is unsupported.')
  }

  const live = verifySupabaseLiveRecoveryProbe({ ...liveProbe, targetProjectRef })
  const capturedAt = parseUtcTimestamp(evidence.capturedAt, 'Preflight capture time')
  assertRecent(capturedAt, now, MAX_PREFLIGHT_EVIDENCE_AGE_MS, 'Preflight evidence')
  const cost = verifyExternalCostConfirmation({
    externalConfirmation: externalCostConfirmation,
    capturedAt,
    liveDisplayedMonthlyUsd: live.displayedMonthlyUsd,
  })

  assertExactKeys(evidence.databaseBackup, DATABASE_BACKUP_KEYS, 'Database backup evidence')
  if (evidence.databaseBackup.dailyEnabled !== true) {
    throw new Error('Daily database backups must be enabled.')
  }
  if (evidence.databaseBackup.storageBodiesIncluded !== false) {
    throw new Error('Database backup evidence must acknowledge that Storage bodies are excluded.')
  }
  assertPositiveSafeInteger(evidence.databaseBackup.visibleRestorePointCount, 'Visible restore point count')
  const backupCheckedAt = parseUtcTimestamp(evidence.databaseBackup.checkedAt, 'Database backup check time')
  const latestBackupAt = parseUtcTimestamp(evidence.databaseBackup.latestAvailableAt, 'Latest database backup time')
  assertRecent(backupCheckedAt, now, MAX_PREFLIGHT_EVIDENCE_AGE_MS, 'Database backup check')
  assertRecent(latestBackupAt, now, MAX_R2_SNAPSHOT_AGE_MS, 'Latest database backup')
  if (latestBackupAt > backupCheckedAt) throw new Error('Latest database backup time cannot follow its check time.')

  assertExactKeys(evidence.workDirectory, WORK_DIRECTORY_KEYS, 'Recovery work directory evidence')
  if (!['bitlocker', 'efs'].includes(evidence.workDirectory.encryptionProvider)) {
    throw new Error('The reviewed Windows recovery flow requires BitLocker or exact-directory EFS protection.')
  }
  const encryptionCheckedAt = parseUtcTimestamp(
    evidence.workDirectory.encryptionCheckedAt,
    'Encryption check time',
  )
  assertRecent(encryptionCheckedAt, now, MAX_PREFLIGHT_EVIDENCE_AGE_MS, 'Encryption check')
  if (typeof evidence.workDirectory.path !== 'string' || !path.win32.isAbsolute(evidence.workDirectory.path)) {
    throw new Error('Recovery work directory must be an absolute Windows path.')
  }

  assertExactKeys(evidence.isolation, ISOLATION_KEYS, 'Recovery isolation evidence')
  const isolationFlags = ISOLATION_KEYS.filter((key) => key.endsWith('Enabled'))
  if (isolationFlags.some((key) => evidence.isolation[key] !== false)) {
    throw new Error('All scheduler and external-call controls must be explicitly OFF.')
  }
  if (evidence.isolation.confirmation !== expectedIsolationConfirmation(targetProjectRef)) {
    throw new Error('Recovery isolation confirmation marker does not match the exact target ref.')
  }

  assertExactKeys(evidence.r2, R2_KEYS, 'R2 recovery evidence selection')
  if (evidence.r2.environment !== 'production') {
    throw new Error('Production recovery preflight requires production R2 evidence.')
  }
  if (evidence.r2.storageBucket !== 'cabinets') {
    throw new Error('R2 evidence must cover the cabinets Storage bucket.')
  }
  if (evidence.r2.maxSnapshotAgeHours !== MAX_R2_SNAPSHOT_AGE_MS / (60 * 60 * 1000)) {
    throw new Error('R2 snapshot freshness limit must remain 26 hours.')
  }

  return {
    sourcePostgresMajor: live.sourcePostgresMajor,
    targetPostgresMajor: live.targetPostgresMajor,
    capturedAt,
    expectedComputeCostUsd: cost.expectedComputeCostUsd,
  }
}

async function readBoundedResponseJson(response, label) {
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (!Number.isFinite(contentLength) || contentLength > MAX_SMALL_EVIDENCE_BYTES) {
    throw new Error(`${label} response is outside the reviewed size limit.`)
  }
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('application/json') || !response.body) {
    throw new Error(`${label} response is not bounded JSON.`)
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_SMALL_EVIDENCE_BYTES) {
        throw new Error(`${label} response is outside the reviewed size limit.`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error(`${label} response contains invalid JSON.`)
  }
}

export async function fetchSupabaseLiveRecoveryProbe({
  accessToken,
  targetProjectRef,
  fetchImpl = globalThis.fetch,
}) {
  assertProjectRef(targetProjectRef, 'Recovery target project ref')
  if ([RECOVERY_EXPECTATIONS.sourceProjectRef, RECOVERY_EXPECTATIONS.stagingProjectRef].includes(targetProjectRef)) {
    throw new Error('Recovery target matches an existing protected project ref.')
  }
  if (
    typeof accessToken !== 'string'
    || accessToken !== accessToken.trim()
    || accessToken.length < 20
    || accessToken.length > 4096
  ) {
    throw new Error('A Supabase Management API read token is required for the live preflight probe.')
  }
  if (typeof fetchImpl !== 'function') throw new Error('A trusted fetch implementation is required.')

  const request = async (pathname, label) => {
    let response
    try {
      response = await fetchImpl(new URL(pathname, 'https://api.supabase.com'), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new Error(`${label} live read-only probe failed.`)
    }
    if (!response.ok) throw new Error(`${label} live read-only probe failed.`)
    return readBoundedResponseJson(response, label)
  }

  const [sourceProject, targetProject, targetAddons] = await Promise.all([
    request(`/v1/projects/${RECOVERY_EXPECTATIONS.sourceProjectRef}`, 'Source project'),
    request(`/v1/projects/${targetProjectRef}`, 'Target project'),
    request(`/v1/projects/${targetProjectRef}/billing/addons`, 'Target billing'),
  ])
  return { sourceProject, targetProject, targetAddons }
}

function safeStoragePath(value, label) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1024
    || value.startsWith('/')
    || value.endsWith('/')
    || value.includes('\\')
    || value.includes('//')
    || /[\u0000-\u001f\u007f]/.test(value)
    || /%(?:2e|2f|5c)/i.test(value)
  ) {
    throw new Error(`${label} is not a safe canonical object path.`)
  }
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`${label} is not a safe canonical object path.`)
  }
}

export function verifyR2CompleteManifestEvidence({
  latest,
  complete,
  manifest,
  manifestRaw,
  manifestChecksumRaw,
  expectedEnvironment = 'production',
  expectedStorageBucket = 'cabinets',
  now = Date.now(),
}) {
  assertNoSensitiveKeys(latest, 'R2 latest evidence')
  assertNoSensitiveKeys(complete, 'R2 completion evidence')
  assertNoSensitiveKeys(manifest, 'R2 manifest evidence')
  assertExactKeys(latest, LATEST_KEYS, 'R2 latest pointer')
  assertExactKeys(complete, COMPLETE_KEYS, 'R2 completion marker')
  assertExactKeys(manifest, MANIFEST_KEYS, 'R2 manifest')

  if (
    latest.schemaVersion !== 1
    || complete.schemaVersion !== 1
    || manifest.schemaVersion !== 1
  ) {
    throw new Error('R2 recovery evidence schema is unsupported.')
  }
  if (
    typeof manifest.snapshotId !== 'string'
    || !SNAPSHOT_ID_PATTERN.test(manifest.snapshotId)
    || latest.snapshotId !== manifest.snapshotId
    || complete.snapshotId !== manifest.snapshotId
  ) {
    throw new Error('R2 snapshot identities do not match exactly.')
  }
  if (
    latest.environment !== expectedEnvironment
    || complete.environment !== expectedEnvironment
    || manifest.environment !== expectedEnvironment
  ) {
    throw new Error('R2 evidence environment does not match the selected recovery environment.')
  }

  const prefix = `snapshots/${manifest.snapshotId}`
  if (complete.manifestKey !== `${prefix}/manifest.json`) {
    throw new Error('R2 completion marker references an unexpected manifest key.')
  }
  if (latest.completeKey !== `${prefix}/complete.json`) {
    throw new Error('R2 latest pointer references an unexpected completion key.')
  }

  if (typeof manifestRaw !== 'string' || typeof manifestChecksumRaw !== 'string') {
    throw new Error('Raw R2 manifest and checksum evidence are required.')
  }
  let manifestFromRaw
  try {
    manifestFromRaw = JSON.parse(manifestRaw)
  } catch {
    throw new Error('Raw R2 manifest evidence is not valid JSON.')
  }
  if (JSON.stringify(manifestFromRaw) !== JSON.stringify(manifest)) {
    throw new Error('Parsed R2 manifest does not match the exact bytes in the hash chain.')
  }
  const manifestSha256 = createHash('sha256').update(manifestRaw, 'utf8').digest('hex')
  if (manifestChecksumRaw !== `${manifestSha256}\n`) {
    throw new Error('R2 manifest checksum object does not match the exact manifest bytes.')
  }
  if (
    latest.manifestSha256 !== manifestSha256
    || complete.manifestSha256 !== manifestSha256
    || !SHA256_PATTERN.test(manifestSha256)
  ) {
    throw new Error('R2 manifest hash chain is incomplete or inconsistent.')
  }

  const createdAt = parseUtcTimestamp(manifest.createdAt, 'R2 manifest creation time')
  const completedAt = parseUtcTimestamp(complete.completedAt, 'R2 completion time')
  const latestCompletedAt = parseUtcTimestamp(latest.completedAt, 'R2 latest pointer completion time')
  if (createdAt > completedAt || latestCompletedAt !== completedAt) {
    throw new Error('R2 manifest and completion timestamps are inconsistent.')
  }
  assertRecent(completedAt, now, MAX_R2_SNAPSHOT_AGE_MS, 'R2 completed snapshot')

  assertExactKeys(manifest.source, MANIFEST_SOURCE_KEYS, 'R2 manifest source')
  assertProjectRef(manifest.source.supabaseProjectRef, 'R2 manifest source project ref')
  if (manifest.source.supabaseProjectRef !== RECOVERY_EXPECTATIONS.sourceProjectRef) {
    throw new Error('R2 manifest source does not match the fixed production ref.')
  }
  if (manifest.source.storageBucket !== expectedStorageBucket) {
    throw new Error('R2 manifest Storage bucket does not match the recovery selection.')
  }
  if (!['legacy_url', 'private_path'].includes(manifest.source.pointerMode)) {
    throw new Error('R2 manifest pointer mode is unsupported.')
  }

  assertPositiveSafeInteger(manifest.objectCount, 'R2 manifest object count')
  assertPositiveSafeInteger(manifest.referencedObjectCount, 'R2 manifest referenced object count')
  assertPositiveSafeInteger(manifest.orphanCount, 'R2 manifest orphan count', { allowZero: true })
  assertPositiveSafeInteger(manifest.totalBytes, 'R2 manifest total bytes')
  if (manifest.referencedObjectCount + manifest.orphanCount !== manifest.objectCount) {
    throw new Error('R2 manifest classification counts do not add up to its object count.')
  }
  if (!Array.isArray(manifest.objects) || manifest.objects.length !== manifest.objectCount) {
    throw new Error('R2 manifest object count does not match its object list.')
  }
  if (
    complete.objectCount !== manifest.objectCount
    || complete.referencedObjectCount !== manifest.referencedObjectCount
    || complete.orphanCount !== manifest.orphanCount
    || latest.orphanCount !== manifest.orphanCount
    || complete.totalBytes !== manifest.totalBytes
  ) {
    throw new Error('R2 completion totals do not match the manifest.')
  }

  const sourcePaths = new Set()
  const backupKeys = new Set()
  let totalBytes = 0
  let referencedObjectCount = 0
  let orphanCount = 0
  for (const object of manifest.objects) {
    if (!isRecord(object) || !['referenced', 'unreferenced'].includes(object.classification)) {
      throw new Error('R2 manifest object classification is invalid.')
    }
    const isReferenced = object.classification === 'referenced'
    assertExactKeys(
      object,
      isReferenced ? MANIFEST_REFERENCED_OBJECT_KEYS : MANIFEST_UNREFERENCED_OBJECT_KEYS,
      'R2 manifest object',
    )
    safeStoragePath(object.sourcePath, 'R2 source path')
    safeStoragePath(object.backupKey, 'R2 backup key')
    const classificationPrefix = isReferenced ? 'objects' : 'quarantine/unreferenced'
    if (object.backupKey !== `${prefix}/${classificationPrefix}/${object.sourcePath}`) {
      throw new Error('R2 backup key does not match its canonical snapshot path.')
    }
    if (sourcePaths.has(object.sourcePath) || backupKeys.has(object.backupKey)) {
      throw new Error('R2 manifest contains a duplicate object path.')
    }
    sourcePaths.add(object.sourcePath)
    backupKeys.add(object.backupKey)
    assertPositiveSafeInteger(object.bytes, 'R2 object byte count')
    totalBytes += object.bytes
    if (!Number.isSafeInteger(totalBytes)) throw new Error('R2 manifest total bytes exceed the safe range.')
    if (typeof object.sha256 !== 'string' || !SHA256_PATTERN.test(object.sha256)) {
      throw new Error('R2 object hash is invalid.')
    }
    if (isReferenced && !['lab', 'user'].includes(object.ownerScope)) {
      throw new Error('R2 object owner scope is invalid.')
    }
    if (isReferenced) referencedObjectCount += 1
    else orphanCount += 1
    if (
      typeof object.contentType !== 'string'
      || object.contentType.length === 0
      || object.contentType.length > 255
      || /[\r\n\u0000]/.test(object.contentType)
    ) {
      throw new Error('R2 object content type is invalid.')
    }
  }
  if (totalBytes !== manifest.totalBytes) {
    throw new Error('R2 manifest total bytes do not match its object list.')
  }
  if (
    referencedObjectCount !== manifest.referencedObjectCount
    || orphanCount !== manifest.orphanCount
  ) {
    throw new Error('R2 manifest object classifications do not match their declared counts.')
  }

  return {
    defaultRestoreObjectCount: manifest.referencedObjectCount,
    snapshotCompletedAt: complete.completedAt,
    manifestSha256,
    objectCount: manifest.objectCount,
    orphanCount: manifest.orphanCount,
    referencedObjectCount: manifest.referencedObjectCount,
    totalBytes: manifest.totalBytes,
  }
}

function requireRegularDirectory(directoryPath, label) {
  if (typeof directoryPath !== 'string' || !path.isAbsolute(directoryPath)) {
    throw new Error(`${label} path must be absolute.`)
  }
  let status
  let realPath
  try {
    status = lstatSync(directoryPath)
    realPath = realpathSync.native(directoryPath)
  } catch {
    throw new Error(`${label} cannot be resolved locally.`)
  }
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-reparse directory.`)
  }
  if (normalizedPath(directoryPath) !== normalizedPath(realPath)) {
    throw new Error(`${label} must not pass through a symlink, junction, or other reparse alias.`)
  }
  return realPath
}

function requireRegularFilePath(filePath, label) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new Error(`${label} path must be absolute.`)
  }
  let status
  let realPath
  try {
    status = lstatSync(filePath)
    realPath = realpathSync.native(filePath)
  } catch {
    throw new Error(`${label} cannot be resolved locally.`)
  }
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-reparse file.`)
  }
  if (normalizedPath(filePath) !== normalizedPath(realPath)) {
    throw new Error(`${label} must not pass through a symlink, junction, or other reparse alias.`)
  }
  return realPath
}

export async function verifyPostgresPortableArtifacts({
  pgDumpPath,
  pgRestorePath,
  psqlPath,
  archivePath,
  allowedRoot,
  platform = process.platform,
}) {
  if (platform !== 'win32') {
    throw new Error('The reviewed portable PostgreSQL tool flow currently supports Windows only.')
  }
  const realAllowedRoot = requireRegularDirectory(allowedRoot, 'Approved recovery root')
  const selectedTools = [
    ['pg_dump.exe', requireRegularFilePath(pgDumpPath, 'pg_dump executable')],
    ['pg_restore.exe', requireRegularFilePath(pgRestorePath, 'pg_restore executable')],
    ['psql.exe', requireRegularFilePath(psqlPath, 'psql executable')],
  ]
  const toolDirectories = new Set()
  for (const [expectedName, toolPath] of selectedTools) {
    if (!isSameOrWithin(toolPath, realAllowedRoot, platform)) {
      throw new Error('Portable PostgreSQL executables must remain inside the approved recovery root.')
    }
    if (path.win32.basename(toolPath).toLowerCase() !== expectedName) {
      throw new Error('A portable PostgreSQL executable has an unexpected filename.')
    }
    toolDirectories.add(normalizedPath(path.win32.dirname(toolPath), platform))
  }
  if (toolDirectories.size !== 1) {
    throw new Error('Portable PostgreSQL executables must come from one exact bin directory.')
  }

  const realArchivePath = requireRegularFilePath(archivePath, 'PostgreSQL portable archive')
  if (!isSameOrWithin(realArchivePath, realAllowedRoot, platform)) {
    throw new Error('PostgreSQL portable archive must remain inside the approved recovery root.')
  }
  const archive = await hashStableRegularFile(realArchivePath, {
    label: 'PostgreSQL portable archive',
    maxBytes: MAX_POSTGRES_ARCHIVE_BYTES,
  })
  if (archive.sha256 !== REQUIRED_POSTGRES_ARCHIVE_SHA256) {
    throw new Error('PostgreSQL portable archive SHA-256 does not match the reviewed official artifact.')
  }
  return {
    archiveSha256: archive.sha256,
    pgDumpPath: selectedTools[0][1],
    pgRestorePath: selectedTools[1][1],
    psqlPath: selectedTools[2][1],
  }
}

function enumerateRegularFiles(rootDirectory) {
  const files = new Map()
  const visit = (directory) => {
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      throw new Error('R2 restore material directory cannot be enumerated safely.')
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error('R2 restore material contains a symlink, junction, or reparse entry.')
      }
      if (entry.isDirectory()) {
        const realDirectory = requireRegularDirectory(entryPath, 'R2 restore material directory')
        visit(realDirectory)
        continue
      }
      if (!entry.isFile()) throw new Error('R2 restore material contains an unsupported filesystem entry.')
      let realFilePath
      try {
        realFilePath = realpathSync.native(entryPath)
      } catch {
        throw new Error('R2 restore material contains an unreadable file.')
      }
      if (normalizedPath(entryPath) !== normalizedPath(realFilePath)) {
        throw new Error('R2 restore material contains a file reached through a reparse alias.')
      }
      const relativePath = path.relative(rootDirectory, realFilePath).split(path.sep).join('/')
      safeStoragePath(relativePath, 'R2 restore material relative path')
      if (files.has(relativePath)) throw new Error('R2 restore material contains a duplicate path.')
      files.set(relativePath, realFilePath)
    }
  }
  visit(rootDirectory)
  return files
}

async function hashStableRegularFile(filePath, {
  label = 'R2 restore material body',
  maxBytes = Number.MAX_SAFE_INTEGER,
} = {}) {
  let before
  try {
    before = statSync(filePath)
  } catch {
    throw new Error(`${label} cannot be inspected.`)
  }
  if (
    !before.isFile()
    || !Number.isSafeInteger(before.size)
    || before.size <= 0
    || before.size > maxBytes
  ) {
    throw new Error(`${label} must be a non-empty regular file within the reviewed size limit.`)
  }
  const hash = createHash('sha256')
  try {
    for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  } catch {
    throw new Error(`${label} cannot be read.`)
  }
  let after
  try {
    after = statSync(filePath)
  } catch {
    throw new Error(`${label} cannot be inspected after hashing.`)
  }
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error(`${label} changed while it was being verified.`)
  }
  return { bytes: after.size, sha256: hash.digest('hex') }
}

export async function verifyR2RestoreMaterial({ manifest, bodyRoot, workDirectory }) {
  if (!isRecord(manifest) || typeof manifest.snapshotId !== 'string') {
    throw new Error('A verified R2 manifest is required before body verification.')
  }
  const realBodyRoot = requireRegularDirectory(bodyRoot, 'R2 restore material root')
  const realWorkDirectory = requireRegularDirectory(workDirectory, 'Recovery work directory')
  if (!isSameOrWithin(realBodyRoot, realWorkDirectory)) {
    throw new Error('R2 restore material must remain inside the encrypted work directory.')
  }
  const bodyParts = normalizedPath(realBodyRoot).split(path.sep)
  const expectedTail = ['snapshots', manifest.snapshotId]
  if (expectedTail.some((part, index) => bodyParts.at(index - expectedTail.length) !== part)) {
    throw new Error('R2 restore material root does not match the manifest snapshot prefix.')
  }

  const files = enumerateRegularFiles(realBodyRoot)
  const permittedMetadataPaths = new Set(['complete.json', 'manifest.json', 'manifest.sha256'])
  const expectedBodies = new Map(manifest.objects.map((object) => {
    const classificationPrefix = object.classification === 'referenced'
      ? 'objects'
      : 'quarantine/unreferenced'
    return [`${classificationPrefix}/${object.sourcePath}`, object]
  }))
  if (expectedBodies.size !== manifest.objects.length) {
    throw new Error('R2 restore material manifest coverage contains a duplicate body path.')
  }
  const actualBodyPaths = [...files.keys()].filter((relativePath) => !permittedMetadataPaths.has(relativePath))
  if (actualBodyPaths.length !== expectedBodies.size) {
    throw new Error('R2 restore material coverage does not match the manifest.')
  }
  for (const relativePath of actualBodyPaths) {
    if (!expectedBodies.has(relativePath)) {
      throw new Error('R2 restore material contains an orphan body not present in the manifest.')
    }
  }

  let totalBytes = 0
  for (const object of manifest.objects) {
    const classificationPrefix = object.classification === 'referenced'
      ? 'objects'
      : 'quarantine/unreferenced'
    const filePath = files.get(`${classificationPrefix}/${object.sourcePath}`)
    if (!filePath) throw new Error('R2 restore material is missing a manifest body.')
    const body = await hashStableRegularFile(filePath)
    if (body.bytes !== object.bytes) throw new Error('R2 restore material body byte length does not match.')
    if (body.sha256 !== object.sha256) throw new Error('R2 restore material body SHA-256 does not match.')
    totalBytes += body.bytes
    if (!Number.isSafeInteger(totalBytes)) throw new Error('R2 restore material total bytes exceed the safe range.')
  }
  if (totalBytes !== manifest.totalBytes) {
    throw new Error('R2 restore material total bytes do not match the manifest.')
  }
  return {
    defaultRestoreObjectCount: manifest.referencedObjectCount,
    objectCount: expectedBodies.size,
    orphanCount: manifest.orphanCount,
    referencedObjectCount: manifest.referencedObjectCount,
    totalBytes,
  }
}

function normalizedPath(value, platform = process.platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const withoutExtendedPrefix = platform === 'win32' ? value.replace(/^\\\\\?\\/, '') : value
  const normalized = pathApi.normalize(withoutExtendedPrefix).replace(/[\\/]+$/, '')
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

function isSameOrWithin(candidate, parent, platform = process.platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const normalizedCandidate = normalizedPath(candidate, platform)
  const normalizedParent = normalizedPath(parent, platform)
  const relative = pathApi.relative(normalizedParent, normalizedCandidate)
  return relative === '' || (!relative.startsWith('..') && !pathApi.isAbsolute(relative))
}

function isKnownSyncDirectoryName(component) {
  const normalized = component.trim().toLowerCase()
  return (
    /^onedrive(?:\b|\s|[-(])/.test(normalized)
    || /^dropbox(?:\b|\s|[-(])/.test(normalized)
    || normalized === 'box'
    || /^box(?: sync| \()/.test(normalized)
    || normalized === 'google drive'
    || normalized === 'googledrive'
    || normalized === 'my drive'
    || normalized === 'shared drives'
    || normalized === 'icloud drive'
    || normalized === 'iclouddrive'
  )
}

export function verifyRecoveryWorkDirectoryLocation({
  configuredPath,
  realPath,
  repositoryRoot,
  syncRoots = [],
  allowedRoots = [],
  platform = process.platform,
}) {
  if (platform !== 'win32') throw new Error('The reviewed recovery preflight currently supports Windows only.')
  if (!path.win32.isAbsolute(configuredPath) || !path.win32.isAbsolute(realPath)) {
    throw new Error('Recovery work directory paths must be absolute.')
  }
  if (normalizedPath(configuredPath, platform) !== normalizedPath(realPath, platform)) {
    throw new Error('Recovery work directory must not use a symlink or junction alias.')
  }
  const root = path.win32.parse(realPath).root
  if (normalizedPath(realPath, platform) === normalizedPath(root, platform)) {
    throw new Error('A drive root cannot be used as the recovery work directory.')
  }
  if (isSameOrWithin(realPath, repositoryRoot, platform)) {
    throw new Error('Recovery work directory must be outside the repository.')
  }
  const components = realPath.split(/[\\/]+/).map((component) => component.toLowerCase())
  if (components.some(isKnownSyncDirectoryName)) {
    throw new Error('Recovery work directory must not be inside a known synchronization folder.')
  }
  if (!Array.isArray(syncRoots)) throw new Error('Synchronization-root evidence is ambiguous.')
  for (const syncRoot of syncRoots) {
    if (typeof syncRoot !== 'string' || !path.win32.isAbsolute(syncRoot)) {
      throw new Error('A configured synchronization root is ambiguous.')
    }
    if (isSameOrWithin(realPath, syncRoot, platform)) {
      throw new Error('Recovery work directory must not be inside a configured synchronization root.')
    }
  }
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) {
    throw new Error('At least one approved Windows recovery root is required.')
  }
  let insideApprovedRoot = false
  for (const allowedRoot of allowedRoots) {
    if (typeof allowedRoot !== 'string' || !path.win32.isAbsolute(allowedRoot)) {
      throw new Error('An approved Windows recovery root is ambiguous.')
    }
    const allowedComponents = allowedRoot.split(/[\\/]+/)
    if (allowedComponents.some(isKnownSyncDirectoryName)) {
      throw new Error('An approved Windows recovery root resolves inside a synchronization folder.')
    }
    if (
      isSameOrWithin(realPath, allowedRoot, platform)
      && normalizedPath(realPath, platform) !== normalizedPath(allowedRoot, platform)
    ) {
      insideApprovedRoot = true
    }
  }
  if (!insideApprovedRoot) {
    throw new Error('Recovery work directory must be a child of an approved Windows recovery root.')
  }
  return { volumeRoot: root }
}

export function verifyRecoveryWorkDirectory(options) {
  const location = verifyRecoveryWorkDirectoryLocation(options)
  const {
    encryptionProvider,
    encryptionStatus,
    reparseStatus,
    syncProbeStatus,
  } = options
  if (!['bitlocker', 'efs'].includes(encryptionProvider) || encryptionStatus !== 'protected') {
    throw new Error('The selected recovery encryption probe does not report protected status.')
  }
  if (reparseStatus !== 'clear') {
    throw new Error('Recovery work directory reparse-point status is not unambiguously clear.')
  }
  if (syncProbeStatus !== 'clear') {
    throw new Error('Recovery work directory synchronization-root status is not unambiguously clear.')
  }
  return location
}

function parseSemver(output, label) {
  if (typeof output !== 'string') throw new Error(`${label} did not return a version.`)
  const match = output.trim().match(/(?:^|[^\d])(\d+)\.(\d+)(?:\.(\d+))?(?:[^\d]|$)/)
  if (!match) throw new Error(`${label} did not return a recognized semantic version.`)
  return `${match[1]}.${match[2]}.${match[3] || '0'}`
}

export function verifyReadOnlyToolVersions({
  pwsh,
  supabase,
  pgDump,
  pgRestore,
  psql,
}, targetPostgresMajor) {
  const pwshVersion = parseSemver(pwsh, 'PowerShell')
  if (Number.parseInt(pwshVersion, 10) < 7) throw new Error('PowerShell 7 or newer is required.')
  const supabaseVersion = parseSemver(supabase, 'Supabase CLI')
  if (supabaseVersion !== REQUIRED_SUPABASE_CLI_VERSION) {
    throw new Error(`Supabase CLI ${REQUIRED_SUPABASE_CLI_VERSION} is required.`)
  }
  const pgDumpVersion = parseSemver(pgDump, 'pg_dump')
  const pgRestoreVersion = parseSemver(pgRestore, 'pg_restore')
  const psqlVersion = parseSemver(psql, 'psql')
  if (
    pgDumpVersion !== REQUIRED_POSTGRES_TOOL_VERSION
    || pgRestoreVersion !== REQUIRED_POSTGRES_TOOL_VERSION
    || psqlVersion !== REQUIRED_POSTGRES_TOOL_VERSION
  ) {
    throw new Error(`Portable pg_dump, pg_restore, and psql ${REQUIRED_POSTGRES_TOOL_VERSION} are required.`)
  }
  if (Number.parseInt(psqlVersion, 10) < targetPostgresMajor) {
    throw new Error('Portable PostgreSQL tools are older than the recovery target PostgreSQL major version.')
  }
  return {
    pwshVersion,
    supabaseVersion,
    pgDumpVersion,
    pgRestoreVersion,
    psqlVersion,
  }
}

async function executeReadOnlyProbe(executable, args) {
  const localEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => LOCAL_PROBE_ENVIRONMENT_NAMES.has(name.toLowerCase())),
  )
  try {
    const result = await execFile(executable, args, {
      encoding: 'utf8',
      env: localEnvironment,
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 64 * 1024,
      shell: false,
    })
    return result.stdout
  } catch {
    throw new Error('A required read-only local prerequisite probe failed.')
  }
}

export async function probeReadOnlyPrerequisites({
  targetPostgresMajor,
  volumeRoot,
  workDirectory,
  encryptionProvider,
  efsProbeFile,
  postgresTools,
  runner = executeReadOnlyProbe,
}) {
  if (
    !isRecord(postgresTools)
    || !['pgDumpPath', 'pgRestorePath', 'psqlPath'].every((key) => (
      typeof postgresTools[key] === 'string' && path.isAbsolute(postgresTools[key])
    ))
  ) {
    throw new Error('Exact portable PostgreSQL executable paths are required.')
  }
  if (
    (encryptionProvider === 'efs' && (
      typeof efsProbeFile !== 'string' || !path.isAbsolute(efsProbeFile)
    ))
    || (encryptionProvider === 'bitlocker' && efsProbeFile !== undefined)
  ) {
    throw new Error('Encryption probe inputs do not match the selected provider.')
  }
  const pwsh = await runner('pwsh', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '$PSVersionTable.PSVersion.ToString()',
  ])
  if (Number.parseInt(parseSemver(pwsh, 'PowerShell'), 10) < 7) {
    throw new Error('PowerShell 7 or newer is required before local safety probes run.')
  }
  let encryptionStatus
  if (encryptionProvider === 'bitlocker') {
    encryptionStatus = (await runner('pwsh', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$volume = Get-BitLockerVolume -MountPoint $args[0] -ErrorAction Stop; if ($volume.ProtectionStatus -eq 'On') { 'protected' } else { 'unprotected' }",
      volumeRoot,
    ])).trim()
  } else if (encryptionProvider === 'efs') {
    encryptionStatus = (await runner('pwsh', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$directory = Get-Item -LiteralPath $args[0] -Force -ErrorAction Stop; $probe = Get-Item -LiteralPath $args[1] -Force -ErrorAction Stop; $encrypted = [IO.FileAttributes]::Encrypted; $directChild = [IO.Path]::GetDirectoryName($probe.FullName) -eq $directory.FullName; $ageMinutes = ([DateTime]::UtcNow - $probe.CreationTimeUtc).TotalMinutes; $fresh = $ageMinutes -ge -1 -and $ageMinutes -le 30; if ($directory.PSIsContainer -and -not $probe.PSIsContainer -and $directChild -and $fresh -and (($directory.Attributes -band $encrypted) -ne 0) -and (($probe.Attributes -band $encrypted) -ne 0)) { 'protected' } else { 'unprotected' }",
      workDirectory,
      efsProbeFile,
    ])).trim()
  } else {
    throw new Error('Recovery encryption provider is unsupported.')
  }
  if (encryptionStatus !== 'protected') {
    throw new Error('Recovery encryption probe did not return protected status.')
  }
  const reparseStatus = (await runner('pwsh', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "$item = Get-Item -LiteralPath $args[0] -Force -ErrorAction Stop; while ($null -ne $item) { if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { 'reparse'; exit }; $item = $item.Parent }; 'clear'",
    workDirectory,
  ])).trim()
  if (reparseStatus !== 'clear') {
    throw new Error('Recovery work directory reparse probe did not return clear status.')
  }
  const syncProbeStatus = (await runner('pwsh', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "$ErrorActionPreference = 'Stop'; try { $target = [IO.Path]::GetFullPath($args[0]).TrimEnd('\\') + '\\'; $roots = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase); @($env:OneDrive, $env:OneDriveConsumer, $env:OneDriveCommercial, $env:Dropbox, $env:Box, $env:BoxSync, $env:GoogleDrive, $env:GoogleDriveFS, $env:Google_Drive, $env:Google_Drive_FS, $env:iCloudDrive) | Where-Object { $_ } | ForEach-Object { [void]$roots.Add($_) }; $manager = 'Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\SyncRootManager'; if (Test-Path -LiteralPath $manager) { foreach ($provider in @(Get-ChildItem -LiteralPath $manager -Force -ErrorAction Stop)) { foreach ($item in @($provider) + @(Get-ChildItem -LiteralPath $provider.PSPath -Recurse -Force -ErrorAction Stop)) { $properties = Get-ItemProperty -LiteralPath $item.PSPath -ErrorAction Stop; foreach ($property in $properties.PSObject.Properties) { foreach ($value in @($property.Value)) { if ($value -is [string] -and [IO.Path]::IsPathFullyQualified($value)) { [void]$roots.Add($value) } } } } } }; foreach ($infoPath in @((Join-Path $env:APPDATA 'Dropbox\\info.json'), (Join-Path $env:LOCALAPPDATA 'Dropbox\\info.json'))) { if (Test-Path -LiteralPath $infoPath) { $accounts = Get-Content -LiteralPath $infoPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop; foreach ($account in $accounts.PSObject.Properties.Value) { if ($account.path -is [string]) { [void]$roots.Add($account.path) } } } }; foreach ($root in $roots) { $normalized = [IO.Path]::GetFullPath($root).TrimEnd('\\') + '\\'; if ($target.StartsWith($normalized, [System.StringComparison]::OrdinalIgnoreCase)) { 'sync'; exit } }; 'clear' } catch { 'unknown' }",
    workDirectory,
  ])).trim()
  if (syncProbeStatus !== 'clear') {
    throw new Error('Recovery work directory synchronization-root probe did not return clear status.')
  }
  const outputs = {
    pwsh,
    supabase: await runner('npx.cmd', ['--no-install', 'supabase', '--version']),
    pgDump: await runner(postgresTools.pgDumpPath, ['--version']),
    pgRestore: await runner(postgresTools.pgRestorePath, ['--version']),
    psql: await runner(postgresTools.psqlPath, ['--version']),
  }
  const versions = verifyReadOnlyToolVersions(outputs, targetPostgresMajor)
  return { versions, encryptionStatus, reparseStatus, syncProbeStatus }
}

function readBoundedFile(filePath, label, maxBytes) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new Error(`${label} path must be absolute.`)
  }
  let linkStatus
  let status
  try {
    linkStatus = lstatSync(filePath)
    status = statSync(filePath)
  } catch {
    throw new Error(`${label} cannot be read from the selected local evidence directory.`)
  }
  if (linkStatus.isSymbolicLink() || !linkStatus.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file.`)
  }
  if (status.size <= 0 || status.size > maxBytes) {
    throw new Error(`${label} size is outside the reviewed limit.`)
  }
  try {
    return readFileSync(filePath, 'utf8')
  } catch {
    throw new Error(`${label} cannot be read from the selected local evidence directory.`)
  }
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`${label} is not valid JSON.`)
  }
}

function parseArguments(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true }
  if (argv.length % 2 !== 0) throw new Error('Recovery preflight arguments are incomplete.')
  const required = new Set([
    '--allowed-work-root',
    '--evidence',
    '--pg-archive-path',
    '--pg-dump-path',
    '--pg-restore-path',
    '--psql-path',
    '--r2-body-root',
    '--r2-complete',
    '--r2-latest',
    '--r2-manifest',
    '--r2-manifest-sha256',
    '--target-ref',
  ])
  const allowed = new Set([...required, '--efs-probe-file'])
  const parsed = {}
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!allowed.has(flag) || typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
      throw new Error('Recovery preflight received an unsupported argument.')
    }
    if (flag in parsed) throw new Error('Recovery preflight arguments must not be repeated.')
    parsed[flag] = value
  }
  if ([...required].some((flag) => !(flag in parsed))) {
    throw new Error('Recovery preflight requires every reviewed evidence argument.')
  }
  return parsed
}

function requireExistingWorkDirectory(configuredPath) {
  let status
  let realPath
  try {
    status = lstatSync(configuredPath)
    realPath = realpathSync.native(configuredPath)
  } catch {
    throw new Error('Recovery work directory cannot be resolved locally.')
  }
  if (status.isSymbolicLink() || !status.isDirectory()) {
    throw new Error('Recovery work directory must be a regular non-symlink directory.')
  }
  return realPath
}

export function reviewedWindowsWorkRoots(environment) {
  const trustedRoots = selectedEnvironmentValues(environment, ['TEMP', 'TMP'])
    .filter((candidate) => path.win32.isAbsolute(candidate))
  const userProfiles = selectedEnvironmentValues(environment, ['USERPROFILE'])
    .filter((candidate) => path.win32.isAbsolute(candidate))
  for (const userProfile of userProfiles) trustedRoots.push(path.win32.join(userProfile, '.codex-tmp'))
  return [...new Set(trustedRoots.map((candidate) => path.win32.normalize(candidate)))]
}

function resolveApprovedWorkRoot(selectedRoot, environment) {
  if (typeof selectedRoot !== 'string' || !path.win32.isAbsolute(selectedRoot)) {
    throw new Error('Approved recovery root must be an absolute Windows path.')
  }
  const trustedRoots = reviewedWindowsWorkRoots(environment)
  if (!trustedRoots.some((candidate) => (
    normalizedPath(candidate, 'win32') === normalizedPath(selectedRoot, 'win32')
  ))) {
    throw new Error('Selected recovery root is not in the reviewed Windows root allowlist.')
  }
  return requireRegularDirectory(selectedRoot, 'Approved recovery root')
}

function resolveEfsProbeFile(probeFile, workDirectory) {
  const realProbeFile = requireRegularFilePath(probeFile, 'EFS inheritance probe file')
  if (normalizedPath(path.dirname(realProbeFile), 'win32') !== normalizedPath(workDirectory, 'win32')) {
    throw new Error('EFS inheritance probe file must be a direct child of the exact recovery work directory.')
  }
  return realProbeFile
}

function requireEvidenceFilesWithinWorkDirectory(filePaths, workDirectory) {
  for (const filePath of filePaths) {
    let realFilePath
    try {
      realFilePath = realpathSync.native(filePath)
    } catch {
      throw new Error('A selected recovery evidence file cannot be resolved locally.')
    }
    if (normalizedPath(filePath, 'win32') !== normalizedPath(realFilePath, 'win32')) {
      throw new Error('Recovery evidence files must not pass through a symlink, junction, or reparse alias.')
    }
    if (!isSameOrWithin(realFilePath, workDirectory, 'win32')) {
      throw new Error('All recovery evidence files must be inside the encrypted work directory.')
    }
  }
}

export function verifyR2LocalEvidenceLayout({
  bodyRoot,
  latestPath,
  completePath,
  manifestPath,
  manifestChecksumPath,
  snapshotId,
  platform = process.platform,
}) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  if (
    !SNAPSHOT_ID_PATTERN.test(snapshotId)
    || ![bodyRoot, latestPath, completePath, manifestPath, manifestChecksumPath]
      .every((value) => typeof value === 'string' && pathApi.isAbsolute(value))
  ) {
    throw new Error('Local R2 evidence layout is incomplete or ambiguous.')
  }
  if (
    pathApi.basename(bodyRoot).toLowerCase() !== snapshotId
    || pathApi.basename(pathApi.dirname(bodyRoot)).toLowerCase() !== 'snapshots'
  ) {
    throw new Error('Local R2 material root does not match the reviewed snapshot layout.')
  }
  const bucketRoot = pathApi.dirname(pathApi.dirname(bodyRoot))
  const expectedPaths = [
    [latestPath, pathApi.join(bucketRoot, 'control', 'latest.json')],
    [completePath, pathApi.join(bodyRoot, 'complete.json')],
    [manifestPath, pathApi.join(bodyRoot, 'manifest.json')],
    [manifestChecksumPath, pathApi.join(bodyRoot, 'manifest.sha256')],
  ]
  if (expectedPaths.some(([actual, expected]) => (
    normalizedPath(actual, platform) !== normalizedPath(expected, platform)
  ))) {
    throw new Error('Local R2 evidence files do not form one exact snapshot layout.')
  }
  return { bucketRoot }
}

function selectedEnvironmentValues(environment, names) {
  const selectedNames = new Set(names.map((name) => name.toLowerCase()))
  return [...new Set(
    Object.entries(environment)
      .filter(([name, value]) => selectedNames.has(name.toLowerCase()) && typeof value === 'string' && value.trim())
      .map(([, value]) => value.trim()),
  )]
}

export async function runRecoveryPreflight({
  argv = process.argv.slice(2),
  environment = process.env,
  now = Date.now(),
  runner,
  fetchImpl,
} = {}) {
  const args = parseArguments(argv)
  if (args.help) {
    return { help: true }
  }

  const evidenceRaw = readBoundedFile(args['--evidence'], 'Recovery preflight evidence', MAX_SMALL_EVIDENCE_BYTES)
  const evidence = parseJson(evidenceRaw, 'Recovery preflight evidence')
  const targetProjectRef = args['--target-ref']
  const externalCostConfirmation = {
    confirmationId: environment.BURILLAB_RECOVERY_GET_COST_CONFIRMATION_ID,
    confirmedAt: environment.BURILLAB_RECOVERY_GET_COST_CONFIRMED_AT,
    marker: environment.BURILLAB_RECOVERY_GET_COST_CONFIRMATION,
  }
  if (
    typeof externalCostConfirmation.confirmationId !== 'string'
    || !CONFIRMATION_ID_PATTERN.test(externalCostConfirmation.confirmationId)
    || typeof externalCostConfirmation.confirmedAt !== 'string'
    || typeof externalCostConfirmation.marker !== 'string'
  ) {
    throw new Error('Separately delivered recovery cost confirmation environment values are required.')
  }
  const liveProbe = await fetchSupabaseLiveRecoveryProbe({
    accessToken: environment.SUPABASE_ACCESS_TOKEN,
    targetProjectRef,
    fetchImpl,
  })
  const core = verifyRecoveryPreflightEvidence({
    evidence,
    targetProjectRef,
    liveProbe,
    externalCostConfirmation,
    now,
  })

  const configuredWorkDirectory = evidence.workDirectory.path
  const realWorkDirectory = requireExistingWorkDirectory(configuredWorkDirectory)
  const realAllowedWorkRoot = resolveApprovedWorkRoot(args['--allowed-work-root'], environment)
  let repositoryRoot
  try {
    repositoryRoot = realpathSync.native(path.resolve(import.meta.dirname, '..'))
  } catch {
    throw new Error('Repository root cannot be resolved for recovery path isolation.')
  }
  const configuredSyncRoots = selectedEnvironmentValues(environment, [
    'OneDrive',
    'OneDriveConsumer',
    'OneDriveCommercial',
    'Dropbox',
    'Box',
    'BoxSync',
    'GoogleDrive',
    'GoogleDriveFS',
    'Google_Drive',
    'Google_Drive_FS',
    'iCloudDrive',
  ])
  verifyRecoveryWorkDirectoryLocation({
    configuredPath: configuredWorkDirectory,
    realPath: realWorkDirectory,
    repositoryRoot,
    syncRoots: configuredSyncRoots,
    allowedRoots: [realAllowedWorkRoot],
  })
  let realEfsProbeFile
  if (evidence.workDirectory.encryptionProvider === 'efs') {
    if (!args['--efs-probe-file']) {
      throw new Error('Exact EFS inheritance probe file evidence is required for EFS protection.')
    }
    realEfsProbeFile = resolveEfsProbeFile(args['--efs-probe-file'], realWorkDirectory)
  } else if (args['--efs-probe-file']) {
    throw new Error('EFS probe file evidence is only valid with the EFS encryption provider.')
  }
  const postgresTools = await verifyPostgresPortableArtifacts({
    pgDumpPath: args['--pg-dump-path'],
    pgRestorePath: args['--pg-restore-path'],
    psqlPath: args['--psql-path'],
    archivePath: args['--pg-archive-path'],
    allowedRoot: realAllowedWorkRoot,
  })
  const volumeRoot = path.win32.parse(realWorkDirectory).root
  const localPrerequisites = await probeReadOnlyPrerequisites({
    targetPostgresMajor: core.targetPostgresMajor,
    volumeRoot,
    workDirectory: realWorkDirectory,
    encryptionProvider: evidence.workDirectory.encryptionProvider,
    efsProbeFile: realEfsProbeFile,
    postgresTools,
    runner,
  })
  verifyRecoveryWorkDirectory({
    configuredPath: configuredWorkDirectory,
    realPath: realWorkDirectory,
    repositoryRoot,
    syncRoots: configuredSyncRoots,
    allowedRoots: [realAllowedWorkRoot],
    encryptionProvider: evidence.workDirectory.encryptionProvider,
    encryptionStatus: localPrerequisites.encryptionStatus,
    reparseStatus: localPrerequisites.reparseStatus,
    syncProbeStatus: localPrerequisites.syncProbeStatus,
  })

  const r2Paths = [
    args['--evidence'],
    args['--r2-latest'],
    args['--r2-complete'],
    args['--r2-manifest'],
    args['--r2-manifest-sha256'],
  ]
  requireEvidenceFilesWithinWorkDirectory(r2Paths, realWorkDirectory)
  const realBodyRoot = requireRegularDirectory(args['--r2-body-root'], 'R2 restore material root')
  if (!isSameOrWithin(realBodyRoot, realWorkDirectory, 'win32')) {
    throw new Error('R2 restore material must remain inside the encrypted work directory.')
  }

  const latestRaw = readBoundedFile(args['--r2-latest'], 'R2 latest pointer', MAX_SMALL_EVIDENCE_BYTES)
  const completeRaw = readBoundedFile(args['--r2-complete'], 'R2 completion marker', MAX_SMALL_EVIDENCE_BYTES)
  const manifestRaw = readBoundedFile(args['--r2-manifest'], 'R2 manifest', MAX_MANIFEST_BYTES)
  const manifestChecksumRaw = readBoundedFile(
    args['--r2-manifest-sha256'],
    'R2 manifest checksum',
    256,
  )
  const manifest = parseJson(manifestRaw, 'R2 manifest')
  verifyR2LocalEvidenceLayout({
    bodyRoot: realBodyRoot,
    latestPath: args['--r2-latest'],
    completePath: args['--r2-complete'],
    manifestPath: args['--r2-manifest'],
    manifestChecksumPath: args['--r2-manifest-sha256'],
    snapshotId: manifest.snapshotId,
  })
  const r2 = verifyR2CompleteManifestEvidence({
    latest: parseJson(latestRaw, 'R2 latest pointer'),
    complete: parseJson(completeRaw, 'R2 completion marker'),
    manifest,
    manifestRaw,
    manifestChecksumRaw,
    expectedEnvironment: evidence.r2.environment,
    expectedStorageBucket: evidence.r2.storageBucket,
    now,
  })
  const restoreMaterial = await verifyR2RestoreMaterial({
    manifest,
    bodyRoot: realBodyRoot,
    workDirectory: realWorkDirectory,
  })

  return {
    help: false,
    remoteMetadataRead: true,
    remoteStateMutated: false,
    expectedComputeCostUsd: core.expectedComputeCostUsd,
    postgresArchiveSha256: postgresTools.archiveSha256,
    toolVersions: localPrerequisites.versions,
    r2: {
      defaultRestoreObjectCount: restoreMaterial.defaultRestoreObjectCount,
      manifestSha256: r2.manifestSha256,
      objectCount: restoreMaterial.objectCount,
      orphanCount: restoreMaterial.orphanCount,
      referencedObjectCount: restoreMaterial.referencedObjectCount,
      snapshotCompletedAt: r2.snapshotCompletedAt,
      totalBytes: restoreMaterial.totalBytes,
    },
  }
}

function helpText() {
  return [
    'Read-only BurilLab Supabase recovery preflight.',
    '',
    'Usage:',
    '  node scripts/verify-supabase-recovery-preflight.mjs --evidence <absolute-path> --target-ref <ref> --allowed-work-root <absolute-path> --pg-archive-path <absolute-path> --pg-dump-path <absolute-path> --pg-restore-path <absolute-path> --psql-path <absolute-path> --r2-latest <absolute-path> --r2-complete <absolute-path> --r2-manifest <absolute-path> --r2-manifest-sha256 <absolute-path> --r2-body-root <absolute-path> [--efs-probe-file <absolute-path>]',
    '',
    'Requires SUPABASE_ACCESS_TOKEN plus externally delivered Supabase get_cost confirmation environment values.',
    'This command only performs fixed Management API GETs, reads and hashes selected local evidence/artifacts, and runs fixed local probes.',
    'It never creates or deletes projects, reads database rows, dumps data, restores data, or mutates remote state.',
  ].join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRecoveryPreflight()
    .then((result) => {
      if (result.help) {
        console.log(helpText())
        return
      }
      console.log('Recovery preflight passed; only fixed live metadata reads and local evidence checks were performed.')
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'Recovery preflight failed closed.')
      process.exitCode = 1
    })
}
