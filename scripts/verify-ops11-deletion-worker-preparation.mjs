import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyDatabaseReleaseSafety } from './verify-database-release-safety.mjs'

export const OPS11_PREPARATION_BASE_SHA = 'b42304fa226ba127da438b015b6d8b72223b45b5'
export const OPS11_MIGRATION = 'supabase/migrations/20260904070000_ops11_deletion_worker.sql'
export const OPS11_PERMISSION_TEST = 'supabase/tests/ops11_deletion_worker.sql'
export const OPS11_NATIVE_ASSERTIONS = 'scripts/fixtures/ops11-deletion-worker-assertions.sql'
export const OPS11_DPAPI_TEST = 'scripts/ephemeral-release-key-store.test.ts'
export const OPS11_HISTORY_REPAIR_TEST = 'scripts/repair-production-migration-history.test.ts'
export const OPS11_LOCAL_JOIN_TEST = 'scripts/ops5-local-join-api.test.ts'
export const OPS11_MIGRATION_SHA256 = '6e476e51dc55ed168fb51d590143ad7b752c74d937235bc4a248821a37c0e26c'
export const OPS11_PERMISSION_TEST_SHA256 = '3369e23259b8833d6b1884674eba7b7b7f64838aeee3373a6838f37b53161395'
export const OPS11_NATIVE_ASSERTIONS_SHA256 = '8b86710c9abc4ff1189f56946cb0df2248db1f00cf371b47efd834584c50f7c8'
export const OPS11_DPAPI_TEST_SHA256 = '422ffaaf22194fc0aa14f4e8e700e575ceda5dc12aeb733d87604f0bb2cfa5d6'
export const OPS11_HISTORY_REPAIR_TEST_SHA256 = '338f4e31b302c25d41995bc87e14ef3586cf468d873156071a66f5da8ad6a034'
export const OPS11_LOCAL_JOIN_TEST_SHA256 = 'e2f289273f956df33bdf17c1a40e61644e4767acb64309ccb09c20fa2729b61b'
export const OPS11_IGNORED_GENERATED_UNTRACKED_PATHS = Object.freeze(['results.sarif'])

export const OPS11_APPROVED_PATHS = Object.freeze([
  '.gitleaksignore',
  'docs/operations/accelerated-ops3-11-release-2026-09-05.md',
  'docs/operations/ops11-deletion-worker-preparation.md',
  'docs/operations/ops1-ops2-daily-backup-2of2-2026-09-05.md',
  'docs/operations/ops3-production-and-ops4-plan-2026-09-05.md',
  'docs/operations/ops4-production-migration-history-evidence-2026-09-05.md',
  'docs/operations/ops5-production-expand-evidence-2026-09-05.md',
  'docs/operations/ops6-private-photo-preparation.md',
  'docs/operations/ops8-ops11-accelerated-production-evidence-2026-09-05.md',
  'docs/operations/operations-safety-rollout.md',
  'docs/operations/supabase-hosted-advisor-token.md',
  'eslint.config.js',
  'functions/api/_middleware.test.ts',
  'functions/api/_middleware.ts',
  'functions/api/_routePolicy.ts',
  'functions/api/_runtimeConfig.test.ts',
  'functions/api/_runtimeConfig.ts',
  'functions/api/internal/deletions/_processor.ts',
  'functions/api/internal/deletions/process.test.ts',
  'functions/api/internal/deletions/process.ts',
  'package.json',
  OPS11_NATIVE_ASSERTIONS,
  OPS11_DPAPI_TEST,
  OPS11_HISTORY_REPAIR_TEST,
  OPS11_LOCAL_JOIN_TEST,
  'scripts/repair-production-migration-history.ps1',
  'scripts/smoke-ops5-production-compatibility.mjs',
  'scripts/ephemeral-release-supervisor-core.mjs',
  'scripts/ephemeral-release-supervisor-core.test.ts',
  'scripts/migrate-ops6-private-photos.mjs',
  'scripts/migrate-ops6-private-photos.test.ts',
  'scripts/ops6-private-photo-migration-core.mjs',
  'scripts/ops6-private-photo-migration-core.test.ts',
  'scripts/test-ops11-local-postgres.mjs',
  'scripts/supervise-ephemeral-release.mjs',
  'scripts/verify-accelerated-ops3-11-release.mjs',
  'scripts/verify-accelerated-ops3-11-release.test.ts',
  'scripts/verify-database-release-safety.mjs',
  'scripts/verify-database-release-safety.test.ts',
  'scripts/verify-ops10-operator-preparation.test.ts',
  'scripts/verify-ops11-deletion-worker-preparation.mjs',
  'scripts/verify-ops11-deletion-worker-preparation.test.ts',
  'scripts/verify-ops3-release-scope.mjs',
  'scripts/verify-ops3-release-scope.test.ts',
  'scripts/verify-ops6-private-photo-preparation.mjs',
  'scripts/verify-supabase-security-advisors.mjs',
  'scripts/verify-supabase-security-advisors.test.ts',
  OPS11_MIGRATION,
  'supabase/migrations/README.md',
  'supabase/security-advisors/staging.json',
  'supabase/security-advisors/production.json',
  'supabase/tests/baseline_permissions.sql',
  OPS11_PERMISSION_TEST,
  'workers/deletion-scheduler/.dev.vars.example',
  'workers/deletion-scheduler/src/index.ts',
  'workers/deletion-scheduler/src/scheduler.test.ts',
  'workers/deletion-scheduler/src/scheduler.ts',
  'workers/deletion-scheduler/tsconfig.json',
  'workers/deletion-scheduler/worker-configuration.d.ts',
  'workers/deletion-scheduler/wrangler.production.jsonc',
  'workers/deletion-scheduler/wrangler.staging.jsonc',
])

