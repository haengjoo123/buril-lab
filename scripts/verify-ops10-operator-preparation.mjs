import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyDatabaseReleaseSafety } from './verify-database-release-safety.mjs'

export const OPS10_PREPARATION_BASE_SHA = 'dda05f16e7320bdb35f19252076a9f5e930ecb6c'
export const OPS10_MIGRATION = 'supabase/migrations/20260904060000_ops10_operator_roles_mfa.sql'
export const OPS10_PERMISSION_TEST = 'supabase/tests/ops10_operator_roles_mfa.sql'
export const OPS10_NATIVE_ASSERTIONS = 'scripts/fixtures/ops10-operator-assertions.sql'
export const OPS10_MIGRATION_SHA256 = 'c74fcb093c2c456c90303ecef2dedd331310a44cc126558a62a71331cac9af22'
export const OPS10_PERMISSION_TEST_SHA256 = 'fb41468364973f2171c6c090a4306c7b8f8f4c0382d1ee1817a189e21dfeda7d'
export const OPS10_NATIVE_ASSERTIONS_SHA256 = '3b4d0fd2f01f42b9a832004d524ade77d23fca9c6b86560b308702cbd5106bac'

export const OPS10_APPROVED_PATHS = Object.freeze([
  'docs/operations/ops10-operator-roles-mfa-preparation.md',
  'functions/api/admin/analytics/_shared.test.ts',
  'functions/api/admin/analytics/_shared.ts',
  'functions/api/admin/analytics/export.ts',
  'functions/api/admin/analytics/mixtures.ts',
  'functions/api/admin/analytics/reviews.ts',
  'functions/api/admin/analytics/search.ts',
  'functions/api/admin/analytics/summary.ts',
  'functions/api/admin/boundary.test.ts',
  'functions/api/admin/feedback/_shared.ts',
  'functions/api/admin/feedback/list.ts',
  'functions/api/admin/feedback/status.ts',
  'functions/api/admin/safety-centers/document-url.ts',
  'functions/api/admin/safety-centers/list.ts',
  'functions/api/admin/safety-centers/status.ts',
  'package.json',
  OPS10_NATIVE_ASSERTIONS,
  'scripts/test-ops10-local-postgres.mjs',
  'scripts/verify-database-release-safety.mjs',
  'scripts/verify-database-release-safety.test.ts',
  'scripts/verify-ops9-deletion-preparation.test.ts',
  'scripts/verify-ops10-operator-preparation.mjs',
  'scripts/verify-ops10-operator-preparation.test.ts',
  OPS10_MIGRATION,
  'supabase/migrations/README.md',
  OPS10_PERMISSION_TEST,
])

function fail(message) { throw new Error(`[ops10-preparation] ${message}`) }
function normalized(value) { return value.replace(/\r\n/g, '\n') }
function sha256(value) { return createHash('sha256').update(normalized(value), 'utf8').digest('hex') }
function requireMarkers(source, markers, label) {
  for (const marker of markers) if (!source.includes(marker)) fail(`${label} is missing: ${marker}`)
}
function git(root, args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }) }
  catch { fail('cannot verify the Git preparation boundary') }
}

export function verifyOps10Paths(paths) {
  const allowed = new Set(OPS10_APPROVED_PATHS)
  for (const candidate of paths) {
    if (typeof candidate !== 'string' || !candidate || /[\\\x00-\x1f\x7f]/.test(candidate)
      || candidate.startsWith('/') || candidate.split('/').some((part) => !part || part === '.' || part === '..')) {
      fail('a changed path is malformed')
    }
    if (!allowed.has(candidate)) fail(`unreviewed path is present: ${candidate}`)
  }
  return paths.length
}

