import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  createReadStream,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createInflateRaw } from 'node:zlib'
import { RELEASE_ENVIRONMENTS } from './write-release-manifest.mjs'

export const RECOVERY_PREFLIGHT_SCHEMA_VERSION = 3
export const REQUIRED_SUPABASE_CLI_VERSION = '2.115.0'
export const REQUIRED_SUPABASE_CLI_INTEGRITY = 'sha512-8fL9vOd6jOntmU8N5DVlHGE2GWR1r57ulsrOzSyO6IRYq5QMyKie8T8DH+hb+caGhYUVJLvmpY7XYwic60Uafg=='
export const REQUIRED_POSTGRES_TOOL_VERSION = '17.11.0'
export const REQUIRED_POSTGRES_ARCHIVE_SHA256 = '6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3'
export const REQUIRED_POSTGRES_BIN_MANIFEST = Object.freeze([
  ['clusterdb.exe', 136192, 'e37ee5ea6510da8276961ec5eb3a3da3fe1d7b6f36b4e8f8fad37613d43dc9af'],
  ['createdb.exe', 134656, '1e8322a28156e0c33a668a2a9a1cf3c8f24e36951e461c8f3bfa60dfb0a80ef9'],
  ['createuser.exe', 139264, '5c94fbc72eb03bbeed50e4645ee4a0be213f7555514e8734018d5a2d6f8b42ec'],
  ['dropdb.exe', 133632, '10fabb879e3dcef64f23484b35c508a7665c6a00d7feae0c0cf87ffbe9eb0a30'],
  ['dropuser.exe', 133120, '3c3f5a1c01fa5a1aa8c7167f9d1e949498cf3404875d8db0cb317dd2fb8d382f'],
  ['ecpg.exe', 1008640, '1d359b57b6fd95d9859c2a6bdf3d30e2e004a6685b0101bbf59ff105daba788f'],
  ['icudt67.dll', 28399104, '5ff9c8026344e886f280ddfa235a1e16e1bcd396e90f9ed600b6f71d9d881ae8'],
  ['icuin67.dll', 2674176, '23d5914acf071f566df19aaf404373e5c73c9910c370e728976f6202c04cf6c3'],
  ['icuio67.dll', 61440, '1ca5221753f930de19041d546ce0f24102455621c71033d4d5cb8151762c9694'],
  ['icutu67.dll', 220672, '371c4784b5510b8e80a6b5896567b17bc70e231ea47ee8f614a7ebd3d510960f'],
  ['icuuc67.dll', 1906688, '2fb4007a1f1089a0807cc1abde5443f5c3b0865ecfd80344b6ad165f1fe53ade'],
  ['initdb.exe', 245248, '6978bdb96e1e515285eb7bbf8915c4a254644107b1fcb44917e52f707dbe798a'],
  ['libcrypto-3-x64.dll', 5708800, 'e864c2b31452d84892e885adfc07f151964bc9065134f7254b47194db253eaf7'],
  ['libcurl.dll', 734720, '004509675fbf796d92f5c860de158df67f32545334c59cc3efbd327c6b7c6d11'],
  ['libcurl.lib', 22274, '23fd63ee26d25706d4dd1c8d425aa0623dae81503b88536386bc1552dc59f53a'],
  ['libecpg_compat.dll', 25088, '0a29046c60a96ad86b68bbbb00fde7487dcb538067b3bcdfa6b2d85cc0989bbf'],
  ['libecpg.dll', 102400, 'd2e26d852ff34520617954833975bc20f79803d1b07d50c52305d3e29ccf882f'],
  ['libiconv-2.dll', 1850401, '3ee9786ab3eb8dfd791bdbd17c7e791dbe025734befcded0ee4170e1089f79df'],
  ['libintl-9.dll', 475769, '1125ac8dc0c4f5c3ed4712e0d8ad29474099fcb55bb0e563a352ce9d03ef1d78'],
  ['liblz4.dll', 128000, '096af775241b3bd4b1c3d79c83b103bb8f02da54ec4cd76c5d49eef61a68ad01'],
  ['libpgtypes.dll', 84992, '1b0489ec37b81cdfc8880b47f50d534e9609d107d544eec39e4ca81149fcfe22'],
  ['libpq.dll', 351232, '468ddfa39acedb484affcbe7207f62970d2ea021b4e7d23eb1b2e0af990cded9'],
  ['libssl-3-x64.dll', 1313792, '45041ed336e6658ac796424431eb8b22c08e5a51982155bf94d727a5442dfba7'],
  ['libwinpthread-1.dll', 52736, 'ffe2d56375bb4e8bdee9037df6befc5016ddd8871d0d85027314dd5792f8fdc9'],
  ['libxml2.dll', 1230848, 'fa13b5d8bdc8254a6a7f0bc9b26331fa6badf096334bb912e7dc6928206a74a0'],
  ['libxslt.dll', 414208, '8226fad0fc6e9b79b14203d4f5263ddec5764c0108aa7c17622dd77f311669a6'],
  ['libzstd.dll', 727040, '287e7e474961e8886a3d961e2c07da647a7ac8d60d97023545f3a3ecf604daba'],
  ['oid2name.exe', 84480, 'eed0ec381b52293f6de7d47a8276bb2df51e76b91d3246f33c11dcb2c55e6ac3'],
  ['pg_amcheck.exe', 165376, '9b6be233a596e3f7f314e72eeeaca7c0207d3019c91bbf49e49c26ccd972c045'],
  ['pg_archivecleanup.exe', 95744, '951677596802b0df4409c37aaec5ac4ade43ebc0f54b901bceeab6181743db91'],
  ['pg_basebackup.exe', 299520, '96de4ccb7f2c2cd79ab4983bbd9b1f892ccfea38aef156f50ef1936858185daf'],
  ['pg_checksums.exe', 130560, '4293b90c906a7556f6ef954d4efb000f459c2afe4324e8548d99c089e8eceff3'],
  ['pg_combinebackup.exe', 199680, '02b5182cfbef847fe583ec5a7d54d9096fa8b1f6917c43fae75c288f2d4c0866'],
  ['pg_config.exe', 91136, '2b40e28f761e7ad10fe3c0aefbb47d67fcfa1a855bf0655504c8fa94264e2701'],
  ['pg_controldata.exe', 107520, '835843f3fcf1e0b86acef92a815efbcd1e17dd13fecf0474599b3a9ddf070d2a'],
  ['pg_createsubscriber.exe', 172544, '475fa85e915ba23887cbdc2a7dc19f8cbb00246b882a45937468238512b7dd95'],
  ['pg_ctl.exe', 132096, '5afdea4f4860b52cd03cee4c51be5d034a51f7ed63312acc3b6abee9006fa0ba'],
  ['pg_dump.exe', 613888, 'ff766351cc88b0ea2bc7b6e365777cb51f792b16000688a378f64124810ffa88'],
  ['pg_dumpall.exe', 194560, '25ac39cfdac4eb7a24eb384eed52521820ec38515517042c7ddea1a05bb48a0d'],
  ['pg_isready.exe', 92672, '15242279c66680141586747a475090d70f83874cc19dc63709be6b57b0ba411c'],
  ['pg_receivewal.exe', 228352, '4a2e88545b3ade851f58c1175940780ef0509c9a33c95baf73a413d349dd8883'],
  ['pg_recvlogical.exe', 113664, '266a92abb156c1172f2f763737e6cd787b04529f27111b5baf8429953bdeb0e4'],
  ['pg_resetwal.exe', 124928, '51d0e2cb498048b346535ac8aecc4364843436437c3d56288e68cd5f0d06fbd1'],
  ['pg_restore.exe', 371200, 'ae002028451e79240eaad9838d9eb0b644436a05decb3888468a529bf881ac6c'],
  ['pg_rewind.exe', 229888, '29821254a4cc3df450aa5d8dce1684667e4c6af12f489764e26cea39b90def8a'],
  ['pg_test_fsync.exe', 100864, '79be189fdcb23d97e87ffe114185bb62ca6539fb7a25c44c23f28303950f5f58'],
  ['pg_test_timing.exe', 89600, '51cc3a35d4a04d20d22750aa9fce370f8e563f0841e17da1219fa1c0a178ee34'],
  ['pg_upgrade.exe', 251904, '22ad84bbe21cb6be151572bceaf8b3e25cf058e5c30e35fbe9816f3e4cec2516'],
  ['pg_verifybackup.exe', 157696, '0eac063c86318a12fd9c262b005c2e9cb7c60bb9f836238cccd41b7a38ee8dc5'],
  ['pg_waldump.exe', 164352, 'ba397d08fa602789e28c3912b60a7679be46673866f0ddb157e2404ac2ddee6c'],
  ['pg_walsummary.exe', 117248, 'e262f6ebc4699b9b8163864fef637dbfb9268996b448e39fc4f2849bd6916d9e'],
  ['pgbench.exe', 260608, 'd2a04d835ae5492156d02883aa3bf0920cd8a5458349d61420bfcf7e9fdc6d03'],
  ['postgres.exe', 9939456, '4125c1e963072d929f6468a449ad184b26d3be7d97cae3181c3d613dace49c8d'],
  ['psql.exe', 635392, '5bb3fad8a7ff555abff37921a24ee3d9e377c15408b5e7267aa9245596965ca0'],
  ['reindexdb.exe', 146944, '85ffa3678f4037f45ccd56512311c4e3e34e288a0662054a0cf9055e64022f3e'],
  ['stackbuilder.exe', 437880, 'f1fc9c23e3c848d77a1048b96401877cdf0d02b759aadde88f43f52cb7b20784'],
  ['test_cloexec.exe', 38400, '416ed51cd8429b3576053ee41574e79a5bacdbc2ee31beda583858d4b73aa1ac'],
  ['testplug.dll', 10752, 'd1b10395868a004f6ae4700159ba89992a65147efaca63218cd5fb084b32303a'],
  ['vacuumdb.exe', 150016, 'fe15945d84f7b35835f18bef115bf64d62e56afa3974ec32581574c081ba31dc'],
  ['vacuumlo.exe', 83456, '15d85b77db4506f3a915b3e1bd2410c4d8b2a691a190ca8b2dec04d90876c1c3'],
  ['wxbase3211u_net_vc_x64_custom.dll', 257024, 'f707ee1d13ed5d3264a6b95dbb6cc4cd79e5d663180a91dca80704b1d97783eb'],
  ['wxbase3211u_vc_x64_custom.dll', 2985472, 'cc6b32bb8cbc1ecd798a8e08144671bb0542e75217ee5b0f9a76fab9146b88be'],
  ['wxbase3211u_xml_vc_x64_custom.dll', 193024, '4c716cb9407ed90331d677b55e82b3e31a16ff6f5adf9493321594d01fa200d3'],
  ['wxmsw3211u_adv_vc_x64_custom.dll', 11264, 'e9b0906ec69d7656228f564596ae882a8d68f37b5021f490ebcf2aae289eb742'],
  ['wxmsw3211u_aui_vc_x64_custom.dll', 594944, 'ded33cdf2455389eaef3e9c2bd6bca04d3edfbea9e7f53393ee6f8bab2ae124c'],
  ['wxmsw3211u_core_vc_x64_custom.dll', 8352768, 'd658d50d6820d17ac4de22bd66b93799595d63c7469ca6a1d99f479a838b67b8'],
  ['wxmsw3211u_html_vc_x64_custom.dll', 708096, '74b2e9f9f4b690b554733f1be1e4412c27ea5e0b0a6cd67d05e3895eafb2946e'],
  ['wxmsw3211u_xrc_vc_x64_custom.dll', 886784, '24bb563eaed37c5b87d238fab8183eac8f66dbf4c67b06c2b9fa54a1234e020f'],
  ['zlib1.dll', 91648, '890afa7a17fb66308e0026631070409138b157ef2773c0a41d22a76943f7aedf'],
].map(([name, bytes, sha256]) => Object.freeze({ bytes, name, sha256 })))
export const TRUSTED_WINDOWS_POWERSHELL_PATH = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
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
const MAX_POSTGRES_ARCHIVE_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024
const MAX_POSTGRES_BIN_FILE_BYTES = 128 * 1024 * 1024
const MAX_POSTGRES_BIN_FILE_COUNT = 512
const MAX_POSTGRES_BIN_TOTAL_BYTES = 512 * 1024 * 1024
const MAX_EFS_PROBE_ARGUMENT_CHARS = 16 * 1024
const MAX_EFS_PROBE_FILES_PER_CALL = 64
const MAX_WINDOWS_ATTRIBUTE_PROBE_ITEMS_PER_CALL = 64
const MAX_WINDOWS_ATTRIBUTE_PROBE_ARGUMENT_CHARS = 16 * 1024
const TRUSTED_WINDOWS_ROOT = 'C:\\Windows'
const TRUSTED_WINDOWS_SYSTEM32 = `${TRUSTED_WINDOWS_ROOT}\\System32`
const POSTGRES_ARCHIVE_TOOL_NAMES = Object.freeze(['pg_dump.exe', 'pg_restore.exe', 'psql.exe'])
const REQUIRED_POSTGRES_BIN_BY_NAME = new Map(
  REQUIRED_POSTGRES_BIN_MANIFEST.map((entry) => [entry.name, entry]),
)
const VERIFIED_POSTGRES_ARTIFACTS = new WeakSet()
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const ZIP_CENTRAL_DIRECTORY_ENTRY_SIGNATURE = 0x02014b50
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SNAPSHOT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,127}$/
const CONFIRMATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/
const SENSITIVE_KEY_PATTERN = /(?:password|secret|token|credential|service.?role|api.?key|connection.?string|database.?url)/i
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const LOCAL_PROBE_PASSTHROUGH_ENVIRONMENT_NAMES = new Set([
  'appdata',
  'box',
  'boxsync',
  'dropbox',
  'google_drive',
  'google_drive_fs',
  'googledrive',
  'googledrivefs',
  'homedrive',
  'homepath',
  'iclouddrive',
  'localappdata',
  'onedrive',
  'onedrivecommercial',
  'onedriveconsumer',
  'temp',
  'tmp',
  'userprofile',
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

function readExactArchiveRange(fileDescriptor, position, length) {
  if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(length) || length <= 0) {
    throw new Error('PostgreSQL portable archive contains an invalid byte range.')
  }
  const buffer = Buffer.allocUnsafe(length)
  let offset = 0
  try {
    while (offset < length) {
      const bytesRead = readSync(fileDescriptor, buffer, offset, length - offset, position + offset)
      if (bytesRead === 0) throw new Error('Unexpected end of archive.')
      offset += bytesRead
    }
  } catch {
    throw new Error('PostgreSQL portable archive cannot be inspected safely.')
  }
  return buffer
}

function parsePortablePostgresArchiveBinEntries(archivePath) {
  let archiveStatus
  try {
    archiveStatus = statSync(archivePath)
  } catch {
    throw new Error('PostgreSQL portable archive cannot be inspected safely.')
  }
  if (!archiveStatus.isFile() || archiveStatus.size < 22 || archiveStatus.size > MAX_POSTGRES_ARCHIVE_BYTES) {
    throw new Error('PostgreSQL portable archive has an invalid ZIP size.')
  }

  let fileDescriptor
  try {
    fileDescriptor = openSync(archivePath, 'r')
    const tailLength = Math.min(archiveStatus.size, 22 + 0xffff)
    const tailOffset = archiveStatus.size - tailLength
    const tail = readExactArchiveRange(fileDescriptor, tailOffset, tailLength)
    let endRecordOffset = -1
    for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
      if (tail.readUInt32LE(offset) !== ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue
      const commentLength = tail.readUInt16LE(offset + 20)
      if (offset + 22 + commentLength === tail.length) {
        endRecordOffset = offset
        break
      }
    }
    if (endRecordOffset < 0) {
      throw new Error('PostgreSQL portable archive lacks one exact ZIP directory record.')
    }

    const diskNumber = tail.readUInt16LE(endRecordOffset + 4)
    const centralDirectoryDisk = tail.readUInt16LE(endRecordOffset + 6)
    const diskEntryCount = tail.readUInt16LE(endRecordOffset + 8)
    const entryCount = tail.readUInt16LE(endRecordOffset + 10)
    const centralDirectorySize = tail.readUInt32LE(endRecordOffset + 12)
    const centralDirectoryOffset = tail.readUInt32LE(endRecordOffset + 16)
    const absoluteEndRecordOffset = tailOffset + endRecordOffset
    if (
      diskNumber !== 0
      || centralDirectoryDisk !== 0
      || diskEntryCount !== entryCount
      || entryCount === 0
      || entryCount === 0xffff
      || centralDirectorySize === 0
      || centralDirectorySize === 0xffffffff
      || centralDirectorySize > MAX_POSTGRES_ARCHIVE_CENTRAL_DIRECTORY_BYTES
      || centralDirectoryOffset === 0xffffffff
      || centralDirectoryOffset + centralDirectorySize !== absoluteEndRecordOffset
    ) {
      throw new Error('PostgreSQL portable archive uses an unsupported or ambiguous ZIP layout.')
    }

    const centralDirectory = readExactArchiveRange(
      fileDescriptor,
      centralDirectoryOffset,
      centralDirectorySize,
    )
    const binEntries = new Map()
    let binTotalBytes = 0
    let cursor = 0
    for (let index = 0; index < entryCount; index += 1) {
      if (
        cursor + 46 > centralDirectory.length
        || centralDirectory.readUInt32LE(cursor) !== ZIP_CENTRAL_DIRECTORY_ENTRY_SIGNATURE
      ) {
        throw new Error('PostgreSQL portable archive central directory is malformed.')
      }
      const versionMadeBy = centralDirectory.readUInt16LE(cursor + 4)
      const flags = centralDirectory.readUInt16LE(cursor + 8)
      const compressionMethod = centralDirectory.readUInt16LE(cursor + 10)
      const crc32 = centralDirectory.readUInt32LE(cursor + 16)
      const compressedSize = centralDirectory.readUInt32LE(cursor + 20)
      const uncompressedSize = centralDirectory.readUInt32LE(cursor + 24)
      const fileNameLength = centralDirectory.readUInt16LE(cursor + 28)
      const extraLength = centralDirectory.readUInt16LE(cursor + 30)
      const commentLength = centralDirectory.readUInt16LE(cursor + 32)
      const entryDisk = centralDirectory.readUInt16LE(cursor + 34)
      const externalAttributes = centralDirectory.readUInt32LE(cursor + 38)
      const localHeaderOffset = centralDirectory.readUInt32LE(cursor + 42)
      const entryEnd = cursor + 46 + fileNameLength + extraLength + commentLength
      if (fileNameLength === 0 || entryEnd > centralDirectory.length) {
        throw new Error('PostgreSQL portable archive central directory is malformed.')
      }
      const fileNameBytes = centralDirectory.subarray(cursor + 46, cursor + 46 + fileNameLength)
      const fileName = fileNameBytes.toString('utf8')
      const windowsNormalizedFileName = path.win32.normalize(fileName.replaceAll('/', '\\')).toLowerCase()
      const aliasesReviewedBin = windowsNormalizedFileName.startsWith('pgsql\\bin\\')
      const pathParts = fileName.split('/')
      const isReviewedBinPath = fileName.toLowerCase().startsWith('pgsql/bin/')
      if (aliasesReviewedBin && !isReviewedBinPath) {
        throw new Error('PostgreSQL portable archive contains a noncanonical reviewed bin path.')
      }
      if (isReviewedBinPath) {
        const binFileName = pathParts.at(-1)
        const normalizedBinFileName = binFileName?.toLowerCase()
        if (
          !binFileName
          || !normalizedBinFileName
          || fileNameBytes.some((value) => value > 0x7f)
          || Buffer.from(fileName, 'utf8').compare(fileNameBytes) !== 0
          || pathParts.length !== 3
          || pathParts[0] !== 'pgsql'
          || pathParts[1] !== 'bin'
          || pathParts.some((part) => !part || part === '.' || part === '..')
          || fileName.includes('\\')
          || fileName.includes('\0')
          || binFileName !== normalizedBinFileName
          || binFileName.length > 255
          || binFileName.endsWith('.')
          || !/^[a-z0-9][a-z0-9._-]*$/.test(binFileName)
          || /^(?:aux|com[1-9]|con|lpt[1-9]|nul|prn)(?:\.|$)/i.test(binFileName)
          || binEntries.has(normalizedBinFileName)
          || versionMadeBy !== 20
          || entryDisk !== 0
          || externalAttributes !== 0
          || flags !== 0
          || ![0, 8].includes(compressionMethod)
          || compressedSize === 0
          || compressedSize === 0xffffffff
          || compressedSize > MAX_POSTGRES_BIN_FILE_BYTES
          || uncompressedSize === 0
          || uncompressedSize === 0xffffffff
          || uncompressedSize > MAX_POSTGRES_BIN_FILE_BYTES
          || localHeaderOffset === 0xffffffff
        ) {
          throw new Error('PostgreSQL portable archive contains an unsafe or nested reviewed bin entry.')
        }
        binTotalBytes += uncompressedSize
        if (
          binEntries.size >= MAX_POSTGRES_BIN_FILE_COUNT
          || !Number.isSafeInteger(binTotalBytes)
          || binTotalBytes > MAX_POSTGRES_BIN_TOTAL_BYTES
        ) {
          throw new Error('PostgreSQL portable archive bin manifest exceeds its reviewed limits.')
        }
        binEntries.set(normalizedBinFileName, {
          binFileName,
          compressedSize,
          compressionMethod,
          crc32,
          fileNameBytes: Buffer.from(fileNameBytes),
          flags,
          localHeaderOffset,
          uncompressedSize,
        })
      }
      cursor = entryEnd
    }
    if (cursor !== centralDirectory.length) {
      throw new Error('PostgreSQL portable archive central directory has trailing ambiguity.')
    }
    if (
      binEntries.size === 0
      || POSTGRES_ARCHIVE_TOOL_NAMES.some((name) => !binEntries.has(name))
    ) {
      throw new Error('PostgreSQL portable archive does not contain one complete reviewed bin manifest.')
    }

    for (const entry of binEntries.values()) {
      const localHeader = readExactArchiveRange(fileDescriptor, entry.localHeaderOffset, 30)
      if (localHeader.readUInt32LE(0) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
        throw new Error('PostgreSQL portable archive contains an invalid reviewed bin file header.')
      }
      const localFlags = localHeader.readUInt16LE(6)
      const localCompressionMethod = localHeader.readUInt16LE(8)
      const localCrc32 = localHeader.readUInt32LE(14)
      const localCompressedSize = localHeader.readUInt32LE(18)
      const localUncompressedSize = localHeader.readUInt32LE(22)
      const localFileNameLength = localHeader.readUInt16LE(26)
      const localExtraLength = localHeader.readUInt16LE(28)
      const localFileName = readExactArchiveRange(
        fileDescriptor,
        entry.localHeaderOffset + 30,
        localFileNameLength,
      )
      const dataOffset = entry.localHeaderOffset + 30 + localFileNameLength + localExtraLength
      if (
        localFlags !== entry.flags
        || localCompressionMethod !== entry.compressionMethod
        || localCrc32 !== entry.crc32
        || localCompressedSize !== entry.compressedSize
        || localUncompressedSize !== entry.uncompressedSize
        || localFileName.compare(entry.fileNameBytes) !== 0
        || dataOffset + entry.compressedSize > centralDirectoryOffset
      ) {
        throw new Error('PostgreSQL portable archive reviewed bin file headers are inconsistent.')
      }
      entry.dataOffset = dataOffset
    }
    return binEntries
  } finally {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor)
  }
}

