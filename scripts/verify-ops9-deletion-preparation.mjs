import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyDatabaseReleaseSafety } from './verify-database-release-safety.mjs'

export const OPS9_PREPARATION_BASE_SHA = '700895b2a5351851912452f0f692608ee8cc9e5d'
export const OPS9_MIGRATION = 'supabase/migrations/20260904050000_ops9_deletion_jobs.sql'
export const OPS9_PERMISSION_TEST = 'supabase/tests/ops9_deletion_jobs.sql'
export const OPS9_NATIVE_ASSERTIONS = 'scripts/fixtures/ops9-deletion-assertions.sql'
export const OPS9_MIGRATION_SHA256 = 'cee5a601083e84b127181751fd9cb978dc71dd52c0058d39a6de7728aa9013f9'
export const OPS9_PERMISSION_TEST_SHA256 = 'ed2f7fea60791bc25bd2637de5ab318741d41c5b8e6bbf6e0887b97b238f9c3b'
export const OPS9_NATIVE_ASSERTIONS_SHA256 = 'eca807a463a57465648d8ff02cb323810b41ebb8866df4fba1bcd22ab977b87c'

export const OPS9_APPROVED_PATHS = Object.freeze([
  'docs/operations/ops9-deletion-preparation.md',
  'functions/api/_runtimeConfig.test.ts',
  'functions/api/_runtimeConfig.ts',
  'functions/api/_middleware.test.ts',
  'functions/api/_routePolicy.ts',
  'functions/api/account/delete.test.ts',
  'functions/api/account/delete.ts',
  'functions/api/deletions/_shared.ts',
  'functions/api/labs/delete.test.ts',
  'functions/api/labs/delete.ts',
  'package.json',
  OPS9_NATIVE_ASSERTIONS,
  'scripts/test-ops9-local-postgres.mjs',
  'scripts/verify-database-release-safety.mjs',
  'scripts/verify-database-release-safety.test.ts',
  'scripts/verify-ops8-password-preparation.test.ts',
  'scripts/verify-ops9-deletion-preparation.mjs',
  'scripts/verify-ops9-deletion-preparation.test.ts',
  'src/components/LabManagementModal.tsx',
  'src/components/SettingsModal.tsx',
  'src/config/deletion.ts',
  'src/hooks/useAuth.ts',
  'src/services/labService.test.ts',
  'src/services/labService.ts',
  OPS9_MIGRATION,
  'supabase/migrations/README.md',
  OPS9_PERMISSION_TEST,
])

function fail(message) { throw new Error(`[ops9-preparation] ${message}`) }
function normalized(value) { return value.replace(/\r\n/g, '\n') }
function sha256(value) { return createHash('sha256').update(normalized(value), 'utf8').digest('hex') }
function requireMarkers(source, markers, label) {
  for (const marker of markers) if (!source.includes(marker)) fail(`${label} is missing: ${marker}`)
}
function git(root, args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }) }
  catch { fail('cannot verify the Git preparation boundary') }
}

export function verifyOps9Paths(paths) {
  const allowed = new Set(OPS9_APPROVED_PATHS)
  for (const candidate of paths) {
    if (typeof candidate !== 'string' || !candidate || /[\\\x00-\x1f\x7f]/.test(candidate)
      || candidate.startsWith('/') || candidate.split('/').some((part) => !part || part === '.' || part === '..')) {
      fail('a changed path is malformed')
    }
    if (!allowed.has(candidate)) fail(`unreviewed path is present: ${candidate}`)
  }
  return paths.length
}