export function verifyOps10DatabaseSources({ migration, permissionTest, nativeAssertions }) {
  const sources = {
    migration: normalized(migration), permissionTest: normalized(permissionTest),
    nativeAssertions: normalized(nativeAssertions),
  }
  if (sha256(sources.migration) !== OPS10_MIGRATION_SHA256) fail('reviewed operator migration changed')
  if (sha256(sources.permissionTest) !== OPS10_PERMISSION_TEST_SHA256) fail('reviewed operator permission test changed')
  if (sha256(sources.nativeAssertions) !== OPS10_NATIVE_ASSERTIONS_SHA256) fail('reviewed operator native assertions changed')
  requireMarkers(sources.migration, [
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '60s';",
    'create table private.operator_role_assignments_v1',
    "role in ('reader', 'approver', 'raw_exporter')",
    'create table private.operator_action_audit_v1',
    'operator_action_audit_v1_no_rewrite',
    'operator_action_audit_v1_no_truncate',
    'operator_review_required',
    'mfa_required',
    'authorize_operator_fallback_v1',
    'operator_feedback_status_v1',
    'operator_safety_center_status_v1',
    'operator_analytics_review_decide_v1',
    'from public, anon, authenticated, service_role;',
  ], 'operator migration')
  for (const pattern of [
    /\bdrop\s+(?:table|column|function|schema)\b/i,
    /\bdelete\s+from\s+public\./i,
    /grant\s+(?:select|insert|update|delete|truncate|all)[^;]+private\.operator_/i,
    /grant\s+execute\s+on\s+function\s+public\.(?:set_operator|authorize_operator|operator_)[^;]+to\s+(?:public|anon|authenticated)/i,
  ]) if (pattern.test(sources.migration)) fail(`operator migration contains an unapproved operation: ${pattern}`)
  requireMarkers(sources.permissionTest, [
    'select plan(26);',
    "'public.authorize_operator_action_v1(uuid,text,text,text,uuid,uuid,text)'",
    "'public.operator_feedback_status_v1(uuid,uuid,text,uuid,text)'",
    'select * from finish();',
    'rollback;',
  ], 'permission test')
  requireMarkers(sources.nativeAssertions, [
    'OPS10_OPERATOR_SQL_ASSERTIONS_PASSED',
    'direct operator table access is exposed',
    'append-only operator audit triggers changed',
  ], 'native assertions')
  return Object.freeze({
    migrationSha256: sha256(sources.migration),
    permissionTestSha256: sha256(sources.permissionTest),
    nativeAssertionsSha256: sha256(sources.nativeAssertions),
  })
}