async function hashPortablePostgresArchiveBinEntry(archivePath, entry) {
  const source = createReadStream(archivePath, {
    start: entry.dataOffset,
    end: entry.dataOffset + entry.compressedSize - 1,
  })
  const content = entry.compressionMethod === 8 ? source.pipe(createInflateRaw()) : source
  const hash = createHash('sha256')
  let bytes = 0
  try {
    for await (const chunk of content) {
      bytes += chunk.length
      if (
        !Number.isSafeInteger(bytes)
        || bytes > entry.uncompressedSize
        || bytes > MAX_POSTGRES_BIN_FILE_BYTES
      ) {
        throw new Error('Archive bin entry exceeds its reviewed size limit.')
      }
      hash.update(chunk)
    }
  } catch {
    throw new Error('A reviewed PostgreSQL archive bin entry cannot be read safely.')
  } finally {
    source.destroy()
    if (content !== source) content.destroy()
  }
  if (bytes !== entry.uncompressedSize) {
    throw new Error('A reviewed PostgreSQL archive bin entry has an inconsistent byte length.')
  }
  return { bytes, sha256: hash.digest('hex') }
}

export async function verifyPostgresArchiveToolBinding({
  archivePath,
  pgDumpPath,
  pgRestorePath,
  psqlPath,
}) {
  const realArchivePath = requireRegularFilePath(archivePath, 'PostgreSQL portable archive')
  const selectedTools = new Map([
    ['pg_dump.exe', requireRegularFilePath(pgDumpPath, 'pg_dump executable')],
    ['pg_restore.exe', requireRegularFilePath(pgRestorePath, 'pg_restore executable')],
    ['psql.exe', requireRegularFilePath(psqlPath, 'psql executable')],
  ])
  const selectedBinDirectories = new Set(
    [...selectedTools.values()].map((toolPath) => normalizedPath(path.dirname(toolPath), 'win32')),
  )
  if (selectedBinDirectories.size !== 1) {
    throw new Error('Portable PostgreSQL executables must come from one exact bin directory.')
  }
  const realBinDirectory = requireRegularDirectory(path.dirname(pgDumpPath), 'Portable PostgreSQL bin directory')
  if (
    path.win32.basename(realBinDirectory).toLowerCase() !== 'bin'
    || path.win32.basename(path.win32.dirname(realBinDirectory)).toLowerCase() !== 'pgsql'
  ) {
    throw new Error('Portable PostgreSQL executables must use the reviewed pgsql bin layout.')
  }
  let binDirectoryEntries
  try {
    binDirectoryEntries = readdirSync(realBinDirectory, { withFileTypes: true })
  } catch {
    throw new Error('Portable PostgreSQL bin directory cannot be enumerated safely.')
  }
  if (
    binDirectoryEntries.length === 0
    || binDirectoryEntries.length > MAX_POSTGRES_BIN_FILE_COUNT
  ) {
    throw new Error('Portable PostgreSQL bin directory file count is outside the reviewed limit.')
  }
  const extractedBinFiles = new Map()
  for (const entry of binDirectoryEntries) {
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error('Portable PostgreSQL bin directory must contain direct regular files only.')
    }
    const normalizedName = entry.name.toLowerCase()
    if (extractedBinFiles.has(normalizedName)) {
      throw new Error('Portable PostgreSQL bin directory contains an ambiguous duplicate filename.')
    }
    const filePath = requireRegularFilePath(
      path.join(realBinDirectory, entry.name),
      'Portable PostgreSQL bin file',
    )
    if (normalizedPath(path.dirname(filePath), 'win32') !== normalizedPath(realBinDirectory, 'win32')) {
      throw new Error('Portable PostgreSQL bin file resolves outside its exact directory.')
    }
    extractedBinFiles.set(normalizedName, { fileName: entry.name, filePath })
  }

  const archiveEntries = parsePortablePostgresArchiveBinEntries(realArchivePath)
  if (
    archiveEntries.size !== REQUIRED_POSTGRES_BIN_MANIFEST.length
    || REQUIRED_POSTGRES_BIN_MANIFEST.some((requiredEntry) => {
      const archiveEntry = archiveEntries.get(requiredEntry.name)
      return (
        !archiveEntry
        || archiveEntry.binFileName !== requiredEntry.name
        || archiveEntry.uncompressedSize !== requiredEntry.bytes
      )
    })
  ) {
    throw new Error('PostgreSQL portable archive bin layout does not match the pinned official 17.11 manifest.')
  }
  if (
    archiveEntries.size !== extractedBinFiles.size
    || [...archiveEntries].some(([name, entry]) => (
      !extractedBinFiles.has(name)
      || extractedBinFiles.get(name).fileName !== entry.binFileName
    ))
  ) {
    throw new Error('Portable PostgreSQL extracted bin file set does not match the exact official archive manifest.')
  }
  for (const [toolName, toolPath] of selectedTools) {
    if (normalizedPath(extractedBinFiles.get(toolName)?.filePath, 'win32') !== normalizedPath(toolPath, 'win32')) {
      throw new Error('A selected PostgreSQL executable is not the exact reviewed bin file.')
    }
  }

  const toolSha256 = {}
  const binManifest = []
  let verifiedBinBytes = 0
  for (const [binFileName, archiveEntry] of archiveEntries) {
    const extractedEntry = extractedBinFiles.get(binFileName)
    const requiredEntry = REQUIRED_POSTGRES_BIN_BY_NAME.get(binFileName)
    const [archiveFile, extractedFile] = await Promise.all([
      hashPortablePostgresArchiveBinEntry(realArchivePath, archiveEntry),
      hashStableRegularFile(extractedEntry.filePath, {
        label: 'Portable PostgreSQL bin file',
        maxBytes: MAX_POSTGRES_BIN_FILE_BYTES,
      }),
    ])
    if (
      !requiredEntry
      || archiveFile.bytes !== requiredEntry.bytes
      || archiveFile.sha256 !== requiredEntry.sha256
      || extractedFile.bytes !== requiredEntry.bytes
      || extractedFile.sha256 !== requiredEntry.sha256
    ) {
      throw new Error('Portable PostgreSQL bin content does not match the pinned official 17.11 manifest.')
    }
    verifiedBinBytes += extractedFile.bytes
    if (!Number.isSafeInteger(verifiedBinBytes) || verifiedBinBytes > MAX_POSTGRES_BIN_TOTAL_BYTES) {
      throw new Error('Portable PostgreSQL verified bin bytes exceed the reviewed limit.')
    }
    if (selectedTools.has(binFileName)) {
      toolSha256[binFileName] = requiredEntry.sha256
    }
    binManifest.push(requiredEntry)
  }
  let confirmedBinEntries
  try {
    confirmedBinEntries = readdirSync(realBinDirectory, { withFileTypes: true })
  } catch {
    throw new Error('Portable PostgreSQL bin directory cannot be re-enumerated safely.')
  }
  if (
    confirmedBinEntries.length !== extractedBinFiles.size
    || confirmedBinEntries.some((entry) => {
      if (entry.isSymbolicLink() || !entry.isFile()) return true
      const expected = extractedBinFiles.get(entry.name.toLowerCase())
      if (!expected || expected.fileName !== entry.name) return true
      try {
        return normalizedPath(
          requireRegularFilePath(path.join(realBinDirectory, entry.name), 'Portable PostgreSQL bin file'),
          'win32',
        ) !== normalizedPath(expected.filePath, 'win32')
      } catch {
        return true
      }
    })
  ) {
    throw new Error('Portable PostgreSQL bin directory changed while its archive binding was verified.')
  }
  if (
    binManifest.length !== REQUIRED_POSTGRES_BIN_MANIFEST.length
    || binManifest.some((entry) => REQUIRED_POSTGRES_BIN_BY_NAME.get(entry.name) !== entry)
  ) {
    throw new Error('Portable PostgreSQL bin verification did not cover the pinned official manifest exactly once.')
  }
  return { binManifest: REQUIRED_POSTGRES_BIN_MANIFEST, toolSha256 }
}

