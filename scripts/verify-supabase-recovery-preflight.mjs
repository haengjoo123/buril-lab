import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const execFile = promisify(execFileCallback)

export const RECOVERY_PREFLIGHT_SCHEMA_VERSION = 1
export const REQUIRED_SUPABASE_CLI_VERSION = '2.115.0'
export const MAX_PREFLIGHT_EVIDENCE_AGE_MS = 30 * 60 * 1000
export const MAX_R2_SNAPSHOT_AGE_MS = 26 * 60 * 60 * 1000
export const REQUIRED_ACTUAL_COMPUTE_CAP_USD = 1
export const REQUIRED_DELETE_WITHIN_HOURS = 24

const MAX_SMALL_EVIDENCE_BYTES = 64 * 1024
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SNAPSHOT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,127}$/
const CONFIRMATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/
const REGION_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)+$/
const SENSITIVE_KEY_PATTERN = /(?:password|secret|token|credential|service.?role|api.?key|connection.?string|database.?url)/i
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const SYNC_DIRECTORY_NAMES = new Set([
  'onedrive',
  'dropbox',
  'google drive',
  'googledrive',
  'icloud drive',
  'iclouddrive',
])
const LOCAL_PROBE_ENVIRONMENT_NAMES = new Set([
  'appdata',
  'comspec',
  'homedrive',
  'homepath',
  'localappdata',
  'npm_config_cache',
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
  'cost',
  'databaseBackup',
  'isolation',
  'r2',
  'schemaVersion',
  'source',
  'target',
  'workDirectory',
])
const SOURCE_KEYS = Object.freeze(['health', 'postgresVersion', 'projectRef', 'region'])
const TARGET_KEYS = Object.freeze(['computeSize', 'postgresVersion', 'projectRef', 'region'])
const COST_KEYS = Object.freeze([
  'actualComputeCapUsd',
  'confirmation',
  'confirmationId',
  'confirmedAt',
  'deleteWithinHours',
  'displayedMonthlyUsd',
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
  'encryptionStatus',
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
  'schemaVersion',
  'snapshotId',
])
const COMPLETE_KEYS = Object.freeze([
  'completedAt',
  'environment',
  'manifestKey',
  'manifestSha256',
  'objectCount',
  'schemaVersion',
  'snapshotId',
  'totalBytes',
])
const MANIFEST_KEYS = Object.freeze([
  'createdAt',
  'environment',
  'objectCount',
  'objects',
  'schemaVersion',
  'snapshotId',
  'source',
  'totalBytes',
])
const MANIFEST_SOURCE_KEYS = Object.freeze(['pointerMode', 'storageBucket', 'supabaseProjectRef'])
const MANIFEST_OBJECT_KEYS = Object.freeze([
  'backupKey',
  'bytes',
  'contentType',
  'ownerScope',
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

export function expectedCostConfirmation({ confirmationId, displayedMonthlyUsd }) {
  return `CONFIRM RECOVERY COST ${confirmationId} DISPLAY_USD_${displayedMonthlyUsd} ACTUAL_COMPUTE_CAP_USD_1 DELETE_WITHIN_24H`
}

export function expectedIsolationConfirmation(targetProjectRef) {
  return `CONFIRM RECOVERY ISOLATION ${targetProjectRef} ALL_EXTERNAL_CALLS_AND_SCHEDULERS_OFF`
}

export function verifyRecoveryPreflightEvidence({
  evidence,
  expectedSourceProjectRef,
  expectedTargetProjectRef,
  forbiddenTargetProjectRefs,
  now = Date.now(),
}) {
  assertNoSensitiveKeys(evidence)
  assertExactKeys(evidence, EVIDENCE_KEYS, 'Recovery preflight evidence')
  if (evidence.schemaVersion !== RECOVERY_PREFLIGHT_SCHEMA_VERSION) {
    throw new Error('Recovery preflight evidence schema is unsupported.')
  }

  assertProjectRef(expectedSourceProjectRef, 'Selected source project ref')
  assertProjectRef(expectedTargetProjectRef, 'Selected target project ref')
  if (expectedSourceProjectRef === expectedTargetProjectRef) {
    throw new Error('Recovery source and target projects must differ.')
  }
  if (!Array.isArray(forbiddenTargetProjectRefs) || forbiddenTargetProjectRefs.length === 0) {
    throw new Error('At least one existing non-source project ref must be forbidden as a recovery target.')
  }
  const uniqueForbiddenRefs = new Set()
  for (const forbiddenRef of forbiddenTargetProjectRefs) {
    assertProjectRef(forbiddenRef, 'Forbidden recovery target project ref')
    if (forbiddenRef === expectedSourceProjectRef || uniqueForbiddenRefs.has(forbiddenRef)) {
      throw new Error('Forbidden recovery target refs must be unique and distinct from the source.')
    }
    uniqueForbiddenRefs.add(forbiddenRef)
  }
  if (uniqueForbiddenRefs.has(expectedTargetProjectRef)) {
    throw new Error('Recovery target matches an existing protected project ref.')
  }

  assertExactKeys(evidence.source, SOURCE_KEYS, 'Source project evidence')
  assertExactKeys(evidence.target, TARGET_KEYS, 'Target project evidence')
  assertProjectRef(evidence.source.projectRef, 'Source project evidence ref')
  assertProjectRef(evidence.target.projectRef, 'Target project evidence ref')
  if (evidence.source.projectRef !== expectedSourceProjectRef) {
    throw new Error('Source project evidence does not match the explicitly selected source ref.')
  }
  if (evidence.target.projectRef !== expectedTargetProjectRef) {
    throw new Error('Target project evidence does not match the explicitly selected target ref.')
  }
  if (evidence.source.health !== 'ACTIVE_HEALTHY') {
    throw new Error('Source project is not ACTIVE_HEALTHY.')
  }
  if (
    typeof evidence.source.region !== 'string'
    || !REGION_PATTERN.test(evidence.source.region)
    || evidence.target.region !== evidence.source.region
  ) {
    throw new Error('Recovery target region must exactly match the source region.')
  }
  if (evidence.target.computeSize !== 'MICRO') {
    throw new Error('Recovery target compute size must be MICRO.')
  }
  const sourcePostgresMajor = postgresMajor(evidence.source.postgresVersion, 'Source PostgreSQL version')
  const targetPostgresMajor = postgresMajor(evidence.target.postgresVersion, 'Target PostgreSQL version')

  const capturedAt = parseUtcTimestamp(evidence.capturedAt, 'Preflight capture time')
  assertRecent(capturedAt, now, MAX_PREFLIGHT_EVIDENCE_AGE_MS, 'Preflight evidence')

  assertExactKeys(evidence.cost, COST_KEYS, 'Cost evidence')
  if (
    typeof evidence.cost.displayedMonthlyUsd !== 'number'
    || !Number.isFinite(evidence.cost.displayedMonthlyUsd)
    || evidence.cost.displayedMonthlyUsd <= 0
    || evidence.cost.displayedMonthlyUsd > 1000
  ) {
    throw new Error('Displayed monthly cost must be a reviewed positive amount.')
  }
  if (evidence.cost.actualComputeCapUsd !== REQUIRED_ACTUAL_COMPUTE_CAP_USD) {
    throw new Error('Actual recovery compute cap must remain USD 1.')
  }
  if (evidence.cost.deleteWithinHours !== REQUIRED_DELETE_WITHIN_HOURS) {
    throw new Error('Recovery target deletion deadline must remain 24 hours.')
  }
  if (
    typeof evidence.cost.confirmationId !== 'string'
    || !CONFIRMATION_ID_PATTERN.test(evidence.cost.confirmationId)
  ) {
    throw new Error('A valid user cost confirmation ID is required.')
  }
  const confirmedAt = parseUtcTimestamp(evidence.cost.confirmedAt, 'Cost confirmation time')
  if (confirmedAt > capturedAt || capturedAt - confirmedAt > REQUIRED_DELETE_WITHIN_HOURS * 60 * 60 * 1000) {
    throw new Error('Cost confirmation must precede the current preflight and be less than 24 hours old.')
  }
  if (evidence.cost.confirmation !== expectedCostConfirmation(evidence.cost)) {
    throw new Error('Cost confirmation marker does not exactly match the reviewed cost and limits.')
  }

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
  if (evidence.workDirectory.encryptionProvider !== 'bitlocker') {
    throw new Error('The reviewed Windows recovery flow requires BitLocker protection.')
  }
  if (evidence.workDirectory.encryptionStatus !== 'protected') {
    throw new Error('Recovery work directory encryption is not marked protected.')
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
  if (evidence.isolation.confirmation !== expectedIsolationConfirmation(expectedTargetProjectRef)) {
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
    sourcePostgresMajor,
    targetPostgresMajor,
    capturedAt,
  }
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
  expectedSourceProjectRef,
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
  if (manifest.source.supabaseProjectRef !== expectedSourceProjectRef) {
    throw new Error('R2 manifest source does not match the exact recovery source ref.')
  }
  if (manifest.source.storageBucket !== expectedStorageBucket) {
    throw new Error('R2 manifest Storage bucket does not match the recovery selection.')
  }
  if (!['legacy_url', 'private_path'].includes(manifest.source.pointerMode)) {
    throw new Error('R2 manifest pointer mode is unsupported.')
  }

  assertPositiveSafeInteger(manifest.objectCount, 'R2 manifest object count')
  assertPositiveSafeInteger(manifest.totalBytes, 'R2 manifest total bytes')
  if (!Array.isArray(manifest.objects) || manifest.objects.length !== manifest.objectCount) {
    throw new Error('R2 manifest object count does not match its object list.')
  }
  if (
    complete.objectCount !== manifest.objectCount
    || complete.totalBytes !== manifest.totalBytes
  ) {
    throw new Error('R2 completion totals do not match the manifest.')
  }

  const sourcePaths = new Set()
  const backupKeys = new Set()
  let totalBytes = 0
  for (const object of manifest.objects) {
    assertExactKeys(object, MANIFEST_OBJECT_KEYS, 'R2 manifest object')
    safeStoragePath(object.sourcePath, 'R2 source path')
    safeStoragePath(object.backupKey, 'R2 backup key')
    if (object.backupKey !== `${prefix}/objects/${object.sourcePath}`) {
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
    if (!['lab', 'user'].includes(object.ownerScope)) {
      throw new Error('R2 object owner scope is invalid.')
    }
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

  return {
    snapshotCompletedAt: complete.completedAt,
    manifestSha256,
    objectCount: manifest.objectCount,
    totalBytes: manifest.totalBytes,
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

export function verifyRecoveryWorkDirectory({
  configuredPath,
  realPath,
  repositoryRoot,
  syncRoots = [],
  bitLockerStatus,
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
  if (components.some((component) => SYNC_DIRECTORY_NAMES.has(component))) {
    throw new Error('Recovery work directory must not be inside a known synchronization folder.')
  }
  for (const syncRoot of syncRoots.filter(Boolean)) {
    if (path.win32.isAbsolute(syncRoot) && isSameOrWithin(realPath, syncRoot, platform)) {
      throw new Error('Recovery work directory must not be inside a configured synchronization root.')
    }
  }
  if (bitLockerStatus !== 'protected') {
    throw new Error('BitLocker does not report the recovery work volume as protected.')
  }
  return { volumeRoot: root }
}

function parseSemver(output, label) {
  if (typeof output !== 'string') throw new Error(`${label} did not return a version.`)
  const match = output.trim().match(/(?:^|[^\d])(\d+)\.(\d+)(?:\.(\d+))?(?:[^\d]|$)/)
  if (!match) throw new Error(`${label} did not return a recognized semantic version.`)
  return `${match[1]}.${match[2]}.${match[3] || '0'}`
}

export function verifyReadOnlyToolVersions({ pwsh, supabase, docker, psql }, targetPostgresMajor) {
  const pwshVersion = parseSemver(pwsh, 'PowerShell')
  if (Number.parseInt(pwshVersion, 10) < 7) throw new Error('PowerShell 7 or newer is required.')
  const supabaseVersion = parseSemver(supabase, 'Supabase CLI')
  if (supabaseVersion !== REQUIRED_SUPABASE_CLI_VERSION) {
    throw new Error(`Supabase CLI ${REQUIRED_SUPABASE_CLI_VERSION} is required.`)
  }
  const dockerVersion = parseSemver(docker, 'Docker Desktop server')
  const psqlVersion = parseSemver(psql, 'psql')
  if (Number.parseInt(psqlVersion, 10) < targetPostgresMajor) {
    throw new Error('psql is older than the recovery target PostgreSQL major version.')
  }
  return { pwshVersion, supabaseVersion, dockerVersion, psqlVersion }
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
  runner = executeReadOnlyProbe,
}) {
  const outputs = {
    pwsh: await runner('pwsh', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$PSVersionTable.PSVersion.ToString()',
    ]),
    supabase: await runner('npx.cmd', ['--no-install', 'supabase', '--version']),
    docker: await runner('docker', ['version', '--format', '{{.Server.Version}}']),
    psql: await runner('psql', ['--version']),
  }
  const versions = verifyReadOnlyToolVersions(outputs, targetPostgresMajor)
  const bitLockerStatus = (await runner('pwsh', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "$volume = Get-BitLockerVolume -MountPoint $args[0] -ErrorAction Stop; if ($volume.ProtectionStatus -eq 'On') { 'protected' } else { 'unprotected' }",
    volumeRoot,
  ])).trim()
  if (!['protected', 'unprotected'].includes(bitLockerStatus)) {
    throw new Error('BitLocker probe returned an unsupported status.')
  }
  return { versions, bitLockerStatus }
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
  const allowed = new Set([
    '--evidence',
    '--r2-complete',
    '--r2-latest',
    '--r2-manifest',
    '--r2-manifest-sha256',
    '--source-ref',
    '--staging-ref',
    '--target-ref',
  ])
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
  if ([...allowed].some((flag) => !(flag in parsed))) {
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

function requireEvidenceFilesWithinWorkDirectory(filePaths, workDirectory) {
  for (const filePath of filePaths) {
    let realFilePath
    try {
      realFilePath = realpathSync.native(filePath)
    } catch {
      throw new Error('A selected recovery evidence file cannot be resolved locally.')
    }
    if (!isSameOrWithin(realFilePath, workDirectory, 'win32')) {
      throw new Error('All recovery evidence files must be inside the encrypted work directory.')
    }
  }
}

export async function runRecoveryPreflight({
  argv = process.argv.slice(2),
  environment = process.env,
  now = Date.now(),
  runner,
} = {}) {
  const args = parseArguments(argv)
  if (args.help) {
    return { help: true }
  }

  const evidenceRaw = readBoundedFile(args['--evidence'], 'Recovery preflight evidence', MAX_SMALL_EVIDENCE_BYTES)
  const evidence = parseJson(evidenceRaw, 'Recovery preflight evidence')
  const core = verifyRecoveryPreflightEvidence({
    evidence,
    expectedSourceProjectRef: args['--source-ref'],
    expectedTargetProjectRef: args['--target-ref'],
    forbiddenTargetProjectRefs: [args['--staging-ref']],
    now,
  })

  const configuredWorkDirectory = evidence.workDirectory.path
  const realWorkDirectory = requireExistingWorkDirectory(configuredWorkDirectory)
  const volumeRoot = path.win32.parse(realWorkDirectory).root
  const localPrerequisites = await probeReadOnlyPrerequisites({
    targetPostgresMajor: core.targetPostgresMajor,
    volumeRoot,
    runner,
  })
  verifyRecoveryWorkDirectory({
    configuredPath: configuredWorkDirectory,
    realPath: realWorkDirectory,
    repositoryRoot: realpathSync.native(path.resolve(import.meta.dirname, '..')),
    syncRoots: [environment.OneDrive, environment.OneDriveConsumer, environment.OneDriveCommercial],
    bitLockerStatus: localPrerequisites.bitLockerStatus,
  })

  const r2Paths = [
    args['--evidence'],
    args['--r2-latest'],
    args['--r2-complete'],
    args['--r2-manifest'],
    args['--r2-manifest-sha256'],
  ]
  requireEvidenceFilesWithinWorkDirectory(r2Paths, realWorkDirectory)

  const latestRaw = readBoundedFile(args['--r2-latest'], 'R2 latest pointer', MAX_SMALL_EVIDENCE_BYTES)
  const completeRaw = readBoundedFile(args['--r2-complete'], 'R2 completion marker', MAX_SMALL_EVIDENCE_BYTES)
  const manifestRaw = readBoundedFile(args['--r2-manifest'], 'R2 manifest', MAX_MANIFEST_BYTES)
  const manifestChecksumRaw = readBoundedFile(
    args['--r2-manifest-sha256'],
    'R2 manifest checksum',
    256,
  )
  const r2 = verifyR2CompleteManifestEvidence({
    latest: parseJson(latestRaw, 'R2 latest pointer'),
    complete: parseJson(completeRaw, 'R2 completion marker'),
    manifest: parseJson(manifestRaw, 'R2 manifest'),
    manifestRaw,
    manifestChecksumRaw,
    expectedSourceProjectRef: args['--source-ref'],
    expectedEnvironment: evidence.r2.environment,
    expectedStorageBucket: evidence.r2.storageBucket,
    now,
  })

  return {
    help: false,
    remoteStateAccessed: false,
    remoteStateMutated: false,
    toolVersions: localPrerequisites.versions,
    r2: {
      manifestSha256: r2.manifestSha256,
      objectCount: r2.objectCount,
      snapshotCompletedAt: r2.snapshotCompletedAt,
      totalBytes: r2.totalBytes,
    },
  }
}

function helpText() {
  return [
    'Read-only BurilLab Supabase recovery preflight.',
    '',
    'Usage:',
    '  node scripts/verify-supabase-recovery-preflight.mjs --evidence <absolute-path> --source-ref <ref> --staging-ref <ref> --target-ref <ref> --r2-latest <absolute-path> --r2-complete <absolute-path> --r2-manifest <absolute-path> --r2-manifest-sha256 <absolute-path>',
    '',
    'This command only reads local evidence and runs fixed local version/encryption probes.',
    'It never creates or deletes projects, reads a remote database, dumps data, or mutates remote state.',
  ].join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRecoveryPreflight()
    .then((result) => {
      if (result.help) {
        console.log(helpText())
        return
      }
      console.log('Recovery preflight passed using local evidence only; no remote state was read or changed.')
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'Recovery preflight failed closed.')
      process.exitCode = 1
    })
}