function fail(message) { throw new Error(`[ops11-preparation] ${message}`) }
function normalized(value) { return value.replace(/\r\n/g, '\n') }
function sha256(value) { return createHash('sha256').update(normalized(value), 'utf8').digest('hex') }
function requireMarkers(source, markers, label) {
  for (const marker of markers) if (!source.includes(marker)) fail(`${label} is missing: ${marker}`)
}
function git(root, args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }) }
  catch { fail('cannot verify the Git preparation boundary') }
}

export function verifyOps11Paths(paths) {
  const allowed = new Set(OPS11_APPROVED_PATHS)
  for (const candidate of paths) {
    if (typeof candidate !== 'string' || !candidate || /[\\\x00-\x1f\x7f]/.test(candidate)
      || candidate.startsWith('/') || candidate.split('/').some((part) => !part || part === '.' || part === '..')) {
      fail('a changed path is malformed')
    }
    if (!allowed.has(candidate)) fail(`unreviewed path is present: ${candidate}`)
  }
  return paths.length
}

export function filterOps11GeneratedUntrackedPaths(paths) {
  const ignored = new Set(OPS11_IGNORED_GENERATED_UNTRACKED_PATHS)
  return paths.filter((candidate) => !ignored.has(candidate))
}

export function verifyOps11DatabaseSources({ migration, permissionTest, nativeAssertions }) {
  const sources = {
    migration: normalized(migration), permissionTest: normalized(permissionTest),
    nativeAssertions: normalized(nativeAssertions),
  }
  if (sha256(sources.migration) !== OPS11_MIGRATION_SHA256) fail('reviewed deletion worker migration changed')
  if (sha256(sources.permissionTest) !== OPS11_PERMISSION_TEST_SHA256) fail('reviewed deletion worker pgTAP changed')
  if (sha256(sources.nativeAssertions) !== OPS11_NATIVE_ASSERTIONS_SHA256) fail('reviewed deletion worker assertions changed')
  requireMarkers(sources.migration, [
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '60s';",
    'create table private.deletion_file_targets_v1',
    'create table private.deletion_worker_lease_v1',
    "slot = 'deletion-worker-v1'",
    'prepare_deletion_job_database_v1',
    'list_deletion_file_targets_v1',
    'mark_deletion_storage_complete_v1',
    'mark_deletion_auth_complete_v1',
    'finalize_deletion_job_v1',
    'schedule_deletion_job_retry_v1',
    'attempt_count >= 12',
    "delete from private.deletion_file_targets_v1 t where t.job_id=p_job_id",
    'from public, anon, authenticated, service_role;',
  ], 'deletion worker migration')
  for (const pattern of [
    /\bdrop\s+(?:table|column|function|schema)\b/i,
    /grant\s+(?:select|insert|update|delete|truncate|all)[^;]+private\.deletion_/i,
    /grant\s+execute\s+on\s+function\s+public\.(?:acquire_deletion|release_deletion|prepare_deletion|list_deletion|mark_deletion|finalize_deletion|schedule_deletion)[^;]+to\s+(?:public|anon|authenticated)/i,
  ]) if (pattern.test(sources.migration)) fail(`deletion worker migration contains an unapproved operation: ${pattern}`)
  requireMarkers(sources.permissionTest, [
    'select plan(30);',
    "'public.acquire_deletion_worker_run_v1(uuid,integer)'",
    "'public.finalize_deletion_job_v1(uuid,uuid)'",
    'select * from finish();',
    'rollback;',
  ], 'deletion worker pgTAP')
  requireMarkers(sources.nativeAssertions, [
    'OPS11_DELETION_WORKER_SQL_ASSERTIONS_PASSED',
    'direct Ops11 table access is exposed',
    'deletion retry attempt cap changed',
  ], 'deletion worker assertions')
  return Object.freeze({
    migrationSha256: sha256(sources.migration),
    permissionTestSha256: sha256(sources.permissionTest),
    nativeAssertionsSha256: sha256(sources.nativeAssertions),
  })
}