export async function verifyPostgresBinReparseAttributes({
  binDirectory,
  runner = executeReadOnlyProbe,
}) {
  const realBinDirectory = requireRegularDirectory(binDirectory, 'Portable PostgreSQL bin directory')
  const reparseStatus = (await runTrustedPowerShell(
    runner,
    "$directory = Get-Item -LiteralPath $args[0] -Force -ErrorAction Stop; $reparse = [IO.FileAttributes]::ReparsePoint; if (-not $directory.PSIsContainer -or (($directory.Attributes -band $reparse) -ne 0)) { 'reparse'; exit }; foreach ($item in @(Get-ChildItem -LiteralPath $directory.FullName -Force -ErrorAction Stop)) { if ($item.PSIsContainer -or (($item.Attributes -band $reparse) -ne 0)) { 'reparse'; exit } }; 'clear'",
    realBinDirectory,
  )).trim()
  if (reparseStatus !== 'clear') {
    throw new Error('Portable PostgreSQL bin directory reparse status is not unambiguously clear.')
  }
  return { reparseStatus }
}

export async function verifyPostgresPortableArtifacts({
  pgDumpPath,
  pgRestorePath,
  psqlPath,
  archivePath,
  allowedRoot,
  platform = process.platform,
  runner,
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
  const binding = await verifyPostgresArchiveToolBinding({
    archivePath: realArchivePath,
    pgDumpPath: selectedTools[0][1],
    pgRestorePath: selectedTools[1][1],
    psqlPath: selectedTools[2][1],
  })
  await verifyPostgresBinReparseAttributes({
    binDirectory: path.win32.dirname(selectedTools[0][1]),
    runner,
  })
  const confirmedArchive = await hashStableRegularFile(realArchivePath, {
    label: 'PostgreSQL portable archive',
    maxBytes: MAX_POSTGRES_ARCHIVE_BYTES,
  })
  if (
    confirmedArchive.bytes !== archive.bytes
    || confirmedArchive.sha256 !== REQUIRED_POSTGRES_ARCHIVE_SHA256
  ) {
    throw new Error('PostgreSQL portable archive changed while its executable binding was verified.')
  }
  const verifiedArtifacts = Object.freeze({
    archiveSha256: archive.sha256,
    binDirectory: path.win32.dirname(selectedTools[0][1]),
    binManifest: binding.binManifest,
    pgDumpPath: selectedTools[0][1],
    pgRestorePath: selectedTools[1][1],
    psqlPath: selectedTools[2][1],
  })
  VERIFIED_POSTGRES_ARTIFACTS.add(verifiedArtifacts)
  return verifiedArtifacts
}

function enumerateRegularFiles(rootDirectory) {
  const files = new Map()
  const directories = new Map([['', rootDirectory]])
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
        const relativeDirectory = path.relative(rootDirectory, realDirectory).split(path.sep).join('/')
        safeStoragePath(relativeDirectory, 'R2 restore material relative directory')
        if (directories.has(relativeDirectory)) {
          throw new Error('R2 restore material contains a duplicate directory path.')
        }
        directories.set(relativeDirectory, realDirectory)
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
  return { directories, files }
}

function exactRegularFileState(filePath, label) {
  let linkStatus
  let status
  let realPath
  try {
    linkStatus = lstatSync(filePath)
    status = statSync(filePath)
    realPath = realpathSync.native(filePath)
  } catch {
    throw new Error(`${label} cannot be inspected.`)
  }
  if (
    linkStatus.isSymbolicLink()
    || !linkStatus.isFile()
    || !status.isFile()
    || normalizedPath(filePath) !== normalizedPath(realPath)
  ) {
    throw new Error(`${label} must remain one exact regular non-reparse file.`)
  }
  return { realPath, status }
}

function sameFileIdentity(left, right) {
  return [
    'dev',
    'ino',
    'mode',
    'nlink',
    'size',
    'mtimeMs',
    'ctimeMs',
    'birthtimeMs',
  ].every((property) => left[property] === right[property])
}

async function hashStableRegularFile(filePath, {
  label = 'R2 restore material body',
  maxBytes = Number.MAX_SAFE_INTEGER,
} = {}) {
  const before = exactRegularFileState(filePath, label)
  if (
    !Number.isSafeInteger(before.status.size)
    || before.status.size <= 0
    || before.status.size > maxBytes
  ) {
    throw new Error(`${label} must be a non-empty regular file within the reviewed size limit.`)
  }
  const hash = createHash('sha256')
  let fileDescriptor
  let opened
  let afterOpened
  try {
    fileDescriptor = openSync(before.realPath, 'r')
    opened = fstatSync(fileDescriptor)
    if (!sameFileIdentity(before.status, opened)) throw new Error('identity changed')
    for await (const chunk of createReadStream(before.realPath, {
      autoClose: false,
      fd: fileDescriptor,
    })) hash.update(chunk)
    afterOpened = fstatSync(fileDescriptor)
  } catch {
    throw new Error(`${label} cannot be read.`)
  } finally {
    if (fileDescriptor !== undefined) closeSync(fileDescriptor)
  }
  let afterDescriptor
  try {
    afterDescriptor = statSync(before.realPath)
  } catch {
    throw new Error(`${label} cannot be inspected after hashing.`)
  }
  const after = exactRegularFileState(filePath, label)
  if (
    !sameFileIdentity(before.status, opened)
    || !sameFileIdentity(before.status, afterOpened)
    || !sameFileIdentity(before.status, afterDescriptor)
    || !sameFileIdentity(before.status, after.status)
    || normalizedPath(before.realPath) !== normalizedPath(after.realPath)
  ) {
    throw new Error(`${label} changed while it was being verified.`)
  }
  return { bytes: after.status.size, sha256: hash.digest('hex') }
}

export async function verifyR2RestoreMaterial({
  manifest,
  bodyRoot,
  workDirectory,
  encryptionProvider,
  runner,
}) {
  if (!isRecord(manifest) || typeof manifest.snapshotId !== 'string') {
    throw new Error('A verified R2 manifest is required before body verification.')
  }
  if (!['bitlocker', 'efs'].includes(encryptionProvider)) {
    throw new Error('R2 restore material requires an exact recovery encryption provider.')
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

  await verifyWindowsTreeNoReparse({ rootDirectories: [realBodyRoot], runner })
  const initialTree = enumerateRegularFiles(realBodyRoot)
  const { directories, files } = initialTree
  await verifyWindowsNoReparsePaths({
    directoryPaths: [...directories.values()],
    filePaths: [...files.values()],
    ancestorRoot: realBodyRoot,
    runner,
  })
  if (encryptionProvider === 'efs') {
    await verifyEfsEncryptedFiles({ filePaths: [...files.values()], runner })
  }
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
  await verifyWindowsTreeNoReparse({ rootDirectories: [realBodyRoot], runner })
  const confirmedTree = enumerateRegularFiles(realBodyRoot)
  const treeChanged = (
    confirmedTree.files.size !== files.size
    || confirmedTree.directories.size !== directories.size
    || [...files].some(([relativePath, filePath]) => (
      normalizedPath(confirmedTree.files.get(relativePath) ?? '') !== normalizedPath(filePath)
    ))
    || [...directories].some(([relativePath, directoryPath]) => (
      normalizedPath(confirmedTree.directories.get(relativePath) ?? '') !== normalizedPath(directoryPath)
    ))
  )
  if (treeChanged) throw new Error('R2 restore material tree changed while it was being verified.')
  await verifyWindowsNoReparsePaths({
    directoryPaths: [...confirmedTree.directories.values()],
    filePaths: [...confirmedTree.files.values()],
    ancestorRoot: realBodyRoot,
    runner,
  })
  if (encryptionProvider === 'efs') {
    await verifyEfsEncryptedFiles({ filePaths: [...confirmedTree.files.values()], runner })
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
    if (
      isSameOrWithin(realPath, syncRoot, platform)
      || isSameOrWithin(syncRoot, realPath, platform)
    ) {
      throw new Error('Recovery work directory must not overlap a configured synchronization root.')
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
  windowsPowerShell,
  supabase,
  pgDump,
  pgRestore,
  psql,
}, targetPostgresMajor) {
  const windowsPowerShellVersion = parseSemver(windowsPowerShell, 'Windows PowerShell')
  if (!windowsPowerShellVersion.startsWith('5.1.')) {
    throw new Error('Trusted 64-bit Windows PowerShell 5.1 is required.')
  }
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
    windowsPowerShellVersion,
    supabaseVersion,
    pgDumpVersion,
    pgRestoreVersion,
    psqlVersion,
  }
}

async function executeReadOnlyProbe(executable, args, standardInput = '') {
  if (
    process.platform !== 'win32'
    || typeof executable !== 'string'
    || normalizedPath(executable, 'win32') !== normalizedPath(TRUSTED_WINDOWS_POWERSHELL_PATH, 'win32')
  ) {
    throw new Error('Only the reviewed absolute Windows PowerShell executable may run local probes.')
  }
  const realExecutable = requireRegularFilePath(executable, 'Trusted Windows PowerShell executable')
  if (normalizedPath(realExecutable, 'win32') !== normalizedPath(TRUSTED_WINDOWS_POWERSHELL_PATH, 'win32')) {
    throw new Error('Trusted Windows PowerShell resolved outside its reviewed system path.')
  }
  const localEnvironment = {
    ComSpec: `${TRUSTED_WINDOWS_SYSTEM32}\\cmd.exe`,
    Path: `${TRUSTED_WINDOWS_SYSTEM32};${TRUSTED_WINDOWS_ROOT}`,
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    PSModulePath: `${TRUSTED_WINDOWS_SYSTEM32}\\WindowsPowerShell\\v1.0\\Modules`,
    SystemRoot: TRUSTED_WINDOWS_ROOT,
    TEMP: `${TRUSTED_WINDOWS_ROOT}\\Temp`,
    TMP: `${TRUSTED_WINDOWS_ROOT}\\Temp`,
    WINDIR: TRUSTED_WINDOWS_ROOT,
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (
      LOCAL_PROBE_PASSTHROUGH_ENVIRONMENT_NAMES.has(name.toLowerCase())
      && typeof value === 'string'
      && value.length > 0
      && !['temp', 'tmp'].includes(name.toLowerCase())
    ) {
      localEnvironment[name] = value
    }
  }
  const expectedArguments = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-Command', '-']
  if (
    !Array.isArray(args)
    || args.length !== expectedArguments.length
    || args.some((argument, index) => argument !== expectedArguments[index])
    || typeof standardInput !== 'string'
    || standardInput.length === 0
  ) {
    throw new Error('Trusted Windows PowerShell must use the reviewed standard-input invocation.')
  }
  return new Promise((resolve, reject) => {
    const child = spawn(realExecutable, args, {
      cwd: TRUSTED_WINDOWS_SYSTEM32,
      env: localEnvironment,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const output = []
    let outputBytes = 0
    let settled = false
    const fail = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.kill()
      reject(new Error('A required read-only local prerequisite probe failed.'))
    }
    const timeout = setTimeout(fail, 45_000)
    child.once('error', fail)
    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length
      if (outputBytes > 1024 * 1024) {
        fail()
        return
      }
      output.push(chunk)
    })
    child.stderr.on('data', () => {})
    child.once('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (code !== 0) {
        reject(new Error('A required read-only local prerequisite probe failed.'))
        return
      }
      resolve(Buffer.concat(output).toString('utf8'))
    })
    child.stdin.on('error', fail)
    child.stdin.end(standardInput, 'utf8')
  })
}