export function verifyOps10ApplicationSources({
  adminShared, analyticsShared, feedbackStatus, centerStatus, reviews,
  feedbackList, documentUrl, exportHandler,
}) {
  requireMarkers(adminShared, [
    "type OperatorRole = 'reader' | 'approver' | 'raw_exporter'",
    "import { decodeJwt } from 'jose'",
    "payload.aal === 'aal2'",
    "authMode === 'server_roles'",
    "authMode === 'email_allowlist'",
    'MAX_FALLBACK_DURATION_MS = 24 * 60 * 60 * 1_000',
    "authorization = await authorizeServerRole",
    "authorization = await authorizeFallback",
    "internalErrorResponse('admin.auth.audit'",
    "code: 'MFA_REQUIRED'",
    'trustedRequestId?: unknown',
  ], 'administrator authorization')
  requireMarkers(analyticsShared, [
    'return requireFeedbackAdmin(request, env, trustedRequestId)',
  ], 'analytics authorization')
  if (/parseAdminEmails|OPS_ANALYTICS_EXPORT_EMAILS/.test(analyticsShared)) {
    fail('analytics authorization still performs a second client-side email check')
  }
  requireMarkers(feedbackStatus, [
    "rpc('operator_feedback_status_v1'",
    'p_request_id: identity.requestId',
    'p_assurance_level: identity.assuranceLevel',
  ], 'feedback mutation')
  requireMarkers(centerStatus, [
    "rpc('operator_safety_center_status_v1'",
    'p_request_id: identity.requestId',
  ], 'safety-center mutation')
  requireMarkers(reviews, [
    "rpc('operator_analytics_review_decide_v1'",
    'p_request_id: auth.context.identity.requestId',
  ], 'analytics review mutation')
  requireMarkers(feedbackList, ['requireFeedbackAdmin', 'context.data?.requestId'], 'feedback response')
  requireMarkers(documentUrl, ['requireFeedbackAdmin', 'context.data?.requestId'], 'document URL')
  requireMarkers(exportHandler, ['requireAnalyticsExportAdmin', 'context.data?.requestId'], 'raw export')
  if (/\.from\s*\(\s*['"]feedback['"]\s*\)\s*\.update/i.test(feedbackStatus)
      || /\.from\s*\(\s*['"]safety_centers['"]\s*\)\s*\.update/i.test(centerStatus)
      || /rpc\s*\(\s*['"]analytics_review_candidate_decide['"]/i.test(reviews)) {
    fail('an administrator mutation bypasses its atomic operator audit wrapper')
  }
  return Object.freeze({
    roles: ['reader','approver','raw_exporter'],
    mfaRequired: true,
    fallbackMaximumHours: 24,
    atomicMutationAudit: true,
  })
}

export function verifyOps10OperatorPreparation(root = fileURLToPath(new URL('../', import.meta.url))) {
  git(root, ['cat-file','-e',`${OPS10_PREPARATION_BASE_SHA}^{commit}`])
  git(root, ['merge-base','--is-ancestor',OPS10_PREPARATION_BASE_SHA,'HEAD'])
  const changed = git(root, ['diff','--name-only',OPS10_PREPARATION_BASE_SHA,'--'])
    .split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
  const untracked = git(root, ['ls-files','--others','--exclude-standard','--'])
    .split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)
  const paths = [...new Set([...changed,...untracked])].sort()
  verifyOps10Paths(paths)
  for (const candidate of paths) {
    const status = lstatSync(path.join(root, candidate), { throwIfNoEntry: false })
    if (!status?.isFile()) fail(`reviewed path must be a regular file: ${candidate}`)
  }
  const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8')
  const database = verifyOps10DatabaseSources({
    migration: read(OPS10_MIGRATION), permissionTest: read(OPS10_PERMISSION_TEST),
    nativeAssertions: read(OPS10_NATIVE_ASSERTIONS),
  })
  const application = verifyOps10ApplicationSources({
    adminShared: read('functions/api/admin/feedback/_shared.ts'),
    analyticsShared: read('functions/api/admin/analytics/_shared.ts'),
    feedbackStatus: read('functions/api/admin/feedback/status.ts'),
    centerStatus: read('functions/api/admin/safety-centers/status.ts'),
    reviews: read('functions/api/admin/analytics/reviews.ts'),
    feedbackList: read('functions/api/admin/feedback/list.ts'),
    documentUrl: read('functions/api/admin/safety-centers/document-url.ts'),
    exportHandler: read('functions/api/admin/analytics/export.ts'),
  })
  const documentation = read('docs/operations/ops10-operator-roles-mfa-preparation.md')
  requireMarkers(documentation, [
    '`productionReady: false`',
    '`operatorRolesProvisioned: false`',
    '`operatorAuthModeApplied: false`',
    '`hostedSupabaseAcceptance: false`',
    '실제 Supabase·Cloudflare·GitHub 변경',
    '삭제 UI와 Scheduler도 계속 OFF',
  ], 'Ops10 documentation')
  const packageSource = read('package.json')
  if (!packageSource.includes('"ops10:verify": "node scripts/verify-ops10-operator-preparation.mjs"')) {
    fail('package verification script is missing')
  }
  const releaseSafety = verifyDatabaseReleaseSafety(root)
  if (releaseSafety.activeMigrations !== 8 || releaseSafety.activePgTapTests !== 7) {
    fail('active database release manifest is not pinned through Ops10')
  }
  return Object.freeze({
    result: 'ops10-operator-preparation-ok',
    baseSha: OPS10_PREPARATION_BASE_SHA,
    changedFiles: paths.length,
    database,
    application,
    activeMigrations: releaseSafety.activeMigrations,
    activePgTapTests: releaseSafety.activePgTapTests,
    productionReady: false,
    operatorRolesProvisioned: false,
    operatorAuthModeApplied: false,
    hostedSupabaseAcceptance: false,
    requiresEarlierOperationalGates: true,
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(verifyOps10OperatorPreparation())) }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'Ops10 preparation verification failed.')
    process.exitCode = 1
  }
}