export function verifyOps11ApplicationSources({
  runtimeConfig, middleware, routePolicy, processor, handler, deletionUi,
}) {
  requireMarkers(runtimeConfig, [
    'maintenanceEnabled,', 'accountDeletionEnabled,', 'maintenanceEnabled: false',
  ], 'runtime configuration')
  requireMarkers(middleware, [
    "DELETION_PROCESSOR_ROUTE = '/api/internal/deletions/process'",
    'must not be interpreted as a user Supabase JWT',
    'bytes.byteLength !== 0',
  ], 'API middleware')
  requireMarkers(routePolicy, [
    "'/api/internal/deletions/process'", "policy.id === '/api/internal/deletions/process'",
  ], 'API route policy')
  requireMarkers(processor, [
    "type DeletionStage = 'queued' | 'database' | 'storage' | 'auth' | 'finalize'",
    "claim_deletion_jobs_v1', { p_limit: 1 }",
    "error.status !== 404 && error.code !== 'user_not_found'",
    'schedule_deletion_job_retry_v1',
    "return status === 'failed' ? 'failed' : 'pending'",
    'await gateway.releaseRun(runToken)',
  ], 'deletion processor')
  requireMarkers(handler, [
    'expectedSecret.length < 32',
    'timingSafeEqual',
    'runtime.maintenanceEnabled',
    'MAX_UPSTREAM_REQUESTS = 32',
    "internalErrorResponse('deletions.worker.process'",
  ], 'deletion processor handler')
  if (!deletionUi.includes('DELETION_UI_ENABLED = false as const')) {
    fail('deletion UI was enabled before three scheduled successes')
  }
  for (const source of [processor, handler]) {
    if (/console\.(?:log|error)\([^)]*(?:path|email|lab|chemical|token)/i.test(source)) {
      fail('deletion processor may log sensitive job data')
    }
  }
  return Object.freeze({
    stages: ['database','storage','auth','finalize'], claimLimit: 1,
    deletionUiEnabled: false, idempotentAuthNotFound: true,
  })
}

export function verifyOps11WorkerSources({ scheduler, index, stagingConfig, productionConfig, generatedTypes }) {
  requireMarkers(scheduler, [
    'STALE_SUCCESS_MS = 3 * 60 * 1000',
    'MAX_CONSECUTIVE_FAILURES = 2',
    'READINESS_SUCCESSES = 3',
    "new URL('/api/internal/deletions/process'",
    "account_deletion_enabled: false",
    "maintenance_worker_enabled: false",
    "response.status !== 200",
    'summary.failed > 0',
    'enablement_eligible',
  ], 'deletion Scheduler')
  requireMarkers(index, ['satisfies ExportedHandler<Env>', 'controller.scheduledTime'], 'Worker entrypoint')
  requireMarkers(stagingConfig, [
    '"name": "buril-lab-deletion-scheduler-staging"',
    '"crons": ["* * * * *"]',
    '"DELETION_TARGET_ORIGIN": "https://staging.burillab.com"',
    '"CF_ACCESS_CLIENT_ID"', '"CF_ACCESS_CLIENT_SECRET"',
  ], 'Staging Worker config')
  requireMarkers(productionConfig, [
    '"name": "buril-lab-deletion-scheduler-production"',
    '"crons": ["* * * * *"]',
    '"DELETION_TARGET_ORIGIN": "https://burillab.com"',
  ], 'production Worker config')
  if (productionConfig.includes('CF_ACCESS_CLIENT_')) fail('production Worker config includes Staging Access credentials')
  if (scheduler.includes('account_deletion_enabled: true') || scheduler.includes('maintenance_worker_enabled: true')) {
    fail('Scheduler can turn deletion capabilities ON')
  }
  if (scheduler.includes('api.cloudflare.com/client/v4') || stagingConfig.includes('r2_buckets')
    || productionConfig.includes('r2_buckets')) fail('deletion Scheduler exceeds its KV and HTTPS scope')
  requireMarkers(generatedTypes, [
    'BURILLAB_RUNTIME_CONFIG: KVNamespace;', 'DELETION_MAINTENANCE_SECRET: string;',
    'CF_ACCESS_CLIENT_ID: string;',
  ], 'generated Worker bindings')
  return Object.freeze({
    cron: '* * * * *', consecutiveFailureLimit: 2,
    staleSuccessMinutes: 3, readinessSuccesses: 3, autoEnable: false,
  })
}