function trustedPowerShellInvocation(script, values) {
  const encodedValues = Buffer.from(JSON.stringify(values), 'utf8').toString('base64')
  return [
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-Command', '-'],
    `$__decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedValues}')) | ConvertFrom-Json -ErrorAction Stop\n$__values = @()\nforeach ($__value in $__decoded) { $__values += [string]$__value }\n& { ${script} } @__values\n`,
  ]
}

async function runTrustedPowerShell(runner, script, ...values) {
  const [args, standardInput] = trustedPowerShellInvocation(script, values)
  return runner(TRUSTED_WINDOWS_POWERSHELL_PATH, args, standardInput)
}

export async function probeTrustedWindowsPowerShell({
  runner = executeReadOnlyProbe,
} = {}) {
  const output = (await runTrustedPowerShell(
    runner,
    "$ErrorActionPreference = 'Stop'; $expected = [IO.Path]::GetFullPath($args[0]); $processPath = [IO.Path]::GetFullPath((Get-Process -Id $PID -ErrorAction Stop).Path); $item = Get-Item -LiteralPath $processPath -Force -ErrorAction Stop; $signature = Get-AuthenticodeSignature -LiteralPath $processPath -ErrorAction Stop; $microsoftSigner = $null -ne $signature.SignerCertificate -and $signature.SignerCertificate.Subject -match '(^|, )O=Microsoft Corporation(,|$)'; $trustedRuntime = $PSVersionTable.PSEdition -eq 'Desktop' -and $PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSVersion.Minor -eq 1 -and [Environment]::Is64BitProcess; if (-not [string]::Equals($processPath, $expected, [StringComparison]::OrdinalIgnoreCase) -or $item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) -or $signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or -not $microsoftSigner -or -not $trustedRuntime) { 'untrusted'; exit }; 'trusted|' + $PSVersionTable.PSVersion.ToString() + '|Desktop|True'",
    TRUSTED_WINDOWS_POWERSHELL_PATH,
  )).trim()
  const match = output.match(/^trusted\|(5\.1(?:\.\d+){0,2})\|Desktop\|True$/)
  if (!match) {
    throw new Error('The absolute Windows PowerShell prerequisite is not Microsoft-signed and trusted.')
  }
  return { windowsPowerShellVersion: parseSemver(match[1], 'Windows PowerShell') }
}