export function verifyOps9DatabaseSources({ migration, permissionTest, nativeAssertions }) {
  const sources = {
    migration: normalized(migration),
    permissionTest: normalized(permissionTest),
    nativeAssertions: normalized(nativeAssertions),
  }
  if (sha256(sources.migration) !== OPS9_MIGRATION_SHA256) fail('reviewed deletion migration changed')
  if (sha256(sources.permissionTest) !== OPS9_PERMISSION_TEST_SHA256) fail('reviewed deletion permission test changed')
  if (sha256(sources.nativeAssertions) !== OPS9_NATIVE_ASSERTIONS_SHA256) fail('reviewed deletion native assertions changed')
  requireMarkers(sources.migration, [
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '60s';",
    'create table private.deletion_jobs_v1',
    'create table private.deletion_job_events_v1',
    'for update skip locked',
    "attempt_count between 0 and 12",
    "p_outcome = 'completed' and (p_stage <> 'finalize'",
    'Deletion job stage cannot move backward',
    'private.require_deletion_file_ownership_v1',
    'deletion_job_events_v1_no_rewrite',
    'deletion_job_events_v1_no_truncate',
    'from public, anon, authenticated, service_role;',
  ], 'deletion migration')
  for (const pattern of [
    /\bdrop\s+(?:table|column|function|schema)\b/i,
    /\bdelete\s+from\s+public\./i,
    /grant\s+(?:select|insert|update|delete|truncate|all)[^;]+private\.deletion_/i,
    /grant\s+execute\s+on\s+function\s+public\.(?:enqueue|claim|record|get)_?[^;]+to\s+(?:public|anon|authenticated)/i,
  ]) if (pattern.test(sources.migration)) fail(`deletion migration contains an unapproved operation: ${pattern}`)
  requireMarkers(sources.permissionTest, [
    'select plan(23);',
    "'public.enqueue_account_deletion_v1(uuid,uuid)'",
    "'public.record_deletion_job_result_v1(uuid,uuid,text,text,text)'",
    'select * from finish();',
    'rollback;',
  ], 'permission test')
  requireMarkers(sources.nativeAssertions, [
    'OPS9_DELETION_SQL_ASSERTIONS_PASSED',
    'direct deletion table access is exposed',
    'append-only deletion event triggers changed',
  ], 'native assertions')
  return Object.freeze({
    migrationSha256: sha256(sources.migration),
    permissionTestSha256: sha256(sources.permissionTest),
    nativeAssertionsSha256: sha256(sources.nativeAssertions),
  })
}