export function verifyOps11DeletionWorkerPreparation(root = fileURLToPath(new URL('../', import.meta.url))) {
  git(root, ['cat-file','-e',`${OPS11_PREPARATION_BASE_SHA}^{commit}`])
  git(root, ['merge-base','--is-ancestor',OPS11_PREPARATION_BASE_SHA,'HEAD'])
  const changed = git(root, ['diff','--name-only',OPS11_PREPARATION_BASE_SHA,'--'])
    .split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
  const untracked = filterOps11GeneratedUntrackedPaths(git(root, ['ls-files','--others','--exclude-standard','--'])
    .split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
  )
  const paths = [...new Set([...changed,...untracked])].sort()
  verifyOps11Paths(paths)
  for (const candidate of paths) {
    const status = lstatSync(path.join(root, candidate), { throwIfNoEntry: false })
    if (!status?.isFile()) fail(`reviewed path must be a regular file: ${candidate}`)
  }
  const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8')
  const dpapiTest = normalized(read(OPS11_DPAPI_TEST))
  if (sha256(dpapiTest) !== OPS11_DPAPI_TEST_SHA256 || !dpapiTest.includes('}, 35_000)')) {
    fail('reviewed Windows DPAPI test timeout changed')
  }
  const historyRepairTest = normalized(read(OPS11_HISTORY_REPAIR_TEST))
  if (sha256(historyRepairTest) !== OPS11_HISTORY_REPAIR_TEST_SHA256
    || [...historyRepairTest.matchAll(/}, 45_000\)/g)].length !== 4) {
    fail('reviewed Windows migration-history test timeout changed')
  }
  const localJoinTest = normalized(read(OPS11_LOCAL_JOIN_TEST))
  if (sha256(localJoinTest) !== OPS11_LOCAL_JOIN_TEST_SHA256
    || !localJoinTest.includes('fetchBlockedPorts.has(address.port)')) {
    fail('reviewed local join fetch-safe port test changed')
  }
  const database = verifyOps11DatabaseSources({
    migration: read(OPS11_MIGRATION), permissionTest: read(OPS11_PERMISSION_TEST),
    nativeAssertions: read(OPS11_NATIVE_ASSERTIONS),
  })
  const application = verifyOps11ApplicationSources({
    runtimeConfig: read('functions/api/_runtimeConfig.ts'),
    middleware: read('functions/api/_middleware.ts'), routePolicy: read('functions/api/_routePolicy.ts'),
    processor: read('functions/api/internal/deletions/_processor.ts'),
    handler: read('functions/api/internal/deletions/process.ts'), deletionUi: read('src/config/deletion.ts'),
  })
  const worker = verifyOps11WorkerSources({
    scheduler: read('workers/deletion-scheduler/src/scheduler.ts'),
    index: read('workers/deletion-scheduler/src/index.ts'),
    stagingConfig: read('workers/deletion-scheduler/wrangler.staging.jsonc'),
    productionConfig: read('workers/deletion-scheduler/wrangler.production.jsonc'),
    generatedTypes: read('workers/deletion-scheduler/worker-configuration.d.ts'),
  })
  const documentation = read('docs/operations/ops11-deletion-worker-preparation.md')
  requireMarkers(documentation, [
    '`productionReady: false`', '`schedulerDeployed: false`',
    '`deletionIntakeEnabled: false`', '`deletionUiEnabled: false`',
    '`hostedSupabaseAcceptance: false`',
    '실제 Supabase·Cloudflare·GitHub 변경', '예약 호출 3회',
  ], 'Ops11 documentation')
  const packageSource = read('package.json')
  requireMarkers(packageSource, [
    '"ops11:verify": "node scripts/verify-ops11-deletion-worker-preparation.mjs"',
    '"deletion-scheduler:check":',
  ], 'package scripts')
  const releaseSafety = verifyDatabaseReleaseSafety(root)
  if (releaseSafety.activeMigrations !== 9 || releaseSafety.activePgTapTests !== 8) {
    fail('active database release manifest is not pinned through Ops11')
  }
  return Object.freeze({
    result: 'ops11-deletion-worker-preparation-ok', baseSha: OPS11_PREPARATION_BASE_SHA,
    changedFiles: paths.length, database, application, worker,
    dpapiTestSha256: sha256(dpapiTest),
    historyRepairTestSha256: sha256(historyRepairTest),
    localJoinTestSha256: sha256(localJoinTest),
    activeMigrations: releaseSafety.activeMigrations, activePgTapTests: releaseSafety.activePgTapTests,
    productionReady: false, schedulerDeployed: false, deletionIntakeEnabled: false,
    deletionUiEnabled: false, hostedSupabaseAcceptance: false,
    requiresEarlierOperationalGates: true,
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(verifyOps11DeletionWorkerPreparation())) }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'Ops11 preparation verification failed.')
    process.exitCode = 1
  }
}