export async function verifyWindowsNoReparsePaths({
  filePaths = [],
  directoryPaths = [],
  ancestorRoot,
  runner = executeReadOnlyProbe,
}) {
  if (!Array.isArray(filePaths) || !Array.isArray(directoryPaths) || filePaths.length + directoryPaths.length === 0) {
    throw new Error('Windows reparse protection requires selected files or directories.')
  }
  const selected = [
    ...directoryPaths.map((selectedPath) => ({
      kind: 'directory',
      path: requireRegularDirectory(selectedPath, 'Selected Windows recovery directory'),
    })),
    ...filePaths.map((selectedPath) => ({
      kind: 'file',
      path: requireRegularFilePath(selectedPath, 'Selected Windows recovery file'),
    })),
  ]
  const normalizedSelected = selected.map((item) => `${item.kind}:${normalizedPath(item.path, 'win32')}`)
  if (new Set(normalizedSelected).size !== normalizedSelected.length) {
    throw new Error('Windows reparse protection inputs must identify distinct exact paths.')
  }
  let realAncestorRoot
  if (ancestorRoot !== undefined) {
    realAncestorRoot = requireRegularDirectory(ancestorRoot, 'Windows recovery ancestor root')
    if (selected.some((item) => !isSameOrWithin(item.path, realAncestorRoot, 'win32'))) {
      throw new Error('Windows reparse protection paths must remain inside their selected ancestor root.')
    }
  }
  const script = "$ErrorActionPreference = 'Stop'; $payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($args[0])) | ConvertFrom-Json -ErrorAction Stop; $root = if ($null -eq $payload.ancestorRoot) { $null } else { [IO.Path]::GetFullPath([string]$payload.ancestorRoot) }; $reparse = [IO.FileAttributes]::ReparsePoint; foreach ($entry in $payload.selected) { $expected = [IO.Path]::GetFullPath([string]$entry.path); $item = Get-Item -LiteralPath $expected -Force -ErrorAction Stop; $exact = [string]::Equals([IO.Path]::GetFullPath($item.FullName), $expected, [StringComparison]::OrdinalIgnoreCase); $rightKind = (($entry.kind -eq 'directory' -and $item.PSIsContainer) -or ($entry.kind -eq 'file' -and -not $item.PSIsContainer)); if (-not $exact -or -not $rightKind -or (($item.Attributes -band $reparse) -ne 0)) { 'reparse'; exit }; $current = if ($item.PSIsContainer) { $item } else { $item.Directory }; while ($null -ne $current) { if (($current.Attributes -band $reparse) -ne 0) { 'reparse'; exit }; if ($null -ne $root -and [string]::Equals([IO.Path]::GetFullPath($current.FullName), $root, [StringComparison]::OrdinalIgnoreCase)) { break }; $current = $current.Parent }; if ($null -ne $root -and $null -eq $current) { 'reparse'; exit } }; 'clear'"
  const batches = []
  let batch = []
  for (const item of selected) {
    const candidate = [...batch, item]
    const encodedLength = Buffer.byteLength(JSON.stringify({
      ancestorRoot: realAncestorRoot,
      selected: candidate,
    }), 'utf8') * 2
    if (
      candidate.length > MAX_WINDOWS_ATTRIBUTE_PROBE_ITEMS_PER_CALL
      || encodedLength + script.length > MAX_WINDOWS_ATTRIBUTE_PROBE_ARGUMENT_CHARS
    ) {
      if (batch.length === 0) throw new Error('A selected Windows recovery path exceeds the safe probe limit.')
      batches.push(batch)
      batch = [item]
    } else {
      batch = candidate
    }
  }
  if (batch.length > 0) batches.push(batch)

  for (const selectedBatch of batches) {
    const encoded = Buffer.from(JSON.stringify({
      ancestorRoot: realAncestorRoot,
      selected: selectedBatch,
    }), 'utf8').toString('base64')
    const status = (await runTrustedPowerShell(runner, script, encoded)).trim()
    if (status !== 'clear') {
      throw new Error('Every selected recovery file and directory must have a clear Windows reparse attribute.')
    }
  }
  return { inspectedPathCount: selected.length }
}