export function verifyOps9ApplicationSources({
  runtimeConfig, intake, accountHandler, labHandler, deletionConfig,
  authHook, labService, settingsModal, labModal,
}) {
  requireMarkers(runtimeConfig, [
    'accountDeletionEnabled,',
    'accountDeletionEnabled: false',
    'maintenanceEnabled: false',
  ], 'runtime configuration')
  requireMarkers(intake, [
    'DELETION_INTAKE_BODY_BYTES = 2 * 1024',
    'DELETION_INTAKE_TIMEOUT_MS = 8_000',
    'runtimeConfig.accountDeletionEnabled',
    'userClient.auth.getUser',
    "enqueue_account_deletion_v1",
    "enqueue_lab_deletion_v1",
    "return response({ success: true, jobId:",
  ], 'deletion intake')
  requireMarkers(accountHandler, ["enqueueDeletionRequest(context, 'account')"], 'account handler')
  requireMarkers(labHandler, ["enqueueDeletionRequest(context, 'lab')"], 'lab handler')
  for (const source of [accountHandler, labHandler, intake]) {
    if (/\.from\s*\(\s*['"](?:labs|auth\.users|inventory|cabinets)['"]\s*\)\s*\.delete/i.test(source)) {
      fail('a deletion API still performs immediate table deletion')
    }
  }
  if (!deletionConfig.includes('DELETION_UI_ENABLED = false as const')) fail('deletion UI is not pinned OFF')
  requireMarkers(authHook, [
    "'/api/account/delete'",
    '{ requestId: crypto.randomUUID() }',
    "['pending', 'running', 'retry_wait']",
  ], 'account client')
  const accountCallback = authHook.match(/const deleteAccount = useCallback[\s\S]*?\n\s*\}, \[\]\);/)?.[0] ?? ''
  if (!accountCallback || /signOut|clearUser/.test(accountCallback)) fail('queued account deletion still signs out or clears data immediately')
  requireMarkers(labService, [
    'async requestLabDeletion(',
    "'/api/labs/delete'",
    '{ labId, requestId: crypto.randomUUID() }',
  ], 'lab client')
  if (/async\s+deleteLab[\s\S]*?\.from\s*\(\s*['"]labs['"]\s*\)[\s\S]*?\.delete\s*\(/i.test(labService)) {
    fail('the browser still directly deletes labs')
  }
  if (!settingsModal.includes('session && DELETION_UI_ENABLED')) fail('account deletion control is not hidden')
  if (!labModal.includes('DELETION_UI_ENABLED && <div')) fail('lab deletion control is not hidden')
  return Object.freeze({
    uiEnabled: false,
    runtimeDefaultEnabled: false,
    immediateAccountDeletionRemoved: true,
    directLabDeletionRemoved: true,
  })
}

export function verifyOps9DeletionPreparation(root = fileURLToPath(new URL('../', import.meta.url))) {
  git(root, ['cat-file','-e',`${OPS9_PREPARATION_BASE_SHA}^{commit}`])
  git(root, ['merge-base','--is-ancestor',OPS9_PREPARATION_BASE_SHA,'HEAD'])
  const changed = git(root, ['diff','--name-only',OPS9_PREPARATION_BASE_SHA,'--'])
    .split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
  const untracked = git(root, ['ls-files','--others','--exclude-standard','--'])
    .split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
  const paths = [...new Set([...changed,...untracked])].sort()
  verifyOps9Paths(paths)
  for (const candidate of paths) {
    const status = lstatSync(path.join(root, candidate), { throwIfNoEntry: false })
    if (!status?.isFile()) fail(`reviewed path must be a regular file: ${candidate}`)
  }
  const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8')
  const database = verifyOps9DatabaseSources({
    migration: read(OPS9_MIGRATION),
    permissionTest: read(OPS9_PERMISSION_TEST),
    nativeAssertions: read(OPS9_NATIVE_ASSERTIONS),
  })
  const application = verifyOps9ApplicationSources({
    runtimeConfig: read('functions/api/_runtimeConfig.ts'),
    intake: read('functions/api/deletions/_shared.ts'),
    accountHandler: read('functions/api/account/delete.ts'),
    labHandler: read('functions/api/labs/delete.ts'),
    deletionConfig: read('src/config/deletion.ts'),
    authHook: read('src/hooks/useAuth.ts'),
    labService: read('src/services/labService.ts'),
    settingsModal: read('src/components/SettingsModal.tsx'),
    labModal: read('src/components/LabManagementModal.tsx'),
  })
  const documentation = read('docs/operations/ops9-deletion-preparation.md')
  requireMarkers(documentation, [
    '`productionReady: false`',
    '`deletionIntakeEnabled: false`',
    '`deletionWorkerReady: false`',
    '`hostedSupabaseAcceptance: false`',
    '실제 Supabase·Cloudflare 변경',
    '삭제 UI와 Scheduler는 계속 OFF',
  ], 'Ops9 documentation')
  const packageSource = read('package.json')
  if (!packageSource.includes('"ops9:verify": "node scripts/verify-ops9-deletion-preparation.mjs"')) {
    fail('package verification script is missing')
  }
  const releaseSafety = verifyDatabaseReleaseSafety(root)
  if (releaseSafety.activeMigrations !== 7 || releaseSafety.activePgTapTests !== 6) {
    fail('active database release manifest is not pinned through Ops9')
  }
  return Object.freeze({
    result: 'ops9-deletion-preparation-ok',
    baseSha: OPS9_PREPARATION_BASE_SHA,
    changedFiles: paths.length,
    database,
    application,
    activeMigrations: releaseSafety.activeMigrations,
    activePgTapTests: releaseSafety.activePgTapTests,
    productionReady: false,
    deletionIntakeEnabled: false,
    deletionWorkerReady: false,
    hostedSupabaseAcceptance: false,
    requiresEarlierOperationalGates: true,
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(verifyOps9DeletionPreparation())) }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'Ops9 preparation verification failed.')
    process.exitCode = 1
  }
}