export async function verifyWindowsTreeNoReparse({
  rootDirectories,
  runner = executeReadOnlyProbe,
}) {
  if (!Array.isArray(rootDirectories) || rootDirectories.length === 0) {
    throw new Error('Windows recursive reparse protection requires selected root directories.')
  }
  const roots = rootDirectories.map((rootDirectory) => (
    requireRegularDirectory(rootDirectory, 'Windows recursive recovery root')
  ))
  if (new Set(roots.map((root) => normalizedPath(root, 'win32'))).size !== roots.length) {
    throw new Error('Windows recursive reparse roots must be distinct exact directories.')
  }
  const script = "$ErrorActionPreference = 'Stop'; $roots = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($args[0])) | ConvertFrom-Json -ErrorAction Stop; $reparse = [IO.FileAttributes]::ReparsePoint; foreach ($selectedRoot in $roots) { $root = [IO.Path]::GetFullPath([string]$selectedRoot); $rootItem = Get-Item -LiteralPath $root -Force -ErrorAction Stop; if (-not $rootItem.PSIsContainer -or (($rootItem.Attributes -band $reparse) -ne 0) -or -not [string]::Equals([IO.Path]::GetFullPath($rootItem.FullName), $root, [StringComparison]::OrdinalIgnoreCase)) { 'reparse'; exit }; $queue = New-Object 'System.Collections.Generic.Queue[System.IO.DirectoryInfo]'; $queue.Enqueue($rootItem); while ($queue.Count -gt 0) { $directory = $queue.Dequeue(); foreach ($item in @(Get-ChildItem -LiteralPath $directory.FullName -Force -ErrorAction Stop)) { if (($item.Attributes -band $reparse) -ne 0 -or -not [string]::Equals([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($item.FullName)), $directory.FullName, [StringComparison]::OrdinalIgnoreCase)) { 'reparse'; exit }; if ($item.PSIsContainer) { $queue.Enqueue($item) } } } }; 'clear'"
  for (let index = 0; index < roots.length; index += MAX_WINDOWS_ATTRIBUTE_PROBE_ITEMS_PER_CALL) {
    const batch = roots.slice(index, index + MAX_WINDOWS_ATTRIBUTE_PROBE_ITEMS_PER_CALL)
    const encoded = Buffer.from(JSON.stringify(batch), 'utf8').toString('base64')
    if (encoded.length + script.length > MAX_WINDOWS_ATTRIBUTE_PROBE_ARGUMENT_CHARS) {
      throw new Error('A Windows recursive reparse root batch exceeds the safe probe limit.')
    }
    const status = (await runTrustedPowerShell(runner, script, encoded)).trim()
    if (status !== 'clear') {
      throw new Error('Every recursive recovery directory and file must have a clear Windows reparse attribute.')
    }
  }
  return { inspectedRootCount: roots.length }
}

export async function verifyEfsEncryptedFiles({
  filePaths,
  runner = executeReadOnlyProbe,
}) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error('EFS file protection requires every selected recovery file.')
  }
  const realFilePaths = filePaths.map((filePath) => (
    requireRegularFilePath(filePath, 'Selected EFS recovery file')
  ))
  if (new Set(realFilePaths.map((filePath) => normalizedPath(filePath, 'win32'))).size !== realFilePaths.length) {
    throw new Error('EFS file protection inputs must identify distinct exact files.')
  }
  const script = "$encrypted = [IO.FileAttributes]::Encrypted; foreach ($selectedPath in $args) { $item = Get-Item -LiteralPath $selectedPath -Force -ErrorAction Stop; if ($item.PSIsContainer -or (($item.Attributes -band $encrypted) -eq 0)) { 'unprotected'; exit } }; 'protected'"
  const fixedArgumentChars = script.length
  const batches = []
  let batch = []
  let batchArgumentChars = fixedArgumentChars
  for (const filePath of realFilePaths) {
    const estimatedArgumentChars = (filePath.length * 2) + 3
    if (fixedArgumentChars + estimatedArgumentChars > MAX_EFS_PROBE_ARGUMENT_CHARS) {
      throw new Error('A selected EFS recovery file path exceeds the safe local probe limit.')
    }
    if (
      batch.length >= MAX_EFS_PROBE_FILES_PER_CALL
      || batchArgumentChars + estimatedArgumentChars > MAX_EFS_PROBE_ARGUMENT_CHARS
    ) {
      batches.push(batch)
      batch = []
      batchArgumentChars = fixedArgumentChars
    }
    batch.push(filePath)
    batchArgumentChars += estimatedArgumentChars
  }
  if (batch.length > 0) batches.push(batch)

  for (const selectedFiles of batches) {
    const encryptionStatus = (await runTrustedPowerShell(runner, script, ...selectedFiles)).trim()
    if (encryptionStatus !== 'protected') {
      throw new Error('Every selected recovery evidence and body file must have the EFS Encrypted attribute.')
    }
  }
  return { encryptedFileCount: realFilePaths.length }
}

function verifyPinnedPostgresToolVersions({ postgresTools }) {
  if (
    !isRecord(postgresTools)
    || !VERIFIED_POSTGRES_ARTIFACTS.has(postgresTools)
    || typeof postgresTools.binDirectory !== 'string'
    || !Array.isArray(postgresTools.binManifest)
    || postgresTools.binManifest.length !== REQUIRED_POSTGRES_BIN_MANIFEST.length
  ) {
    throw new Error('An internally attested pinned official PostgreSQL artifact result is required.')
  }
  const suppliedByName = new Map()
  for (const entry of postgresTools.binManifest) {
    assertExactKeys(entry, ['bytes', 'name', 'sha256'], 'Pinned PostgreSQL bin manifest entry')
    if (
      typeof entry.name !== 'string'
      || !Number.isSafeInteger(entry.bytes)
      || typeof entry.sha256 !== 'string'
      || suppliedByName.has(entry.name)
    ) {
      throw new Error('The pinned official PostgreSQL bin manifest is malformed or ambiguous.')
    }
    suppliedByName.set(entry.name, entry)
  }
  if (REQUIRED_POSTGRES_BIN_MANIFEST.some((requiredEntry) => {
    const supplied = suppliedByName.get(requiredEntry.name)
    return (
      !supplied
      || supplied.bytes !== requiredEntry.bytes
      || supplied.sha256 !== requiredEntry.sha256
    )
  })) {
    throw new Error('PostgreSQL tools are not bound to the pinned official 17.11 bin manifest.')
  }

  const realBinDirectory = requireRegularDirectory(
    postgresTools.binDirectory,
    'Portable PostgreSQL bin directory',
  )
  for (const [property, executableName] of [
    ['pgDumpPath', 'pg_dump.exe'],
    ['pgRestorePath', 'pg_restore.exe'],
    ['psqlPath', 'psql.exe'],
  ]) {
    const expectedPath = path.win32.join(realBinDirectory, executableName)
    if (
      typeof postgresTools[property] !== 'string'
      || normalizedPath(postgresTools[property], 'win32') !== normalizedPath(expectedPath, 'win32')
      || normalizedPath(
        requireRegularFilePath(postgresTools[property], `Pinned PostgreSQL ${executableName}`),
        'win32',
      ) !== normalizedPath(expectedPath, 'win32')
    ) {
      throw new Error('A PostgreSQL tool path is not bound to the pinned official bin manifest.')
    }
  }

  return {
    pgDump: `pg_dump (PostgreSQL) ${REQUIRED_POSTGRES_TOOL_VERSION.replace(/\.0$/, '')}`,
    pgRestore: `pg_restore (PostgreSQL) ${REQUIRED_POSTGRES_TOOL_VERSION.replace(/\.0$/, '')}`,
    psql: `psql (PostgreSQL) ${REQUIRED_POSTGRES_TOOL_VERSION.replace(/\.0$/, '')}`,
  }
}
export function verifyLocalSupabaseCliPackage({ repositoryRoot }) {
  const realRepositoryRoot = requireRegularDirectory(repositoryRoot, 'Repository root')
  const rootPackagePath = path.join(realRepositoryRoot, 'package.json')
  const packagePath = path.join(realRepositoryRoot, 'node_modules', 'supabase', 'package.json')
  const lockPath = path.join(realRepositoryRoot, 'package-lock.json')
  const rootPackageMetadata = parseJson(
    readBoundedFile(rootPackagePath, 'Repository npm package metadata', MAX_SMALL_EVIDENCE_BYTES),
    'Repository npm package metadata',
  )
  const packageMetadata = parseJson(
    readBoundedFile(packagePath, 'Local Supabase CLI package metadata', MAX_SMALL_EVIDENCE_BYTES),
    'Local Supabase CLI package metadata',
  )
  const lockMetadata = parseJson(
    readBoundedFile(lockPath, 'Repository npm lockfile', MAX_MANIFEST_BYTES),
    'Repository npm lockfile',
  )
  const lockedRoot = lockMetadata?.packages?.['']
  const lockedPackage = lockMetadata?.packages?.['node_modules/supabase']
  const dependencyDeclarations = [
    lockedRoot?.devDependencies?.supabase,
    lockedRoot?.dependencies?.supabase,
    lockedRoot?.optionalDependencies?.supabase,
    lockedRoot?.peerDependencies?.supabase,
  ].filter((value) => value !== undefined)
  if (
    rootPackageMetadata?.devDependencies?.supabase !== REQUIRED_SUPABASE_CLI_VERSION
    || rootPackageMetadata?.dependencies?.supabase !== undefined
    || rootPackageMetadata?.optionalDependencies?.supabase !== undefined
    || rootPackageMetadata?.peerDependencies?.supabase !== undefined
    || packageMetadata?.name !== 'supabase'
    || packageMetadata?.version !== REQUIRED_SUPABASE_CLI_VERSION
    || dependencyDeclarations.length !== 1
    || dependencyDeclarations[0] !== REQUIRED_SUPABASE_CLI_VERSION
    || lockedRoot?.dependencies?.supabase !== undefined
    || lockedRoot?.optionalDependencies?.supabase !== undefined
    || lockedRoot?.peerDependencies?.supabase !== undefined
    || lockedPackage?.version !== REQUIRED_SUPABASE_CLI_VERSION
    || lockedPackage?.resolved !== `https://registry.npmjs.org/supabase/-/supabase-${REQUIRED_SUPABASE_CLI_VERSION}.tgz`
    || lockedPackage?.integrity !== REQUIRED_SUPABASE_CLI_INTEGRITY
  ) {
    throw new Error(`A project-local, exactly locked Supabase CLI ${REQUIRED_SUPABASE_CLI_VERSION} package is required.`)
  }
  return { supabaseVersion: REQUIRED_SUPABASE_CLI_VERSION }
}

export async function probeRecoveryWorkDirectoryProtection({
  volumeRoot,
  workDirectory,
  encryptionProvider,
  efsProbeFile,
  runner = executeReadOnlyProbe,
}) {
  if (
    (encryptionProvider === 'efs' && (
      typeof efsProbeFile !== 'string' || !path.win32.isAbsolute(efsProbeFile)
    ))
    || (encryptionProvider === 'bitlocker' && efsProbeFile !== undefined)
  ) {
    throw new Error('Encryption probe inputs do not match the selected provider.')
  }
  const { windowsPowerShellVersion } = await probeTrustedWindowsPowerShell({ runner })
  let encryptionStatus
  if (encryptionProvider === 'bitlocker') {
    encryptionStatus = (await runTrustedPowerShell(
      runner,
      "$volume = Get-BitLockerVolume -MountPoint $args[0] -ErrorAction Stop; if ($volume.ProtectionStatus -eq 'On') { 'protected' } else { 'unprotected' }",
      volumeRoot,
    )).trim()
  } else if (encryptionProvider === 'efs') {
    encryptionStatus = (await runTrustedPowerShell(
      runner,
      "$directory = Get-Item -LiteralPath $args[0] -Force -ErrorAction Stop; $probe = Get-Item -LiteralPath $args[1] -Force -ErrorAction Stop; $encrypted = [IO.FileAttributes]::Encrypted; $directChild = [string]::Equals([IO.Path]::GetDirectoryName($probe.FullName), $directory.FullName, [StringComparison]::OrdinalIgnoreCase); $ageMinutes = ([DateTime]::UtcNow - $probe.CreationTimeUtc).TotalMinutes; $fresh = $ageMinutes -ge -1 -and $ageMinutes -le 30; if ($directory.PSIsContainer -and -not $probe.PSIsContainer -and $directChild -and $fresh -and (($directory.Attributes -band $encrypted) -ne 0) -and (($probe.Attributes -band $encrypted) -ne 0)) { 'protected' } else { 'unprotected' }",
      workDirectory,
      efsProbeFile,
    )).trim()
  } else {
    throw new Error('Recovery encryption provider is unsupported.')
  }
  if (encryptionStatus !== 'protected') {
    throw new Error('Recovery encryption probe did not return protected status.')
  }
  const reparseStatus = (await runTrustedPowerShell(
    runner,
    "$item = Get-Item -LiteralPath $args[0] -Force -ErrorAction Stop; while ($null -ne $item) { if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { 'reparse'; exit }; $item = $item.Parent }; 'clear'",
    workDirectory,
  )).trim()
  if (reparseStatus !== 'clear') {
    throw new Error('Recovery work directory reparse probe did not return clear status.')
  }
  const syncProbeStatus = (await runTrustedPowerShell(
    runner,
    "$ErrorActionPreference = 'Stop'; try { $target = [IO.Path]::GetFullPath($args[0]).TrimEnd('\\') + '\\'; $roots = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase); @($env:OneDrive, $env:OneDriveConsumer, $env:OneDriveCommercial, $env:Dropbox, $env:Box, $env:BoxSync, $env:GoogleDrive, $env:GoogleDriveFS, $env:Google_Drive, $env:Google_Drive_FS, $env:iCloudDrive) | Where-Object { $_ } | ForEach-Object { [void]$roots.Add($_) }; $manager = 'Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\SyncRootManager'; if (Test-Path -LiteralPath $manager) { foreach ($provider in @(Get-ChildItem -LiteralPath $manager -Force -ErrorAction Stop)) { foreach ($item in @($provider) + @(Get-ChildItem -LiteralPath $provider.PSPath -Recurse -Force -ErrorAction Stop)) { $properties = Get-ItemProperty -LiteralPath $item.PSPath -ErrorAction Stop; foreach ($property in $properties.PSObject.Properties) { foreach ($value in @($property.Value)) { if ($value -is [string]) { $pathRoot = [IO.Path]::GetPathRoot($value); $separator = [IO.Path]::DirectorySeparatorChar; $driveAbsolute = $null -ne $pathRoot -and $pathRoot.Length -eq 3 -and $pathRoot[1] -eq ':' -and $pathRoot[2] -eq $separator; $uncAbsolute = $null -ne $pathRoot -and $pathRoot.StartsWith(([string]$separator + [string]$separator), [StringComparison]::Ordinal); if ($driveAbsolute -or $uncAbsolute) { [void]$roots.Add($value) } } } } } } }; foreach ($infoPath in @((Join-Path $env:APPDATA 'Dropbox\\info.json'), (Join-Path $env:LOCALAPPDATA 'Dropbox\\info.json'))) { if (Test-Path -LiteralPath $infoPath) { $accounts = Get-Content -LiteralPath $infoPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop; foreach ($account in $accounts.PSObject.Properties.Value) { if ($account.path -is [string]) { [void]$roots.Add($account.path) } } } }; foreach ($root in $roots) { $normalized = [IO.Path]::GetFullPath($root).TrimEnd('\\') + '\\'; if ($target.StartsWith($normalized, [System.StringComparison]::OrdinalIgnoreCase) -or $normalized.StartsWith($target, [System.StringComparison]::OrdinalIgnoreCase)) { 'sync'; exit } }; 'clear' } catch { 'unknown' }",
    workDirectory,
  )).trim()
  if (syncProbeStatus !== 'clear') {
    throw new Error('Recovery work directory synchronization-root probe did not return clear status.')
  }
  return {
    encryptionStatus,
    reparseStatus,
    syncProbeStatus,
    windowsPowerShellVersion,
  }
}

export async function probeReadOnlyToolPrerequisites({
  targetPostgresMajor,
  postgresTools,
  repositoryRoot,
  windowsPowerShellVersion,
}) {
  const { supabaseVersion } = verifyLocalSupabaseCliPackage({ repositoryRoot })
  const postgresVersions = verifyPinnedPostgresToolVersions({ postgresTools })
  return verifyReadOnlyToolVersions({
    windowsPowerShell: windowsPowerShellVersion,
    supabase: supabaseVersion,
    ...postgresVersions,
  }, targetPostgresMajor)
}

export async function probeReadOnlyPrerequisites({
  targetPostgresMajor,
  volumeRoot,
  workDirectory,
  encryptionProvider,
  efsProbeFile,
  postgresTools,
  repositoryRoot,
  runner = executeReadOnlyProbe,
}) {
  const protection = await probeRecoveryWorkDirectoryProtection({
    volumeRoot,
    workDirectory,
    encryptionProvider,
    efsProbeFile,
    runner,
  })
  const versions = await probeReadOnlyToolPrerequisites({
    targetPostgresMajor,
    postgresTools,
    repositoryRoot,
    windowsPowerShellVersion: protection.windowsPowerShellVersion,
    runner,
  })
  return { versions, ...protection }
}

function readBoundedFile(filePath, label, maxBytes) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new Error(`${label} path must be absolute.`)
  }
  const readOnce = () => {
    const before = exactRegularFileState(filePath, label)
    if (
      !Number.isSafeInteger(before.status.size)
      || before.status.size <= 0
      || before.status.size > maxBytes
    ) {
      throw new Error(`${label} size is outside the reviewed limit.`)
    }
    let fileDescriptor
    let opened
    let afterOpened
    let body
    try {
      fileDescriptor = openSync(before.realPath, 'r')
      opened = fstatSync(fileDescriptor)
      if (!sameFileIdentity(before.status, opened)) throw new Error('identity changed')
      body = readFileSync(fileDescriptor)
      afterOpened = fstatSync(fileDescriptor)
    } catch {
      throw new Error(`${label} cannot be read from the selected local evidence directory.`)
    } finally {
      if (fileDescriptor !== undefined) closeSync(fileDescriptor)
    }
    const after = exactRegularFileState(filePath, label)
    if (
      !sameFileIdentity(before.status, opened)
      || !sameFileIdentity(before.status, afterOpened)
      || !sameFileIdentity(before.status, after.status)
      || normalizedPath(before.realPath) !== normalizedPath(after.realPath)
      || body.length !== before.status.size
    ) {
      throw new Error(`${label} changed while it was being read.`)
    }
    return {
      body,
      sha256: createHash('sha256').update(body).digest('hex'),
      state: after.status,
    }
  }
  const first = readOnce()
  const confirmed = readOnce()
  if (
    first.sha256 !== confirmed.sha256
    || !sameFileIdentity(first.state, confirmed.state)
  ) {
    throw new Error(`${label} changed while its content was confirmed.`)
  }
  return confirmed.body.toString('utf8')
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
    '--encryption-provider',
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
    '--work-directory',
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

  const configuredWorkDirectory = args['--work-directory']
  const encryptionProvider = args['--encryption-provider']
  if (!['bitlocker', 'efs'].includes(encryptionProvider)) {
    throw new Error('A separate trusted recovery encryption provider is required.')
  }
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
  if (encryptionProvider === 'efs') {
    if (!args['--efs-probe-file']) {
      throw new Error('Exact EFS inheritance probe file evidence is required for EFS protection.')
    }
    realEfsProbeFile = resolveEfsProbeFile(args['--efs-probe-file'], realWorkDirectory)
  } else if (args['--efs-probe-file']) {
    throw new Error('EFS probe file evidence is only valid with the EFS encryption provider.')
  }
  const volumeRoot = path.win32.parse(realWorkDirectory).root
  const protection = await probeRecoveryWorkDirectoryProtection({
    volumeRoot,
    workDirectory: realWorkDirectory,
    encryptionProvider,
    efsProbeFile: realEfsProbeFile,
    runner,
  })
  verifyRecoveryWorkDirectory({
    configuredPath: configuredWorkDirectory,
    realPath: realWorkDirectory,
    repositoryRoot,
    syncRoots: configuredSyncRoots,
    allowedRoots: [realAllowedWorkRoot],
    encryptionProvider,
    encryptionStatus: protection.encryptionStatus,
    reparseStatus: protection.reparseStatus,
    syncProbeStatus: protection.syncProbeStatus,
  })
  const initialEvidenceFiles = [args['--evidence'], ...(realEfsProbeFile ? [realEfsProbeFile] : [])]
  requireEvidenceFilesWithinWorkDirectory(initialEvidenceFiles, realWorkDirectory)
  await verifyWindowsNoReparsePaths({
    directoryPaths: [realWorkDirectory],
    filePaths: initialEvidenceFiles,
    ancestorRoot: realWorkDirectory,
    runner,
  })
  if (encryptionProvider === 'efs') {
    await verifyEfsEncryptedFiles({ filePaths: initialEvidenceFiles, runner })
  }
  const evidenceRaw = readBoundedFile(
    args['--evidence'],
    'Recovery preflight evidence',
    MAX_SMALL_EVIDENCE_BYTES,
  )
  await verifyWindowsNoReparsePaths({
    filePaths: initialEvidenceFiles,
    ancestorRoot: realWorkDirectory,
    runner,
  })
  if (encryptionProvider === 'efs') {
    await verifyEfsEncryptedFiles({ filePaths: initialEvidenceFiles, runner })
  }
  const evidence = parseJson(evidenceRaw, 'Recovery preflight evidence')
  if (
    !isRecord(evidence.workDirectory)
    || typeof evidence.workDirectory.path !== 'string'
    || normalizedPath(evidence.workDirectory.path, 'win32') !== normalizedPath(configuredWorkDirectory, 'win32')
    || evidence.workDirectory.encryptionProvider !== encryptionProvider
  ) {
    throw new Error('Recovery evidence does not match the separately trusted work directory and encryption provider.')
  }

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
  await verifyWindowsNoReparsePaths({
    directoryPaths: [realBodyRoot],
    filePaths: r2Paths,
    ancestorRoot: realWorkDirectory,
    runner,
  })
  await verifyWindowsTreeNoReparse({ rootDirectories: [realBodyRoot], runner })
  const preliminaryBodyTree = enumerateRegularFiles(realBodyRoot)
  await verifyWindowsNoReparsePaths({
    directoryPaths: [...preliminaryBodyTree.directories.values()],
    filePaths: [...preliminaryBodyTree.files.values()],
    ancestorRoot: realBodyRoot,
    runner,
  })
  if (encryptionProvider === 'efs') {
    await verifyEfsEncryptedFiles({ filePaths: r2Paths, runner })
    await verifyEfsEncryptedFiles({ filePaths: [...preliminaryBodyTree.files.values()], runner })
  }

  const latestRaw = readBoundedFile(args['--r2-latest'], 'R2 latest pointer', MAX_SMALL_EVIDENCE_BYTES)
  const completeRaw = readBoundedFile(args['--r2-complete'], 'R2 completion marker', MAX_SMALL_EVIDENCE_BYTES)
  const manifestRaw = readBoundedFile(args['--r2-manifest'], 'R2 manifest', MAX_MANIFEST_BYTES)
  const manifestChecksumRaw = readBoundedFile(
    args['--r2-manifest-sha256'],
    'R2 manifest checksum',
    256,
  )
  await verifyWindowsNoReparsePaths({
    directoryPaths: [realBodyRoot],
    filePaths: r2Paths,
    ancestorRoot: realWorkDirectory,
    runner,
  })
  if (encryptionProvider === 'efs') {
    await verifyEfsEncryptedFiles({ filePaths: r2Paths, runner })
  }
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
    encryptionProvider,
    runner,
  })

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

  const postgresTools = await verifyPostgresPortableArtifacts({
    pgDumpPath: args['--pg-dump-path'],
    pgRestorePath: args['--pg-restore-path'],
    psqlPath: args['--psql-path'],
    archivePath: args['--pg-archive-path'],
    allowedRoot: realAllowedWorkRoot,
    runner,
  })
  const toolVersions = await probeReadOnlyToolPrerequisites({
    targetPostgresMajor: core.targetPostgresMajor,
    postgresTools,
    repositoryRoot,
    windowsPowerShellVersion: protection.windowsPowerShellVersion,
    runner,
  })

  return {
    help: false,
    remoteMetadataRead: true,
    remoteStateMutated: false,
    expectedComputeCostUsd: core.expectedComputeCostUsd,
    postgresArchiveSha256: postgresTools.archiveSha256,
    toolVersions,
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
    '  node scripts/verify-supabase-recovery-preflight.mjs --work-directory <absolute-path> --encryption-provider <bitlocker|efs> --evidence <absolute-path> --target-ref <ref> --allowed-work-root <absolute-path> --pg-archive-path <absolute-path> --pg-dump-path <absolute-path> --pg-restore-path <absolute-path> --psql-path <absolute-path> --r2-latest <absolute-path> --r2-complete <absolute-path> --r2-manifest <absolute-path> --r2-manifest-sha256 <absolute-path> --r2-body-root <absolute-path> [--efs-probe-file <absolute-path>]',
    '',
    'Requires SUPABASE_ACCESS_TOKEN plus externally delivered Supabase get_cost confirmation environment values.',
    'This command only performs fixed Management API GETs, reads and hashes selected local evidence/artifacts, and runs fixed protection probes through signed Windows PowerShell.',
    'It statically verifies the exact Supabase package lock and pinned PostgreSQL artifact; it never executes either CLI or any PostgreSQL binary.',
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
      console.log('Recovery preflight passed; fixed live metadata, protected local evidence, and pinned artifacts were verified without executing Supabase or PostgreSQL binaries.')
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'Recovery preflight failed closed.')
      process.exitCode = 1
    })
}
